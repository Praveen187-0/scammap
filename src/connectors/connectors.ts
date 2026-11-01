// Config-driven integrations: config/connectors.yaml declares outputs (Telegram, Slack, generic webhooks, email)
// and inputs (CSV files, JSON feeds of known scam identifiers). Adding or changing one is an edit to that file; the
// server reloads it within seconds, with no restart and no code. Secrets come from environment variables (${VAR}).
import { existsSync, readFileSync, unwatchFile, watchFile } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { normalizeIdentifier, parseIdentifierType } from "../../shared/normalize.js";
import { SCAM_TYPE_BY_SLUG } from "../../shared/scamTypes.js";
import type { Pool } from "../db/db.js";
import { readCsv } from "../datasets/csv.js";
import { logDelivery, postJson, signBody } from "../lib/deliver.js";
import type { LiveBus, LiveEvent } from "../live/bus.js";
import { logError, logInfo, logWarn } from "../log.js";

const EventName = z.enum(["alert", "defence", "report"]);
const Filter = z.object({
  areas: z.array(z.string()).optional(),
  cities: z.array(z.string()).optional(),
  scam_types: z.array(z.string()).optional(),
}).optional();
const Common = { name: z.string().min(1).max(60), enabled: z.boolean().optional(), on: z.array(EventName).min(1), filter: Filter, lang: z.enum(["en", "hi"]).optional(), template: z.string().max(500).optional() };
const Output = z.discriminatedUnion("type", [
  z.object({ type: z.literal("telegram"), bot_token: z.string(), chat_id: z.union([z.string(), z.number()]).transform(String), ...Common }),
  z.object({ type: z.literal("slack"), webhook_url: z.string(), ...Common }),
  z.object({ type: z.literal("webhook"), url: z.string(), secret: z.string().optional(), ...Common }),
  z.object({ type: z.literal("email"), smtp_url: z.string(), from: z.string(), to: z.string(), ...Common }),
]);
const Input = z.discriminatedUnion("type", [
  z.object({ type: z.literal("csv_file"), name: z.string().min(1).max(60), path: z.string(), label: z.string().optional(), enabled: z.boolean().optional() }),
  z.object({ type: z.literal("json_url"), name: z.string().min(1).max(60), url: z.string(), label: z.string().optional(), every_minutes: z.number().min(5).max(1440).optional(), enabled: z.boolean().optional() }),
]);
const Config = z.object({ outputs: z.array(Output).optional().default([]), inputs: z.array(Input).optional().default([]) });
export type OutputConfig = z.infer<typeof Output>;
export type InputConfig = z.infer<typeof Input>;

/** ${VAR} -> environment value. Unset variables become "" (and the connector is switched off with a reason). */
export function interpolate(text: string, env: NodeJS.ProcessEnv = process.env, escape: (v: string) => string = (v) => v): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, k: string) => {
    const v = env[k]?.trim();
    if (!v) missing.push(k);
    return escape(v ?? "");
  });
  return { text: out, missing };
}

export function parseConfig(yamlText: string, env: NodeJS.ProcessEnv = process.env): { outputs: Array<OutputConfig & { missing: string[] }>; inputs: Array<InputConfig & { missing: string[] }> } {
  const raw = parseYaml(yamlText) as unknown;
  const parsed = Config.parse(raw ?? {});
  const fill = <T extends object>(o: T): T & { missing: string[] } => {
    // Values are JSON-escaped, so a password or display name with " or \ cannot break the config.
    const { text, missing } = interpolate(JSON.stringify(o), env, (v) => JSON.stringify(v).slice(1, -1));
    return { ...(JSON.parse(text) as T), missing };
  };
  return { outputs: parsed.outputs.map(fill), inputs: parsed.inputs.map(fill) };
}

export function matchesFilter(o: OutputConfig, e: LiveEvent): boolean {
  if (e.type === "classified") return false; // internal: never sent to integrations
  if (!o.on.includes(e.type)) return false;
  if (e.type === "report" && (e as { replay?: boolean }).replay) return false;
  const f = o.filter;
  if (!f) return true;
  if (f.areas?.length && !f.areas.includes(e.pincode)) return false;
  if (f.cities?.length && !f.cities.some((c) => c.toLowerCase() === e.city.toLowerCase())) return false;
  const type = e.type === "alert" ? e.alert.type === "NEW_TYPE" ? e.alert.scam_type : null : e.scam_type;
  if (f.scam_types?.length && (!type || !f.scam_types.includes(type))) return false;
  return true;
}

