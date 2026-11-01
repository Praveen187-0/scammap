import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { useMemo, useState } from "react";
import type { Campaign, Network, NetworkNode } from "../api";
import { useApp } from "../ctx";
import type { StringKey } from "../i18n";

// Categorical slots validated for all-pairs use (node-link): only the first three are distinct enough for every
// pair, so campaigns past the third fold into "other". Grey = not part of any campaign.
export const CAMPAIGN_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];
const OTHER = "#7d8b96";
const LOOSE = "#c3ccd4";

type N = SimulationNodeDatum & NetworkNode & { r: number };
type L = SimulationLinkDatum<N> & { kind: string };

const W = 760;
const H = 460;

export function campaignColor(order: string[], id: string | null | undefined): string {
  if (!id) return LOOSE;
  const i = order.indexOf(id);
  return i >= 0 && i < CAMPAIGN_COLORS.length ? CAMPAIGN_COLORS[i]! : OTHER;
}

/** Static force layout (computed once, no jiggling), hover for details, click to open the campaign. */
export function NetworkGraph({ net, campaigns, selected, onSelect }: { net: Network; campaigns: Campaign[]; selected: string | null; onSelect: (id: string) => void }) {
  const { t, lang } = useApp();
  const [hover, setHover] = useState<{ n: N; x: number; y: number } | null>(null);
  const order = useMemo(() => campaigns.map((c) => c.id), [campaigns]);
  const title = useMemo(() => new Map(campaigns.map((c) => [c.id, lang === "hi" ? c.title_hi : c.title_en])), [campaigns, lang]);

  const layout = useMemo(() => {
    const nodes: N[] = net.nodes.map((n) => ({ ...n, r: n.kind === "host" ? 6 : Math.min(13, 4.5 + Math.sqrt(n.people ?? 1) * 1.6) }));
    const ids = new Set(nodes.map((n) => n.id));
    const links: L[] = net.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ source: l.source, target: l.target, kind: l.kind }));
    const sim = forceSimulation(nodes)
      .force("link", forceLink<N, L>(links).id((d) => d.id).distance((l) => (l.kind === "same_template" ? 70 : 34)).strength((l) => (l.kind === "same_template" ? 0.08 : 0.7)))
      .force("charge", forceManyBody().strength(-46))
      .force("center", forceCenter(W / 2, H / 2))
      .force("x", forceX(W / 2).strength(0.045))
      .force("y", forceY(H / 2).strength(0.07))
      .force("collide", forceCollide<N>().radius((d) => d.r + 2.5))
      .stop();
    for (let i = 0; i < 320; i++) sim.tick();
    for (const n of nodes) {
      n.x = Math.max(n.r + 4, Math.min(W - n.r - 4, n.x ?? W / 2));
      n.y = Math.max(n.r + 4, Math.min(H - n.r - 4, n.y ?? H / 2));
    }
    return { nodes, links: links as Array<L & { source: N; target: N }> };
  }, [net]);

  const kindLabel = (k: string): string => t((k === "host" ? "linkHost" : k === "phone" ? "typePhone" : k === "upi" ? "typeUpi" : k === "url" ? "typeUrl" : "typeSender") as StringKey);
  const dim = (c: string | null | undefined): boolean => Boolean(selected) && c !== selected;

  return (
    <div className="net-wrap">
      <svg className="net-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("campNetwork")} onMouseLeave={() => setHover(null)}>
        {layout.links.map((l, i) => (
          <line
            key={i}
            x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y}
            className={`net-link k-${l.kind} ${dim(l.source.campaign) && dim(l.target.campaign) ? "dim" : ""}`}
          />
        ))}
        {layout.nodes.map((n) => {
          const color = n.kind === "host" ? "var(--ink-2)" : campaignColor(order, n.campaign);
          const props = {
            className: `net-node ${dim(n.campaign) ? "dim" : ""} ${n.campaign ? "clickable" : ""}`,
            onMouseEnter: () => setHover({ n, x: n.x ?? 0, y: n.y ?? 0 }),
            onFocus: () => setHover({ n, x: n.x ?? 0, y: n.y ?? 0 }),
            onClick: () => n.campaign && onSelect(n.campaign),
            tabIndex: n.campaign ? 0 : -1,
            onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && n.campaign && onSelect(n.campaign),
          };
          return n.kind === "host" ? (
            <rect key={n.id} x={(n.x ?? 0) - n.r} y={(n.y ?? 0) - n.r} width={n.r * 2} height={n.r * 2} rx={2} fill={color} {...props} />
          ) : (
            <circle key={n.id} cx={n.x} cy={n.y} r={n.r} fill={color} stroke={n.verdict === "KNOWN_SCAM" ? "var(--ink)" : "var(--surface)"} strokeWidth={n.verdict === "KNOWN_SCAM" ? 1.6 : 2} {...props} />
          );
        })}
      </svg>
      {hover && (
        <div className="chart-tip net-tip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}>
          <strong>{hover.n.label}</strong>
          <span>{kindLabel(hover.n.kind)}{hover.n.people ? `, ${t("campPeople", { n: hover.n.people })}` : ""}{hover.n.network ? `, ${hover.n.network}` : ""}</span>
          {hover.n.campaign && <span>{title.get(hover.n.campaign)}</span>}
        </div>
      )}
      <div className="legend net-legend">
        {campaigns.slice(0, CAMPAIGN_COLORS.length).map((c, i) => (
          <button key={c.id} className="legend-row" onClick={() => onSelect(c.id)} aria-pressed={selected === c.id}>
            <span className="legend-dot" style={{ background: CAMPAIGN_COLORS[i] }} /> {lang === "hi" ? c.title_hi : c.title_en}
          </button>
        ))}
        {campaigns.length > CAMPAIGN_COLORS.length && <span className="legend-row"><span className="legend-dot" style={{ background: OTHER }} /> {t("campOther")}</span>}
        <span className="legend-row"><span className="legend-dot" style={{ background: LOOSE }} /> {t("campLoose")}</span>
        <span className="legend-row"><span className="legend-sq" /> {t("linkHost")}</span>
        <span className="legend-row"><span className="legend-line k-co_reported" /> {t("link_co_reported")}</span>
        <span className="legend-row"><span className="legend-line k-same_template" /> {t("link_same_template")}</span>
        <span className="legend-row"><span className="legend-line k-hosted_on" /> {t("link_hosted_on")}</span>
      </div>
    </div>
  );
}
