// The trust engine: count independent PEOPLE (voices), not reports.
// Pure function: the same reports and histories always give the same verdict, so it is unit-testable and
// the simulator can explain every decision. Rule letters match README.md.
import { jaccard } from "../lib/text.js";
import { TRUST, type TrustConfig } from "./config.js";

export interface TrustReport {
  reportId: string;
  reporterHash: string;
  ipHash: string | null;
  /** Keyed hash of the broader /16 block (rule B2). Optional: older rows and tests may not have it. */
  net16Hash?: string | null;
  reportedAt: number;
  occurredAt: number;
  noteLen: number;
  noteHash: string | null;
  shingles: readonly number[];
  hasScreenshot: boolean;
  lostMoney: boolean;
  personalDispute?: boolean;
  scamType: string;
  channel: string;
  pincode: string;
}

export interface ReporterHistory {
  hasOtherReports: boolean;
  corroborated: number;
  flagged: number;
  /** Other identifiers this person reported that no one else has confirmed. */
  lonely?: number;
}

export type BaseVerdict = "KNOWN_SCAM" | "SUSPICIOUS" | "NO_REPORTS";

export type Flag =
  | "SAME_REPORTER_REPEATED"
  | "SAME_NETWORK"
  | "SYBIL_RING"
  | "SUBNET_CLUSTER"
  | "COPY_PASTE_NOTES"
  | "COORDINATED_BURST"
  | "SPAM_REPEAT"
  | "PERSONAL_DISPUTE"
  | "UNCORROBORATED_REPORTER"
  | "TOO_FEW_INDEPENDENT_PEOPLE"
  | "LOW_TRUST_WEIGHT"
  | "NO_FIRST_HAND_DETAIL";

export interface VoiceSummary {
  members: string[]; // report ids
  reporters: string[];
  weight: number;
  credible: boolean; // false when the whole voice is a coordinated burst
  countable: boolean; // may feed the map and alerts
  substance: boolean;
  representative: string; // report id used for map/alerts and evidence
  flags: Flag[];
}

export interface AssessResult {
  verdict: BaseVerdict;
  voices: VoiceSummary[];
  distinctReporters: number;
  credibleVoices: number;
  weight: number;
  substanceVoices: number;
  flags: Flag[];
  countableReportIds: string[];
  reportFlags: Map<string, Flag[]>;
  corroboratedReporters: string[];
  flaggedReporters: string[];
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    let r = x;
    while (this.parent[r] !== r) r = this.parent[r] ?? r;
    let c = x;
    while (this.parent[c] !== r) {
      const next = this.parent[c] ?? r;
      this.parent[c] = r;
      c = next;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

export function reporterWeight(h: ReporterHistory | undefined, cfg: TrustConfig = TRUST): number {
  if (!h) return cfg.weightNewReporter;
  let w: number = h.corroborated > 0
    ? Math.min(cfg.weightMax, 1 + cfg.weightPerCorroboration * h.corroborated)
    : h.hasOtherReports
      ? cfg.weightReturningReporter
      : cfg.weightNewReporter;
  if ((h.lonely ?? 0) >= cfg.serialAccuserMinLonely && h.corroborated === 0) w = Math.min(w, cfg.weightSerialAccuser);
  if (h.flagged > 0) w = Math.min(w, cfg.weightFlaggedReporter);
  return w;
}

/** C. Similarity of two notes: 1 for identical text, character-shingle Jaccard otherwise, 0 for empty/short. */
function noteSimilarity(a: TrustReport, sa: ReadonlySet<number>, b: TrustReport, sb: ReadonlySet<number>, cfg: TrustConfig): number {
  if (a.noteLen === 0 || b.noteLen === 0) return 0; // empty notes are never merged by text
  if (a.noteHash && a.noteHash === b.noteHash) return 1;
  if (a.noteLen < cfg.shortNoteExactMatchBelow || b.noteLen < cfg.shortNoteExactMatchBelow) return 0;
  return jaccard(sa, sb);
}

export function assess(
  reports: readonly TrustReport[],
  histories: ReadonlyMap<string, ReporterHistory>,
  cfg: TrustConfig = TRUST,
): AssessResult {
  const n = reports.length;
  const reportFlags = new Map<string, Flag[]>();
  if (n === 0) {
    return {
      verdict: "NO_REPORTS", voices: [], distinctReporters: 0, credibleVoices: 0, weight: 0, substanceVoices: 0,
      flags: [], countableReportIds: [], reportFlags, corroboratedReporters: [], flaggedReporters: [],
    };
  }
  const flagsOf: Set<Flag>[] = reports.map(() => new Set<Flag>());
  const uf = new UnionFind(n);
  const sets = reports.map((r) => new Set(r.shingles));

  // C first: D needs to know which notes say the same thing.
  const copied = new Array<boolean>(n).fill(false);
  const textGroup = new UnionFind(n); // which notes say the same thing, whenever they were filed
  const edges: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (reports[i]!.reporterHash === reports[j]!.reporterHash) continue;
      const sim = noteSimilarity(reports[i]!, sets[i]!, reports[j]!, sets[j]!, cfg);
      if (sim >= cfg.nearDuplicateJaccard) edges.push([i, j, sim]);
    }
  }
  for (const [i, j] of edges) textGroup.union(i, j);
  if (edges.length) {
    const comp = textGroup;
    const people = new Map<number, Set<string>>();
    for (const [i, j] of edges) {
      const root = comp.find(i);
      const set = people.get(root) ?? new Set<string>();
      set.add(reports[i]!.reporterHash).add(reports[j]!.reporterHash);
      people.set(root, set);
    }
    for (const [i, j] of edges) {
      const group = people.get(comp.find(i))?.size ?? 0;
      const together = Math.abs(reports[i]!.reportedAt - reports[j]!.reportedAt) <= cfg.copyPasteWindowMs;
      if (together || group >= cfg.copyPasteGroupMin) {
        uf.union(i, j);
        copied[i] = copied[j] = true;
        flagsOf[i]!.add("COPY_PASTE_NOTES");
        flagsOf[j]!.add("COPY_PASTE_NOTES");
      }
    }
  }
  // "Described what happened": a real note, or proof. Copies are already handled by C's merging.
  // A note about a personal grudge describes a relationship, not a scam.
  const described = reports.map((r) => !r.personalDispute && (r.noteLen >= cfg.ownWordsMinChars || r.hasScreenshot || r.lostMoney));
  reports.forEach((r, i) => {
    if (r.personalDispute) flagsOf[i]!.add("PERSONAL_DISPUTE");
    const h = histories.get(r.reporterHash);
    if (h && (h.lonely ?? 0) >= cfg.serialAccuserMinLonely && h.corroborated === 0) flagsOf[i]!.add("UNCORROBORATED_REPORTER");
  });

