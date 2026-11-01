import { Activity, Bell, Building2, ChartColumn, CloudOff, HandCoins, LifeBuoy, MapIcon, MapPin, Menu, Network, ScanSearch, Siren, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AREA_BY_PIN } from "../../shared/areas.js";
import { api, onLicenceExpired, type Alert, type LicenceInfo } from "./api";
import { LanguageMenu } from "./components/LanguageMenu";
import { AreaPicker, ExpiredOverlay, Wordmark } from "./components/Overlays";
import { areaName, Ctx, type AppCtx, type Tab } from "./ctx";
import { translate, type Lang, type StringKey } from "./i18n";
import { startQueue, useQueueCount } from "./offline";
import { AlertsScreen } from "./screens/AlertsScreen";
import { CampaignsScreen } from "./screens/CampaignsScreen";
import { CheckScreen } from "./screens/CheckScreen";
import { LostMoneyScreen } from "./screens/LostMoneyScreen";
import { PartnersScreen } from "./screens/PartnersScreen";
import { InsightsScreen } from "./screens/InsightsScreen";
import { LiveScreen } from "./screens/LiveScreen";
import { MapScreen } from "./screens/MapScreen";
import { MoreScreen } from "./screens/MoreScreen";
import { ReportScreen } from "./screens/ReportScreen";
import { onLiveExpired, reconnectLive } from "./live";
import { loadArea, loadLang, saveArea, saveLang } from "./storage";

interface NavItem {
  id: Tab;
  icon: LucideIcon;
  key: StringKey;
  short?: StringKey;
}
// Desktop rail order, and (minus "more") the phone tab bar order. Report sits in the middle of the tab bar.
const RAIL: NavItem[] = [
  { id: "check", icon: ScanSearch, key: "navCheck" },
  { id: "map", icon: MapIcon, key: "navMap" },
  { id: "live", icon: Activity, key: "navLive" },
  { id: "alerts", icon: Bell, key: "navAlerts" },
  { id: "insights", icon: ChartColumn, key: "navInsights" },
  { id: "campaigns", icon: Network, key: "navCampaigns" },
  { id: "partners", icon: Building2, key: "navPartners" },
  { id: "more", icon: LifeBuoy, key: "navMore" },
];
const TABBAR: NavItem[] = [
  { id: "check", icon: ScanSearch, key: "navCheck" },
  { id: "map", icon: MapIcon, key: "navMap" },
  { id: "report", icon: Siren, key: "navReport", short: "navReportShort" },
  { id: "live", icon: Activity, key: "navLive" },
  { id: "insights", icon: ChartColumn, key: "navInsights" },
];
const ALL_TABS: Tab[] = ["check", "report", "map", "live", "alerts", "insights", "more", "lost", "campaigns", "partners"];

// Screens live in the URL hash (#map), never in paths like /map, which are API endpoints on the same server.
const tabFromHash = (): Tab => {
  const h = window.location.hash.replace("#", "") as Tab;
  return ALL_TABS.includes(h) ? h : "check";
};

/** Text shared from another app (Web Share Target) arrives as ?text=...; it opens the report screen pre-filled. */
function sharedText(): string {
  const p = new URLSearchParams(window.location.search);
  const parts = [p.get("title"), p.get("text"), p.get("url")].filter((x): x is string => Boolean(x));
  if (parts.length) window.history.replaceState(null, "", "/#report");
  return parts.join(" ");
}

