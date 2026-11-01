import { RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type ExplainReply } from "../api";
import { fmt, useApp } from "../ctx";
import { translate, type StringKey } from "../i18n";

const W = 640;
const DOT = 4.2;

/** Sunflower packing: k-th dot inside a bubble. */
function petal(k: number): [number, number] {
  const a = k * 2.39996;
  const r = 4.6 * Math.sqrt(k + 0.5);
  return [Math.cos(a) * r, Math.sin(a) * r];
}
const radiusFor = (size: number): number => Math.max(14, 4.6 * Math.sqrt(size + 0.5) + 9);

/**
 * The trust engine, made visible: every report is a dot on a timeline; then the dots move into the "people" they
 * belong to. Bubbles that were set aside (bursts, one network, copy-paste, grudges) stay grey.
 */
export function ExplainView({ type, value, onClose }: { type: string; value: string; onClose: () => void }) {
  const { t, lang } = useApp();
  const [data, setData] = useState<ExplainReply | null>(null);
  const [err, setErr] = useState(false);
  const [grouped, setGrouped] = useState(false);

  useEffect(() => {
    api<ExplainReply>(`/lookup/explain?type=${encodeURIComponent(type)}&value=${encodeURIComponent(value)}`)
      .then((d) => {
        setData(d);
        window.setTimeout(() => setGrouped(true), 700);
      })
      .catch(() => setErr(true));
  }, [type, value]);
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const layout = useMemo(() => {
    if (!data?.available) return null;
    const span = Math.max(24, Math.ceil(Math.max(...data.reports.map((r) => r.hours_ago), 1)));
    const x = (h: number): number => 28 + (1 - h / span) * (W - 56);
    // Timeline: stack dots that land on the same spot.
    const used = new Map<number, number>();
    const line = data.reports.map((r) => {
      let bx = Math.round(x(r.hours_ago) / (DOT * 2.4));
      while ((used.get(bx) ?? 0) >= 6) bx -= 1; // tall stacks spill to the left instead of covering the label
      const n = used.get(bx) ?? 0;
      used.set(bx, n + 1);
      return [bx * DOT * 2.4, 74 - n * DOT * 2.3] as [number, number];
    });
    // Bubbles: biggest first, wrapped into rows.
    const order = [...data.voices].sort((a, b) => Number(b.credible) - Number(a.credible) || b.size - a.size);
    const centre = new Map<number, [number, number, number]>();
    let cx = 16;
    let rowTop = 150;
    let rowH = 0;
    for (const v of order) {
      const r = radiusFor(v.size);
      if (cx + 2 * r > W - 16) {
        cx = 16;
        rowTop += rowH + 34;
        rowH = 0;
      }
      centre.set(v.index, [cx + r, rowTop + r, r]);
      cx += 2 * r + 18;
      rowH = Math.max(rowH, 2 * r);
    }
    const height = rowTop + rowH + 40;
    const seen = new Map<number, number>();
    const inBubble = data.reports.map((r) => {
      const c = centre.get(r.voice);
      if (!c) return [W / 2, height - 20] as [number, number];
      const k = seen.get(r.voice) ?? 0;
      seen.set(r.voice, k + 1);
      const [dx, dy] = petal(k);
      return [c[0] + dx, c[1] + dy] as [number, number];
    });
    return { span, x, line, centre, height, inBubble };
  }, [data]);

  const flagName = (f: string): string => {
    const key = `fl_${f}` as StringKey;
    const s = translate(lang, key);
    return s === key ? f.toLowerCase().replace(/_/g, " ") : s;
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet explain" role="dialog" aria-modal="true" aria-label={t("explainTitle")} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{t("explainTitle")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("close")}><X size={20} /></button>
        </div>
        <p className="muted small">{t("explainIntro")}</p>
        {err && <p className="error">{t("errorGeneric")}</p>}
        {data && !data.available && <p className="muted">{t("explainPrivate")}</p>}
        {data?.available && layout && (
          <>
            <p className="explain-sum">
              {t(data.people === 1 ? "explainSummaryOne" : "explainSummary", { raw: fmt(data.raw, lang), people: fmt(data.people, lang), credible: fmt(data.credible, lang) })}
            </p>
            <svg className={`explain-svg ${grouped ? "grouped" : ""}`} viewBox={`0 0 ${W} ${layout.height}`} role="img" aria-label={t("explainSummary", { raw: data.raw, people: data.people, credible: data.credible })}>
              <text x={16} y={22} className="ex-label">{t("explainTimeline")}</text>
              <line x1={22} x2={W - 22} y1={84} y2={84} className="ex-axis" />
              <text x={22} y={102} className="ex-tick">{t("explainAgo", { h: layout.span })}</text>
              <text x={W - 22} y={102} className="ex-tick" textAnchor="end">{t("explainNow")}</text>
              {layout.line.map(([x, y], i) => <circle key={`g${i}`} cx={x} cy={y} r={DOT - 1} className="ex-ghost" />)}
              <text x={16} y={136} className="ex-label">{t("explainGrouped")}</text>
              {data.voices.map((v) => {
                const c = layout.centre.get(v.index);
                if (!c) return null;
                return (
                  <g key={v.index} className={`ex-voice ${v.credible ? "on" : "off"}`}>
                    <circle cx={c[0]} cy={c[1]} r={c[2]} />
                    <text x={Math.min(W - 56, Math.max(56, c[0]))} y={c[1] + c[2] + 15} textAnchor="middle" className="ex-vlabel">
                      {v.flags[0] ? flagName(v.flags[0]) : v.credible ? (v.size > 1 ? t("explainBubble", { n: v.size }) : "1") : t("explainSetAside")}
                    </text>
                  </g>
                );
              })}
              {data.reports.map((r, i) => {
                const [x, y] = grouped ? layout.inBubble[i]! : layout.line[i]!;
                const v = data.voices.find((vv) => vv.index === r.voice);
                return (
                  <circle
                    key={i}
                    r={DOT}
                    className={`ex-dot ${v?.credible ? "on" : "off"} ${r.evidence ? "ev" : ""}`}
                    style={{ transform: `translate(${x}px, ${y}px)`, transitionDelay: `${Math.min(i * 12, 600)}ms` }}
                  />
                );
              })}
            </svg>
            <div className="row explain-legend">
              <span className="legend-row"><span className="legend-dot" style={{ background: "var(--scam)" }} /> {t("explainCounted")}</span>
              <span className="legend-row"><span className="legend-dot" style={{ background: "#aab6bf" }} /> {t("explainSetAside")}</span>
              <span className="legend-row"><span className="legend-dot ev-ring" /> {t("explainEvidence")}</span>
              <span className="topbar-spacer" />
              <button className="btn btn-quiet" onClick={() => { setGrouped(false); window.setTimeout(() => setGrouped(true), 650); }}>
                <RotateCcw size={16} aria-hidden="true" /> {t("explainReplay")}
              </button>
            </div>
            {data.voices.some((v) => v.flags.length > 0) && (
              <ul className="explain-flags">
                {[...new Set(data.voices.flatMap((v) => v.flags))].map((f) => (
                  <li key={f}><span className="tag">{flagName(f)}</span> <span className="muted small">{t(`flx_${f}` as StringKey) !== `flx_${f}` ? t(`flx_${f}` as StringKey) : ""}</span></li>
                ))}
              </ul>
            )}
          </>
        )}
        {!data && !err && <div className="skeleton-line" style={{ width: "70%" }} />}
      </div>
    </div>
  );
}
