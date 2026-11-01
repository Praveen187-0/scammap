import { BrainCircuit, Clock3, Languages, Loader, Network, ShieldCheck, ShieldX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AREA_BY_PIN } from "../../../shared/areas.js";
import { api, ApiError, type NoteReading, type SafetyInfo } from "../api";
import { areaName, fmt, typeName, useApp } from "../ctx";
import type { StringKey } from "../i18n";

const SOURCE_KEY: Record<string, StringKey> = { reporter: "srcReporter", rules: "srcRulesAuto", local_ai: "srcLocalAi", default: "srcDefault" };

/** Try the note reader: rules at once, the local model's translation and type. Nothing is stored. */
function NoteTry() {
  const { t, lang } = useApp();
  const [note, setNote] = useState("Mujhe ek call aaya, bola main CBI se hoon, aapke naam pe parcel me drugs mile hain, video call pe raho warna giraftar karenge");
  const [r, setR] = useState<NoteReading | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (): Promise<void> => {
    setBusy(true);
    setErr("");
    setR(null);
    try {
      setR(await api<NoteReading>("/analyze/note", { method: "POST", body: { note } }));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403)) setErr(e instanceof ApiError ? e.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="mini-label">{t("safTry")}</div>
      <textarea className="field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row">
        <button className="btn btn-quiet" onClick={() => void run()} disabled={busy || note.trim().length < 3}>
          {busy ? <Loader size={16} className="spin" aria-hidden="true" /> : <Languages size={16} aria-hidden="true" />} {busy ? t("safReading") : t("safRead")}
        </button>
        <span className="hint">{t("safTryNote")}</span>
      </div>
      {err && <p className="error">{err}</p>}
      {r && (
        <dl className="facts">
          <div><dt>{t("safLanguage")}</dt><dd>{r.language}{r.hinglish_words ? ` (${r.hinglish_words} Hinglish words)` : ""}</dd></div>
          <div><dt>{t("safRules")}</dt><dd>{r.rules ? typeName(r.rules, lang) : "—"}</dd></div>
          <div><dt>{t("safLocal")}</dt><dd>{r.local_ai.available ? `${typeName(r.local_ai.scam_type, lang)} (${Math.round(r.local_ai.confidence * 100)}%, ${(r.local_ai.ms / 1000).toFixed(1)} s)` : t("safOff")}</dd></div>
          <div><dt>{t("safChosen")}</dt><dd>{typeName(r.chosen, lang)}</dd></div>
          <div><dt>{t("safChosenBy")}</dt><dd>{t(r.chosen_by === "local_ai" ? "safByAi" : r.chosen_by === "rules" ? "safByRules" : "safByDefault")}</dd></div>
          {r.local_ai.available ? (
            <div className="span-all"><dt>{t("safEnglish")}</dt><dd style={{ fontWeight: 500 }}>{r.local_ai.english}</dd></div>
          ) : (
            <div className="span-all"><dt>{t("safWhyOff")}</dt><dd className="small" style={{ fontWeight: 500 }}>{r.local_ai.reason}</dd></div>
          )}
        </dl>
      )}
    </div>
  );
}

