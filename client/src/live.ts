// One shared Server-Sent Events connection to /live/stream for every screen that wants live updates.
import { useEffect, useRef, useState } from "react";
import type { LiveEvent } from "./api";

export type LiveStatus = "connecting" | "open" | "retrying";
type Listener = (e: LiveEvent) => void;

let source: EventSource | null = null;
let status: LiveStatus = "connecting";
const listeners = new Set<Listener>();
const statusListeners = new Set<(s: LiveStatus) => void>();
let onExpired: (() => void) | null = null;

export function onLiveExpired(fn: () => void): void {
  onExpired = fn;
}

function setStatus(s: LiveStatus): void {
  status = s;
  for (const fn of statusListeners) fn(s);
}

function open(): void {
  if (source || typeof EventSource === "undefined") return;
  source = new EventSource("/live/stream");
  setStatus("connecting");
  source.onopen = () => setStatus("open");
  source.onerror = () => setStatus("retrying"); // EventSource reconnects by itself
  for (const type of ["report", "defence", "alert", "classified"]) {
    source.addEventListener(type, (m) => {
      try {
        const e = JSON.parse((m as MessageEvent<string>).data) as LiveEvent;
        for (const fn of listeners) fn(e);
      } catch {
        /* ignore a malformed event */
      }
    });
  }
  source.addEventListener("expired", () => {
    close();
    onExpired?.();
  });
}

function close(): void {
  source?.close();
  source = null;
  setStatus("connecting");
}

/** Subscribe while mounted. The connection opens with the first subscriber and closes with the last. */
export function useLive(fn: Listener): LiveStatus {
  const ref = useRef(fn);
  ref.current = fn;
  const [st, setSt] = useState<LiveStatus>(status);
  useEffect(() => {
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    statusListeners.add(setSt);
    open();
    setSt(status);
    return () => {
      listeners.delete(l);
      statusListeners.delete(setSt);
      if (!listeners.size) close();
    };
  }, []);
  return st;
}

/** Restart the stream after the licence is renewed. */
export function reconnectLive(): void {
  if (!listeners.size) return;
  close();
  open();
}
