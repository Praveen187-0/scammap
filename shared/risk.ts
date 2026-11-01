// Offline risk engine: scores a pasted SMS / WhatsApp message / email, a link, a phone number or an SMS sender.
// Pure functions, no network, so the app can show a first answer instantly and the server has a baseline that
// never depends on an AI being available. Every signal carries plain-language reasons in English and Hindi.
import { extractCandidates, type Candidate } from "./extract.js";
import { maskValue, normalizePhone, normalizeSender, normalizeUrl } from "./normalize.js";
import { suggestScamType } from "./scamTypes.js";

export type RiskLevel = "high" | "medium" | "low";
export interface RiskSignal {
  id: string;
  points: number;
  en: string;
  hi: string;
}
export interface RiskResult {
  score: number;
  level: RiskLevel;
  signals: RiskSignal[];
  reassurances: RiskSignal[];
}
export type TextKind = "message" | "email";
export interface TextAnalysis extends RiskResult {
  kind: TextKind;
  scamType: string | null;
  candidates: Array<Candidate & { risk: RiskResult }>;
}

export function levelFor(score: number): RiskLevel {
  return score >= 60 ? "high" : score >= 30 ? "medium" : "low";
}
function result(signals: RiskSignal[], reassurances: RiskSignal[] = []): RiskResult {
  const raw = signals.reduce((s, x) => s + x.points, 0) - reassurances.reduce((s, x) => s + x.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, level: levelFor(score), signals: signals.sort((a, b) => b.points - a.points), reassurances };
}
const sig = (id: string, points: number, en: string, hi: string): RiskSignal => ({ id, points, en, hi });

// ---------------------------------------------------------------- links

/** Two-label public suffixes we care about, so "sbi-kyc.co.in" has registrable domain "sbi-kyc.co.in". */
const SECOND_LEVEL = new Set(["co.in", "gov.in", "nic.in", "org.in", "net.in", "ac.in", "res.in", "edu.in", "bank.in", "fin.in", "firm.in", "gen.in", "ind.in", "co.uk", "com.au"]);

export function registrableDomain(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const last2 = labels.slice(-2).join(".");
  return SECOND_LEVEL.has(last2) ? labels.slice(-3).join(".") : last2;
}

interface Brand {
  name: string;
  tokens: string[];
  domains: string[];
}
// Older official addresses still in use. Since 31 Oct 2025 Indian banks must also use *.bank.in (RBI circular
// RBI/2025-26/28), which only RBI-regulated banks can register.
export const BRANDS: readonly Brand[] = [
  { name: "SBI", tokens: ["sbi", "onlinesbi", "yono"], domains: ["sbi.co.in", "onlinesbi.sbi", "sbi.bank.in"] },
  { name: "HDFC Bank", tokens: ["hdfc", "hdfcbank"], domains: ["hdfcbank.com", "hdfc.bank.in"] },
  { name: "ICICI Bank", tokens: ["icici", "icicibank"], domains: ["icicibank.com", "icici.bank.in"] },
  { name: "Axis Bank", tokens: ["axisbank"], domains: ["axisbank.com", "axis.bank.in"] },
  { name: "Kotak", tokens: ["kotak"], domains: ["kotak.com", "kotak.bank.in"] },
  { name: "PNB", tokens: ["pnb", "pnbindia"], domains: ["pnbindia.in", "pnb.bank.in"] },
  { name: "Bank of Baroda", tokens: ["bankofbaroda", "bob"], domains: ["bankofbaroda.in", "bankofbaroda.bank.in"] },
  { name: "Canara Bank", tokens: ["canara", "canarabank"], domains: ["canarabank.com", "canarabank.bank.in"] },
  { name: "Paytm", tokens: ["paytm"], domains: ["paytm.com"] },
  { name: "PhonePe", tokens: ["phonepe"], domains: ["phonepe.com"] },
  { name: "Income Tax Department", tokens: ["incometax", "itr"], domains: ["incometax.gov.in"] },
  { name: "UIDAI (Aadhaar)", tokens: ["uidai", "aadhaar", "aadhar"], domains: ["uidai.gov.in"] },
  { name: "EPFO", tokens: ["epfo", "epf", "epfindia"], domains: ["epfindia.gov.in"] },
  { name: "India Post", tokens: ["indiapost", "speedpost"], domains: ["indiapost.gov.in"] },
  { name: "IRCTC", tokens: ["irctc"], domains: ["irctc.co.in"] },
  { name: "NPCI / UPI", tokens: ["npci", "bhim", "upi"], domains: ["npci.org.in", "bhimupi.org.in"] },
  { name: "RBI", tokens: ["rbi", "reservebank"], domains: ["rbi.org.in"] },
  { name: "Amazon", tokens: ["amazon"], domains: ["amazon.in", "amazon.com"] },
  { name: "Flipkart", tokens: ["flipkart"], domains: ["flipkart.com"] },
  { name: "BESCOM", tokens: ["bescom"], domains: ["bescom.co.in"] },
];
const OFFICIAL = new Map<string, string>(BRANDS.flatMap((b) => b.domains.map((d) => [d, b.name] as [string, string])));

