// Outgoing HTTP deliveries (partner webhooks, Slack, Telegram, generic webhooks) with retries and a delivery log.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "../db/db.js";

export interface DeliveryResult {
  ok: boolean;
  status: number | null;
  attempts: number;
  error: string | null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** "fetch failed" plus the reason Node keeps in .cause (ECONNREFUSED, ENOTFOUND, a timeout), for setup screens. */
export function describeNetworkError(e: unknown): string {
  if (!(e instanceof Error)) return "network error";
  if (e.name === "AbortError") return "timed out";
  const cause = (e as { cause?: { code?: string; message?: string } }).cause;
  const why = cause?.code ?? cause?.message;
  return `${e.message}${why && !e.message.includes(why) ? ` (${why})` : ""}`.slice(0, 200);
}

export function signBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** What a receiver (a partner bank) runs: recompute the signature over the exact bytes received, constant-time compare. */
export function verifySignature(secret: string, rawBody: Buffer | string, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** POST with up to 3 attempts (0 s, 2 s, 8 s). 4xx answers (except 429) are not retried. */
export async function postJson(url: string, payload: unknown, headers: Record<string, string> = {}, opts: { retries?: number; timeoutMs?: number; backoffMs?: number } = {}): Promise<DeliveryResult> {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const retries = opts.retries ?? 3;
  let status: number | null = null;
  let error: string | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "ScamMap/1.0", ...headers }, body, signal: ctrl.signal });
      clearTimeout(t);
      status = res.status;
      if (res.ok) return { ok: true, status, attempts: attempt, error: null };
      // Keep the receiver's short explanation (Slack: "invalid_token", Telegram: "chat not found") for the status page.
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 160);
      error = `HTTP ${res.status}${detail ? `: ${detail}` : ""}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return { ok: false, status, attempts: attempt, error };
    } catch (e) {
      error = describeNetworkError(e);
    }
    if (attempt < retries) await sleep((opts.backoffMs ?? 2000) * 4 ** (attempt - 1));
  }
  return { ok: false, status, attempts: retries, error };
}

export async function logDelivery(pool: Pool, target: string, event: string, r: DeliveryResult): Promise<void> {
  await pool.query("INSERT INTO webhook_deliveries (target, event, status, attempts, error) VALUES ($1, $2, $3, $4, $5)", [target, event, r.status, r.attempts, r.error]).catch(() => undefined);
}
