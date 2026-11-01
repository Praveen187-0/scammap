import L from "leaflet";
import { Layers } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { AREA_BY_PIN } from "../../../shared/areas.js";
import type { Alert, AreaForecast, Cluster, LiveEvent, ThreatItem } from "../api";
import { ThreatDetails } from "./GlobalThreats";
import { areaName, fmt, typeName, useApp } from "../ctx";
import type { StringKey } from "../i18n";
import { useLive } from "../live";
import { ScamIcon } from "../icons";

// Every style is drawn from OpenStreetMap data, and each provider's attribution is shown as its terms require.
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export interface MapStyle {
  id: string;
  key: StringKey;
  url: string;
  attribution: string;
  subdomains?: string;
  maxZoom: number;
  dark?: boolean;
  /** Style to switch to if this one's tiles fail (for example a wrong or over-quota API key). */
  fallback?: string;
}

// Optional MapTiler key (free plan at cloud.maptiler.com), read from VITE_MAPTILER_KEY in .env at BUILD time.
// It ends up in the browser, as map keys always do: restrict it to your site's address in MapTiler Cloud.
const MAPTILER_KEY = ((import.meta.env.VITE_MAPTILER_KEY as string | undefined) ?? "").trim();
const MAPTILER_ATTR = '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>';
const maptiler = (mapId: string): string => `https://api.maptiler.com/maps/${mapId}/256/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(MAPTILER_KEY)}`;

export const MAP_STYLES: MapStyle[] = [
  { id: "streets", key: "styleStreets", url: (import.meta.env.VITE_TILE_URL as string | undefined) || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: OSM, maxZoom: 19 },
  { id: "light", key: "styleLight", url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: `${OSM} &copy; <a href="https://carto.com/attributions">CARTO</a>`, subdomains: "abcd", maxZoom: 20 },
  { id: "dark", key: "styleDark", url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution: `${OSM} &copy; <a href="https://carto.com/attributions">CARTO</a>`, subdomains: "abcd", maxZoom: 20, dark: true },
  { id: "humanitarian", key: "styleHumanitarian", url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", attribution: `${OSM}, tiles by <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a> hosted by <a href="https://openstreetmap.fr/">OpenStreetMap France</a>`, subdomains: "abc", maxZoom: 19 },
  { id: "topo", key: "styleTopo", url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attribution: `Map data ${OSM}, SRTM. Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`, subdomains: "abc", maxZoom: 17 },
  ...(MAPTILER_KEY
    ? ([
        { id: "mt-dark", key: "styleMtDark", url: maptiler("dataviz-dark"), attribution: MAPTILER_ATTR, maxZoom: 20, dark: true, fallback: "dark" },
        { id: "mt-streets", key: "styleMtStreets", url: maptiler("streets-v4"), attribution: MAPTILER_ATTR, maxZoom: 20, fallback: "streets" },
      ] satisfies MapStyle[])
    : []),
];

/** The Live screen's default map: MapTiler's dark data-visualisation style when a key is set, else CARTO Dark Matter. */
export const LIVE_DEFAULT_STYLE = MAPTILER_KEY ? "mt-dark" : "dark";

export const SEV_COLOR = { CRIT: "#d03b3b", HIGH: "#ec835a", MED: "#fab219" } as const;
export const TREND_COLOR: Record<AreaForecast["trend"], string> = { rising_fast: "#d03b3b", rising: "#ec835a", steady: "#3b8fa0", cooling: "#2f9a64", quiet: "#9aa7b2" };
const INDIA: [number, number] = [22.6, 79.2];

function FlyTo({ target }: { target: [number, number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target[0], target[1]], target[2], { duration: 0.8 });
  }, [target, map]);
  return null;
}

