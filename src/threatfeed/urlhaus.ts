// Layer B of the map: a live feed of malicious URLs from URLhaus (abuse.ch, https://urlhaus.abuse.ch), fetched by the
// SERVER every 5 minutes (abuse.ch asks for no more than that), so the Auth-Key never reaches the browser and the app
// works without CORS problems. Each URL is placed approximately:
//   - an IP address: the country its address block is registered to (RDAP, via rdap.org), cached;
//   - a domain with a country ending (.ru, .in, .br): that country;
//   - a generic or vanity ending (.com, .xyz, .io): the DNS address it resolves to, then as for an IP.
// We never open the malicious URLs: only DNS lookups and registry (RDAP) queries are made. URLs are shown DEFANGED
// (hxxp, [.]) and never as links. This is public threat data: there is no personal data in it.
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { logInfo, logWarn } from "../log.js";
import { COUNTRIES, countryFromTld, ringPosition } from "./geo.js";

export interface ThreatItem {
  id: string;
  /** Defanged, never clickable: hxxp://evil[.]example/... (path cut short). */
  display: string;
  host: string;
  threat: string;
  tags: string[];
  status: "online" | "offline" | "unknown";
  added: string;
  country: string | null;
  country_name: string | null;
  located_by: "domain" | "ip" | "hosting" | null;
  lat: number | null;
  lng: number | null;
  /** The URLhaus page about this URL (safe to open: it is abuse.ch's own page). */
  reference: string | null;
}

export interface FeedStatus {
  enabled: boolean;
  connected: boolean;
  reason: string | null;
  source: string;
  last_fetch: string | null;
  next_fetch: string | null;
  fetched: number;
  located: number;
}

export interface ThreatFeedConfig {
  authKey: string | null;
  enabled: boolean;
  apiBase: string;
  rdapBase: string;
  pollMs: number;
  limit: number;
  resolveDns: boolean;
  lookupsPerRefresh: number;
}

interface RawUrl {
  id?: string | number;
  url?: string;
  url_status?: string;
  host?: string;
  date_added?: string;
  threat?: string;
  tags?: string[] | null;
  urlhaus_reference?: string;
}

export function defang(url: string): string {
  let u = url.trim().replace(/^http/i, "hxxp");
  const m = /^(hxxps?:\/\/)([^/?#]+)(.*)$/i.exec(u);
  if (m) {
    const host = m[2]!.replace(/\./g, "[.]");
    const rest = m[3]!.length > 28 ? `${m[3]!.slice(0, 27)}…` : m[3]!;
    u = `${m[1]}${host}${rest}`;
  } else u = u.replace(/\./g, "[.]");
  return u.slice(0, 90);
}

function hostOf(raw: RawUrl): string {
  if (raw.host) return raw.host.toLowerCase().replace(/^\[|\]$/g, "");
  try {
    return new URL(raw.url ?? "").hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Small pool so registry lookups never flood anyone: N at a time. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x);
  }));
}

