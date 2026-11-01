// Time-travel defence. The server keeps a HIGH-WATER MARK: the latest time it has ever seen, from its own ticks
// (every 2 s), from accepted requests, from the database server's clock and, optionally, from an HTTPS time witness.
// The mark lives in system_metadata and is only ever raised, in one atomic statement (GREATEST), so restarts and
// several instances share it. If the server clock is ever behind the mark by more than the tolerance, the whole API
// locks with a specific safety error until the clock is correct again; nothing has to be reset by hand.
//
// Request timestamps (a report's occurred_at / reported_at) can only CONFIRM the mark, never push it past the
// server's own clock: otherwise one request with a date in the future could lock the server for everyone (and the
// brief's own test sends future-dated reports, expecting a 400).
import { formatIst } from "../lib/time.js";
import { logInfo, logWarn } from "../log.js";

export type ClockSource = "tick" | "request" | "report" | "database" | "witness" | "stored";

export interface ClockStore {
  loadHighWater(): Promise<number | null>;
  /** Atomic raise (GREATEST). May return the stored value, which can be higher if another instance raised it. */
  saveHighWater(ms: number, source?: string): Promise<number | void>;
  /** The database server's own clock, as a second witness (a different machine in most deployments). */
  dbNow?(): Promise<number | null>;
  saveMeta?(key: string, ms: number, detail: Record<string, unknown>): Promise<void>;
}

export interface ClockOptions {
  toleranceMs: number;
  persistEveryMs: number;
  tickMs: number;
  /** A witness may be up to this much ahead of us without moving the mark (normal clock skew between machines). */
  witnessSlackMs: number;
  witnessUrl: string | null;
  witnessEveryMs: number;
}

export const DEFAULT_CLOCK_OPTIONS: ClockOptions = {
  toleranceMs: 2 * 60_000,
  persistEveryMs: 60_000,
  tickMs: 2_000,
  witnessSlackMs: 30_000,
  witnessUrl: null,
  witnessEveryMs: 10 * 60_000,
};

export interface ClockState {
  status: "OK" | "CLOCK_ROLLBACK";
  server_time: string;
  high_water_mark: string | null;
  high_water_source: string;
  behind_seconds: number;
  tolerance_seconds: number;
  persisted: string | null;
  database_clock_offset_seconds: number | null;
  witness: { url: string; offset_seconds: number | null; checked_at: string | null; error: string | null } | null;
  locked_since: string | null;
  lock_events: number;
}

export class ClockGuard {
  private hwm = 0;
  private hwmSource: ClockSource = "stored";
  private persistedMs = 0;
  private lastPersistAt = 0;
  private dirty = false;
  private saving: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lockedSince: number | null = null;
  private lockEvents = 0;
  private dbOffset: number | null = null;
  private witness: { offset: number | null; at: number | null; error: string | null; next: number } = { offset: null, at: null, error: null, next: 0 };
  private readonly opts: ClockOptions;

  constructor(
    private readonly store: ClockStore,
    private readonly clock: () => number = Date.now,
    opts: Partial<ClockOptions> = {},
  ) {
    this.opts = { ...DEFAULT_CLOCK_OPTIONS, ...opts };
  }

  async init(): Promise<void> {
    this.hwm = (await this.store.loadHighWater()) ?? 0;
    this.persistedMs = this.hwm;
    this.hwmSource = "stored";
    if (this.rolledBack()) logWarn("clock is behind the stored high-water mark: the API stays locked until the clock is fixed");
  }

  get highWater(): number {
    return this.hwm;
  }

  /** Raise the mark. Request and report times are capped at our own clock (see the note at the top). */
  observe(ts: number, source: ClockSource = "request"): void {
    if (!Number.isFinite(ts)) return;
    const now = this.clock();
    const v = source === "request" || source === "report" ? Math.min(ts, now) : ts;
    if (v <= this.hwm) return;
    this.hwm = v;
    this.hwmSource = source;
    this.dirty = true;
    if (now - this.lastPersistAt >= this.opts.persistEveryMs) void this.persist();
  }

