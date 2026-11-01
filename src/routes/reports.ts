import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { findArea } from "../../shared/areas.js";
import { normalizeIdentifier, parseIdentifierType } from "../../shared/normalize.js";
import { normalizeChannel, normalizeScamType, suggestScamType } from "../../shared/scamTypes.js";
import { FUTURE_SKEW_MS } from "../alerts/alerts.js";
import { randomId } from "../lib/hmac.js";
import { DAY, parseIsoTime } from "../lib/time.js";
import { maskValue } from "../../shared/normalize.js";
import { TRUST } from "../trust/config.js";
import { computeAlerts } from "../alerts/alerts.js";
import type { DefenceKind } from "../live/bus.js";
import { logError } from "../log.js";
import type { RejectReason } from "../services/scamService.js";
import { publicVerdict } from "../services/view.js";
import { zodMessage, type AppDeps } from "./deps.js";

const str = (max: number) => z.union([z.string(), z.number()]).transform(String).pipe(z.string().max(max));
const optStr = (max: number) => z.union([z.string(), z.number(), z.null()]).optional().transform((v) => (v === null || v === undefined ? undefined : String(v))).pipe(z.string().max(max).optional());
const boolish = z.union([z.boolean(), z.string(), z.number(), z.null()]).optional().transform((v) => v === true || v === 1 || (typeof v === "string" && ["true", "1", "yes"].includes(v.toLowerCase())));

export const ReportBody = z.object({
  report_id: optStr(120),
  occurred_at: str(64),
  reported_at: optStr(64),
  reporter_id: str(200).pipe(z.string().trim().min(1, "reporter_id is required")),
  ip_prefix: optStr(100),
  channel: optStr(100),
  scam_type: optStr(100),
  identifier_type: str(40),
  identifier_value: str(2048),
  pincode: str(20),
  locality: optStr(200),
  city: optStr(200),
  note: optStr(5000),
  has_screenshot: boolish,
  amount_lost_inr: z.union([z.number(), z.string(), z.null()]).optional(),
  // Extra (optional): other identifiers from the same message, for campaign detection. Ignored by the test tool.
  related_identifiers: z.array(z.object({ type: z.string().max(40), value: z.union([z.string(), z.number()]).transform(String).pipe(z.string().max(2048)) })).max(5).optional(),
});

