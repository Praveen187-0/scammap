import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { detectType, normalizeIdentifier, parseIdentifierType } from "../../shared/normalize.js";
import { buildLookupReply } from "../services/view.js";
import { zodMessage, type AppDeps } from "./deps.js";

const LookupQuery = z.object({
  type: z.string().max(40).optional(),
  value: z.string().max(2048).optional(),
  pincode: z.string().max(20).optional(),
});

export function registerLookupRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/lookup", async (req, reply) => {
    const t0 = performance.now();
    const parsed = LookupQuery.safeParse(req.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: zodMessage(parsed.error.issues) });
    const { value, pincode } = parsed.data;
    if (!value || !value.trim()) return reply.code(400).send({ error: "value is required" });
    // type is optional for the app's check-as-you-type box; the test tool always sends it.
    const type = parsed.data.type ? parseIdentifierType(parsed.data.type) : detectType(value);
    if (!type) return reply.code(400).send({ error: "type must be phone, upi, url or sender_id" });
    const ident = normalizeIdentifier(type, value);
    if (!ident.ok) return reply.code(400).send({ error: ident.error });

    const assessment = await deps.service.assessment(ident.key);
    const body = buildLookupReply({
      type: ident.type,
      value: ident.value,
      assessment,
      verifiedOwner: deps.service.verifiedOwner(ident.key),
      challenged: deps.service.isChallenged(ident.key),
      nearPincode: pincode,
    });
    // External lists from config/connectors.yaml: shown as "also listed by", never part of the verdict.
    const listed = deps.platform.connectors.listedBy(ident.key);
    return reply.header("server-timing", `app;dur=${(performance.now() - t0).toFixed(1)}`).send(listed.length ? { ...body, listed_by: listed } : body);
  });
}
