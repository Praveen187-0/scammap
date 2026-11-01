import { ClipboardPaste, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bestCandidate, extractCandidates } from "../../../shared/extract.js";
import { analyzePhone, analyzeSender, analyzeText, analyzeUpi, analyzeUrl } from "../../../shared/risk.js";
import { api, ApiError, lookup, type AnalyzeReply, type LookupReply } from "../api";
import { AiOpinion } from "../components/AiOpinion";
import { CallerCard } from "../components/CallerCard";
import { LinkCheck } from "../components/LinkCheck";
import { RiskCard } from "../components/RiskCard";
import { useApp } from "../ctx";
import type { StringKey } from "../i18n";
import { TYPE_ICON } from "../icons";

const TYPE_LABEL: Record<string, StringKey> = { phone: "typePhone", upi: "typeUpi", url: "typeUrl", sender_id: "typeSender" };

const EXAMPLES: Array<{ key: StringKey; text: string }> = [
  { key: "exArrest", text: "This is Inspector Rathod from Mumbai Cyber Crime. A FedEx parcel in your name has 140g MDMA. You are under digital arrest. Stay on this video call, do not tell anyone, and transfer Rs 95,000 for verification immediately." },
  { key: "exKyc", text: "Dear Customer, your SBI YONO account will be blocked today. Update your PAN KYC immediately: http://sbi-yono-kyc.top/update or call 9182736450." },
  { key: "exJob", text: "Hello! Part time job, earn Rs 3000 daily by liking YouTube videos. Simple tasks. Pay Rs 500 registration fee to task.pay21@ybl to start. Join our Telegram now." },
  { key: "exAmazon", text: "Amazon: Your order of Apple iPhone 15 Pro (Rs 1,34,900) has been placed. If you did not place this order, call our cancellation desk at +1 888-814-2357 immediately." },
  { key: "exBank", text: "482913 is your OTP for a transaction of Rs 2,499 at Amazon on your HDFC Bank card ending 4421. Never share your OTP with anyone. -HDFCBK" },
  { key: "exEmail", text: "From: SBI Alerts <alerts@sbi-secure-login.xyz>\nReply-To: refund.desk@gmail.com\nSubject: Unusual sign-in to your account\n\nDear Customer, we noticed an unusual sign-in. Verify your account within 24 hours by opening the attached form.html or your access will be suspended." },
];

