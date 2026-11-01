// Aggregated, privacy-safe analytics for the insights dashboard. Only counts by day, area, type, channel and
// trust outcome; the only identifiers ever listed are numbers already confirmed by 3+ unrelated people.
import { AREAS, AREA_BY_PIN } from "../../shared/areas.js";
import { maskValue, type IdentifierType } from "../../shared/normalize.js";
import type { Pool } from "../db/db.js";
import { computeAlerts, type CountableRow } from "../alerts/alerts.js";
import { DAY } from "../lib/time.js";
import { TRUST } from "../trust/config.js";
import type { Briefing } from "../ai/assist.js";
import type { StoredAssessment } from "./view.js";

export interface Stats {
  window_days: number;
  generated_at: string;
  scope: { pincode: string | null; city: string | null };
  totals: {
    received: number;
    counted: number;
    merged: number;
    set_aside: number;
    rejected: number;
    rate_limited: number;
    identifiers: number;
    known_scams: number;
    suspicious: number;
    awaiting: number;
    areas_active: number;
    active_alerts: number;
    lost_money_reports: number;
    counted_prev: number;
  };
  daily: Array<{ day: string; counted: number; set_aside: number }>;
  by_type: Array<{ key: string; count: number }>;
  by_channel: Array<{ key: string; count: number }>;
  by_area: Array<{ pincode: string; locality: string; city: string; count: number; prev: number; top_scam_type: string; lat: number; lng: number }>;
  hour_weekday: number[][];
  report_delay: Array<{ key: string; count: number }>;
  languages: Array<{ key: string; count: number }>;
  loss: Array<{ key: string; count: number }>;
  set_aside_reasons: Array<{ key: string; count: number }>;
  rejections: Array<{ key: string; count: number }>;
  top_identifiers: Array<{ type: string; display_value: string; people: number; scam_type: string | null; challenged: boolean }>;
}

const SET_ASIDE_REASONS: Array<[string, string]> = [
  ["coordinated_burst", "COORDINATED_BURST"],
  ["sybil_ring", "SYBIL_RING"],
  ["copy_paste", "COPY_PASTE_NOTES"],
  ["repeat_reporter", "SPAM_REPEAT"],
  ["personal_dispute", "PERSONAL_DISPUTE"],
];

