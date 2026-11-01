// Minimal client for a LOCAL Ollama server (https://ollama.com). It runs on this machine, so report notes sent to it
// never leave the computer. By default only localhost / private-network addresses are accepted for OLLAMA_URL.
// Prompts and replies are never logged.
import { logInfo, logWarn } from "../log.js";

export interface OllamaConfig {
  url: string;
  model: string;
  timeoutMs: number;
  allowRemote: boolean;
  /** CPU threads the model may use: leave cores free so lookups stay fast while a note is being read. */
  threads: number | null;
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|host\.docker\.internal)$/i;

export function isLocalUrl(u: string): boolean {
  try {
    return LOCAL_HOST.test(new URL(u).hostname);
  } catch {
    return false;
  }
}

export class Ollama {
  private readonly base: string;
  private ready: { ok: boolean; at: number; reason: string | null; models: string[] } = { ok: false, at: 0, reason: "not checked yet", models: [] };

  constructor(private readonly cfg: OllamaConfig) {
    this.base = cfg.url.replace(/\/+$/, "");
  }

  get model(): string {
    return this.cfg.model;
  }
  get url(): string {
    return this.base;
  }

  /** Is the server up and the model pulled? Cached for 30 s. */
  async check(force = false): Promise<{ ok: boolean; reason: string | null; models: string[] }> {
    if (!force && Date.now() - this.ready.at < 30_000) return this.ready;
    let next: typeof this.ready;
    if (!this.cfg.allowRemote && !isLocalUrl(this.base)) {
      next = { ok: false, at: Date.now(), reason: "OLLAMA_URL must point to this computer or your private network (set OLLAMA_ALLOW_REMOTE=true to override)", models: [] };
    } else {
      try {
        const r = await fetch(`${this.base}/api/tags`, { signal: AbortSignal.timeout(2500) });
        const body = (await r.json()) as { models?: Array<{ name?: string; model?: string }> };
        const models = (body.models ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean);
        const want = this.cfg.model.includes(":") ? this.cfg.model : `${this.cfg.model}:latest`;
        const has = models.some((m) => m === this.cfg.model || m === want);
        next = { ok: has, at: Date.now(), reason: has ? null : `model ${this.cfg.model} is not pulled yet: run  ollama pull ${this.cfg.model}`, models };
      } catch {
        next = { ok: false, at: Date.now(), reason: `Ollama is not running at ${this.base} (start the Ollama app, or run: ollama serve)`, models: [] };
      }
    }
    if (next.ok !== this.ready.ok || next.reason !== this.ready.reason) {
      if (next.ok) logInfo(`local AI ready: ${this.cfg.model} at ${this.base}`);
      else if (this.ready.at) logWarn(`local AI unavailable: ${next.reason ?? "unknown"}`);
    }
    this.ready = next;
    return next;
  }

  /** One chat turn with the reply constrained to a JSON schema (Ollama structured outputs). Null on any failure. */
  async json<T>(system: string, user: string, schema: Record<string, unknown>, parse: (v: unknown) => T | null): Promise<{ data: T; ms: number } | null> {
    const t0 = performance.now();
    try {
      const r = await fetch(`${this.base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.cfg.model,
          stream: false,
          format: schema,
          keep_alive: "30m",
          options: { temperature: 0, num_predict: 400, ...(this.cfg.threads ? { num_thread: this.cfg.threads } : {}) },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      if (!r.ok) {
        if (r.status === 404) this.ready = { ok: false, at: Date.now(), reason: `model ${this.cfg.model} is not pulled yet: run  ollama pull ${this.cfg.model}`, models: [] };
        return null;
      }
      const body = (await r.json()) as { message?: { content?: string } };
      const text = body.message?.content ?? "";
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start < 0 || end <= start) return null;
      const data = parse(JSON.parse(text.slice(start, end + 1)) as unknown);
      return data ? { data, ms: Math.round(performance.now() - t0) } : null;
    } catch {
      return null;
    }
  }
}
