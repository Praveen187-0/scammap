import type { FastifyInstance } from "fastify";
import type { AppDeps } from "./deps.js";

export function registerLicenceRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/license", async () => {
    const info = deps.licence.info(deps.now());
    // Time-travel defence: what the clock guard sees (no personal data). Shown on the lock screen.
    const c = deps.licence.clockGuard.state(deps.now());
    return { ...info, clock: { status: c.status, high_water_mark: c.high_water_mark, behind_seconds: c.behind_seconds, tolerance_seconds: c.tolerance_seconds } };
  });

  // The signature is the authority: only a file signed with the private key on the owner's laptop is accepted.
  // Takes effect immediately, no restart.
  app.post("/license", async (req, reply) => {
    const res = await deps.licence.install(req.body);
    if (!res.ok) return reply.code(400).send({ error: res.error });
    return { ok: true, ...deps.licence.info(deps.now()) };
  });
}