export async function computeStats(pool: Pool, opts: { days: number; pincode: string | null; city: string | null; verified: string[]; challenged: Set<string>; now: number }): Promise<Stats> {
  const { days, now } = opts;
  const pins = opts.pincode ? [opts.pincode] : opts.city ? AREAS.filter((a) => a.city.toLowerCase() === opts.city!.toLowerCase()).map((a) => a.pincode) : AREAS.map((a) => a.pincode);
  const from = now - days * DAY;
  const prevFrom = now - 2 * days * DAY;
  const P3 = [from / 1000, now / 1000 + 600, pins];
  const P = [...P3, opts.verified];
  const base = `occurred_at > to_timestamp($1) AND occurred_at <= to_timestamp($2) AND pincode = ANY($3::text[])`;
  // A report is "set aside" when the trust rules excluded it for a reason other than being a repeat of a person
  // already counted (same reporter, same network): those are "merged".
  const setAside = `(NOT countable AND (flags ~ 'COORDINATED_BURST|SYBIL_RING|COPY_PASTE_NOTES|SPAM_REPEAT|PERSONAL_DISPUTE' OR ident_key = ANY($4::text[])))`;

  const [tot, daily, types, channels, areas, prevAreas, heat, delay, langs, loss, reasons, rej, idents, alertRows] = await Promise.all([
    pool.query<{ received: number; counted: number; set_aside: number; lost: number }>(
      `SELECT count(*)::int AS received, count(*) FILTER (WHERE countable)::int AS counted,
              count(*) FILTER (WHERE ${setAside})::int AS set_aside, count(*) FILTER (WHERE countable AND lost_money)::int AS lost
         FROM reports WHERE ${base}`, P),
    pool.query<{ day: string; counted: number; set_aside: number }>(
      `SELECT to_char((occurred_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day,
              count(*) FILTER (WHERE countable)::int AS counted, count(*) FILTER (WHERE ${setAside})::int AS set_aside
         FROM reports WHERE ${base} GROUP BY 1 ORDER BY 1`, P),
    pool.query<{ key: string; count: number }>(`SELECT scam_type AS key, count(*)::int AS count FROM reports WHERE ${base} AND countable GROUP BY 1 ORDER BY 2 DESC`, P3),
    pool.query<{ key: string; count: number }>(`SELECT channel AS key, count(*)::int AS count FROM reports WHERE ${base} AND countable GROUP BY 1 ORDER BY 2 DESC`, P3),
    pool.query<{ pincode: string; count: number; top: string }>(
      `SELECT pincode, count(*)::int AS count, mode() WITHIN GROUP (ORDER BY scam_type) AS top
         FROM reports WHERE ${base} AND countable GROUP BY 1 ORDER BY 2 DESC`, P3),
    pool.query<{ pincode: string; count: number }>(
      `SELECT pincode, count(*)::int AS count FROM reports
        WHERE occurred_at > to_timestamp($1) AND occurred_at <= to_timestamp($2) AND pincode = ANY($3::text[]) AND countable GROUP BY 1`,
      [prevFrom / 1000, from / 1000, pins]),
    pool.query<{ dow: number; hr: number; count: number }>(
      `SELECT extract(isodow FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int AS dow, extract(hour FROM occurred_at AT TIME ZONE 'Asia/Kolkata')::int AS hr,
              count(*)::int AS count FROM reports WHERE ${base} AND countable GROUP BY 1, 2`, P3),
    pool.query<{ key: string; count: number }>(
      `SELECT CASE WHEN d < 3600 THEN 'under_1h' WHEN d < 6*3600 THEN '1_6h' WHEN d < 86400 THEN '6_24h' WHEN d < 3*86400 THEN '1_3d' ELSE 'over_3d' END AS key,
              count(*)::int AS count
         FROM (SELECT extract(epoch FROM reported_at - occurred_at) AS d FROM reports WHERE ${base} AND countable) x GROUP BY 1`, P3),
    pool.query<{ key: string; count: number }>(`SELECT note_script AS key, count(*)::int AS count FROM reports WHERE ${base} AND countable GROUP BY 1`, P3),
    pool.query<{ key: number; count: number }>(`SELECT loss_band AS key, count(*)::int AS count FROM reports WHERE ${base} AND countable GROUP BY 1`, P3),
    pool.query<Record<string, number>>(
      `SELECT ${SET_ASIDE_REASONS.map(([k, f]) => `count(*) FILTER (WHERE NOT countable AND flags LIKE '%${f}%')::int AS ${k}`).join(", ")},
              count(*) FILTER (WHERE NOT countable AND ident_key = ANY($4::text[]))::int AS verified_target
         FROM reports WHERE ${base}`, P),
    pool.query<{ key: string; count: number }>(
      `SELECT reason AS key, sum(count)::int AS count FROM ingest_stats WHERE day > (to_timestamp($1) AT TIME ZONE 'Asia/Kolkata')::date - 1 GROUP BY 1 ORDER BY 2 DESC`, [from / 1000]),
    pool.query<{ ident_key: string; identifier_type: string; normalized: string; assessment: StoredAssessment | null }>(
      `SELECT i.ident_key, i.identifier_type, i.normalized, i.assessment FROM identifiers i
        WHERE EXISTS (SELECT 1 FROM reports r WHERE r.ident_key = i.ident_key AND r.occurred_at > to_timestamp($1) AND r.pincode = ANY($2::text[]))`,
      [from / 1000, pins]),
    pool.query<{ pincode: string; scam_type: string; occ: number }>(
      `SELECT pincode, scam_type, (extract(epoch FROM occurred_at) * 1000)::float8 AS occ FROM reports
        WHERE countable AND occurred_at > to_timestamp($1) AND pincode = ANY($2::text[])`,
      [(now - 32 * DAY) / 1000, pins]),
  ]);

  const prevMap = new Map(prevAreas.rows.map((r) => [r.pincode, r.count]));
  const heatGrid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const h of heat.rows) heatGrid[(h.dow - 1 + 7) % 7]![h.hr] = h.count;

  // Fill missing days so the trend has no gaps.
  const dayMap = new Map(daily.rows.map((d) => [d.day, d]));
  const series: Stats["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY + 330 * 60_000).toISOString().slice(0, 10);
    const row = dayMap.get(d);
    series.push({ day: d, counted: row?.counted ?? 0, set_aside: row?.set_aside ?? 0 });
  }

  let known = 0;
  let suspicious = 0;
  let awaiting = 0;
  const top: Stats["top_identifiers"] = [];
  for (const r of idents.rows) {
    const a = r.assessment;
    if (!a || opts.verified.includes(r.ident_key)) continue;
    if (a.verdict === "KNOWN_SCAM" && !opts.challenged.has(r.ident_key)) {
      known++;
      top.push({ type: r.identifier_type, display_value: a.credible_voices >= TRUST.knownScamMinVoices ? r.normalized : maskValue(r.identifier_type as IdentifierType, r.normalized), people: a.distinct_reporters, scam_type: a.scam_type, challenged: false });
    } else if (a.credible_voices >= TRUST.suspiciousMinVoices) suspicious++;
    else awaiting++;
  }
  top.sort((x, y) => y.people - x.people);

  const countable: CountableRow[] = alertRows.rows.map((x) => ({ pincode: x.pincode, scamType: x.scam_type, occurredAt: x.occ }));
  const activeAlerts = pins.reduce((n, p) => n + computeAlerts(countable, p, now).length, 0);
  const t = tot.rows[0] ?? { received: 0, counted: 0, set_aside: 0, lost: 0 };
  const rejections = rej.rows;
  const rejected = rejections.filter((r) => r.key !== "rate_limited").reduce((s, r) => s + r.count, 0);
  const rateLimited = rejections.find((r) => r.key === "rate_limited")?.count ?? 0;
  const reasonRow = reasons.rows[0] ?? {};
  const lossLabels = ["none", "under_10k", "10k_1l", "over_1l"];

  return {
    window_days: days,
    generated_at: new Date(now).toISOString(),
    scope: { pincode: opts.pincode, city: opts.city },
    totals: {
      received: t.received + rejected,
      counted: t.counted,
      merged: Math.max(0, t.received - t.counted - t.set_aside),
      set_aside: t.set_aside,
      rejected,
      rate_limited: rateLimited,
      identifiers: idents.rows.length,
      known_scams: known,
      suspicious,
      awaiting,
      areas_active: areas.rows.length,
      active_alerts: activeAlerts,
      lost_money_reports: t.lost,
      counted_prev: prevAreas.rows.reduce((s, r) => s + r.count, 0),
    },
    daily: series,
    by_type: types.rows,
    by_channel: channels.rows,
    by_area: areas.rows.map((r) => {
      const a = AREA_BY_PIN.get(r.pincode);
      return { pincode: r.pincode, locality: a?.locality ?? r.pincode, city: a?.city ?? "", count: r.count, prev: prevMap.get(r.pincode) ?? 0, top_scam_type: r.top, lat: a?.lat ?? 0, lng: a?.lng ?? 0 };
    }),
    hour_weekday: heatGrid,
    report_delay: ["under_1h", "1_6h", "6_24h", "1_3d", "over_3d"].map((k) => ({ key: k, count: delay.rows.find((d) => d.key === k)?.count ?? 0 })),
    languages: ["deva", "latn", "mixed", "none"].map((k) => ({ key: k, count: langs.rows.find((l) => l.key === k)?.count ?? 0 })),
    loss: lossLabels.map((k, i) => ({ key: k, count: loss.rows.find((l) => Number(l.key) === i)?.count ?? 0 })),
    set_aside_reasons: [...SET_ASIDE_REASONS.map(([k]) => ({ key: k, count: Number(reasonRow[k] ?? 0) })), { key: "verified_target", count: Number(reasonRow.verified_target ?? 0) }],
    rejections,
    top_identifiers: top.slice(0, 8),
  };
}

