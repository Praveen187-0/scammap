// Pure analysis of a fetched page, plus the static-vs-live correlation. No network here, so it is unit-tested.
import { BRANDS, registrableDomain, type RiskResult } from "../../shared/risk.js";

export interface PageFacts {
  title: string;
  forms: number;
  asks_for: string[]; // password, otp, card, cvv, pin, aadhaar, pan, bank_account
  external_form_hosts: string[];
  brands: string[];
  iframes: number;
  meta_refresh: string | null;
  obfuscated_script: boolean;
  apk_links: number;
  upi_intents: number;
  chat_links: number;
  blocks_right_click: boolean;
}

const FIELD_PATTERNS: Array<[string, RegExp]> = [
  ["password", /type\s*=\s*["']?password|name\s*=\s*["'][^"']*(pass|pwd|mpin)[^"']*["']/i],
  ["otp", /name\s*=\s*["'][^"']*otp[^"']*["']|placeholder\s*=\s*["'][^"']*(otp|one.time)[^"']*["']|autocomplete\s*=\s*["']one-time-code/i],
  ["card", /name\s*=\s*["'][^"']*(card.?num|cardno|ccnum|cc_number|debit|credit)[^"']*["']|autocomplete\s*=\s*["']cc-number|placeholder\s*=\s*["'][^"']*card number/i],
  ["cvv", /name\s*=\s*["'][^"']*(cvv|cvc|csc)[^"']*["']|autocomplete\s*=\s*["']cc-csc|placeholder\s*=\s*["'][^"']*cvv/i],
  ["pin", /name\s*=\s*["'][^"']*(atm.?pin|upi.?pin|\bpin\b)[^"']*["']|placeholder\s*=\s*["'][^"']*\b(upi |atm )?pin\b/i],
  ["aadhaar", /aadhaar|aadhar/i],
  ["pan", /name\s*=\s*["'][^"']*\bpan(card|_no|no|number)?\b[^"']*["']|placeholder\s*=\s*["'][^"']*pan (card|number)/i],
  ["bank_account", /name\s*=\s*["'][^"']*(acc(ount)?.?(no|num|number)|ifsc)[^"']*["']/i],
];

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

export function analyzeHtml(html: string, pageUrl: string): PageFacts {
  const h = html.slice(0, 1_000_000);
  let host = "";
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    host = "";
  }
  const title = decode(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(h)?.[1] ?? "").slice(0, 160);
  const formTags = h.match(/<form\b[^>]*>/gi) ?? [];
  const inputs = (h.match(/<(input|select|textarea)\b[^>]*>/gi) ?? []).join(" ");
  const textish = `${inputs} ${(h.match(/<label\b[^>]*>[\s\S]{0,120}?<\/label>/gi) ?? []).join(" ")}`;
  const asks = FIELD_PATTERNS.filter(([, re]) => re.test(textish)).map(([k]) => k);
  const ext = new Set<string>();
  for (const f of formTags) {
    const action = /action\s*=\s*["']([^"']+)["']/i.exec(f)?.[1];
    if (!action || action.startsWith("#") || action.startsWith("/")) continue;
    try {
      const a = new URL(action, pageUrl).hostname;
      if (a && registrableDomain(a) !== registrableDomain(host)) ext.add(a);
    } catch {
      /* ignore */
    }
  }
  const visible = decode(h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).toLowerCase().slice(0, 200_000);
  const brands = BRANDS.filter((b) => {
    const inText = b.tokens.some((t) => t.length >= 3 && new RegExp(`\\b${t}\\b`, "i").test(`${title} ${visible}`)) || visible.includes(b.name.toLowerCase());
    const own = b.domains.some((d) => host === d || host.endsWith(`.${d}`));
    return inText && !own;
  }).map((b) => b.name);
  const scripts = (h.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) ?? []).join("\n");
  const obfuscated = /eval\s*\(\s*(atob|unescape|function\s*\(p,a,c,k,e)/i.test(scripts) || /document\.write\s*\(\s*unescape/i.test(scripts) || /[A-Za-z0-9+/]{2000,}={0,2}/.test(scripts);
  return {
    title,
    forms: formTags.length,
    asks_for: asks,
    external_form_hosts: [...ext].slice(0, 5),
    brands: [...new Set(brands)].slice(0, 5),
    iframes: (h.match(/<iframe\b/gi) ?? []).length,
    meta_refresh: /<meta[^>]+http-equiv\s*=\s*["']?refresh[^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"'>\s]+)/i.exec(h)?.[1] ?? null,
    obfuscated_script: obfuscated,
    apk_links: (h.match(/href\s*=\s*["'][^"']+\.apk(\?[^"']*)?["']/gi) ?? []).length,
    upi_intents: (h.match(/upi:\/\/pay/gi) ?? []).length,
    chat_links: (h.match(/(wa\.me\/|api\.whatsapp\.com|t\.me\/)/gi) ?? []).length,
    blocks_right_click: /oncontextmenu\s*=\s*["']\s*return\s+false/i.test(h) || /addEventListener\(\s*["']contextmenu["']/i.test(scripts),
  };
}

export interface LiveFacts {
  reachable: boolean;
  final_url: string | null;
  redirects: Array<{ url: string; status: number }>;
  status: number | null;
  content_type: string | null;
  https: boolean;
  tls: { valid: boolean; issuer: string | null; valid_from: string | null; age_days: number | null } | null;
  domain_age_days: number | null;
  page: PageFacts | null;
  error: string | null;
}

export type LinkVerdict = "proven_phishing" | "dangerous_download" | "suspicious" | "no_live_evidence" | "unreachable" | "blocked";

export interface Evidence {
  id: string;
  en: string;
  hi: string;
  weight: number;
}
export interface Correlation {
  static_signal: string;
  live_evidence: string;
  en: string;
  hi: string;
}

/** Static findings (from the link text) joined with live findings (from visiting it). */
export function correlate(staticRisk: RiskResult, live: LiveFacts, originalUrl: string): { verdict: LinkVerdict; evidence: Evidence[]; correlations: Correlation[]; score: number } {
  const ev: Evidence[] = [];
  const add = (id: string, weight: number, en: string, hi: string): void => {
    ev.push({ id, weight, en, hi });
  };
  if (!live.reachable) return { verdict: live.error === "blocked" ? "blocked" : "unreachable", evidence: [], correlations: [], score: staticRisk.score };
  const p = live.page;
  const origHost = (() => {
    try {
      return new URL(originalUrl).hostname;
    } catch {
      return "";
    }
  })();
  const finalHost = (() => {
    try {
      return live.final_url ? new URL(live.final_url).hostname : origHost;
    } catch {
      return origHost;
    }
  })();
  const sensitive = (p?.asks_for ?? []).filter((x) => x !== "aadhaar" || (p?.forms ?? 0) > 0);
  if (sensitive.length) add("asks-secrets", 40, `The page asks for: ${sensitive.join(", ").replace(/_/g, " ")}.`, `पेज यह माँगता है: ${sensitive.join(", ").replace(/_/g, " ")}।`);
  if (p?.brands.length) add("brand-claim", 20, `The page uses the name ${p.brands.join(", ")}, but is not on its official website.`, `पेज ${p.brands.join(", ")} का नाम इस्तेमाल करता है, पर उसकी असली वेबसाइट पर नहीं है।`);
  if (p?.external_form_hosts.length) add("form-elsewhere", 15, `Its form sends what you type to another site (${p.external_form_hosts[0]}).`, `इसका फ़ॉर्म आपकी जानकारी दूसरी साइट (${p.external_form_hosts[0]}) पर भेजता है।`);
  if (registrableDomain(finalHost) !== registrableDomain(origHost)) add("redirects-away", 12, `The link redirects to a different site: ${finalHost}.`, `लिंक दूसरी साइट पर ले जाता है: ${finalHost}।`);
  if (live.domain_age_days !== null && live.domain_age_days < 60) add("young-domain", 18, `The website was registered only ${live.domain_age_days} days ago.`, `वेबसाइट सिर्फ़ ${live.domain_age_days} दिन पहले रजिस्टर हुई।`);
  if (live.tls && live.tls.age_days !== null && live.tls.age_days < 14) add("new-certificate", 8, `Its security certificate is only ${live.tls.age_days} days old.`, `इसका सुरक्षा सर्टिफ़िकेट सिर्फ़ ${live.tls.age_days} दिन पुराना है।`);
  if (live.tls && !live.tls.valid) add("bad-certificate", 12, "Its security certificate is not valid.", "इसका सुरक्षा सर्टिफ़िकेट मान्य नहीं है।");
  if (!live.https && sensitive.length) add("plain-http-form", 12, "It asks for secrets over an insecure (http) connection.", "यह असुरक्षित (http) कनेक्शन पर गोपनीय जानकारी माँगता है।");
  if ((p?.apk_links ?? 0) > 0 || /\.apk(\?|$)/i.test(live.final_url ?? "") || /android\.package-archive/i.test(live.content_type ?? "")) add("apk", 35, "It offers an Android app file (.apk) outside the Play Store.", "यह Play Store के बाहर Android ऐप फ़ाइल (.apk) देता है।");
  if ((p?.upi_intents ?? 0) > 0) add("upi-intent", 15, "It opens a UPI payment request.", "यह UPI भुगतान अनुरोध खोलता है।");
  if (p?.obfuscated_script) add("obfuscated", 10, "It hides its code (obfuscated scripts).", "यह अपना कोड छिपाता है।");
  if (p?.blocks_right_click) add("no-right-click", 5, "It blocks right-click, a common trick on fake pages.", "यह राइट-क्लिक रोकता है, नकली पेजों की आम चाल।");
  if ((p?.chat_links ?? 0) > 0) add("chat-redirect", 5, "It pushes you to WhatsApp or Telegram.", "यह आपको WhatsApp या Telegram पर भेजता है।");

  const has = (id: string): boolean => ev.some((e) => e.id === id);
  const sig = (id: string): boolean => staticRisk.signals.some((s) => s.id === id);
  const cor: Correlation[] = [];
  const brandStatic = ["brand-misuse", "typosquat", "not-bank-in", "lookalike", "punycode"].find(sig);
  if (brandStatic && (has("brand-claim") || has("asks-secrets"))) cor.push({ static_signal: brandStatic, live_evidence: has("asks-secrets") ? "asks-secrets" : "brand-claim", en: "The look-alike name is confirmed: the live page pretends to be the brand and collects details.", hi: "मिलता-जुलता नाम पक्का हुआ: असली पेज ब्रांड होने का दिखावा करके जानकारी लेता है।" });
  if (sig("shortener") && has("redirects-away")) cor.push({ static_signal: "shortener", live_evidence: "redirects-away", en: "The short link hides the real destination, and it redirects to another site.", hi: "छोटा लिंक असली मंज़िल छिपाता है, और दूसरी साइट पर ले जाता है।" });
  if ((sig("risky-tld") || sig("digits") || sig("hyphens")) && has("young-domain")) cor.push({ static_signal: sig("risky-tld") ? "risky-tld" : "hyphens", live_evidence: "young-domain", en: "A throwaway-looking address, and the site is brand new.", hi: "फेंकने-लायक दिखने वाला पता, और साइट बिल्कुल नई है।" });
  if (sig("apk") && has("apk")) cor.push({ static_signal: "apk", live_evidence: "apk", en: "The link really serves an app file.", hi: "लिंक सच में ऐप फ़ाइल देता है।" });
  if (sig("no-https") && has("plain-http-form")) cor.push({ static_signal: "no-https", live_evidence: "plain-http-form", en: "Insecure link, and the page collects secrets over it.", hi: "असुरक्षित लिंक, और पेज उसी पर गोपनीय जानकारी लेता है।" });

  const liveScore = ev.reduce((s, e) => s + e.weight, 0);
  const score = Math.min(100, Math.round(Math.max(staticRisk.score, 0.5 * staticRisk.score + liveScore)));
  const proven = has("asks-secrets") && (has("brand-claim") || has("form-elsewhere") || has("young-domain") || staticRisk.score >= 40 || cor.length > 0);
  const verdict: LinkVerdict = has("apk") ? "dangerous_download" : proven ? "proven_phishing" : score >= 30 || ev.length >= 2 ? "suspicious" : "no_live_evidence";
  return { verdict, evidence: ev.sort((a, b) => b.weight - a.weight), correlations: cor, score };
}