const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "cutt.ly", "is.gd", "rb.gy", "shorturl.at", "t.ly", "tiny.cc", "s.id", "v.gd", "ow.ly", "goo.su", "rebrand.ly", "shorte.st", "bl.ink", "t2m.io"]);
const RISKY_TLDS = new Set(["top", "xyz", "click", "link", "live", "buzz", "cyou", "icu", "sbs", "cfd", "rest", "quest", "monster", "shop", "store", "online", "site", "fun", "website", "space", "tk", "ml", "ga", "cf", "gq", "work", "support", "help", "loan", "win", "bid", "vip", "lol", "mom"]);
const URL_WORDS = ["kyc", "update", "verify", "verification", "login", "signin", "secure", "account", "reward", "refund", "bonus", "claim", "otp", "wallet", "aadhaar", "pan", "lottery", "prize", "gift", "free", "offer", "blocked", "suspend", "unlock", "pay", "netbanking", "customer-care", "helpline"];

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
}

export function analyzeUrl(raw: string): RiskResult {
  const n = normalizeUrl(raw);
  if (!n.ok) return result([sig("bad-link", 0, "This doesn't look like a valid link.", "यह सही लिंक नहीं लगता।")]);
  const value = n.value;
  const rest = value.replace(/^https:\/\//, "");
  const host = rest.split(/[/:]/)[0] ?? "";
  const path = rest.slice(host.length).toLowerCase();
  const reg = registrableDomain(host);
  const signals: RiskSignal[] = [];
  const good: RiskSignal[] = [];

  if (host.endsWith(".bank.in")) {
    good.push(sig("bank-in", 40, "Ends in .bank.in, a domain only RBI-regulated banks can register.", ".bank.in पर ख़त्म होता है, जिसे सिर्फ़ RBI से नियंत्रित बैंक ले सकते हैं।"));
  } else if (host.endsWith(".gov.in") || host.endsWith(".nic.in")) {
    good.push(sig("gov-in", 40, "An Indian government domain (.gov.in).", "भारतीय सरकारी डोमेन (.gov.in)।"));
  } else if (OFFICIAL.has(reg)) {
    good.push(sig("official", 40, `This is ${OFFICIAL.get(reg) ?? ""}'s official website.`, `यह ${OFFICIAL.get(reg) ?? ""} की आधिकारिक वेबसाइट है।`));
  }

  const official = good.length > 0;
  const labels = host.split(".");
  const nameLabels = labels.slice(0, Math.max(1, labels.length - (reg.split(".").length - 1)));
  // Undo digit-for-letter swaps (amaz0n, sb1, paytrn) before matching brand names.
  const unleet = (x: string): string => x.replace(/0/g, "o").replace(/1/g, "l").replace(/3/g, "e").replace(/5/g, "s").replace(/rn/g, "m");
  const parts = nameLabels.flatMap((l) => l.split("-")).flatMap((p) => (unleet(p) === p ? [p] : [p, unleet(p)]));
  if (!official) {
    const brand = BRANDS.find((b) => b.tokens.some((t) => parts.some((p) => p === t || (t.length >= 3 && p.startsWith(t) && p.length > t.length))));
    if (brand) {
      const main = reg.split(".")[0] ?? "";
      const near = brand.domains.map((d) => d.split(".")[0] ?? "").find((o) => o.length >= 5 && o !== main && editDistance(main, o) <= 2);
      if (near) signals.push(sig("typosquat", 20, `Spelled almost exactly like ${brand.name}'s real address.`, `${brand.name} के असली पते जैसी ही वर्तनी।`));
      signals.push(sig("brand-misuse", 40, `Uses the name "${brand.name}" but is not ${brand.name}'s official website.`, `"${brand.name}" का नाम इस्तेमाल करता है, पर यह उसकी आधिकारिक वेबसाइट नहीं है।`));
      if (/bank|sbi|hdfc|icici|axis|kotak|pnb|baroda|canara/i.test(brand.name)) {
        signals.push(sig("not-bank-in", 10, "Real Indian bank websites now end in .bank.in.", "असली भारतीय बैंक वेबसाइटें अब .bank.in पर ख़त्म होती हैं।"));
      }
    } else {
      const main = reg.split(".")[0] ?? "";
      const look = [...OFFICIAL.keys()].find((d) => {
        const o = d.split(".")[0] ?? "";
        return o.length >= 5 && main !== o && editDistance(main, o) <= 2;
      });
      if (look) signals.push(sig("typosquat", 45, `Looks almost like ${look}, a common trick to fake a real site.`, `${look} जैसा दिखता है, असली साइट की नकल करने की आम चाल।`));
    }
  }
  if (host.startsWith("xn--") || host.includes(".xn--")) signals.push(sig("punycode", 30, "Uses look-alike letters from other alphabets.", "दूसरी लिपियों के मिलते-जुलते अक्षर इस्तेमाल करता है।"));
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) signals.push(sig("ip-host", 30, "Points to a bare IP address instead of a website name.", "वेबसाइट के नाम की जगह सिर्फ़ IP पता है।"));
  if (SHORTENERS.has(reg)) signals.push(sig("shortener", 20, "A short link hides where it really goes.", "छोटा लिंक असली पता छिपाता है।"));
  const tld = labels[labels.length - 1] ?? "";
  if (!official && RISKY_TLDS.has(tld)) signals.push(sig("risky-tld", 15, `Ends in .${tld}, an ending often used by throwaway scam sites.`, `.${tld} पर ख़त्म होता है, जो अक्सर नकली साइटों में होता है।`));
  if ((host.match(/-/g) ?? []).length >= 2) signals.push(sig("hyphens", 8, "Many hyphens in the name.", "नाम में कई हाइफ़न हैं।"));
  if (labels.length >= 4 && !official) signals.push(sig("subdomains", 8, "Unusually many parts in the address.", "पते में असामान्य रूप से कई हिस्से हैं।"));
  if (/\d{3,}/.test(nameLabels.join("")) && !official) signals.push(sig("digits", 5, "Random-looking numbers in the name.", "नाम में बेतरतीब अंक हैं।"));
  if (/\.apk(\b|$)/.test(path)) signals.push(sig("apk", 35, "Downloads an Android app (.apk) from outside the Play Store.", "Play Store के बाहर से ऐप (.apk) डाउनलोड करवाता है।"));
  if (!official) {
    const words = URL_WORDS.filter((w) => host.includes(w) || path.includes(w));
    if (words.length) signals.push(sig("bait-words", Math.min(18, 6 * words.length), `Bait words in the link: ${words.slice(0, 3).join(", ")}.`, `लिंक में लालच वाले शब्द: ${words.slice(0, 3).join(", ")}।`));
  }
  if (/^\s*http:\/\//i.test(raw) && !official) signals.push(sig("no-https", 6, "Not a secure (https) link.", "सुरक्षित (https) लिंक नहीं है।"));
  if (/^[a-z]+:\/\/[^/]*@/i.test(raw.trim())) signals.push(sig("userinfo", 20, "Hides the real site behind an @ sign.", "@ चिह्न के पीछे असली साइट छिपाता है।"));
  return result(signals, good);
}

// ---------------------------------------------------------------- phone numbers and SMS senders

export function analyzePhone(raw: string): RiskResult {
  const s = raw.trim();
  const cc = /^\+\s*(\d{1,3})/.exec(s.replace(/[\s()-]/g, ""));
  if (cc && !/^\+?91/.test(s.replace(/[\s()-]/g, "")) && !/^\+?0/.test(s)) {
    return result([sig("international", 35, "An international number. Indian banks, police and government offices don't call you from abroad.", "विदेशी नंबर। भारतीय बैंक, पुलिस या सरकारी दफ़्तर विदेश से कॉल नहीं करते।")]);
  }
  const n = normalizePhone(s);
  if (!n.ok) return result([sig("bad-number", 0, "This doesn't look like a valid Indian number.", "यह सही भारतीय नंबर नहीं लगता।")]);
  const v = n.value;
  if (v.startsWith("+911600")) return result([], [sig("1600", 30, "1600-series: reserved for service calls from government offices.", "1600 सीरीज़: सरकारी दफ़्तरों के सर्विस कॉल के लिए।")]);
  if (v.startsWith("+911601")) return result([], [sig("1601", 30, "1601-series: reserved for service calls from banks and regulated financial firms.", "1601 सीरीज़: बैंकों और नियंत्रित वित्तीय संस्थाओं के सर्विस कॉल के लिए।")]);
  if (v.startsWith("+91140")) return result([sig("140", 10, "140-series: a registered telemarketer (sales call). Block it through DND 1909.", "140 सीरीज़: पंजीकृत टेलीमार्केटर (बिक्री कॉल)। 1909 DND से रोकें।")]);
  if (/^(1800|1860)/.test(v)) return result([], [sig("toll-free", 10, "A toll-free number: companies take calls on these, they rarely call you from one.", "टोल-फ़्री नंबर: कंपनियाँ इन पर कॉल लेती हैं, इनसे कॉल कम करती हैं।")]);
  if (!v.startsWith("+91")) return result([], [sig("short-code", 20, "A short helpline number.", "छोटा हेल्पलाइन नंबर।")]);
  const first = v[3] ?? "";
  if ("6789".includes(first)) return result([sig("mobile", 5, "A personal mobile number. Banks now make service calls from 1601-series numbers, not personal mobiles.", "निजी मोबाइल नंबर। बैंक अब सर्विस कॉल 1601 सीरीज़ से करते हैं, निजी मोबाइल से नहीं।")]);
  return result([], [sig("landline", 0, "A landline number.", "लैंडलाइन नंबर।")]);
}

export function analyzeSender(raw: string): RiskResult {
  const t = raw.trim().toUpperCase();
  if (/^\+?\d[\d\s-]{8,}$/.test(t)) {
    return result([sig("p2p-sms", 30, "Sent from a personal number. Real banks and companies send SMS from 6-letter sender IDs.", "निजी नंबर से भेजा गया। असली बैंक और कंपनियाँ 6 अक्षर के सेंडर ID से SMS भेजती हैं।")]);
  }
  const n = normalizeSender(t);
  if (!n.ok) return result([sig("bad-sender", 0, "This doesn't look like a valid SMS sender ID.", "यह सही SMS सेंडर ID नहीं लगता।")]);
  const suffix = /-([PSTG])$/.exec(t)?.[1];
  const meanings: Record<string, [string, string]> = {
    P: ["Marked -P: a promotional message.", "-P: प्रचार वाला संदेश।"],
    S: ["Marked -S: a service message from a registered business.", "-S: पंजीकृत कंपनी का सर्विस संदेश।"],
    T: ["Marked -T: a transactional message (OTPs, alerts).", "-T: लेन-देन वाला संदेश (OTP, अलर्ट)।"],
    G: ["Marked -G: a government message.", "-G: सरकारी संदेश।"],
  };
  const good = suffix ? [sig(`suffix-${suffix}`, 5, meanings[suffix]![0], meanings[suffix]![1])] : [];
  if (/^\d{6}$/.test(n.value)) return result([sig("numeric-header", 8, "A numeric sender: usually promotional.", "अंकों वाला सेंडर: अक्सर प्रचार।")], good);
  return result([], good);
}

// ---------------------------------------------------------------- UPI IDs

/** Common UPI handles and the app that issues them (public knowledge, used only to describe an ID). */
export const UPI_HANDLES: Readonly<Record<string, string>> = {
  ybl: "PhonePe", ibl: "PhonePe", axl: "PhonePe", okaxis: "Google Pay", okhdfcbank: "Google Pay", oksbi: "Google Pay",
  okicici: "Google Pay", paytm: "Paytm", ptyes: "Paytm", ptaxis: "Paytm", pthdfc: "Paytm", ptsbi: "Paytm", apl: "Amazon Pay",
  yapl: "Amazon Pay", upi: "BHIM", sbi: "SBI", hdfcbank: "HDFC Bank", icici: "ICICI Bank", axisbank: "Axis Bank", kotak: "Kotak",
  pnb: "PNB", barodampay: "Bank of Baroda", cnrb: "Canara Bank", jupiteraxis: "Jupiter", fam: "FamPay", slice: "slice",
  freecharge: "Freecharge", mobikwik: "MobiKwik", airtel: "Airtel Payments Bank", jio: "Jio Payments Bank", waicici: "WhatsApp Pay",
  wahdfcbank: "WhatsApp Pay", wasbi: "WhatsApp Pay", waaxis: "WhatsApp Pay",
};
const UPI_BAIT = ["refund", "kyc", "support", "helpdesk", "help", "care", "customercare", "reward", "prize", "cashback", "lottery",
  "winner", "bonus", "gift", "govt", "government", "police", "cbi", "court", "rbi", "income", "tax", "fine", "penalty", "verify", "claim", "task", "job"];

/** Describes a UPI ID without exposing it: which app issued it and what kind of name it uses. */
export function describeUpi(value: string): { handle: string; app: string | null; local: "phone" | "brand" | "bait" | "name-like" | "random"; words: string[] } {
  const [local = "", handle = ""] = value.toLowerCase().split("@");
  const app = UPI_HANDLES[handle] ?? null;
  const flat = local.replace(/[._-]/g, "");
  const brands = BRANDS.filter((b) => b.tokens.some((t) => t.length >= 3 && flat.includes(t))).map((b) => b.name);
  const bait = UPI_BAIT.filter((w) => flat.includes(w));
  if (/^\d{10}$/.test(flat) || /^91\d{10}$/.test(flat)) return { handle, app, local: "phone", words: [] };
  if (brands.length) return { handle, app, local: "brand", words: [...brands, ...bait] };
  if (bait.length) return { handle, app, local: "bait", words: bait };
  if (/\d{5,}/.test(flat) || /^[a-z0-9]{12,}$/.test(flat)) return { handle, app, local: "random", words: [] };
  return { handle, app, local: "name-like", words: [] };
}

export function analyzeUpi(raw: string): RiskResult {
  const v = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,255}@[a-z][a-z0-9]{1,63}$/.test(v)) return result([sig("bad-upi", 0, "This doesn't look like a valid UPI ID.", "यह सही UPI ID नहीं लगता।")]);
  const d = describeUpi(v);
  const signals: RiskSignal[] = [];
  if (d.local === "brand") signals.push(sig("upi-brand", 40, `Uses the name ${d.words[0]} on a personal UPI ID. Banks and companies never collect refunds or fees through IDs like this.`, `निजी UPI ID पर ${d.words[0]} का नाम। बैंक और कंपनियाँ ऐसे ID से रिफ़ंड या फ़ीस नहीं लेतीं।`));
  else if (d.local === "bait") signals.push(sig("upi-bait", 28, `The ID contains bait words: ${d.words.slice(0, 3).join(", ")}.`, `ID में लालच/डर वाले शब्द: ${d.words.slice(0, 3).join(", ")}।`));
  if (d.local === "random") signals.push(sig("upi-random", 10, "A random-looking ID, often used for throwaway accounts.", "बेतरतीब-सा ID, अक्सर थोड़े समय के खातों में इस्तेमाल।"));
  if (!d.app) signals.push(sig("upi-handle", 12, `An uncommon UPI handle (@${d.handle}).`, `असामान्य UPI हैंडल (@${d.handle})।`));
  return result(signals);
}