const DEFENCE_TEXT: Record<string, [string, string]> = {
  COORDINATED_BURST: ["a coordinated burst of fake reports", "नकली रिपोर्ट की मिली-जुली बाढ़"],
  SYBIL_RING: ["many accounts on one network", "एक नेटवर्क से कई खाते"],
  SUBNET_CLUSTER: ["accounts rotating through one network block", "एक नेटवर्क ब्लॉक में पते बदलते खाते"],
  COPY_PASTE_NOTES: ["copy-pasted complaints", "कॉपी-पेस्ट शिकायतें"],
  SPAM_REPEAT: ["one person reporting again and again", "एक ही व्यक्ति बार-बार"],
  PERSONAL_DISPUTE: ["a personal grudge report", "निजी रंजिश वाली रिपोर्ट"],
  VERIFIED_TARGET: ["reports against a verified business", "सत्यापित व्यवसाय के ख़िलाफ़ रिपोर्ट"],
  RATE_LIMITED: ["too many reports from one device", "एक डिवाइस से बहुत रिपोर्ट"],
};

export function formatEvent(e: LiveEvent, lang: "en" | "hi" = "en", template?: string): string {
  const area = lang === "hi" ? e.locality_hi : e.locality;
  const type = e.type === "alert" ? "" : SCAM_TYPE_BY_SLUG.get(e.scam_type)?.[lang] ?? e.scam_type;
  let text: string;
  if (e.type === "alert") text = lang === "hi" ? `अलर्ट: ${e.alert.message_hi}` : `Alert: ${e.alert.message_en}`;
  else if (e.type === "defence") {
    const d = DEFENCE_TEXT[e.kind] ?? [e.kind, e.kind];
    const extra = e.reports < 2 ? "" : e.kind === "VERIFIED_TARGET" ? (lang === "hi" ? ` (${e.reports} रिपोर्ट अलग रखी गईं)` : ` (${e.reports} reports set aside)`) : lang === "hi" ? ` (${e.reports} रिपोर्ट, एक व्यक्ति गिनी गईं)` : ` (${e.reports} reports counted as one person)`;
    text = lang === "hi" ? `${area} में रोका गया: ${d[1]}${extra}` : `Blocked in ${area}: ${d[0]}${extra}`;
  } else if (e.type === "classified") text = lang === "hi" ? `${area}: नोट से प्रकार पहचाना गया: ${type}` : `${area}: scam type read from the note: ${type}`;
  else text = lang === "hi" ? `${area}, ${e.city} में ${type} की नई रिपोर्ट (${e.channel})` : `New report in ${area}, ${e.city}: ${type} (${e.channel})`;
  if (!template) return text;
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const vals: Record<string, string> = { text, area: area, city: e.city, pincode: e.pincode, type: e.type, at: e.at, scam_type: type };
    return vals[k] ?? "";
  });
}

interface OutputState {
  cfg: OutputConfig & { missing: string[] };
  sent: number;
  failed: number;
  dropped: number;
  window: number[];
  last_ok_at: string | null;
  last_error: string | null;
  lastTest?: number;
}
interface InputState {
  cfg: InputConfig & { missing: string[] };
  items: number;
  last_ok_at: string | null;
  last_error: string | null;
  timer: ReturnType<typeof setInterval> | null;
}

export class Connectors {
  private outputs: OutputState[] = [];
  private inputs: InputState[] = [];
  private external = new Map<string, Array<{ source: string; label: string }>>();
  private unsubscribe: (() => void) | null = null;
  private error: string | null = null;
  readonly file: string;

  constructor(private readonly pool: Pool, private readonly bus: LiveBus, file?: string, private readonly telegramApi = process.env.TELEGRAM_API_BASE || "https://api.telegram.org") {
    this.file = path.resolve(file ?? process.env.CONNECTORS_FILE ?? "config/connectors.yaml");
  }

  async start(): Promise<void> {
    await this.loadExternal();
    await this.reload();
    this.unsubscribe = this.bus.subscribe((e) => this.dispatch(e));
    if (existsSync(this.file)) watchFile(this.file, { interval: 2000 }, () => void this.reload());
  }

  stop(): void {
    this.unsubscribe?.();
    unwatchFile(this.file);
    for (const i of this.inputs) if (i.timer) clearInterval(i.timer);
  }

