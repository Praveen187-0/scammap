// npm run clock -- status          what the time-travel defence has stored, next to this computer's clock
// npm run clock -- reset --yes     forget the stored "latest time" (only after a clock was WRONGLY far in the
//                                  future, e.g. a dead CMOS battery fixed by NTP). Restart the server afterwards.
// Uses DATABASE_URL from .env.
import { createPool } from "../src/db/db.js";
import { loadDotEnv } from "../src/lib/dotenv.js";
import { formatIst } from "../src/lib/time.js";
import { readEnv } from "../src/env.js";

loadDotEnv();
const cmd = process.argv[2] ?? "status";

async function main(): Promise<void> {
  const env = readEnv();
  const pool = createPool(env.databaseUrl, env.dbSsl);
  try {
    const row = (await pool.query<{ ms: string | null; detail: unknown; updated: Date | null; db: number }>(
      `SELECT (SELECT value_ms FROM system_metadata WHERE key = 'clock.high_water') AS ms,
              (SELECT detail FROM system_metadata WHERE key = 'clock.high_water') AS detail,
              (SELECT updated_at FROM system_metadata WHERE key = 'clock.high_water') AS updated,
              (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS db`,
    )).rows[0];
    const hw = row?.ms ? Number(row.ms) : null;
    const now = Date.now();
    if (cmd === "reset") {
      if (!process.argv.includes("--yes")) {
        console.log("This forgets the latest time the server has seen. Run again with --yes, then restart the server.");
        return;
      }
      await pool.query("DELETE FROM system_metadata WHERE key LIKE 'clock.%'");
      await pool.query("DELETE FROM clock_state");
      console.log("Clock mark cleared. Restart the server (Ctrl+C, then npm start); it starts a new mark from its own clock.");
      return;
    }
    console.log(`This computer's clock:  ${formatIst(now)}`);
    console.log(`Database clock:         ${row ? formatIst(row.db) : "?"}`);
    console.log(`Latest time ever seen:  ${hw ? formatIst(hw) : "none yet"}  ${row?.detail ? JSON.stringify(row.detail) : ""}`);
    if (hw) {
      const behind = Math.round((hw - now) / 1000);
      const allowed = Math.round(env.clockToleranceMs / 1000);
      console.log(behind > allowed ? `LOCKED: this clock is ${behind} s behind it (allowed ${allowed} s). Set the clock right; the server unlocks by itself.` : "OK: the clock is not behind the mark.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
