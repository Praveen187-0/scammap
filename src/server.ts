import "./lib/envFirst.js";
import path from "node:path";
import { Gemini } from "./ai/gemini.js";
import { NoteParser } from "./ai/noteParser.js";
import { Ollama } from "./ai/ollama.js";
import { buildApp } from "./app.js";
import type { AppDeps } from "./routes/deps.js";
import { loadDotEnv } from "./lib/dotenv.js";
import { createPool, licenceStore, migrate } from "./db/db.js";
import { readEnv } from "./env.js";
import { loadPublicKey } from "./licence/licence.js";
import { ClockGuard } from "./licence/clockGuard.js";
import { LicenceManager } from "./licence/manager.js";
import { LICENCE_PUBLIC_KEY_PEM } from "./licence/publicKey.js";
import { logError, logInfo, logWarn } from "./log.js";
import { computeAlerts } from "./alerts/alerts.js";
import { DatasetStore } from "./datasets/store.js";
import { DAY } from "./lib/time.js";
import { LiveBus } from "./live/bus.js";
import { CampaignService } from "./campaigns/service.js";
import { Connectors } from "./connectors/connectors.js";
import { LinkScanner } from "./linkscan/scan.js";
import { PartnerService } from "./partners/partners.js";
import { PushService } from "./push/push.js";
import { RollupService } from "./services/rollups.js";
import { ScamService } from "./services/scamService.js";
import { publicVerdict } from "./services/view.js";
import { TransparencyLog } from "./services/transparency.js";
import { TelegramBot } from "./telegram/bot.js";
import { ThreatFeed } from "./threatfeed/urlhaus.js";
import { scheduleAlertCheck } from "./routes/reports.js";
import { cpus } from "node:os";

