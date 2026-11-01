// Small, dependency-free SVG charts. Rules followed: thin marks (columns <= 24px, 4px rounded data end, square at
// the baseline), hairline solid grid, one axis, a legend for 2+ series, text in ink colours (never series colours),
// hover tooltips that only enhance, and a table view for every chart.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useApp } from "../ctx";

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width;
      if (cw) setW(cw);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface TableSpec {
  columns: Array<{ label: string; num?: boolean }>;
  rows: Array<Array<string | number>>;
}

export function ChartCard({ title, sub, legend, table, className = "", children }: { title: string; sub?: string; legend?: ReactNode; table?: TableSpec; className?: string; children: ReactNode }) {
  const { t } = useApp();
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card ${className}`}>
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {table && (
          <button className="btn btn-text table-toggle" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? t("showChart") : t("showTable")}
          </button>
        )}
      </div>
      {legend && !asTable && <div className="legend">{legend}</div>}
      {asTable && table ? (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr>{table.columns.map((c) => <th key={c.label} className={c.num ? "num" : ""}>{c.label}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={table.columns[j]?.num ? "num" : ""}>{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

export function Swatch({ color, label }: { color: string; label: string }) {
  return <span><i className="swatch" style={{ background: color }} aria-hidden="true" /> {label}</span>;
}

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Stacked columns over time: series[0] sits on the baseline. */
export function StackedColumns({ data, series, xLabel }: { data: Array<{ x: string; values: number[] }>; series: Array<{ name: string; color: string }>; xLabel: (x: string) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 200;
  const pad = { l: 34, r: 6, t: 8, b: 24 };
  const innerW = Math.max(100, width - pad.l - pad.r);
  const max = niceMax(Math.max(1, ...data.map((d) => d.values.reduce((s, v) => s + v, 0))));
  const band = innerW / Math.max(1, data.length);
  const colW = Math.min(24, Math.max(3, band - 3));
  const y = (v: number): number => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const every = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 64)));
  const hd = hover !== null ? data[hover] : undefined;
  return (
    <div ref={ref} style={{ position: "relative" }} onMouseLeave={() => setHover(null)}>
      <svg className="chart-svg" height={H} width={width} role="img" aria-label={series.map((s) => s.name).join(", ")}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={pad.l} x2={width - pad.r} y1={y(tk)} y2={y(tk)} stroke={tk === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={pad.l - 6} y={y(tk) + 4} textAnchor="end">{tk.toLocaleString("en-IN")}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + band * i + band / 2;
          let acc = 0;
          const total = d.values.reduce((s, v) => s + v, 0);
          return (
            <g key={d.x} opacity={hover === null || hover === i ? 1 : 0.55}>
              {d.values.map((v, k) => {
                if (v <= 0) return null;
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const top = acc === total;
                const h = Math.max(1, y0 - y1 - (k > 0 ? 2 : 0));
                const r = top ? Math.min(4, h / 2, colW / 2) : 0;
                const x0 = cx - colW / 2;
                const yTop = y1;
                const path = `M${x0},${yTop + h} L${x0},${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} L${x0 + colW - r},${yTop} Q${x0 + colW},${yTop} ${x0 + colW},${yTop + r} L${x0 + colW},${yTop + h} Z`;
                return <path key={k} d={path} fill={series[k]?.color} />;
              })}
              <rect x={pad.l + band * i} y={pad.t} width={band} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${xLabel(d.x)}: ${d.values.join(", ")}`} />
              {i % every === 0 && <text x={cx} y={H - 6} textAnchor="middle">{xLabel(d.x)}</text>}
            </g>
          );
        })}
      </svg>
      {hd && hover !== null && (
        <div className="chart-tip" style={{ left: pad.l + band * hover + band / 2, top: y(hd.values.reduce((s, v) => s + v, 0)) }}>
          <strong>{xLabel(hd.x)}</strong>{series.map((s, k) => <div key={s.name}>{s.name}: {hd.values[k] ?? 0}</div>)}
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars, one series. Value printed at the bar's tip. */
export function BarList({ rows, highlight }: { rows: Array<{ label: string; value: number; icon?: ReactNode; dim?: boolean }>; highlight?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label} title={`${r.label}: ${r.value}`}>
          <div className="bar-label">{r.icon}<span>{r.label}</span></div>
          <div className="bar-track"><div className={`bar-fill ${highlight && r.dim ? "dim" : ""}`} style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <div className="bar-value">{r.value.toLocaleString("en-IN")}</div>
        </div>
      ))}
    </div>
  );
}

