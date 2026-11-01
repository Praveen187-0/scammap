import { CreditCard, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type CardPage, type CardRow } from "../api";
import { fmt, useApp } from "../ctx";

interface Counters {
  tx: number;
  tp: number;
  fp: number;
  fn: number;
  stopped: number;
}
const ZERO: Counters = { tx: 0, tp: 0, fp: 0, fn: 0, stopped: 0 };
const SPEEDS = [300, 900, 2400];

/**
 * Streams the model's held-out card transactions in dataset time. Each transaction is scored by the logistic
 * model trained on the earlier transactions; the threshold was tuned on a separate slice.
 */
export function CardReplay({ total }: { total: number }) {
  const { t, lang } = useApp();
  const [threshold, setThreshold] = useState(0.5);
  const [ready, setReady] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(SPEEDS[1]!);
  const [clock, setClock] = useState(0);
  const [c, setC] = useState<Counters>(ZERO);
  const [strip, setStrip] = useState<CardRow[]>([]);
  const [events, setEvents] = useState<Array<CardRow & { outcome: "caught" | "false" | "missed" }>>([]);
  const [done, setDone] = useState(false);

  const buf = useRef<CardRow[]>([]);
  const cursor = useRef<number | null>(0);
  const loading = useRef(false);
  const clockRef = useRef(0);
  const counters = useRef<Counters>({ ...ZERO });

  const fetchMore = useCallback(async () => {
    if (loading.current || cursor.current === null) return;
    loading.current = true;
    try {
      const page = await api<CardPage>(`/live/cards?cursor=${cursor.current}&limit=2000`);
      if (cursor.current === 0) {
        setThreshold(page.threshold);
        if (page.start_t !== null) {
          clockRef.current = page.start_t;
          setClock(page.start_t);
        }
        setReady(page.rows.length > 0);
      }
      buf.current.push(...page.rows);
      cursor.current = page.next;
    } catch {
      setReady((r) => r ?? false);
    } finally {
      loading.current = false;
    }
  }, []);

  const restart = useCallback(() => {
    buf.current = [];
    cursor.current = 0;
    counters.current = { ...ZERO };
    setC(ZERO);
    setStrip([]);
    setEvents([]);
    setDone(false);
    void fetchMore();
  }, [fetchMore]);

  useEffect(() => {
    restart();
  }, [restart]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      clockRef.current += dt * speed;
      const due: CardRow[] = [];
      while (buf.current.length && buf.current[0]!.t <= clockRef.current) due.push(buf.current.shift()!);
      if (buf.current.length < 600) void fetchMore();
      if (due.length) {
        const k = counters.current;
        const flagged: Array<CardRow & { outcome: "caught" | "false" | "missed" }> = [];
        for (const r of due) {
          k.tx++;
          const hit = r.score >= threshold;
          if (r.fraud && hit) {
            k.tp++;
            k.stopped += r.amount;
            flagged.push({ ...r, outcome: "caught" });
          } else if (r.fraud) {
            k.fn++;
            flagged.push({ ...r, outcome: "missed" });
          } else if (hit) {
            k.fp++;
            flagged.push({ ...r, outcome: "false" });
          }
        }
        setC({ ...k });
        setStrip((s) => [...s, ...due].slice(-180));
        if (flagged.length) setEvents((e) => [...flagged.reverse(), ...e].slice(0, 7));
      }
      setClock(clockRef.current);
      if (!buf.current.length && cursor.current === null) {
        setPlaying(false);
        setDone(true);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, threshold, fetchMore]);

  if (ready === false) {
    return (
      <section className="card span-12">
        <div className="card-head"><div><h3><CreditCard size={17} aria-hidden="true" /> {t("replayTitle")}</h3></div></div>
        <p className="muted">{t("replayNone")}</p>
      </section>
    );
  }
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : 0;
  const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : 0;
  const day = Math.floor(clock / 86400) + 1;
  const sec = Math.floor(clock % 86400);
  const hm = `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;
  const W = 640, H = 120;
  const yOf = (s: number): number => H - 8 - Math.sqrt(s) * (H - 16);

  return (
    <section className="card span-12 replay">
      <div className="card-head">
        <div>
          <h3><CreditCard size={17} aria-hidden="true" /> {t("replayTitle")}</h3>
          <p>{t("replaySub", { n: fmt(total, lang) })}</p>
        </div>
        <div className="row">
          <span className="replay-clock">{t("replayClock", { d: day, hm })}</span>
          <div className="seg" role="group" aria-label={t("replaySpeed")}>
            {SPEEDS.map((s) => <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}x</button>)}
          </div>
          <button className="btn btn-primary" onClick={() => (done ? restart() : setPlaying((p) => !p))} disabled={ready === null}>
            {done ? <RotateCcw size={17} aria-hidden="true" /> : playing ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
            {done ? t("replayRestart") : playing ? t("replayPause") : t("replayPlay")}
          </button>
        </div>
      </div>

      <div className="replay-grid">
        <div className="replay-stats">
          <div><span className="kpi-label">{t("rTx")}</span><span className="kpi-value">{fmt(c.tx, lang)}</span></div>
          <div><span className="kpi-label">{t("rCaught")}</span><span className="kpi-value" style={{ color: "var(--ok)" }}>{c.tp}</span></div>
          <div><span className="kpi-label">{t("rMissed")}</span><span className="kpi-value" style={{ color: "var(--scam)" }}>{c.fn}</span></div>
          <div><span className="kpi-label">{t("rFalse")}</span><span className="kpi-value">{c.fp}</span></div>
          <div><span className="kpi-label">{t("rPrecision")} / {t("rRecall")}</span><span className="kpi-value small-num">{Math.round(precision * 100)}% / {Math.round(recall * 100)}%</span></div>
          <div><span className="kpi-label">{t("rStopped")}</span><span className="kpi-value small-num">{c.stopped.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span></div>
        </div>
        <div className="replay-strip">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t("rFlagged")}>
            <line x1={0} x2={W} y1={yOf(threshold)} y2={yOf(threshold)} stroke="var(--scam)" strokeDasharray="4 4" strokeWidth={1} opacity={0.6} />
            <line x1={0} x2={W} y1={H - 8} y2={H - 8} stroke="var(--axis)" />
            {strip.map((r, i) => {
              const x = (i / 180) * W + 2;
              const hit = r.score >= threshold;
              const fill = r.fraud ? (hit ? "var(--ok)" : "var(--scam)") : hit ? "var(--warn)" : "#9fb0bd";
              return <circle key={r.id} cx={x} cy={yOf(r.score)} r={r.fraud || hit ? 4.5 : 2} fill={fill} opacity={r.fraud || hit ? 1 : 0.55} />;
            })}
          </svg>
          <div className="legend small">
            <span><i className="swatch" style={{ background: "var(--ok)" }} /> {t("rOutcomeCaught")}</span>
            <span><i className="swatch" style={{ background: "var(--scam)" }} /> {t("rOutcomeMissed")}</span>
            <span><i className="swatch" style={{ background: "var(--warn)" }} /> {t("rOutcomeFalse")}</span>
          </div>
        </div>
        <ul className="replay-events" aria-live="polite">
          {events.map((e) => (
            <li key={e.id} className={`ev-${e.outcome}`}>
              <span className="ev-dot" aria-hidden="true" />
              <span>{e.outcome === "caught" ? t("rOutcomeCaught") : e.outcome === "missed" ? t("rOutcomeMissed") : t("rOutcomeFalse")}</span>
              <span className="muted">{e.amount.toFixed(2)}</span>
              <span className="hint">{t("rScore", { s: e.score.toFixed(2) })}</span>
            </li>
          ))}
          {done && <li className="muted">{t("replayDone")}</li>}
        </ul>
      </div>
    </section>
  );
}
