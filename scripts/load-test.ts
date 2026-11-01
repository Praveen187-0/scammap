// npm run load-test -- [--base http://localhost:8080] [--seconds 20] [--concurrency 64] [--with-reports]
//
// Hammers the read API the way a busy day would (lookups, map, alerts, rollups) and reports throughput and
// p50/p95/p99 per endpoint. --with-reports also sends synthetic reports (they stay in the database: reset with
// `npm run seed-demo -- --reset` afterwards). The result is saved and shown in the Partner console.
import { AREAS } from "../shared/areas.js";
import { createPool } from "../src/db/db.js";
import { readEnv } from "../src/env.js";
import { loadDotEnv } from "../src/lib/dotenv.js";
import { formatIst } from "../src/lib/time.js";

loadDotEnv();
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const BASE = (arg("base") ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/+$/, "");
const SECONDS = Number(arg("seconds") ?? 20);
const CONC = Number(arg("concurrency") ?? 64);
const WITH_REPORTS = process.argv.includes("--with-reports");
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)] as T;

async function main(): Promise<void> {
  const env = readEnv();
  const pool = createPool(env.databaseUrl, env.dbSsl);
  const known = (await pool.query<{ identifier_type: string; normalized: string }>("SELECT identifier_type, normalized FROM identifiers ORDER BY random() LIMIT 500")).rows;
  const lic = await fetch(`${BASE}/license`).then((r) => r.json() as Promise<{ status?: string }>).catch(() => ({ status: "UNREACHABLE" }));
  if (lic.status !== "VALID") throw new Error(`Server at ${BASE} says licence ${lic.status}.`);
  type Kind = "lookup" | "map" | "alerts" | "rollups" | "report";
  const lat: Record<Kind, number[]> = { lookup: [], map: [], alerts: [], rollups: [], report: [] };
  let errors = 0;
  const end = Date.now() + SECONDS * 1000;
  const one = async (): Promise<void> => {
    const r = Math.random();
    const kind: Kind = WITH_REPORTS && r < 0.1 ? "report" : r < 0.8 ? "lookup" : r < 0.88 ? "map" : r < 0.95 ? "alerts" : "rollups";
    let url = BASE;
    let init: RequestInit | undefined;
    if (kind === "lookup") {
      const k = known.length && Math.random() < 0.7 ? pick(known) : { identifier_type: "phone", normalized: `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}` };
      url += `/lookup?type=${k.identifier_type}&value=${encodeURIComponent(k.normalized)}`;
    } else if (kind === "map") url += `/map?pincode=${pick(AREAS).pincode}&days=7&radius_km=5`;
    else if (kind === "alerts") url += `/alerts?pincode=${pick(AREAS).pincode}`;
    else if (kind === "rollups") url += "/rollups?hours=48";
    else {
      const a = pick(AREAS);
      url += "/reports";
      init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        occurred_at: formatIst(Date.now() - 3_600_000), reporter_id: `load_${Math.random().toString(36).slice(2)}`, ip_prefix: `10.${Math.floor(Math.random() * 255)}.1`,
        channel: "Phone call", scam_type: "otp-call", identifier_type: "phone", identifier_value: `+918${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`, pincode: a.pincode, note: "",
      }) };
    }
    const t0 = performance.now();
    try {
      const res = await fetch(url, init);
      await res.arrayBuffer();
      if (res.status >= 500) errors++;
    } catch {
      errors++;
    }
    lat[kind].push(performance.now() - t0);
  };
  console.log(`Load test against ${BASE}: ${CONC} concurrent clients for ${SECONDS} s${WITH_REPORTS ? " (with reports)" : ""}...`);
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (Date.now() < end) await one();
  }));
  const secs = (Date.now() - t0) / 1000;
  const q = (xs: number[], p: number): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! * 10) / 10 : 0;
  };
  const total = Object.values(lat).reduce((t, x) => t + x.length, 0);
  const endpoints = Object.fromEntries(Object.entries(lat).filter(([, x]) => x.length).map(([k, x]) => [k, { requests: x.length, p50_ms: q(x, 50), p95_ms: q(x, 95), p99_ms: q(x, 99) }]));
  const result = { base: BASE, seconds: Math.round(secs), concurrency: CONC, requests: total, rps: Math.round(total / secs), errors, endpoints };
  console.table(Object.entries(endpoints).map(([k, v]) => ({ endpoint: k, ...v })));
  console.log(`${result.rps} requests/s, ${errors} errors.`);
  await pool.query("INSERT INTO loadtest_runs (result) VALUES ($1)", [JSON.stringify(result)]);
  await pool.end();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
