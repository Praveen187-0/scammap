// Integration setup helpers: [TEST] sends, receiver error details, signed webhooks, and Telegram /chatid.
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Connectors, parseConfig } from "../src/connectors/connectors.js";
import type { Pool } from "../src/db/db.js";
import { describeNetworkError, postJson, signBody, verifySignature } from "../src/lib/deliver.js";
import type { LiveBus } from "../src/live/bus.js";
import type { AppDeps } from "../src/routes/deps.js";
import { TelegramBot } from "../src/telegram/bot.js";

interface Hit { path: string; headers: IncomingMessage["headers"]; body: string }
let server: Server;
let base = "";
const hits: Hit[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      hits.push({ path: req.url ?? "", headers: req.headers, body });
      if (req.url?.startsWith("/slack-bad")) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("no_service");
        return;
      }
      if (req.url?.includes("/sendMessage")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{\"ok\":true}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const fakePool = { query: async () => ({ rows: [] }), connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }) } as unknown as Pool;
const fakeBus = { subscribe: () => () => undefined } as unknown as LiveBus;

async function connectorsWith(yaml: string): Promise<Connectors> {
  const dir = mkdtempSync(path.join(tmpdir(), "scammap-conn-"));
  const file = path.join(dir, "connectors.yaml");
  writeFileSync(file, yaml);
  const c = new Connectors(fakePool, fakeBus, file, base);
  await c.reload();
  return c;
}

describe("integrations: test sends", () => {
  it("sends a [TEST] alert through a named output, ignoring its filters", async () => {
    const c = await connectorsWith(`outputs:\n  - name: slack-ok\n    type: slack\n    on: [alert]\n    webhook_url: ${base}/slack-ok\n    filter: { cities: [Mumbai] }\n`);
    const r = await c.test("slack-ok");
    expect(r).toEqual({ ok: true, error: null });
    const hit = hits.find((h) => h.path === "/slack-ok");
    expect(JSON.parse(hit!.body).text).toContain("[TEST]");
  });

  it("explains failures: unknown name, missing env, the receiver's own error text, and a cooldown", async () => {
    const c = await connectorsWith(`outputs:\n  - name: slack-bad\n    type: slack\n    on: [alert]\n    webhook_url: ${base}/slack-bad\n  - name: needs-env\n    type: slack\n    on: [alert]\n    webhook_url: \${NOT_SET_ANYWHERE_123}\n`);
    expect((await c.test("nope")).error).toMatch(/no output called nope/);
    expect((await c.test("needs-env")).error).toBe("set NOT_SET_ANYWHERE_123 in .env, then restart the server");
    const bad = await c.test("slack-bad");
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe("HTTP 404: no_service");
    expect((await c.test("slack-bad")).error).toMatch(/wait a few seconds/);
    const st = c.status().outputs as Array<{ name: string; last_error: string | null; failed: number }>;
    expect(st.find((o) => o.name === "slack-bad")).toMatchObject({ failed: 1, last_error: "HTTP 404: no_service" });
  });

  it("signs webhook bodies, and the receiver's check accepts them and rejects tampering", async () => {
    const c = await connectorsWith(`outputs:\n  - name: bank\n    type: webhook\n    on: [report]\n    url: ${base}/bank\n    secret: s3cret-value-for-tests\n`);
    expect((await c.test("bank")).ok).toBe(true);
    const hit = hits.find((h) => h.path === "/bank")!;
    const sig = String(hit.headers["x-scammap-signature"]);
    expect(sig).toBe(signBody("s3cret-value-for-tests", hit.body));
    expect(verifySignature("s3cret-value-for-tests", Buffer.from(hit.body), sig)).toBe(true);
    expect(verifySignature("s3cret-value-for-tests", Buffer.from(hit.body.replace("HSR", "XSR")), sig)).toBe(false);
    expect(verifySignature("other-secret", Buffer.from(hit.body), sig)).toBe(false);
    expect(verifySignature("s3cret-value-for-tests", Buffer.from(hit.body), undefined)).toBe(false);
    // The body carries the area and type only.
    expect(JSON.parse(hit.body).data).toMatchObject({ pincode: "560102", city: "Bengaluru" });
  });

  it("keeps env values with quotes or backslashes intact (JSON-escaped into the config)", () => {
    const cfg = parseConfig("outputs:\n  - name: mail\n    type: email\n    on: [alert]\n    smtp_url: ${U}\n    from: ${F}\n    to: a@b.in\n", { U: "smtps://a%40b.in:p\\a\"ss@smtp.b.in:465", F: "\"ScamMap\" <a@b.in>" });
    const o = cfg.outputs[0] as { smtp_url: string; from: string; missing: string[] };
    expect(o.smtp_url).toBe("smtps://a%40b.in:p\\a\"ss@smtp.b.in:465");
    expect(o.from).toBe("\"ScamMap\" <a@b.in>");
    expect(o.missing).toEqual([]);
  });
});

describe("integrations: delivery errors are readable", () => {
  it("says why a connection failed", async () => {
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const r = await postJson(`http://127.0.0.1:${port}/x`, { a: 1 }, {}, { retries: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ECONNREFUSED/);
    expect(describeNetworkError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe("timed out");
  });
});

describe("integrations: Telegram /chatid", () => {
  it("answers /chatid (also /chatid@Bot and in channels) with the chat's id, and stores nothing", async () => {
    let dbCalls = 0;
    const deps = {
      now: () => Date.now(),
      enforceLicence: true,
      licence: { status: () => "EXPIRED" },
      live: { subscribe: () => () => undefined },
      service: { db: { query: async () => { dbCalls++; return { rows: [] }; } } },
    } as unknown as AppDeps;
    const bot = new TelegramBot("123:abc", deps, "pepper", base);
    const before = hits.length;
    await bot.handle({ update_id: 1, message: { chat: { id: -1001234567890 }, text: "/chatid@ScamMapBot" } });
    await bot.handle({ update_id: 2, channel_post: { chat: { id: -1009876543210 }, text: "/chatid" } });
    await bot.handle({ update_id: 3, channel_post: { chat: { id: -1009876543210 }, text: "hello" } });
    const sent = hits.slice(before).filter((h) => h.path.endsWith("/sendMessage")).map((h) => JSON.parse(h.body) as { chat_id: string; text: string });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.chat_id).toBe("-1001234567890");
    expect(sent[0]!.text).toContain("TELEGRAM_ALERT_CHAT_ID=-1001234567890");
    expect(sent[1]!.text).toContain("TELEGRAM_ALERT_CHAT_ID=-1009876543210");
    expect(dbCalls).toBe(0);
  });
});
