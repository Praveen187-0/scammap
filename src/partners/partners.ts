// Partner organisations (banks, telecom companies, police) as tenants. Each has an API key (only its hash is
// stored), a watch list, and an optional webhook. Partners see the same privacy rules as everyone: an identifier
// is shown in full only once 3 unrelated people confirmed it; otherwise it is masked.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AREA_BY_PIN } from "../../shared/areas.js";
import { maskValue, normalizeSender, type IdentifierType } from "../../shared/normalize.js";
import type { Pool } from "../db/db.js";
import { logDelivery, postJson, signBody } from "../lib/deliver.js";
import { formatIst } from "../lib/time.js";
import { logError } from "../log.js";
import type { ChangeEvent, ScamService } from "../services/scamService.js";
import { publicVerdict } from "../services/view.js";

export interface Watch {
  upi_handles?: string[];
  brand_tokens?: string[];
  sender_ids?: string[];
  phone_prefixes?: string[];
  domains?: string[];
  areas?: string[];
}
export interface Tenant {
  id: string;
  name: string;
  kind: "bank" | "telecom" | "police" | "other";
  watch: Watch;
  webhook_url: string | null;
  webhook_secret: string | null;
}

export function splitKey(identKey: string): { type: IdentifierType; value: string } {
  const i = identKey.indexOf(":");
  return { type: identKey.slice(0, i) as IdentifierType, value: identKey.slice(i + 1) };
}

