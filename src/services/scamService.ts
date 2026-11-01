// Everything that touches the database for reports, lookups, challenges, the map and alerts.
import { normalizeIdentifier, type IdentifierType } from "../../shared/normalize.js";
import { VERIFIED } from "../../shared/verified.js";
import type { Client, Pool } from "../db/db.js";
import { caseIdFor, hmacHex, randomId } from "../lib/hmac.js";
import { KeyedMutex } from "../lib/mutex.js";
import { isPersonalDispute, noteFeatures } from "../lib/text.js";
import { networkBuckets } from "../lib/netprefix.js";
import { formatIst } from "../lib/time.js";
import { assess, type ReporterHistory, type TrustReport } from "../trust/assess.js";
import { TRUST } from "../trust/config.js";
import type { CountableRow } from "../alerts/alerts.js";
import type { Evidence, StoredAssessment } from "./view.js";

export interface ReportInput {
  reportId: string;
  identType: IdentifierType;
  identValue: string;
  identKey: string;
  occurredAt: number;
  reportedAt: number;
  reporterId: string;
  ipPrefix: string | null;
  channel: string;
  scamType: string;
  pincode: string;
  note: string;
  hasScreenshot: boolean;
  lostMoney: boolean;
  /** 0 none, 1 under ₹10k, 2 ₹10k-1L, 3 over ₹1L. Only the band is stored, never the amount. */
  lossBand: number;
  /** Other identifiers from the same message (keys), linked for campaign detection. */
  related?: string[];
  /** Where scamType came from: reporter (default), rules, local_ai or default ("other" because nothing matched). */
  scamTypeSource?: "reporter" | "rules" | "local_ai" | "default";
}

export interface ChangeEvent {
  identKey: string;
  reportId: string;
  pincode: string;
  scamType: string;
  occurredAt: number;
  before: StoredAssessment | null;
  after: StoredAssessment;
}

export interface ExplainData {
  raw: number;
  people: number;
  credible: number;
  reports: Array<{ hours_ago: number; voice: number; flags: string[]; has_note: boolean; evidence: boolean }>;
  voices: Array<{ index: number; size: number; accounts: number; credible: boolean; countable: boolean; weight: number; flags: string[] }>;
}

export type RejectReason = "bad_request" | "bad_identifier" | "unknown_area" | "bad_time" | "rate_limited";

export type SubmitResult =
  | { kind: "created"; reportId: string; caseId: string; merged: boolean; assessment: StoredAssessment | null; duplicate?: boolean }
  | { kind: "rate_limited"; retryAfterSec: number; reason: string };

interface ReportRow {
  report_id: string;
  reporter_hash: string;
  ip_hash: string | null;
  net16_hash: string | null;
  rep: number;
  occ: number;
  note_len: number;
  note_hash: string | null;
  note_shingles: number[];
  has_screenshot: boolean;
  lost_money: boolean;
  personal_dispute: boolean;
  scam_type: string;
  channel: string;
  pincode: string;
}

const MAX_CACHE = 50_000;

export class ScamService {
  private cache = new Map<string, StoredAssessment | null>();
  private listeners: Array<(e: ChangeEvent) => void> = [];

  /** Called after every stored report (rollups, transparency log, partner webhooks). */
  onChange(fn: (e: ChangeEvent) => void): void {
    this.listeners.push(fn);
  }
  private locks = new KeyedMutex();
  private verified = new Map<string, string>();
  private challenged = new Set<string>();

  constructor(private readonly pool: Pool, private readonly pepper: string) {}

  async init(): Promise<void> {
    for (const v of VERIFIED) {
      const n = normalizeIdentifier(v.type, v.value);
      if (!n.ok) throw new Error(`verified entry does not normalise: ${v.type} ${v.value}`);
      await this.pool.query(
        "INSERT INTO verified (ident_key, identifier_type, normalized, owner) VALUES ($1,$2,$3,$4) ON CONFLICT (ident_key) DO UPDATE SET owner = EXCLUDED.owner",
        [n.key, n.type, n.value, v.owner],
      );
    }
    const rows = await this.pool.query<{ ident_key: string; owner: string }>("SELECT ident_key, owner FROM verified");
    this.verified = new Map(rows.rows.map((r) => [r.ident_key, r.owner]));
    const ch = await this.pool.query<{ ident_key: string }>("SELECT DISTINCT ident_key FROM challenges WHERE status = 'under_review'");
    this.challenged = new Set(ch.rows.map((r) => r.ident_key));
  }