  // A. One reporter_id is one person, however many times they report.
  const byReporter = new Map<string, number[]>();
  reports.forEach((r, i) => byReporter.set(r.reporterHash, [...(byReporter.get(r.reporterHash) ?? []), i]));
  for (const idxs of byReporter.values()) {
    for (const i of idxs.slice(1)) {
      uf.union(idxs[0]!, i);
      flagsOf[i]!.add("SAME_REPORTER_REPEATED");
      flagsOf[idxs[0]!]!.add("SAME_REPORTER_REPEATED");
    }
    // Spam: 3+ reports on this identifier from the same person within a day.
    const times = idxs.map((i) => reports[i]!.reportedAt).sort((a, b) => a - b);
    for (let s = 0, e = 0; e < times.length; e++) {
      while (times[e]! - times[s]! > cfg.spamRepeatWindowMs) s++;
      if (e - s + 1 >= cfg.spamRepeatMin) {
        for (const i of idxs) flagsOf[i]!.add("SPAM_REPEAT");
        break;
      }
    }
  }

  // B. Same ip_prefix on this identifier within 24 h is one person; 3+ accounts behind it is a sybil ring.
  const byIp = new Map<string, number[]>();
  reports.forEach((r, i) => {
    if (r.ipHash) byIp.set(r.ipHash, [...(byIp.get(r.ipHash) ?? []), i]);
  });
  for (const idxs of byIp.values()) {
    const sorted = [...idxs].sort((a, b) => reports[a]!.reportedAt - reports[b]!.reportedAt);
    let group: number[] = [];
    const flush = (): void => {
      if (group.length < 2) return;
      const people = new Set(group.map((i) => reports[i]!.reporterHash));
      if (people.size < 2) return;
      for (const i of group.slice(1)) uf.union(group[0]!, i);
      const flag: Flag = people.size >= cfg.sybilRingMinReporters ? "SYBIL_RING" : "SAME_NETWORK";
      for (const i of group) flagsOf[i]!.add(flag);
    };
    for (const i of sorted) {
      const last = group[group.length - 1];
      if (last !== undefined && reports[i]!.reportedAt - reports[last]!.reportedAt > cfg.sameNetworkWindowMs) {
        flush();
        group = [];
      }
      group.push(i);
    }
    flush();
  }

