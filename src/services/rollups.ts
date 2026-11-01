// Live hourly rollups maintained incrementally. A new report re-runs the trust rules for ONE identifier, which can
// flip "countable" on that identifier's older reports; only the hours those reports fall in are recomputed. Readers
// (dashboards, partner console) query the small rollup table and never aggregate the reports table.
import type { Pool } from "../db/db.js";
import { logError } from "../log.js";

export interface RollupRow {
  hour: string;
  pincode: string;
  scam_type: string;
  channel: string;
  counted: number;
  set_aside: number;
}

export class RollupService {
  private dirty = new Set<string>();
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  lastRefresh = { at: 0, hours: 0, ms: 0 };

  constructor(private readonly pool: Pool, private readonly intervalMs = 5000) {}

  markDirty(identKey: string): void {
    this.dirty.add(identKey);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Full rebuild: on startup when the table is empty, and after /admin/reset. */
  async rebuild(): Promise<void> {
    const t0 = performance.now();
    await this.pool.query("TRUNCATE rollup_hourly");
    await this.pool.query(
      `INSERT INTO rollup_hourly (hour, pincode, scam_type, channel, counted, set_aside)
       SELECT date_trunc('hour', occurred_at), pincode, scam_type, channel,
              count(*) FILTER (WHERE countable)::int, count(*) FILTER (WHERE NOT countable)::int
         FROM reports GROUP BY 1, 2, 3, 4`,
    );
    this.dirty.clear();
    this.lastRefresh = { at: Date.now(), hours: -1, ms: Math.round(performance.now() - t0) };
  }

  async ensureBuilt(): Promise<void> {
    const r = await this.pool.query<{ any: boolean }>("SELECT EXISTS (SELECT 1 FROM rollup_hourly) AS any");
    if (!r.rows[0]?.any) await this.rebuild();
  }

  /** Recompute only the hours touched by the identifiers that changed since the last run. */
  async refresh(): Promise<void> {
    if (this.running || !this.dirty.size) return;
    this.running = true;
    const keys = [...this.dirty];
    this.dirty.clear();
    const t0 = performance.now();
    const client = await this.pool.connect();
    try {
      const hours = (await client.query<{ h: Date }>(
        "SELECT DISTINCT date_trunc('hour', occurred_at) AS h FROM reports WHERE ident_key = ANY($1::text[])",
        [keys],
      )).rows.map((r) => r.h.toISOString());
      if (hours.length) {
        await client.query("BEGIN");
        await client.query("DELETE FROM rollup_hourly WHERE hour = ANY($1::timestamptz[])", [hours]);
        await client.query(
          `INSERT INTO rollup_hourly (hour, pincode, scam_type, channel, counted, set_aside)
           SELECT date_trunc('hour', r.occurred_at) AS h, r.pincode, r.scam_type, r.channel,
                  count(*) FILTER (WHERE r.countable)::int, count(*) FILTER (WHERE NOT r.countable)::int
             FROM unnest($1::timestamptz[]) AS t(h)
             JOIN reports r ON r.occurred_at >= t.h AND r.occurred_at < t.h + interval '1 hour'
            GROUP BY 1, 2, 3, 4`,
          [hours],
        );
        await client.query("COMMIT");
      }
      this.lastRefresh = { at: Date.now(), hours: hours.length, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      for (const k of keys) this.dirty.add(k);
      logError("rollup refresh failed", e);
    } finally {
      client.release();
      this.running = false;
    }
  }

  /** Hourly totals for the last N hours, optionally for some areas and scam types. Reads the rollup table only. */
  async series(hours: number, now: number, pincodes: string[] | null): Promise<Array<{ hour: string; counted: number; set_aside: number }>> {
    const from = new Date(Math.floor(now / 3_600_000) * 3_600_000 - (hours - 1) * 3_600_000);
    const rows = (await this.pool.query<{ hour: Date; counted: number; set_aside: number }>(
      `SELECT hour, sum(counted)::int AS counted, sum(set_aside)::int AS set_aside FROM rollup_hourly
        WHERE hour >= $1 ${pincodes ? "AND pincode = ANY($2::text[])" : ""} GROUP BY hour ORDER BY hour`,
      pincodes ? [from, pincodes] : [from],
    )).rows;
    const byHour = new Map(rows.map((r) => [r.hour.toISOString(), r]));
    return Array.from({ length: hours }, (_, i) => {
      const h = new Date(from.getTime() + i * 3_600_000).toISOString();
      const r = byHour.get(h);
      return { hour: h, counted: r?.counted ?? 0, set_aside: r?.set_aside ?? 0 };
    });
  }

  async byArea(hours: number, now: number): Promise<Array<{ pincode: string; counted: number; set_aside: number }>> {
    const from = new Date(now - hours * 3_600_000);
    return (await this.pool.query<{ pincode: string; counted: number; set_aside: number }>(
      "SELECT pincode, sum(counted)::int AS counted, sum(set_aside)::int AS set_aside FROM rollup_hourly WHERE hour >= $1 GROUP BY 1 ORDER BY 2 DESC",
      [from],
    )).rows;
  }
}
