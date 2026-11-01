import { Sparkle, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AREA_BY_PIN } from "../../../shared/areas.js";
import { api, type Alert, type Cluster, type Forecast } from "../api";
import { ThreatPanel, ThreatToggle } from "../components/GlobalThreats";
import { MapView } from "../components/MapView";
import { areaName, fmt, typeName, useApp } from "../ctx";
import { ScamIcon } from "../icons";
import { useLive } from "../live";
import { get, loadMapStyle, saveMapStyle, set } from "../storage";
import { useGlobalThreats } from "../threats";

export function MapScreen() {
  const { t, lang } = useApp();
  const [days, setDays] = useState(7);
  const [mode, setMode] = useState<"now" | "forecast">("now");
  const [styleId, setStyleId] = useState(() => loadMapStyle("streets"));
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [fly, setFly] = useState<[number, number, number] | null>(null);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0);
  // Layer A (community reports, from GET /map) is always drawn; layer B adds the global URLhaus feed on top.
  const [global, setGlobal] = useState(() => get("sm.globalLayer") === "1");
  const threats = useGlobalThreats(global);
  const toggleGlobal = (on: boolean): void => {
    setGlobal(on);
    set("sm.globalLayer", on ? "1" : null);
    setFly(on ? [24, 30, 2] : [22.6, 79.2, 5]);
  };

  useEffect(() => {
    setErr(false);
    // k=3: areas with fewer than 3 reports come back hidden, so one report can never be pinned to a place.
    api<{ clusters: Cluster[] }>(`/map?days=${days}&k=3`).then((r) => {
      setHidden(r.clusters.filter((c) => c.suppressed).length);
      setClusters(r.clusters.filter((c) => !c.suppressed));
    }).catch(() => setErr(true));
    api<{ alerts: Alert[] }>("/alerts").then((r) => setAlerts(r.alerts)).catch(() => undefined);
    api<Forecast>("/live/forecast").then(setForecast).catch(() => undefined);
  }, [days, tick]);
  // A new alert anywhere refreshes the map; new reports refresh it at most every 20 s.
  useLive((e) => {
    if (e.replay) return;
    if (e.type === "alert") setTick((x) => x + 1);
  });
  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 20_000);
    return () => window.clearInterval(id);
  }, []);

  const changeStyle = (id: string): void => {
    setStyleId(id);
    saveMapStyle(id);
  };
  const focus = (pin: string): void => {
    const a = AREA_BY_PIN.get(pin);
    setSel(pin);
    if (a) setFly([a.lat, a.lng, 12]);
  };
  const fByPin = useMemo(() => new Map((forecast?.areas ?? []).map((f) => [f.pincode, f])), [forecast]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("mapTitle")}</h1>
          <p>{t("mapIntro")}</p>
        </div>
        <div className="row">
          <ThreatToggle on={global} onChange={toggleGlobal} />
          <div className="seg" role="group" aria-label={t("mapTitle")}>
            <button aria-pressed={mode === "now"} onClick={() => setMode("now")}>{t("viewNow")}</button>
            <button aria-pressed={mode === "forecast"} onClick={() => setMode("forecast")}>{t("viewForecast")}</button>
          </div>
          {mode === "now" && (
            <div className="seg" role="group" aria-label="Period">
              <button aria-pressed={days === 7} onClick={() => setDays(7)}>{t("last7")}</button>
              <button aria-pressed={days === 1} onClick={() => setDays(1)}>{t("last24")}</button>
            </div>
          )}
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="alert-strip" aria-label={t("activeAlerts")}>
          <span className="hint">{t("activeAlerts")}</span>
          {alerts.map((a, i) => (
            <button key={i} className={`alert-chip ${a.type === "SPIKE" ? "is-spike" : "is-new"}`} onClick={() => { setMode("now"); focus(a.pincode); }}>
              {a.type === "SPIKE" ? <TrendingUp size={15} aria-hidden="true" /> : <Sparkle size={15} aria-hidden="true" />}
              <strong>{areaName(AREA_BY_PIN.get(a.pincode), lang) || a.locality}</strong>
              <span>{a.type === "SPIKE" ? t("alertSpikeTip", { n: a.count }) : t("alertNewTip", { type: typeName(a.scam_type ?? "other", lang) })}</span>
            </button>
          ))}
        </div>
      )}

      {err && <p className="error">{t("errorGeneric")}</p>}
      <div className="map-layout">
        <MapView clusters={clusters ?? []} alerts={alerts} forecast={forecast?.areas ?? null} mode={mode} styleId={styleId} onStyle={changeStyle} selected={sel} onSelect={setSel} fly={fly} zoom={global ? 2 : undefined} threats={global ? threats.items : undefined} flash={threats.flash} />
        <div className="map-list" aria-label={t("chartAreas")}>
          {global && <ThreatPanel g={threats} />}
          {mode === "now" && clusters && clusters.length === 0 && <p className="muted">{t("noAreaReports")}</p>}
          {mode === "now" && hidden > 0 && <p className="hint k-note" title={t("mapFewer")}>{t("mapHidden", { n: hidden })}. {t("mapFewer")}</p>}
          {mode === "now" && (clusters ?? []).map((c) => {
            const f = fByPin.get(c.pincode);
            return (
              <button key={c.pincode} className={`area-row ${sel === c.pincode ? "sel" : ""}`} onClick={() => focus(c.pincode)}>
                <span><strong>{areaName(AREA_BY_PIN.get(c.pincode), lang)}</strong> <span className="muted small">{c.city}</span></span>
                <span className="count">{fmt(c.count, lang)}</span>
                <span className={`sev sev-${c.severity}`}>{t(`sev${c.severity}` as const)}{c.spike ? `, ${t("spiking").toLowerCase()}` : ""}</span>
                <span className="row small muted" style={{ gap: 5, justifyContent: "flex-end" }}><ScamIcon type={c.top_scam_type} size={14} /> {typeName(c.top_scam_type, lang)}</span>
                {f && f.trend !== "quiet" && f.trend !== "steady" && <span className={`trend trend-${f.trend}`}>{t(`trend_${f.trend}` as const)}</span>}
              </button>
            );
          })}
          {mode === "forecast" && (forecast?.areas ?? []).filter((f) => f.next24 > 0 || f.last24 > 0).map((f) => (
            <button key={f.pincode} className={`area-row ${sel === f.pincode ? "sel" : ""}`} onClick={() => focus(f.pincode)}>
              <span><strong>{lang === "hi" ? f.locality_hi : f.locality}</strong> <span className="muted small">{f.city}</span></span>
              <span className="count">{fmt(f.next24, lang)}</span>
              <span className={`trend trend-${f.trend}`}>{t(`trend_${f.trend}` as const)}</span>
              <span className="small muted" style={{ textAlign: "right" }}>{f.spike_now ? t("etaNow") : f.eta_hours !== null ? t("etaHours", { h: Math.max(1, Math.round(f.eta_hours)) }) : t("etaNone")}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
