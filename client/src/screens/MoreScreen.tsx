import { BadgeCheck, Building2, EyeOff, Fingerprint, Globe, HandCoins, LifeBuoy, Network, Phone, Scale, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bestCandidate } from "../../../shared/extract.js";
import { api, ApiError } from "../api";
import { LicencePanel } from "../components/Overlays";
import { IntegrationsPanel, SchemaPanel, TransparencyPanel } from "../components/PlatformPanels";
import { SafetyPanel } from "../components/SafetyPanel";
import { useApp } from "../ctx";
import type { StringKey } from "../i18n";

const RULES: Array<[string, StringKey]> = [["A", "ruleA"], ["B", "ruleB"], ["C", "ruleC"], ["D", "ruleD"], ["E", "ruleE"], ["F", "ruleF"], ["J", "ruleI"]];

function Ladder() {
  const { t } = useApp();
  const steps: Array<{ n: StringKey; d: StringKey; cls: string }> = [
    { n: "ladder1", d: "ladder1d", cls: "l-none" },
    { n: "ladder2", d: "ladder2d", cls: "l-warn" },
    { n: "ladder3", d: "ladder3d", cls: "l-scam" },
  ];
  return (
    <section className="card span-all">
      <h3><EyeOff size={18} aria-hidden="true" /> {t("ladderTitle")}</h3>
      <p className="muted" style={{ maxWidth: "70ch" }}>{t("ladderBody")}</p>
      <ol className="ladder">
        {steps.map((s) => (
          <li key={s.n} className={s.cls}>
            <strong>{t(s.n)}</strong>
            <span>{t(s.d)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function MoreScreen({ disputeValue }: { disputeValue: string }) {
  const { t, go } = useApp();
  const [value, setValue] = useState(disputeValue);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [proof, setProof] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const disputeRef = useRef<HTMLElement>(null);
  const cand = bestCandidate(value);

  useEffect(() => {
    if (disputeValue) disputeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [disputeValue]);

  const send = async (): Promise<void> => {
    if (!cand) return;
    setMsg(null);
    try {
      await api("/challenges", { method: "POST", body: { identifier_type: cand.type, identifier_value: cand.value, claimant_name: name || null, contact_email: email || null, proof_note: proof || null } });
      setMsg({ ok: true, text: t("disputeSent") });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403)) setMsg({ ok: false, text: e instanceof ApiError ? e.message : t("errorGeneric") });
    }
  };

  return (
    <div className="page">
      <div className="page-head"><div><h1>{t("moreTitle")}</h1></div></div>
      <nav className="more-links" aria-label={t("moreTitle")}>
        <button className="more-link lost-link" onClick={() => go("lost", "")}><HandCoins size={22} aria-hidden="true" /> <span><strong>{t("navLost")}</strong><small>{t("moreLostSub")}</small></span></button>
        <button className="more-link" onClick={() => go("campaigns")}><Network size={22} aria-hidden="true" /> <span><strong>{t("navCampaigns")}</strong><small>{t("moreCampSub")}</small></span></button>
        <button className="more-link" onClick={() => go("partners")}><Building2 size={22} aria-hidden="true" /> <span><strong>{t("navPartners")}</strong><small>{t("morePartSub")}</small></span></button>
      </nav>
      <div className="more-grid">
        <section className="card">
          <h3><LifeBuoy size={18} aria-hidden="true" /> {t("helplines")}</h3>
          <ul className="plain">
            <li><Phone size={18} aria-hidden="true" /><a href="tel:1930"><strong>{t("h1930")}</strong></a></li>
            <li><Globe size={18} aria-hidden="true" /><a href="https://cybercrime.gov.in" target="_blank" rel="noreferrer">{t("hPortal")}</a></li>
            <li><Globe size={18} aria-hidden="true" /><a href="https://sancharsaathi.gov.in" target="_blank" rel="noreferrer">{t("hSanchar")}</a></li>
            <li><Phone size={18} aria-hidden="true" /><a href="tel:1909">{t("h1909")}</a></li>
          </ul>
        </section>

        <section className="card">
          <h3><BadgeCheck size={18} aria-hidden="true" /> {t("callSigns")}</h3>
          <ul className="plain">
            {(["sign1", "sign2", "sign3", "sign4"] as const).map((k) => <li key={k}><ShieldCheck size={18} aria-hidden="true" style={{ color: "var(--ok)" }} /><span>{t(k)}</span></li>)}
          </ul>
        </section>

        <Ladder />

        <section className="card">
          <h3><Fingerprint size={18} aria-hidden="true" /> {t("privacyTitle")}</h3>
          <ul className="plain">
            {(["privacy1", "privacy2", "privacy3", "privacy4", "privacy5"] as const).map((k) => <li key={k}><EyeOff size={18} aria-hidden="true" style={{ color: "var(--brand)" }} /><span>{t(k)}</span></li>)}
          </ul>
        </section>

        <section className="card">
          <h3><Scale size={18} aria-hidden="true" /> {t("rulesTitle")}</h3>
          <ul className="plain rules">
            {RULES.map(([k, key]) => <li key={k}><span className="rule-key">{k}</span><span>{t(key)}</span></li>)}
          </ul>
        </section>

        <section className="card" id="dispute" ref={disputeRef}>
          <h3><BadgeCheck size={18} aria-hidden="true" /> {t("disputeTitle")}</h3>
          <p className="muted">{t("disputeIntro")}</p>
          <label className="stack" style={{ gap: 6 }}><span>{t("disputeFor")}</span><input className="field" value={value} onChange={(e) => setValue(e.target.value)} /></label>
          <label className="stack" style={{ gap: 6 }}><span>{t("yourName")}</span><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="stack" style={{ gap: 6 }}><span>{t("contactEmail")}</span><input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="stack" style={{ gap: 6 }}><span>{t("proof")}</span><textarea className="field" rows={2} value={proof} onChange={(e) => setProof(e.target.value)} /></label>
          <button className="btn btn-primary" onClick={() => void send()} disabled={!cand}>{t("sendDispute")}</button>
          {msg && <p className={msg.ok ? "calm" : "error"}>{msg.text}</p>}
        </section>

        <SafetyPanel />
        <TransparencyPanel />
        <SchemaPanel />
        <IntegrationsPanel />
        <LicencePanel />
      </div>
      <p className="hint" style={{ marginTop: 24 }}>Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors. Leaflet. Area pincodes from India Post.</p>
    </div>
  );
}