/** Single-series columns with the value on each cap (few categories). */
export function Columns({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const H = 170;
  const pad = { t: 18, b: 26 };
  const max = Math.max(1, ...rows.map((r) => r.value));
  const band = width / Math.max(1, rows.length);
  const colW = Math.min(24 * 2, band * 0.5);
  return (
    <div ref={ref}>
      <svg className="chart-svg" height={H} width={width} role="img" aria-label={rows.map((r) => `${r.label} ${r.value}`).join(", ")}>
        <line x1={0} x2={width} y1={H - pad.b} y2={H - pad.b} stroke="var(--axis)" />
        {rows.map((r, i) => {
          const h = ((H - pad.t - pad.b) * r.value) / max;
          const x = band * i + (band - colW) / 2;
          const yTop = H - pad.b - h;
          const rad = Math.min(4, h / 2);
          return (
            <g key={r.label}>
              {h > 0 && <path d={`M${x},${H - pad.b} L${x},${yTop + rad} Q${x},${yTop} ${x + rad},${yTop} L${x + colW - rad},${yTop} Q${x + colW},${yTop} ${x + colW},${yTop + rad} L${x + colW},${H - pad.b} Z`} fill="var(--series-1)" />}
              <text x={x + colW / 2} y={yTop - 5} textAnchor="middle" style={{ fill: "var(--ink)", fontWeight: 600 }}>{r.value.toLocaleString("en-IN")}</text>
              <text x={band * i + band / 2} y={H - 8} textAnchor="middle">{r.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const RAMP = ["#eef5f6", "#c7e3e7", "#93c7cf", "#58a6b3", "#1f8496", "#08637a"];

/** Weekday x hour heatmap, one sequential hue, with a scale legend. */
export function Heatmap({ grid, dayLabels, valueLabel }: { grid: number[][]; dayLabels: string[]; valueLabel: string }) {
  const [tip, setTip] = useState<string | null>(null);
  const max = Math.max(1, ...grid.flat());
  const color = (v: number): string => (v === 0 ? RAMP[0]! : RAMP[Math.min(RAMP.length - 1, 1 + Math.floor((v / max) * (RAMP.length - 1.001)))]!);
  return (
    <div>
      <div className="heat" role="img" aria-label={valueLabel}>
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ textAlign: "center" }}>{h % 6 === 0 ? h : ""}</span>)}
        {grid.map((row, d) => [
          <span key={`l${d}`}>{dayLabels[d]}</span>,
          ...row.map((v, h) => (
            <span key={`${d}-${h}`} className="heat-cell" style={{ background: color(v) }} onMouseEnter={() => setTip(`${dayLabels[d]} ${String(h).padStart(2, "0")}:00, ${v} ${valueLabel}`)} onMouseLeave={() => setTip(null)} title={`${dayLabels[d]} ${h}:00, ${v}`} />
          )),
        ])}
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
        <div className="heat-scale">0 {RAMP.map((c) => <i key={c} style={{ background: c }} />)} {max}</div>
        <span className="hint" aria-live="polite">{tip}</span>
      </div>
    </div>
  );
}

/** Tiny bar sparkline (one series, last value highlighted). Decorative: the numbers sit next to it in text. */
export function Spark({ values, color = "var(--series-1)", last = "var(--ink)" }: { values: number[]; color?: string; last?: string }) {
  const max = Math.max(1, ...values);
  const w = 6, gap = 2, h = 24;
  return (
    <svg width={values.length * (w + gap) - gap} height={h} aria-hidden="true" className="spark">
      {values.map((v, i) => {
        const bh = Math.max(1.5, (v / max) * h);
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={1.5} fill={i === values.length - 1 ? last : color} opacity={i === values.length - 1 ? 1 : 0.55} />;
      })}
    </svg>
  );
}

/** Hourly columns for one series, with a hover tooltip. Used as small multiples (one scale each, never two axes). */
export function HourBars({ values, hours, color, label, height = 96 }: { values: number[]; hours: string[]; color: string; label: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<number | null>(null);
  const pad = { t: 14, b: 18 };
  const max = Math.max(1, ...values);
  const band = width / Math.max(1, values.length);
  const colW = Math.max(1.5, Math.min(12, band - 2));
  const hourLabel = (iso: string): string => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const dayLabel = (iso: string): string => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  return (
    <div ref={ref} className="hourbars" onMouseLeave={() => setTip(null)}>
      <svg className="chart-svg" width={width} height={height} role="img" aria-label={`${label}: ${values.reduce((a, b) => a + b, 0)}`}>
        <line x1={0} x2={width} y1={height - pad.b} y2={height - pad.b} stroke="var(--axis)" />
        <text x={0} y={10} style={{ fill: "var(--muted)" }}>{max}</text>
        {values.map((v, i) => {
          const h = ((height - pad.t - pad.b) * v) / max;
          const x = band * i + (band - colW) / 2;
          const y = height - pad.b - h;
          const r = Math.min(2, colW / 2, h / 2);
          return (
            <g key={i} onMouseEnter={() => setTip(i)}>
              <rect x={band * i} y={0} width={band} height={height} fill="transparent" />
              {h > 0 && <path d={`M${x},${height - pad.b} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + colW - r},${y} Q${x + colW},${y} ${x + colW},${y + r} L${x + colW},${height - pad.b} Z`} fill={color} opacity={tip === null || tip === i ? 1 : 0.55} />}
            </g>
          );
        })}
        {hours.length > 0 && <text x={0} y={height - 4}>{dayLabel(hours[0]!)}</text>}
        {hours.length > 0 && <text x={width} y={height - 4} textAnchor="end">{hourLabel(hours[hours.length - 1]!)}</text>}
      </svg>
      {tip !== null && hours[tip] && (
        <div className="chart-tip" style={{ left: Math.min(width - 60, Math.max(60, band * tip + band / 2)), top: 8 }}>
          <strong>{values[tip]}</strong> <span>{dayLabel(hours[tip]!)} {hourLabel(hours[tip]!)}</span>
        </div>
      )}
    </div>
  );
}