/** Coarse network prefix for app users (first 3 octets / first 3 IPv6 groups). Only its HMAC is stored. */
export function prefixOf(ip: string): string | null {
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}`;
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":").toLowerCase();
  return null;
}

export function registerReportRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/reports", async (req, reply) => {
    const reject = (reason: RejectReason, error: string) => {
      deps.service.recordRejection(reason);
      return reply.code(400).send({ error });
    };
    const parsed = ReportBody.safeParse(req.body ?? {});
    if (!parsed.success) return reject("bad_request", zodMessage(parsed.error.issues));
    const b = parsed.data;

    const type = parseIdentifierType(b.identifier_type);
    if (!type) return reject("bad_identifier", "identifier_type must be phone, upi, url or sender_id");
    const ident = normalizeIdentifier(type, b.identifier_value);
    if (!ident.ok) return reject("bad_identifier", ident.error);
    const area = findArea(b.pincode);
    if (!area) return reject("unknown_area", "unknown area code (pincode)");

    const now = deps.now();
    const occurredAt = parseIsoTime(b.occurred_at);
    if (occurredAt === null) return reject("bad_time", "occurred_at is not a valid ISO-8601 time");
    let reportedAt = b.reported_at ? parseIsoTime(b.reported_at) : occurredAt;
    if (reportedAt === null) return reject("bad_time", "reported_at is not a valid ISO-8601 time");
    if (occurredAt > now + FUTURE_SKEW_MS) return reject("bad_time", "occurred_at is in the future");
    if (reportedAt > now + FUTURE_SKEW_MS) return reject("bad_time", "reported_at is in the future");
    // Old reports are accepted (they must exist to prove the 7-day map window), but not absurd ones.
    if (occurredAt < now - 400 * DAY) return reject("bad_time", "occurred_at is more than a year ago");
    reportedAt = Math.max(reportedAt, occurredAt);

    // Blank scam type: pick one from the note at once (keyword rules in English, Hindi and Hinglish); the local AI
    // may refine it in the background. A type the reporter chose is never changed.
    let scamType = normalizeScamType(b.scam_type);
    let scamTypeSource: "reporter" | "rules" | "default" = "reporter";
    let rulesType: string | null = null;
    if (!(b.scam_type ?? "").trim() && deps.safety.autoScamType) {
      rulesType = b.note ? suggestScamType(b.note) : null;
      scamType = rulesType ?? "other";
      scamTypeSource = rulesType ? "rules" : "default";
    }

    const amount = Number(b.amount_lost_inr ?? 0);
    const ipPrefix = deps.trustBodyIpPrefix && b.ip_prefix ? b.ip_prefix : prefixOf(req.ip);

    const res = await deps.service.submit({
      reportId: b.report_id && b.report_id.trim() ? b.report_id.trim() : randomId("rep"),
      identType: ident.type,
      identValue: ident.value,
      identKey: ident.key,
      occurredAt,
      reportedAt,
      reporterId: b.reporter_id,
      ipPrefix,
      channel: normalizeChannel(b.channel),
      scamType,
      scamTypeSource,
      pincode: area.pincode,
      note: b.note ?? "",
      hasScreenshot: b.has_screenshot,
      lostMoney: Number.isFinite(amount) && amount > 0,
      lossBand: !Number.isFinite(amount) || amount <= 0 ? 0 : amount < 10_000 ? 1 : amount <= 100_000 ? 2 : 3,
      related: (b.related_identifiers ?? []).flatMap((r) => {
        const t = parseIdentifierType(r.type);
        const n = t ? normalizeIdentifier(t, r.value) : null;
        return n && n.ok ? [n.key] : [];
      }),
    });

    const fresh = occurredAt > now - 6 * 3_600_000; // only recent reports are "live"
    if (res.kind === "rate_limited") {
      deps.service.recordRejection("rate_limited");
      if (fresh) deps.live.publish({ type: "defence", pincode: area.pincode, kind: "RATE_LIMITED", scam_type: scamType, reports: 0, people: 1, key: ident.key });
      return reply.code(429).header("retry-after", String(res.retryAfterSec)).send({ error: "RATE_LIMITED", reason: res.reason });
    }
    // Time-travel defence: an accepted report's own time confirms the clock high-water mark (capped at our clock).
    deps.licence.observe(Math.max(occurredAt, reportedAt), "report");
    if (!res.duplicate && scamTypeSource !== "reporter" && b.note && deps.safety.noteParser.wants(b.note, rulesType)) {
      deps.safety.noteParser.enqueue({ reportId: res.reportId, note: b.note, current: scamType, pincode: area.pincode });
    }
    const a = res.assessment;
    const owner = deps.service.verifiedOwner(ident.key);
    if (fresh && !res.duplicate) void publishLive(deps, res.reportId, ident.key, area.pincode, scamType, normalizeChannel(b.channel), Boolean(owner), a?.report_count ?? 1, a?.distinct_reporters ?? 1);
    const unmasked = Boolean(owner) || (a?.credible_voices ?? 0) >= TRUST.knownScamMinVoices;
    return reply.code(201).send({
      report_id: res.reportId,
      case_id: res.caseId,
      merged: res.merged,
      // Extra fields so the app can show the verdict right after submitting.
      verdict: publicVerdict(a, owner, deps.service.isChallenged(ident.key)),
      confirmed: (a?.credible_voices ?? 0) >= TRUST.suspiciousMinVoices,
      distinct_reporters: a?.distinct_reporters ?? 1,
      display_value: unmasked ? ident.value : maskValue(ident.type, ident.value),
      identifier_type: ident.type,
    });
  });
}

const ATTACK_FLAGS: readonly DefenceKind[] = ["COORDINATED_BURST", "SYBIL_RING", "SUBNET_CLUSTER", "COPY_PASTE_NOTES", "SPAM_REPEAT", "PERSONAL_DISPUTE"];

/** Live feed: the new report (area and type only), any attack the trust rules just caught, and new alerts. */
export async function publishLive(deps: AppDeps, reportId: string, identKey: string, pincode: string, scamType: string, channel: string, verified: boolean, reports: number, people: number): Promise<void> {
  try {
    const st = await deps.service.reportState(reportId);
    deps.live.publish({ type: "report", pincode, scam_type: scamType, channel, counted: st?.countable ?? false });
    const kinds: DefenceKind[] = verified ? ["VERIFIED_TARGET"] : ATTACK_FLAGS.filter((f) => st?.flags.includes(f));
    for (const kind of kinds) deps.live.publish({ type: "defence", pincode, kind, scam_type: scamType, reports, people, key: identKey });
    if (st?.countable) scheduleAlertCheck(deps, pincode);
  } catch (e) {
    logError("live publish failed", e);
  }
}

// Alerts are checked 3 s after the LAST report in an area (trailing debounce), so a bulk load that arrives out of
// time order never announces an alert that disappears a second later.
const pendingChecks = new Map<string, ReturnType<typeof setTimeout>>();
export function scheduleAlertCheck(deps: AppDeps, pincode: string): void {
  const prev = pendingChecks.get(pincode);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    pendingChecks.delete(pincode);
    const now = deps.now();
    deps.service
      .countableRows(now - 32 * DAY, [pincode])
      .then((rows) => {
        for (const alert of computeAlerts(rows, pincode, now)) deps.live.publish({ type: "alert", pincode, alert });
      })
      .catch((e: unknown) => logError("live alert check failed", e));
  }, 3000);
  t.unref();
  pendingChecks.set(pincode, t);
}