interface Ping {
  id: number;
  lat: number;
  lng: number;
  kind: LiveEvent["type"];
}
const pingIcon = (kind: Ping["kind"]): L.DivIcon => L.divIcon({ className: "", html: `<span class="ping ping-${kind}"></span>`, iconSize: [64, 64], iconAnchor: [32, 32] });
// Layer B markers: small rings, distinct in shape from the filled community circles. New ones flash for a few seconds.
const threatIcons = new Map<string, L.DivIcon>();
function threatIcon(isNew: boolean, status: ThreatItem["status"]): L.DivIcon {
  const k = `${isNew}|${status}`;
  let icon = threatIcons.get(k);
  if (!icon) {
    icon = L.divIcon({ className: "", html: `<span class="threat-mark ${isNew ? "is-new" : ""} st-${status}"><i></i></span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
    threatIcons.set(k, icon);
  }
  return icon;
}
const pulseIcon = (r: number): L.DivIcon => L.divIcon({ className: "", html: `<div class="pulse-ring" style="width:${r * 2}px;height:${r * 2}px"></div>`, iconSize: [r * 2, r * 2], iconAnchor: [r, r] });

export function StylePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <div className="map-style">
      <button className="map-style-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t("mapStyle")}>
        <Layers size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="map-style-menu" role="radiogroup" aria-label={t("mapStyle")}>
          {MAP_STYLES.map((s) => (
            <button key={s.id} role="radio" aria-checked={value === s.id} onClick={() => { onChange(s.id); setOpen(false); }}>
              <span className={`style-swatch sw-${s.id}`} aria-hidden="true" /> {t(s.key)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MapView({
  clusters, alerts, forecast, mode = "now", styleId, onStyle, selected, onSelect, fly, zoom, live = true, threats, flash, overlay,
}: {
  clusters: Cluster[];
  alerts: Alert[];
  forecast?: AreaForecast[] | null;
  mode?: "now" | "forecast";
  styleId: string;
  onStyle?: (id: string) => void;
  selected?: string | null;
  onSelect?: (pin: string) => void;
  fly?: [number, number, number] | null;
  zoom?: number;
  live?: boolean;
  /** Layer B: global malicious URLs (URLhaus), drawn on top of the community layer. */
  threats?: ThreatItem[];
  flash?: ReadonlySet<string>;
  overlay?: ReactNode;
}) {
  const { t, lang, area } = useApp();
  // If a keyed style fails (wrong key, quota used up, offline), fall back to its keyless twin after a few errors.
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const errors = useRef(0);
  const wanted = MAP_STYLES.find((s) => s.id === styleId) ?? MAP_STYLES[0]!;
  const style = wanted.fallback && failed.has(wanted.id) ? (MAP_STYLES.find((s) => s.id === wanted.fallback) ?? MAP_STYLES[0]!) : wanted;
  useEffect(() => {
    errors.current = 0;
  }, [style.id]);
  const onTileError = (): void => {
    if (!style.fallback) return;
    errors.current++;
    if (errors.current === 4) setFailed((f) => new Set(f).add(style.id));
  };
  const [pings, setPings] = useState<Ping[]>([]);
  useLive((e) => {
    if (!live || e.replay) return;
    const a = AREA_BY_PIN.get(e.pincode);
    if (!a) return;
    const p = { id: e.id, lat: a.lat, lng: a.lng, kind: e.type };
    setPings((ps) => [...ps.slice(-20), p]);
    window.setTimeout(() => setPings((ps) => ps.filter((x) => x.id !== p.id)), 2600);
  });

  const max = Math.max(1, ...clusters.map((c) => c.count));
  const fmax = Math.max(1, ...(forecast ?? []).map((f) => f.next24));
  const alertsByPin = useMemo(() => {
    const m = new Map<string, Alert[]>();
    for (const a of alerts) m.set(a.pincode, [...(m.get(a.pincode) ?? []), a]);
    return m;
  }, [alerts]);
  const start: [number, number] = area ? [area.lat, area.lng] : INDIA;
  // Forecast labels only for the areas closest to the alert level, so nearby areas don't bury each other.
  const labelled = useMemo(
    () => new Set((forecast ?? []).filter((f) => f.spike_now || (f.eta_hours !== null && f.eta_hours <= 12)).slice(0, 3).map((f) => f.pincode)),
    [forecast],
  );

  return (
    <div className={`map-frame ${style.dark ? "is-dark" : ""}`}>
      <MapContainer center={start} zoom={zoom ?? (area ? 11 : 5)} scrollWheelZoom zoomControl attributionControl>
        <TileLayer key={style.id} url={style.url} attribution={style.attribution} maxZoom={style.maxZoom} eventHandlers={{ tileerror: onTileError }} {...(style.subdomains ? { subdomains: style.subdomains } : {})} />
        <FlyTo target={fly ?? null} />

        {mode === "now" && clusters.map((c) => {
          const r = 8 + 22 * Math.sqrt(c.count / max);
          const here = alertsByPin.get(c.pincode) ?? [];
          const name = areaName(AREA_BY_PIN.get(c.pincode), lang);
          return (
            <div key={c.pincode}>
              {c.spike && <Marker position={[c.lat, c.lng]} icon={pulseIcon(r + 6)} interactive={false} keyboard={false} />}
              <CircleMarker
                center={[c.lat, c.lng]}
                radius={r}
                pathOptions={{ color: style.dark ? "#0d1720" : "#ffffff", weight: 2, fillColor: SEV_COLOR[c.severity], fillOpacity: selected === c.pincode ? 0.95 : 0.8 }}
                eventHandlers={{ click: () => onSelect?.(c.pincode) }}
              >
                {here.length > 0 && (
                  <Tooltip permanent direction="top" offset={[0, -r]} className="map-tag-wrap" interactive={false}>
                    <div className="map-tags">
                      {here.map((a, i) => (
                        <span key={i} className={`map-tag ${a.type === "SPIKE" ? "tag-spike" : "tag-new"}`}>
                          {a.type === "SPIKE" ? t("alertSpikeTip", { n: a.count }) : t("alertNewTip", { type: typeName(a.scam_type ?? "other", lang) })}
                        </span>
                      ))}
                    </div>
                  </Tooltip>
                )}
                <Popup>
                  <div className="popup">
                    <h3>{name}, {c.city}</h3>
                    <p><strong>{fmt(c.count, lang)}</strong> {c.count === 1 ? t("report1") : t("reports")}</p>
                    <p className="row" style={{ gap: 6 }}><ScamIcon type={c.top_scam_type} size={15} /> {t("topType")}: {typeName(c.top_scam_type, lang)}</p>
                    {here.map((a, i) => <p key={i} style={{ color: a.type === "SPIKE" ? "var(--scam)" : "#8a5a00", fontWeight: 600 }}>{lang === "hi" ? a.message_hi : a.message_en}</p>)}
                  </div>
                </Popup>
              </CircleMarker>
            </div>
          );
        })}

        {mode === "forecast" && (forecast ?? []).filter((f) => f.next24 > 0 || f.last24 > 0).map((f) => {
          const r = 8 + 22 * Math.sqrt(f.next24 / fmax);
          return (
            <CircleMarker
              key={f.pincode}
              center={[f.lat, f.lng]}
              radius={r}
              pathOptions={{ color: TREND_COLOR[f.trend], weight: 2.5, dashArray: "5 4", fillColor: TREND_COLOR[f.trend], fillOpacity: 0.35 }}
              eventHandlers={{ click: () => onSelect?.(f.pincode) }}
            >
              {labelled.has(f.pincode) && (
                <Tooltip permanent direction="top" offset={[0, -r]} className="map-tag-wrap" interactive={false}>
                  <div className="map-tags">
                    <span className={`map-tag ${f.spike_now ? "tag-spike" : "tag-new"}`}>{f.spike_now ? t("etaNow") : t("etaHours", { h: Math.max(1, Math.round(f.eta_hours ?? 0)) })}</span>
                  </div>
                </Tooltip>
              )}
              <Popup>
                <div className="popup">
                  <h3>{lang === "hi" ? f.locality_hi : f.locality}, {f.city}</h3>
                  <p>{t("forecastTip", { n: f.next24 })}</p>
                  <p>{t(`trend_${f.trend}` as const)}, {t("perHour", { n: f.pace_per_hour })}</p>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {pings.map((p) => <Marker key={p.id} position={[p.lat, p.lng]} icon={pingIcon(p.kind)} interactive={false} keyboard={false} />)}

        {(threats ?? []).map((it) => (it.lat === null || it.lng === null ? null : (
          <Marker key={`t${it.id}`} position={[it.lat, it.lng]} icon={threatIcon(flash?.has(it.id) ?? false, it.status)} keyboard={false} zIndexOffset={flash?.has(it.id) ? 1000 : 0}>
            <Popup><ThreatDetails it={it} /></Popup>
          </Marker>
        )))}
      </MapContainer>
      {overlay}
      {onStyle && <StylePicker value={style.id} onChange={onStyle} />}
      <div className="map-legend" aria-label="Legend">
        {mode === "now" ? (
          <>
            <div className="legend-row"><span className="legend-dot" style={{ background: SEV_COLOR.CRIT }} /> {t("sevCRIT")}: 10+ / {lang === "hi" ? "अचानक बढ़ोतरी" : "jump"}</div>
            <div className="legend-row"><span className="legend-dot" style={{ background: SEV_COLOR.HIGH }} /> {t("sevHIGH")}: 5-9</div>
            <div className="legend-row"><span className="legend-dot" style={{ background: SEV_COLOR.MED }} /> {t("sevMED")}: 1-4</div>
            {threats && (
              <>
                <div className="legend-row"><span className="legend-threat is-new" /> {t("thrLegendNew")}</div>
                <div className="legend-row"><span className="legend-threat" /> {t("thrLegend")}</div>
              </>
            )}
          </>
        ) : (
          (["rising_fast", "rising", "steady", "cooling"] as const).map((k) => (
            <div className="legend-row" key={k}><span className="legend-dot ring" style={{ borderColor: TREND_COLOR[k], background: `${TREND_COLOR[k]}55` }} /> {t(`trend_${k}`)}</div>
          ))
        )}
      </div>
    </div>
  );
}
