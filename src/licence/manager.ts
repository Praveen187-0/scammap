// Holds the active licence in memory (hot-swapped by POST /license, no restart) and guards against the
// server clock being set back (see clockGuard.ts): a clock behind the latest time ever seen fails the check.
import type { KeyObject } from "node:crypto";
import { logWarn } from "../log.js";
import { formatIst } from "../lib/time.js";
import { ClockGuard, type ClockSource } from "./clockGuard.js";
import { verifyLicence, type Licence, type VerifyResult } from "./licence.js";

export type LicenceStatus = "VALID" | "EXPIRED" | "MISSING" | "CLOCK_ROLLBACK";

export interface LicenceStore {
  loadLicence(): Promise<unknown | null>;
  saveLicence(licence: Licence): Promise<void>;
  loadHighWater(): Promise<number | null>;
  saveHighWater(ms: number, source?: string): Promise<number | void>;
  dbNow?(): Promise<number | null>;
  saveMeta?(key: string, ms: number, detail: Record<string, unknown>): Promise<void>;
}

export interface LicenceInfo {
  licensee: string | null;
  expires_at: string | null;
  status: LicenceStatus;
  seconds_remaining: number;
  server_time: string;
}

export class LicenceManager {
  private current: { licence: Licence; expiresAtMs: number } | null = null;
  readonly clockGuard: ClockGuard;

  constructor(
    private readonly publicKey: KeyObject | null,
    private readonly store: LicenceStore,
    private readonly clock: () => number = Date.now,
    opts = { rollbackToleranceMs: 2 * 60_000, persistEveryMs: 60_000 },
    guard?: ClockGuard,
  ) {
    this.clockGuard = guard ?? new ClockGuard(store, clock, { toleranceMs: opts.rollbackToleranceMs, persistEveryMs: opts.persistEveryMs });
  }

  async init(bootstrapJson: string | null): Promise<void> {
    await this.clockGuard.init();
    const stored = await this.store.loadLicence();
    if (stored) {
      const v = verifyLicence(stored, this.publicKey);
      if (v.ok) this.current = { licence: v.licence, expiresAtMs: v.expiresAtMs };
      else logWarn(`stored licence failed verification (${v.error}); upload a new one with POST /license`);
    }
    if (!this.current && bootstrapJson) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(bootstrapJson);
      } catch {
        logWarn("LICENSE_JSON is not valid JSON");
      }
      if (parsed) {
        const res = await this.install(parsed);
        if (!res.ok) logWarn(`LICENSE_JSON rejected (${res.error})`);
      }
    }
    if (!this.publicKey) logWarn("No licence public key configured. Run `npm run gen-keys`, commit src/licence/publicKey.ts, redeploy.");
  }

  /** Called on every request (and with each accepted report's own time): moves the high-water mark forward. */
  observe(now: number = this.clock(), source: ClockSource = "request"): void {
    this.clockGuard.observe(now, source);
  }

  status(now: number = this.clock()): LicenceStatus {
    this.observe(now);
    if (this.clockGuard.rolledBack(now)) return "CLOCK_ROLLBACK";
    if (!this.current) return "MISSING";
    return now >= this.current.expiresAtMs ? "EXPIRED" : "VALID";
  }

  async install(input: unknown): Promise<VerifyResult> {
    const v = verifyLicence(input, this.publicKey);
    if (!v.ok) return v;
    await this.store.saveLicence(v.licence);
    this.current = { licence: v.licence, expiresAtMs: v.expiresAtMs };
    return v;
  }

  info(now: number = this.clock()): LicenceInfo {
    const status = this.status(now);
    return {
      licensee: this.current?.licence.licensee ?? null,
      expires_at: this.current?.licence.expires_at ?? null,
      status,
      seconds_remaining: this.current && status === "VALID" ? Math.floor((this.current.expiresAtMs - now) / 1000) : 0,
      server_time: formatIst(now),
    };
  }

  async flush(): Promise<void> {
    await this.clockGuard.flush();
  }
}
