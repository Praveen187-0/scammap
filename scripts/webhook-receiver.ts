// npm run webhook-receiver [-- --port 9900] [--secret S] [--fail]
//
// A stand-in for a bank's fraud desk: receives the "bank-fraud-desk" webhook from config/connectors.yaml, checks the
// x-scammap-signature header the way a real partner should (HMAC-SHA256 of the raw body with the shared secret,
// compared in constant time: verifySignature in src/lib/deliver.ts, about 6 lines), and prints each event. Point BANK_WEBHOOK_URL at it:
//
//   BANK_WEBHOOK_URL=http://localhost:9900/scammap
//   BANK_WEBHOOK_SECRET=<the same value this script reads from .env>
//
// --fail answers 500 to everything, to show the server's retries (it tries 3 times: now, +2 s, +8 s).
// Bodies carry the area and scam type only, never a reporter or a reported number.
import { createServer } from "node:http";
import { verifySignature } from "../src/lib/deliver.js";
import { loadDotEnv } from "../src/lib/dotenv.js";

loadDotEnv();
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const PORT = Number(arg("port") ?? process.env.WEBHOOK_RECEIVER_PORT ?? 9900);
const SECRET = arg("secret") ?? process.env.BANK_WEBHOOK_SECRET ?? "";
const FAIL = process.argv.includes("--fail");
const C = { b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", x: "\x1b[0m" };

let received = 0;
const server = createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`ScamMap webhook receiver: ${received} events received. POST here.\n`);
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => {
    chunks.push(c);
    if (chunks.reduce((n, b) => n + b.length, 0) > 256 * 1024) req.destroy();
  });
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    const sig = req.headers["x-scammap-signature"];
    const event = String(req.headers["x-scammap-event"] ?? "?");
    const signed = SECRET ? verifySignature(SECRET, raw, typeof sig === "string" ? sig : undefined) : null;
    received++;
    let body: { event?: string; text?: string; data?: Record<string, unknown> } = {};
    try {
      body = JSON.parse(raw.toString("utf8")) as typeof body;
    } catch {
      /* printed as invalid below */
    }
    const when = new Date().toLocaleTimeString("en-IN", { hour12: false });
    const check = signed === null ? `${C.y}no secret set: signature not checked${C.x}` : signed ? `${C.g}signature OK${C.x}` : `${C.r}SIGNATURE INVALID${C.x}`;
    console.log(`\n${C.b}${C.c}#${received} ${when}  ${event}${C.x}  ${check}`);
    console.log(`  ${body.text ?? `${C.r}(not JSON)${C.x}`}`);
    const d = body.data ?? {};
    const facts = ["pincode", "locality", "city", "scam_type", "channel", "kind"].filter((k) => d[k] !== undefined).map((k) => `${k}=${String(d[k])}`);
    if (facts.length) console.log(`  ${C.d}${facts.join("  ")}${C.x}`);
    if (FAIL) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "simulated outage (--fail)" }));
      console.log(`  ${C.y}answered 500 (--fail): real events are retried after 2 s and 8 s; [TEST] sends are not${C.x}`);
      return;
    }
    if (signed === false) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad signature: BANK_WEBHOOK_SECRET differs between the server and this receiver" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
});

server.listen(PORT, () => {
  console.log(`${C.b}ScamMap webhook receiver${C.x} listening on http://localhost:${PORT}`);
  console.log(SECRET ? `Checking signatures with BANK_WEBHOOK_SECRET (${SECRET.length} characters).` : `${C.y}BANK_WEBHOOK_SECRET is not set: signatures will not be checked.${C.x}`);
  console.log(`In .env:  BANK_WEBHOOK_URL=http://localhost:${PORT}/scammap   then restart the server.`);
  console.log(`${C.d}Ctrl+C to stop.${C.x}`);
});
server.on("error", (e) => {
  console.error(`Could not listen on port ${PORT}: ${e.message}. Try --port 9901.`);
  process.exit(1);
});
