// SPIKE and NEW_TYPE exactly as Appendix A defines them, plus map clustering. Pure functions over
// "countable" reports only (one per independent person per identifier, fakes excluded).
import { AREA_BY_PIN, areasWithin, type Area } from "../../shared/areas.js";
import { SCAM_TYPE_BY_SLUG } from "../../shared/scamTypes.js";
import { DAY } from "../lib/time.js";

export interface CountableRow {
  pincode: string;
  scamType: string;
  occurredAt: number;
}

export interface SpikeAlert {
  type: "SPIKE";
  pincode: string;
  window: "24h";
  count: number;
  baseline_per_day: number;
  locality: string;
  message_en: string;
  message_hi: string;
}

export interface NewTypeAlert {
  type: "NEW_TYPE";
  pincode: string;
  scam_type: string;
  window: "24h";
  count: number;
  locality: string;
  message_en: string;
  message_hi: string;
}

export type Alert = SpikeAlert | NewTypeAlert;

/** Reports up to 10 minutes "in the future" are accepted (clock skew) and count as now. */
export const FUTURE_SKEW_MS = 10 * 60_000;

const round2 = (x: number): number => Math.round(x * 100) / 100;

export function computeAlerts(rows: readonly CountableRow[], pincode: string, now: number): Alert[] {
  const area = AREA_BY_PIN.get(pincode);
  const loc = area?.locality ?? pincode;
  const locHi = area?.localityHi ?? pincode;
  const here = rows.filter((r) => r.pincode === pincode);
  const last24 = here.filter((r) => r.occurredAt > now - DAY && r.occurredAt <= now + FUTURE_SKEW_MS);
  const prior7 = here.filter((r) => r.occurredAt > now - 8 * DAY && r.occurredAt <= now - DAY);
  const baseline = prior7.length / 7;
  const alerts: Alert[] = [];

  // SPIKE: last 24 h is at least double the daily average of the 7 days before, and at least 5.
  if (last24.length >= 5 && last24.length >= 2 * baseline) {
    alerts.push({
      type: "SPIKE", pincode, window: "24h", count: last24.length, baseline_per_day: round2(baseline), locality: loc,
      message_en: baseline === 0
        ? `Scam reports in ${loc} jumped: ${last24.length} in the last 24 hours, none in the week before.`
        : `Scam reports in ${loc} jumped: ${last24.length} in the last 24 hours vs about ${round2(baseline)} a day before.`,
      message_hi: baseline === 0
        ? `${locHi} में स्कैम रिपोर्ट अचानक बढ़ीं: पिछले 24 घंटे में ${last24.length}, जबकि पिछले हफ़्ते एक भी नहीं।`
        : `${locHi} में स्कैम रिपोर्ट अचानक बढ़ीं: पिछले 24 घंटे में ${last24.length}, पहले लगभग ${round2(baseline)} रोज़।`,
    });
  }

  // NEW_TYPE: a type seen in the last 24 h that was not seen in this area in the 30 days before.
  const counts = new Map<string, number>();
  for (const r of last24) counts.set(r.scamType, (counts.get(r.scamType) ?? 0) + 1);
  const before = new Set(
    here.filter((r) => r.occurredAt > now - DAY - 30 * DAY && r.occurredAt <= now - DAY).map((r) => r.scamType),
  );
  for (const [scamType, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    if (before.has(scamType)) continue;
    const info = SCAM_TYPE_BY_SLUG.get(scamType);
    alerts.push({
      type: "NEW_TYPE", pincode, scam_type: scamType, window: "24h", count, locality: loc,
      message_en: `New kind of scam reported in ${loc}: ${info?.en ?? scamType}.`,
      message_hi: `${locHi} में नए तरह का स्कैम: ${info?.hi ?? scamType}।`,
    });
  }
  return alerts;
}

export type Severity = "CRIT" | "HIGH" | "MED";

export interface Cluster {
  pincode: string;
  locality: string;
  city: string;
  count: number;
  top_scam_type: string;
  severity: Severity;
  lat: number;
  lng: number;
  spike: boolean;
}

/** Severity scale (README): CRIT if a SPIKE is active or 10+ reports, HIGH if 5+, otherwise MED. */
export function severityFor(count: number, spike: boolean): Severity {
  if (spike || count >= 10) return "CRIT";
  if (count >= 5) return "HIGH";
  return "MED";
}

function topType(rows: readonly CountableRow[]): string {
  const c = new Map<string, number>();
  for (const r of rows) c.set(r.scamType, (c.get(r.scamType) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "other";
}

export function computeClusters(
  rows: readonly CountableRow[],
  areas: readonly Area[],
  days: number,
  now: number,
): Cluster[] {
  const clusters: Cluster[] = [];
  for (const a of areas) {
    const inWin = rows.filter((r) => r.pincode === a.pincode && r.occurredAt > now - days * DAY && r.occurredAt <= now + FUTURE_SKEW_MS);
    if (inWin.length === 0) continue;
    const spike = computeAlerts(rows, a.pincode, now).some((x) => x.type === "SPIKE");
    clusters.push({
      pincode: a.pincode, locality: a.locality, city: a.city, count: inWin.length, top_scam_type: topType(inWin),
      severity: severityFor(inWin.length, spike), lat: a.lat, lng: a.lng, spike,
    });
  }
  return clusters.sort((x, y) => y.count - x.count);
}

export { areasWithin };
