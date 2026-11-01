import { CreditCard, Database, MessageSquareText } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type DatasetSummary } from "../api";
import { BarList, ChartCard, StackedColumns, Swatch } from "../charts/Charts";
import { fmt, useApp } from "../ctx";
import type { StringKey } from "../i18n";

const SCAM_C = "var(--series-2)";
const HAM_C = "var(--series-1)";
const pct = (x: number): string => `${Math.round(x * 1000) / 10}%`;

/** Scam vs genuine per row, one scale for every row, counts in text beside the bar. */
function SplitBars({ rows }: { rows: Array<{ label: string; scam: number; ham: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.scam + r.ham));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label} title={`${r.label}: ${r.scam} / ${r.ham}`}>
          <div className="bar-label"><span>{r.label}</span></div>
          <div className="bar-track split">
            <div style={{ width: `${(r.scam / max) * 100}%`, background: SCAM_C }} />
            <div style={{ width: `${(r.ham / max) * 100}%`, background: HAM_C }} />
          </div>
          <div className="bar-value small">{r.scam} / {r.ham}</div>
        </div>
      ))}
    </div>
  );
}

export function DatasetInsights() {
  const { t, lang } = useApp();
  const [d, setD] = useState<DatasetSummary | null>(null);
  useEffect(() => {
    api<DatasetSummary>("/datasets/summary").then(setD).catch(() => undefined);
  }, []);
  if (!d) return null;
  const tr = (k: string): string => t(k as StringKey) ?? k;
  const m = d.messages;
  const c = d.cards;
  return (
    <>
      <section className="span-12 ds-head">
        <h2><Database size={20} aria-hidden="true" /> {t("dsTitle")}</h2>
        <p className="muted">{t("dsIntro")}</p>
      </section>
      {!m && !c && <p className="panel span-12 muted">{t("dsNone")}</p>}

      {m && (
        <ChartCard
          className="span-6"
          title={t("dsMessages")}
          sub={t("dsMessagesSub", { scam: fmt(m.scam, lang), ham: fmt(m.ham, lang) })}
          legend={<><Swatch color={SCAM_C} label={t("labelScam")} /><Swatch color={HAM_C} label={t("labelHam")} /></>}
          table={{ columns: [{ label: t("dsCategories") }, { label: t("labelScam"), num: true }, { label: t("labelHam"), num: true }], rows: [...m.by_category, ...m.by_lang].map((r) => [tr(`cat_${r.key}`) || tr(`lang_${r.key}`), r.scam, r.ham]) }}
        >
          <SplitBars rows={m.by_category.map((r) => ({ label: tr(`cat_${r.key}`), scam: r.scam, ham: r.ham }))} />
          <div className="ds-meta">
            <span><MessageSquareText size={15} aria-hidden="true" /> {m.by_lang.map((l) => `${tr(`lang_${l.key}`)} ${fmt(l.scam + l.ham, lang)}`).join(", ")}</span>
          </div>
          <div>
            <p className="mini-label">{t("dsWords")}</p>
            <div className="word-chips">{m.top_words.map((w) => <span key={w} className="word-chip">{w}</span>)}</div>
          </div>
          <div className="metric-row">
            <span className="mini-label">{t("dsModelText")}</span>
            <span><b>{pct(m.metrics.accuracy)}</b> {t("mAccuracy")}</span>
            <span><b>{pct(m.metrics.precision)}</b> {t("rPrecision")}</span>
            <span><b>{pct(m.metrics.recall)}</b> {t("rRecall")}</span>
          </div>
        </ChartCard>
      )}

      {c && (
        <section className="card span-6">
          <div className="card-head">
            <div>
              <h3><CreditCard size={17} aria-hidden="true" /> {t("dsCards")}</h3>
              <p>{t("dsCardsSub", { n: fmt(c.total, lang), f: fmt(c.fraud, lang), r: c.fraud_rate })}</p>
            </div>
          </div>
          {c.model && (
            <div className="metric-row">
              <span className="mini-label">{t("dsModelCard")}</span>
              <span><b>{pct(c.model.precision)}</b> {t("rPrecision")}</span>
              <span><b>{pct(c.model.recall)}</b> {t("rRecall")}</span>
              <span><b>{pct(c.model.average_precision)}</b> {t("mAP")}</span>
              <span><b>{c.model.tp}</b>/{c.model.tp + c.model.fn} {t("rCaught").toLowerCase()}, <b>{c.model.fp}</b> {t("rFalse").toLowerCase()}</span>
            </div>
          )}
          <p className="mini-label">{t("dsByAmount")}</p>
          <BarList rows={c.by_amount.map((b) => ({ label: b.key, value: b.tx ? Math.round((b.fraud / b.tx) * 100000) / 100 : 0 }))} />
          <p className="hint small">%, {lang === "hi" ? "हर समूह के लेन-देन में फ़्रॉड का हिस्सा" : "share of each group's transactions that were fraud"}</p>
        </section>
      )}

      {c && (
        <ChartCard
          className="span-12"
          title={t("dsByHour")}
          sub={t("dsByHourSub")}
          table={{ columns: [{ label: "Hour" }, { label: t("seriesTx"), num: true }, { label: t("seriesFraud"), num: true }], rows: c.by_hour.map((h) => [h.hour, h.tx, h.fraud]) }}
        >
          <StackedColumns
            data={c.by_hour.map((h) => ({ x: String(h.hour), values: [h.tx ? Math.round((h.fraud / h.tx) * 10000) / 10 : 0] }))}
            series={[{ name: lang === "hi" ? "फ़्रॉड प्रति 1,000 लेन-देन" : "Fraud per 1,000 transactions", color: SCAM_C }]}
            xLabel={(x) => `h${x}`}
          />
        </ChartCard>
      )}

      {d.sources.length > 0 && (
        <section className="span-12 ds-sources">
          <p className="mini-label">{t("dsSources")}</p>
          <ul>{d.sources.map((s) => <li key={s.source}>{s.citation} <span className="hint">({fmt(s.rows, lang)}, {s.file_name})</span></li>)}</ul>
        </section>
      )}
    </>
  );
}
