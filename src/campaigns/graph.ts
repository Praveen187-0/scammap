// Scam network and campaigns. Identifiers (numbers, UPI IDs, links, senders) are linked when they appear in the
// same report (one pasted message), when victims of different identifiers paste the same scam text (same
// template), or when links are hosted on the same server. Connected groups are campaigns; each gets a kill chain
// and a spread timeline. Pure functions: the database work is in service.ts.
import { AREA_BY_PIN } from "../../shared/areas.js";
import { CASHOUT, PLAYBOOK, STAGES, type StageKey } from "../../shared/killchain.js";
import { maskValue, type IdentifierType } from "../../shared/normalize.js";
import { SCAM_TYPE_BY_SLUG } from "../../shared/scamTypes.js";

export interface IdentNode {
  key: string;
  type: IdentifierType;
  value: string;
  verdict: "KNOWN_SCAM" | "SUSPICIOUS";
  people: number;
  scam_type: string | null;
  first_seen: number;
  last_seen: number;
  channels: string[];
  lost_money: number;
  /** First time this identifier was reported in each area. */
  areas: Array<{ pincode: string; first: number }>;
}
export type EdgeKind = "co_reported" | "same_template" | "same_host";
export interface Edge {
  a: string;
  b: string;
  kind: EdgeKind;
  weight: number;
}
export interface HostNode {
  domain: string;
  ips: string[];
  network: string | null;
}

