// Strict ISO-8601 parsing. Date.parse() alone accepts "2026-02-30" by rolling it into March, so we round-trip check.
const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?$/i;

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Returns epoch milliseconds, or null when the text is not a real date-time. Missing offset means IST. */
export function parseIsoTime(input: unknown): number | null {
  if (typeof input !== "string") return null;
  const m = ISO.exec(input.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "0", frac = "0", tz = "+05:30"] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  let offsetMin = 0;
  if (tz.toUpperCase() !== "Z") {
    const sign = tz.startsWith("-") ? -1 : 1;
    const digits = tz.slice(1).replace(":", "");
    offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  }
  const ms = Number(`0.${frac}`) * 1000;
  return Date.UTC(year, month - 1, day, hour, minute, second, Math.floor(ms)) - offsetMin * 60_000;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** Format as 2026-10-27T18:21:04+05:30, the style the brief uses everywhere. */
export function formatIst(ms: number): string {
  const d = new Date(ms + 330 * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}:${pad(d.getUTCSeconds())}+05:30`;
}
