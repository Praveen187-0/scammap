// In-memory view of the imported datasets. The server reloads it when `npm run import-data` changes the tables,
// so no restart is needed. Everything here is optional: with no datasets imported, features simply say so.
import type { Pool } from "../db/db.js";
import { logError, logInfo } from "../log.js";
import { crossValidate, scoreNb, SimilarityIndex, topScamWords, trainNb, type LabelledText, type NbModel, type TextMetrics } from "./textModel.js";

export interface SimilarMessage {
  label: "scam" | "ham";
  text: string;
  similarity: number;
  lang: string;
  source: string;
}
export interface TextVerdict {
  available: boolean;
  p_scam: number;
  coverage: number;
  words: string[];
  similar: SimilarMessage[];
  metrics: TextMetrics | null;
  sources: string[];
}

export interface DatasetSummary {
  sources: Array<{ source: string; kind: string; file_name: string; rows: number; citation: string; imported_at: string }>;
  messages: null | {
    total: number;
    scam: number;
    ham: number;
    by_lang: Array<{ key: string; scam: number; ham: number }>;
    by_category: Array<{ key: string; scam: number; ham: number }>;
    top_words: string[];
    metrics: TextMetrics;
  };
  cards: null | {
    total: number;
    fraud: number;
    fraud_rate: number;
    amount_fraud: number;
    by_hour: Array<{ hour: number; tx: number; fraud: number }>;
    by_amount: Array<{ key: string; tx: number; fraud: number }>;
    model: { precision: number; recall: number; f1: number; average_precision: number; threshold: number; tp: number; fp: number; fn: number; tn: number; fraud_amount_total: number; fraud_amount_caught: number } | null;
    test_rows: number;
  };
}

export interface CardRow {
  id: number;
  t: number;
  amount: number;
  score: number;
  fraud: boolean;
}

export class DatasetStore {
  private nb: NbModel | null = null;
  private index: SimilarityIndex | null = null;
  private docs: LabelledText[] = [];
  private metrics: TextMetrics | null = null;
  private signature = "";
  private summaryCache: DatasetSummary | null = null;
  private cardThreshold = 0.5;

  constructor(private readonly pool: Pool) {}

  /** Cheap check, safe to call every minute: reloads only when an import changed something. */
  async refresh(): Promise<void> {
    try {
      const sig = (await this.pool.query<{ s: string }>(
        "SELECT coalesce(string_agg(source || ':' || rows || ':' || extract(epoch FROM imported_at)::bigint, ',' ORDER BY source), '') AS s FROM dataset_sources",
      )).rows[0]?.s ?? "";
      if (sig === this.signature) return;
      const rows = (await this.pool.query<{ id: number; message: string; label: "scam" | "ham"; lang: string; category: string; source: string }>(
        "SELECT id, message, label, lang, category, source FROM dataset_messages ORDER BY id",
      )).rows;
      this.docs = rows.map((r) => ({ id: r.id, text: r.message, label: r.label, lang: r.lang, category: r.category, source: r.source }));
      this.nb = this.docs.length >= 20 ? trainNb(this.docs) : null;
      this.index = this.docs.length ? new SimilarityIndex(this.docs) : null;
      this.metrics = this.docs.length >= 20 ? crossValidate(this.docs) : null;
      const card = (await this.pool.query<{ metrics: { test?: { threshold?: number } } }>("SELECT metrics FROM dataset_models WHERE name = 'card_lr'")).rows[0];
      this.cardThreshold = card?.metrics.test?.threshold ?? 0.5;
      this.summaryCache = null;
      this.signature = sig;
      if (sig) logInfo("datasets loaded", { messages: this.docs.length, text_model: Boolean(this.nb) });
    } catch (e) {
      logError("dataset refresh failed", e);
    }
  }

  get hasMessages(): boolean {
    return this.nb !== null;
  }

  /** Dataset model score plus the closest labelled examples. */
  analyze(text: string): TextVerdict {
    if (!this.nb || !this.index) return { available: false, p_scam: 0, coverage: 0, words: [], similar: [], metrics: null, sources: [] };
    const s = scoreNb(this.nb, text);
    const similar = s.coverage >= 0.3
      ? this.index.nearest(text, 3).map((x) => ({ label: x.doc.label, text: x.doc.text, similarity: x.score, lang: x.doc.lang ?? "en", source: x.doc.source ?? "" }))
      : [];
    return { available: true, p_scam: s.p, coverage: s.coverage, words: s.words, similar, metrics: this.metrics, sources: [...new Set(this.docs.map((d) => d.source ?? ""))] };
  }