  // B2. Prefix cycling: one machine rotating fake network prefixes. Reports on this identifier from the same /16
  // block, chained within a sliding window (each report within subnetWindowMs of the previous one), that use 3+
  // different /24 prefixes from 3+ accounts are one network cluster: ONE person. Unrelated people elsewhere still
  // count, so a real wave is cross-verified by them; the cluster itself never adds more than one vote.
  if (cfg.subnetClustering) {
    const by16 = new Map<string, number[]>();
    reports.forEach((r, i) => {
      if (r.net16Hash) by16.set(r.net16Hash, [...(by16.get(r.net16Hash) ?? []), i]);
    });
    for (const idxs of by16.values()) {
      if (idxs.length < cfg.subnetMinReporters) continue;
      const sorted = [...idxs].sort((a, b) => reports[a]!.reportedAt - reports[b]!.reportedAt);
      let chain: number[] = [];
      const flush = (): void => {
        const prefixes = new Set(chain.map((i) => reports[i]!.ipHash ?? `none:${i}`));
        const people = new Set(chain.map((i) => reports[i]!.reporterHash));
        if (prefixes.size < cfg.subnetMinPrefixes || people.size < cfg.subnetMinReporters) return;
        for (const i of chain.slice(1)) uf.union(chain[0]!, i);
        for (const i of chain) flagsOf[i]!.add("SUBNET_CLUSTER");
      };
      for (const i of sorted) {
        const last = chain[chain.length - 1];
        if (last !== undefined && reports[i]!.reportedAt - reports[last]!.reportedAt > cfg.subnetWindowMs) {
          flush();
          chain = [];
        }
        chain.push(i);
      }
      flush();
    }
  }

