// Safe "live visit" of a reported link, like a DAST scan for one URL. It reads the page; it never runs its scripts,
// never submits forms, never sends cookies. Protections against being used to reach internal systems (SSRF): only
// http/https on ports 80/443, every hop's DNS answer is checked against private and reserved ranges, and the
// connection is pinned to the checked address (no DNS-rebinding). Max 5 redirects, 6 s per hop, 1 MB per page.
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { TLSSocket } from "node:tls";
import { isIP } from "node:net";
import { normalizeUrl } from "../../shared/normalize.js";
import { analyzeUrl, registrableDomain } from "../../shared/risk.js";
import type { Pool } from "../db/db.js";
import { analyzeHtml, correlate, type Correlation, type Evidence, type LinkVerdict, type LiveFacts } from "./analyze.js";

export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

export interface ScanResult {
  url: string;
  scanned_at: string;
  cached: boolean;
  verdict: LinkVerdict;
  score: number;
  static_score: number;
  static_signals: Array<{ id: string; en: string; hi: string }>;
  live: LiveFacts;
  evidence: Evidence[];
  correlations: Correlation[];
  hosting: { ips: string[]; network: string | null } | null;
}

interface Hop {
  status: number;
  location: string | null;
  contentType: string | null;
  body: string;
  tls: LiveFacts["tls"];
}

const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36 ScamMap-LinkCheck";

function fetchPinned(u: URL, ip: string, timeoutMs: number): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const secure = u.protocol === "https:";
    const opts: https.RequestOptions = {
      host: ip,
      port: u.port || (secure ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: "GET",
      headers: { host: u.host, "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.5", "accept-language": "en-IN,en;q=0.8" },
      timeout: timeoutMs,
      ...(secure ? { servername: isIP(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false } : {}),
    };
    const req = (secure ? https : http).request(opts, (res) => {
      let tls: LiveFacts["tls"] = null;
      if (secure) {
        const sock = res.socket as TLSSocket;
        const cert = sock.getPeerCertificate?.();
        const from = cert?.valid_from ? new Date(cert.valid_from) : null;
        tls = {
          valid: sock.authorized === true,
          issuer: cert?.issuer ? String((cert.issuer as unknown as Record<string, string>).O ?? (cert.issuer as unknown as Record<string, string>).CN ?? "") || null : null,
          valid_from: from ? from.toISOString() : null,
          age_days: from ? Math.max(0, Math.floor((Date.now() - from.getTime()) / 86_400_000)) : null,
        };
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const ct = String(res.headers["content-type"] ?? "") || null;
      const isText = !ct || /text|html|xml|json/i.test(ct);
      res.on("data", (c: Buffer) => {
        if (!isText) return;
        size += c.length;
        if (size <= 1_000_000) chunks.push(c);
        else res.destroy();
      });
      const done = (): void => resolve({ status: res.statusCode ?? 0, location: typeof res.headers.location === "string" ? res.headers.location : null, contentType: ct, body: Buffer.concat(chunks).toString("utf8"), tls });
      res.on("end", done);
      res.on("close", done);
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function resolveSafe(host: string, allowPrivate: boolean): Promise<string[]> {
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (!ips.length) throw new Error("no address");
  if (!allowPrivate && ips.some(isPrivateIp)) throw Object.assign(new Error("blocked"), { blocked: true });
  return ips;
}

async function rdapDomainAgeDays(domain: string, timeoutMs: number): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { signal: ctrl.signal, headers: { accept: "application/rdap+json" } });
    clearTimeout(t);
    if (!res.ok) return null;
    // Only the registration date is read. Registrant contact details in RDAP are ignored and never stored.
    const body = (await res.json()) as { events?: Array<{ eventAction?: string; eventDate?: string }> };
    const reg = body.events?.find((e) => e.eventAction === "registration")?.eventDate;
    return reg ? Math.max(0, Math.floor((Date.now() - new Date(reg).getTime()) / 86_400_000)) : null;
  } catch {
    return null;
  }
}

async function rdapNetwork(ip: string, timeoutMs: number): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`https://rdap.org/ip/${encodeURIComponent(ip)}`, { signal: ctrl.signal, headers: { accept: "application/rdap+json" } });
    clearTimeout(t);
    if (!res.ok) return null;
    const body = (await res.json()) as { name?: string };
    return body.name ? String(body.name).slice(0, 80) : null;
  } catch {
    return null;
  }
}

export class LinkScanner {
  constructor(private readonly pool: Pool, private readonly opts: { allowPrivate?: boolean; timeoutMs?: number; cacheHours?: number; rdap?: boolean } = {}) {}

