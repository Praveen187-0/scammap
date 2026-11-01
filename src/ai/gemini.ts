// Minimal Gemini REST client with structured (JSON-schema) output. No SDK dependency.
// Every call is optional: with no GEMINI_API_KEY, or on any error or timeout, callers get null and fall back
// to the offline rules. Prompts and replies are never logged (privacy rule 5).
import { logWarn } from "../log.js";

export interface GeminiConfig {
  apiKey: string | null;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  modelVersion?: string;
}

export interface GeminiReply<T> {
  data: T;
  model: string;
}

export class Gemini {
  private disabledUntil = 0;
  private fallbackModel = "gemini-flash-latest";

  constructor(private readonly cfg: GeminiConfig) {}

  get enabled(): boolean {
    return Boolean(this.cfg.apiKey);
  }
  get model(): string {
    return this.cfg.model;
  }

  /**
   * Ask for JSON matching `schema`, then validate it with `parse` (a Zod parser). Returns null on any failure.
   * The untrusted text goes only in the user turn; the system instruction says it is data, not instructions.
   */
  async json<T>(system: string, user: string, schema: Record<string, unknown>, parse: (v: unknown) => T | null, maxTokens = 1200): Promise<GeminiReply<T> | null> {
    if (!this.cfg.apiKey || Date.now() < this.disabledUntil) return null;
    for (const model of [this.cfg.model, this.fallbackModel]) {
      const res = await this.call(model, system, user, schema, maxTokens);
      if (res === "retry-other-model") continue;
      if (!res) return null;
      const data = parse(res.json);
      return data ? { data, model: res.model } : null;
    }
    return null;
  }

  private async call(model: string, system: string, user: string, schema: Record<string, unknown>, maxTokens: number): Promise<{ json: unknown; model: string } | null | "retry-other-model"> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.cfg.apiKey ?? "" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, maxOutputTokens: maxTokens },
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      if (r.status === 404 && model !== this.fallbackModel) {
        logWarn(`Gemini model "${model}" not found; trying ${this.fallbackModel}. Set GEMINI_MODEL to a current model.`);
        return "retry-other-model";
      }
      if (r.status === 401 || r.status === 403) {
        logWarn("Gemini rejected the API key (check GEMINI_API_KEY). AI features paused for 10 minutes.");
        this.disabledUntil = Date.now() + 10 * 60_000;
        return null;
      }
      if (r.status === 429) {
        logWarn("Gemini quota reached; using offline rules for 1 minute.");
        this.disabledUntil = Date.now() + 60_000;
        return null;
      }
      if (!r.ok) {
        logWarn(`Gemini request failed with HTTP ${r.status}`);
        return null;
      }
      const body = (await r.json()) as GeminiResponse;
      const text = (body.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
      if (!text) return null;
      return { json: JSON.parse(text.replace(/^```(json)?\s*|\s*```$/g, "")) as unknown, model: body.modelVersion ?? model };
    } catch (e) {
      logWarn(`Gemini call failed: ${e instanceof Error ? e.name : "error"}`);
      return null;
    }
  }
}
