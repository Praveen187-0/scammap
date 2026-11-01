import { afterEach, describe, expect, it, vi } from "vitest";
import { COUNTRIES, countryFromTld, ringPosition } from "../src/threatfeed/geo.js";
import { defang, ThreatFeed } from "../src/threatfeed/urlhaus.js";

describe("threat layer geography", () => {
  it("maps country endings, ignores generic and vanity ones", () => {
    expect(countryFromTld("login-secure.ru")).toBe("RU");
    expect(countryFromTld("bank.co.uk")).toBe("GB");
    expect(countryFromTld("pay.example.in")).toBe("IN");
    expect(countryFromTld("evil.su")).toBe("RU");
    expect(countryFromTld("evil.com")).toBeNull();
    expect(countryFromTld("drop.io")).toBeNull();
    expect(countryFromTld("free.tk")).toBeNull();
  });
  it("places markers on a stable ring near the country", () => {
    const a = ringPosition("123", "BR")!;
    expect(ringPosition("123", "BR")).toEqual(a);
    const c = COUNTRIES.get("BR")!;
    expect(Math.abs(a[0] - c.lat)).toBeLessThan(10);
    expect(Math.abs(a[1] - c.lng)).toBeLessThan(10);
    expect(ringPosition("124", "BR")).not.toEqual(a);
    expect(ringPosition("1", "ZZ")).toBeNull();
  });
  it("defangs URLs so they can't be clicked", () => {
    expect(defang("http://1.2.3.4:8080/bins/mozi.m")).toBe("hxxp://1[.]2[.]3[.]4:8080/bins/mozi.m");
    expect(defang("https://login.example.ru/secure/account/verify/now/please")).toMatch(/^hxxps:\/\/login\[\.\]example\[\.\]ru\/secure\/account\/verify\/n.*…$/);
  });
});

describe("URLhaus feed", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("fetches with the Auth-Key, defangs and locates by domain ending and IP registry", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push(url);
      if (url.includes("/urls/recent/")) {
        expect(init?.headers?.["Auth-Key"]).toBe("k123");
        return new Response(JSON.stringify({ query_status: "ok", urls: [
          { id: "3", url: "http://pay-update.ru/a.exe", host: "pay-update.ru", url_status: "online", date_added: "2026-11-01 01:00:00 UTC", threat: "malware_download", tags: ["exe"], urlhaus_reference: "https://urlhaus.abuse.ch/url/3/" },
          { id: "2", url: "http://45.12.1.9:9000/i", host: "45.12.1.9", url_status: "online", date_added: "2026-11-01 00:59:00 UTC", threat: "malware_download", tags: ["mozi"] },
          { id: "1", url: "http://23.1.2.3/x", host: "23.1.2.3", url_status: "offline", date_added: "2026-11-01 00:58:00 UTC", threat: "malware_download", tags: null },
        ] }));
      }
      if (url.endsWith("/ip/45.12.1.9")) return new Response(JSON.stringify({ country: "NL" }));
      if (url.endsWith("/ip/23.1.2.3")) return new Response(JSON.stringify({ port43: "whois.arin.net" }));
      return new Response("{}", { status: 404 });
    });
    const feed = new ThreatFeed({ enabled: true, authKey: "k123", apiBase: "https://api.test/v1", rdapBase: "https://rdap.test", pollMs: 300_000, limit: 50, resolveDns: false, lookupsPerRefresh: 10 });
    await feed.refresh();
    const items = feed.list();
    expect(items.map((i) => i.id)).toEqual(["3", "2", "1"]);
    expect(items[0]).toMatchObject({ country: "RU", located_by: "domain", display: "hxxp://pay-update[.]ru/a.exe" });
    expect(items[1]).toMatchObject({ country: "NL", located_by: "ip" });
    expect(items[2]).toMatchObject({ country: "US", located_by: "ip" });
    expect(feed.status()).toMatchObject({ connected: true, located: 3 });
    expect(feed.list("2").map((i) => i.id)).toEqual(["3"]);
    expect(calls.some((c) => c.includes("pay-update.ru/a.exe"))).toBe(false); // never visits the malicious URL
  });
  it("without a key it stays off and says how to switch it on", () => {
    const feed = new ThreatFeed({ enabled: true, authKey: null, apiBase: "x", rdapBase: "x", pollMs: 1, limit: 1, resolveDns: false, lookupsPerRefresh: 1 });
    expect(feed.status()).toMatchObject({ enabled: false, connected: false });
    expect(feed.status().reason).toContain("URLHAUS_AUTH_KEY");
  });
});
