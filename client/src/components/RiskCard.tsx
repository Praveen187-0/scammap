import { SCAM_TYPE_BY_SLUG } from "../../../shared/scamTypes.js";
import { BadgeCheck, CircleAlert, CircleCheck, Database, Lightbulb, Link2, Phone, Sparkles, Users } from "lucide-react";
import type { RiskSignal, TextAnalysis } from "../../../shared/risk.js";
import type { AnalyzeReply, TextVerdict } from "../api";
import { useApp } from "../ctx";
import { TYPE_ICON } from "../icons";

export function SignalList({ signals, reassurances }: { signals: RiskSignal[]; reassurances: RiskSignal[] }) {
  const { lang } = useApp();
  return (
    <ul className="signal-list">
      {signals.map((s) => (
        <li key={s.id}>
          <CircleAlert size={18} color="var(--scam)" aria-hidden="true" />
          <span>{lang === "hi" ? s.hi : s.en}</span>
        </li>
      ))}
      {reassurances.map((s) => (
        <li key={s.id}>
          <CircleCheck size={18} color="var(--ok)" aria-hidden="true" />
          <span>{lang === "hi" ? s.hi : s.en}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Analysis of a whole message or email. Shows the instant offline result first, then upgrades in place when the
 * server answers with community lookups and (if configured) Gemini's reading.
 */
export function RiskCard({ local, remote, busy }: { local: TextAnalysis; remote: AnalyzeReply | null; busy: boolean }) {
  const { t, lang } = useApp();
  const score = remote?.score ?? local.score;
  const level = remote?.level ?? local.level;
  const signals = remote?.signals ?? local.signals;
  const reassurances = remote?.reassurances ?? local.reassurances;
  const title = level === "high" ? t("riskHigh") : level === "medium" ? t("riskMedium") : t("riskLow");
  const ai = remote?.ai;
  // Until the server answers, advice comes from the offline guess of the scam type.
  const guess = level === "low" ? null : SCAM_TYPE_BY_SLUG.get(local.scamType ?? "other");
  const localAdvice = guess ? (lang === "hi" ? guess.adviceHi : guess.adviceEn) : lang === "hi" ? "फिर भी, OTP, PIN या UPI PIN किसी को न बताएँ।" : "Even so, never share an OTP, PIN or UPI PIN with anyone.";
  return (
    <article className={`risk lvl-${level}`} aria-live="polite">
      <div className="risk-head">
        <div className="risk-title">
          <h2>{title}</h2>
          <div className="risk-score" aria-label={`${score} ${t("riskOutOf")}`}>{score}</div>
        </div>
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label={t("riskOutOf")}>
          <span style={{ width: `${Math.max(3, score)}%` }} />
        </div>
        <p className="hint">{t("riskOutOf")}</p>
      </div>

      {remote?.community && (
        <div className="risk-section">
          <h3><Users size={16} aria-hidden="true" /> {t("communityHit")}</h3>
          <p>{lang === "hi" ? remote.community.hi : remote.community.en}</p>
        </div>
      )}

      <div className="risk-section">
        <h3>{t("signalsTitle")}</h3>
        {signals.length + reassurances.length > 0 ? <SignalList signals={signals} reassurances={reassurances} /> : <p className="muted">{t("noSignals")}</p>}
      </div>

      {(remote?.identifiers.length ?? local.candidates.length) > 0 && (
        <div className="risk-section">
          <h3>{t("foundInside")}</h3>
          <div className="ids">
            {(remote?.identifiers ?? local.candidates.map((c) => ({ type: c.type, value: c.value, display_value: c.value, verdict: null, verified_owner: null }))).map((i) => {
              const Icon = TYPE_ICON[i.type] ?? (i.type === "url" ? Link2 : Phone);
              return (
                <div className="id-row" key={`${i.type}:${i.value}`}>
                  <Icon size={20} aria-hidden="true" />
                  <code>{i.display_value.replace(/^https:\/\//, "")}</code>
                  {i.verdict ? (
                    <span className={`pill pill-${i.verdict}`}>
                      {i.verdict === "VERIFIED_BUSINESS" && <BadgeCheck size={14} aria-hidden="true" />}
                      {t(`v${i.verdict}` as const)}
                    </span>
                  ) : (
                    <span className="hint">{t("checking")}</span>
                  )}
                  {"listed_by" in i && i.listed_by && i.listed_by.length > 0 && <span className="listed-tag" title={i.listed_by.map((l) => l.label).join("; ")}>{t("listedShort")}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {remote?.dataset?.available && <DatasetSection d={remote.dataset} weights={remote.weights} />}

      <div className="risk-section">
        <h3 className="ai-tag"><Sparkles size={16} aria-hidden="true" /> {t("aiTitle")}</h3>
        {busy && !remote ? (
          <div className="ai-box" aria-busy="true">
            <span className="hint">{t("aiBusy")}</span>
            <div className="skeleton-line" style={{ width: "92%" }} />
            <div className="skeleton-line" style={{ width: "70%" }} />
          </div>
        ) : ai && ai.available ? (
          <div className="ai-box">
            <p>{lang === "hi" ? ai.summary_hi : ai.summary_en}</p>
            {ai.red_flags.length > 0 && (
              <ul className="signal-list">
                {ai.red_flags.map((f, i) => (
                  <li key={i}><CircleAlert size={18} color="#3b45a8" aria-hidden="true" /><span>{lang === "hi" ? f.hi : f.en}</span></li>
                ))}
              </ul>
            )}
            <p className="hint">{t("aiNote")}</p>
          </div>
        ) : (
          <p className="muted small">{t("aiOff")}</p>
        )}
      </div>

      <div className="risk-section">
        <div className="advice">
          <Lightbulb size={20} aria-hidden="true" />
          <div>
            <strong>{t("whatToDo")}</strong>
            <p>{remote ? (lang === "hi" ? remote.advice_hi : remote.advice_en) : localAdvice}</p>
          </div>
        </div>
        {level !== "low" && (
          <div className="actions">
            <a className="btn btn-danger" href="tel:1930"><Phone size={18} aria-hidden="true" /> {t("call1930")}</a>
            <a className="btn btn-quiet" href="https://cybercrime.gov.in" target="_blank" rel="noreferrer">{t("openPortal")}</a>
          </div>
        )}
      </div>
    </article>
  );
}

/** What the public labelled datasets say: the closest examples, and how much the dataset model counted. */
function DatasetSection({ d, weights }: { d: TextVerdict; weights: AnalyzeReply["weights"] }) {
  const { t } = useApp();
  const counted = weights.dataset > 0;
  const parts = [
    weights.ai ? `${t("srcAi")} ${Math.round(weights.ai * 100)}%` : "",
    `${t("srcRules")} ${Math.round(weights.rules * 100)}%`,
    weights.dataset ? `${t("srcDataset")} ${Math.round(weights.dataset * 100)}%` : "",
  ].filter(Boolean);
  return (
    <div className="risk-section">
      <h3><Database size={16} aria-hidden="true" /> {t("datasetTitle")}</h3>
      <p className="row" style={{ gap: 8 }}>
        {counted ? <strong>{t("datasetScore", { p: Math.round(d.p_scam * 100) })}</strong> : <span className="muted">{t("datasetLow")}</span>}
        {counted && d.words.length > 0 && <span className="hint">{t("datasetWords")}: {d.words.join(", ")}</span>}
      </p>
      {d.similar.length > 0 && (
        <ul className="similar-list">
          {d.similar.map((x, i) => (
            <li key={i}>
              <span className={`tag ${x.label === "scam" ? "tag-scam" : "tag-ok"}`}>{x.label === "scam" ? t("labelScam") : t("labelHam")}</span>
              <span className="similar-text" lang={x.lang === "bn" ? "bn" : x.lang === "hi" ? "hi" : "en"}>{x.text}</span>
              <span className="hint">{t("similarity", { p: Math.round(x.similarity * 100) })}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint small">{t("howScored")}: {parts.join(" + ")}</p>
    </div>
  );
}
