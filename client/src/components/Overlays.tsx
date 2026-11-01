import { Clock3, KeyRound, LocateFixed, Lock, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AREAS, haversineKm } from "../../../shared/areas.js";
import { api, ApiError, type LicenceInfo } from "../api";
import { areaName, useApp } from "../ctx";
import { translate } from "../i18n";

/** Area chooser. "Use my location" finds the nearest area ON THE PHONE; coordinates are never sent. */
export function AreaPicker({ onClose }: { onClose: () => void }) {
  const { t, lang, setArea, area } = useApp();
  const [q, setQ] = useState("");
  const [locating, setLocating] = useState(false);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return AREAS.filter((a) => !s || `${a.locality} ${a.localityHi} ${a.city} ${a.pincode}`.toLowerCase().includes(s));
  }, [q]);
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const choose = (pin: string): void => {
    setArea(pin);
    onClose();
  };
  const locate = (): void => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const nearest = [...AREAS].sort((a, b) => haversineKm(latitude, longitude, a.lat, a.lng) - haversineKm(latitude, longitude, b.lat, b.lng))[0];
        setLocating(false);
        if (nearest) choose(nearest.pincode);
      },
      () => setLocating(false),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600_000 },
    );
  };
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t("chooseArea")} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{t("chooseArea")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("close")}><X size={20} /></button>
        </div>
        <button className="btn btn-quiet" onClick={locate} disabled={locating}><LocateFixed size={18} aria-hidden="true" /> {t("useLocation")}</button>
        <p className="hint">{t("locationNote")}</p>
        <input className="field" placeholder={t("searchArea")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <ul className="area-list">
          {list.map((a) => (
            <li key={a.pincode}>
              <button aria-pressed={area?.pincode === a.pincode} onClick={() => choose(a.pincode)}>
                <span>{areaName(a, lang)}</span>
                <span className="hint">{a.city} {a.pincode}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** GET /license and an upload box for a new signed licence (POST /license). */
export function LicencePanel({ onInstalled }: { onInstalled?: () => void }) {
  const { t, lang } = useApp();
  const [info, setInfo] = useState<LicenceInfo | null>(null);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const refresh = useCallback(() => {
    api<LicenceInfo>("/license").then(setInfo).catch(() => setInfo(null));
  }, []);
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [refresh]);
  const install = async (raw: string): Promise<void> => {
    setMsg("");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      setMsg("This is not a licence file (not valid JSON).");
      return;
    }
    try {
      await api("/license", { method: "POST", body });
      setMsg(t("licenceInstalled"));
      setText("");
      refresh();
      onInstalled?.();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : t("errorGeneric"));
    }
  };
  const left = info?.seconds_remaining ?? 0;
  const remaining = left >= 2 * 86400 ? `${Math.floor(left / 86400)} days left` : left >= 7200 ? `${Math.floor(left / 3600)} h left` : `${Math.floor(left / 60)} min ${left % 60} s left`;
  return (
    <section className="card">
      <h3><KeyRound size={18} aria-hidden="true" /> {t("licenceTitle")}</h3>
      {info && (
        <dl className="facts">
          <div><dt>{t("licensee")}</dt><dd>{info.licensee ?? "None"}</dd></div>
          <div><dt>{t("expires")}</dt><dd>{info.expires_at ? new Date(info.expires_at).toLocaleString(lang === "hi" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) + " IST" : "None"}</dd></div>
          <div><dt>{t("status")}</dt><dd style={{ color: info.status === "VALID" ? "var(--ok)" : "var(--scam)" }}>{info.status === "VALID" ? `Valid, ${remaining}` : info.status}</dd></div>
        </dl>
      )}
      <details>
        <summary className="btn btn-text">{t("uploadLicence")}</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          <input type="file" accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(install); }} />
          <textarea className="field" rows={4} placeholder={t("pasteLicence")} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary" onClick={() => void install(text)} disabled={!text.trim()}>{t("installLicence")}</button>
        </div>
      </details>
      {msg && <p className="hint">{msg}</p>}
    </section>
  );
}

/** Full-screen lock shown on any 403 LICENSE_EXPIRED. Polls GET /license and unlocks itself once renewed. */
export function ExpiredOverlay({ onRecovered }: { onRecovered: () => void }) {
  const { t, lang } = useApp();
  const [upload, setUpload] = useState(false);
  const [info, setInfo] = useState<LicenceInfo | null>(null);
  useEffect(() => {
    const poll = (): void => {
      api<LicenceInfo>("/license").then((i) => {
        setInfo(i);
        if (i.status === "VALID") onRecovered();
      }).catch(() => undefined);
    };
    poll();
    const id = window.setInterval(poll, 5_000);
    return () => window.clearInterval(id);
  }, [onRecovered]);
  // Time-travel defence: a specific safety screen when the server clock was set back.
  if (info?.status === "CLOCK_ROLLBACK") {
    const behind = info.clock?.behind_seconds ?? 0;
    const span = (l: string): string => {
      const [n, en, hi] = behind >= 86_400 ? [Math.round(behind / 86_400), "day", "दिन"] : behind >= 3600 ? [Math.round(behind / 3600), "hour", "घंटे"] : [Math.max(1, Math.round(behind / 60)), "minute", "मिनट"];
      return l === "hi" ? `${n} ${hi}` : `${n} ${en}${n === 1 ? "" : "s"}`;
    };
    return (
      <div className="expired clock-lock" role="alertdialog" aria-modal="true" aria-labelledby="exp-title">
        <div className="expired-box">
          <Clock3 size={48} aria-hidden="true" />
          <h1 id="exp-title">{t("clockLockTitle")}</h1>
          <p className="expired-body">{t("clockLockBody", { t: span(lang) })}</p>
          <p className="expired-alt">{translate(lang === "hi" ? "en" : "hi", "clockLockBody", { t: span(lang === "hi" ? "en" : "hi") })}</p>
          <p className="expired-alt small">{t("clockLockSeen", { at: (info.clock?.high_water_mark ?? "").slice(0, 16).replace("T", " "), now: info.server_time.slice(0, 16).replace("T", " ") })}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="expired" role="alertdialog" aria-modal="true" aria-labelledby="exp-title">
      <div className="expired-box">
        <Lock size={48} aria-hidden="true" />
        <h1 id="exp-title">{t("expiredTitle")}</h1>
        <p className="expired-body">{t("expiredBody")}</p>
        <p className="expired-alt">{translate(lang === "hi" ? "en" : "hi", "expiredBody")}</p>
        <p className="expired-alt small">{t("expiredWait")}</p>
        <button className="btn btn-text" style={{ color: "#9cd0d7" }} onClick={() => setUpload((u) => !u)}>{t("uploadLicence")}</button>
        {upload && <LicencePanel onInstalled={onRecovered} />}
      </div>
    </div>
  );
}

export function Wordmark({ onClick }: { onClick?: () => void }) {
  const { t } = useApp();
  return (
    <button className="wordmark" onClick={onClick} aria-label={t("appName")}>
      <svg className="wordmark-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#b3261e" />
        <path d="M16 6.5c-3.6 0-6.5 2.9-6.5 6.5 0 4.6 6.5 12.5 6.5 12.5s6.5-7.9 6.5-12.5c0-3.6-2.9-6.5-6.5-6.5z" fill="#fff" />
        <rect x="14.9" y="9.2" width="2.2" height="5.4" rx="1.1" fill="#b3261e" />
        <circle cx="16" cy="16.6" r="1.25" fill="#b3261e" />
      </svg>
      <span lang="en">ScamMap</span>
    </button>
  );
}
