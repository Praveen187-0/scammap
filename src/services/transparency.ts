// Tamper-evident log of PUBLIC verdict changes. Each entry stores the SHA-256 of (previous hash + entry), so editing
// or deleting any past entry breaks every hash after it. Identifiers appear only as a keyed hash.
import { createHash } from "node:crypto";
import type { Pool } from "../db/db.js";
import { hmacHex } from "../lib/hmac.js";
import { formatIst } from "../lib/time.js";
import { logError } from "../log.js";

export const GENESIS = "0".repeat(64);

export interface LogEntry {
  seq: number;
  at: string;
  ident_hash: string;
  from_verdict: string;
  to_verdict: string;
  people: number;
  prev_hash: string;
  hash: string;
}

export function entryHash(prev: string, e: { at: string; ident_hash: string; from_verdict: string; to_verdict: string; people: number }): string {
  return createHash("sha256").update(`${prev}|${e.at}|${e.ident_hash}|${e.from_verdict}|${e.to_verdict}|${e.people}`).digest("hex");
}

/** Recomputes the chain; returns the first broken sequence number, or null when every link holds. */
export function verifyChain(entries: readonly LogEntry[]): number | null {
  let prev = entries[0]?.prev_hash ?? GENESIS;
  for (const e of entries) {
    if (e.prev_hash !== prev || entryHash(prev, e) !== e.hash) return e.seq;
    prev = e.hash;
  }
  return null;
}

export class TransparencyLog {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly pool: Pool, private readonly pepper: string) {}

  /** Appends in order (one at a time), with an advisory lock in case two servers share the database. */
  append(identKey: string, from: string, to: string, people: number, now: number): void {
    this.queue = this.queue.then(async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(727275)");
        const head = (await client.query<{ hash: string }>("SELECT hash FROM verdict_log ORDER BY seq DESC LIMIT 1")).rows[0]?.hash ?? GENESIS;
        const e = { at: formatIst(now), ident_hash: hmacHex(this.pepper, "log", identKey).slice(0, 16), from_verdict: from, to_verdict: to, people };
        await client.query(
          "INSERT INTO verdict_log (at, ident_hash, from_verdict, to_verdict, people, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [e.at, e.ident_hash, from, to, people, head, entryHash(head, e)],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        logError("transparency append failed", err);
      } finally {
        client.release();
      }
    });
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  async recent(limit: number): Promise<{ total: number; head: string; verified: boolean; broken_at: number | null; entries: LogEntry[] }> {
    const all = (await this.pool.query<LogEntry & { at: Date | string }>(
      "SELECT seq::int AS seq, at, ident_hash, from_verdict, to_verdict, people, prev_hash, hash FROM verdict_log ORDER BY seq",
    )).rows.map((r) => ({ ...r, at: typeof r.at === "string" ? r.at : formatIst(new Date(r.at).getTime()) }));
    const broken = verifyChain(all);
    return { total: all.length, head: all[all.length - 1]?.hash ?? GENESIS, verified: broken === null, broken_at: broken, entries: all.slice(-limit).reverse() };
  }
}
