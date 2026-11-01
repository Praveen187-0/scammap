import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { findArea } from "../../shared/areas.js";
import { detectType, normalizeIdentifier, parseIdentifierType } from "../../shared/normalize.js";
import { buildLookupReply } from "../services/view.js";
import { prefixOf } from "./reports.js";
import { zodMessage, type AppDeps } from "./deps.js";

/** Budget per network for expensive calls (link visits). */
class Budget {
  private hits = new Map<string, number[]>();
  allow(key: string, perMinute: number): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (list.length >= perMinute) return false;
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) this.hits.clear();
    return true;
  }
}

// What each stored column holds, for the live privacy page. Anything not listed is shown as "internal".
const COLUMN_NOTES: Record<string, string> = {
  "reports.reporter_hash": "Keyed hash of the anonymous device id. Not reversible.",
  "reports.ip_hash": "Keyed hash of the network prefix (first 3 parts of the IP). Deleted after 30 days.",
  "reports.pincode": "The area only (for example 560102). Never an address or location.",
  "reports.note_len": "Length of the note. The note text itself is never stored.",
  "reports.net16_hash": "Keyed hash of the broader network block (/16), to spot one machine cycling addresses. Deleted after 30 days.",
  "reports.scam_type_source": "Who chose the scam type: the reporter, keyword rules, the local AI, or the default.",
  "system_metadata.value_ms": "Safety markers such as the latest time the server has seen (clock guard). No personal data.",
  "system_metadata.detail": "Where a safety marker came from (for example: tick, database clock).",
  "reports.note_hash": "Keyed hash of the note, to spot exact copies.",
  "reports.note_shingles": "Keyed hashes of short text pieces, to spot near-copies. The text cannot be rebuilt from them.",
  "reports.note_script": "Which script the note used (Latin / Devanagari / mixed).",
  "reports.ident_key": "The reported number, UPI ID, link or SMS sender (the thing being reported, not the reporter).",
  "reports.lost_money": "Yes/no. The amount is never stored, only a band.",
  "reports.loss_band": "0 none, 1 under ₹10k, 2 ₹10k-1 lakh, 3 over ₹1 lakh.",
  "challenges.contact_email": "Business contact for a dispute. Never returned by any API or logged.",
  "push_subs.subscription": "Browser push address, only for people who turned on area alerts. Deleted when they turn off.",
  "telegram_subs.chat_id": "Telegram chat id, only for people who sent /alerts. Deleted with /stop.",
  "tenants.key_hash": "SHA-256 of the partner API key. The key itself is never stored.",
  "verdict_log.ident_hash": "Keyed hash of the identifier, so the public log never shows the number.",
  "host_info.ips": "Server addresses of reported websites (servers, not people).",
};

