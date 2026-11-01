// In-process live event bus for the Live screen and map pings (Server-Sent Events).
// Events carry the AREA, scam type and channel only: never a number, ID, link, reporter or network.
import { EventEmitter } from "node:events";
import { AREA_BY_PIN } from "../../shared/areas.js";
import type { Alert } from "../alerts/alerts.js";

export type DefenceKind = "COORDINATED_BURST" | "SYBIL_RING" | "SUBNET_CLUSTER" | "COPY_PASTE_NOTES" | "SPAM_REPEAT" | "PERSONAL_DISPUTE" | "VERIFIED_TARGET" | "RATE_LIMITED";

interface Base {
  id: number;
  at: string;
  pincode: string;
  locality: string;
  locality_hi: string;
  city: string;
}
export type LiveEvent =
  | (Base & { type: "report"; scam_type: string; channel: string; counted: boolean })
  | (Base & { type: "defence"; kind: DefenceKind; scam_type: string; reports: number; people: number })
  | (Base & { type: "alert"; alert: Alert })
  | (Base & { type: "classified"; scam_type: string; from: string; language: string; outcome: "changed" | "confirmed" });

export type LiveInput =
  | { type: "report"; pincode: string; scam_type: string; channel: string; counted: boolean }
  | { type: "defence"; pincode: string; kind: DefenceKind; scam_type: string; reports: number; people: number; key: string }
  | { type: "alert"; pincode: string; alert: Alert }
  | { type: "classified"; pincode: string; scam_type: string; from: string; language: string; outcome: "changed" | "confirmed" };

export class LiveBus {
  private readonly emitter = new EventEmitter();
  private readonly backlog: LiveEvent[] = [];
  private seq = 0;
  private readonly lastDefence = new Map<string, number>();
  private readonly knownAlerts = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {
    this.emitter.setMaxListeners(10_000);
  }

  publish(input: LiveInput): void {
    // One attack produces many reports: show it at most once every 3 minutes per target and kind.
    if (input.type === "defence") {
      const k = `${input.key}|${input.kind}`;
      const last = this.lastDefence.get(k) ?? 0;
      if (this.now() - last < 3 * 60_000) return;
      this.lastDefence.set(k, this.now());
      if (this.lastDefence.size > 20_000) this.lastDefence.clear();
    }
    if (input.type === "alert") {
      const a = input.alert;
      const k = `${a.pincode}|${a.type}|${a.type === "NEW_TYPE" ? a.scam_type : ""}|${new Date(this.now()).toISOString().slice(0, 10)}`;
      if (this.knownAlerts.has(k)) return;
      this.knownAlerts.add(k);
      if (this.knownAlerts.size > 5000) this.knownAlerts.clear();
    }
    const area = AREA_BY_PIN.get(input.pincode);
    const base: Base = {
      id: ++this.seq, at: new Date(this.now()).toISOString(), pincode: input.pincode,
      locality: area?.locality ?? input.pincode, locality_hi: area?.localityHi ?? input.pincode, city: area?.city ?? "",
    };
    let event: LiveEvent;
    if (input.type === "report") event = { ...base, type: "report", scam_type: input.scam_type, channel: input.channel, counted: input.counted };
    else if (input.type === "defence") event = { ...base, type: "defence", kind: input.kind, scam_type: input.scam_type, reports: input.reports, people: input.people };
    else if (input.type === "classified") event = { ...base, type: "classified", scam_type: input.scam_type, from: input.from, language: input.language, outcome: input.outcome };
    else event = { ...base, type: "alert", alert: input.alert };
    this.backlog.push(event);
    if (this.backlog.length > 60) this.backlog.shift();
    this.emitter.emit("event", event);
  }

  /** Alerts already active when the server starts should not be announced as new. */
  markKnown(alerts: readonly Alert[]): void {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    for (const a of alerts) this.knownAlerts.add(`${a.pincode}|${a.type}|${a.type === "NEW_TYPE" ? a.scam_type : ""}|${day}`);
  }

  recent(): LiveEvent[] {
    return [...this.backlog];
  }

  subscribe(fn: (e: LiveEvent) => void): () => void {
    this.emitter.on("event", fn);
    return () => this.emitter.off("event", fn);
  }

  clear(): void {
    this.backlog.length = 0;
    this.lastDefence.clear();
    this.knownAlerts.clear();
  }
}
