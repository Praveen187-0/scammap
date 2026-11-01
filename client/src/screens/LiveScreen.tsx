import { ArrowDownRight, ArrowUpRight, Bell, Languages, Minus, Radio, ShieldX, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type Alert, type Cluster, type DatasetSummary, type Forecast, type LiveEvent } from "../api";
import { ChartCard, Spark, StackedColumns } from "../charts/Charts";
import { CardReplay } from "../components/CardReplay";
import { ThreatTicker, ThreatToggle } from "../components/GlobalThreats";
import { LIVE_DEFAULT_STYLE, MAP_STYLES, MapView } from "../components/MapView";
import { fmt, typeName, useApp } from "../ctx";
import type { StringKey } from "../i18n";
import { ScamIcon } from "../icons";
import { useLive } from "../live";
import { get, loadLiveStyle, saveLiveStyle, set } from "../storage";
import { useGlobalThreats } from "../threats";

function ago(iso: string, lang: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 45) return lang === "hi" ? "अभी" : "just now";
  const m = Math.round(s / 60);
  if (m < 60) return lang === "hi" ? `${m} मिनट पहले` : `${m} min ago`;
  return new Date(iso).toLocaleTimeString(lang === "hi" ? "hi-IN" : "en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

function FeedItem({ e }: { e: LiveEvent }) {
  const { t, lang } = useApp();
  const area = lang === "hi" ? e.locality_hi : e.locality;
  if (e.type === "report") {
    return (
      <li className={`feed-item f-report ${e.counted ? "" : "is-muted"}`}>
        <span className="feed-icon"><ScamIcon type={e.scam_type} size={17} /></span>
        <div>
          <p>{t("evReport", { type: typeName(e.scam_type, lang), area })}{!e.counted && <span className="hint">, {t("evSetAside")}</span>}</p>
          <span className="hint">{e.city}, {ago(e.at, lang)}</span>
        </div>
      </li>
    );
  }
  if (e.type === "classified") {
    return (
      <li className="feed-item f-classified">
        <span className="feed-icon"><Languages size={17} aria-hidden="true" /></span>
        <div>
          <p>{t(e.outcome === "changed" ? "evClassified" : "evConfirmed", { area, type: typeName(e.scam_type, lang), lang: e.language })}</p>
          <span className="hint">{e.city}, {ago(e.at, lang)}</span>
        </div>
      </li>
    );
  }
  if (e.type === "defence") {
    return (
      <li className="feed-item f-defence">
        <span className="feed-icon"><ShieldX size={17} aria-hidden="true" /></span>
        <div>
          <p>{t(`ev_${e.kind}` as StringKey, { area, reports: e.reports, people: e.people })}</p>
          <span className="hint">{e.city}, {ago(e.at, lang)}</span>
        </div>
      </li>
    );
  }
  return (
    <li className="feed-item f-alert">
      <span className="feed-icon"><Bell size={17} aria-hidden="true" /></span>
      <div>
        <p>{lang === "hi" ? e.alert.message_hi : e.alert.message_en}</p>
        <span className="hint">{e.city}, {ago(e.at, lang)}</span>
      </div>
    </li>
  );
}

const TREND_ICON = { rising_fast: ArrowUpRight, rising: ArrowUpRight, steady: Minus, cooling: ArrowDownRight, quiet: Minus } as const;

export function LiveScreen() {
  const { t, lang } = useApp();
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [newReports, setNewReports] = useState(0);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [cards, setCards] = useState<number | null>(null);
  const [global, setGlobal] = useState(() => get("sm.globalLayer") === "1");
  const [fly, setFly] = useState<[number, number, number] | null>(null);
  const threats = useGlobalThreats(global);
  const toggleGlobal = (on: boolean): void => {
    setGlobal(on);
    set("sm.globalLayer", on ? "1" : null);
    setFly(on ? [24, 30, 2] : [22.6, 79.2, 4]);
  };
  const [, setNow] = useState(0);
  const [styleId, setStyleId] = useState(() => {
    const saved = loadLiveStyle(LIVE_DEFAULT_STYLE);
    return MAP_STYLES.some((s) => s.id === saved) ? saved : LIVE_DEFAULT_STYLE;
  });

  const load = useCallback(() => {
    api<Forecast>("/live/forecast").then(setForecast).catch(() => undefined);
    api<{ clusters: Cluster[] }>("/map?days=1&k=3").then((r) => setClusters(r.clusters.filter((c) => !c.suppressed))).catch(() => undefined);
    api<{ alerts: Alert[] }>("/alerts").then((r) => setAlerts(r.alerts)).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    api<DatasetSummary>("/datasets/summary").then((d) => setCards(d.cards?.test_rows ?? 0)).catch(() => setCards(0));
    const id = window.setInterval(load, 30_000);
    const tick = window.setInterval(() => setNow((x) => x + 1), 30_000); // refresh "x min ago"
    return () => {
      window.clearInterval(id);
      window.clearInterval(tick);
    };
  }, [load]);

  const status = useLive((e) => {
    setFeed((f) => (f.some((x) => x.id === e.id) ? f : [e, ...f].slice(0, 40)));
    if (!e.replay && e.type === "report") setNewReports((n) => n + 1);
    if (!e.replay && e.type === "alert") load();
  });

  const blocked = feed.filter((e) => e.type === "defence").length;
  const atAlert = forecast?.areas.filter((a) => a.spike_now).length ?? 0;
  const heading = (forecast?.areas ?? []).filter((a) => a.last24 > 0 || a.next24 > 0).slice(0, 8);
  const hourLabel = (iso: string): string => new Date(iso).toLocaleTimeString(lang === "hi" ? "hi-IN" : "en-IN", { hour: "numeric", timeZone: "Asia/Kolkata" });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="row" style={{ gap: 12 }}>
            {t("liveTitle")}
            <span className={`live-pill is-${status}`}><span className="live-dot" aria-hidden="true" />{status === "open" ? t("liveConnected") : status === "connecting" ? t("liveConnecting") : t("liveOffline")}</span>
          </h1>
          <p>{t("liveIntro")}</p>
        </div>
      </div>

      <div className="kpis live-kpis">
        <div className="kpi"><span className="kpi-label">{t("statReports")}</span><span className="kpi-value">{fmt(newReports, lang)}</span></div>
        <div className="kpi"><span className="kpi-label">{t("statBlocked")}</span><span className="kpi-value">{fmt(blocked, lang)}</span></div>
        <div className="kpi"><span className="kpi-label">{t("statSpikes")}</span><span className="kpi-value" style={{ color: atAlert ? "var(--scam)" : undefined }}>{atAlert}</span></div>
        <div className="kpi"><span className="kpi-label">{t("statNext24")}</span><span className="kpi-value">{forecast ? fmt(forecast.total_next24, lang) : "-"}</span></div>
      </div>

      <div className="live-grid">
        <div className="live-map">
          <MapView
            clusters={clusters} alerts={alerts} forecast={forecast?.areas ?? null} styleId={styleId} onStyle={(id) => { setStyleId(id); saveLiveStyle(id); }}
            fly={fly} zoom={global ? 2 : undefined} threats={global ? threats.items : undefined} flash={threats.flash}
            overlay={<>
              <ThreatToggle on={global} onChange={toggleGlobal} floating />
              {global && <ThreatTicker g={threats} />}
            </>}
          />
        </div>
        <section className="card feed">
          <div className="card-head"><div><h3><Radio size={17} aria-hidden="true" /> {t("feedTitle")}</h3></div></div>
          {feed.length === 0 ? <p className="muted">{t("feedEmpty")}</p> : <ul className="feed-list">{feed.map((e) => <FeedItem key={e.id} e={e} />)}</ul>}
        </section>
      </div>

      <div className="ins-grid" style={{ marginTop: 14 }}>
        <section className="card span-12">
          <div className="card-head"><div><h3>{t("headingTitle")}</h3><p>{t("headingSub")}</p></div></div>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table heading-table">
              <thead><tr><th>{t("colArea")}</th><th>{t("colLast7")}</th><th className="num">{t("colPace")}</th><th className="num">{t("colNext24")}</th><th>{t("colOutlook")}</th></tr></thead>
              <tbody>
                {heading.map((a) => {
                  const I = TREND_ICON[a.trend];
                  return (
                    <tr key={a.pincode} className={a.spike_now ? "row-alert" : ""}>
                      <td><strong>{lang === "hi" ? a.locality_hi : a.locality}</strong> <span className="muted small">{a.city}</span>{a.top_type && <div className="hint row" style={{ gap: 4 }}><ScamIcon type={a.top_type} size={13} /> {typeName(a.top_type, lang)}</div>}</td>
                      <td><span className="row" style={{ gap: 8, flexWrap: "nowrap" }}><Spark values={a.daily} last={a.spike_now ? "var(--scam)" : "var(--ink)"} /> <span className="small">{a.last24}</span></span></td>
                      <td className="num">{t("perHour", { n: a.pace_per_hour })}</td>
                      <td className="num"><strong>{a.next24}</strong></td>
                      <td>
                        <span className={`trend trend-${a.trend}`}><I size={14} aria-hidden="true" /> {t(`trend_${a.trend}` as const)}</span>
                        <div className={`small ${a.spike_now ? "eta-now" : "muted"}`}>
                          {a.spike_now ? <><TriangleAlert size={13} aria-hidden="true" /> {t("etaNow")}</> : a.eta_hours !== null ? t("etaHours", { h: Math.max(1, Math.round(a.eta_hours)) }) : t("etaNone")}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {forecast && <p className="hint small">{forecast.method}</p>}
        </section>

        {forecast && (
          <ChartCard className="span-7" title={t("hourlyTitle")} sub={t("hourlySub")} table={{ columns: [{ label: "Hour" }, { label: t("colReports"), num: true }], rows: forecast.hourly.map((h) => [hourLabel(h.at), h.expected]) }}>
            <StackedColumns data={forecast.hourly.map((h) => ({ x: h.at, values: [h.expected] }))} series={[{ name: t("colNext24"), color: "var(--series-1)" }]} xLabel={hourLabel} />
          </ChartCard>
        )}
        {forecast && (
          <section className="card span-5">
            <div className="card-head"><div><h3>{t("typesTitle")}</h3><p>{t("typesSub")}</p></div></div>
            <ul className="type-trends">
              {forecast.types.map((x) => (
                <li key={x.scam_type}>
                  <span className="row" style={{ gap: 8 }}><ScamIcon type={x.scam_type} size={16} /> {typeName(x.scam_type, lang)}</span>
                  <span className="muted small">{x.last3d}</span>
                  <span className={`change ${x.change_pct === null || x.change_pct > 0 ? "up" : x.change_pct < 0 ? "down" : ""}`}>{x.change_pct === null ? "new" : `${x.change_pct > 0 ? "+" : ""}${x.change_pct}%`}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {cards !== null && <CardReplay total={cards} />}
      </div>
    </div>
  );
}