/** Clock guard, local AI and anti-spoofing at a glance (Help screen). */
export function SafetyPanel() {
  const { t, lang } = useApp();
  const [s, setS] = useState<SafetyInfo | null>(null);
  const load = useCallback(() => {
    api<SafetyInfo>("/safety").then(setS).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [load]);
  if (!s) return null;
  const c = s.clock;
  const ai = s.local_ai;
  const sp = s.anti_spoofing;
  return (
    <section className="card span-all safety">
      <h3><ShieldCheck size={18} aria-hidden="true" /> {t("safTitle")}</h3>
      <p className="muted">{t("safIntro")}</p>

      <div className="safety-grid">
        <div className="safety-block">
          <div className="safety-head"><Clock3 size={18} aria-hidden="true" /> <strong>{t("safClock")}</strong>
            <span className={`pill ${c.status === "OK" ? "pill-VERIFIED_BUSINESS" : "pill-KNOWN_SCAM"}`}>{c.status === "OK" ? t("safClockOk") : t("safClockLocked")}</span>
          </div>
          <dl className="kv">
            <dt>{t("safServerTime")}</dt><dd>{c.server_time.slice(0, 19).replace("T", " ")}</dd>
            <dt>{t("safHighWater")}</dt><dd>{c.high_water_mark ? c.high_water_mark.slice(0, 19).replace("T", " ") : "—"} <span className="muted small">({c.high_water_source})</span></dd>
            <dt>{t("safBehind")}</dt><dd>{c.behind_seconds > 0 ? t("safSeconds", { n: fmt(c.behind_seconds, lang) }) : "0"} <span className="muted small">/ {t("safTolerance", { n: c.tolerance_seconds })}</span></dd>
            <dt>{t("safDbClock")}</dt><dd>{c.database_clock_offset_seconds === null ? "—" : t("safSeconds", { n: c.database_clock_offset_seconds })}</dd>
            {c.witness && <><dt>{t("safWitness")}</dt><dd>{c.witness.error ? c.witness.error : t("safSeconds", { n: c.witness.offset_seconds ?? 0 })}</dd></>}
            {s.demo_time_travel && <><dt>{t("safDemoOffset")}</dt><dd>{t("safSeconds", { n: s.demo_time_travel.offset_seconds })}</dd></>}
          </dl>
          <p className="hint">{t("safClockHow")}</p>
        </div>

        <div className="safety-block">
          <div className="safety-head"><Network size={18} aria-hidden="true" /> <strong>{t("safSpoof")}</strong>
            <span className={`pill ${sp.subnet_clustering ? "pill-VERIFIED_BUSINESS" : "pill-NO_REPORTS"}`}>{sp.subnet_clustering ? t("integOn") : t("integOff")}</span>
          </div>
          <p className="small">{t("safSpoofRule", { w: sp.window_minutes, p: sp.min_prefixes, a: sp.min_accounts })}</p>
          <p className="small muted">{t("safSpoofNet", { h: sp.same_network_window_hours })}</p>
          <div className="mini-label" style={{ marginTop: 10 }}>{t("safSources")}</div>
          <ul className="plain-kv">
            {Object.entries(s.scam_type_sources).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <li key={k}><span>{t(SOURCE_KEY[k] ?? "srcDefault")}</span><strong>{fmt(n, lang)}</strong></li>
            ))}
          </ul>
        </div>

        <div className="safety-block span-2">
          <div className="safety-head"><BrainCircuit size={18} aria-hidden="true" /> <strong>{t("safAi")}</strong>
            <span className={`pill ${ai.ready ? "pill-VERIFIED_BUSINESS" : "pill-NO_REPORTS"}`}>{ai.ready ? ai.model : t("safOff")}</span>
          </div>
          {!ai.ready && ai.reason && <p className="small" style={{ color: "var(--warn-ink)" }}>{c.status === "OK" ? ai.reason : ""}</p>}
          <p className="small muted">{t("safAiHow")}</p>
          <div className="kpis kpis-4" style={{ margin: "10px 0" }}>
            <div className="kpi"><span className="kpi-label">{t("safNotesRead")}</span><span className="kpi-value">{fmt(ai.read, lang)}</span>{ai.avg_ms !== null && <span className="kpi-delta">{t("safAvg", { s: (ai.avg_ms / 1000).toFixed(1) })}</span>}</div>
            <div className="kpi"><span className="kpi-label">{t("safChanged")}</span><span className="kpi-value">{fmt(ai.changed, lang)}</span></div>
            <div className="kpi"><span className="kpi-label">{t("safConfirmed")}</span><span className="kpi-value">{fmt(ai.confirmed, lang)}</span></div>
            <div className="kpi"><span className="kpi-label">{t("safQueue")}</span><span className="kpi-value">{fmt(ai.queue, lang)}</span></div>
          </div>
          {ai.recent.length > 0 && (
            <ul className="ai-recent">
              {ai.recent.slice(0, 6).map((r, i) => (
                <li key={i}>
                  {r.outcome === "changed" ? <ShieldCheck size={15} aria-hidden="true" /> : <ShieldX size={15} aria-hidden="true" style={{ opacity: 0.4 }} />}
                  <span>{areaName(AREA_BY_PIN.get(r.pincode), lang) || r.pincode}, {r.language}: {typeName(r.from, lang)} → <strong>{typeName(r.to, lang)}</strong> ({Math.round(r.confidence * 100)}%)</span>
                </li>
              ))}
            </ul>
          )}
          <NoteTry />
        </div>
      </div>
    </section>
  );
}
