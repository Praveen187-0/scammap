// npm run partner -- demo
//     creates two demo partners (a bank and a city police unit) and prints their API keys
// npm run partner -- create --name "Demo Bank" --kind bank --upi oksbi,sbi --brands sbi,yono --senders SBIINB \
//     --areas 560102,560034 --webhook https://example.com/hook
// npm run partner -- list
//
// The API key is shown ONCE; only its SHA-256 is stored. Partners log in to the Partner console with it, or call
// /partner/* with the header x-api-key. A running server picks new partners up within 15 seconds.
import { AREAS } from "../shared/areas.js";
import { createPool, migrate } from "../src/db/db.js";
import { readEnv } from "../src/env.js";
import { loadDotEnv } from "../src/lib/dotenv.js";
import { PartnerService, type Tenant } from "../src/partners/partners.js";
import type { ScamService } from "../src/services/scamService.js";

loadDotEnv();
const args = process.argv.slice(2);
const arg = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const list = (n: string): string[] | undefined => arg(n)?.split(",").map((x) => x.trim()).filter(Boolean);

async function main(): Promise<void> {
  const env = readEnv();
  const pool = createPool(env.databaseUrl, env.dbSsl);
  await migrate(pool);
  const svc = new PartnerService(pool, null as unknown as ScamService);
  try {
    const cmd = args[0] ?? "list";
    if (cmd === "list") {
      const rows = (await pool.query<{ id: string; name: string; kind: string; watch: unknown; webhook_url: string | null }>("SELECT id, name, kind, watch, webhook_url FROM tenants ORDER BY created_at")).rows;
      if (!rows.length) console.log("No partners yet. Try: npm run partner -- demo");
      for (const r of rows) console.log(`${r.id}  ${r.name} (${r.kind})  watch=${JSON.stringify(r.watch)}  webhook=${r.webhook_url ?? "none"}`);
      return;
    }
    const made: Array<{ tenant: Tenant; apiKey: string }> = [];
    if (cmd === "demo") {
      made.push(await svc.create({ id: "demo-bank", name: "Demo Bank (SBI fraud desk)", kind: "bank", watch: { upi_handles: ["oksbi", "sbi"], brand_tokens: ["sbi", "yono", "onlinesbi"], sender_ids: ["SBIINB", "SBIBNK", "SBIUPD"], domains: ["sbi.co.in", "onlinesbi.sbi", "sbi.bank.in"] }, webhook_url: arg("webhook") ?? null }));
      made.push(await svc.create({ id: "blr-police", name: "Bengaluru City Police (cyber cell)", kind: "police", watch: { areas: AREAS.filter((a) => a.city === "Bengaluru").map((a) => a.pincode) }, webhook_url: null }));
    } else if (cmd === "create") {
      const name = arg("name");
      if (!name) throw new Error('--name is required, e.g. --name "Demo Bank"');
      const kind = (arg("kind") ?? "other") as Tenant["kind"];
      made.push(await svc.create({
        id: arg("id"), name, kind,
        watch: { upi_handles: list("upi"), brand_tokens: list("brands"), sender_ids: list("senders"), phone_prefixes: list("prefixes"), domains: list("domains"), areas: list("areas") },
        webhook_url: arg("webhook") ?? null,
      }));
    } else throw new Error(`unknown command "${cmd}" (use demo, create or list)`);
    for (const m of made) {
      console.log(`\n${m.tenant.name}  [${m.tenant.id}, ${m.tenant.kind}]`);
      console.log(`  API key (shown once):  ${m.apiKey}`);
      if (m.tenant.webhook_secret) console.log(`  Webhook signing secret: ${m.tenant.webhook_secret}  (verify the x-scammap-signature header: sha256=HMAC(secret, body))`);
    }
    console.log("\nOpen the app > Partners and paste the key. New reports that match a partner appear there (and go to its webhook).");
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
