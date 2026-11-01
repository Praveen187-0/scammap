import { Sparkles, Sigma } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AREAS, AREA_BY_PIN } from "../../../shared/areas.js";
import { CHANNELS } from "../../../shared/scamTypes.js";
import { api, type Briefing, type Stats } from "../api";
import { pretty } from "../components/CallerCard";
import { DatasetInsights } from "../components/DatasetInsights";
import { BarList, ChartCard, Columns, Heatmap, StackedColumns, Swatch } from "../charts/Charts";
import { areaName, fmt, shortDate, typeName, useApp } from "../ctx";
import type { StringKey } from "../i18n";
import { CHANNEL_ICON, ScamIcon } from "../icons";

const S1 = "var(--series-1)";
const S2 = "var(--series-2)";
const CITIES = [...new Set(AREAS.map((a) => a.city))];

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Change against the previous period of the same length. More reports is bad news, so "up" is red. */
function Delta({ now, prev, days }: { now: number; prev: number; days: number }) {
  const { t } = useApp();
  if (prev === 0) return <span className="kpi-delta">{t("vsPrev", { d: days })}: new</span>;
  const d = Math.round(((now - prev) / prev) * 100);
  return <span className={`kpi-delta ${d > 0 ? "up" : d < 0 ? "down" : ""}`}>{d > 0 ? "+" : ""}{d}% {t("vsPrev", { d: days })}</span>;
}

