import { ChevronDown, ClipboardPaste, Clock, CloudOff, ImageUp, Loader, MapPin, Timer } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { bestCandidate, extractCandidates, type Candidate } from "../../../shared/extract.js";
import { CHANNELS, SCAM_TYPES, suggestScamType } from "../../../shared/scamTypes.js";
import { api, ApiError, lookup, type LookupReply } from "../api";
import { CallerCard, pretty } from "../components/CallerCard";
import { areaName, typeName, useApp } from "../ctx";
import { CHANNEL_ICON, SCAM_ICON, TYPE_ICON } from "../icons";
import { enqueue, useQueueCount } from "../offline";
import { readScreenshot } from "../ocr";
import { reporterId } from "../storage";

const DEFAULT_CHANNEL: Record<string, string> = { phone: "Phone call", url: "Fake website", upi: "UPI request", sender_id: "SMS or WhatsApp" };
const WHEN = [
  { key: "whenNow", ago: 0 },
  { key: "whenToday", ago: 3 * 3_600_000 },
  { key: "whenYesterday", ago: 24 * 3_600_000 },
  { key: "whenWeek", ago: 4 * 24 * 3_600_000 },
] as const;

function isoIst(ms: number): string {
  const d = new Date(ms + 330 * 60_000);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+05:30`;
}

/** Designed for about 15 seconds and three taps: paste, pick what happened, send. */
export function ReportScreen() {
  const { t, lang, area, openAreaPicker, payload, go } = useApp();
  const [text, setText] = useState(payload);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [when, setWhen] = useState(0);
  const [scam, setScam] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [note, setNote] = useState("");
  const [shot, setShot] = useState(false);
  const [lost, setLost] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ reply: LookupReply | null; secs: number; offline?: boolean } | null>(null);
  const [ocr, setOcr] = useState<"idle" | "reading" | "none">("idle");
  const started = useRef<number | null>(payload ? performance.now() : null);
  const fileRef = useRef<HTMLInputElement>(null);
  const waiting = useQueueCount();

  const candidates = useMemo(() => extractCandidates(text), [text]);
  const cand = picked && candidates.some((c) => c.value === picked.value) ? picked : bestCandidate(text);
  const suggestion = useMemo(() => suggestScamType(`${text} ${note}`), [text, note]);
  const scamType = scam ?? suggestion;
  const pastedMessage = text.trim().length > 40 && cand !== null && cand.raw.length < text.trim().length - 10;
  const chosenChannel = channel ?? (cand ? (pastedMessage && cand.type === "phone" ? "SMS or WhatsApp" : DEFAULT_CHANNEL[cand.type] ?? "Something else") : null);
  const missing = !cand ? t("needIdentifier") : !scamType ? t("needType") : !area ? t("needArea") : "";
  const touch = (): void => {
    if (started.current === null) started.current = performance.now();
  };

  const paste = async (): Promise<void> => {
    touch();
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      /* permission denied */
    }
  };

  // A screenshot of the scam message: read on this phone, then treated exactly like pasted text.
  const fromShot = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    touch();
    setOcr("reading");
    try {
      const txt = await readScreenshot(f);
      if (extractCandidates(txt).length === 0) setOcr("none");
      else setOcr("idle");
      setText((old) => (old.trim() ? `${old}\n${txt}` : txt));
      setShot(true);
    } catch {
      setOcr("none");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async (): Promise<void> => {
    if (!cand || !scamType || !area) return;
    setBusy(true);
    setErr("");
    const now = Date.now();
    // Other numbers, UPI IDs and links from the same message help join scam campaigns.
    const related = candidates.filter((c) => c.value !== cand.value).slice(0, 5).map((c) => ({ type: c.type, value: c.value }));
    const body = {
      report_id: `app_${reporterId().slice(2, 10)}_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      occurred_at: isoIst(now - (WHEN[when]?.ago ?? 0)),
      reported_at: isoIst(now),
      reporter_id: reporterId(),
      channel: chosenChannel,
      scam_type: scamType,
      identifier_type: cand.type,
      identifier_value: cand.value,
      pincode: area.pincode,
      locality: area.locality,
      city: area.city,
      note,
      has_screenshot: shot,
      amount_lost_inr: Number(lost.replace(/[^\d]/g, "")) || 0,
      ...(related.length ? { related_identifiers: related } : {}),
    };
    const secs = (): number => (started.current === null ? 0 : (performance.now() - started.current) / 1000);
    if (!navigator.onLine) {
      enqueue(body);
      setDone({ reply: null, secs: secs(), offline: true });
      setBusy(false);
      return;
    }
    try {
      await api("/reports", { method: "POST", body });
      setDone({ reply: await lookup(cand.type, cand.value, area.pincode).catch(() => null), secs: secs() });
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        enqueue(body);
        setDone({ reply: null, secs: secs(), offline: true });
      } else if (e instanceof ApiError && e.status === 429) setErr(t("tooMany"));
      else if (!(e instanceof ApiError && e.status === 403)) setErr(e instanceof ApiError && e.status === 400 ? e.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const awaiting = done.reply?.confirmation === "awaiting_confirmation";
    return (
      <div className="report-wrap stack">
        <div className="done">
          <svg className="done-check" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="30" fill="var(--ok-tint)" />
            <path d="M19 33l9 9 17-19" fill="none" stroke="var(--ok)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1>{t("sentTitle")}</h1>
          {done.secs > 0 && <span className="timer"><Timer size={16} aria-hidden="true" /> {t("reportedIn", { s: done.secs.toFixed(1) })}</span>}
          <p style={{ maxWidth: "52ch", color: "var(--ink-2)" }}>{done.offline ? t("savedOffline") : awaiting ? t("sentPrivate") : t("sentPublic")}</p>
        </div>
        {done.reply && !awaiting && <CallerCard reply={done.reply} />}
        <button className="btn btn-primary btn-xl btn-block" onClick={() => { setDone(null); setText(""); setNote(""); setScam(null); setChannel(null); setPicked(null); setWhen(0); setLost(""); setShot(false); started.current = null; go("report", ""); }}>
          {t("reportAnother")}
        </button>
      </div>
    );
  }

  const CandIcon = cand ? TYPE_ICON[cand.type] : null;
  return (
    <div className="report-wrap">
      <div className="page-head">
        <div>
          <h1>{t("reportTitle")}</h1>
          <p>{t("reportIntro")}</p>
        </div>
      </div>

      <div className="step">
        <label className="step-label" htmlFor="rep-what"><span className="step-n">1</span> {t("stepWhat")}</label>
        <div className="dial">
          <textarea id="rep-what" rows={2} value={text} onFocus={touch} onChange={(e) => { touch(); setText(e.target.value); }} placeholder={t("stepWhatHint")} />
          <div className="dial-bar">
            <span className="detected">{cand && CandIcon && <><CandIcon size={15} aria-hidden="true" /> {pretty(cand.value, cand.type)}</>}</span>
            <button className="btn btn-quiet" onClick={() => fileRef.current?.click()} disabled={ocr === "reading"}>
              {ocr === "reading" ? <Loader size={17} className="spin" aria-hidden="true" /> : <ImageUp size={17} aria-hidden="true" />} <span className="hide-narrow">{t("fromScreenshot")}</span>
            </button>
            <button className="btn btn-quiet" onClick={() => void paste()}><ClipboardPaste size={17} aria-hidden="true" /> {t("paste")}</button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void fromShot(e.target.files?.[0])} />
          </div>
        </div>
        {ocr === "reading" && <p className="hint" style={{ marginTop: 8 }}>{t("ocrReading")}. {t("ocrPrivacy")}</p>}
        {ocr === "none" && <p className="hint" style={{ marginTop: 8 }}>{t("ocrNone")}</p>}
        {candidates.length > 1 && (
          <div className="chips" role="radiogroup" style={{ marginTop: 10 }}>
            {candidates.map((c) => {
              const I = TYPE_ICON[c.type];
              return (
                <button key={c.value} className="chip" role="radio" aria-checked={cand?.value === c.value} onClick={() => setPicked(c)}>
                  {I && <I size={15} aria-hidden="true" />} {pretty(c.value, c.type)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="step">
        <div className="step-label" id="lbl-type"><span className="step-n">2</span> {t("stepType")}</div>
        <div className="tiles types" role="radiogroup" aria-labelledby="lbl-type">
          {SCAM_TYPES.map((s) => {
            const I = SCAM_ICON[s.slug];
            return (
              <button key={s.slug} className="tile" role="radio" aria-checked={scamType === s.slug} onClick={() => { touch(); setScam(s.slug); }}>
                {I && <I size={26} strokeWidth={1.75} aria-hidden="true" />}
                <span>{typeName(s.slug, lang)}</span>
                {suggestion === s.slug && scam === null && <span className="tile-badge">{t("suggested")}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="step">
        <div className="step-label" id="lbl-how"><span className="step-n">3</span> {t("stepHow")}</div>
        <div className="tiles channels" role="radiogroup" aria-labelledby="lbl-how">
          {CHANNELS.map((c) => {
            const I = CHANNEL_ICON[c.value];
            return (
              <button key={c.value} className="tile compact" role="radio" aria-checked={chosenChannel === c.value} onClick={() => setChannel(c.value)}>
                {I && <I size={22} strokeWidth={1.75} aria-hidden="true" />}
                <span>{lang === "hi" ? c.hi : c.en}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="step">
        <div className="step-label" id="lbl-when"><span className="step-n">4</span> {t("stepWhen")}</div>
        <div className="chips" role="radiogroup" aria-labelledby="lbl-when">
          {WHEN.map((w, i) => (
            <button key={w.key} className="chip" role="radio" aria-checked={when === i} onClick={() => setWhen(i)}><Clock size={15} aria-hidden="true" /> {t(w.key)}</button>
          ))}
        </div>
      </div>

      <div className="step">
        <div className="step-label"><span className="step-n">5</span> {t("stepArea")}</div>
        <button className="chip" aria-checked={Boolean(area)} onClick={openAreaPicker}>
          <MapPin size={15} aria-hidden="true" /> {area ? `${areaName(area, lang)}, ${area.city}` : t("chooseArea")} {area && <span style={{ opacity: 0.7, fontWeight: 500 }}>{t("change")}</span>}
        </button>
      </div>

      <div className="step">
        <button className="btn btn-text" onClick={() => setMore((m) => !m)} aria-expanded={more}>
          <ChevronDown size={18} style={{ transform: more ? "rotate(180deg)" : "none", transition: "transform .2s" }} aria-hidden="true" /> {t("addDetails")}
        </button>
        {more && (
          <div className="stack" style={{ marginTop: 8 }}>
            <textarea className="field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} />
            <label className="row"><input type="checkbox" checked={shot} onChange={(e) => setShot(e.target.checked)} style={{ width: 20, height: 20 }} /> {t("hasScreenshot")}</label>
            <label className="stack" style={{ gap: 6 }}>
              <span>{t("amountLost")}</span>
              <input className="field" inputMode="numeric" value={lost} onChange={(e) => setLost(e.target.value)} placeholder="0" style={{ maxWidth: 220 }} />
            </label>
          </div>
        )}
      </div>

      <div className="submit-dock">
        {waiting > 0 && <p className="queued"><CloudOff size={16} aria-hidden="true" /> {t("queued", { n: waiting })}</p>}
        {err && <p className="error">{err}</p>}
        <button className="btn btn-danger btn-xl btn-block" onClick={() => void submit()} disabled={Boolean(missing) || busy}>
          {busy ? t("sending") : t("submit")}
        </button>
        <p className="hint" style={{ textAlign: "center" }}>{missing || t("privacyLine")}</p>
      </div>
    </div>
  );
}