export class ThreatFeed {
  private items: ThreatItem[] = [];
  private seen = new Set<string>();
  private ipCountry = new Map<string, { code: string | null; at: number }>();
  private hostIp = new Map<string, { ip: string | null; at: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private state = { connected: false, reason: null as string | null, lastFetch: 0, fetched: 0 };

  constructor(private readonly cfg: ThreatFeedConfig) {
    if (!cfg.enabled) this.state.reason = "switched off (THREAT_FEED=off)";
    else if (!cfg.authKey) this.state.reason = "set URLHAUS_AUTH_KEY in .env (free key: https://auth.abuse.ch/)";
  }

  start(): void {
    if (!this.cfg.enabled || !this.cfg.authKey || this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.cfg.pollMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(): FeedStatus {
    return {
      enabled: this.cfg.enabled && Boolean(this.cfg.authKey),
      connected: this.state.connected,
      reason: this.state.reason,
      source: "URLhaus by abuse.ch",
      last_fetch: this.state.lastFetch ? new Date(this.state.lastFetch).toISOString() : null,
      next_fetch: this.state.lastFetch && this.timer ? new Date(this.state.lastFetch + this.cfg.pollMs).toISOString() : null,
      fetched: this.state.fetched,
      located: this.items.filter((i) => i.lat !== null).length,
    };
  }

  /** Newest first. `since` = the newest id the client already has, to fetch only what is new. */
  list(since?: string | null, max = 300): ThreatItem[] {
    const out: ThreatItem[] = [];
    for (const it of this.items) {
      if (since && it.id === since) break;
      out.push(it);
      if (out.length >= max) break;
    }
    return out;
  }

  countries(): Array<{ code: string; name: string; count: number }> {
    const m = new Map<string, number>();
    for (const it of this.items) if (it.country) m.set(it.country, (m.get(it.country) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, name: COUNTRIES.get(code)?.name ?? code, count }));
  }

  async refresh(): Promise<void> {
    if (!this.cfg.authKey) return;
    let raw: RawUrl[];
    try {
      const res = await fetch(`${this.cfg.apiBase.replace(/\/+$/, "")}/urls/recent/limit/${this.cfg.limit}/`, {
        headers: { "Auth-Key": this.cfg.authKey, accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 401 || res.status === 403) throw new Error("URLhaus refused the Auth-Key (check URLHAUS_AUTH_KEY)");
      if (!res.ok) throw new Error(`URLhaus answered HTTP ${res.status}`);
      const body = (await res.json()) as { query_status?: string; urls?: RawUrl[] };
      if (body.query_status && body.query_status !== "ok") throw new Error(`URLhaus: ${body.query_status}`);
      raw = body.urls ?? [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== this.state.reason) logWarn(`global threat feed: ${msg}`);
      this.state = { ...this.state, connected: false, reason: msg, lastFetch: Date.now() };
      return;
    }
    const fresh = raw.filter((r) => r.id !== undefined && r.url && !this.seen.has(String(r.id)));
    const items = fresh.map((r) => this.toItem(r));
    // New URLs first; earlier ones that couldn't be placed yet get another try with what is left of the budget.
    await this.locate([...items, ...this.items.filter((i) => i.lat === null && i.located_by === null).slice(0, 100)]);
    for (const it of items) this.seen.add(it.id);
    // Newest first, capped. Items are sorted by when URLhaus added them.
    this.items = [...items, ...this.items].sort((a, b) => b.added.localeCompare(a.added) || Number(b.id) - Number(a.id)).slice(0, 500);
    if (this.seen.size > 20_000) this.seen = new Set(this.items.map((i) => i.id));
    this.state = { connected: true, reason: null, lastFetch: Date.now(), fetched: this.state.fetched + items.length };
    logInfo("global threat feed updated", { new_urls: items.length, located: items.filter((i) => i.lat !== null).length });
  }

  private toItem(r: RawUrl): ThreatItem {
    const host = hostOf(r);
    const added = r.date_added ? new Date(r.date_added.replace(" UTC", "Z").replace(" ", "T")) : new Date();
    const status = r.url_status === "online" || r.url_status === "offline" ? r.url_status : "unknown";
    return {
      id: String(r.id),
      display: defang(r.url ?? ""),
      host: host.replace(/\./g, "[.]"),
      threat: (r.threat ?? "malware_download").replace(/_/g, " "),
      tags: (r.tags ?? []).filter((t): t is string => typeof t === "string").slice(0, 3),
      status,
      added: Number.isNaN(added.getTime()) ? new Date().toISOString() : added.toISOString(),
      country: null,
      country_name: null,
      located_by: null,
      lat: null,
      lng: null,
      reference: r.urlhaus_reference && /^https:\/\/urlhaus\.abuse\.ch\//.test(r.urlhaus_reference) ? r.urlhaus_reference : null,
    };
  }

  /** Country for each item: domain ending first, else the registry country of its IP (direct, or via DNS). */
  private async locate(items: ThreatItem[]): Promise<void> {
    const needIp = new Map<string, ThreatItem[]>();
    const needDns = new Map<string, ThreatItem[]>();
    for (const it of items) {
      const host = it.host.replace(/\[\.\]/g, ".");
      if (isIP(host)) needIp.set(host, [...(needIp.get(host) ?? []), it]);
      else {
        const cc = countryFromTld(host);
        if (cc) this.place(it, cc, "domain");
        else if (this.cfg.resolveDns) needDns.set(host, [...(needDns.get(host) ?? []), it]);
      }
    }
    let budget = this.cfg.lookupsPerRefresh;
    // Generic endings: one DNS lookup per host (never a connection to the host itself).
    await pool([...needDns.keys()].slice(0, budget), 6, async (host) => {
      const cached = this.hostIp.get(host);
      let ip = cached && Date.now() - cached.at < 6 * 3_600_000 ? cached.ip : undefined;
      if (ip === undefined) {
        ip = await Promise.race([dns.resolve4(host).then((a) => a[0] ?? null), new Promise<null>((r) => setTimeout(() => r(null), 2500))]).catch(() => null);
        this.hostIp.set(host, { ip, at: Date.now() });
      }
      if (ip) for (const it of needDns.get(host) ?? []) needIp.set(ip, [...(needIp.get(ip) ?? []), { ...it, located_by: "hosting" } as ThreatItem]);
    });
    // IPs: registry country (RDAP), cached for a week, a few at a time.
    const ips = [...needIp.keys()];
    await pool(ips, 4, async (ip) => {
      let entry = this.ipCountry.get(ip);
      if (!entry || Date.now() - entry.at > 7 * 86_400_000) {
        if (budget-- <= 0) return;
        entry = { code: await this.rdapCountry(ip), at: Date.now() };
        this.ipCountry.set(ip, entry);
      }
      if (!entry.code) return;
      for (const it of needIp.get(ip) ?? []) {
        const target = items.find((x) => x.id === it.id) ?? it;
        this.place(target, entry.code, it.located_by === "hosting" ? "hosting" : "ip");
      }
    });
    if (this.ipCountry.size > 50_000) this.ipCountry.clear();
    if (this.hostIp.size > 50_000) this.hostIp.clear();
  }

  private place(it: ThreatItem, code: string, how: ThreatItem["located_by"]): void {
    const pos = ringPosition(it.id, code);
    if (!pos) return;
    it.country = code;
    it.country_name = COUNTRIES.get(code)?.name ?? code;
    it.located_by = how;
    [it.lat, it.lng] = pos;
  }

  /** Country an IP block is registered to. Only the country is read from the registry answer. */
  private async rdapCountry(ip: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.cfg.rdapBase.replace(/\/+$/, "")}/ip/${encodeURIComponent(ip)}`, {
        headers: { accept: "application/rdap+json" },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { country?: string; port43?: string };
      const cc = (body.country ?? "").toUpperCase();
      if (COUNTRIES.has(cc)) return cc;
      // ARIN answers without a country; its blocks are almost all in the United States.
      if ((body.port43 ?? "").includes("arin")) return "US";
      return null;
    } catch {
      return null;
    }
  }
}
