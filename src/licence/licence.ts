// Licence file = {licensee, expires_at, signature}. The Ed25519 signature covers the canonical JSON of every
// other field (keys sorted, no whitespace), so changing the date or the licensee breaks it.
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { parseIsoTime } from "../lib/time.js";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as JsonValue)}`).join(",")}}`;
}

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue)]),
);

export const LicenceSchema = z
  .object({
    licensee: z.string().trim().min(1).max(200),
    expires_at: z.string().min(10).max(64),
    signature: z.string().min(16).max(512),
  })
  .catchall(jsonValue);

export type Licence = z.infer<typeof LicenceSchema>;

export function signingPayload(lic: Record<string, JsonValue>): string {
  const rest: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(lic)) if (k !== "signature") rest[k] = v;
  return canonicalJson(rest);
}

export type VerifyResult =
  | { ok: true; licence: Licence; expiresAtMs: number }
  | { ok: false; error: "INVALID_LICENCE_FORMAT" | "INVALID_EXPIRY" | "INVALID_SIGNATURE" | "NO_PUBLIC_KEY" };

export function loadPublicKey(pem: string): KeyObject | null {
  if (!pem.includes("BEGIN PUBLIC KEY")) return null;
  try {
    return createPublicKey(pem);
  } catch {
    return null;
  }
}

export function verifyLicence(input: unknown, publicKey: KeyObject | null): VerifyResult {
  if (!publicKey) return { ok: false, error: "NO_PUBLIC_KEY" };
  const parsed = LicenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_LICENCE_FORMAT" };
  const lic = parsed.data;
  const expiresAtMs = parseIsoTime(lic.expires_at);
  if (expiresAtMs === null) return { ok: false, error: "INVALID_EXPIRY" };
  let good = false;
  try {
    good = verify(null, Buffer.from(signingPayload(lic), "utf8"), publicKey, Buffer.from(lic.signature, "base64"));
  } catch {
    good = false;
  }
  return good ? { ok: true, licence: lic, expiresAtMs } : { ok: false, error: "INVALID_SIGNATURE" };
}

/** Used by scripts/sign-licence.ts and the tests. Never called by the server: it has no private key. */
export function signLicence(fields: Record<string, JsonValue>, privateKeyPem: string): Licence {
  const key = createPrivateKey(privateKeyPem);
  const unsigned: Record<string, JsonValue> = { ...fields };
  delete unsigned.signature;
  const signature = sign(null, Buffer.from(signingPayload(unsigned), "utf8"), key).toString("base64");
  return LicenceSchema.parse({ ...unsigned, signature });
}
