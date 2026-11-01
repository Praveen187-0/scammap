import { Check, Copy, Download, ExternalLink, FileText, Landmark, Phone, Siren, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SCAM_TYPES } from "../../../shared/scamTypes.js";
import { typeName, useApp } from "../ctx";
import type { StringKey } from "../i18n";

// Everything typed here stays on this phone (session storage, cleared when the tab closes). Nothing is sent.
const KEY = "sm.lost";
interface Form {
  amount: string;
  when: string;
  utr: string;
  bank: string;
  paidTo: string;
  how: string;
  type: string;
}
const EMPTY: Form = { amount: "", when: "", utr: "", bank: "", paidTo: "", how: "", type: "" };

function loadForm(prefill: string): Form {
  let f = EMPTY;
  try {
    f = { ...EMPTY, ...(JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Partial<Form>) };
  } catch {
    /* private mode */
  }
  if (prefill && !f.paidTo) f = { ...f, paidTo: prefill };
  if (!f.when) {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
    f = { ...f, when: d.toISOString().slice(0, 16) };
  }
  return f;
}

const rupees = (s: string): string => {
  const n = Number(s.replace(/[^\d]/g, ""));
  return n > 0 ? `₹${n.toLocaleString("en-IN")}` : "₹____";
};
const whenText = (s: string): string => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "____" : d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const blank = (s: string, n = 12): string => s.trim() || "_".repeat(n);

function complaint(f: Form, hindi: boolean, typeLabel: string): string {
  if (hindi) {
    return [
      "मैं एक ऑनलाइन वित्तीय धोखाधड़ी की शिकायत दर्ज कर रहा/रही हूँ।",
      `तारीख और समय: ${whenText(f.when)}`,
      `गई रकम: ${rupees(f.amount)}`,
      `लेन-देन संदर्भ (UTR / UPI ref): ${blank(f.utr)}`,
      `मेरा बैंक: ${blank(f.bank)}`,
      `पैसे भेजे गए: ${blank(f.paidTo)}`,
      `स्कैम का प्रकार: ${typeLabel || "____"}`,
      `क्या हुआ: ${blank(f.how, 30)}`,
      "",
      "अनुरोध है कि पैसे पाने वाले खाते को तुरंत फ़्रीज़ किया जाए और रकम रोकी जाए। मेरे पास मैसेज, कॉल लॉग और भुगतान के स्क्रीनशॉट हैं।",
    ].join("\n");
  }
  return [
    "I am reporting an online financial fraud.",
    `Date and time: ${whenText(f.when)}`,
    `Amount lost: ${rupees(f.amount)}`,
    `Transaction reference (UTR / UPI ref no.): ${blank(f.utr)}`,
    `My bank: ${blank(f.bank)}`,
    `Money sent to: ${blank(f.paidTo)}`,
    `Type of scam: ${typeLabel || "____"}`,
    `What happened: ${blank(f.how, 30)}`,
    "",
    "I request that the receiving account be frozen and the amount be held. I have screenshots of the messages, call log and the payment.",
  ].join("\n");
}

function bankLetter(f: Form, hindi: boolean): string {
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  if (hindi) {
    return [
      `सेवा में: फ़्रॉड / शिकायत टीम, ${blank(f.bank)}`,
      "विषय: धोखाधड़ी वाला लेन-देन: रकम फ़्रीज़ करने और वापस करने का अनुरोध",
      "",
      `${whenText(f.when)} को मेरे साथ ऑनलाइन धोखाधड़ी हुई। मैंने ${rupees(f.amount)} ${blank(f.paidTo)} को भेजे (UTR ${blank(f.utr)})।`,
      "मैंने इसकी शिकायत राष्ट्रीय साइबर अपराध हेल्पलाइन 1930 पर की है (शिकायत संख्या: ____________)।",
      "",
      "कृपया: (1) इस लेन-देन पर विवाद / चार्जबैक दर्ज करें, (2) पैसे पाने वाले बैंक से रकम पर रोक (लियन) लगवाएँ, और (3) इस शिकायत की लिखित पावती भेजें।",
      "",
      "खाताधारक का नाम: ____________   खाता / कार्ड के आख़िरी 4 अंक: ____   रजिस्टर्ड मोबाइल: ____________",
      `तारीख: ${today}`,
    ].join("\n");
  }
  return [
    `To: The Fraud / Grievance Team, ${blank(f.bank)}`,
    "Subject: Fraudulent transaction: request to freeze and reverse",
    "",
    `I was cheated in an online fraud on ${whenText(f.when)}. I transferred ${rupees(f.amount)} to ${blank(f.paidTo)} (UTR ${blank(f.utr)}).`,
    "I have reported it to the National Cybercrime Helpline 1930 (complaint no.: ____________).",
    "",
    "Please (1) raise a dispute / chargeback on this transaction, (2) ask the beneficiary bank to put a lien on the amount, and (3) send me a written acknowledgement of this complaint.",
    "",
    "Account holder name: ____________   Account / card last 4 digits: ____   Registered mobile: ____________",
    `Date: ${today}`,
  ].join("\n");
}

function CopyBox({ title, text, file }: { title: string; text: string; file: string }) {
  const { t } = useApp();
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the text is selectable */
    }
  };
  const download = (): void => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="copybox">
      <div className="copybox-head">
        <strong>{title}</strong>
        <span className="topbar-spacer" />
        <button className="btn btn-quiet" onClick={() => void copy()}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? t("copied") : t("copy")}</button>
        <button className="btn btn-text" onClick={download}><Download size={16} aria-hidden="true" /> {t("download")}</button>
      </div>
      <pre tabIndex={0}>{text}</pre>
    </div>
  );
}

