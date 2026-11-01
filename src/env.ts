// All configuration comes from environment variables, read once at startup.
export interface Env {
  databaseUrl: string;
  dbSsl: boolean;
  port: number;
  pepper: string;
  licenceEnforce: boolean;
  licenceJson: string | null;
  trustBodyIpPrefix: boolean;
  production: boolean;
  geminiApiKey: string | null;
  geminiModel: string;
  geminiBaseUrl: string;
  telegramBotToken: string | null;
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  vapidSubject: string;
  linkscanAllowPrivate: boolean;
  // Time-travel defence
  clockToleranceMs: number;
  clockWitnessUrl: string | null;
  demoTimeTravel: boolean;
  // Local AI (Ollama) and automatic scam types
  localAi: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  ollamaTimeoutMs: number;
  ollamaAllowRemote: boolean;
  ollamaThreads: number | null;
  autoScamType: boolean;
  // Global threat layer (URLhaus)
  threatFeed: boolean;
  urlhausAuthKey: string | null;
  urlhausApiBase: string;
  rdapBase: string;
  threatFeedMinutes: number;
  threatFeedLimit: number;
  threatFeedDns: boolean;
}

const bool = (v: string | undefined, dflt: boolean): boolean =>
  v === undefined || v === "" ? dflt : ["1", "true", "yes", "on"].includes(v.toLowerCase());

export function readEnv(e: NodeJS.ProcessEnv = process.env): Env {
  const production = e.NODE_ENV === "production";
  const pepper = e.PEPPER ?? "";
  if (production && (pepper.length < 16 || pepper.startsWith("change-me"))) {
    throw new Error("PEPPER must be set to a long random secret in production (see .env.example).");
  }
  const databaseUrl = e.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/scammap";
  return {
    databaseUrl,
    dbSsl: bool(e.DB_SSL, /sslmode=require/.test(databaseUrl)),
    port: Number(e.PORT ?? 8080),
    pepper: pepper || "local-dev-pepper-not-for-production",
    licenceEnforce: bool(e.LICENSE_ENFORCE, true),
    licenceJson: e.LICENSE_JSON && e.LICENSE_JSON.trim() ? e.LICENSE_JSON.trim() : null,
    trustBodyIpPrefix: bool(e.TRUST_BODY_IP_PREFIX, true),
    production,
    geminiApiKey: e.GEMINI_API_KEY && e.GEMINI_API_KEY.trim() ? e.GEMINI_API_KEY.trim() : null,
    // gemini-3.5-flash-lite: fast, low-cost stable model (Oct 2026). Any current model ID from Google AI Studio works;
    // on a 404 the client retries once with gemini-flash-latest.
    geminiModel: e.GEMINI_MODEL && e.GEMINI_MODEL.trim() ? e.GEMINI_MODEL.trim() : "gemini-3.5-flash-lite",
    geminiBaseUrl: e.GEMINI_BASE_URL && e.GEMINI_BASE_URL.trim() ? e.GEMINI_BASE_URL.trim() : "https://generativelanguage.googleapis.com/v1beta",
    telegramBotToken: e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_BOT_TOKEN.trim() ? e.TELEGRAM_BOT_TOKEN.trim() : null,
    vapidPublicKey: e.VAPID_PUBLIC_KEY?.trim() || null,
    vapidPrivateKey: e.VAPID_PRIVATE_KEY?.trim() || null,
    vapidSubject: e.VAPID_SUBJECT?.trim() || "mailto:alerts@scammap.example",
    // Only for local testing of the link checker against a page on your own machine. Never in production.
    linkscanAllowPrivate: bool(e.LINKSCAN_ALLOW_PRIVATE, false),
    // A clock more than this far behind the latest time ever seen locks the API (NTP corrections are smaller).
    clockToleranceMs: Math.max(10, Number(e.CLOCK_TOLERANCE_SECONDS ?? 120) || 120) * 1000,
    // Optional independent time source: an HTTPS URL whose Date header is trusted (e.g. https://www.google.com).
    clockWitnessUrl: e.CLOCK_WITNESS_URL && /^https:\/\//.test(e.CLOCK_WITNESS_URL.trim()) ? e.CLOCK_WITNESS_URL.trim() : null,
    // Demo only: lets `npm run demo -- clock` move this server's clock back without touching Windows. Never in production.
    demoTimeTravel: !production && bool(e.DEMO_TIME_TRAVEL, false),
    localAi: bool(e.LOCAL_AI, true),
    ollamaUrl: e.OLLAMA_URL?.trim() || "http://127.0.0.1:11434",
    ollamaModel: e.OLLAMA_MODEL?.trim() || "llama3.2:3b",
    ollamaTimeoutMs: Math.max(5, Number(e.OLLAMA_TIMEOUT_SECONDS ?? 60) || 60) * 1000,
    ollamaAllowRemote: bool(e.OLLAMA_ALLOW_REMOTE, false),
    ollamaThreads: e.OLLAMA_THREADS && Number(e.OLLAMA_THREADS) > 0 ? Math.floor(Number(e.OLLAMA_THREADS)) : null,
    // Blank scam_type: fill it from the note (rules at once, local AI in the background). false = keep "other".
    autoScamType: bool(e.AUTO_SCAM_TYPE, true),
    // Map layer B: malicious URLs from URLhaus (abuse.ch). Needs a free Auth-Key from https://auth.abuse.ch/.
    threatFeed: bool(e.THREAT_FEED, true),
    urlhausAuthKey: e.URLHAUS_AUTH_KEY?.trim() || null,
    urlhausApiBase: e.URLHAUS_API_BASE?.trim() || "https://urlhaus-api.abuse.ch/v1",
    rdapBase: e.RDAP_BASE?.trim() || "https://rdap.org",
    // abuse.ch asks for no more than one fetch every 5 minutes.
    threatFeedMinutes: Math.max(5, Number(e.THREAT_FEED_MINUTES ?? 5) || 5),
    threatFeedLimit: Math.min(1000, Math.max(10, Number(e.THREAT_FEED_LIMIT ?? 200) || 200)),
    threatFeedDns: bool(e.THREAT_FEED_DNS, true),
  };
}
