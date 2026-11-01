// Loads what the campaign graph needs. Only identifiers that already show publicly (Suspicious or Known scam,
// i.e. 2+ unrelated people) are included, so a campaign can never reveal a number that one person reported.
import { z } from "zod";
import { registrableDomain } from "../../shared/risk.js";
import type { IdentifierType } from "../../shared/normalize.js";
import type { Gemini } from "../ai/gemini.js";
import type { Pool } from "../db/db.js";
import { hmacHex } from "../lib/hmac.js";
import type { ScamService } from "../services/scamService.js";
import { publicVerdict, type StoredAssessment } from "../services/view.js";
import { buildCampaigns, buildNetwork, hostEdges, templateEdges, type Campaign, type Edge, type HostNode, type IdentNode } from "./graph.js";

export class CampaignService {
  private cache: { at: number; campaigns: Campaign[]; network: ReturnType<typeof buildNetwork> } | null = null;
  private stories = new Map<string, { at: number; value: { story_en: string; story_hi: string; source: "gemini" | "rules" } }>();

  constructor(private readonly pool: Pool, private readonly service: ScamService, private readonly pepper: string) {}

  private idOf = (key: string): string => `n${hmacHex(this.pepper, "node", key).slice(0, 10)}`;

  invalidate(): void {
    this.cache = null;
  }

  async load(now: number): Promise<{ campaigns: Campaign[]; network: ReturnType<typeof buildNetwork> }> {
    if (this.cache && now - this.cache.at < 30_000) return this.cache;
    const idents = (await this.pool.query<{ ident_key: string; identifier_type: IdentifierType; normalized: string; assessment: StoredAssessment }>(
      `SELECT ident_key, identifier_type, normalized, assessment FROM identifiers
        WHERE assessment IS NOT NULL AND (assessment->>'credible_voices')::int >= 2 AND updated_at > now() - interval '45 days'`,
    )).rows;
    const nodes: IdentNode[] = [];
    const keys: string[] = [];
    for (const i of idents) {
      const v = publicVerdict(i.assessment, this.service.verifiedOwner(i.ident_key), this.service.isChallenged(i.ident_key));
      if (v !== "KNOWN_SCAM" && v !== "SUSPICIOUS") continue;
      keys.push(i.ident_key);
      nodes.push({ key: i.ident_key, type: i.identifier_type, value: i.normalized, verdict: v, people: i.assessment.distinct_reporters, scam_type: i.assessment.scam_type, first_seen: 0, last_seen: 0, channels: [], lost_money: 0, areas: [] });
    }
    if (keys.length) {
      const areaRows = (await this.pool.query<{ ident_key: string; pincode: string; f: Date; l: Date }>(
        `SELECT ident_key, pincode, min(occurred_at) AS f, max(occurred_at) AS l FROM reports
          WHERE ident_key = ANY($1::text[]) AND countable GROUP BY 1, 2`,
        [keys],
      )).rows;
      const meta = (await this.pool.query<{ ident_key: string; channels: string[]; lost: number; f: Date; l: Date }>(
        `SELECT ident_key, array_agg(DISTINCT channel) AS channels, count(*) FILTER (WHERE lost_money)::int AS lost, min(occurred_at) AS f, max(occurred_at) AS l
           FROM reports WHERE ident_key = ANY($1::text[]) GROUP BY 1`,
        [keys],
      )).rows;
      const byKey = new Map(nodes.map((n) => [n.key, n]));
      for (const m of meta) {
        const n = byKey.get(m.ident_key)!;
        n.channels = m.channels;
        n.lost_money = m.lost;
        n.first_seen = new Date(m.f).getTime();
        n.last_seen = new Date(m.l).getTime();
      }
      for (const a of areaRows) byKey.get(a.ident_key)?.areas.push({ pincode: a.pincode, first: new Date(a.f).getTime() });
    }
    const edges: Edge[] = [];
    if (keys.length) {
      const co = (await this.pool.query<{ a: string; b: string; c: number }>(
        "SELECT a, b, count(*)::int AS c FROM ident_links WHERE a = ANY($1::text[]) AND b = ANY($1::text[]) GROUP BY 1, 2",
        [keys],
      )).rows;
      for (const r of co) edges.push({ a: r.a, b: r.b, kind: "co_reported", weight: r.c });
      const notes = (await this.pool.query<{ ident_key: string; scam_type: string; note_shingles: number[] }>(
        `SELECT ident_key, scam_type, note_shingles FROM (
           SELECT ident_key, scam_type, note_shingles, row_number() OVER (PARTITION BY ident_key ORDER BY occurred_at DESC) AS rn
             FROM reports WHERE ident_key = ANY($1::text[]) AND countable AND note_len >= 40 AND occurred_at > now() - interval '45 days') t
          WHERE rn <= 12`,
        [keys],
      )).rows;
      edges.push(...templateEdges(notes.map((n) => ({ key: n.ident_key, scam_type: n.scam_type, shingles: n.note_shingles }))));
    }
    const urlDomains = new Map<string, string>();
    for (const n of nodes) {
      if (n.type !== "url") continue;
      try {
        urlDomains.set(n.key, registrableDomain(new URL(n.value).hostname));
      } catch {
        /* skip */
      }
    }
    const hosts = new Map<string, HostNode>();
    if (urlDomains.size) {
      const rows = (await this.pool.query<HostNode>("SELECT domain, ips, network FROM host_info WHERE domain = ANY($1::text[])", [[...urlDomains.values()]])).rows;
      for (const h of rows) hosts.set(h.domain, h);
      edges.push(...hostEdges([...urlDomains.entries()].map(([key, domain]) => ({ key, domain })), hosts));
    }
    const campaigns = buildCampaigns(nodes, edges, now, this.idOf).slice(0, 30);
    const campaignOf = new Map<string, string>();
    for (const c of campaigns) for (const i of c.identifiers) campaignOf.set(i.key, c.id);
    // campaignOf is keyed by graph id; buildNetwork wants ident keys, so translate.
    const byIdent = new Map<string, string>();
    for (const n of nodes) {
      const cid = campaignOf.get(this.idOf(n.key));
      if (cid) byIdent.set(n.key, cid);
    }
    const network = buildNetwork(nodes, edges, hosts, urlDomains, byIdent, this.idOf);
    this.cache = { at: now, campaigns, network };
    return this.cache;
  }