  /** True while the clock is behind the mark by more than the tolerance. Logs each lock and unlock once. */
  rolledBack(now: number = this.clock()): boolean {
    const back = now < this.hwm - this.opts.toleranceMs;
    if (back && this.lockedSince === null) {
      this.lockedSince = now;
      this.lockEvents++;
      const behind = Math.round((this.hwm - now) / 1000);
      logWarn(`SAFETY LOCK: server clock is ${behind} s behind the latest time this server has seen; API locked until it is fixed`);
      void this.store.saveMeta?.("clock.last_rollback", this.hwm, { detected_server_time: formatIst(now), behind_seconds: behind }).catch(() => undefined);
    } else if (!back && this.lockedSince !== null) {
      this.lockedSince = null;
      logInfo("safety lock lifted: server clock is correct again");
    }
    return back;
  }

  private async persist(): Promise<void> {
    if (this.saving) return this.saving;
    this.lastPersistAt = this.clock();
    this.dirty = false;
    const value = this.hwm;
    this.saving = (async () => {
      try {
        const stored = await this.store.saveHighWater(value, this.hwmSource);
        this.persistedMs = Math.max(this.persistedMs, value);
        // Another instance (or an earlier run) may hold a later mark: adopt it.
        if (typeof stored === "number" && stored > this.hwm) {
          this.hwm = stored;
          this.hwmSource = "stored";
        }
      } catch (e) {
        this.dirty = true;
        logWarn(`could not save the clock high-water mark (${e instanceof Error ? e.message : String(e)})`);
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  /** Local tick: our own clock, the database clock and (rarely) the HTTPS witness. */
  async tick(): Promise<void> {
    const now = this.clock();
    this.observe(now, "tick");
    try {
      const db = await this.store.dbNow?.();
      if (typeof db === "number" && Number.isFinite(db)) {
        this.dbOffset = db - this.clock();
        this.observe(db - this.opts.witnessSlackMs, "database");
      }
    } catch {
      this.dbOffset = null;
    }
    if (this.opts.witnessUrl && now >= this.witness.next) {
      this.witness.next = now + this.opts.witnessEveryMs;
      await this.checkWitness(this.opts.witnessUrl);
    }
    if (this.dirty) await this.persist();
    this.rolledBack();
  }

  /** Reads the Date header of an HTTPS site we trust to have a correct clock. */
  private async checkWitness(url: string): Promise<void> {
    try {
      const t0 = this.clock();
      const res = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000) });
      const date = Date.parse(res.headers.get("date") ?? "");
      if (!Number.isFinite(date)) throw new Error("no Date header");
      const mid = t0 + (this.clock() - t0) / 2;
      this.witness = { ...this.witness, offset: date - mid, at: this.clock(), error: null };
      this.observe(date - this.opts.witnessSlackMs, "witness");
    } catch (e) {
      this.witness = { ...this.witness, at: this.clock(), error: e instanceof Error ? e.message : String(e) };
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.opts.tickMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async flush(): Promise<void> {
    if (this.saving) await this.saving;
    if (this.dirty || this.hwm > this.persistedMs) await this.persist();
  }

  state(now: number = this.clock()): ClockState {
    const back = this.rolledBack(now);
    return {
      status: back ? "CLOCK_ROLLBACK" : "OK",
      server_time: formatIst(now),
      high_water_mark: this.hwm ? formatIst(this.hwm) : null,
      high_water_source: this.hwmSource,
      behind_seconds: Math.max(0, Math.round((this.hwm - now) / 1000)),
      tolerance_seconds: Math.round(this.opts.toleranceMs / 1000),
      persisted: this.persistedMs ? formatIst(this.persistedMs) : null,
      database_clock_offset_seconds: this.dbOffset === null ? null : Math.round(this.dbOffset / 1000),
      witness: this.opts.witnessUrl
        ? { url: this.opts.witnessUrl, offset_seconds: this.witness.offset === null ? null : Math.round(this.witness.offset / 1000), checked_at: this.witness.at ? formatIst(this.witness.at) : null, error: this.witness.error }
        : null,
      locked_since: this.lockedSince ? formatIst(this.lockedSince) : null,
      lock_events: this.lockEvents,
    };
  }
}