  async scan(raw: string): Promise<ScanResult> {
    const n = normalizeUrl(raw);
    if (!n.ok) throw Object.assign(new Error(n.error), { statusCode: 400 });
    const url = n.value;
    const cached = (await this.pool.query<{ result: ScanResult; scanned_at: Date }>("SELECT result, scanned_at FROM link_scans WHERE url = $1", [url])).rows[0];
    // Results are reused for 6 hours; a site that could not be reached is tried again after 10 minutes.
    const ttl = cached && (cached.result.verdict === "unreachable" || cached.result.verdict === "blocked") ? 10 * 60_000 : (this.opts.cacheHours ?? 6) * 3_600_000;
    if (cached && Date.now() - new Date(cached.scanned_at).getTime() < ttl) return { ...cached.result, cached: true };

    // Start from what the person pasted (keeps http:// and the path), but never with a query string.
    let start = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : url;
    try {
      const s = new URL(start);
      s.search = "";
      s.hash = "";
      start = s.toString();
    } catch {
      start = url;
    }
    const live: LiveFacts = { reachable: false, final_url: null, redirects: [], status: null, content_type: null, https: false, tls: null, domain_age_days: null, page: null, error: null };
    let ips: string[] = [];
    let current = start;
    try {
      for (let hop = 0; hop <= 5; hop++) {
        const u = new URL(current);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http and https links are visited");
        if (u.port && u.port !== "80" && u.port !== "443") throw Object.assign(new Error("blocked"), { blocked: true });
        const addrs = await resolveSafe(u.hostname, this.opts.allowPrivate === true);
        ips = addrs; // addresses of the site we end up on
        const r = await fetchPinned(u, addrs[0]!, this.opts.timeoutMs ?? 6000);
        let next: string | null = r.status >= 300 && r.status < 400 && r.location ? new URL(r.location, u).toString() : null;
        if (!next && r.body && /html/i.test(r.contentType ?? "html")) {
          const facts = analyzeHtml(r.body, u.toString());
          if (facts.meta_refresh && hop < 5) next = new URL(facts.meta_refresh, u).toString();
          else {
            live.page = facts;
          }
        }
        if (next) {
          live.redirects.push({ url: `${u.origin}${u.pathname}`, status: r.status });
          current = next;
          continue;
        }
        live.reachable = true;
        live.final_url = `${u.origin}${u.pathname}`; // never keep query strings (they can carry tokens)
        live.status = r.status;
        live.content_type = r.contentType;
        live.https = u.protocol === "https:";
        live.tls = r.tls;
        break;
      }
      if (!live.reachable) live.error = "too many redirects";
    } catch (e) {
      live.error = (e as { blocked?: boolean }).blocked ? "blocked" : e instanceof Error ? e.message.slice(0, 120) : "unreachable";
    }
    const finalHost = (() => {
      try {
        return new URL(live.final_url ?? url).hostname;
      } catch {
        return "";
      }
    })();
    let network: string | null = null;
    if (live.reachable && this.opts.rdap !== false) {
      [live.domain_age_days, network] = await Promise.all([
        isIP(finalHost) ? Promise.resolve(null) : rdapDomainAgeDays(registrableDomain(finalHost), 5000),
        ips[0] ? rdapNetwork(ips[0], 5000) : Promise.resolve(null),
      ]);
    }
    const stat = analyzeUrl(raw.trim() || url);
    const c = correlate(stat, live, url);
    const result: ScanResult = {
      url, scanned_at: new Date().toISOString(), cached: false, verdict: c.verdict, score: c.score, static_score: stat.score,
      static_signals: stat.signals.map((s) => ({ id: s.id, en: s.en, hi: s.hi })), live, evidence: c.evidence, correlations: c.correlations,
      hosting: ips.length ? { ips: ips.slice(0, 4), network } : null,
    };
    await this.pool.query(
      "INSERT INTO link_scans (url, result, scanned_at) VALUES ($1, $2, now()) ON CONFLICT (url) DO UPDATE SET result = EXCLUDED.result, scanned_at = now()",
      [url, JSON.stringify(result)],
    );
    if (ips.length && finalHost) {
      await this.pool.query(
        "INSERT INTO host_info (domain, ips, network, checked_at) VALUES ($1, $2, $3, now()) ON CONFLICT (domain) DO UPDATE SET ips = EXCLUDED.ips, network = EXCLUDED.network, checked_at = now()",
        [registrableDomain(finalHost), ips.filter((ip) => !isPrivateIp(ip) || this.opts.allowPrivate).slice(0, 4), network],
      );
    }
    return result;
  }
}