  async reload(): Promise<void> {
    for (const i of this.inputs) if (i.timer) clearInterval(i.timer);
    if (!existsSync(this.file)) {
      this.outputs = [];
      this.inputs = [];
      return;
    }
    try {
      const cfg = parseConfig(readFileSync(this.file, "utf8"));
      const old = new Map(this.outputs.map((o) => [o.cfg.name, o]));
      this.outputs = cfg.outputs.map((c) => ({ ...(old.get(c.name) ?? { sent: 0, failed: 0, dropped: 0, window: [], last_ok_at: null, last_error: null }), cfg: c }));
      this.inputs = cfg.inputs.map((c) => ({ cfg: c, items: 0, last_ok_at: null, last_error: null, timer: null }));
      this.error = null;
      for (const i of this.inputs) {
        if (!this.active(i.cfg)) continue;
        void this.runInput(i);
        if (i.cfg.type === "json_url") {
          i.timer = setInterval(() => void this.runInput(i), (i.cfg.every_minutes ?? 30) * 60_000);
          i.timer.unref();
        }
      }
      logInfo("connectors loaded", { outputs: this.outputs.filter((o) => this.active(o.cfg)).length, inputs: this.inputs.filter((i) => this.active(i.cfg)).length });
    } catch (e) {
      this.error = e instanceof Error ? e.message.slice(0, 300) : "invalid config";
      logWarn(`connectors config invalid: ${this.error}`);
    }
  }

  private active(c: { enabled?: boolean; missing: string[] }): boolean {
    return c.enabled !== false && c.missing.length === 0;
  }

  private dispatch(e: LiveEvent): void {
    if ((e as { replay?: boolean }).replay) return;
    for (const o of this.outputs) {
      if (!this.active(o.cfg) || !matchesFilter(o.cfg, e)) continue;
      const now = Date.now();
      o.window = o.window.filter((t) => now - t < 60_000);
      if (o.window.length >= 30) {
        o.dropped++;
        continue;
      }
      o.window.push(now);
      void this.send(o, e);
    }
  }

  /** Sends a clearly marked test alert through one output, ignoring its filters. For setting things up. */
  async test(name: string): Promise<{ ok: boolean; error: string | null }> {
    const o = this.outputs.find((x) => x.cfg.name === name);
    if (!o) return { ok: false, error: `no output called ${name} in ${path.basename(this.file)}` };
    if (!this.active(o.cfg)) return { ok: false, error: o.cfg.enabled === false ? "disabled in config" : `set ${o.cfg.missing.join(", ")} in .env, then restart the server` };
    const now = Date.now();
    if (o.lastTest && now - o.lastTest < 5000) return { ok: false, error: "wait a few seconds between tests" };
    o.lastTest = now;
    const e: LiveEvent = {
      id: 0, at: new Date(now).toISOString(), pincode: "560102", locality: "HSR Layout", locality_hi: "एचएसआर लेआउट", city: "Bengaluru", type: "alert",
      alert: {
        type: "SPIKE", pincode: "560102", window: "24h", count: 12, baseline_per_day: 1.5, locality: "HSR Layout",
        message_en: "[TEST] ScamMap is connected. Real alerts look like this: scam reports in HSR Layout jumped to 12 in 24 hours.",
        message_hi: "[परीक्षण] ScamMap जुड़ गया है। असली अलर्ट ऐसे दिखेंगे: HSR लेआउट में 24 घंटे में स्कैम रिपोर्ट 12 हो गईं।",
      },
    };
    return this.send(o, e, { retries: 1 });
  }

  private async send(o: OutputState, e: LiveEvent, opts: { retries?: number } = {}): Promise<{ ok: boolean; error: string | null }> {
    const c = o.cfg;
    const text = formatEvent(e, c.lang ?? "en", c.template);
    try {
      let ok = false;
      let err: string | null = null;
      if (c.type === "telegram") {
        const r = await postJson(`${this.telegramApi}/bot${c.bot_token}/sendMessage`, { chat_id: c.chat_id, text, disable_web_page_preview: true }, {}, opts);
        ok = r.ok;
        err = r.error;
        await logDelivery(this.pool, `connector:${c.name}`, e.type, r);
      } else if (c.type === "slack") {
        const r = await postJson(c.webhook_url, { text }, {}, opts);
        ok = r.ok;
        err = r.error;
        await logDelivery(this.pool, `connector:${c.name}`, e.type, r);
      } else if (c.type === "webhook") {
        const body = JSON.stringify({ event: e.type, text, data: e });
        const r = await postJson(c.url, body, { "x-scammap-event": e.type, ...(c.secret ? { "x-scammap-signature": signBody(c.secret, body) } : {}) }, opts);
        ok = r.ok;
        err = r.error;
        await logDelivery(this.pool, `connector:${c.name}`, e.type, r);
      } else {
        const t = nodemailer.createTransport({ url: c.smtp_url, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });
        await t.sendMail({ from: c.from, to: c.to, subject: `${e.id === 0 ? "[TEST] " : ""}ScamMap: ${e.type === "alert" ? "area alert" : e.type === "defence" ? "attack blocked" : "new report"} in ${e.locality}`, text });
        ok = true;
      }
      if (ok) {
        o.sent++;
        o.last_ok_at = new Date().toISOString();
        o.last_error = null;
      } else {
        o.failed++;
        o.last_error = err;
      }
      return { ok, error: ok ? null : err };
    } catch (x) {
      o.failed++;
      o.last_error = x instanceof Error ? x.message.slice(0, 200) : "send failed";
      return { ok: false, error: o.last_error };
    }
  }