export function CheckScreen({ onDispute }: { onDispute: (value: string) => void }) {
  const { t, lang, go, area, payload } = useApp();
  const [text, setText] = useState(payload);
  const [reply, setReply] = useState<LookupReply | null>(null);
  const [remote, setRemote] = useState<AnalyzeReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const trimmed = text.trim();
  const cand = useMemo(() => bestCandidate(trimmed), [trimmed]);
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  // A whole message (several words) is analysed as a message; a bare value is looked up.
  const mode: "none" | "lookup" | "message" = !trimmed ? "none" : words >= 5 || trimmed.includes("\n") ? "message" : cand ? "lookup" : "none";
  const local = useMemo(() => (mode === "message" ? analyzeText(trimmed) : null), [mode, trimmed]);
  const msgUrl = useMemo(() => (mode === "message" ? (extractCandidates(trimmed).find((c) => c.type === "url")?.raw ?? null) : null), [mode, trimmed]);
  const quick = useMemo(() => {
    if (mode !== "lookup" || !cand) return null;
    return cand.type === "url" ? analyzeUrl(cand.raw) : cand.type === "phone" ? analyzePhone(cand.raw) : cand.type === "sender_id" ? analyzeSender(cand.raw) : cand.type === "upi" ? analyzeUpi(cand.value) : null;
  }, [mode, cand]);

  useEffect(() => {
    setErr("");
    setReply(null);
    setRemote(null);
    if (mode === "none") return;
    const ctrl = new AbortController();
    setBusy(true);
    const id = window.setTimeout(() => {
      const job =
        mode === "lookup" && cand
          ? lookup(cand.type, cand.value, area?.pincode, ctrl.signal).then(setReply)
          : api<AnalyzeReply>("/analyze", { method: "POST", body: { text: trimmed, pincode: area?.pincode }, signal: ctrl.signal }).then(setRemote);
      job
        .catch((e: unknown) => {
          if (e instanceof DOMException) return;
          if (!(e instanceof ApiError && e.status === 403)) setErr(t("errorGeneric"));
        })
        .finally(() => !ctrl.signal.aborted && setBusy(false));
    }, mode === "lookup" ? 280 : 650);
    return () => {
      ctrl.abort();
      window.clearTimeout(id);
    };
  }, [mode, cand?.type, cand?.value, trimmed, area?.pincode, t]);

  const paste = async (): Promise<void> => {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      /* clipboard permission denied: long-press paste still works */
    }
  };
  const CandIcon = cand ? TYPE_ICON[cand.type] : null;
  // "888-814-2357" is read as an Indian number; offer the US reading when it is written the American way.
  const usLike = /^\s*\(?[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}\s*$/.test(text) ? `+1 ${text.trim()}` : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("checkTitle")}</h1>
          <p>{t("checkIntro")}</p>
        </div>
      </div>
      <div className="check-grid">
        <div className="check-input">
          <div className="dial">
            <label className="visually-hidden" htmlFor="check-box">{t("checkPlaceholder")}</label>
            <textarea id="check-box" rows={mode === "message" ? 5 : 2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("checkPlaceholder")} autoComplete="off" spellCheck={false} />
            <div className="dial-bar">
              <span className="detected" aria-live="polite">
                {mode === "lookup" && cand && CandIcon && (<><CandIcon size={15} aria-hidden="true" /> {t("looksLike")}: {t(TYPE_LABEL[cand.type] ?? "typePhone")}</>)}
                {mode === "message" && local && <>{local.kind === "email" ? "Email" : lang === "hi" ? "मैसेज" : "Message"}</>}
              </span>
              <button className="btn btn-quiet" onClick={() => void paste()}><ClipboardPaste size={17} aria-hidden="true" /> {t("paste")}</button>
              {text && <button className="icon-btn" onClick={() => setText("")} aria-label={t("clear")}><X size={18} /></button>}
            </div>
          </div>
          {usLike && (
            <button className="btn btn-text us-hint" onClick={() => setText(usLike)}>{t("usHint", { n: usLike })}</button>
          )}
          <div className="examples" aria-label={t("tryExample")}>
            <span className="hint" style={{ alignSelf: "center" }}>{t("tryExample")}:</span>
            {EXAMPLES.map((e) => <button key={e.key} className="example" onClick={() => setText(e.text)}>{t(e.key)}</button>)}
          </div>
          <section className="how panel">
            <h3>{t("howTitle")}</h3>
            <ol>
              <li><span className="how-n">1</span><span>{t("how1")}</span></li>
              <li><span className="how-n">2</span><span>{t("how2")}</span></li>
              <li><span className="how-n">3</span><span>{t("how3")}</span></li>
            </ol>
          </section>
        </div>

        <div>
          {err && <p className="error">{err}</p>}
          {mode === "lookup" && reply && cand && (
            <div className="stack">
              <CallerCard reply={reply} quick={quick} query={{ type: cand.type, value: cand.value }} onReport={() => go("report", cand.raw)} onDispute={() => onDispute(cand.value)} />
              {cand.type === "url" && <LinkCheck key={cand.value} url={cand.raw} />}
              <AiOpinion key={`${cand.type}:${cand.value}`} type={cand.type} value={cand.value} pincode={area?.pincode} />
            </div>
          )}
          {mode === "lookup" && !reply && busy && <div className="panel"><div className="skeleton-line" style={{ width: "60%" }} /></div>}
          {mode === "message" && local && <RiskCard local={local} remote={remote} busy={busy} />}
          {mode === "message" && msgUrl && <div style={{ marginTop: 14 }}><LinkCheck key={msgUrl} url={msgUrl} /></div>}
          {mode === "none" && (
            <div className="panel" style={{ minHeight: 160, display: "grid", placeItems: "center", borderStyle: "dashed" }}>
              <p className="muted">{trimmed ? (lang === "hi" ? "पूरा फ़ोन नंबर, UPI ID (नाम@बैंक), लिंक या 6 अक्षर का SMS भेजने वाला लिखें।" : "Type a full phone number, UPI ID (name@bank), link or 6-letter SMS sender.") : t("emptyResult")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
