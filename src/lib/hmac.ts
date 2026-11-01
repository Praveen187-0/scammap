import { createHash, createHmac, randomBytes } from "node:crypto";

// Reporter IDs and IP prefixes are stored only as keyed hashes. The label separates the namespaces so a
// reporter_id can never collide with an ip_prefix that happens to have the same text.
export function hmacHex(pepper: string, label: string, value: string): string {
  return createHmac("sha256", pepper).update(`${label}\u0000${value}`).digest("hex").slice(0, 32);
}

/** 32-bit signed integer from a keyed hash, small enough to store as Postgres int4[]. */
export function hmacInt32(pepper: string, label: string, value: string): number {
  return createHmac("sha256", pepper).update(`${label}\u0000${value}`).digest().readInt32BE(0);
}

export function caseIdFor(identKey: string): string {
  return `case_${createHash("sha256").update(identKey).digest("hex").slice(0, 12)}`;
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}