/** The first hour after losing money matters most: this screen puts the four things to do in order. */
export function LostMoneyScreen() {
  const { t, lang, payload, go } = useApp();
  const [f, setF] = useState<Form>(() => loadForm(payload));
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [timeSet, setTimeSet] = useState(false);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(f));
    } catch {
      /* ignore */
    }
  }, [f]);
  const hindi = lang === "hi";
  const typeLabel = f.type ? typeName(f.type, hindi ? "hi" : "en") : "";
  const complaintText = useMemo(() => complaint(f, hindi, typeLabel), [f, hindi, typeLabel]);
  const letterText = useMemo(() => bankLetter(f, hindi), [f, hindi]);
  const minutes = (() => {
    const d = new Date(f.when).getTime();
    return Number.isNaN(d) ? null : Math.round((Date.now() - d) / 60_000);
  })();
  const field = (k: keyof Form, label: StringKey, props: Record<string, unknown> = {}) => (
    <label className="stack" style={{ gap: 6 }}>
      <span>{t(label)}</span>
      <input className="field" value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value }); if (k === "when") setTimeSet(true); }} {...props} />
    </label>
  );

  return (
    <div className="page lost">
      <div className="page-head">
        <div>
          <h1>{t("lostTitle")}</h1>
          <p>{t("lostIntro")}</p>
        </div>
      </div>

      <ol className="lost-steps">
        <li className="lost-step urgent">
          <div className="lost-n" aria-hidden="true">1</div>
          <div className="stack" style={{ gap: 10 }}>
            <h2>{t("lostStep1")}</h2>
            <p className="muted">{t("lostStep1d")}</p>
            <div className="row">
              <a className="btn btn-danger btn-xl" href="tel:1930"><Phone size={20} aria-hidden="true" /> 1930</a>
              {timeSet && minutes !== null && minutes >= 0 && (
                <span className={`golden ${minutes <= 60 ? "in" : ""}`}><Timer size={16} aria-hidden="true" /> {minutes <= 60 ? t("goldenIn", { m: Math.max(0, 60 - minutes) }) : t("goldenPast")}</span>
              )}
            </div>
          </div>
        </li>

        <li className="lost-step">
          <div className="lost-n" aria-hidden="true">2</div>
          <div className="stack" style={{ gap: 12 }}>
            <h2>{t("lostStep2")}</h2>
            <p className="muted">{t("lostStep2d")}</p>
            <div className="lost-form">
              {field("amount", "fAmount", { inputMode: "numeric", placeholder: "25000" })}
              {field("when", "fWhen", { type: "datetime-local" })}
              {field("utr", "fUtr", { placeholder: "4123 5678 9012", autoComplete: "off" })}
              {field("bank", "fBank", { placeholder: "SBI, HDFC Bank, …" })}
              {field("paidTo", "fPaidTo", { autoComplete: "off" })}
              <label className="stack" style={{ gap: 6 }}>
                <span>{t("fType")}</span>
                <select className="field" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                  <option value="">—</option>
                  {SCAM_TYPES.map((s) => <option key={s.slug} value={s.slug}>{typeName(s.slug, lang)}</option>)}
                </select>
              </label>
              <label className="stack span-all" style={{ gap: 6 }}>
                <span>{t("fHow")}</span>
                <textarea className="field" rows={2} value={f.how} onChange={(e) => setF({ ...f, how: e.target.value })} />
              </label>
            </div>
          </div>
        </li>

        <li className="lost-step">
          <div className="lost-n" aria-hidden="true">3</div>
          <div className="stack" style={{ gap: 10 }}>
            <h2>{t("lostStep3")}</h2>
            <p className="muted">{t("lostStep3d")}</p>
            <CopyBox title={t("complaintTitle")} text={complaintText} file="cybercrime-complaint.txt" />
            <a className="btn btn-primary" href="https://cybercrime.gov.in" target="_blank" rel="noreferrer"><ExternalLink size={17} aria-hidden="true" /> {t("openComplaint")}</a>
          </div>
        </li>

        <li className="lost-step">
          <div className="lost-n" aria-hidden="true">4</div>
          <div className="stack" style={{ gap: 10 }}>
            <h2><Landmark size={20} aria-hidden="true" /> {t("lostStep4")}</h2>
            <p className="muted">{t("lostStep4d")}</p>
            <CopyBox title={t("letterTitle")} text={letterText} file="bank-letter.txt" />
          </div>
        </li>

        <li className="lost-step">
          <div className="lost-n" aria-hidden="true">5</div>
          <div className="stack" style={{ gap: 10 }}>
            <h2>{t("lostStep5")}</h2>
            <ul className="checklist">
              {(["chk1", "chk2", "chk3", "chk4", "chk5"] as const).map((k) => (
                <li key={k}>
                  <label><input type="checkbox" checked={Boolean(done[k])} onChange={(e) => setDone({ ...done, [k]: e.target.checked })} /> <span>{t(k)}</span></label>
                </li>
              ))}
            </ul>
          </div>
        </li>
      </ol>

      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn btn-quiet" onClick={() => go("report", f.paidTo)}><Siren size={18} aria-hidden="true" /> {t("alsoReport")}</button>
        <span className="hint"><FileText size={14} aria-hidden="true" /> {t("lostLocal")}</span>
      </div>
    </div>
  );
}
