import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeIdentifier, parseIdentifierType } from "../../shared/normalize.js";
import { zodMessage, type AppDeps } from "./deps.js";

const ChallengeBody = z.object({
  identifier_type: z.string().max(40),
  identifier_value: z.union([z.string(), z.number()]).transform(String),
  claimant_name: z.string().max(200).optional().nullable(),
  contact_email: z.string().max(200).optional().nullable(),
  proof_note: z.string().max(2000).optional().nullable(),
});

export function registerAdminRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/health", async () => ({ ok: true }));

  // The brief requires this to be unauthenticated so the judges can start clean.
  app.post("/admin/reset", async () => {
    await deps.service.reset();
    deps.live.clear();
    deps.platform.campaigns.invalidate();
    return { ok: true, reset: true };
  });

  app.post("/challenges", async (req, reply) => {
    const parsed = ChallengeBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: zodMessage(parsed.error.issues) });
    const b = parsed.data;
    const type = parseIdentifierType(b.identifier_type);
    if (!type) return reply.code(400).send({ error: "identifier_type must be phone, upi, url or sender_id" });
    const ident = normalizeIdentifier(type, b.identifier_value);
    if (!ident.ok) return reply.code(400).send({ error: ident.error });
    const id = await deps.service.challenge(ident.key, b.claimant_name ?? null, b.contact_email ?? null, b.proof_note ?? null);
    // contact_email is stored for follow-up only; it is never returned or logged.
    return reply.code(201).send({ challenge_id: id, status: "under_review" });
  });
}
