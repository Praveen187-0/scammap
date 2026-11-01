import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { logError, logRequest } from "./log.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAreaRoutes } from "./routes/areas.js";
import { registerInsightRoutes } from "./routes/insights.js";
import type { AppDeps } from "./routes/deps.js";
import { registerLicenceRoutes } from "./routes/licence.js";
import { registerLiveRoutes } from "./routes/live.js";
import { registerPlatformRoutes } from "./routes/platform.js";
import { registerLookupRoutes } from "./routes/lookup.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerSafetyRoutes } from "./routes/safety.js";

// Every API path except /health and /license is locked when the licence is not valid (plus the OCR model files and
// Android link file, which are static assets like the app itself).
// Static app files always load, so the "Licence expired" screen can still render.
const GATED = new Set(["/reports", "/lookup", "/map", "/alerts", "/admin/reset", "/challenges", "/analyze", "/analyze/quick", "/analyze/identifier", "/stats", "/insights/briefing", "/datasets/summary", "/live/stream", "/live/forecast", "/live/cards"]);

const GATED_PREFIXES = ["/admin", "/safety", "/threats", "/partner/", "/campaigns", "/network", "/push/", "/lookup/", "/analyze/", "/live/", "/rollups", "/system/", "/connectors", "/transparency", "/privacy/"];

export function pathOf(url: string): string {
  const p = url.split("?")[0] ?? "/";
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // default request logs include URLs (and so looked-up numbers): replaced by logRequest
    trustProxy: true,
    bodyLimit: 64 * 1024,
    routerOptions: { ignoreTrailingSlash: true },
  });

  // Accept JSON whatever the Content-Type says, and treat an empty body as {} (POST /admin/reset may have none).
  app.removeContentTypeParser(["application/json", "text/plain"]);
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body.trim() : "";
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text) as unknown);
    } catch {
      const err = Object.assign(new Error("body is not valid JSON"), { statusCode: 400 });
      done(err, undefined);
    }
  });

  app.addHook("onRequest", async (req, reply) => {
    (req as { t0?: number }).t0 = performance.now();
    reply.header("access-control-allow-origin", "*");
    const p = pathOf(req.url);
    if (deps.enforceLicence && (GATED.has(p) || GATED_PREFIXES.some((x) => p.startsWith(x)))) {
      const now = deps.now();
      const status = deps.licence.status(now); // checked on every request, not just at startup
      if (status === "CLOCK_ROLLBACK") {
        // Safety lock: the server clock is behind the latest time it has already seen. The error code stays
        // LICENSE_EXPIRED (what clients and the test tool expect for any lock); the rest says exactly why.
        const c = deps.licence.clockGuard.state(now);
        return reply.code(403).header("x-scammap-safety-lock", "clock-rollback").send({
          error: "LICENSE_EXPIRED",
          reason: "CLOCK_ROLLBACK",
          code: "CLOCK_ROLLBACK_DETECTED",
          message: "Safety lock: this server's clock is behind the latest time it has already seen, so licence dates can't be trusted. Set the clock right; the server unlocks by itself.",
          server_time: c.server_time,
          high_water_mark: c.high_water_mark,
          behind_seconds: c.behind_seconds,
          tolerance_seconds: c.tolerance_seconds,
        });
      }
      if (status !== "VALID") return reply.code(403).send({ error: "LICENSE_EXPIRED", reason: status });
    } else {
      deps.licence.observe(deps.now());
    }
  });

  app.addHook("onResponse", async (req, reply) => {
    const t0 = (req as { t0?: number }).t0 ?? performance.now();
    logRequest(req.method, req.routeOptions.url ?? "unmatched", reply.statusCode, performance.now() - t0);
  });

  app.setErrorHandler((err: { statusCode?: number; message?: string }, _req, reply) => {
    const status = typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) logError("request failed", err);
    reply.code(status).send({ error: status >= 500 ? "internal error" : (err.message ?? "bad request") });
  });

  app.options("/*", async (_req, reply) =>
    reply
      .code(204)
      .header("access-control-allow-methods", "GET, POST, OPTIONS")
      .header("access-control-allow-headers", "content-type")
      .send(),
  );

  registerAdminRoutes(app, deps);
  registerReportRoutes(app, deps);
  registerLookupRoutes(app, deps);
  registerAreaRoutes(app, deps);
  registerLicenceRoutes(app, deps);
  registerInsightRoutes(app, deps);
  registerLiveRoutes(app, deps);
  registerPlatformRoutes(app, deps);
  registerSafetyRoutes(app, deps);

  const staticDir = deps.staticDir;
  if (staticDir && existsSync(path.join(staticDir, "index.html"))) {
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: "/",
      index: ["index.html"],
      setHeaders(res, filePath) {
        // Hashed build assets can be cached forever; the shell and service worker must always revalidate.
        res.setHeader("cache-control", filePath.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && (req.headers.accept ?? "").includes("text/html")) {
        return reply.header("cache-control", "no-cache").sendFile("index.html");
      }
      return reply.code(404).send({ error: "not found" });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not found" }));
  }
  return app;
}