  async summary(): Promise<DatasetSummary> {
    if (this.summaryCache) return this.summaryCache;
    const sources = (await this.pool.query<DatasetSummary["sources"][number] & { imported_at: Date }>(
      "SELECT source, kind, file_name, rows, citation, imported_at FROM dataset_sources ORDER BY kind, source",
    )).rows.map((r) => ({ ...r, imported_at: new Date(r.imported_at).toISOString() }));

    let messages: DatasetSummary["messages"] = null;
    if (this.docs.length && this.nb && this.metrics) {
      const group = (key: (d: LabelledText) => string): Array<{ key: string; scam: number; ham: number }> => {
        const m = new Map<string, { scam: number; ham: number }>();
        for (const d of this.docs) {
          const k = key(d);
          const e = m.get(k) ?? { scam: 0, ham: 0 };
          e[d.label]++;
          m.set(k, e);
        }
        return [...m.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.scam + b.ham - (a.scam + a.ham));
      };
      const scam = this.docs.filter((d) => d.label === "scam").length;
      messages = {
        total: this.docs.length, scam, ham: this.docs.length - scam,
        by_lang: group((d) => d.lang ?? "en"), by_category: group((d) => d.category ?? "other"),
        top_words: topScamWords(this.nb), metrics: this.metrics,
      };
    }

    let cards: DatasetSummary["cards"] = null;
    const tot = (await this.pool.query<{ n: number; f: number; af: string | null; test: number }>(
      "SELECT count(*)::int AS n, count(*) FILTER (WHERE is_fraud)::int AS f, sum(amount) FILTER (WHERE is_fraud) AS af, count(*) FILTER (WHERE split = 'test')::int AS test FROM card_transactions",
    )).rows[0];
    if (tot && tot.n > 0) {
      const byHour = (await this.pool.query<{ hour: number; tx: number; fraud: number }>(
        "SELECT (time_s / 3600)::int AS hour, count(*)::int AS tx, count(*) FILTER (WHERE is_fraud)::int AS fraud FROM card_transactions GROUP BY 1 ORDER BY 1",
      )).rows;
      const byAmount = (await this.pool.query<{ key: string; tx: number; fraud: number }>(
        `SELECT CASE WHEN amount < 1 THEN 'under 1' WHEN amount < 10 THEN '1-10' WHEN amount < 50 THEN '10-50' WHEN amount < 100 THEN '50-100'
                     WHEN amount < 500 THEN '100-500' ELSE '500+' END AS key, count(*)::int AS tx, count(*) FILTER (WHERE is_fraud)::int AS fraud
           FROM card_transactions GROUP BY 1`,
      )).rows;
      const order = ["under 1", "1-10", "10-50", "50-100", "100-500", "500+"];
      const model = (await this.pool.query<{ metrics: { test: NonNullable<DatasetSummary["cards"]>["model"] } }>("SELECT metrics FROM dataset_models WHERE name = 'card_lr'")).rows[0];
      cards = {
        total: tot.n, fraud: tot.f, fraud_rate: Math.round((tot.f / tot.n) * 100000) / 1000, amount_fraud: Number(tot.af ?? 0),
        by_hour: byHour, by_amount: order.map((k) => byAmount.find((b) => b.key === k) ?? { key: k, tx: 0, fraud: 0 }),
        model: model?.metrics.test ?? null, test_rows: tot.test,
      };
    }
    this.summaryCache = { sources, messages, cards };
    return this.summaryCache;
  }

  /** The held-out (test) transactions in time order, with the model's score, for the live replay. */
  async cardPage(cursor: number, limit: number): Promise<{ rows: CardRow[]; next: number | null; threshold: number; start_t: number | null }> {
    const rows = (await this.pool.query<{ id: number; time_s: number; amount: string; score: number; is_fraud: boolean }>(
      "SELECT id, time_s, amount, score, is_fraud FROM card_transactions WHERE split = 'test' AND id > $1 ORDER BY id LIMIT $2",
      [cursor, limit],
    )).rows;
    const start = cursor === 0 && rows[0] ? rows[0].time_s : null;
    return {
      rows: rows.map((r) => ({ id: r.id, t: r.time_s, amount: Number(r.amount), score: Math.round(r.score * 10000) / 10000, fraud: r.is_fraud })),
      next: rows.length === limit ? rows[rows.length - 1]!.id : null,
      threshold: this.cardThreshold,
      start_t: start,
    };
  }
}
