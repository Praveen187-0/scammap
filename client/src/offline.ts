// Reports made with no signal are kept on this phone and sent when the connection returns. Each queued report has
// its own report_id, so sending it twice never counts twice (the server answers "duplicate").
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";

const KEY = "sm.queue";
type Queued = { body: Record<string, unknown>; at: number };

const listeners = new Set<(n: number) => void>();

function read(): Queued[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as Queued[]) : [];
  } catch {
    return [];
  }
}
function write(q: Queued[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(q.slice(-50)));
  } catch {
    /* storage full or blocked */
  }
  for (const l of listeners) l(q.length);
}

export function queueCount(): number {
  return read().length;
}

export function enqueue(body: Record<string, unknown>): void {
  write([...read(), { body, at: Date.now() }]);
}

let flushing = false;
/** Sends what is waiting. Stops at the first network failure; drops reports the server rejects as invalid. */
export async function flushQueue(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of read()) {
      try {
        await api("/reports", { method: "POST", body: item.body });
        sent++;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 0 || e.status === 403 || e.status >= 500)) break; // try later
        if (e instanceof ApiError && e.status === 429) break;
        // 400: the report can never be accepted; drop it.
      }
      write(read().filter((q) => q.body.report_id !== item.body.report_id));
    }
  } finally {
    flushing = false;
  }
  return sent;
}

let started = false;
export function startQueue(): void {
  if (started) return;
  started = true;
  window.addEventListener("online", () => void flushQueue());
  window.setInterval(() => void flushQueue(), 60_000);
  void flushQueue();
}

export function useQueueCount(): number {
  const [n, setN] = useState(queueCount);
  useEffect(() => {
    listeners.add(setN);
    return () => void listeners.delete(setN);
  }, []);
  return n;
}