export function registerPlatformRoutes(app: FastifyInstance, deps: AppDeps): void {
  const budget = new Budget();
  const P = deps.platform;

  // ---------------------------------------------------------------- explain: how reports became people
  app.get("/lookup/explain", async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const value = (q.value ?? "").trim();
    const type = q.type ? parseIdentifierType(q.type) : detectType(value);
    if (!value || !type) return reply.code(400).send({ error: "type and value are required" });
    const ident = normalizeIdentifier(type, value);
    if (!ident.ok) return reply.code(400).send({ error: ident.error });
    const look = buildLookupReply({ type: ident.type, value: ident.value, assessment: await deps.service.assessment(ident.key), verifiedOwner: deps.service.verifiedOwner(ident.key), challenged: deps.service.isChallenged(ident.key) });
    // One report stays private: nothing to explain, and nothing is revealed.
    if (look.report_count < 2) return { available: false };
    const data = await deps.service.explain(ident.key, deps.now());
    return data ? { available: true, verdict: look.verdict, display_value: look.display_value, ...data } : { available: false };
  });

  // ---------------------------------------------------------------- live link check (static + runtime)
  app.post("/analyze/link", async (req, reply) => {
    const body = z.object({ url: z.string().min(4).max(2048) }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: zodMessage(body.error.issues) });
    if (!budget.allow(`link:${prefixOf(req.ip) ?? "x"}`, 10)) return reply.code(429).send({ error: "too many link checks, try again in a minute" });
    try {
      const r = await P.linkscan.scan(body.data.url);
      P.campaigns.invalidate();
      return r;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 400) return reply.code(400).send({ error: (e as Error).message });
      throw e;
    }
  });

  // ---------------------------------------------------------------- campaigns and the scam network
  app.get("/campaigns", async () => {
    const { campaigns } = await P.campaigns.load(deps.now());
    return { campaigns, generated_at: new Date(deps.now()).toISOString() };
  });
  app.get<{ Params: { id: string } }>("/campaigns/:id", async (req, reply) => {
    const { campaigns } = await P.campaigns.load(deps.now());
    const c = campaigns.find((x) => x.id === req.params.id);
    if (!c) return reply.code(404).send({ error: "campaign not found" });
    return { ...c, story: await P.campaigns.story(c, deps.gemini) };
  });
  app.get("/network", async () => (await P.campaigns.load(deps.now())).network);

  // ---------------------------------------------------------------- push alerts
  app.get("/push/key", async () => ({ publicKey: P.push.publicKey }));
  const PushBody = z.object({
    subscription: z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }),
    pincode: z.string().max(10),
    lang: z.string().max(5).optional(),
  });
  app.post("/push/subscribe", async (req, reply) => {
    const b = PushBody.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: zodMessage(b.error.issues) });
    if (!findArea(b.data.pincode)) return reply.code(400).send({ error: "unknown area code (pincode)" });
    await P.push.subscribe(b.data.subscription, b.data.pincode, b.data.lang ?? "en");
    return { ok: true };
  });
  app.post("/push/unsubscribe", async (req, reply) => {
    const b = z.object({ endpoint: z.string().max(1000) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: zodMessage(b.error.issues) });
    await P.push.unsubscribe(b.data.endpoint);
    return { ok: true };
  });
  // Demo helper: send a test notification to every subscriber of one area.
  app.post("/push/test", async (req, reply) => {
    const b = z.object({ pincode: z.string().max(10) }).safeParse(req.body ?? {});
    if (!b.success || !findArea(b.data.pincode)) return reply.code(400).send({ error: "pincode is required" });
    const a = findArea(b.data.pincode)!;
    await P.push.sendArea(a.pincode, (lang) => ({ title: lang === "hi" ? `परीक्षण अलर्ट: ${a.localityHi}` : `Test alert: ${a.locality}`, body: lang === "hi" ? "अलर्ट काम कर रहे हैं।" : "Area alerts are working.", url: "/#alerts", tag: "test" }));
    return { ok: true, sent: P.push.sent, failed: P.push.failed };
  });

  // ---------------------------------------------------------------- partner console (API key per tenant)
  const tenantOf = (req: { headers: Record<string, unknown> }, reply: FastifyReply) => {
    const t = P.partners.authenticate(String(req.headers["x-api-key"] ?? ""));
    if (!t) void reply.code(401).send({ error: "missing or wrong x-api-key" });
    return t;
  };
  app.get("/partner/me", async (req, reply) => {
    const t = tenantOf(req, reply);
    if (!t) return reply;
    return { id: t.id, name: t.name, kind: t.kind, watch: t.watch, webhook: t.webhook_url ? t.webhook_url.replace(/\/\/([^/]+).*/, "//$1/…") : null };
  });
  app.get("/partner/hits", async (req, reply) => {
    const t = tenantOf(req, reply);
    if (!t) return reply;
    const hours = Math.min(720, Math.max(1, Number((req.query as Record<string, string>).hours ?? 168) || 168));
    return { hits: await P.partners.hits(t, hours) };
  });
  app.get("/partner/rollups", async (req, reply) => {
    const t = tenantOf(req, reply);
    if (!t) return reply;
    const hours = Math.min(168, Math.max(6, Number((req.query as Record<string, string>).hours ?? 48) || 48));
    const areas = t.watch.areas?.length ? t.watch.areas : null;
    return { hours, mine: await P.partners.hourly(t, hours), area: areas ? await P.rollups.series(hours, deps.now(), areas) : null, national: await P.rollups.series(hours, deps.now(), null) };
  });
  app.get("/partner/deliveries", async (req, reply) => {
    const t = tenantOf(req, reply);
    if (!t) return reply;
    return { deliveries: await P.partners.deliveries(t.id) };
  });
  app.post("/partner/test-webhook", async (req, reply) => {
    const t = tenantOf(req, reply);
    if (!t) return reply;
    return P.partners.testWebhook(t);
  });

  // ---------------------------------------------------------------- rollups and scale
  app.get("/rollups", async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const hours = Math.min(168, Math.max(6, Number(q.hours ?? 48) || 48));
    const pins = q.pincode && findArea(q.pincode) ? [q.pincode] : null;
    return { hours, series: await P.rollups.series(hours, deps.now(), pins), by_area: await P.rollups.byArea(hours, deps.now()), refreshed: P.rollups.lastRefresh };
  });
  app.get("/system/scale", async () => {
    const last = (await deps.service.db.query<{ at: Date; result: unknown }>("SELECT at, result FROM loadtest_runs ORDER BY id DESC LIMIT 1")).rows[0];
    const counts = (await deps.service.db.query<{ reports: number; idents: number; rollups: number }>(
      "SELECT (SELECT count(*)::int FROM reports) AS reports, (SELECT count(*)::int FROM identifiers) AS idents, (SELECT count(*)::int FROM rollup_hourly) AS rollups",
    )).rows[0];
    return { rollup_refresh: P.rollups.lastRefresh, last_load_test: last ? { at: new Date(last.at).toISOString(), ...(last.result as object) } : null, counts, partners: P.partners.count, push_subscribers: await P.push.count() };
  });

  // ---------------------------------------------------------------- integrations, transparency, privacy
  app.get("/connectors", async () => P.connectors.status());
  // Sends one clearly marked [TEST] alert through a named output, so each integration can be checked while setting
  // it up. Open in development; in production it needs CONNECTOR_TEST_TOKEN (header x-connector-test-token).
  app.post("/connectors/test", async (req, reply) => {
    const token = process.env.CONNECTOR_TEST_TOKEN;
    const given = req.headers["x-connector-test-token"];
    if (token ? given !== token : process.env.NODE_ENV === "production") return reply.code(403).send({ error: "set CONNECTOR_TEST_TOKEN and send it as x-connector-test-token" });
    const name = String(((req.body ?? {}) as { name?: unknown }).name ?? "").trim().slice(0, 60);
    if (!name) return reply.code(400).send({ error: "name is required (an output name from config/connectors.yaml)" });
    if (!budget.allow(`ctest:${prefixOf(req.ip) ?? "x"}`, 12)) return reply.code(429).send({ error: "too many tests, try again in a minute" });
    const r = await P.connectors.test(name);
    return { name, ok: r.ok, error: r.error };
  });
  app.get("/transparency", async (req) => {
    const limit = Math.min(100, Math.max(1, Number((req.query as Record<string, string>).limit ?? 20) || 20));
    return P.transparency.recent(limit);
  });
  app.get("/privacy/schema", async () => {
    const rows = (await deps.service.db.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> 'schema_migrations' ORDER BY table_name, ordinal_position`,
    )).rows;
    const tables = new Map<string, Array<{ column: string; type: string; note: string | null }>>();
    for (const r of rows) tables.set(r.table_name, [...(tables.get(r.table_name) ?? []), { column: r.column_name, type: r.data_type, note: COLUMN_NOTES[`${r.table_name}.${r.column_name}`] ?? null }]);
    return { read_at: new Date().toISOString(), tables: [...tables.entries()].map(([table, columns]) => ({ table, columns })) };
  });

  // ---------------------------------------------------------------- map layer B: global threat feed (URLhaus)
  // Layer A stays the strict GET /map. This is a separate, licence-gated endpoint the app polls every minute.
  app.get("/threats/global", async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const since = q.since && /^\d{1,12}$/.test(q.since) ? q.since : null;
    return {
      status: P.threats.status(),
      items: P.threats.list(since),
      countries: P.threats.countries().slice(0, 12),
      attribution: { name: "URLhaus by abuse.ch", url: "https://urlhaus.abuse.ch/" },
    };
  });

  // ---------------------------------------------------------------- on-device OCR files (served, not gated)
  const ocrFiles: Record<string, string> = {
    "worker.min.js": "node_modules/tesseract.js/dist/worker.min.js",
    "lang/eng.traineddata.gz": "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
    "lang/hin.traineddata.gz": "node_modules/@tesseract.js-data/hin/4.0.0_best_int/hin.traineddata.gz",
  };
  app.get<{ Params: { "*": string } }>("/ocr/*", async (req, reply) => {
    const rel = req.params["*"];
    let file = ocrFiles[rel];
    if (!file && /^core\/tesseract-core[a-z-]*\.(wasm\.js|wasm|js)$/.test(rel)) file = `node_modules/tesseract.js-core/${rel.slice(5)}`;
    if (!file) return reply.code(404).send({ error: "not found" });
    const abs = path.resolve(file);
    if (!existsSync(abs)) return reply.code(404).send({ error: "OCR files missing: run npm install" });
    const type = abs.endsWith(".js") ? "text/javascript" : abs.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
    return reply.header("content-type", type).header("cache-control", "public, max-age=604800").send(await readFile(abs));
  });

  // Android app (Trusted Web Activity) link verification, if you add the file PWABuilder gives you.
  app.get("/.well-known/assetlinks.json", async (_req, reply) => {
    for (const f of ["dist/public/.well-known/assetlinks.json", "client/public/.well-known/assetlinks.json"]) {
      if (existsSync(path.resolve(f))) return reply.header("content-type", "application/json").send(await readFile(path.resolve(f)));
    }
    return reply.code(404).send({ error: "not found" });
  });
}
