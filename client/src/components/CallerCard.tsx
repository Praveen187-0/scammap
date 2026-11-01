import { BadgeCheck, CircleHelp, HandCoins, Lightbulb, ListChecks, Phone, Scale, ShieldAlert, TriangleAlert, Users } from "lucide-react";
import { useState } from "react";
import { AREA_BY_PIN } from "../../../shared/areas.js";
import { SCAM_TYPE_BY_SLUG } from "../../../shared/scamTypes.js";
import type { RiskResult } from "../../../shared/risk.js";
import type { LookupReply } from "../api";
import { areaName, fmt, shortDate, typeName, useApp } from "../ctx";
import { CHANNEL_ICON, ScamIcon } from "../icons";
import { ExplainView } from "./ExplainView";
import { ReadAloud } from "./ReadAloud";
import { SignalList } from "./RiskCard";

const BAND_ICON = { KNOWN_SCAM: ShieldAlert, SUSPICIOUS: TriangleAlert, NO_REPORTS: CircleHelp, VERIFIED_BUSINESS: BadgeCheck } as const;

/** "+919876543210" -> "+91 98765 43210"; masked values keep their X's, drawn lighter. */
export function pretty(value: string, type: string): string {
  if (type === "phone" && /^\+91\d{10}$/.test(value)) return `+91 ${value.slice(3, 8)} ${value.slice(8)}`;
  if (type === "phone" && /^\+1\d{10}$/.test(value)) return `+1 (${value.slice(2, 5)}) ${value.slice(5, 8)}-${value.slice(8)}`;
  if (type === "url") return value.replace(/^https:\/\//, "");
  return value;
}

export function NumberDisplay({ value, type }: { value: string; type: string }) {
  const shown = pretty(value, type);
  const parts = shown.split(/(X+|\*+)/);
  return (
    <div className="caller-number" aria-label={value}>
      {parts.map((p, i) => (/^(X+|\*+)$/.test(p) ? <span key={i} className="mask">{p}</span> : <span key={i}>{p}</span>))}
    </div>
  );
}

export function CallerCard({ reply, quick, onReport, onDispute, query }: { reply: LookupReply; quick?: RiskResult | null; onReport?: () => void; onDispute?: () => void; query?: { type: string; value: string } }) {
  const { t, lang, go } = useApp();
  const [explain, setExplain] = useState(false);
  const Icon = BAND_ICON[reply.verdict];
  const st = reply.scam_type ? SCAM_TYPE_BY_SLUG.get(reply.scam_type) : undefined;
  const advice = st ?? SCAM_TYPE_BY_SLUG.get("other");
  const showFacts = reply.verdict === "KNOWN_SCAM" || reply.verdict === "SUSPICIOUS";
  // What is read aloud: the full message in English and Hindi; the translated verdict and type in other languages.
  const spoken =
    lang === "en" || lang === "hi"
      ? `${t(`v${reply.verdict}` as const)}. ${lang === "hi" ? reply.message_hi : reply.message_en} ${showFacts && advice ? (lang === "hi" ? advice.adviceHi : advice.adviceEn) : ""}`
      : `${t(`v${reply.verdict}` as const)}. ${showFacts && reply.scam_type ? `${typeName(reply.scam_type, lang)}. ${t("call1930")}.` : ""}`;
  return (
    <article className={`caller v-${reply.verdict}`} aria-live="polite" key={`${reply.display_value}-${reply.verdict}`}>
      <div className="caller-band">
        <Icon size={22} aria-hidden="true" />
        <span>{t(`v${reply.verdict}` as const)}</span>
      </div>
      <div className="caller-body">
        <NumberDisplay value={reply.display_value} type={reply.identifier_type} />
        {reply.verified_owner && <p className="caller-owner">{reply.verified_owner}</p>}
        <p className="caller-say">{lang === "hi" ? reply.message_hi : reply.message_en}</p>
        {reply.challenged && (
          <p className="review"><Scale size={18} aria-hidden="true" /> {t("underReview")}</p>
        )}
        {reply.listed_by && reply.listed_by.length > 0 && (
          <p className="listed-by"><ListChecks size={17} aria-hidden="true" /> {t("listedBy")}: {reply.listed_by.map((l) => l.label).join(", ")}</p>
        )}

        {showFacts && (
          <dl className="facts">
            <div>
              <dt>{t("people")}</dt>
              <dd>{fmt(reply.distinct_reporters, lang)}</dd>
            </div>
            {st && (
              <div>
                <dt>{t("mostlyReported")}</dt>
                <dd><ScamIcon type={reply.scam_type} size={16} /> {typeName(reply.scam_type, lang)}</dd>
              </div>
            )}
            <div>
              <dt>{t("firstReported")}</dt>
              <dd>{shortDate(reply.first_seen, lang)}</dd>
            </div>
            <div>
              <dt>{t("lastReported")}</dt>
              <dd>{shortDate(reply.last_seen, lang)}</dd>
            </div>
          </dl>
        )}

        {showFacts && reply.evidence.length > 0 && (
          <div className="timeline">
            <div className="timeline-head">{t("recentReports")}</div>
            <ul>
              {reply.evidence.map((e, i) => {
                const Ch = CHANNEL_ICON[e.channel] ?? Phone;
                return (
                  <li key={i}>
                    <span>{shortDate(e.occurred_at, lang)}</span>
                    <Ch size={16} aria-label={e.channel} />
                    <span>{areaName(AREA_BY_PIN.get(e.pincode), lang) || e.pincode}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {quick && (quick.signals.length > 0 || quick.reassurances.length > 0) && (
          <div>
            <div className="timeline-head">{t("signalsTitle")}</div>
            <SignalList signals={quick.signals} reassurances={quick.reassurances} />
          </div>
        )}

        {reply.verdict !== "VERIFIED_BUSINESS" && advice && (
          <div className="advice">
            <Lightbulb size={20} aria-hidden="true" />
            <div>
              <strong>{t("whatToDo")}</strong>
              <p>{lang === "hi" ? advice.adviceHi : advice.adviceEn}</p>
            </div>
          </div>
        )}

        <div className="caller-tools">
          <ReadAloud text={spoken} />
          {query && reply.report_count >= 2 && (
            <button className="btn btn-text" onClick={() => setExplain(true)}><Users size={17} aria-hidden="true" /> {t("explainBtn")}</button>
          )}
        </div>

        <div className="actions">
          {reply.verdict === "KNOWN_SCAM" || reply.verdict === "SUSPICIOUS" ? (
            <a className="btn btn-danger" href="tel:1930"><Phone size={18} aria-hidden="true" /> {t("call1930")}</a>
          ) : null}
          {showFacts && (
            <button className="btn btn-quiet" onClick={() => go("lost", reply.verdict === "KNOWN_SCAM" ? reply.display_value : "")}><HandCoins size={18} aria-hidden="true" /> {t("navLostShort")}</button>
          )}
          {onReport && reply.verdict !== "VERIFIED_BUSINESS" && <button className="btn btn-quiet" onClick={onReport}>{t("reportThis")}</button>}
          {onDispute && reply.report_count > 0 && reply.verdict !== "VERIFIED_BUSINESS" && !reply.challenged && (
            <button className="btn btn-text" onClick={onDispute}>{t("thisIsMine")}</button>
          )}
        </div>
      </div>
      {explain && query && <ExplainView type={query.type} value={query.value} onClose={() => setExplain(false)} />}
    </article>
  );
}
