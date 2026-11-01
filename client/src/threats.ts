// Map layer B: polls the server's global threat feed (GET /threats/global) and reveals new URLs one by one, so a
// batch that URLhaus publishes every 5 minutes arrives on the map as a steady stream. Purely visual pacing: every
// item keeps its real "added" time.
import { useEffect, useRef, useState } from "react";
import { api, type ThreatFeedReply, type ThreatItem } from "./api";

const POLL_MS = 60_000;
const FLASH_MS = 6_000;

export interface GlobalThreats {
  ready: boolean;
  status: ThreatFeedReply["status"] | null;
  items: ThreatItem[];
  flash: ReadonlySet<string>;
  countries: ThreatFeedReply["countries"];
  attribution: ThreatFeedReply["attribution"] | null;
  latest: ThreatItem[];
}

export function useGlobalThreats(enabled: boolean): GlobalThreats {
  const [reply, setReply] = useState<ThreatFeedReply | null>(null);
  const [items, setItems] = useState<ThreatItem[]>([]);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [latest, setLatest] = useState<ThreatItem[]>([]);
  const queue = useRef<ThreatItem[]>([]);
  const newest = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let revealTimer: number | undefined;
    const reveal = (): void => {
      const next = queue.current.shift();
      if (!next || !alive) return;
      setItems((xs) => (xs.some((x) => x.id === next.id) ? xs : [next, ...xs].slice(0, 400)));
      setLatest((xs) => [next, ...xs].slice(0, 6));
      setFlash((s) => new Set(s).add(next.id));
      window.setTimeout(() => setFlash((s) => {
        const n = new Set(s);
        n.delete(next.id);
        return n;
      }), FLASH_MS);
      // Spread what is waiting over the next poll, between 0.4 s and 4 s apart.
      const gap = Math.max(400, Math.min(4000, (POLL_MS * 0.85) / Math.max(1, queue.current.length)));
      if (queue.current.length) revealTimer = window.setTimeout(reveal, gap);
      else revealTimer = undefined;
    };
    const load = async (): Promise<void> => {
      try {
        const first = newest.current === null;
        const r = await api<ThreatFeedReply>(`/threats/global${newest.current ? `?since=${newest.current}` : ""}`);
        if (!alive) return;
        setReply((prev) => ({ ...r, items: prev && !first ? prev.items : r.items }));
        if (r.items.length === 0) return;
        newest.current = r.items[0]!.id;
        if (first) {
          // Show most at once; stream the newest 25 in, oldest of them first.
          const streamed = r.items.slice(0, 25).reverse();
          setItems(r.items.slice(25));
          setLatest([]);
          queue.current.push(...streamed);
        } else queue.current.push(...[...r.items].reverse());
        if (revealTimer === undefined) reveal();
      } catch {
        /* licence or network: the panel shows the status */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
      if (revealTimer) window.clearTimeout(revealTimer);
      queue.current = [];
      newest.current = null;
    };
  }, [enabled]);

  return {
    ready: reply !== null,
    status: reply?.status ?? null,
    items: enabled ? items : [],
    flash,
    countries: reply?.countries ?? [],
    attribution: reply?.attribution ?? null,
    latest: enabled ? latest : [],
  };
}
