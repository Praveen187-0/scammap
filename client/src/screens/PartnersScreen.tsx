import { Building2, Gauge, KeyRound, LogOut, Send, Webhook } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, partnerApi, type PartnerHit, type PartnerMe, type ScaleInfo, type SeriesPoint } from "../api";
import { HourBars } from "../charts/Charts";
import { pretty } from "../components/CallerCard";
import { areaName, fmt, typeName, useApp } from "../ctx";
import { AREA_BY_PIN } from "../../../shared/areas.js";

const KEY = "sm.partnerKey";
const readKey = (): string => {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

interface Data {
  me: PartnerMe;
  hits: PartnerHit[];
  roll: { hours: number; mine: Array<{ hour: string; hits: number }>; area: SeriesPoint[] | null; national: SeriesPoint[] };
  deliveries: Array<{ event: string; status: number | null; attempts: number; error: string | null; at: string }>;
}

function Scale() {
  const { t, lang } = useApp();
  const [s, setS] = useState<ScaleInfo | null>(null);
  useEffect(() => {
    api<ScaleInfo>("/system/scale").then(setS).catch(() => undefined);
  }, []);
  if (!s) return null;
  const lt = s.last_load_test;
  return (
    <section className="card span-all">
      <h3><Gauge size={18} aria-hidden="true" /> {t("partScale")}</h3>
      <p className="muted small">{t("partScaleSub")}</p>
      <div className="kpis kpis-4">
        <div className="kpi"><span className="kpi-label">{t("scaleReports")}</span><span className="kpi-value">{fmt(s.counts.reports, lang)}</span></div>
        <div className="kpi"><span className="kpi-label">{t("scaleRollups")}</span><span className="kpi-value">{fmt(s.counts.rollups, lang)}</span><span className="kpi-delta">{t("scaleRefresh", { ms: s.rollup_refresh.ms })}</span></div>
        <div className="kpi"><span className="kpi-label">{t("scalePartners")}</span><span className="kpi-value">{fmt(s.partners, lang)}</span></div>
        <div className="kpi"><span className="kpi-label">{t("scaleRps")}</span><span className="kpi-value">{lt ? fmt(lt.rps, lang) : "—"}</span><span className="kpi-delta">{lt ? t("scaleRun", { c: lt.concurrency, s: lt.seconds, e: lt.errors }) : t("partNoLoad")}</span></div>
      </div>
      {lt && (
        <table className="data-table">
          <thead><tr><th>{t("scaleEndpoint")}</th><th className="num">{t("scaleRequests")}</th><th className="num">p50 ms</th><th className="num">p95 ms</th><th className="num">p99 ms</th></tr></thead>
          <tbody>
            {Object.entries(lt.endpoints).map(([k, v]) => (
              <tr key={k}><td>{k}</td><td className="num">{fmt(v.requests, lang)}</td><td className="num">{v.p50_ms}</td><td className="num">{v.p95_ms}</td><td className="num">{v.p99_ms}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Console for banks, telecoms and police: what concerns them, live, through their own API key. */
export function PartnersScreen() {
  const { t, lang } = useApp();
  const [key, setKey] = useState(readKey);
  const [input, setInput] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [test, setTest] = useState<string>("");

  const load = useCallback(async (k: string): Promise<void> => {
    setErr("");
    try {
      const [me, hits, roll, del] = await Promise.all([
        partnerApi<PartnerMe>("/partner/me", k),
        partnerApi<{ hits: PartnerHit[] }>("/partner/hits?hours=168", k),
        partnerApi<Data["roll"]>("/partner/rollups?hours=48", k),
        partnerApi<{ deliveries: Data["deliveries"] }>("/partner/deliveries", k),
      ]);
      setData({ me, hits: hits.hits, roll, deliveries: del.deliveries });
      try {
        sessionStorage.setItem(KEY, k);
      } catch {
        /* ignore */
      }
      setKey(k);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setErr(t("partBad"));
        setKey("");
        try {
          sessionStorage.removeItem(KEY);
        } catch {
          /* ignore */
        }
      } else if (!(e instanceof ApiError && e.status === 403)) setErr(t("errorGeneric"));
    }
  }, [t]);

  useEffect(() => {
    if (!key) return;
    void load(key);
    const id = window.setInterval(() => void load(key), 15_000);
    return () => window.clearInterval(id);
  }, [key, load]);

  const logout = (): void => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setKey("");
    setData(null);
  };
  const sendTest = async (): Promise<void> => {
    setTest("…");
    try {
      const r = await partnerApi<{ ok: boolean; status: number | null; error: string | null }>("/partner/test-webhook", key, "POST");
      setTest(r.ok ? `HTTP ${r.status}` : r.error ?? `HTTP ${r.status}`);
      void load(key);
    } catch {
      setTest(t("errorGeneric"));
    }
  };

  if (!key || !data) {
    return (
      <div className="page" style={{ maxWidth: 760 }}>
        <div className="page-head"><div><h1>{t("partTitle")}</h1><p>{t("partIntro")}</p></div></div>
        <form className="card" onSubmit={(e) => { e.preventDefault(); void load(input.trim()); }}>
          <label className="stack" style={{ gap: 6 }}>
            <span><KeyRound size={16} aria-hidden="true" /> {t("partKey")}</span>
            <input className="field" value={input} onChange={(e) => setInput(e.target.value)} placeholder="smk_…" autoComplete="off" spellCheck={false} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={!input.trim()}>{t("partLogin")}</button>
          {err && <p className="error">{err}</p>}
          <p className="hint">{t("partHowTo")}</p>
        </form>
        <div style={{ marginTop: 14 }}><Scale /></div>
      </div>
    );
  }

  const { me, hits, roll, deliveries } = data;
  const day = hits.filter((h) => Date.now() - Date.parse(h.at) < 86_400_000).length;
  const okDel = deliveries.filter((d) => d.status !== null && d.status < 300).length;
  const watch = [...new Set(Object.entries(me.watch).flatMap(([k, vs]) => (vs ?? []).map((v) => `${k === "areas" ? areaName(AREA_BY_PIN.get(v), lang) || v : v}`)))];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1><Building2 size={26} aria-hidden="true" style={{ verticalAlign: "-3px" }} /> {me.name}</h1>
          <p>{t("partTitle")}, {me.kind}</p>
        </div>
        <button className="btn btn-quiet" onClick={logout}><LogOut size={16} aria-hidden="true" /> {t("partLogout")}</button>
      </div>
      <div className="ins-grid">
        <section className="card span-all">
          <div className="mini-label">{t("partWatch")}</div>
          <div className="chips tight">{watch.map((w) => <span key={w} className="id-chip">{w}</span>)}</div>
          <div className="kpis kpis-4">
            <div className="kpi"><span className="kpi-label">{t("partHits24")}</span><span className="kpi-value">{fmt(day, lang)}</span></div>
            <div className="kpi"><span className="kpi-label">{t("partHits7")}</span><span className="kpi-value">{fmt(hits.length, lang)}</span></div>
            <div className="kpi"><span className="kpi-label">{t("partConfirmed")}</span><span className="kpi-value">{fmt(hits.filter((h) => h.confirmed).length, lang)}</span></div>
            <div className="kpi"><span className="kpi-label">{t("partWebhooks")}</span><span className="kpi-value">{deliveries.length ? `${okDel}/${deliveries.length}` : "—"}</span></div>
          </div>
        </section>

        <section className="card span-all">
          <div className="card-head"><div><h3>{t("partRollup")}</h3><p>{t("partRollupSub")}</p></div></div>
          <div className="multiples">
            <div><div className="mini-label">{t("partMine")}</div><HourBars values={roll.mine.map((m) => m.hits)} hours={roll.mine.map((m) => m.hour)} color="var(--series-2)" label={t("partMine")} /></div>
            {roll.area && <div><div className="mini-label">{t("partAreas")}</div><HourBars values={roll.area.map((m) => m.counted)} hours={roll.area.map((m) => m.hour)} color="var(--series-1)" label={t("partAreas")} /></div>}
            <div><div className="mini-label">{t("partNational")}</div><HourBars values={roll.national.map((m) => m.counted)} hours={roll.national.map((m) => m.hour)} color="var(--series-1)" label={t("partNational")} /></div>
          </div>
        </section>

        <section className="card span-all">
          <h3>{t("partHits")}</h3>
          {hits.length === 0 ? <p className="muted">{t("partHitsNone")}</p> : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead><tr><th>{t("colWhen")}</th><th>{t("colIdentifier")}</th><th>{t("colVerdict")}</th><th>{t("fType")}</th><th>{t("colArea")}</th><th>{t("partMatched")}</th></tr></thead>
                <tbody>
                  {hits.slice(0, 60).map((h, i) => (
                    <tr key={i}>
                      <td>{h.at.slice(5, 16).replace("T", " ")}</td>
                      <td className="id-val">{pretty(h.identifier.display_value, h.identifier.type)}</td>
                      <td><span className={`pill pill-${h.verdict}`}>{t(`v${h.verdict}` as "vKNOWN_SCAM")}</span></td>
                      <td>{typeName(h.scam_type, lang)}</td>
                      <td>{areaName(AREA_BY_PIN.get(h.area.pincode), lang) || h.area.locality}</td>
                      <td><div className="chips tight">{h.matched.map((m) => <span key={m} className="id-chip">{m}</span>)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card span-all">
          <div className="card-head">
            <div><h3><Webhook size={18} aria-hidden="true" /> {t("partWebhooks")}</h3><p>{me.webhook ?? t("partNoWebhook")}</p></div>
            {me.webhook && <button className="btn btn-quiet" onClick={() => void sendTest()}><Send size={16} aria-hidden="true" /> {t("partTest")}</button>}
          </div>
          {test && <p className="small">{test}</p>}
          {deliveries.length > 0 && (
            <table className="data-table">
              <thead><tr><th>{t("colWhen")}</th><th>{t("colEvent")}</th><th className="num">HTTP</th><th className="num">{t("colAttempts")}</th><th>{t("colError")}</th></tr></thead>
              <tbody>
                {deliveries.map((d, i) => (
                  <tr key={i}><td>{d.at.slice(5, 16).replace("T", " ")}</td><td>{d.event}</td><td className={`num ${d.status && d.status < 300 ? "down" : "up"}`}>{d.status ?? "—"}</td><td className="num">{d.attempts}</td><td className="small muted">{d.error ?? ""}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <Scale />
      </div>
    </div>
  );
}
