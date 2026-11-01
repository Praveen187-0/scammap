// Integrations setup helper (config/connectors.yaml + .env).
//
//   npm run integrations                    check every connector's .env values (and log in where it is safe to)
//   npm run integrations -- test [name|all] send a [TEST] alert through one output, or all active ones (server must run)
//   npm run integrations -- secret          print a random BANK_WEBHOOK_SECRET
//   npm run integrations -- serve-advisory  serve data/external/advisory-sample.json on http://localhost:9901
//
// "check" never sends a message: Telegram is checked with getMe, email with an SMTP login (no mail sent), webhooks
// and feeds with a plain GET. Secrets are never printed, only their length.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import nodemailer from "nodemailer";
import { normalizeIdentifier, parseIdentifierType } from "../shared/normalize.js";
import { parseConfig } from "../src/connectors/connectors.js";
import { loadDotEnv } from "../src/lib/dotenv.js";
import { describeNetworkError } from "../src/lib/deliver.js";

loadDotEnv();
const argv = process.argv.slice(2);
const arg = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const MODE = positional[0] ?? "check";
const BASE = (arg("base") ?? process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/+$/, "");
const C = { b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", x: "\x1b[0m" };
const ok = (s: string): void => console.log(`  ${C.g}✓${C.x} ${s}`);
const bad = (s: string): void => console.log(`  ${C.r}✗${C.x} ${s}`);
const warn = (s: string): void => console.log(`  ${C.y}!${C.x} ${s}`);
const tip = (s: string): void => console.log(`    ${C.d}${s}${C.x}`);
const env = (k: string): string => (process.env[k] ?? "").trim();
const TG_API = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");

async function get(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<{ status: number; text: string } | { error: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { error: describeNetworkError(e) };
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------------ per-connector checks (no messages are sent)
async function checkTelegram(): Promise<void> {
  console.log(`\n${C.b}area-alerts-telegram${C.x}  (TELEGRAM_BOT_TOKEN, TELEGRAM_ALERT_CHAT_ID)`);
  const token = env("TELEGRAM_BOT_TOKEN");
  const chat = env("TELEGRAM_ALERT_CHAT_ID");
  if (!token) {
    bad("TELEGRAM_BOT_TOKEN is empty");
    tip("Telegram > @BotFather > /newbot > copy the token (looks like 123456789:AA...)");
    return;
  }
  if (!/^\d{5,12}:[A-Za-z0-9_-]{30,}$/.test(token)) warn("the token doesn't look like 123456789:AA... (copy it again from @BotFather, no spaces or quotes)");
  let botName = "YourBotName";
  const r = await get(`${TG_API}/bot${token}/getMe`);
  if ("error" in r) bad(`could not reach Telegram: ${r.error}`);
  else {
    let j: { ok?: boolean; result?: { username?: string }; description?: string } = {};
    try {
      j = JSON.parse(r.text || "{}") as typeof j;
    } catch {
      j = { description: `HTTP ${r.status}, not a Telegram answer` };
    }
    if (j.ok && j.result?.username) botName = j.result.username;
    if (j.ok) ok(`token works: the bot is @${j.result?.username ?? "?"}`);
    else bad(`Telegram refused the token (${j.description ?? r.status}). Make a new one with /token in @BotFather.`);
  }
  if (!chat) {
    bad("TELEGRAM_ALERT_CHAT_ID is empty");
    tip(`Start the server, then send /chatid to @${botName} in a DM, or /chatid@${botName} in the group you added it to.`);
    tip("It replies with the line to paste into .env.");
  } else if (/^-?\d{5,20}$/.test(chat) || /^@[A-Za-z][A-Za-z0-9_]{4,}$/.test(chat)) ok(`chat id set (${chat.startsWith("-") ? "a group or channel" : chat.startsWith("@") ? "a public channel" : "a private chat"})`);
  else bad(`TELEGRAM_ALERT_CHAT_ID "${chat}" isn't a chat id (a number like -1001234567890, or @channelname)`);
}

async function checkSlack(): Promise<void> {
  console.log(`\n${C.b}fraud-team-slack${C.x}  (SLACK_WEBHOOK_URL)`);
  const url = env("SLACK_WEBHOOK_URL");
  if (!url) {
    bad("SLACK_WEBHOOK_URL is empty");
    tip("api.slack.com/apps > Create New App > From scratch > Incoming Webhooks > On > Add New Webhook > pick a channel > Allow > Copy");
    return;
  }
  if (/^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+$/.test(url)) ok("looks like a Slack incoming webhook URL (send a test to be sure: npm run integrations -- test fraud-team-slack)");
  else if (url.startsWith("https://hooks.slack.com/")) warn("starts like a Slack webhook but the shape is unusual: copy it again from the app's Incoming Webhooks page");
  else warn("not a hooks.slack.com URL: fine for a Slack-compatible service (Mattermost, Discord's /slack endpoint), otherwise copy it again");
}

async function checkBank(): Promise<void> {
  console.log(`\n${C.b}bank-fraud-desk${C.x}  (BANK_WEBHOOK_URL, BANK_WEBHOOK_SECRET; only Bengaluru and Mumbai events)`);
  const url = env("BANK_WEBHOOK_URL");
  const secret = env("BANK_WEBHOOK_SECRET");
  if (!url) {
    bad("BANK_WEBHOOK_URL is empty");
    tip("Local: run `npm run webhook-receiver` in a new terminal and use http://localhost:9900/scammap");
    tip("Online: open https://webhook.site and copy 'Your unique URL'");
  } else {
    let u: URL | null = null;
    try {
      u = new URL(url);
    } catch {
      bad(`"${url}" is not a URL`);
    }
    if (u) {
      const r = await get(url, {}, 5000);
      if ("error" in r) bad(`nothing answers at ${u.origin} (${r.error})${u.hostname === "localhost" || u.hostname === "127.0.0.1" ? ": is `npm run webhook-receiver` running?" : ""}`);
      else ok(`reachable (${u.origin} answered HTTP ${r.status} to a GET)`);
    }
  }
  if (!secret) {
    bad("BANK_WEBHOOK_SECRET is empty");
    tip("Make one: npm run integrations -- secret");
  } else if (secret.length < 16) warn(`secret is only ${secret.length} characters: use 32 or more (npm run integrations -- secret)`);
  else ok(`secret set (${secret.length} characters; the receiver must use the same value)`);
}

async function checkEmail(): Promise<void> {
  console.log(`\n${C.b}alerts-by-email${C.x}  (SMTP_URL, ALERT_EMAIL_FROM, ALERT_EMAIL_TO)`);
  const smtp = env("SMTP_URL");
  const from = env("ALERT_EMAIL_FROM");
  const to = env("ALERT_EMAIL_TO");
  for (const [k, v] of [["SMTP_URL", smtp], ["ALERT_EMAIL_FROM", from], ["ALERT_EMAIL_TO", to]] as const) if (!v) bad(`${k} is empty`);
  if (!smtp) {
    tip("Gmail: turn on 2-Step Verification, make an app password at myaccount.google.com/apppasswords, then");
    tip("SMTP_URL=smtps://you%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465   (app password without spaces)");
    return;
  }
  let u: URL;
  try {
    u = new URL(smtp);
  } catch {
    bad("SMTP_URL is not a URL. Format: smtps://USER:PASSWORD@HOST:465  (or smtp://...:587)");
    return;
  }
  if (u.protocol !== "smtp:" && u.protocol !== "smtps:") bad(`SMTP_URL must start with smtps:// (port 465) or smtp:// (port 587), not ${u.protocol}//`);
  if (!u.username || !u.password) bad("SMTP_URL has no user or password (smtps://USER:PASSWORD@HOST:465)");
  if (/\s/.test(smtp) || smtp.includes("%20")) bad("SMTP_URL contains spaces: Gmail shows the app password in 4 groups, type it without the spaces");
  if (u.protocol === "smtps:" && u.port === "587") warn("port 587 uses STARTTLS: write smtp://...:587 (or keep smtps:// with port 465)");
  if (u.hostname.includes("gmail") && from && !from.toLowerCase().includes(decodeURIComponent(u.username).toLowerCase())) warn("Gmail sends from the account you log in with: ALERT_EMAIL_FROM should use that address");
  if (from && !/@/.test(from)) bad(`ALERT_EMAIL_FROM "${from}" has no email address (e.g. ScamMap Alerts <you@gmail.com>)`);
  if (to && !to.split(",").every((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.trim().replace(/^.*<|>$/g, "")))) bad("ALERT_EMAIL_TO should be one or more addresses separated by commas");
  try {
    const t = nodemailer.createTransport({ url: smtp, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
    await t.verify();
    ok(`logged in to ${u.hostname}:${u.port || (u.protocol === "smtps:" ? 465 : 587)} as ${decodeURIComponent(u.username)} (no email was sent)`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    bad(`SMTP login failed: ${m.slice(0, 160)}`);
    if (/535|BadCredentials|Username and Password/i.test(m)) tip("Gmail needs an app password (not your normal password): myaccount.google.com/apppasswords");
    if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(m)) tip("Port blocked or wrong host. On college or office Wi-Fi try a phone hotspot, or port 587 with smtp://");
  }
}

async function checkAdvisory(): Promise<void> {
  console.log(`\n${C.b}advisory-feed${C.x}  (ADVISORY_FEED_URL)`);
  const url = env("ADVISORY_FEED_URL");
  if (!url) {
    bad("ADVISORY_FEED_URL is empty");
    tip("Local: npm run integrations -- serve-advisory   then ADVISORY_FEED_URL=http://localhost:9901/advisory.json");
    tip("Online: put data/external/advisory-sample.json in a GitHub Gist and use its Raw URL");
    return;
  }
  const r = await get(url, { headers: { accept: "application/json" } }, 15_000);
  if ("error" in r) {
    bad(`could not fetch the feed: ${r.error}`);
    return;
  }
  if (r.status !== 200) {
    bad(`the feed answered HTTP ${r.status}`);
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(r.text);
  } catch {
    bad("the feed is not JSON (for a Gist, use the Raw button's URL, not the Gist page)");
    return;
  }
  const list = Array.isArray(body) ? body : (body as { items?: unknown }).items;
  if (!Array.isArray(list)) {
    bad('expected a JSON array, or { "items": [...] }, of { "type", "value", "label" }');
    return;
  }
  let good = 0;
  const problems: string[] = [];
  for (const [i, x] of list.entries()) {
    const it = x as { type?: unknown; value?: unknown };
    const type = parseIdentifierType(String(it.type ?? ""));
    const n = type ? normalizeIdentifier(type, String(it.value ?? "")) : null;
    if (n?.ok) good++;
    else if (problems.length < 3) problems.push(`item ${i + 1}: ${type ? (n && !n.ok ? n.error : "bad value") : `unknown type "${String(it.type)}"`}`);
  }
  if (good) ok(`${good} of ${list.length} items are usable identifiers`);
  else bad("no usable identifiers in the feed");
  for (const p of problems) warn(p);
}

function checkFiles(): void {
  const file = path.resolve(process.env.CONNECTORS_FILE ?? "config/connectors.yaml");
  console.log(`${C.b}${C.c}ScamMap integrations check${C.x}  ${C.d}${path.relative(process.cwd(), file)} + .env (secrets are never printed)${C.x}`);
  if (!existsSync(file)) {
    bad(`${file} not found`);
    return;
  }
  try {
    const cfg = parseConfig(readFileSync(file, "utf8"));
    const on = [...cfg.outputs, ...cfg.inputs].filter((c) => c.enabled !== false && c.missing.length === 0).map((c) => c.name);
    ok(`config is valid: ${cfg.outputs.length} outputs, ${cfg.inputs.length} inputs; ready: ${on.join(", ") || "none"}`);
  } catch (e) {
    bad(`config is invalid: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
  }
  if (!existsSync(".env")) warn("no .env file here: copy .env.example to .env (cp .env.example .env)");
}

// ------------------------------------------------------------------ test sends through the running server
async function runTests(which: string): Promise<void> {
  const st = await get(`${BASE}/connectors`);
  if ("error" in st) {
    bad(`the server isn't answering at ${BASE} (${st.error}). Start it with npm run dev.`);
    process.exitCode = 1;
    return;
  }
  if (st.status !== 200) {
    bad(`GET /connectors answered HTTP ${st.status}${st.status === 403 ? " (licence locked or expired)" : ""}`);
    process.exitCode = 1;
    return;
  }
  const status = JSON.parse(st.text) as { outputs: Array<{ name: string; active: boolean; off_reason: string | null }> };
  const targets = which === "all" ? status.outputs : status.outputs.filter((o) => o.name === which);
  if (!targets.length) {
    bad(`no output called "${which}". Outputs: ${status.outputs.map((o) => o.name).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${C.b}${C.c}Sending [TEST] alerts through ${BASE}${C.x}`);
  for (const o of targets) {
    if (!o.active) {
      warn(`${o.name}: off (${o.off_reason ?? "?"})`);
      continue;
    }
    const r = await get(`${BASE}/connectors/test`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.CONNECTOR_TEST_TOKEN ? { "x-connector-test-token": process.env.CONNECTOR_TEST_TOKEN } : {}) },
      body: JSON.stringify({ name: o.name }),
    }, 40_000);
    if ("error" in r) bad(`${o.name}: ${r.error}`);
    else {
      let j: { ok?: boolean; error?: string | null } = {};
      try {
        j = JSON.parse(r.text || "{}") as typeof j;
      } catch {
        j = { error: `HTTP ${r.status}` };
      }
      if (j.ok) ok(`${o.name}: sent. Check the channel / inbox / receiver.`);
      else bad(`${o.name}: ${j.error ?? `HTTP ${r.status}`}`);
    }
  }
}

function serveAdvisory(): void {
  const port = Number(arg("port") ?? 9901);
  const file = path.resolve(arg("file") ?? "data/external/advisory-sample.json");
  if (!existsSync(file)) {
    bad(`${file} not found`);
    process.exit(1);
  }
  createServer((req, res) => {
    // Re-read on every request, so edits to the file show up at the next poll (or when connectors.yaml is saved).
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(readFileSync(file));
    console.log(`${new Date().toLocaleTimeString("en-IN", { hour12: false })}  served ${path.basename(file)} to ${req.socket.remoteAddress ?? "?"}`);
  }).listen(port, () => {
    console.log(`${C.b}Advisory feed${C.x} on http://localhost:${port}/advisory.json  (${path.relative(process.cwd(), file)})`);
    console.log(`In .env:  ADVISORY_FEED_URL=http://localhost:${port}/advisory.json   then restart the server.`);
    console.log(`${C.d}Ctrl+C to stop.${C.x}`);
  });
}

async function main(): Promise<void> {
  if (MODE === "secret") {
    console.log(`BANK_WEBHOOK_SECRET=${randomBytes(24).toString("hex")}`);
    return;
  }
  if (MODE === "serve-advisory") return serveAdvisory();
  if (MODE === "test") return runTests(positional[1] ?? "all");
  if (MODE !== "check") {
    console.log("usage: npm run integrations [-- check | test [name|all] | secret | serve-advisory]");
    process.exitCode = 1;
    return;
  }
  checkFiles();
  await checkTelegram();
  await checkSlack();
  await checkBank();
  await checkEmail();
  await checkAdvisory();
  console.log(`\n${C.d}After editing .env, restart the server (Ctrl+C, then npm run dev). Then: npm run integrations -- test all${C.x}`);
}

void main();
