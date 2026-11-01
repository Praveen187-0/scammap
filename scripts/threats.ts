// npm run threats      checks your URLhaus Auth-Key and shows what the map's global layer (layer B) will draw.
// Uses URLHAUS_AUTH_KEY from .env. Makes ONE request to URLhaus (abuse.ch asks for at most one every 5 minutes).
import { loadDotEnv } from "../src/lib/dotenv.js";
import { readEnv } from "../src/env.js";
import { ThreatFeed } from "../src/threatfeed/urlhaus.js";

loadDotEnv();

async function main(): Promise<void> {
  const env = readEnv();
  if (!env.urlhausAuthKey) {
    console.log("URLHAUS_AUTH_KEY is not set. Get a free key at https://auth.abuse.ch/ (sign in, then 'Optional: generate Auth-Key'),");
    console.log("then add it to .env:  URLHAUS_AUTH_KEY=your-key");
    process.exit(1);
  }
  const feed = new ThreatFeed({
    enabled: true, authKey: env.urlhausAuthKey, apiBase: env.urlhausApiBase, rdapBase: env.rdapBase,
    pollMs: 5 * 60_000, limit: Math.min(env.threatFeedLimit, 100), resolveDns: env.threatFeedDns, lookupsPerRefresh: 40,
  });
  console.log("Fetching recent URLs from URLhaus and locating them (DNS + registry lookups, about 10-30 s)...");
  await feed.refresh();
  const st = feed.status();
  if (!st.connected) {
    console.log(`Not connected: ${st.reason}`);
    process.exit(1);
  }
  const items = feed.list(null, 1000);
  console.log(`OK: ${items.length} URLs, ${st.located} placed on the map.`);
  console.log("Top countries:", feed.countries().slice(0, 8).map((c) => `${c.code} ${c.count}`).join(", "));
  for (const it of items.slice(0, 8)) console.log(`  ${it.added.slice(0, 16)}  ${(it.country ?? "--").padEnd(3)} ${it.display}`);
  console.log("URLs are shown defanged (hxxp, [.]): never open them.");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
