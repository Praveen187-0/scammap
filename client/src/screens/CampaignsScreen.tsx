import { Banknote, Clock, FishingHook, Megaphone, MapPin, Network as NetIcon, Sparkles, Timer, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, type Campaign, type Network } from "../api";
import { pretty } from "../components/CallerCard";
import { CAMPAIGN_COLORS, campaignColor, NetworkGraph } from "../components/NetworkGraph";
import { fmt, shortDate, typeName, useApp } from "../ctx";
import { ScamIcon, TYPE_ICON } from "../icons";

const STAGE_ICON: Record<string, typeof Megaphone> = { contact: Megaphone, hook: FishingHook, pressure: Timer, payment: Wallet, cashout: Banknote };

function CampaignDetail({ id, color }: { id: string; color: string }) {
  const { t, lang } = useApp();
  const [c, setC] = useState<Campaign | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    setC(null);
    api<Campaign & { story: { story_en: string; story_hi: string; source: string } }>(`/campaigns/${id}`)
      .then((r) => setC({ ...r, story: r.story ? { en: r.story.story_en, hi: r.story.story_hi, source: r.story.source } : null }))
      .catch((e) => !(e instanceof ApiError && e.status === 403) && setErr(true));
  }, [id]);
  if (err) return <p className="error">{t("errorGeneric")}</p>;
  if (!c) return <div className="card"><div className="skeleton-line" style={{ width: "50%" }} /><div className="skeleton-line" style={{ width: "80%" }} /></div>;
  const byKey = new Map(c.identifiers.map((i) => [i.key, i]));
  const L = (en: string, hi: string): string => (lang === "hi" ? hi : en);
  return (
    <article className="card camp-detail" style={{ borderTopColor: color }}>
      <div className="card-head">
        <div>
          <h2>{L(c.title_en, c.title_hi)}</h2>
          <p>{t("campPeople", { n: fmt(c.people, lang) })}, {shortDate(c.first_seen, lang)} – {shortDate(c.last_seen, lang)}</p>
        </div>
        <span className={`pill ${c.status === "active" ? "pill-SUSPICIOUS" : "pill-NO_REPORTS"}`}>{c.status === "active" ? t("campActive") : t("campQuiet")}</span>
      </div>

      {c.story && (
        <div className="camp-story">
          <div className="mini-label"><Sparkles size={14} aria-hidden="true" /> {t("campStory")}{c.story.source === "gemini" ? " (Gemini)" : ""}</div>
          <p>{L(c.story.en, c.story.hi)}</p>
        </div>
      )}

      <section>
        <h3>{t("campChain")}</h3>
        <ol className="chain">
          {c.chain.map((s) => {
            const I = STAGE_ICON[s.key] ?? Clock;
            return (
              <li key={s.key}>
                <span className="chain-icon"><I size={18} aria-hidden="true" /></span>
                <div>
                  <strong>{L(s.en, s.hi)}</strong>
                  <p className="small muted">{L(s.detail_en, s.detail_hi)}</p>
                  {s.identifiers.length > 0 && (
                    <div className="chips tight">
                      {s.identifiers.slice(0, 3).map((k) => {
                        const i = byKey.get(k);
                        return i ? <span key={k} className="id-chip">{pretty(i.display, i.type)}</span> : null;
                      })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {c.spread.length > 0 && (
        <section>
          <h3>{t("campSpread")}</h3>
          <ol className="spread">
            {c.spread.map((s) => (
              <li key={s.pincode}>
                <span className="spread-dot" style={{ background: color }} />
                <span className="spread-when">{shortDate(s.first, lang)}</span>
                <span><MapPin size={14} aria-hidden="true" /> {L(s.locality, s.locality_hi)}, {s.city}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <h3>{t("campIds")}</h3>
        <ul className="camp-ids">
          {c.identifiers.slice(0, 12).map((i) => {
            const I = TYPE_ICON[i.type];
            return (
              <li key={i.key}>
                {I && <I size={16} aria-hidden="true" />}
                <span className="id-val">{pretty(i.display, i.type)}</span>
                <span className={`pill pill-${i.verdict}`}>{t(`v${i.verdict}` as "vKNOWN_SCAM")}</span>
                <span className="muted small">{t("campPeople", { n: i.people })}</span>
              </li>
            );
          })}
        </ul>
        {c.identifiers.length > 12 && <p className="hint">{t("campMore", { n: c.identifiers.length - 12 })}</p>}
        {c.lost_money_reports > 0 && <p className="small" style={{ color: "var(--scam)", fontWeight: 600 }}>{t("campLostReports", { n: c.lost_money_reports })}</p>}
      </section>
    </article>
  );
}

/** Scam campaigns (kill chain + spread) and the network that links numbers, UPI IDs, links and servers. */
export function CampaignsScreen() {
  const { t, lang } = useApp();
  const [list, setList] = useState<Campaign[] | null>(null);
  const [net, setNet] = useState<Network | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    api<{ campaigns: Campaign[] }>("/campaigns")
      .then((r) => {
        setList(r.campaigns);
        setSel((s) => s ?? r.campaigns[0]?.id ?? null);
      })
      .catch((e) => !(e instanceof ApiError && e.status === 403) && setErr(true));
    api<Network>("/network").then(setNet).catch(() => undefined);
  }, []);
  const order = (list ?? []).map((c) => c.id);
  const select = (id: string): void => {
    setSel(id);
    if (window.matchMedia("(max-width: 900px)").matches) document.getElementById("camp-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("campTitle")}</h1>
          <p>{t("campIntro")}</p>
        </div>
      </div>
      {err && <p className="error">{t("errorGeneric")}</p>}
      {list && list.length === 0 && <div className="panel"><p className="muted">{t("campNone")}</p></div>}
      {list && list.length > 0 && (
        <div className="camp-grid">
          <ul className="camp-list">
            {list.map((c) => (
              <li key={c.id}>
                <button className="camp-item" aria-pressed={sel === c.id} onClick={() => select(c.id)} style={{ borderLeftColor: campaignColor(order, c.id) }}>
                  <span className="camp-item-head">
                    <ScamIcon type={c.scam_types[0]?.slug} size={18} />
                    <strong>{lang === "hi" ? c.title_hi : c.title_en}</strong>
                  </span>
                  <span className="camp-item-meta">
                    <span className={`dot-status ${c.status}`} /> {c.status === "active" ? t("campActive") : t("campQuiet")}
                    <span>{t("campPeople", { n: fmt(c.people, lang) })}</span>
                    <span>{c.cities.slice(0, 3).join(", ")}</span>
                  </span>
                  <span className="camp-item-ids">
                    {(Object.entries(c.counts) as Array<[string, number]>).filter(([, n]) => n > 0).map(([k, n]) => {
                      const I = TYPE_ICON[k];
                      return <span key={k}>{I && <I size={14} aria-hidden="true" />} {n}</span>;
                    })}
                    <span className="muted">{c.scam_types.slice(0, 2).map((s) => typeName(s.slug, lang)).join(", ")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div id="camp-detail">{sel && <CampaignDetail id={sel} color={campaignColor(order, sel)} />}</div>
        </div>
      )}

      {net && net.nodes.length > 0 && list && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <div>
              <h3><NetIcon size={18} aria-hidden="true" /> {t("campNetwork")}</h3>
              <p>{t("campNetworkIntro")}</p>
            </div>
          </div>
          <NetworkGraph net={net} campaigns={list} selected={sel} onSelect={select} />
          {list.length > CAMPAIGN_COLORS.length && <p className="hint">{t("campFold", { n: CAMPAIGN_COLORS.length })}</p>}
        </section>
      )}
    </div>
  );
}