/** Plain-language summary used when Gemini is not configured (and as Gemini's input check). */
export function ruleBriefing(s: Stats, label: string): Briefing {
  const t = s.totals;
  const insights: Briefing["insights"] = [];
  const topArea = [...s.by_area].sort((a, b) => b.count - a.count)[0];
  const rising = [...s.by_area].filter((a) => a.count >= 5).sort((a, b) => b.count / Math.max(1, b.prev) - a.count / Math.max(1, a.prev))[0];
  const topType = s.by_type[0];
  const change = t.counted_prev ? Math.round(((t.counted - t.counted_prev) / t.counted_prev) * 100) : null;
  if (topType) insights.push({ en: `${prettyType(topType.key)} is the most reported scam, with ${topType.count} reports.`, hi: `सबसे ज़्यादा रिपोर्ट ${topType.key} की हैं: ${topType.count}।` });
  if (rising && rising.count > rising.prev) insights.push({ en: `${rising.locality} saw ${rising.count} reports, up from ${rising.prev} in the period before.`, hi: `${rising.locality} में ${rising.count} रिपोर्ट, पिछली अवधि में ${rising.prev}।` });
  else if (topArea) insights.push({ en: `${topArea.locality} has the most reports (${topArea.count}).`, hi: `${topArea.locality} में सबसे ज़्यादा रिपोर्ट (${topArea.count})।` });
  if (t.set_aside + t.rejected > 0) insights.push({ en: `${t.set_aside} reports were set aside as coordinated or repeated, and ${t.rejected} junk reports were rejected.`, hi: `${t.set_aside} रिपोर्ट मिलीभगत या दोहराव के कारण अलग रखी गईं, ${t.rejected} बेकार रिपोर्ट अस्वीकार हुईं।` });
  const fast = s.report_delay.find((d) => d.key === "under_1h")?.count ?? 0;
  if (t.counted) insights.push({ en: `${Math.round((fast / t.counted) * 100)}% of people reported within an hour. Reporting money loss to 1930 within hours helps freeze it.`, hi: `${Math.round((fast / t.counted) * 100)}% लोगों ने एक घंटे में रिपोर्ट की। पैसे गए हों तो कुछ घंटों में 1930 पर बताने से पैसा रोका जा सकता है।` });
  return {
    source: "rules",
    headline_en: change === null ? `${t.counted} trusted reports in ${label} over the last ${s.window_days} days.` : `${t.counted} trusted reports in ${label}, ${change >= 0 ? "up" : "down"} ${Math.abs(change)}% on the previous ${s.window_days} days.`,
    headline_hi: change === null ? `पिछले ${s.window_days} दिनों में ${label} में ${t.counted} भरोसेमंद रिपोर्ट।` : `${label} में ${t.counted} भरोसेमंद रिपोर्ट, पिछले ${s.window_days} दिनों से ${Math.abs(change)}% ${change >= 0 ? "ज़्यादा" : "कम"}।`,
    insights: insights.slice(0, 4),
  };
}

function prettyType(slug: string): string {
  return slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
