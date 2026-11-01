import type { FastifyInstance } from "fastify";
import { DAY } from "../lib/time.js";
import { computeForecast } from "../services/forecast.js";
import type { AppDeps } from "./deps.js";

export function registerLiveRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Server-Sent Events: new reports, attacks the trust rules caught, and new alerts, as they happen.
  // The licence is checked when the stream opens (onRequest gate) AND every 15 s while it stays open.
  app.get("/live/stream", (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "access-control-allow-origin": "*",
    });
    res.write("retry: 5000\n\n");
    const send = (e: { type: string }, replay = false): void => {
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(replay ? { ...e, replay: true } : e)}\n\n`);
    };
    for (const e of deps.live.recent()) send(e, true);
    const off = deps.live.subscribe((e) => send(e));
    const beat = setInterval(() => {
      if (deps.enforceLicence && deps.licence.status(deps.now()) !== "VALID") {
        res.write(`event: expired\ndata: {"error":"LICENSE_EXPIRED"}\n\n`);
        res.end();
        return;
      }
      res.write(": ping\n\n");
    }, 15_000);
    const close = (): void => {
      clearInterval(beat);
      off();
    };
    req.raw.on("close", close);
    res.on("close", close);
  });

  // Pace and next-24-hour forecast per area, from countable (trusted) reports.
  let cache: { at: number; value: unknown } | null = null;
  app.get("/live/forecast", async () => {
    const now = deps.now();
    if (cache && now - cache.at < 20_000) return cache.value;
    const rows = await deps.service.countableRows(now - 16 * DAY, null);
    const value = computeForecast(rows, now);
    cache = { at: now, value };
    return value;
  });

  // Replay of the held-out card transactions (public ULB dataset) with the model's score, in time order.
  app.get("/live/cards", async (req) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const cursor = Math.max(0, Math.floor(Number(q.cursor ?? 0) || 0));
    const limit = Math.min(5000, Math.max(1, Math.floor(Number(q.limit ?? 1500) || 1500)));
    return deps.datasets.cardPage(cursor, limit);
  });
}
