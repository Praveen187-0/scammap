import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TRUST } from "../trust/config.js";
import { prefixOf } from "./reports.js";
import { zodMessage, type AppDeps } from "./deps.js";

const hits = new Map<string, number[]>();
function allow(key: string, perMinute: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= perMinute) return false;
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

export function registerSafetyRoutes(app: FastifyInstance, deps: AppDeps): void {
  const S = deps.safety;

  // Everything the safety panel shows: clock guard, local AI, anti-spoofing settings. No personal data.
  app.get("/safety", async () => {
    const ready = S.ollama ? await S.ollama.check() : { ok: false, reason: "local AI is switched off (LOCAL_AI=off)", models: [] };
    return {
      clock: deps.licence.clockGuard.state(deps.now()),
      local_ai: { ...S.noteParser.status(ready), auto_scam_type: S.autoScamType },
      scam_type_sources: await deps.service.typeSources(),
      anti_spoofing: {
        network_unit: "/24 (individual addresses are reduced to their /24)",
        subnet_clustering: TRUST.subnetClustering,
        block: "/16",
        window_minutes: TRUST.subnetWindowMs / 60_000,
        min_prefixes: TRUST.subnetMinPrefixes,
        min_accounts: TRUST.subnetMinReporters,
        same_network_window_hours: TRUST.sameNetworkWindowMs / 3_600_000,
        ip_prefix_from_body: deps.trustBodyIpPrefix,
      },
      demo_time_travel: S.timeTravel.enabled ? { offset_seconds: Math.round(S.timeTravel.offsetMs / 1000) } : null,
    };
  });

  // Read one note with the rules and the local model, on request. The translation goes back to the person who asked
  // and is not stored or logged.
  app.post("/analyze/note", async (req, reply) => {
    const b = z.object({ note: z.string().trim().min(3).max(2000) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: zodMessage(b.error.issues) });
    if (!allow(`note:${prefixOf(req.ip) ?? "x"}`, 20)) return reply.code(429).send({ error: "too many note checks, try again in a minute" });
    return S.noteParser.read(b.data.note);
  });

  // DEMO ONLY (DEMO_TIME_TRAVEL=true, never in production): move this server's clock BACK, as if someone changed the
  // system clock, to show the safety lock without touching Windows. It is not licence-gated so it can undo itself.
  if (S.timeTravel.enabled) {
    app.get("/demo/time-travel", async () => ({ offset_seconds: Math.round(S.timeTravel.offsetMs / 1000), clock: deps.licence.clockGuard.state(deps.now()) }));
    app.post("/demo/time-travel", async (req, reply) => {
      const b = z.object({ seconds_back: z.number().min(0).max(400 * 86_400) }).safeParse(req.body ?? {});
      if (!b.success) return reply.code(400).send({ error: "send {\"seconds_back\": N} with N >= 0 (0 puts the clock right again)" });
      S.timeTravel.offsetMs = -Math.round(b.data.seconds_back * 1000);
      const now = deps.now();
      return { offset_seconds: Math.round(S.timeTravel.offsetMs / 1000), licence: deps.licence.status(now), clock: deps.licence.clockGuard.state(now) };
    });
  }
}