class DSU {
  private p = new Map<string, string>();
  find(x: string): string {
    if (!this.p.has(x)) this.p.set(x, x);
    let r = x;
    while (this.p.get(r) !== r) r = this.p.get(r)!;
    let c = x;
    while (this.p.get(c) !== r) {
      const n = this.p.get(c)!;
      this.p.set(c, r);
      c = n;
    }
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.p.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
}

export function jaccard(a: readonly number[], b: readonly number[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  let inter = 0;
  for (const x of new Set(b)) if (sa.has(x)) inter++;
  return inter / (sa.size + new Set(b).size - inter);
}

/** Template edges: reports on DIFFERENT identifiers whose notes share most of their character shingles. */
export function templateEdges(notes: ReadonlyArray<{ key: string; scam_type: string; shingles: number[] }>, threshold = 0.5): Edge[] {
  const byType = new Map<string, typeof notes[number][]>();
  for (const n of notes) if (n.shingles.length >= 12) byType.set(n.scam_type, [...(byType.get(n.scam_type) ?? []), n]);
  const pair = new Map<string, number>();
  for (const list of byType.values()) {
    const capped = list.slice(0, 1500);
    for (let i = 0; i < capped.length; i++) {
      for (let j = i + 1; j < capped.length; j++) {
        const x = capped[i]!, y = capped[j]!;
        if (x.key === y.key) continue;
        if (jaccard(x.shingles, y.shingles) < threshold) continue;
        const k = x.key < y.key ? `${x.key}\u0000${y.key}` : `${y.key}\u0000${x.key}`;
        pair.set(k, (pair.get(k) ?? 0) + 1);
      }
    }
  }
  return [...pair.entries()].map(([k, w]) => {
    const [a, b] = k.split("\u0000") as [string, string];
    return { a, b, kind: "same_template" as const, weight: w };
  });
}

export function hostEdges(urlKeys: ReadonlyArray<{ key: string; domain: string }>, hosts: ReadonlyMap<string, HostNode>): Edge[] {
  const byIp = new Map<string, string[]>();
  for (const u of urlKeys) for (const ip of hosts.get(u.domain)?.ips ?? []) byIp.set(ip, [...(byIp.get(ip) ?? []), u.key]);
  const out: Edge[] = [];
  for (const keys of byIp.values()) {
    const uniq = [...new Set(keys)];
    for (let i = 1; i < uniq.length; i++) out.push({ a: uniq[0]!, b: uniq[i]!, kind: "same_host", weight: 1 });
  }
  return out;
}

export interface Campaign {
  id: string;
  title_en: string;
  title_hi: string;
  status: "active" | "quiet";
  people: number;
  identifiers: Array<{ key: string; type: IdentifierType; display: string; verdict: string; people: number }>;
  counts: Record<IdentifierType, number>;
  scam_types: Array<{ slug: string; count: number }>;
  channels: string[];
  first_seen: string;
  last_seen: string;
  lost_money_reports: number;
  spread: Array<{ pincode: string; locality: string; locality_hi: string; city: string; first: string }>;
  cities: string[];
  links: Array<{ a: string; b: string; kind: EdgeKind; weight: number }>;
  chain: Array<{ key: StageKey; en: string; hi: string; detail_en: string; detail_hi: string; identifiers: string[] }>;
}

const shown = (n: IdentNode): string => (n.verdict === "KNOWN_SCAM" ? n.value : maskValue(n.type, n.value));

export function buildCampaigns(nodes: readonly IdentNode[], edges: readonly Edge[], now: number, idOf: (key: string) => string): Campaign[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const dsu = new DSU();
  // Campaigns are joined only by strong evidence: identifiers seen in the same message, or links on the same
  // server. Similar wording is weaker (victims describe the same kind of scam alike), so it is shown in the network
  // view but never merges campaigns on its own.
  const usable = edges.filter((e) => byKey.has(e.a) && byKey.has(e.b) && e.kind !== "same_template");
  for (const e of usable) dsu.union(e.a, e.b);
  const groups = new Map<string, IdentNode[]>();
  for (const n of nodes) {
    const r = dsu.find(n.key);
    groups.set(r, [...(groups.get(r) ?? []), n]);
  }
  const out: Campaign[] = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const memberSet = new Set(members.map((m) => m.key));
    const types = new Map<string, number>();
    for (const m of members) if (m.scam_type) types.set(m.scam_type, (types.get(m.scam_type) ?? 0) + m.people);
    const scamTypes = [...types.entries()].sort((a, b) => b[1] - a[1]).map(([slug, count]) => ({ slug, count }));
    const main = scamTypes[0]?.slug ?? "other";
    const info = SCAM_TYPE_BY_SLUG.get(main) ?? SCAM_TYPE_BY_SLUG.get("other");
    const firstByArea = new Map<string, number>();
    for (const m of members) for (const a of m.areas) firstByArea.set(a.pincode, Math.min(firstByArea.get(a.pincode) ?? Infinity, a.first));
    const spread = [...firstByArea.entries()].sort((a, b) => a[1] - b[1]).map(([pincode, first]) => {
      const area = AREA_BY_PIN.get(pincode);
      return { pincode, locality: area?.locality ?? pincode, locality_hi: area?.localityHi ?? pincode, city: area?.city ?? "", first: new Date(first).toISOString() };
    });
    const cities = [...new Set(spread.map((s) => s.city))];
    const first = Math.min(...members.map((m) => m.first_seen));
    const last = Math.max(...members.map((m) => m.last_seen));
    const counts = { phone: 0, upi: 0, url: 0, sender_id: 0 } as Record<IdentifierType, number>;
    for (const m of members) counts[m.type]++;
    const channels = [...new Set(members.flatMap((m) => m.channels))];
    const pb = PLAYBOOK[main] ?? PLAYBOOK.other!;
    const ids = (pred: (m: IdentNode) => boolean): string[] => members.filter(pred).map(shown);
    const contactIds = ids((m) => m.type === "phone" || m.type === "sender_id");
    const chain = STAGES.map((s) => {
      if (s.key === "contact") {
        const ch = channels.length ? channels.join(", ") : "SMS or calls";
        return { ...s, detail_en: `Through ${ch}`, detail_hi: `${ch} के ज़रिए`, identifiers: contactIds };
      }
      if (s.key === "cashout") {
        const lost = members.reduce((t, m) => t + m.lost_money, 0);
        return { ...s, detail_en: `${CASHOUT[0]}. ${lost} reports say money was lost.`, detail_hi: `${CASHOUT[1]}। ${lost} रिपोर्ट में पैसे गए।`, identifiers: [] };
      }
      const [en, hi] = pb[s.key];
      return { ...s, detail_en: en, detail_hi: hi, identifiers: s.key === "hook" ? ids((m) => m.type === "url") : s.key === "payment" ? ids((m) => m.type === "upi") : [] };
    });
    const cityText = cities.length > 1 ? `${cities[0]} to ${cities[cities.length - 1]}` : cities[0] ?? "";
    out.push({
      id: idOf(root),
      title_en: `${info?.en ?? "Scam"} campaign${cityText ? `, ${cityText}` : ""}`,
      title_hi: `${info?.hi ?? "स्कैम"} अभियान${cityText ? `, ${cityText}` : ""}`,
      status: now - last < 48 * 3_600_000 ? "active" : "quiet",
      people: members.reduce((t, m) => t + m.people, 0),
      identifiers: members.sort((a, b) => b.people - a.people).map((m) => ({ key: idOf(m.key), type: m.type, display: shown(m), verdict: m.verdict, people: m.people })),
      counts, scam_types: scamTypes, channels,
      first_seen: new Date(first).toISOString(), last_seen: new Date(last).toISOString(),
      lost_money_reports: members.reduce((t, m) => t + m.lost_money, 0),
      spread, cities,
      links: usable.filter((e) => memberSet.has(e.a)).map((e) => ({ a: idOf(e.a), b: idOf(e.b), kind: e.kind, weight: e.weight })),
      chain,
    });
  }
  return out.sort((a, b) => (a.status === b.status ? b.people - a.people : a.status === "active" ? -1 : 1));
}

/** The whole scam network for the graph view: identifiers, hosting servers, and the links between them. */
export function buildNetwork(nodes: readonly IdentNode[], edges: readonly Edge[], hosts: ReadonlyMap<string, HostNode>, urlDomains: ReadonlyMap<string, string>, campaignOf: ReadonlyMap<string, string>, idOf: (key: string) => string) {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const out = {
    nodes: [] as Array<{ id: string; kind: IdentifierType | "host"; label: string; verdict?: string; people?: number; scam_type?: string | null; campaign?: string | null; network?: string | null }>,
    links: [] as Array<{ source: string; target: string; kind: EdgeKind | "hosted_on" }>,
  };
  for (const n of nodes) out.nodes.push({ id: idOf(n.key), kind: n.type, label: shown(n), verdict: n.verdict, people: n.people, scam_type: n.scam_type, campaign: campaignOf.get(n.key) ?? null });
  // Similar wording is drawn only for the strongest pairs (at most 2 per identifier), so the graph stays readable.
  const tdeg = new Map<string, number>();
  const sorted = [...edges].sort((x, y) => (x.kind === y.kind ? y.weight - x.weight : x.kind === "co_reported" ? -1 : 1));
  for (const e of sorted) {
    if (!byKey.has(e.a) || !byKey.has(e.b) || e.kind === "same_host") continue;
    if (e.kind === "same_template") {
      if (e.weight < 2 || (tdeg.get(e.a) ?? 0) >= 2 || (tdeg.get(e.b) ?? 0) >= 2) continue;
      tdeg.set(e.a, (tdeg.get(e.a) ?? 0) + 1);
      tdeg.set(e.b, (tdeg.get(e.b) ?? 0) + 1);
    }
    out.links.push({ source: idOf(e.a), target: idOf(e.b), kind: e.kind });
  }
  const seenHost = new Set<string>();
  for (const [key, domain] of urlDomains) {
    const h = hosts.get(domain);
    if (!h || !byKey.has(key) || !h.ips.length) continue;
    const hid = `host:${h.ips[0]}`;
    if (!seenHost.has(hid)) {
      seenHost.add(hid);
      out.nodes.push({ id: hid, kind: "host", label: h.ips[0]!, network: h.network });
    }
    out.links.push({ source: idOf(key), target: hid, kind: "hosted_on" });
  }
  return out;
}
