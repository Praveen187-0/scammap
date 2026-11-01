import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AREA_BY_PIN, findArea } from "../../shared/areas.js";
import { analyzePhone, analyzeSender, analyzeUrl } from "../../shared/risk.js";
import { normalizeIdentifier, parseIdentifierType } from "../../shared/normalize.js";
import { analyzeWithAi, briefing } from "../ai/assist.js";
import { identifierOpinion } from "../ai/identifier.js";
import { computeStats, ruleBriefing, type Stats } from "../services/stats.js";
import { buildLookupReply } from "../services/view.js";
import { prefixOf } from "./reports.js";
import { zodMessage, type AppDeps } from "./deps.js";

const AnalyzeBody = z.object({ text: z.string().min(1).max(8000), pincode: z.string().max(20).optional() });
const IdentifierBody = z.object({ type: z.string().max(40), value: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(2048)), pincode: z.string().max(20).optional() });

/** A small per-network budget for AI calls, so one client cannot burn the Gemini quota. */
class Budget {
  private hits = new Map<string, number[]>();
  allow(key: string, perMinute: number): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (list.length >= perMinute) return false;
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) this.hits.clear();
    return true;
  }
}

export function registerInsightRoutes(app: FastifyInstance, deps: AppDeps): void {
  const budget = new Budget();
  const briefCache = new Map<string, { at: number; value: unknown }>();

  // Paste a whole SMS, WhatsApp message or email: offline rules + optional Gemini + community lookups of every
  // number, UPI ID, link and sender found in it. The text is never stored or logged.
  app.post("/analyze", async (req, reply) => {
    const parsed = AnalyzeBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: zodMessage(parsed.error.issues) });
    const { text, pincode } = parsed.data;
    const useAi = budget.allow(prefixOf(req.ip) ?? "x", 20);
    const { candidates: found, ...analysis } = await analyzeWithAi(text, useAi ? deps.gemini : deps.geminiOff, deps.datasets.analyze(text));
    const candidates = found.slice(0, 6);
    const identifiers = await Promise.all(
      candidates.map(async (c) => {
        const key = `${c.type}:${c.value}`;
        const look = buildLookupReply({
          type: c.type, value: c.value, assessment: await deps.service.assessment(key),
          verifiedOwner: deps.service.verifiedOwner(key), challenged: deps.service.isChallenged(key), nearPincode: pincode,
        });
        return {
          type: c.type, value: c.value, display_value: look.display_value, verdict: look.verdict, distinct_reporters: look.distinct_reporters,
          verified_owner: look.verified_owner ?? null, risk: c.risk, message_en: look.message_en, message_hi: look.message_hi,
          // Outside lists (config/connectors.yaml): shown, and they raise the message's risk, but never change the verdict.
          listed_by: deps.platform.connectors.listedBy(key),
        };
      }),
    );
    // Community evidence outranks any model: a confirmed scam number in the message makes the message high risk.
    const confirmed = identifiers.find((i) => i.verdict === "KNOWN_SCAM");
    const listed = identifiers.find((i) => i.listed_by.length > 0 && i.verdict !== "VERIFIED_BUSINESS");
    let score = confirmed ? Math.max(analysis.score, 85) : analysis.score;
    if (listed) {
      score = Math.min(100, score + 15);
      analysis.signals = [...analysis.signals, {
        id: "listed-external", points: 15,
        en: `${listed.display_value} is on an outside list: ${listed.listed_by[0]!.label}.`,
        hi: `${listed.display_value} एक बाहरी सूची में है: ${listed.listed_by[0]!.label}।`,
      }];
    }
    return {
      ...analysis,
      score,
      level: score >= 60 ? "high" : score >= 30 ? "medium" : "low",
      community: confirmed ? { en: `Contains ${confirmed.display_value}, reported by ${confirmed.distinct_reporters} people.`, hi: `इसमें ${confirmed.display_value} है, जिसे ${confirmed.distinct_reporters} लोगों ने रिपोर्ट किया है।` } : null,
      identifiers,
    };
  });

  // Second opinion on one number / UPI ID / link / sender: rules + community database + Gemini (privacy-safe).
  // The community verdict is returned unchanged; the AI only explains and estimates risk around it.
  app.post("/analyze/identifier", async (req, reply) => {
    const parsed = IdentifierBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: zodMessage(parsed.error.issues) });
    const type = parseIdentifierType(parsed.data.type);
    if (!type) return reply.code(400).send({ error: "type must be phone, upi, url or sender_id" });
    const ident = normalizeIdentifier(type, parsed.data.value);
    if (!ident.ok) return reply.code(400).send({ error: ident.error });
    const look = buildLookupReply({
      type: ident.type, value: ident.value, assessment: await deps.service.assessment(ident.key),
      verifiedOwner: deps.service.verifiedOwner(ident.key), challenged: deps.service.isChallenged(ident.key), nearPincode: parsed.data.pincode,
    });
    const community = {
      verdict: look.verdict, people: look.distinct_reporters, scam_type: look.scam_type, channels: [...new Set(look.evidence.map((e) => e.channel))],
      challenged: look.challenged, verified_owner: look.verified_owner ?? null, awaiting: look.confirmation === "awaiting_confirmation",
    };
    const useAi = budget.allow(prefixOf(req.ip) ?? "x", 20);
    const op = await identifierOpinion(ident.type, ident.value, parsed.data.value, community, useAi ? deps.gemini : deps.geminiOff);
    return { type: ident.type, display_value: look.display_value, community, ...op };
  });

  // What was imported from public datasets, and how well the models trained on them perform.
  app.get("/datasets/summary", async () => deps.datasets.summary());

  // Quick offline checks for one link, number or sender (used while typing).
  app.get("/analyze/quick", async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const type = String(q.type ?? "");
    const value = String(q.value ?? "");
    if (!value) return reply.code(400).send({ error: "value is required" });
    if (type === "url") return analyzeUrl(value);
    if (type === "phone") return analyzePhone(value);
    if (type === "sender_id") return analyzeSender(value);
    return reply.code(400).send({ error: "type must be url, phone or sender_id" });
  });

  app.get("/stats", async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const pincode = typeof q.pincode === "string" && q.pincode ? q.pincode : null;
    const city = typeof q.city === "string" && q.city ? q.city : null;
    if (pincode && !findArea(pincode)) return reply.code(400).send({ error: "unknown area code (pincode)" });
    const days = Math.min(90, Math.max(1, Number(q.days ?? 30) || 30));
    return getStats(deps, days, pincode, city);
  });

  // A short written briefing of the numbers on the insights page. Gemini writes it when configured
  // (from aggregated counts only); otherwise the same facts are written by fixed rules.
  app.get("/insights/briefing", async (req) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const pincode = typeof q.pincode === "string" && findArea(q.pincode) ? q.pincode : null;
    const city = typeof q.city === "string" && q.city ? q.city : null;
    const days = Math.min(90, Math.max(1, Number(q.days ?? 7) || 7));
    const key = `${pincode}|${city}|${days}`;
    const hit = briefCache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
    const stats = await getStats(deps, days, pincode, city);
    const label = pincode ? (AREA_BY_PIN.get(pincode)?.locality ?? pincode) : city ?? "all areas";
    const fallback = ruleBriefing(stats, label);
    const compact = {
      scope: label, window_days: days, totals: stats.totals, by_type: stats.by_type.slice(0, 6), by_channel: stats.by_channel,
      by_area: stats.by_area.slice(0, 8).map((a) => ({ area: a.locality, city: a.city, count: a.count, previous: a.prev, top: a.top_scam_type })),
      report_delay: stats.report_delay, set_aside_reasons: stats.set_aside_reasons,
    };
    const value = await briefing(compact, fallback, deps.gemini);
    briefCache.set(key, { at: Date.now(), value });
    return value;
  });
}

async function getStats(deps: AppDeps, days: number, pincode: string | null, city: string | null): Promise<Stats> {
  return computeStats(deps.service.db, {
    days, pincode, city, verified: deps.service.verifiedKeys(), challenged: deps.service.challengedSet(), now: deps.now(),
  });
}