  verifiedOwner(identKey: string): string | null {
    return this.verified.get(identKey) ?? null;
  }

  isChallenged(identKey: string): boolean {
    return this.challenged.has(identKey);
  }

  challengedSet(): Set<string> {
    return new Set(this.challenged);
  }

  async submit(input: ReportInput): Promise<SubmitResult> {
    return this.locks.run(input.identKey, async () => {
      const reporterHash = hmacHex(this.pepper, "reporter", input.reporterId);
      // Anti-spoofing: hash the /24 network (not the individual address) and, separately, the broader /16 block.
      const nets = networkBuckets(input.ipPrefix);
      const ipHash = nets.p24 ? hmacHex(this.pepper, "ip", nets.p24) : null;
      const net16Hash = nets.p16 ? hmacHex(this.pepper, "net16", nets.p16) : null;

      const dup = await this.pool.query<{ ident_key: string; merged: boolean }>(
        "SELECT ident_key, merged FROM reports WHERE report_id = $1",
        [input.reportId],
      );
      if (dup.rows[0]) {
        // Same report_id sent twice: idempotent, nothing new is stored.
        const key = dup.rows[0].ident_key;
        return { kind: "created", reportId: input.reportId, caseId: caseIdFor(key), merged: dup.rows[0].merged, assessment: await this.assessment(key), duplicate: true };
      }

      // H. Rate limits by reporter_id, measured on the reports' own timestamps (the test tool loads everything
      // within seconds, so server arrival time would mean nothing).
      const rate = await this.pool.query<{ same: number; total: number }>(
        `SELECT count(*) FILTER (WHERE ident_key = $2)::int AS same, count(*)::int AS total
           FROM reports
          WHERE reporter_hash = $1
            AND reported_at > to_timestamp($3 / 1000.0) - make_interval(secs => $4 / 1000.0)
            AND reported_at < to_timestamp($3 / 1000.0) + make_interval(secs => $4 / 1000.0)`,
        [reporterHash, input.identKey, input.reportedAt, TRUST.rateWindowMs],
      );
      const r = rate.rows[0] ?? { same: 0, total: 0 };
      if (r.same >= TRUST.rateMaxSameIdentifier) return { kind: "rate_limited", retryAfterSec: 3600, reason: "same identifier reported too often" };
      if (r.total >= TRUST.rateMaxPerReporter) return { kind: "rate_limited", retryAfterSec: 3600, reason: "too many reports from this reporter" };

      const had = await this.pool.query<{ e: boolean }>("SELECT EXISTS (SELECT 1 FROM reports WHERE ident_key = $1) AS e", [input.identKey]);
      const merged = Boolean(had.rows[0]?.e);
      const nf = noteFeatures(input.note, this.pepper);

      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO identifiers (ident_key, identifier_type, normalized, case_id) VALUES ($1,$2,$3,$4) ON CONFLICT (ident_key) DO NOTHING",
          [input.identKey, input.identType, input.identValue, caseIdFor(input.identKey)],
        );
        const ins = await client.query(
          `INSERT INTO reports (report_id, ident_key, occurred_at, reported_at, reporter_hash, ip_hash, channel, scam_type, pincode,
                                note_len, note_hash, note_shingles, note_script, has_screenshot, lost_money, merged, loss_band, personal_dispute,
                                net16_hash, scam_type_source)
           VALUES ($1,$2,to_timestamp($3/1000.0),to_timestamp($4/1000.0),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           ON CONFLICT (report_id) DO NOTHING`,
          [input.reportId, input.identKey, input.occurredAt, input.reportedAt, reporterHash, ipHash, input.channel, input.scamType,
            input.pincode, nf.len, nf.hash, nf.shingles, nf.script, input.hasScreenshot, input.lostMoney, merged, input.lossBand,
            isPersonalDispute(input.note), net16Hash, input.scamTypeSource ?? "reporter"],
        );
        if (ins.rowCount === 0) {
          // Lost a race on report_id with a request for a different identifier: treat as the duplicate it is.
          await client.query("ROLLBACK");
          const k = (await this.pool.query<{ ident_key: string }>("SELECT ident_key FROM reports WHERE report_id = $1", [input.reportId])).rows[0]?.ident_key ?? input.identKey;
          return { kind: "created", reportId: input.reportId, caseId: caseIdFor(k), merged: true, assessment: await this.assessment(k) };
        }
        for (const other of (input.related ?? []).filter((k) => k !== input.identKey).slice(0, 5)) {
          const [a, b] = input.identKey < other ? [input.identKey, other] : [other, input.identKey];
          await client.query("INSERT INTO ident_links (a, b, report_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [a, b, input.reportId]);
        }
        const before = await this.assessment(input.identKey);
        const assessment = await this.reassess(client, input.identKey);
        await client.query("COMMIT");
        this.remember(input.identKey, assessment);
        const ev: ChangeEvent = { identKey: input.identKey, reportId: input.reportId, pincode: input.pincode, scamType: input.scamType, occurredAt: input.occurredAt, before, after: assessment };
        for (const fn of this.listeners) {
          try {
            fn(ev);
          } catch {
            /* a listener must never break a report */
          }
        }
        return { kind: "created", reportId: input.reportId, caseId: caseIdFor(input.identKey), merged, assessment };
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        this.cache.delete(input.identKey);
        throw e;
      } finally {
        client.release();
      }
    });
  }

  /** Recompute one identifier's verdict from its reports and store it, so lookups never aggregate. */
  private async reassess(client: Client, identKey: string): Promise<StoredAssessment> {
    const res = await client.query<ReportRow>(
      `SELECT report_id, reporter_hash, ip_hash, net16_hash,
              (extract(epoch FROM reported_at) * 1000)::float8 AS rep,
              (extract(epoch FROM occurred_at) * 1000)::float8 AS occ,
              note_len, note_hash, note_shingles, has_screenshot, lost_money, personal_dispute, scam_type, channel, pincode
         FROM reports WHERE ident_key = $1 ORDER BY reported_at DESC, id DESC LIMIT $2`,
      [identKey, TRUST.maxReportsAssessed],
    );
    const stats = await client.query<{ c: number; f: Date | null; l: Date | null }>(
      "SELECT count(*)::int AS c, min(occurred_at) AS f, max(occurred_at) AS l FROM reports WHERE ident_key = $1",
      [identKey],
    );
    const reports: TrustReport[] = res.rows.map((r) => ({
      reportId: r.report_id, reporterHash: r.reporter_hash, ipHash: r.ip_hash, net16Hash: r.net16_hash, reportedAt: r.rep, occurredAt: r.occ,
      noteLen: r.note_len, noteHash: r.note_hash, shingles: r.note_shingles, hasScreenshot: r.has_screenshot,
      lostMoney: r.lost_money, personalDispute: r.personal_dispute, scamType: r.scam_type, channel: r.channel, pincode: r.pincode,
    }));
    const reporters = [...new Set(reports.map((r) => r.reporterHash))];
    const hist = await client.query<{ h: string; other: boolean; corr: number; flg: number; lonely: number }>(
      `SELECT u.h,
              EXISTS (SELECT 1 FROM reports o WHERE o.reporter_hash = u.h AND o.ident_key <> $1) AS other,
              (SELECT count(*)::int FROM reporter_marks m WHERE m.reporter_hash = u.h AND m.ident_key <> $1 AND m.kind = 'corroborated') AS corr,
              (SELECT count(*)::int FROM reporter_marks m WHERE m.reporter_hash = u.h AND m.ident_key <> $1 AND m.kind = 'flagged') AS flg,
              (SELECT count(DISTINCT o.ident_key)::int FROM reports o JOIN identifiers i ON i.ident_key = o.ident_key
                 WHERE o.reporter_hash = u.h AND o.ident_key <> $1 AND COALESCE((i.assessment->>'credible_voices')::int, 0) <= 1) AS lonely
         FROM unnest($2::text[]) AS u(h)`,
      [identKey, reporters],
    );
    const histories = new Map<string, ReporterHistory>(
      hist.rows.map((h) => [h.h, { hasOtherReports: h.other, corroborated: h.corr, flagged: h.flg, lonely: h.lonely }]),
    );

    const result = assess(reports, histories);
    const isVerified = this.verified.has(identKey);
    // Reports about verified numbers never feed the map or alerts, and never move anyone's reputation.
    const countable = new Set(isVerified ? [] : result.countableReportIds);
    await client.query(
      `UPDATE reports AS r SET countable = v.c, flags = v.f
         FROM unnest($1::text[], $2::bool[], $3::text[]) AS v(id, c, f)
        WHERE r.report_id = v.id`,
      [reports.map((r) => r.reportId), reports.map((r) => countable.has(r.reportId)), reports.map((r) => (result.reportFlags.get(r.reportId) ?? []).join(","))],
    );
    await client.query("DELETE FROM reporter_marks WHERE ident_key = $1", [identKey]);
    if (!isVerified) {
      for (const [kind, list] of [["corroborated", result.corroboratedReporters], ["flagged", result.flaggedReporters]] as const) {
        if (list.length) {
          await client.query(
            "INSERT INTO reporter_marks (reporter_hash, ident_key, kind) SELECT h, $2, $3 FROM unnest($1::text[]) AS h ON CONFLICT DO NOTHING",
            [list, identKey, kind],
          );
        }
      }
    }

    const byId = new Map(reports.map((r) => [r.reportId, r]));
    const credibleReps = result.voices.filter((v) => v.credible).map((v) => byId.get(v.representative)).filter((r): r is TrustReport => Boolean(r));
    const typeCounts = new Map<string, number>();
    for (const r of credibleReps.length ? credibleReps : reports) typeCounts.set(r.scamType, (typeCounts.get(r.scamType) ?? 0) + 1);
    const scamType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    const evidence: Evidence[] = [...credibleReps]
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, 5)
      .map((r) => ({ occurred_at: formatIst(r.occurredAt), channel: r.channel, scam_type: r.scamType, pincode: r.pincode }));
    const st = stats.rows[0];
    const stored: StoredAssessment = {
      verdict: result.verdict,
      report_count: st?.c ?? reports.length,
      distinct_reporters: result.distinctReporters,
      credible_voices: result.credibleVoices,
      weight: result.weight,
      substance_voices: result.substanceVoices,
      flags: result.flags,
      first_seen: st?.f ? formatIst(st.f.getTime()) : null,
      last_seen: st?.l ? formatIst(st.l.getTime()) : null,
      scam_type: scamType,
      evidence,
      voice_pincodes: result.voices.filter((v) => countable.has(v.representative)).map((v) => byId.get(v.representative)?.pincode ?? "").filter(Boolean),
    };
    await client.query("UPDATE identifiers SET assessment = $2, updated_at = now() WHERE ident_key = $1", [identKey, JSON.stringify(stored)]);
    return stored;
  }

  private remember(key: string, a: StoredAssessment | null): void {
    if (this.cache.size >= MAX_CACHE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, a);
  }

  /** Synchronous peek at the cache (null if not loaded yet). */
  cachedAssessment(identKey: string): StoredAssessment | null {
    return this.cache.get(identKey) ?? null;
  }

  /** One in-memory read in the common case; one primary-key read otherwise. */
  async assessment(identKey: string): Promise<StoredAssessment | null> {
    if (this.cache.has(identKey)) return this.cache.get(identKey) ?? null;
    const r = await this.pool.query<{ assessment: StoredAssessment | null }>("SELECT assessment FROM identifiers WHERE ident_key = $1", [identKey]);
    const a = r.rows[0]?.assessment ?? null;
    this.remember(identKey, a);
    return a;
  }

  async challenge(identKey: string, claimant: string | null, email: string | null, proof: string | null): Promise<string> {
    const id = randomId("ch");
    await this.pool.query(
      "INSERT INTO challenges (challenge_id, ident_key, claimant_name, contact_email, proof_note) VALUES ($1,$2,$3,$4,$5)",
      [id, identKey, claimant, email, proof],
    );
    this.challenged.add(identKey);
    return id;
  }

  /** Countable reports (one per independent person per identifier, fakes excluded) since a time. */
  /** Trust-rule outcome for one stored report (for the live "attack blocked" feed). */
  async reportState(reportId: string): Promise<{ countable: boolean; flags: string[] } | null> {
    const r = await this.pool.query<{ countable: boolean; flags: string | null }>("SELECT countable, flags FROM reports WHERE report_id = $1", [reportId]);
    const row = r.rows[0];
    return row ? { countable: row.countable, flags: (row.flags ?? "").split(",").filter(Boolean) } : null;
  }

  async countableRows(sinceMs: number, pincodes: readonly string[] | null): Promise<CountableRow[]> {
    const params: Array<number | string[]> = [sinceMs];
    let where = "countable AND occurred_at > to_timestamp($1 / 1000.0)";
    if (pincodes) {
      params.push([...pincodes]);
      where += " AND pincode = ANY($2::text[])";
    }
    const r = await this.pool.query<{ pincode: string; scam_type: string; occ: number }>(
      `SELECT pincode, scam_type, (extract(epoch FROM occurred_at) * 1000)::float8 AS occ FROM reports WHERE ${where}`,
      params,
    );
    return r.rows.map((x) => ({ pincode: x.pincode, scamType: x.scam_type, occurredAt: x.occ }));
  }

  /** Counts a rejected or slowed-down report by day and reason only (no identifiers), for the insights page. */
  recordRejection(reason: RejectReason): void {
    this.pool
      .query(
        `INSERT INTO ingest_stats (day, reason, count) VALUES ((now() AT TIME ZONE 'Asia/Kolkata')::date, $1, 1)
         ON CONFLICT (day, reason) DO UPDATE SET count = ingest_stats.count + 1`,
        [reason],
      )
      .catch(() => undefined);
  }

  verifiedKeys(): string[] {
    return [...this.verified.keys()];
  }

  get db(): Pool {
    return this.pool;
  }

  /** Deletes every report and everything derived from them. Licence, clock and verified list survive. */
  async reset(): Promise<void> {
    await this.pool.query("TRUNCATE reports, identifiers, reporter_marks, challenges, ingest_stats, rollup_hourly, tenant_hits, webhook_deliveries, ident_links, verdict_log RESTART IDENTITY");
    this.cache.clear();
    this.challenged.clear();
  }

  /**
   * How the trust rules grouped one identifier's reports into people, for the Explain view. Contains no reporter,
   * network or note data: only relative times, group membership and the rule flags.
   */
  async explain(identKey: string, now: number): Promise<ExplainData | null> {
    const res = await this.pool.query<ReportRow>(
      `SELECT report_id, reporter_hash, ip_hash, net16_hash,
              (extract(epoch FROM reported_at) * 1000)::float8 AS rep,
              (extract(epoch FROM occurred_at) * 1000)::float8 AS occ,
              note_len, note_hash, note_shingles, has_screenshot, lost_money, personal_dispute, scam_type, channel, pincode
         FROM reports WHERE ident_key = $1 ORDER BY reported_at DESC, id DESC LIMIT $2`,
      [identKey, TRUST.maxReportsAssessed],
    );
    if (res.rows.length < 2) return null;
    const reports: TrustReport[] = res.rows.map((r) => ({
      reportId: r.report_id, reporterHash: r.reporter_hash, ipHash: r.ip_hash, net16Hash: r.net16_hash, reportedAt: r.rep, occurredAt: r.occ,
      noteLen: r.note_len, noteHash: r.note_hash, shingles: r.note_shingles, hasScreenshot: r.has_screenshot,
      lostMoney: r.lost_money, personalDispute: r.personal_dispute, scamType: r.scam_type, channel: r.channel, pincode: r.pincode,
    }));
    const result = assess(reports, new Map());
    const voiceOf = new Map<string, number>();
    result.voices.forEach((v, i) => v.members.forEach((m) => voiceOf.set(m, i)));
    const stored = await this.assessment(identKey);
    return {
      raw: reports.length,
      people: stored?.distinct_reporters ?? result.distinctReporters,
      credible: stored?.credible_voices ?? result.credibleVoices,
      reports: reports
        .sort((a, b) => a.reportedAt - b.reportedAt)
        .map((r) => ({
          // Whole hours only: enough to show a burst, too coarse to point at any one reporter.
          hours_ago: Math.max(0, Math.round((now - r.reportedAt) / 3_600_000)),
          voice: voiceOf.get(r.reportId) ?? -1,
          flags: result.reportFlags.get(r.reportId) ?? [],
          has_note: r.noteLen > 0,
          evidence: r.hasScreenshot || r.lostMoney,
        })),
      voices: result.voices.map((v, i) => ({ index: i, size: v.members.length, accounts: v.reporters.length, credible: v.credible, countable: v.countable, weight: v.weight, flags: v.flags })),
    };
  }

  /**
   * The local AI read a report's note and found a better scam type than the automatic one. Only reports whose type
   * was NOT chosen by the reporter can change. Re-assesses the identifier so the map, alerts and lookups follow.
   */
  async reclassify(reportId: string, scamType: string): Promise<{ identKey: string; pincode: string; from: string; changed: boolean } | null> {
    const row = (await this.pool.query<{ ident_key: string; pincode: string; scam_type: string; src: string }>(
      "SELECT ident_key, pincode, scam_type, scam_type_source AS src FROM reports WHERE report_id = $1",
      [reportId],
    )).rows[0];
    if (!row || (row.src !== "rules" && row.src !== "default")) return null;
    if (row.scam_type === scamType) {
      // The local AI agrees with the rules: only record that it confirmed the type.
      await this.pool.query("UPDATE reports SET scam_type_source = 'local_ai' WHERE report_id = $1 AND scam_type_source IN ('rules', 'default')", [reportId]);
      return { identKey: row.ident_key, pincode: row.pincode, from: row.scam_type, changed: false };
    }
    return this.locks.run(row.ident_key, async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const upd = await client.query(
          "UPDATE reports SET scam_type = $1, scam_type_source = 'local_ai' WHERE report_id = $2 AND scam_type_source IN ('rules', 'default')",
          [scamType, reportId],
        );
        if (upd.rowCount === 0) {
          await client.query("ROLLBACK");
          return null;
        }
        const assessment = await this.reassess(client, row.ident_key);
        await client.query("COMMIT");
        this.remember(row.ident_key, assessment);
        return { identKey: row.ident_key, pincode: row.pincode, from: row.scam_type, changed: true };
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        this.cache.delete(row.ident_key);
        throw e;
      } finally {
        client.release();
      }
    });
  }

  /** How scam types were filled in, for the safety panel. */
  async typeSources(): Promise<Record<string, number>> {
    const rows = (await this.pool.query<{ src: string; c: number }>("SELECT scam_type_source AS src, count(*)::int AS c FROM reports GROUP BY 1")).rows;
    return Object.fromEntries(rows.map((r) => [r.src, r.c]));
  }

  /** Privacy: network hashes are only needed for a short time; drop them after 30 days. */
  async expireNetworkHashes(): Promise<number> {
    const r = await this.pool.query("UPDATE reports SET ip_hash = NULL, net16_hash = NULL WHERE (ip_hash IS NOT NULL OR net16_hash IS NOT NULL) AND reported_at < now() - interval '30 days'");
    return r.rowCount ?? 0;
  }
}