export function App() {
  const [lang, setLang] = useState<Lang>(loadLang);
  const [areaPin, setAreaPin] = useState<string | null>(loadArea);
  const [shared] = useState(sharedText);
  const [tab, setTab] = useState<Tab>(shared ? "report" : tabFromHash());
  const [payload, setPayload] = useState(shared);
  const [disputeValue, setDisputeValue] = useState("");
  const [picker, setPicker] = useState(false);
  const [expired, setExpired] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [alertCount, setAlertCount] = useState(0);
  const waiting = useQueueCount();

  useEffect(() => startQueue(), []);

  useEffect(() => {
    onLicenceExpired(() => setExpired(true));
    onLiveExpired(() => setExpired(true));
  }, []);
  // Check the licence in the background too, so the expired screen appears even if nobody taps anything.
  useEffect(() => {
    const check = (): void => {
      api<LicenceInfo>("/license").then((i) => i.status !== "VALID" && setExpired(true)).catch(() => undefined);
    };
    check();
    const id = window.setInterval(check, 20_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (expired) return;
    api<{ alerts: Alert[] }>("/alerts").then((r) => setAlertCount(areaPin ? r.alerts.filter((a) => a.pincode === areaPin).length : r.alerts.length)).catch(() => undefined);
  }, [areaPin, expired, epoch]);
  useEffect(() => {
    const f = (): void => setTab(tabFromHash());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === "hi" ? "स्कैम मैप: भरोसा करने से पहले जाँचें" : "ScamMap: check a number before you trust it";
  }, [lang]);

  const go = useCallback((next: Tab, fill?: string) => {
    if (fill !== undefined) setPayload(fill);
    if (window.location.hash !== `#${next}`) window.location.hash = next;
    setTab(next);
    window.scrollTo(0, 0);
  }, []);

  const ctx: AppCtx = useMemo(
    () => ({
      lang,
      t: (key, vars) => translate(lang, key, vars),
      area: areaPin ? (AREA_BY_PIN.get(areaPin) ?? null) : null,
      setArea: (pin) => {
        saveArea(pin);
        setAreaPin(pin);
      },
      openAreaPicker: () => setPicker(true),
      go,
      payload,
    }),
    [lang, areaPin, go, payload],
  );
  const { t } = ctx;

  const changeLang = (next: Lang): void => {
    saveLang(next);
    setLang(next);
  };
  const recovered = useCallback(() => {
    setExpired(false);
    setEpoch((e) => e + 1); // remount the screen so it reloads its data
    reconnectLive();
  }, []);
  const navTo = (id: Tab): void => go(id, id === "report" || id === "check" ? "" : undefined);

  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        <aside className="rail" aria-label="Main">
          <Wordmark onClick={() => navTo("check")} />
          <nav>
            <button className="rail-link report" onClick={() => navTo("report")} aria-current={tab === "report" ? "page" : undefined}>
              <Siren size={19} aria-hidden="true" /> {t("navReport")}
            </button>
            <button className="rail-link lost" onClick={() => go("lost", "")} aria-current={tab === "lost" ? "page" : undefined}>
              <HandCoins size={19} aria-hidden="true" /> {t("navLostShort")}
            </button>
            {RAIL.map((n) => (
              <button key={n.id} className="rail-link" onClick={() => navTo(n.id)} aria-current={tab === n.id ? "page" : undefined}>
                <n.icon size={19} aria-hidden="true" /> {t(n.key)}
                {n.id === "alerts" && alertCount > 0 && <span className="badge">{alertCount}</span>}
              </button>
            ))}
          </nav>
          <p className="rail-foot">{t("railFoot")}</p>
        </aside>

        <header className="topbar">
          <Wordmark onClick={() => navTo("check")} />
          <span className="topbar-spacer" />
          <button className="chip-btn" onClick={() => setPicker(true)} aria-label={t("chooseArea")}>
            <MapPin size={16} aria-hidden="true" /> {ctx.area ? areaName(ctx.area, lang) : t("chooseArea")}
          </button>
          {waiting > 0 && (
            <span className="chip-btn queued-chip" title={t("queued", { n: waiting })}><CloudOff size={15} aria-hidden="true" /> {waiting}</span>
          )}
          <LanguageMenu onChange={changeLang} />
          <button className="icon-btn bell-btn" onClick={() => navTo("alerts")} aria-label={t("alertsBell")} aria-current={tab === "alerts" ? "page" : undefined}>
            <Bell size={21} />
            {alertCount > 0 && <span className="badge">{alertCount}</span>}
          </button>
          <button className="icon-btn menu-btn" onClick={() => navTo("more")} aria-label={t("menu")}>
            <Menu size={22} />
          </button>
        </header>

        <main className="main" key={`${tab}-${epoch}`}>
          {tab === "check" && <CheckScreen onDispute={(v) => { setDisputeValue(v); go("more"); }} />}
          {tab === "report" && <ReportScreen />}
          {tab === "map" && <MapScreen />}
          {tab === "live" && <LiveScreen />}
          {tab === "alerts" && <AlertsScreen />}
          {tab === "insights" && <InsightsScreen />}
          {tab === "more" && <MoreScreen disputeValue={disputeValue} />}
          {tab === "lost" && <LostMoneyScreen />}
          {tab === "campaigns" && <CampaignsScreen />}
          {tab === "partners" && <PartnersScreen />}
        </main>

        <nav className="tabbar" aria-label="Main">
          {TABBAR.map((n) => (
            <button key={n.id} className={`tab ${n.id === "report" ? "tab-report" : ""}`} onClick={() => navTo(n.id)} aria-current={tab === n.id ? "page" : undefined}>
              <span className="tab-dot">
                <n.icon size={n.id === "report" ? 24 : 21} aria-hidden="true" />
              </span>
              <span>{t(n.short ?? n.key)}</span>
            </button>
          ))}
        </nav>

        {picker && <AreaPicker onClose={() => setPicker(false)} />}
        {expired && <ExpiredOverlay onRecovered={recovered} />}
      </div>
    </Ctx.Provider>
  );
}