export function InsightsScreen() {
  const { t, lang, area } = useApp();
  const [days, setDays] = useState(7);
  const [scope, setScope] = useState("all");
  const [stats, setStats] = useState<Stats | null>(null);
  const [brief, setBrief] = useState<Briefing | null>(null);
  const [err, setErr] = useState(false);

  const query = useMemo(() => {
    const q = new URLSearchParams({ days: String(days) });
    if (scope.startsWith("pin:")) q.set("pincode", scope.slice(4));
    if (scope.startsWith("city:")) q.set("city", scope.slice(5));
    return q.toString();
  }, [days, scope]);

  useEffect(() => {
    const ctrl = new AbortController();
    setErr(false);
    setBrief(null);
    api<Stats>(`/stats?${query}`, { signal: ctrl.signal }).then(setStats).catch((e: unknown) => !(e instanceof DOMException) && setErr(true));
    api<Briefing>(`/insights/briefing?${query}`, { signal: ctrl.signal }).then(setBrief).catch(() => undefined);
    return () => ctrl.abort();
  }, [query]);

  const s = stats;
  const tot = s?.totals;
  const dayLabels = t("days").split(",");
  const fast = s?.report_delay.find((d) => d.key === "under_1h")?.count ?? 0;
  const reasonKey: Record<string, StringKey> = { coordinated_burst: "reasonBurst", sybil_ring: "reasonSybil", copy_paste: "reasonCopy", repeat_reporter: "reasonRepeat", personal_dispute: "reasonPersonal", verified_target: "reasonVerified" };
  const langKey: Record<string, StringKey> = { deva: "langHindi", latn: "langEnglish", mixed: "langMixed", none: "langNone" };
  const channelName = (v: string): string => {
    const c = CHANNELS.find((x) => x.value === v);
    return c ? (lang === "hi" ? c.hi : c.en) : v;
  };
  const tr = (key: string): string => {
    try {
      return t(key as StringKey) ?? key;
    } catch {
      return key;
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("insightsTitle")}</h1>
          <p>{t("insightsIntro")}</p>
        </div>
      </div>

      <div className="ins-filters">
        <div className="seg" role="group" aria-label={t("period")}>
          {[7, 30, 90].map((d) => (
            <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>{t(d === 7 ? "days7" : d === 30 ? "days30" : "days90")}</button>
          ))}
        </div>
        <label className="visually-hidden" htmlFor="ins-scope">{t("scope")}</label>
        <select id="ins-scope" className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">{t("allIndia")}</option>
          {area && <option value={`pin:${area.pincode}`}>{t("myArea")}: {areaName(area, lang)}</option>}
          <optgroup label={t("cityLabel")}>
            {CITIES.map((c) => <option key={c} value={`city:${c}`}>{c}</option>)}
          </optgroup>
          <optgroup label={t("colArea")}>
            {AREAS.map((a) => <option key={a.pincode} value={`pin:${a.pincode}`}>{areaName(a, lang)}, {a.city}</option>)}
          </optgroup>
        </select>
      </div>

      {err && <p className="error">{t("errorGeneric")}</p>}
      {!s && !err && <div className="panel"><div className="skeleton-line" style={{ width: "40%" }} /><div className="skeleton-line" style={{ width: "70%", marginTop: 10 }} /></div>}

      {s && tot && (
        <div className="ins-grid">
          <section className="brief span-12" aria-live="polite">
            {brief ? (
              <>
                <h2>{lang === "hi" ? brief.headline_hi : brief.headline_en}</h2>
                {brief.insights.length > 0 && <ul>{brief.insights.map((i, n) => <li key={n}>{lang === "hi" ? i.hi : i.en}</li>)}</ul>}
                <span className="src">
                  {brief.source === "gemini" ? <Sparkles size={14} aria-hidden="true" /> : <Sigma size={14} aria-hidden="true" />}
                  {brief.source === "gemini" ? `${t("briefingAi")} (${brief.model ?? "Gemini"})` : t("briefingRules")}
                </span>
              </>
            ) : (
              <>
                <div className="skeleton-line dark" style={{ width: "55%" }} />
                <div className="skeleton-line dark" style={{ width: "80%" }} />
              </>
            )}
          </section>

          <div className="kpis span-12">
            <div className="kpi hero">
              <span className="kpi-label">{t("kpiTrusted")}</span>
              <span className="kpi-value">{fmt(tot.counted, lang)}</span>
              <Delta now={tot.counted} prev={tot.counted_prev} days={s.window_days} />
            </div>
            <div className="kpi">
              <span className="kpi-label">{t("kpiKnown")}</span>
              <span className="kpi-value">{fmt(tot.known_scams, lang)}</span>
              <span className="kpi-delta">{fmt(tot.suspicious, lang)} {t("vSUSPICIOUS").toLowerCase()}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">{t("kpiSetAside")}</span>
              <span className="kpi-value">{fmt(tot.set_aside + tot.rejected, lang)}</span>
              <span className="kpi-delta">{pct(tot.set_aside + tot.rejected, tot.received + tot.rejected)}%</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">{t("kpiAwaiting")}</span>
              <span className="kpi-value">{fmt(tot.awaiting, lang)}</span>
              <span className="kpi-delta">{t("ladder1d")}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">{t("kpiFast")}</span>
              <span className="kpi-value">{pct(fast, tot.counted)}%</span>
              <span className="kpi-delta">{fmt(tot.active_alerts, lang)} {t("kpiAlerts").toLowerCase()}</span>
            </div>
          </div>

          {tot.received === 0 ? (
            <p className="panel span-12 muted">{t("noData")}</p>
          ) : (
            <>
              <ChartCard
                className="span-8"
                title={t("chartDaily")}
                sub={t("chartDailySub")}
                legend={<><Swatch color={S1} label={t("seriesTrusted")} /><Swatch color={S2} label={t("seriesSetAside")} /></>}
                table={{ columns: [{ label: "Day" }, { label: t("seriesTrusted"), num: true }, { label: t("seriesSetAside"), num: true }], rows: s.daily.map((d) => [shortDate(d.day, lang), d.counted, d.set_aside]) }}
              >
                <StackedColumns data={s.daily.map((d) => ({ x: d.day, values: [d.counted, d.set_aside] }))} series={[{ name: t("seriesTrusted"), color: S1 }, { name: t("seriesSetAside"), color: S2 }]} xLabel={(x) => shortDate(x, lang)} />
              </ChartCard>

              <ChartCard
                className="span-4"
                title={t("chartTrust")}
                sub={t("chartTrustSub")}
                table={{ columns: [{ label: t("status") }, { label: t("colReports"), num: true }], rows: [[t("trustCounted"), tot.counted], [t("trustMerged"), tot.merged], [t("trustSetAside"), tot.set_aside], [t("trustRejected"), tot.rejected], ...s.set_aside_reasons.map((r) => [tr(reasonKey[r.key] ?? r.key), r.count] as Array<string | number>)] }}
              >
                <div className="trust-flow">
                  <BarList highlight rows={[
                    { label: t("trustCounted"), value: tot.counted },
                    { label: t("trustMerged"), value: tot.merged, dim: true },
                    { label: t("trustSetAside"), value: tot.set_aside, dim: true },
                    { label: t("trustRejected"), value: tot.rejected, dim: true },
                  ]} />
                  <ul className="reason-list">
                    {s.set_aside_reasons.filter((r) => r.count > 0).map((r) => (
                      <li key={r.key}><span>{tr(reasonKey[r.key] ?? r.key)}</span><strong>{fmt(r.count, lang)}</strong></li>
                    ))}
                  </ul>
                </div>
              </ChartCard>

              <ChartCard className="span-6" title={t("chartTypes")} table={{ columns: [{ label: t("chartTypes") }, { label: t("colReports"), num: true }], rows: s.by_type.map((r) => [typeName(r.key, lang), r.count]) }}>
                <BarList rows={s.by_type.slice(0, 8).map((r) => ({ label: typeName(r.key, lang), value: r.count, icon: <ScamIcon type={r.key} size={16} /> }))} />
              </ChartCard>

              <ChartCard className="span-6" title={t("chartChannels")} table={{ columns: [{ label: t("chartChannels") }, { label: t("colReports"), num: true }], rows: s.by_channel.map((r) => [channelName(r.key), r.count]) }}>
                <BarList rows={s.by_channel.map((r) => {
                  const I = CHANNEL_ICON[r.key];
                  return { label: channelName(r.key), value: r.count, icon: I ? <I size={16} aria-hidden="true" /> : undefined };
                })} />
              </ChartCard>

              <ChartCard
                className="span-7"
                title={t("chartHeat")}
                sub={t("chartHeatSub")}
                table={{ columns: [{ label: "Day" }, ...Array.from({ length: 24 }, (_, h) => ({ label: String(h), num: true }))], rows: s.hour_weekday.map((row, d) => [dayLabels[d] ?? "", ...row]) }}
              >
                <Heatmap grid={s.hour_weekday} dayLabels={dayLabels} valueLabel={t("reports")} />
              </ChartCard>

              <ChartCard className="span-5" title={t("chartDelay")} sub={t("chartDelaySub")} table={{ columns: [{ label: t("chartDelay") }, { label: t("colReports"), num: true }], rows: s.report_delay.map((r) => [tr(`delay_${r.key}`), r.count]) }}>
                <Columns rows={s.report_delay.map((r) => ({ label: tr(`delay_${r.key}`), value: r.count }))} />
              </ChartCard>

              <section className="card span-8">
                <div className="card-head"><div><h3>{t("chartAreas")}</h3><p>{t("vsPrev", { d: s.window_days })}</p></div></div>
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table clickable">
                    <thead><tr><th>{t("colArea")}</th><th>{t("colCity")}</th><th className="num">{t("colReports")}</th><th className="num">{t("colChange")}</th><th>{t("colTop")}</th></tr></thead>
                    <tbody>
                      {s.by_area.slice(0, 12).map((a) => {
                        const ch = a.prev ? Math.round(((a.count - a.prev) / a.prev) * 100) : null;
                        return (
                          <tr key={a.pincode} onClick={() => setScope(`pin:${a.pincode}`)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setScope(`pin:${a.pincode}`)}>
                            <td><strong>{areaName(AREA_BY_PIN.get(a.pincode), lang) || a.locality}</strong></td>
                            <td>{a.city}</td>
                            <td className="num">{fmt(a.count, lang)}</td>
                            <td className={`num ${ch !== null && ch > 0 ? "up" : ch !== null && ch < 0 ? "down" : ""}`}>{ch === null ? "new" : `${ch > 0 ? "+" : ""}${ch}%`}</td>
                            <td><span className="row" style={{ gap: 6, flexWrap: "nowrap" }}><ScamIcon type={a.top_scam_type} size={15} /> {typeName(a.top_scam_type, lang)}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card span-4">
                <div className="card-head"><div><h3>{t("chartTop")}</h3><p>{t("chartTopSub")}</p></div></div>
                {s.top_identifiers.length === 0 ? <p className="muted">{t("noData")}</p> : (
                  <ol className="top-list">
                    {s.top_identifiers.slice(0, 8).map((x) => (
                      <li key={x.display_value}>
                        <span className="top-value">{pretty(x.display_value, x.type)}</span>
                        <span className="muted small row" style={{ gap: 5 }}><ScamIcon type={x.scam_type} size={13} /> {typeName(x.scam_type, lang)}</span>
                        <span className="top-people">{fmt(x.people, lang)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <ChartCard className="span-4" title={t("chartLang")} table={{ columns: [{ label: t("chartLang") }, { label: t("colReports"), num: true }], rows: s.languages.map((r) => [tr(langKey[r.key] ?? r.key), r.count]) }}>
                <BarList rows={s.languages.map((r) => ({ label: tr(langKey[r.key] ?? r.key), value: r.count }))} />
              </ChartCard>

              <ChartCard className="span-4" title={t("chartLoss")} sub={t("chartLossSub")} table={{ columns: [{ label: t("chartLoss") }, { label: t("colReports"), num: true }], rows: s.loss.map((r) => [tr(`loss_${r.key}`), r.count]) }}>
                <Columns rows={s.loss.map((r) => ({ label: tr(`loss_${r.key}`), value: r.count }))} />
              </ChartCard>

              <ChartCard className="span-4" title={t("chartRejected")} table={{ columns: [{ label: t("chartRejected") }, { label: t("colReports"), num: true }], rows: s.rejections.map((r) => [tr(`rej_${r.key}`), r.count]) }}>
                {s.rejections.length === 0 ? <p className="muted">{t("noData")}</p> : <BarList rows={s.rejections.map((r) => ({ label: tr(`rej_${r.key}`), value: r.count }))} />}
              </ChartCard>
            </>
          )}
          <DatasetInsights />
        </div>
      )}
    </div>
  );
}