/** Why a report concerns this tenant (empty = not at all). Pure, so it is unit-tested. */
export function matchTenant(w: Watch, type: IdentifierType, value: string, pincode: string): string[] {
  const reasons: string[] = [];
  const v = value.toLowerCase();
  if (type === "upi") {
    const [local = "", handle = ""] = v.split("@");
    if (w.upi_handles?.some((h) => h.replace(/^@/, "").toLowerCase() === handle)) reasons.push(`upi_handle:@${handle}`);
    const tok = w.brand_tokens?.find((b) => b.length >= 3 && local.replace(/[._-]/g, "").includes(b.toLowerCase()));
    if (tok) reasons.push(`brand_in_upi:${tok}`);
  }
  if (type === "url") {
    let host = "";
    try {
      host = new URL(v).hostname;
    } catch {
      host = v;
    }
    const own = w.domains?.find((d) => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`));
    if (own) reasons.push(`own_domain:${own}`);
    else {
      const tok = w.brand_tokens?.find((b) => b.length >= 3 && host.replace(/[.-]/g, "").includes(b.toLowerCase()));
      if (tok) reasons.push(`brand_lookalike:${tok}`);
    }
  }
  if (type === "sender_id") {
    const n = normalizeSender(value);
    const code = n.ok ? n.value : value.toUpperCase();
    const hit = w.sender_ids?.find((s) => {
      const m = normalizeSender(s);
      return (m.ok ? m.value : s.toUpperCase()) === code;
    });
    if (hit) reasons.push(`sender_id:${code}`);
  }
  if (type === "phone") {
    const p = w.phone_prefixes?.find((x) => v.startsWith(x));
    if (p) reasons.push(`phone_prefix:${p}`);
  }
  if (w.areas?.includes(pincode)) reasons.push(`area:${pincode}`);
  return reasons;
}

export function newApiKey(id: string): { key: string; hash: string } {
  const secret = randomBytes(24).toString("base64url");
  return { key: `smk_${id}_${secret}`, hash: createHash("sha256").update(secret).digest("hex") };
}

export class PartnerService {
  private tenants: Array<Tenant & { key_hash: string }> = [];

  constructor(private readonly pool: Pool, private readonly service: ScamService) {}

  async load(): Promise<void> {
    this.tenants = (await this.pool.query<Tenant & { key_hash: string }>("SELECT id, name, kind, watch, webhook_url, webhook_secret, key_hash FROM tenants ORDER BY created_at")).rows;
  }

  get count(): number {
    return this.tenants.length;
  }

  async create(t: Omit<Tenant, "id" | "webhook_secret"> & { id?: string }): Promise<{ tenant: Tenant; apiKey: string }> {
    const id = t.id ?? `t${randomBytes(4).toString("hex")}`;
    const { key, hash } = newApiKey(id);
    const secret = t.webhook_url ? randomBytes(18).toString("base64url") : null;
    await this.pool.query(
      `INSERT INTO tenants (id, name, kind, key_hash, watch, webhook_url, webhook_secret) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, key_hash = EXCLUDED.key_hash, watch = EXCLUDED.watch,
         webhook_url = EXCLUDED.webhook_url, webhook_secret = EXCLUDED.webhook_secret`,
      [id, t.name, t.kind, hash, JSON.stringify(t.watch), t.webhook_url, secret],
    );
    await this.load();
    return { tenant: { id, name: t.name, kind: t.kind, watch: t.watch, webhook_url: t.webhook_url, webhook_secret: secret }, apiKey: key };
  }

  /** API key "smk_<id>_<secret>" -> tenant, comparing hashes in constant time. */
  authenticate(header: string | undefined): Tenant | null {
    const m = /^smk_([a-z0-9-]+)_([A-Za-z0-9_-]{20,})$/.exec((header ?? "").trim());
    if (!m) return null;
    const t = this.tenants.find((x) => x.id === m[1]);
    if (!t) return null;
    const a = Buffer.from(createHash("sha256").update(m[2]!).digest("hex"));
    const b = Buffer.from(t.key_hash);
    return a.length === b.length && timingSafeEqual(a, b) ? t : null;
  }

  /** Called for every stored report. Never throws. */
  onReport(ev: ChangeEvent): void {
    if (!this.tenants.length) return;
    const { type, value } = splitKey(ev.identKey);
    for (const t of this.tenants) {
      const reasons = matchTenant(t.watch, type, value, ev.pincode);
      if (!reasons.length) continue;
      void this.record(t, ev, type, value, reasons).catch((e: unknown) => logError("partner hit failed", e));
    }
  }

  private async record(t: Tenant, ev: ChangeEvent, type: IdentifierType, value: string, reasons: string[]): Promise<void> {
    await this.pool.query(
      `INSERT INTO tenant_hits (tenant_id, report_id, ident_key, pincode, scam_type, reasons, at) VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0))
       ON CONFLICT DO NOTHING`,
      [t.id, ev.reportId, ev.identKey, ev.pincode, ev.scamType, reasons.join(","), ev.occurredAt],
    );
    if (!t.webhook_url || !t.webhook_secret) return;
    const payload = this.describe(ev.identKey, type, value, ev.pincode, ev.scamType, formatIst(ev.occurredAt), reasons, ev.after.distinct_reporters);
    const body = JSON.stringify({ event: "report", tenant: t.id, ...payload });
    const r = await postJson(t.webhook_url, body, { "x-scammap-event": "report", "x-scammap-signature": signBody(t.webhook_secret, body) });
    await logDelivery(this.pool, t.id, "report", r);
  }

  /** Privacy: full value only when 3+ unrelated people confirmed it (or it is on the verified list). */
  describe(identKey: string, type: IdentifierType, value: string, pincode: string, scamType: string, at: string, reasons: string[], people: number): Record<string, unknown> {
    const owner = this.service.verifiedOwner(identKey);
    const verdict = publicVerdict(this.service.cachedAssessment(identKey), owner, this.service.isChallenged(identKey));
    const confirmed = verdict === "KNOWN_SCAM" || verdict === "VERIFIED_BUSINESS";
    const area = AREA_BY_PIN.get(pincode);
    return {
      at, verdict, people, confirmed, scam_type: scamType, matched: reasons,
      identifier: { type, display_value: confirmed ? value : maskValue(type, value) },
      area: { pincode, locality: area?.locality ?? pincode, city: area?.city ?? "" },
    };
  }

  async hits(t: Tenant, hours: number): Promise<Array<Record<string, unknown>>> {
    const rows = (await this.pool.query<{ ident_key: string; pincode: string; scam_type: string; reasons: string; at: Date }>(
      "SELECT ident_key, pincode, scam_type, reasons, at FROM tenant_hits WHERE tenant_id = $1 AND at > now() - make_interval(hours => $2) ORDER BY at DESC LIMIT 200",
      [t.id, hours],
    )).rows;
    const out: Array<Record<string, unknown>> = [];
    for (const r of rows) {
      const { type, value } = splitKey(r.ident_key);
      const a = await this.service.assessment(r.ident_key);
      out.push(this.describe(r.ident_key, type, value, r.pincode, r.scam_type, formatIst(new Date(r.at).getTime()), r.reasons.split(","), a?.distinct_reporters ?? 0));
    }
    return out;
  }

  async hourly(t: Tenant, hours: number): Promise<Array<{ hour: string; hits: number }>> {
    const from = Math.floor(Date.now() / 3_600_000) * 3_600_000 - (hours - 1) * 3_600_000;
    const rows = (await this.pool.query<{ h: Date; c: number }>(
      "SELECT date_trunc('hour', at) AS h, count(*)::int AS c FROM tenant_hits WHERE tenant_id = $1 AND at >= to_timestamp($2/1000.0) GROUP BY 1",
      [t.id, from],
    )).rows;
    const m = new Map(rows.map((r) => [new Date(r.h).getTime(), r.c]));
    return Array.from({ length: hours }, (_, i) => ({ hour: new Date(from + i * 3_600_000).toISOString(), hits: m.get(from + i * 3_600_000) ?? 0 }));
  }

  async deliveries(target: string): Promise<Array<{ event: string; status: number | null; attempts: number; error: string | null; at: string }>> {
    return (await this.pool.query<{ event: string; status: number | null; attempts: number; error: string | null; at: Date }>(
      "SELECT event, status, attempts, error, at FROM webhook_deliveries WHERE target = $1 ORDER BY at DESC LIMIT 20",
      [target],
    )).rows.map((r) => ({ ...r, at: formatIst(new Date(r.at).getTime()) }));
  }

  async testWebhook(t: Tenant): Promise<{ ok: boolean; status: number | null; error: string | null }> {
    if (!t.webhook_url || !t.webhook_secret) return { ok: false, status: null, error: "no webhook configured" };
    const body = JSON.stringify({ event: "test", tenant: t.id, at: formatIst(Date.now()), message: "ScamMap webhook test" });
    const r = await postJson(t.webhook_url, body, { "x-scammap-event": "test", "x-scammap-signature": signBody(t.webhook_secret, body) }, { retries: 1 });
    await logDelivery(this.pool, t.id, "test", r);
    return r;
  }
}