async function main(): Promise<void> {
  loadDotEnv();
  const env = readEnv();
  const pool = createPool(env.databaseUrl, env.dbSsl);
  await migrate(pool);

  const service = new ScamService(pool, env.pepper);
  await service.init();

  const datasets = new DatasetStore(pool);
  await datasets.refresh();
  const live = new LiveBus();
  // Alerts that are already active at startup are not "new": don't announce them on the live feed.
  const startRows = await service.countableRows(Date.now() - 32 * DAY, null);
  live.markKnown([...new Set(startRows.map((r) => r.pincode))].flatMap((p) => computeAlerts(startRows, p, Date.now())));

  // Platform services. Each listens to stored reports; none of them can slow down or break a report.
  const rollups = new RollupService(pool);
  await rollups.ensureBuilt();
  rollups.start();
  const transparency = new TransparencyLog(pool, env.pepper);
  const partners = new PartnerService(pool, service);
  await partners.load();
  const campaigns = new CampaignService(pool, service, env.pepper);
  const push = new PushService(pool, env.vapidSubject);
  await push.init({ publicKey: env.vapidPublicKey ?? undefined, privateKey: env.vapidPrivateKey ?? undefined });
  push.attach(live);
  // Map layer B: global malicious URLs (URLhaus), fetched by the server every 5 minutes.
  const threats = new ThreatFeed({
    enabled: env.threatFeed, authKey: env.urlhausAuthKey, apiBase: env.urlhausApiBase, rdapBase: env.rdapBase,
    pollMs: env.threatFeedMinutes * 60_000, limit: env.threatFeedLimit, resolveDns: env.threatFeedDns, lookupsPerRefresh: 100,
  });
  threats.start();
  const connectors = new Connectors(pool, live);
  await connectors.start();
  service.onChange((ev) => {
    rollups.markDirty(ev.identKey);
    partners.onReport(ev);
    campaigns.invalidate();
    const owner = service.verifiedOwner(ev.identKey);
    const challenged = service.isChallenged(ev.identKey);
    const from = publicVerdict(ev.before, owner, challenged);
    const to = publicVerdict(ev.after, owner, challenged);
    if (from !== to) transparency.append(ev.identKey, from, to, ev.after.distinct_reporters, Date.now());
  });

  // One clock for the whole server. DEMO_TIME_TRAVEL can move it back (never forward) to show the safety lock.
  const timeTravel = { enabled: env.demoTimeTravel, offsetMs: 0 };
  const now = (): number => Date.now() + timeTravel.offsetMs;
  if (timeTravel.enabled) logWarn("DEMO_TIME_TRAVEL=true: POST /demo/time-travel can move this server's clock back. Demo only.");

  // Time-travel defence: high-water mark in system_metadata, ticked every 2 s, DB clock as a witness.
  const store = licenceStore(pool);
  const clockGuard = new ClockGuard(store, now, { toleranceMs: env.clockToleranceMs, persistEveryMs: 1000, tickMs: 2000, witnessUrl: env.clockWitnessUrl });
  const licence = new LicenceManager(loadPublicKey(LICENCE_PUBLIC_KEY_PEM), store, now, { rollbackToleranceMs: env.clockToleranceMs, persistEveryMs: 1000 }, clockGuard);
  await licence.init(env.licenceJson);
  clockGuard.start();

  // Local AI (Ollama on this machine) for notes in Hindi / Hinglish when the scam type was left blank.
  const ollama = env.localAi
    ? new Ollama({ url: env.ollamaUrl, model: env.ollamaModel, timeoutMs: env.ollamaTimeoutMs, allowRemote: env.ollamaAllowRemote, threads: env.ollamaThreads ?? Math.max(2, Math.floor(cpus().length / 2)) })
    : null;
  const noteParser = new NoteParser(ollama);
  if (!env.licenceEnforce) logWarn("LICENSE_ENFORCE=false: the licence is NOT being checked. Never use this on the judged server.");
  if (!env.production && env.pepper.startsWith("local-dev")) logWarn("PEPPER not set: using a development value.");

  const deps: AppDeps = {
    service,
    licence,
    enforceLicence: env.licenceEnforce,
    trustBodyIpPrefix: env.trustBodyIpPrefix,
    staticDir: path.resolve(process.cwd(), "dist/public"),
    now,
    gemini: new Gemini({ apiKey: env.geminiApiKey, model: env.geminiModel, baseUrl: env.geminiBaseUrl, timeoutMs: 9000 }),
    geminiOff: new Gemini({ apiKey: null, model: env.geminiModel, baseUrl: env.geminiBaseUrl, timeoutMs: 1 }),
    datasets,
    live,
    platform: { rollups, transparency, partners, connectors, linkscan: new LinkScanner(pool, { allowPrivate: env.linkscanAllowPrivate }), campaigns, push, threats },
    safety: { noteParser, ollama, autoScamType: env.autoScamType, timeTravel },
  };
  // A confident local-AI reading re-labels the report (only when the type was automatic) and re-assesses it.
  noteParser.onReading = async (job, r) => {
    if (!noteParser.accept(r)) return "kept";
    const ch = await service.reclassify(job.reportId, r.scam_type);
    if (!ch) return "kept";
    live.publish({ type: "classified", pincode: ch.pincode, scam_type: r.scam_type, from: ch.from, language: r.language, outcome: ch.changed ? "changed" : "confirmed" });
    if (ch.changed) {
      rollups.markDirty(ch.identKey);
      campaigns.invalidate();
      scheduleAlertCheck(deps, ch.pincode);
    }
    return ch.changed ? "changed" : "confirmed";
  };
  const app = await buildApp(deps);
  const bot = env.telegramBotToken ? new TelegramBot(env.telegramBotToken, deps, env.pepper) : null;
  bot?.start();
  await app.listen({ host: "0.0.0.0", port: env.port });
  void noteParser.warmUp().catch(() => undefined);
  logInfo("scammap listening", { port: env.port, licence: licence.info().status, local_ai: ollama ? `${env.ollamaModel} at ${env.ollamaUrl}` : "off", gemini: env.geminiApiKey ? env.geminiModel : "off (offline rules only)", datasets: datasets.hasMessages ? "loaded" : "none (npm run import-data)", telegram: bot ? "on" : "off", partners: partners.count });
  // Picks up `npm run import-data` without a restart.
  const datasetPoll = setInterval(() => {
    void datasets.refresh();
    void partners.load().catch(() => undefined); // picks up partners created with `npm run partner`
  }, 15_000);
  datasetPoll.unref();

  // Privacy: clear network hashes older than 30 days, hourly.
  const retention = setInterval(() => {
    service.expireNetworkHashes().catch((e: unknown) => logError("retention job failed", e));
  }, 3_600_000);
  retention.unref();

  const shutdown = async (): Promise<void> => {
    clearInterval(retention);
    clearInterval(datasetPoll);
    rollups.stop();
    threats.stop();
    connectors.stop();
    bot?.stop();
    clockGuard.stop();
    await licence.flush().catch(() => undefined);
    await app.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((e: unknown) => {
  logError("failed to start", e);
  process.exit(1);
});
