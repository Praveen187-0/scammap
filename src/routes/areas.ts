import type { FastifyInstance } from "fastify";
import { AREAS, areasWithin, findArea } from "../../shared/areas.js";
import { computeAlerts, computeClusters } from "../alerts/alerts.js";
import { DAY } from "../lib/time.js";
import type { AppDeps } from "./deps.js";

function num(v: unknown, dflt: number, min: number, max: number): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

export function registerAreaRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/map", async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const pin = typeof q.pincode === "string" && q.pincode.trim() ? q.pincode.trim() : null;
    const center = pin ? findArea(pin) : undefined;
    if (pin && !center) return reply.code(400).send({ error: "unknown area code (pincode)" });
    const days = num(q.days, 7, 1, 90);
    const radiusKm = num(q.radius_km, 2, 0, 5000);
    const areas = center ? areasWithin(center, radiusKm) : [...AREAS];
    const now = deps.now();
    // Spike status needs the 7 days before the last 24 h, so fetch at least 8 days.
    const rows = await deps.service.countableRows(now - Math.max(days, 8) * DAY - DAY, areas.map((a) => a.pincode));
    const clusters = computeClusters(rows, areas, days, now);
    // The app asks for k=3: areas with fewer than k reports are shown as "fewer than k", so a single report in a
    // quiet area can't point at anyone. Without k (the test tool) the reply is exactly Appendix A.
    const k = num(q.k, 0, 0, 10);
    const out = k > 1 ? clusters.map((c) => (c.count < k ? { ...c, count: 0, top_scam_type: "other", severity: "MED" as const, spike: false, suppressed: true } : c)) : clusters;
    return { clusters: out, days, radius_km: radiusKm, pincode: pin };
  });

  app.get("/alerts", async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const pin = typeof q.pincode === "string" && q.pincode.trim() ? q.pincode.trim() : null;
    if (pin && !findArea(pin)) return reply.code(400).send({ error: "unknown area code (pincode)" });
    const now = deps.now();
    // Computed at request time: the test tool posts reports and queries straight away.
    const rows = await deps.service.countableRows(now - 32 * DAY, pin ? [pin] : null);
    const pins = pin ? [pin] : [...new Set(rows.map((r) => r.pincode))].sort();
    return { alerts: pins.flatMap((p) => computeAlerts(rows, p, now)) };
  });
}