  async story(c: Campaign, gemini: Gemini): Promise<{ story_en: string; story_hi: string; source: "gemini" | "rules" }> {
    const hit = this.stories.get(c.id);
    if (hit && Date.now() - hit.at < 15 * 60_000) return hit.value;
    const spread = c.spread.map((s) => `${s.locality} (${s.city}) ${s.first.slice(0, 10)}`).join(" -> ");
    const fallback = {
      story_en: `${c.people} people reported this campaign. It reached ${c.spread.length} areas: ${c.spread.slice(0, 4).map((s) => s.locality).join(", ")}. ${c.chain.slice(1, 4).map((s) => s.detail_en).join(". ")}.`,
      story_hi: `${c.people} लोगों ने इस अभियान की रिपोर्ट की। यह ${c.spread.length} इलाक़ों तक पहुँचा: ${c.spread.slice(0, 4).map((s) => s.locality_hi).join(", ")}। ${c.chain.slice(1, 4).map((s) => s.detail_hi).join("। ")}।`,
      source: "rules" as const,
    };
    let value: { story_en: string; story_hi: string; source: "gemini" | "rules" } = fallback;
    if (gemini.enabled) {
      const facts = {
        scam_types: c.scam_types, people: c.people, identifiers_by_type: c.counts, channels: c.channels, spread, lost_money_reports: c.lost_money_reports,
        first_seen: c.first_seen, last_seen: c.last_seen, stages: c.chain.map((s) => `${s.en}: ${s.detail_en}`),
      };
      const res = await gemini.json(
        "You write a 3-sentence 'attack story' of a scam campaign for residents in India, from aggregated facts only. Say 'reported', never accuse a person. No numbers or IDs. Write Hindi in Devanagari.",
        `<campaign>\n${JSON.stringify(facts)}\n</campaign>`,
        { type: "object", properties: { story_en: { type: "string" }, story_hi: { type: "string" } }, required: ["story_en", "story_hi"] },
        (v) => {
          const p = z.object({ story_en: z.string().max(800), story_hi: z.string().max(800) }).safeParse(v);
          return p.success ? p.data : null;
        },
      );
      if (res) value = { ...res.data, source: "gemini" };
    }
    this.stories.set(c.id, { at: Date.now(), value });
    return value;
  }
}