  private async runInput(i: InputState): Promise<void> {
    try {
      let rows: Array<{ type: string; value: string; label?: string }> = [];
      if (i.cfg.type === "csv_file") {
        const file = path.resolve(i.cfg.path);
        if (!existsSync(file)) throw new Error(`file not found: ${i.cfg.path}`);
        let header: string[] | null = null;
        for await (const row of readCsv(file)) {
          if (!header) {
            header = row.map((h) => h.trim().toLowerCase());
            continue;
          }
          const get = (k: string): string => row[header!.indexOf(k)] ?? "";
          rows.push({ type: get("type"), value: get("value"), label: get("label") });
        }
      } else {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 15_000);
        const res = await fetch(i.cfg.url, { signal: ctrl.signal, headers: { accept: "application/json" } });
        clearTimeout(t);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as unknown;
        const list = Array.isArray(body) ? body : (body as { items?: unknown }).items;
        if (!Array.isArray(list)) throw new Error("expected a JSON array of {type, value, label}");
        rows = list.slice(0, 50_000).map((x) => x as { type: string; value: string; label?: string });
      }
      const keys: string[] = [];
      const labels: string[] = [];
      for (const r of rows) {
        const type = parseIdentifierType(r.type);
        if (!type) continue;
        const n = normalizeIdentifier(type, r.value);
        if (!n.ok) continue;
        keys.push(n.key);
        labels.push(String(r.label ?? i.cfg.label ?? i.cfg.name).slice(0, 120));
      }
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM external_flags WHERE source = $1", [i.cfg.name]);
        if (keys.length) {
          await client.query(
            "INSERT INTO external_flags (source, ident_key, label) SELECT $1, k, l FROM unnest($2::text[], $3::text[]) AS t(k, l) ON CONFLICT DO NOTHING",
            [i.cfg.name, keys, labels],
          );
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
      i.items = keys.length;
      i.last_ok_at = new Date().toISOString();
      i.last_error = null;
      await this.loadExternal();
    } catch (e) {
      i.last_error = e instanceof Error ? e.message.slice(0, 200) : "input failed";
      logError(`connector input ${i.cfg.name} failed`, e);
    }
  }

  private async loadExternal(): Promise<void> {
    const rows = (await this.pool.query<{ source: string; ident_key: string; label: string }>("SELECT source, ident_key, label FROM external_flags")).rows;
    const m = new Map<string, Array<{ source: string; label: string }>>();
    for (const r of rows) m.set(r.ident_key, [...(m.get(r.ident_key) ?? []), { source: r.source, label: r.label }]);
    this.external = m;
  }

  /** "Also listed by" for one identifier. Never changes the community verdict. */
  listedBy(identKey: string): Array<{ source: string; label: string }> {
    return this.external.get(identKey) ?? [];
  }

  status(): { file: string; error: string | null; outputs: unknown[]; inputs: unknown[] } {
    const why = (m: string[], enabled?: boolean): string | null => (enabled === false ? "disabled in config" : m.length ? `set ${m.join(", ")} in .env, then restart the server` : null);
    return {
      file: path.relative(process.cwd(), this.file),
      error: this.error,
      outputs: this.outputs.map((o) => ({ name: o.cfg.name, type: o.cfg.type, on: o.cfg.on, active: this.active(o.cfg), off_reason: why(o.cfg.missing, o.cfg.enabled), sent: o.sent, failed: o.failed, dropped: o.dropped, last_ok_at: o.last_ok_at, last_error: o.last_error })),
      inputs: this.inputs.map((i) => ({ name: i.cfg.name, type: i.cfg.type, active: this.active(i.cfg), off_reason: why(i.cfg.missing, i.cfg.enabled), items: i.items, last_ok_at: i.last_ok_at, last_error: i.last_error })),
    };
  }
}