  // D. Coordinated burst: a dense episode (6+ people within 3 h) where few people wrote in their own words or
  // most came from the same few networks. Real waves are many unrelated people writing their own stories.
  const order = reports.map((_, i) => i).sort((a, b) => reports[a]!.reportedAt - reports[b]!.reportedAt);
  const intervals: Array<[number, number]> = [];
  for (let s = 0, e = 0; s < order.length; s++) {
    if (e < s) e = s;
    while (e + 1 < order.length && reports[order[e + 1]!]!.reportedAt - reports[order[s]!]!.reportedAt <= cfg.burstWindowMs) e++;
    const people = new Set(order.slice(s, e + 1).map((i) => reports[i]!.reporterHash));
    if (people.size >= cfg.burstMinReporters) intervals.push([s, e]);
  }
  const episodes: Array<[number, number]> = [];
  for (const iv of intervals) {
    const last = episodes[episodes.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else episodes.push([iv[0], iv[1]]);
  }
  for (const [a, b] of episodes) {
    const members = order.slice(a, b + 1);
    const firstPerPerson = new Map<string, number>();
    for (const i of members) if (!firstPerPerson.has(reports[i]!.reporterHash)) firstPerPerson.set(reports[i]!.reporterHash, i);
    const reps = [...firstPerPerson.values()];
    const texts = new Set(reps.filter((i) => reports[i]!.noteLen > 0).map((i) => textGroup.find(i))).size / reps.length;
    const nets = new Set(reps.map((i) => reports[i]!.ipHash ?? `none:${i}`)).size / reps.length;
    if (texts < cfg.burstMinTextDiversity || nets < cfg.burstMinNetworkShare) {
      for (const i of members) {
        uf.union(members[0]!, i);
        flagsOf[i]!.add("COORDINATED_BURST");
      }
    }
  }

  // Build voices.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  }
  const voices: VoiceSummary[] = [];
  for (const idxs of groups.values()) {
    const vflags = new Set<Flag>();
    for (const i of idxs) for (const f of flagsOf[i]!) vflags.add(f);
    const burst = vflags.has("COORDINATED_BURST");
    const ring = vflags.has("SYBIL_RING") || vflags.has("SUBNET_CLUSTER");
    const spam = vflags.has("SPAM_REPEAT");
    // E. Weight: reputation x note x evidence; a voice is as strong as its best member, never the sum.
    let weight = 0;
    for (const i of idxs) {
      const r = reports[i]!;
      let w = reporterWeight(histories.get(r.reporterHash), cfg);
      if (r.noteLen === 0) w *= cfg.factorEmptyNote;
      if (r.hasScreenshot || r.lostMoney) w *= cfg.factorEvidence;
      if (r.personalDispute) w *= cfg.factorPersonalDispute;
      weight = Math.max(weight, w);
    }
    if (ring) weight = Math.min(weight, cfg.sybilRingWeight);
    if (burst) weight = 0;
    const rep = [...idxs].sort((a, b) => reports[a]!.occurredAt - reports[b]!.occurredAt)[0]!;
    const accounts = new Set(idxs.map((i) => reports[i]!.reporterHash)).size;
    voices.push({
      members: idxs.map((i) => reports[i]!.reportId),
      reporters: [...new Set(idxs.map((i) => reports[i]!.reporterHash))],
      weight: Math.round(weight * 1000) / 1000,
      // A voice made only of personal-dispute notes ("my ex", "owes me money") is a grudge, not a scam report: it never
      // moves a number up the public ladder, however many such voices there are.
      credible: !burst && !idxs.every((i) => reports[i]!.personalDispute),
      // One person hiding behind 3+ accounts, a burst or a spammer never feeds the map or alerts.
      countable: !burst && !ring && !spam && accounts < cfg.multiAccountVoiceMin && !idxs.every((i) => reports[i]!.personalDispute),
      substance: idxs.some((i) => described[i]),
      representative: reports[rep]!.reportId,
      flags: [...vflags],
    });
  }

  const credible = voices.filter((v) => v.credible);
  const weight = Math.round(credible.reduce((s, v) => s + v.weight, 0) * 1000) / 1000;
  const substanceVoices = credible.filter((v) => v.substance).length;
  const campaign = credible.length >= cfg.substanceAppliesFromVoices &&
    substanceVoices < Math.max(1, Math.ceil(cfg.substanceMinShare * credible.length));

  const flags = new Set<Flag>();
  for (const v of voices) for (const f of v.flags) flags.add(f);
  let verdict: BaseVerdict = "SUSPICIOUS";
  if (credible.length < cfg.knownScamMinVoices) flags.add("TOO_FEW_INDEPENDENT_PEOPLE");
  else if (weight < cfg.knownScamMinWeight) flags.add("LOW_TRUST_WEIGHT");
  else if (campaign) flags.add("NO_FIRST_HAND_DETAIL");
  else verdict = "KNOWN_SCAM";
  // A large campaign where nobody described anything is treated like a burst for the map and alerts.
  if (campaign) for (const v of voices) v.countable = false;

  reports.forEach((r, i) => reportFlags.set(r.reportId, [...flagsOf[i]!]));
  const corroborated = verdict === "KNOWN_SCAM"
    ? credible.filter((v) => !v.flags.includes("SYBIL_RING") && !v.flags.includes("SUBNET_CLUSTER")).flatMap((v) => v.reporters)
    : [];
  const flagged = voices.filter((v) => !v.credible || v.flags.includes("SYBIL_RING") || v.flags.includes("SUBNET_CLUSTER")).flatMap((v) => v.reporters);

  return {
    verdict,
    voices,
    distinctReporters: voices.length,
    credibleVoices: credible.length,
    weight,
    substanceVoices,
    flags: [...flags],
    countableReportIds: voices.filter((v) => v.countable).map((v) => v.representative),
    reportFlags,
    corroboratedReporters: [...new Set(corroborated)],
    flaggedReporters: [...new Set(flagged)],
  };
}

const FLAG_TEXT: Record<Flag, string> = {
  SAME_REPORTER_REPEATED: "the same person reported more than once",
  SAME_NETWORK: "some reports came from the same network and were counted as one person",
  SYBIL_RING: "many accounts on one network were counted as one person",
  SUBNET_CLUSTER: "accounts rotating through addresses in one network block within minutes were counted as one person",
  COPY_PASTE_NOTES: "copy-pasted descriptions were counted as one voice",
  COORDINATED_BURST: "a burst of similar reports arrived together and was set aside",
  SPAM_REPEAT: "repeated reports from one person were counted once",
  PERSONAL_DISPUTE: "a report described a personal dispute rather than a scam",
  UNCORROBORATED_REPORTER: "a reporter whose earlier reports nobody confirmed counts for less",
  TOO_FEW_INDEPENDENT_PEOPLE: "fewer than 3 unrelated people have reported it",
  LOW_TRUST_WEIGHT: "the reports so far carry low trust",
  NO_FIRST_HAND_DETAIL: "too few people described what happened",
};

export function explainFlags(flags: readonly Flag[]): string {
  return flags.map((f) => FLAG_TEXT[f]).join("; ");
}
