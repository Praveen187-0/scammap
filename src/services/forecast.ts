// Pace and short-term forecast per area, from countable reports only (fakes never feed it).
// Deliberately simple and explainable: Holt's linear smoothing on daily counts, blended with the last 6 hours'
// pace, and "at this pace, when does this area reach the SPIKE alert level?" using the exact Appendix A rule.
import { AREAS } from "../../shared/areas.js";
import type { CountableRow } from "../alerts/alerts.js";
import { DAY } from "../lib/time.js";

const HOUR = 3_600_000;
const IST = 330 * 60_000;

export type Trend = "rising_fast" | "rising" | "steady" | "cooling" | "quiet";

export interface AreaForecast {
  pincode: string;
  locality: string;
  locality_hi: string;
  city: string;
  lat: number;
  lng: number;
  last24: number;
  baseline_per_day: number;
  pace_per_hour: number;
  next24: number;
  trend: Trend;
  spike_now: boolean;
  alert_level: number;
  eta_hours: number | null;
  daily: number[];
  top_type: string | null;
}

export interface Forecast {
  generated_at: string;
  method: string;
  total_last24: number;
  total_next24: number;
  areas: AreaForecast[];
  hourly: Array<{ at: string; expected: number; actual_week_avg: number }>;
  types: Array<{ scam_type: string; last3d: number; prev_avg3d: number; change_pct: number | null }>;
}

export function holt(series: readonly number[], alpha = 0.5, beta = 0.3): number {
  if (!series.length) return 0;
  if (series.length === 1) return series[0]!;
  let level = series[0]!;
  let trend = series[1]! - series[0]!;
  for (let i = 1; i < series.length; i++) {
    const prev = level;
    level = alpha * series[i]! + (1 - alpha) * (level + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
  }
  return Math.max(0, level + trend);
}

const r1 = (x: number): number => Math.round(x * 10) / 10;

export function computeForecast(rows: readonly CountableRow[], now: number): Forecast {
  const byPin = new Map<string, CountableRow[]>();
  for (const r of rows) if (r.occurredAt <= now + 10 * 60_000) byPin.set(r.pincode, [...(byPin.get(r.pincode) ?? []), r]);

  const areas: AreaForecast[] = AREAS.map((a) => {
    const here = byPin.get(a.pincode) ?? [];
    const daily = Array.from({ length: 8 }, (_, k) => here.filter((r) => r.occurredAt > now - (8 - k) * DAY && r.occurredAt <= now - (7 - k) * DAY + (k === 7 ? 10 * 60_000 : 0)).length);
    const last24 = daily[7]!;
    const baseline = daily.slice(0, 7).reduce((s, x) => s + x, 0) / 7;
    const last6 = here.filter((r) => r.occurredAt > now - 6 * HOUR).length;
    const pace = last6 / 6;
    const next24 = Math.round(0.6 * holt(daily) + 0.4 * pace * 24);
    const level = Math.max(5, Math.ceil(2 * baseline));
    const spikeNow = last24 >= 5 && last24 >= 2 * baseline;
    // Trend compares a projected day (half the last 6 hours' pace, half the last 24 h) with the usual day, and
    // needs a few reports before it says anything: one report is not a trend.
    const projected = 0.5 * last6 * 4 + 0.5 * last24;
    const ratio = (projected + 1) / (baseline + 1);
    const trend: Trend = last24 === 0 && baseline < 0.5 ? "quiet"
      : ratio >= 2 && last24 >= 5 ? "rising_fast"
      : ratio >= 1.3 && last24 >= 3 ? "rising"
      : ratio <= 0.6 && baseline >= 1 ? "cooling" : "steady";
    // "At this pace": only when at least 2 reports arrived in the last 6 hours.
    const eta = spikeNow ? 0 : last6 >= 2 ? (level - last24) / pace : null;
    const types = new Map<string, number>();
    for (const r of here) if (r.occurredAt > now - 7 * DAY) types.set(r.scamType, (types.get(r.scamType) ?? 0) + 1);
    return {
      pincode: a.pincode, locality: a.locality, locality_hi: a.localityHi, city: a.city, lat: a.lat, lng: a.lng,
      last24, baseline_per_day: r1(baseline), pace_per_hour: r1(pace), next24, trend, spike_now: spikeNow, alert_level: level,
      eta_hours: eta === null || eta > 72 ? null : r1(eta), daily: daily.slice(1),
      top_type: [...types.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
    };
  });
  const rank = (f: AreaForecast): number => (f.spike_now ? 1e6 : 0) + (f.eta_hours !== null ? 1e4 - f.eta_hours * 100 : 0) + f.next24;
  areas.sort((x, y) => rank(y) - rank(x));

  // Next 24 clock hours: the average for the same hour over the last 7 days, scaled by how busy today is.
  const recent = rows.filter((r) => r.occurredAt > now - 8 * DAY && r.occurredAt <= now + 10 * 60_000);
  const last24All = recent.filter((r) => r.occurredAt > now - DAY).length;
  const prior7 = recent.filter((r) => r.occurredAt <= now - DAY).length / 7;
  const factor = Math.min(2.5, Math.max(0.5, (last24All + 1) / (prior7 + 1)));
  const perHour = new Array<number>(24).fill(0);
  for (const r of recent) if (r.occurredAt <= now - DAY) perHour[Math.floor(((r.occurredAt + IST) % DAY) / HOUR)]!++;
  const startHour = Math.floor(now / HOUR) * HOUR + HOUR;
  const hourly = Array.from({ length: 24 }, (_, k) => {
    const at = startHour + k * HOUR;
    const h = Math.floor(((at + IST) % DAY) / HOUR);
    const avg = perHour[h]! / 7;
    return { at: new Date(at).toISOString(), expected: r1(avg * factor), actual_week_avg: r1(avg) };
  });

  const types = new Map<string, { last3d: number; prev: number }>();
  for (const r of rows) {
    const e = types.get(r.scamType) ?? { last3d: 0, prev: 0 };
    if (r.occurredAt > now - 3 * DAY) e.last3d++;
    else if (r.occurredAt > now - 15 * DAY) e.prev++;
    types.set(r.scamType, e);
  }
  const typeList = [...types.entries()]
    .map(([t, e]) => {
      const prevAvg = (e.prev / 12) * 3;
      return { scam_type: t, last3d: e.last3d, prev_avg3d: r1(prevAvg), change_pct: prevAvg > 0 ? Math.round(((e.last3d - prevAvg) / prevAvg) * 100) : null };
    })
    .filter((t) => t.last3d >= 3)
    .sort((a, b) => (b.change_pct ?? 999) - (a.change_pct ?? 999))
    .slice(0, 6);

  return {
    generated_at: new Date(now).toISOString(),
    method: "Holt linear smoothing on 8 daily counts, blended 60/40 with the last 6 hours' pace. Alert level = the SPIKE rule (5+ and 2x the 7-day average).",
    total_last24: last24All,
    total_next24: Math.round(areas.reduce((s, a) => s + a.next24, 0)),
    areas,
    hourly,
    types: typeList,
  };
}