// ---------------------------------------------------------------- messages and emails

interface Rule {
  id: string;
  points: number;
  en: string;
  hi: string;
  re?: RegExp;
  words?: string[]; // plain substrings, needed for Devanagari where \b does not work
}

const RULES: readonly Rule[] = [
  { id: "asks-code", points: 30, en: "Asks you to share an OTP, PIN, CVV or password.", hi: "OTP, PIN, CVV या पासवर्ड बताने को कहता है।",
    re: /\b(share|send|tell|give|provide|enter|forward|batao|bataiye|bhejo|bhej do)\b[^.!?\n]{0,30}\b(otp|pin|cvv|password|passcode|code)\b|\b(otp|pin|cvv|password)\b[^.!?\n]{0,25}\b(share|send|tell|batao|bataiye|bhejo|forward)\b/i,
    words: ["ओटीपी बताएं", "ओटीपी बताओ", "पिन बताएं", "ओटीपी भेजें"] },
  { id: "remote-app", points: 30, en: "Asks you to install a screen-sharing or remote-control app.", hi: "स्क्रीन-शेयर या रिमोट-कंट्रोल ऐप इंस्टॉल करने को कहता है।",
    re: /\b(anydesk|any desk|teamviewer|team viewer|quick ?support|rustdesk|airdroid|screen ?shar(e|ing))\b/i },
  { id: "apk", points: 25, en: "Asks you to download an app file (.apk) outside the Play Store.", hi: "Play Store के बाहर से ऐप फ़ाइल (.apk) डाउनलोड करने को कहता है।",
    re: /\.apk\b|\b(download|install) (this|the|our|given) (app|application|apk)\b/i },
  { id: "authority", points: 22, en: "Claims to be police, CBI, customs or a court.", hi: "ख़ुद को पुलिस, CBI, कस्टम या अदालत बताता है।",
    re: /\b(arrest(ed)?|warrant|cbi|ncb|enforcement directorate|cyber ?cell|crime branch|police|customs|court|fir|money laundering|narcotics|drugs?|mdma|digital arrest|trai)\b/i,
    words: ["गिरफ्तार", "गिरफ़्तार", "पुलिस", "वारंट", "कस्टम", "अदालत", "ड्रग्स"] },
  { id: "secrecy", points: 22, en: "Tells you to keep it secret from family.", hi: "परिवार से छिपाने को कहता है।",
    re: /\b(don'?t|do not) (tell|inform|share with) (anyone|anybody|family|your family)|keep (this|it) (confidential|secret)|kisi ko (mat|na|nahi) (batana|bataye|batao)/i,
    words: ["किसी को मत बता", "किसी को न बता", "गोपनीय रखें"] },
  { id: "block-threat", points: 16, en: "Threatens to block your account, SIM, card or power.", hi: "खाता, सिम, कार्ड या बिजली बंद करने की धमकी देता है।",
    re: /\b(account|a\/c|sim|number|card|kyc|connection|electricity|power|wallet)\b[^.!?\n]{0,35}\b(block(ed)?|suspend(ed)?|deactivat\w*|disconnect\w*|cut|expire[sd]?|freez\w*|band ho)/i,
    words: ["बंद हो जाएगा", "बंद कर दिया जाएगा", "कट जाएगा", "कट जायेगा", "ब्लॉक"] },
  { id: "urgency", points: 10, en: "Pushes you to act immediately.", hi: "तुरंत कुछ करने का दबाव डालता है।",
    re: /\b(urgent(ly)?|immediately|right now|within \d+ ?(hours?|hrs|minutes|mins)|today itself|tonight|last (chance|warning|reminder|date)|act now|turant|jaldi|abhi ke abhi)\b/i,
    words: ["तुरंत", "जल्दी", "आज रात", "अभी"] },
  { id: "money-ask", points: 12, en: "Asks for a payment, fee, fine or deposit.", hi: "भुगतान, फ़ीस, जुर्माना या जमा राशि माँगता है।",
    re: /\b(pay|payment|transfer|deposit|fee|fine|charges?|processing fee|security deposit|refundable|penalty|send money|paisa bhejo)\b/i,
    words: ["भुगतान", "जमा करें", "जुर्माना", "पैसे भेजें", "फ़ीस"] },
  { id: "prize", points: 16, en: "Promises a prize, lottery, cashback or reward.", hi: "इनाम, लॉटरी, कैशबैक या रिवॉर्ड का वादा करता है।",
    re: /\b(lottery|lucky draw|winner|you (have )?won|prize|kbc|cash ?back|reward points?|gift card|congratulations)\b/i,
    words: ["लॉटरी", "इनाम", "जीत", "बधाई हो"] },
  { id: "job", points: 14, en: "Offers easy work-from-home money.", hi: "घर बैठे आसान कमाई का ऑफ़र देता है।",
    re: /\b(work from home|part[- ]time (job|work)|daily (income|earning|salary)|earn (rs\.?|₹|inr)? ?\d|like (videos|youtube)|simple tasks?|task based)\b/i,
    words: ["घर बैठे", "पार्ट टाइम", "रोज़ कमाएं"] },
  { id: "investment", points: 16, en: "Promises guaranteed or unusually high returns.", hi: "पक्का या असामान्य रूप से ज़्यादा मुनाफ़ा देने का वादा करता है।",
    re: /\b(guaranteed (returns?|profit)|double your (money|investment)|ipo allotment|stock tips?|trading (group|tips)|vip group|\d{2,3} ?% (daily|weekly|monthly|returns?))\b/i,
    words: ["पक्का मुनाफ़ा", "पैसा डबल"] },
  { id: "kyc", points: 16, en: "Asks you to update KYC, PAN or Aadhaar through a message.", hi: "मैसेज से KYC, PAN या आधार अपडेट करने को कहता है।",
    re: /\b(kyc|re-?kyc|pan (card )?(update|link|expired)|aadhaa?r (update|link|verification))\b/i,
    words: ["केवाईसी", "पैन अपडेट", "आधार अपडेट"] },
  { id: "qr-receive", points: 30, en: "Asks you to scan a QR code or enter your PIN to receive money. That sends money instead.", hi: "पैसे पाने के लिए QR स्कैन या PIN डालने को कहता है। इससे पैसे जाते हैं।",
    re: /\bscan (the |this )?qr\b|\bqr code\b[^.!?\n]{0,25}\b(receive|refund|get|credit)|\bto receive (the )?(money|payment|amount)\b/i },
  { id: "power-cut", points: 18, en: "Says your electricity will be cut tonight.", hi: "कहता है आज रात बिजली कट जाएगी।",
    re: /\b(electricity|power|light|bijli)\b[^.!?\n]{0,40}\b(cut|disconnect\w*|band|suspend\w*)/i,
    words: ["बिजली कनेक्शन", "बिजली कट", "बिजली बंद"] },
  { id: "upfront-fee", points: 15, en: "Asks for a registration or joining fee up front.", hi: "पहले ही रजिस्ट्रेशन या जॉइनिंग फ़ीस माँगता है।",
    re: /\b(registration|joining|processing|activation|verification) (fee|charges?|amount)\b|\brefundable (deposit|amount)\b/i },
  { id: "courier", points: 12, en: "Says a parcel is held and needs a payment.", hi: "कहता है पार्सल रुका है और भुगतान चाहिए।",
    re: /\b(parcel|courier|package|shipment|consignment)\b[^.!?\n]{0,40}\b(held|seized|stuck|on hold|customs|undeliver\w*|pending)/i,
    words: ["पार्सल रोका", "पार्सल में"] },
  // Amazon impersonation patterns (reported widely, e.g. on Reddit r/Scams): fake order robo-calls, OTP read-back
  // posing as delivery, and unexpected cash-on-delivery parcels.
  { id: "amazon-fake-order", points: 28, en: "Says an order or charge was placed on your Amazon account and asks you to call to cancel it. Amazon never asks you to call a number to cancel: check Your Orders in the app.", hi: "कहता है आपके Amazon खाते पर ऑर्डर या चार्ज हुआ और रद्द करने के लिए कॉल करने को कहता है। Amazon कभी किसी नंबर पर कॉल करवाकर रद्द नहीं करता: ऐप में Your Orders देखें।",
    re: /^(?=[\s\S]*\b(amazon|amzn|prime)\b)(?=[\s\S]*\b(order(ed)?|purchased?|charged?|placed|subscription|renew(al|ed)?|membership)\b)(?=[\s\S]*\b(call|calling|press ?1|dial|helpline|call ?back|cancellation (desk|department|team|line)|refund (desk|department|team))\b)/i },
  { id: "delivery-otp", points: 18, en: "A \"delivery agent\" asks for an OTP over a call or message. A real delivery OTP is only given at your door; a code that arrives during a call can open your account or approve a payment.", hi: "\"डिलीवरी एजेंट\" कॉल या मैसेज पर OTP माँगता है। असली डिलीवरी OTP सिर्फ़ दरवाज़े पर दिया जाता है; कॉल के दौरान आया कोड आपका खाता खोल सकता है या भुगतान मंज़ूर कर सकता है।",
    re: /\b(delivery|delivered|courier|parcel|package)\b[\s\S]{0,80}\b(otp|code|pin)\b[\s\S]{0,60}\b(share|tell|read|say|give|send|batao|bataiye|bolo|bata do)\b|\b(share|tell|read|give|batao|bataiye|bolo)\b[\s\S]{0,40}\b(otp|code)\b[\s\S]{0,60}\b(delivery|courier|parcel|package)\b/i,
    words: ["डिलीवरी ओटीपी", "डिलीवरी का ओटीपी"] },
  { id: "cod-parcel", points: 10, en: "Asks you to pay cash on delivery for a parcel. If you didn't order it, refuse it and check your orders in the app.", hi: "पार्सल के लिए कैश ऑन डिलीवरी माँगता है। अगर आपने ऑर्डर नहीं किया, तो लेने से मना करें और ऐप में ऑर्डर देखें।",
    re: /\b(cod|cash on delivery)\b[\s\S]{0,80}(₹|rs\.?|inr)\s?\d|(₹|rs\.?|inr)\s?\d[\d,]*[\s\S]{0,60}\b(cod|cash on delivery)\b/i },
  { id: "generic-greeting", points: 5, en: "A generic greeting like \"Dear Customer\".", hi: "\"Dear Customer\" जैसा आम संबोधन।",
    re: /^\s*(dear (customer|user|sir|madam|valued|account ?holder|member))/i },
];

const REASSURE = /\b(do not|don't|never)\s+(share|disclose|tell)\b[^.!?\n]{0,30}\b(otp|pin|cvv|password)|\b(otp|pin|cvv|password)\b[\s\S]{0,80}\b(do not|don't|never)\s+(share|disclose)/i;
const EMAIL_ATTACHMENT = /\b[\w-]+\.(html?|zip|rar|7z|exe|scr|apk|iso|img|js|vbs)\b/i;
const EMAIL_PHISH = /\b(verify your (account|identity|email)|unusual (sign[- ]?in|activity|login)|password (has )?expired|confirm your (details|account)|your mailbox (is )?full|invoice attached)\b/i;

function detectKind(text: string): TextKind {
  return /^\s*(from|subject|reply-to|to)\s*:/im.test(text) || /<[^>]+@[^>]+>/.test(text) ? "email" : "message";
}

function emailSignals(text: string): RiskSignal[] {
  const out: RiskSignal[] = [];
  const fromLine = /^\s*from\s*:\s*(.+)$/im.exec(text)?.[1] ?? "";
  const replyLine = /^\s*reply-to\s*:\s*(.+)$/im.exec(text)?.[1] ?? "";
  const domainOf = (line: string): string | null => /@([a-z0-9.-]+\.[a-z]{2,})/i.exec(line)?.[1]?.toLowerCase() ?? null;
  const fromDomain = domainOf(fromLine);
  const replyDomain = domainOf(replyLine);
  if (fromDomain && replyDomain && registrableDomain(fromDomain) !== registrableDomain(replyDomain)) {
    out.push(sig("reply-mismatch", 18, `Replies go to ${replyDomain}, not the sender's ${fromDomain}.`, `जवाब ${replyDomain} पर जाता है, भेजने वाले के ${fromDomain} पर नहीं।`));
  }
  if (fromDomain) {
    const display = fromLine.replace(/<.*>/, "").toLowerCase();
    const reg = registrableDomain(fromDomain);
    const officialSender = fromDomain.endsWith(".bank.in") || fromDomain.endsWith(".gov.in") || OFFICIAL.has(reg);
    const brand = BRANDS.find((b) => b.tokens.some((t) => new RegExp(`\\b${t}\\b`).test(display)) || b.tokens.some((t) => fromDomain.includes(t)));
    if (brand && !officialSender) {
      out.push(sig("spoofed-sender", 30, `Claims to be ${brand.name} but was sent from ${fromDomain}.`, `${brand.name} होने का दावा, पर ${fromDomain} से भेजा गया।`));
    }
    if (/\b(gmail|yahoo|outlook|hotmail|rediffmail|proton)\./.test(fromDomain) && brand) {
      out.push(sig("free-mail", 12, "A company or government office would not write from a free email account.", "कंपनी या सरकारी दफ़्तर मुफ़्त ईमेल खाते से नहीं लिखते।"));
    }
  }
  if (EMAIL_ATTACHMENT.test(text)) out.push(sig("attachment", 18, "Mentions a risky attachment (.html, .zip, .apk, .exe).", "ख़तरनाक अटैचमेंट (.html, .zip, .apk, .exe) का ज़िक्र।"));
  if (EMAIL_PHISH.test(text)) out.push(sig("account-phish", 15, "Asks you to verify your account or sign-in.", "खाता या लॉगिन वेरिफ़ाई करने को कहता है।"));
  return out;
}

export function analyzeText(text: string): TextAnalysis {
  const t = text.normalize("NFKC");
  const lower = t.toLowerCase();
  const kind = detectKind(t);
  const signals: RiskSignal[] = [];
  for (const r of RULES) {
    const hit = (r.re && r.re.test(t)) || (r.words ?? []).some((w) => lower.includes(w.toLowerCase()));
    if (hit) signals.push(sig(r.id, r.points, r.en, r.hi));
  }
  if (kind === "email") signals.push(...emailSignals(t));

  const candidates = extractCandidates(t).slice(0, 8).map((c) => ({
    ...c,
    risk: c.type === "url" ? analyzeUrl(c.raw) : c.type === "phone" ? analyzePhone(c.raw) : c.type === "sender_id" ? analyzeSender(c.raw) : result([]),
  }));
  const worstLink = candidates.filter((c) => c.type === "url").sort((a, b) => b.risk.score - a.risk.score)[0];
  if (worstLink && worstLink.risk.score >= 30) {
    signals.push(sig("risky-link", Math.round(worstLink.risk.score * 0.6), `Contains a risky link: ${worstLink.value.replace(/^https:\/\//, "")}.`, `ख़तरनाक लिंक है: ${worstLink.value.replace(/^https:\/\//, "")}।`));
  }
  // Numbers written US-style (888-814-2357) are not Indian mobiles, even though their digits could be one.
  const usStyle = new Set([...t.matchAll(/(?:^|[^\d])\(?([2-9]\d{2})\)?[\s.-](\d{3})[\s.-](\d{4})\b/g)].map((m) => `${m[1]}${m[2]}${m[3]}`));
  const mobiles = candidates.filter((c) => c.type === "phone" && /^\+91[6-9]/.test(c.value) && !usStyle.has(c.value.slice(3)));
  const claimsOfficial = signals.some((s) => ["authority", "kyc", "block-threat", "amazon-fake-order"].includes(s.id)) || /\b(bank|sbi|hdfc|icici|axis|electricity|bescom|customer (care|support)|amazon|flipkart)\b/i.test(t);
  // A company name next to a number to call abroad (+1, +44...), or in US toll-free form (888-xxx-xxxx).
  const brand = BRANDS.find((b) => b.tokens.some((tok) => tok.length >= 4 && new RegExp(`\\b${tok}\\b`, "i").test(t)));
  const abroad = candidates.find((c) => c.type === "phone" && c.value.startsWith("+") && !c.value.startsWith("+91"));
  if (brand && abroad) {
    const shown = maskValue("phone", abroad.value); // numbers stay masked in our own words, as everywhere else
    signals.push(sig("brand-abroad", 22, `Claims to be ${brand.name} but asks you to call an international number (${shown}).`, `${brand.name} होने का दावा, पर विदेशी नंबर (${shown}) पर कॉल करने को कहता है।`));
  } else if (brand && /(^|[^\d])\(?(800|833|844|855|866|877|888)\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(t)) {
    signals.push(sig("us-tollfree", 15, `Claims to be ${brand.name} but gives a US-style toll-free number (8xx-xxx-xxxx). Indian support lines don't look like this.`, `${brand.name} होने का दावा, पर अमेरिकी तरह का टोल-फ़्री नंबर (8xx-xxx-xxxx) देता है। भारतीय सपोर्ट नंबर ऐसे नहीं होते।`));
  }
  if (mobiles.length && claimsOfficial) {
    signals.push(sig("call-mobile", 12, "Claims to be an official body but asks you to call a personal mobile number.", "आधिकारिक संस्था होने का दावा, पर निजी मोबाइल नंबर पर कॉल करने को कहता है।"));
  }
  if (candidates.some((c) => c.type === "upi") && signals.some((s) => ["prize", "money-ask", "job", "qr-receive"].includes(s.id))) {
    signals.push(sig("upi-pay", 10, "Asks you to pay a UPI ID.", "UPI ID पर भुगतान करने को कहता है।"));
  }
  const classic = signals.filter((x) => !["generic-greeting", "urgency", "risky-link"].includes(x.id)).length;
  if (classic >= 3) signals.push(sig("combo", 10, "Several classic scam signs appear together.", "कई जाने-पहचाने स्कैम संकेत एक साथ हैं।"));
  const reassurances: RiskSignal[] = [];
  if (REASSURE.test(t) && !signals.some((s) => s.id === "asks-code")) {
    reassurances.push(sig("warns-codes", 12, "Warns you never to share codes, as real banks do.", "कोड कभी न बताने की चेतावनी देता है, जैसा असली बैंक करते हैं।"));
  }
  const base = result(signals, reassurances);
  return { ...base, kind, scamType: suggestScamType(t), candidates };
}
