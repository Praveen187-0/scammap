import { Globe2, ShieldAlert } from "lucide-react";
import type { ThreatItem } from "../api";
import { BarList } from "../charts/Charts";
import { fmt, useApp } from "../ctx";
import type { StringKey } from "../i18n";
import type { GlobalThreats } from "../threats";

const LOCATED: Record<string, StringKey> = { domain: "thrByDomain", ip: "thrByIp", hosting: "thrByHosting" };

export function ago(iso: string, lang: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return lang === "hi" ? "अभी" : "just now";
  if (m < 60) return lang === "hi" ? `${m} मिनट पहले` : `${m} min ago`;
  const h = Math.round(m / 60);
  return lang === "hi" ? `${h} घंटे पहले` : `${h} h ago`;
}

/** Layer switch: community reports (layer A) are always on; this adds the global feed (layer B). */
export function ThreatToggle({ on, onChange, floating }: { on: boolean; onChange: (v: boolean) => void; floating?: boolean }) {
  const { t } = useApp();
  return (
    <button className={`threat-toggle ${floating ? "floating" : ""}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <Globe2 size={16} aria-hidden="true" /> {t("thrLayer")}
      <span className="switch" aria-hidden="true"><span /></span>
    </button>
  );
}

/** What a marker's popup says. The URL is defanged text, never a link. */
export function ThreatDetails({ it }: { it: ThreatItem }) {
  const { t, lang } = useApp();
  return (
    <div className="popup threat-popup">
      <h3><ShieldAlert size={16} aria-hidden="true" /> {t("thrPopupTitle")}</h3>
      <code className="defanged">{it.display}</code>
      <p>{it.threat}{it.tags.length ? `: ${it.tags.join(", ")}` : ""}</p>
      <p>{it.country_name ?? "?"} <span className="muted">({t(LOCATED[it.located_by ?? ""] ?? "thrByIp")})</span></p>
      <p className="muted">{t(it.status === "online" ? "thrOnline" : it.status === "offline" ? "thrOffline" : "thrUnknown")}, {ago(it.added, lang)}</p>
      {it.reference && <a href={it.reference} target="_blank" rel="noreferrer">{t("thrReference")}</a>}
    </div>
  );
}

/** Side panel for the Map screen: status, top countries, newest URLs. */
export function ThreatPanel({ g }: { g: GlobalThreats }) {
  const { t, lang } = useApp();
  const st = g.status;
  return (
    <div className="threat-panel">
      <div className="threat-panel-head">
        <strong><Globe2 size={16} aria-hidden="true" /> {t("thrTitle")}</strong>
        {st && <span className={`live-pill ${st.connected ? "is-open" : "is-retrying"}`}><span className="live-dot" aria-hidden="true" />{st.connected ? t("thrLive") : t("thrOff")}</span>}
      </div>
      {!g.ready && <div className="skeleton-line" style={{ width: "70%" }} />}
      {st && !st.connected && <p className="small threat-off">{st.reason}</p>}
      {st?.connected && (
        <p className="hint">{t("thrUpdated", { ago: st.last_fetch ? ago(st.last_fetch, lang) : "?", n: fmt(st.located, lang) })}</p>
      )}
      {g.countries.length > 0 && (
        <>
          <div className="mini-label">{t("thrCountries")}</div>
          <BarList rows={g.countries.slice(0, 6).map((c) => ({ label: `${c.code} ${c.name}`, value: c.count }))} />
        </>
      )}
      {g.items.length > 0 && (
        <>
          <div className="mini-label" style={{ marginTop: 10 }}>{t("thrNewest")}</div>
          <ul className="threat-list">
            {g.items.slice(0, 25).map((it) => (
              <li key={it.id} className={g.flash.has(it.id) ? "is-new" : ""}>
                <span className="cc">{it.country ?? "--"}</span>
                <span className="defanged">{it.host}</span>
                <span className="muted small">{it.tags[0] ?? it.threat}, {ago(it.added, lang)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="hint">{t("thrNote")} {g.attribution && <a href={g.attribution.url} target="_blank" rel="noreferrer">{g.attribution.name}</a>}</p>
    </div>
  );
}

/** Small overlay on the Live map: the last few URLs as they arrive. */
export function ThreatTicker({ g }: { g: GlobalThreats }) {
  const { t, lang } = useApp();
  if (!g.status) return null;
  return (
    <div className="threat-ticker" aria-live="polite">
      <div className="threat-ticker-head"><Globe2 size={14} aria-hidden="true" /> {g.status.connected ? t("thrTicker") : g.status.reason}</div>
      <ul>
        {g.latest.map((it) => (
          <li key={it.id}><span className="cc">{it.country ?? "--"}</span> <span className="defanged">{it.host}</span> <span className="muted">{ago(it.added, lang)}</span></li>
        ))}
      </ul>
    </div>
  );
}
