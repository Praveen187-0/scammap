import { CircleAlert, Lightbulb, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, type IdentifierOpinion } from "../api";
import { useApp } from "../ctx";

/**
 * Second opinion on one number / UPI ID / link / sender, shown under the community result. Loads after the
 * instant lookup (Gemini takes a second or two), so the verdict itself is never slowed down.
 */
export function AiOpinion({ type, value, pincode }: { type: string; value: string; pincode?: string }) {
  const { t, lang } = useApp();
  const [op, setOp] = useState<IdentifierOpinion | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setBusy(true);
    setOp(null);
    setFailed(false);
    api<IdentifierOpinion>("/analyze/identifier", { method: "POST", body: { type, value, pincode }, signal: ctrl.signal })
      .then(setOp)
      .catch((e: unknown) => {
        if (e instanceof DOMException) return;
        if (!(e instanceof ApiError && e.status === 403)) setFailed(true);
      })
      .finally(() => !ctrl.signal.aborted && setBusy(false));
    return () => ctrl.abort();
  }, [type, value, pincode]);

  if (failed) return null;
  const ai = op?.ai;
  const verdictLabel = op ? t(`v${op.community.verdict}` as const) : "";
  const parts = op
    ? [
        { k: t("srcCommunity"), v: op.community.verdict === "NO_REPORTS" ? t("vNO_REPORTS") : verdictLabel, cls: `pill pill-${op.community.verdict}` },
        { k: t("srcRules"), v: String(op.rules.score), cls: "chip-score" },
        ...(ai?.available ? [{ k: t("srcAi"), v: String(ai.risk_score), cls: "chip-score ai" }] : []),
      ]
    : [];
  return (
    <section className={`opinion ${op ? `lvl-${op.level}` : ""}`} aria-live="polite" aria-busy={busy}>
      <div className="opinion-head">
        <h3><Sparkles size={17} aria-hidden="true" /> {t("opinionTitle")}</h3>
        {op && (
          <div className="opinion-score">
            <span className="hint">{t("overallRisk")}</span>
            <strong>{op.score}</strong>
          </div>
        )}
      </div>
      {busy && !op && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="hint">{t("aiBusy")}</span>
          <div className="skeleton-line" style={{ width: "88%" }} />
          <div className="skeleton-line" style={{ width: "64%" }} />
        </div>
      )}
      {op && (
        <>
          <div className="meter thin" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={op.score} aria-label={t("overallRisk")}>
            <span style={{ width: `${Math.max(3, op.score)}%` }} />
          </div>
          <div className="sources">
            {parts.map((p) => (
              <span key={p.k} className="source"><span className="hint">{p.k}</span> <span className={p.cls}>{p.v}</span></span>
            ))}
          </div>
          {ai?.available ? (
            <>
              <p className="opinion-summary">{lang === "hi" ? ai.summary_hi : ai.summary_en}</p>
              {ai.checks.length > 0 && (
                <div>
                  <p className="mini-label">{t("aiChecks")}</p>
                  <ul className="signal-list">
                    {ai.checks.map((c, i) => <li key={i}><ShieldCheck size={18} color="var(--brand)" aria-hidden="true" /><span>{lang === "hi" ? c.hi : c.en}</span></li>)}
                  </ul>
                </div>
              )}
            </>
          ) : (
            op.rules.signals.length > 0 && (
              <ul className="signal-list">
                {op.rules.signals.map((s) => <li key={s.id}><CircleAlert size={18} color="var(--scam)" aria-hidden="true" /><span>{lang === "hi" ? s.hi : s.en}</span></li>)}
              </ul>
            )
          )}
          {(op.advice_en || op.advice_hi) && (
            <div className="advice">
              <Lightbulb size={20} aria-hidden="true" />
              <div>
                <strong>{t("safeStep")}</strong>
                <p>{lang === "hi" ? op.advice_hi : op.advice_en}</p>
              </div>
            </div>
          )}
          <p className="hint small">{ai?.available ? `${t("aiPrivacyId")} (${ai.model})` : t("aiOffShort")}</p>
        </>
      )}
    </section>
  );
}
