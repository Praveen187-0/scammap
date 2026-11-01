import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { logInfo } from "../log.js";
import type { Licence } from "../licence/licence.js";
import type { LicenceStore } from "../licence/manager.js";

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function createPool(url: string, ssl: boolean): Pool {
  const pool = new pg.Pool({
    connectionString: url,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  // A dropped idle connection must not crash the process.
  pool.on("error", () => undefined);
  return pool;
}

/** Applies every .sql file in src/db/migrations in name order, once. Locked so two instances can't race. */
export async function migrate(pool: Pool, dir = path.resolve(process.cwd(), "src/db/migrations")): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), "utf8");
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
      await client.query("COMMIT");
      logInfo("migration applied", { name: f });
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => undefined);
    client.release();
  }
}

export function licenceStore(pool: Pool): LicenceStore {
  return {
    async loadLicence() {
      const r = await pool.query<{ licence: unknown }>("SELECT licence FROM licence_state WHERE id = 1");
      return r.rows[0]?.licence ?? null;
    },
    async saveLicence(licence: Licence) {
      await pool.query(
        "INSERT INTO licence_state (id, licence, installed_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET licence = EXCLUDED.licence, installed_at = now()",
        [JSON.stringify(licence)],
      );
    },
    // Clock high-water mark (time-travel defence): system_metadata, raised atomically, never lowered.
    async loadHighWater() {
      const r = await pool.query<{ ms: string | null }>(
        `SELECT GREATEST((SELECT value_ms FROM system_metadata WHERE key = 'clock.high_water'),
                         (SELECT (extract(epoch FROM high_water) * 1000)::bigint FROM clock_state WHERE id = 1)) AS ms`,
      );
      const ms = r.rows[0]?.ms;
      return ms === null || ms === undefined ? null : Number(ms);
    },
    async saveHighWater(ms: number, source = "tick") {
      const r = await pool.query<{ value_ms: string }>(
        `INSERT INTO system_metadata (key, value_ms, detail, updated_at) VALUES ('clock.high_water', $1, jsonb_build_object('source', $2::text), now())
         ON CONFLICT (key) DO UPDATE SET
           detail = CASE WHEN EXCLUDED.value_ms > system_metadata.value_ms THEN EXCLUDED.detail ELSE system_metadata.detail END,
           value_ms = GREATEST(system_metadata.value_ms, EXCLUDED.value_ms),
           updated_at = now()
         RETURNING value_ms`,
        [Math.round(ms), source],
      );
      return Number(r.rows[0]?.value_ms ?? ms);
    },
    async dbNow() {
      const r = await pool.query<{ ms: number }>("SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms");
      return r.rows[0]?.ms ?? null;
    },
    async saveMeta(key: string, ms: number, detail: Record<string, unknown>) {
      await pool.query(
        `INSERT INTO system_metadata (key, value_ms, detail, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET value_ms = EXCLUDED.value_ms, detail = EXCLUDED.detail, updated_at = now()`,
        [key, Math.round(ms), JSON.stringify(detail)],
      );
    },
  };
}
