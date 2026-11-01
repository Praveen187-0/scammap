import { ArrowRight, CircleCheck, Globe, Link2, Loader, ShieldAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { api, ApiError, type LinkScan, type LinkVerdict } from "../api";
import { useApp } from "../ctx";
import type { StringKey } from "../i18n";

const TONE: Record<LinkVerdict, "scam" | "warn" | "none" | "ok"> = {
  proven_phishing: "scam",
  dangerous_download: "scam",
  suspicious: "warn",
  no_live_evidence: "ok",
  unreachable: "none",
  blocked: "none",
};
const host = (u: string): string => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

/**
 * Static + live check of a link, side by side. The server visits the page in a sandbox (no scripts, no cookies,
 * private addresses refused) and shows where the static warning signs were confirmed by what the page really does.
 */
export function LinkCheck({ url }: { url: string }) {
  const { t, lang } = useApp();
  const [scan, setScan] = useState<LinkScan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const L = (x: { en: string; hi: string }): string => (lang === "hi" ? x.hi : x.en);

  const run = async (): Promise<void> => {
    setBusy(true);
    setErr("");
    try {
      setScan(await api<LinkScan>("/analyze/link", { method: "POST", body: { url } }));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403)) setErr(e instanceof ApiError && (e.status === 400 || e.status === 429) ? e.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  };

  if (!scan) {
    return (
      <section className="card link-card">
        <h3><Globe size={18} aria-hidden="true" /> {t("linkTitle")}</h3>
        <p className="muted small">{t("linkNote")}</p>
        <button className="btn btn-quiet" onClick={() => void run()} disabled={busy}>
          {busy ? <Loader size={17} className="spin" aria-hidden="true" /> : <Link2 size={17} aria-hidden="true" />} {busy ? t("linkChecking") : t("linkCheckBtn")}
        </button>
        {err && <p className="error">{err}</p>}
      </section>
    );
  }

  const tone = TONE[scan.verdict];
  const live = scan.live;
  const confirmed = new Set(scan.correlations.map((c) => c.static_signal));
  const Icon = tone === "scam" ? ShieldAlert : tone === "warn" ? TriangleAlert : CircleCheck;
  return (
    <section className={`card link-card tone-${tone}`} aria-live="polite">
      <div className="card-head">
        <h3><Globe size={18} aria-hidden="true" /> {t("linkTitle")}</h3>
        <span className={`pill pill-link-${tone}`}><Icon size={14} aria-hidden="true" /> {t(`v_${scan.verdict}` as StringKey)}</span>
      </div>

      {live.redirects.length > 0 && (
        <ol className="hops" aria-label={t("linkFinal")}>
          <li>{host(scan.url)}</li>
          {live.redirects.map((r, i) => (
            <li key={i}><ArrowRight size={14} aria-hidden="true" /> <span className="hop-code">{r.status}</span> {host(r.url)}</li>
          ))}
        </ol>
      )}

      {scan.correlations.length > 0 && (
        <ul className="correlations">
          {scan.correlations.map((c, i) => (
            <li key={i}><span className="tag tag-scam">{t("linkConfirmed")}</span> {L(c)}</li>
          ))}
        </ul>
      )}

      <div className="link-cols">
        <div>
          <div className="mini-label">{t("linkStatic")}</div>
          {scan.static_signals.length === 0 ? <p className="muted small">—</p> : (
            <ul className="signal-mini">
              {scan.static_signals.map((s) => <li key={s.id} className={confirmed.has(s.id) ? "hit" : ""}>{L(s)}</li>)}
            </ul>
          )}
        </div>
        <div>
          <div className="mini-label">{t("linkLive")}</div>
          {scan.evidence.length === 0 ? <p className="muted small">{live.error ?? "—"}</p> : (
            <ul className="signal-mini">
              {scan.evidence.map((s) => <li key={s.id} className={s.weight >= 30 ? "hit" : ""}>{L(s)}</li>)}
            </ul>
          )}
        </div>
      </div>

      <dl className="facts link-facts">
        {live.final_url && <div><dt>{t("linkFinal")}</dt><dd>{host(live.final_url)}</dd></div>}
        <div><dt>{t("linkDomainAge")}</dt><dd>{live.domain_age_days === null ? t("unknown") : t("daysN", { n: live.domain_age_days })}</dd></div>
        <div><dt>{t("linkCert")}</dt><dd>{live.tls ? `${live.tls.issuer ?? "?"}${live.tls.age_days !== null ? `, ${t("daysN", { n: live.tls.age_days })}` : ""}` : live.https ? t("unknown") : "HTTP"}</dd></div>
        {scan.hosting && <div><dt>{t("linkHost")}</dt><dd>{scan.hosting.network ?? scan.hosting.ips[0] ?? t("unknown")}</dd></div>}
      </dl>
      <p className="hint">{t("linkNote")}</p>
    </section>
  );
}
