// npm run simulate -- --base http://localhost:8080 [--seed 7] [--licence] [--licence-seconds 20] [--clean]
//
// A randomised stand-in for the judges' test tool. It RESETS the server, posts real-looking and fake reports
// (random ids, networks, areas, notes in English, Hindi and Hinglish, times relative to now), queries every
// endpoint and prints a scorecard laid out like the rubric. Exit code 1 if any check fails.
// Our own generator is not the judges' generator: vary the seed, and add scenarios when you think of new tricks.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AREA_BY_PIN } from "../shared/areas.js";
import { normalizeIdentifier, type IdentifierType } from "../shared/normalize.js";
import { signLicence } from "../src/licence/licence.js";
import { formatIst } from "../src/lib/time.js";

// ---------- args, rng ----------
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const BASE = (arg("base") ?? process.env.BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const SEED = Number(arg("seed") ?? Math.floor(Math.random() * 1e9));
let s = SEED >>> 0;
const rnd = (): number => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a: number, b: number): number => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
const chance = (p: number): boolean => rnd() < p;
const hex = (n: number): string => Array.from({ length: n }, () => "0123456789abcdef"[int(0, 15)]).join("");
const shuffle = <T>(xs: T[]): T[] => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = int(0, i);
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
};
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const NOW = Date.now();

// ---------- generators ----------
const usedIps = new Set<string>();
const submittedSecrets = new Set<string>(); // reporter ids, ip prefixes and note fragments that must never leak
function newIp(): string {
  for (;;) {
    const ip = `${int(100, 223)}.${int(0, 255)}.${int(0, 255)}`;
    if (!usedIps.has(ip)) {
      usedIps.add(ip);
      return ip;
    }
  }
}
const newReporter = (): string => `r_${hex(8)}`;
const usedValues = new Set<string>();
function unique(gen: () => string): string {
  for (;;) {
    const v = gen();
    if (!usedValues.has(v)) {
      usedValues.add(v);
      return v;
    }
  }
}
const newMobile = (): string => unique(() => `${pick(["6", "7", "8", "9"])}${String(int(0, 999_999_999)).padStart(9, "0")}`);
const newLandline = (): string => unique(() => `+91 80 ${int(2000, 4999)} ${String(int(0, 9999)).padStart(4, "0")}`);
const newUpi = (): string => unique(() => `${pick(["refund", "kyc", "help", "pay", "cash", "win"])}.${hex(4)}${int(1, 99)}@${pick(["ybl", "okaxis", "paytm", "okhdfcbank", "ibl", "axl"])}`);
const newUrl = (): string => unique(() => `https://${pick(["sbi", "hdfc", "icici", "axis", "kotak", "bescom", "india-post"])}-${pick(["kyc", "update", "verify", "refund", "reward"])}-${hex(4)}.${pick(["in", "com", "top", "xyz", "co.in"])}/${pick(["login", "pay", "verify", "kyc", "claim"])}`);
const newSender = (): string => unique(() => `${pick(["VM", "AD", "JD", "BZ"])}-${Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPRSTUVWXYZ"[int(0, 22)]).join("")}`);

const AMOUNTS = ["5,000", "12,500", "25,000", "49,999", "80,000", "1.2 lakh", "2 lakh", "3,40,000"];
const WHO: Record<string, string[]> = {
  "digital-arrest": ["a man in police uniform", "someone claiming to be from CBI", "a so-called Mumbai cyber cell officer", "an officer from the narcotics bureau", "a fake customs inspector"],
  "otp-call": ["a caller from the card department", "someone saying he is from SBI card verification", "a lady claiming to be from my bank"],
  "fake-kyc-link": ["an SMS saying my KYC expired", "a message pretending to be my bank"],
  "job-offer": ["a recruiter on WhatsApp", "a Telegram HR person"],
  "upi-refund-qr": ["a buyer on OLX", "someone returning a payment"],
  other: ["an unknown caller", "a stranger"],
};
const DEMANDS = ["asked me to transfer {amt} to clear my name", "said I must pay {amt} today", "wanted the OTP that came on my phone", "kept us on the call for {hrs} hours", "asked me to install AnyDesk", "threatened to freeze my account", "sent a QR code and asked for my PIN"];
const OUTCOMES = ["I hung up.", "We lost {amt}.", "I did not pay.", "My son stopped me in time.", "They already knew my Aadhaar number.", "The number kept calling back.", "Reported it to 1930.", "Bank froze part of it."];
const HL = ["Mujhe call aaya, {who} bol raha tha", "Unhone bola {amt} bhejo warna case ho jayega", "Video call pe {hrs} ghante rakha", "OTP maang raha tha bar bar", "Maine phone kaat diya", "Bahut darr gaye the hum", "Pehle {hrs} baje message aaya phir call", "Mere {rel} ke phone pe aaya tha", "Bola aapke naam pe {thing} mila hai", "Unke paas mera {id} number tha", "{day} sham ko hua ye sab"];
const HI = ["मुझे एक अनजान नंबर से कॉल आया", "उसने कहा कि वह पुलिस से है", "{amt} रुपये भेजने को बोला", "वीडियो कॉल पर {hrs} घंटे तक रोके रखा", "मैंने कॉल काट दिया", "उसे मेरा आधार नंबर पता था", "मेरी माँ बहुत डर गईं", "बोला किसी को मत बताना", "मेरे {relhi} के फ़ोन पर आया था", "{dayhi} शाम {hrs} बजे की बात है", "कहा कि आपके नाम पर {thinghi} पकड़ा गया है"];

function fill(t: string, scam: string): string {
  return t
    .replace("{amt}", `Rs ${pick(AMOUNTS)}`)
    .replace("{hrs}", String(int(1, 9)))
    .replace("{who}", pick(WHO[scam] ?? WHO.other ?? ["someone"]))
    .replace("{rel}", pick(["papa", "mummy", "bhai", "nani", "uncle", "wife"]))
    .replace("{relhi}", pick(["पापा", "माँ", "भाई", "नानी", "चाचा", "पत्नी"]))
    .replace("{thing}", pick(["parcel", "drugs ka packet", "fake passport", "sim card"]))
    .replace("{thinghi}", pick(["पार्सल", "ड्रग्स", "नकली पासपोर्ट", "सिम कार्ड"]))
    .replace("{id}", pick(["Aadhaar", "PAN", "bank account"]))
    .replace("{day}", pick(["Kal", "Parso", "Somvar", "Shanivar"]))
    .replace("{dayhi}", pick(["कल", "परसों", "सोमवार", "शनिवार"]));
}
/** A first-hand note in the reporter's own words. emptyRate controls how many leave it blank. */
function realNote(scam: string, emptyRate = 0.2): string {
  if (chance(emptyRate)) return "";
  const lang = rnd();
  if (lang < 0.5) {
    const who = pick(WHO[scam] ?? WHO.other ?? ["someone"]);
    const parts = [`${pick(["Got a call from", "My mother got a call from", "Received a WhatsApp video call from", "A number called pretending to be", "Yesterday evening I got a call from"])} ${who}`, fill(pick(DEMANDS), scam), fill(pick(OUTCOMES), scam)];
    if (chance(0.5)) parts.push(`It was around ${int(1, 11)} ${pick(["am", "pm"])}.`);
    return parts.join(", ");
  }
  const pool = lang < 0.75 ? HL : HI;
  return shuffle([...pool]).slice(0, int(2, 4)).map((t) => fill(t, scam)).join(lang < 0.75 ? ", " : "। ");
}

// ---------- http ----------
interface Resp {
  status: number;
  json: Record<string, unknown>;
  text: string;
  ms: number;
}
const responseLog: string[] = [];
async function call(method: "GET" | "POST", p: string, body?: unknown): Promise<Resp> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  responseLog.push(text);
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json, text, ms };
}
const lookup = (type: string, value: string, extra = ""): Promise<Resp> =>
  call("GET", `/lookup?type=${encodeURIComponent(type)}&value=${encodeURIComponent(value)}${extra}`);

interface Rep {
  type: IdentifierType;
  value: string;
  pin: string;
  occurredAt: number;
  reportedAt?: number;
  reporter?: string;
  ip?: string;
  scam?: string;
  channel?: string;
  note?: string;
  screenshot?: boolean;
  lost?: number;
}
let repCounter = 0;
const postTimes: number[] = [];
const statusCounts = new Map<number, number>();
function reportBody(r: Rep): Record<string, unknown> {
  const reporter = r.reporter ?? newReporter();
  const ip = r.ip ?? newIp();
  submittedSecrets.add(reporter);
  submittedSecrets.add(ip);
  if (r.note && r.note.length >= 20) submittedSecrets.add(r.note.slice(0, 20));
  const area = AREA_BY_PIN.get(r.pin);
  return {
    report_id: `sim_${SEED}_${++repCounter}`,
    occurred_at: formatIst(r.occurredAt),
    // Never in the future: the server rightly rejects that.
    reported_at: formatIst(Math.min(r.reportedAt ?? r.occurredAt + int(2, 90) * MIN, Date.now() - MIN)),
    reporter_id: reporter,
    ip_prefix: ip,
    channel: r.channel ?? (r.type === "url" ? "Fake website" : r.type === "upi" ? "UPI request" : r.type === "sender_id" ? "SMS or WhatsApp" : "Phone call"),
    scam_type: r.scam ?? "other",
    identifier_type: r.type,
    identifier_value: r.value,
    pincode: r.pin,
    locality: area?.locality ?? "",
    city: area?.city ?? "",
    note: r.note ?? "",
    has_screenshot: r.screenshot ?? false,
    amount_lost_inr: r.lost ?? 0,
  };
}
/** Posts in parallel batches and random order, like a real load: exercises per-identifier locking. */
async function postAll(reps: Rep[], concurrency = 8): Promise<Resp[]> {
  const queue = shuffle(reps.map((r, i) => ({ r, i })));
  const out: Resp[] = new Array(reps.length);
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const res = await call("POST", "/reports", reportBody(job.r));
        postTimes.push(res.ms);
        statusCounts.set(res.status, (statusCounts.get(res.status) ?? 0) + 1);
        out[job.i] = res;
      }
    }),
  );
  return out;
}

// ---------- checks ----------
type Row = "1 Stops fake reports" | "2 Lookup gives the right answer" | "3 Map and alerts" | "4 Privacy" | "5 Licence" | "Bonus" | "Extra features";
interface Check {
  row: Row;
  name: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
function check(row: Row, name: string, pass: boolean, detail = ""): void {
  checks.push({ row, name, pass, detail });
}
const v = (r: Resp): string => String(r.json.verdict ?? `HTTP ${r.status}`);
const dr = (r: Resp): number => Number(r.json.distinct_reporters ?? -1);
const flags = (r: Resp): string => {
  const e = r.json.explain as { flags?: string[] } | undefined;
  return (e?.flags ?? []).join(",");
};
const norm = (t: IdentifierType, val: string): string => {
  const n = normalizeIdentifier(t, val);
  return n.ok ? n.value : "";
};
const spreadDays = (days: number): number => NOW - int(2 * H, days * D);

const REAL_PINS = ["400050", "500081", "600020", "411014", "700091", "380015"];

async function main(): Promise<void> {
  console.log(`ScamMap simulator  base=${BASE}  seed=${SEED}`);
  const health = await call("GET", "/health");
  if (health.status !== 200) throw new Error(`/health returned ${health.status}`);
  const lic = await call("GET", "/license");
  if (lic.json.status !== "VALID") {
    console.error(`Licence status is ${String(lic.json.status)}: upload a licence first (npm run sign-licence -- --days 30 --upload ${BASE}).`);
    process.exit(1);
  }
  const reset = await call("POST", "/admin/reset");
  check("2 Lookup gives the right answer", "POST /admin/reset returns 200", reset.status === 200, `HTTP ${reset.status}`);

  // ===== Real scams =====
  const real7 = newMobile();
  await postAll(Array.from({ length: 7 }, () => ({ type: "phone" as const, value: real7, pin: pick(REAL_PINS), occurredAt: spreadDays(14), scam: "digital-arrest", note: realNote("digital-arrest") })));
  const l7 = await lookup("phone", `+91 ${real7.slice(0, 5)} ${real7.slice(5)}`);
  check("2 Lookup gives the right answer", "real scam, 7 people over 14 days -> KNOWN_SCAM", v(l7) === "KNOWN_SCAM", `${v(l7)} people=${dr(l7)} ${flags(l7)}`);
  check("2 Lookup gives the right answer", "real scam counts 7 distinct reporters", dr(l7) === 7, `distinct_reporters=${dr(l7)}`);
  check("4 Privacy", "7 reporters -> number shown in full", l7.json.display_value === `+91${real7}`, String(l7.json.display_value));

  const real3 = newMobile();
  const notes3 = [realNote("otp-call", 0), "", ""];
  await postAll(notes3.map((note) => ({ type: "phone" as const, value: real3, pin: pick(REAL_PINS), occurredAt: spreadDays(5), scam: "otp-call", note })));
  const l3 = await lookup("phone", `0${real3}`);
  check("2 Lookup gives the right answer", "real scam, exactly 3 people (2 empty notes) -> KNOWN_SCAM", v(l3) === "KNOWN_SCAM", `${v(l3)} ${flags(l3)}`);

  // Real victims who happen to use the same stock sentence, days apart, are still different people.
  const stock = newMobile();
  const stockNote = "Video call from a man in police uniform saying a parcel with drugs was found in my name";
  await postAll([9, 5, 1].map((d) => ({ type: "phone" as const, value: stock, pin: pick(REAL_PINS), occurredAt: NOW - d * D - int(1, 5) * H, scam: "digital-arrest", note: stockNote })));
  const lstock = await lookup("phone", stock);
  check("2 Lookup gives the right answer", "real scam, 3 people using the same stock sentence days apart -> KNOWN_SCAM", v(lstock) === "KNOWN_SCAM", `${v(lstock)} people=${dr(lstock)} ${flags(lstock)}`);

  const realUpi = newUpi();
  await postAll(Array.from({ length: 3 }, () => ({ type: "upi" as const, value: realUpi, pin: pick(REAL_PINS), occurredAt: spreadDays(6), scam: "upi-refund-qr", note: realNote("upi-refund-qr", 0.3) })));
  const lu = await lookup("upi", realUpi.toUpperCase());
  check("2 Lookup gives the right answer", "real UPI scam, 3 people -> KNOWN_SCAM", v(lu) === "KNOWN_SCAM", `${v(lu)} ${flags(lu)}`);

  const realUrl = newUrl();
  await postAll(Array.from({ length: 4 }, () => ({ type: "url" as const, value: realUrl, pin: pick(REAL_PINS), occurredAt: spreadDays(6), scam: "fake-kyc-link", note: realNote("fake-kyc-link", 0.3) })));
  const lurl = await lookup("url", `${realUrl.replace("https://", "http://www.")}/?utm=sms`);
  check("2 Lookup gives the right answer", "real phishing link, 4 people -> KNOWN_SCAM (looked up as http://www...?utm=)", v(lurl) === "KNOWN_SCAM", `${v(lurl)} ${flags(lurl)}`);

  const realSender = newSender();
  await postAll(Array.from({ length: 3 }, () => ({ type: "sender_id" as const, value: realSender, pin: pick(REAL_PINS), occurredAt: spreadDays(6), scam: "electricity-disconnection", note: realNote("other", 0.3) })));
  const ls = await lookup("sender_id", `${realSender}-S`);
  check("2 Lookup gives the right answer", "real SMS sender, 3 people -> KNOWN_SCAM (looked up with -S suffix)", v(ls) === "KNOWN_SCAM", `${v(ls)} ${flags(ls)}`);

  // Digital-arrest wave: 15 unrelated people in HSR Layout within 20 hours, on two numbers.
  const waveA = newMobile();
  const waveB = newMobile();
  await postAll(Array.from({ length: 15 }, (_, k) => ({ type: "phone" as const, value: k < 8 ? waveA : waveB, pin: "560102", occurredAt: NOW - int(20, 20 * 60) * MIN, scam: "digital-arrest", note: realNote("digital-arrest", 0.15) })));
  const lwA = await lookup("phone", waveA);
  const lwB = await lookup("phone", waveB);
  check("2 Lookup gives the right answer", "digital-arrest wave (15 people / 24 h) -> both numbers KNOWN_SCAM", v(lwA) === "KNOWN_SCAM" && v(lwB) === "KNOWN_SCAM", `${v(lwA)}/${v(lwB)} ${flags(lwA)} ${flags(lwB)}`);

  // Format equivalence: six spellings of one number must give the same answer.
  const spell = [`+91 ${real3.slice(0, 5)} ${real3.slice(5)}`, `0${real3}`, `91${real3}`, `${real3.slice(0, 5)}-${real3.slice(5)}`, real3, `+91-${real3.slice(0, 3)}-${real3.slice(3, 6)}-${real3.slice(6)}`];
  const spellRes = await Promise.all(spell.map((x) => lookup("phone", x)));
  const sig = (r: Resp): string => JSON.stringify([r.json.verdict, r.json.report_count, r.json.distinct_reporters, r.json.display_value, r.json.first_seen]);
  check("2 Lookup gives the right answer", "6 spellings of one phone number give identical answers", new Set(spellRes.map(sig)).size === 1, spellRes.map(sig)[0] ?? "");
  const rawPlus = await call("GET", `/lookup?type=phone&value=+91 ${real3.slice(0, 5)} ${real3.slice(5)}`);
  check("2 Lookup gives the right answer", "unencoded '+' (arrives as a space) still matches", sig(rawPlus) === sig(spellRes[0] as Resp), v(rawPlus));
  const sAlt = await Promise.all([realSender, `AD-${realSender.slice(3)}`, realSender.slice(3).toLowerCase(), `VM${realSender.slice(3)}`].map((x) => lookup("sender_id", x)));
  check("2 Lookup gives the right answer", "sender ID spellings (AD-, VM-, lower case, -S) match", new Set([...sAlt, ls].map(sig)).size === 1, sAlt.map(v).join(","));

  // Unreported identifiers.
  const unrep = await Promise.all([
    lookup("phone", newMobile()), lookup("phone", newLandline()), lookup("upi", newUpi()), lookup("url", newUrl()), lookup("sender_id", newSender()),
  ]);
  check("2 Lookup gives the right answer", "5 never-reported identifiers -> 200 NO_REPORTS", unrep.every((r) => r.status === 200 && v(r) === "NO_REPORTS"), unrep.map((r) => `${r.status}:${v(r)}`).join(","));
  const bad = await Promise.all([lookup("phone", "12345"), lookup("phone", "test"), lookup("upi", "not-an-id"), lookup("url", "test"), lookup("sender_id", "AB")]);
  check("2 Lookup gives the right answer", "impossible values (12345, test, ...) -> 400", bad.every((r) => r.status === 400), bad.map((r) => r.status).join(","));

  // ===== Fake reports =====
  const bombPin1 = "560038";
  const bakery = newLandline();
  const base = "This bakery is a fraud they cheated me do not buy from them";
  const variants = (k: number): string => {
    let t = k % 3 === 0 ? base.toUpperCase() : k % 3 === 1 ? base.toLowerCase() : base;
    if (k % 4 === 0) t += "!!";
    if (k % 5 === 0) t = t.replace(/bakery/i, "shop");
    if (k % 7 === 0) t = `${t} please share`;
    return t;
  };
  const bombStart = NOW - 3 * H;
  await postAll(Array.from({ length: 40 }, (_, k) => ({ type: "phone" as const, value: bakery, pin: bombPin1, occurredAt: bombStart + k * 70_000, reportedAt: bombStart + k * 70_000 + int(0, 5) * MIN, scam: "other", note: variants(k) })));
  const lb = await lookup("phone", bakery);
  check("1 Stops fake reports", "40 friends, copy-pasted notes in 1 h -> not KNOWN_SCAM", v(lb) !== "KNOWN_SCAM", `${v(lb)} people=${dr(lb)} ${flags(lb)}`);

  const bombPin2 = "560037";
  const shop2 = newLandline();
  await postAll(Array.from({ length: 40 }, (_, k) => ({ type: "phone" as const, value: shop2, pin: bombPin2, occurredAt: NOW - 2 * H + k * 80_000, scam: "other", note: "" })));
  const lb2 = await lookup("phone", shop2);
  check("1 Stops fake reports", "40 friends, empty notes, all different networks, 1 h -> not KNOWN_SCAM", v(lb2) !== "KNOWN_SCAM", `${v(lb2)} people=${dr(lb2)} ${flags(lb2)}`);

  const bombPin3 = "560103";
  const shop3 = newLandline();
  await postAll(Array.from({ length: 30 }, (_, k) => ({ type: "phone" as const, value: shop3, pin: bombPin3, occurredAt: NOW - 6 * H + k * 90_000, scam: "other", note: pick(["scam", "fraud", "fake shop", "cheater", "do not trust", "FRAUD!!!"]) })));
  const lb3 = await lookup("phone", shop3);
  check("1 Stops fake reports", "30 friends, one-word notes ('fraud', 'scam') -> not KNOWN_SCAM", v(lb3) !== "KNOWN_SCAM", `${v(lb3)} people=${dr(lb3)} ${flags(lb3)}`);

  const bombPin4 = "560100";
  const shop4 = newLandline();
  await postAll(Array.from({ length: 40 }, () => ({ type: "phone" as const, value: shop4, pin: bombPin4, occurredAt: NOW - int(1, 4 * 24) * H, scam: "other", note: "" })));
  const lb4 = await lookup("phone", shop4);
  check("1 Stops fake reports", "40 empty-note reports spread over 4 days (no burst) -> not KNOWN_SCAM", v(lb4) !== "KNOWN_SCAM", `${v(lb4)} people=${dr(lb4)} ${flags(lb4)}`);

  const bombPin5 = "560078";
  const shop5 = newLandline();
  await postAll(Array.from({ length: 25 }, (_, k) => ({ type: "phone" as const, value: shop5, pin: bombPin5, occurredAt: NOW - int(1, 48) * H, scam: "other", note: variants(k).replace("do not", pick(["never", "don't", "do not"])) })));
  const lb5 = await lookup("phone", shop5);
  check("1 Stops fake reports", "25 copy-paste notes with small edits, spread over 2 days -> not KNOWN_SCAM", v(lb5) !== "KNOWN_SCAM", `${v(lb5)} people=${dr(lb5)} ${flags(lb5)}`);

  const sybilPin = "560076";
  const sybilNum = newMobile();
  const wifi = newIp();
  await postAll(Array.from({ length: 22 }, () => ({ type: "phone" as const, value: sybilNum, pin: sybilPin, ip: wifi, occurredAt: NOW - int(5, 120) * MIN, scam: "digital-arrest", note: realNote("digital-arrest", 0) })));
  const lsy = await lookup("phone", sybilNum);
  check("1 Stops fake reports", "22 accounts on one Wi-Fi (own-words notes) -> not KNOWN_SCAM", v(lsy) !== "KNOWN_SCAM", `${v(lsy)} people=${dr(lsy)} ${flags(lsy)}`);
  check("1 Stops fake reports", "22 accounts on one Wi-Fi count as 1 person", dr(lsy) === 1, `distinct_reporters=${dr(lsy)}`);
  check("4 Privacy", "sybil-reported number stays masked", /^\d{2}X+\d{3}$/.test(String(lsy.json.display_value)), String(lsy.json.display_value));

  const sybil2 = newMobile();
  const wifi2 = newIp();
  await postAll(Array.from({ length: 22 }, (_, k) => ({ type: "phone" as const, value: sybil2, pin: sybilPin, ip: wifi2, occurredAt: NOW - k * 3 * H - int(0, 60) * MIN, scam: "otp-call", note: realNote("otp-call", 0.3) })));
  const lsy2 = await lookup("phone", sybil2);
  check("1 Stops fake reports", "22 accounts on one Wi-Fi spread over 3 days -> 1 person, not KNOWN_SCAM", v(lsy2) !== "KNOWN_SCAM" && dr(lsy2) === 1, `${v(lsy2)} people=${dr(lsy2)} ${flags(lsy2)}`);

  // One host cycling through fake ip_prefix values inside one /16 block, a new /24 for every account, minutes apart.
  const cycleNum = newMobile();
  const block = `${int(11, 99)}.${int(0, 255)}`;
  const cycleStart = NOW - 40 * MIN;
  await postAll(Array.from({ length: 12 }, (_, k) => ({ type: "phone" as const, value: cycleNum, pin: sybilPin, ip: `${block}.${(k * 17 + 3) % 256}`, occurredAt: cycleStart + k * 90_000, reportedAt: cycleStart + k * 90_000 + 20_000, scam: "digital-arrest", note: realNote("digital-arrest", 0) })));
  const lcy = await lookup("phone", cycleNum);
  check("1 Stops fake reports", "12 accounts cycling /24 prefixes in one /16 within minutes -> 1 person, not KNOWN_SCAM", v(lcy) !== "KNOWN_SCAM" && dr(lcy) === 1, `${v(lcy)} people=${dr(lcy)} ${flags(lcy)}`);

  const spamPin = "560011";
  const spamNum = newMobile();
  const spammer = newReporter();
  const spamIp = newIp();
  const spamRes = await postAll(Array.from({ length: 6 }, (_, k) => ({ type: "phone" as const, value: spamNum, pin: spamPin, reporter: spammer, ip: spamIp, occurredAt: NOW - 50 * MIN + k * 8 * MIN, reportedAt: NOW - 50 * MIN + k * 8 * MIN + int(1, 3) * MIN, scam: "job-offer", note: realNote("job-offer", 0) })), 1);
  const lsp = await lookup("phone", spamNum);
  check("1 Stops fake reports", "one person reporting 6 times in 1 h -> not KNOWN_SCAM", v(lsp) !== "KNOWN_SCAM", `${v(lsp)} statuses=${spamRes.map((r) => r.status).join(",")}`);
  check("1 Stops fake reports", "one person reporting 6 times counts as 1", dr(lsp) === 1, `distinct_reporters=${dr(lsp)}`);

  // Junk must be rejected with 400.
  const okBody = (): Rep => ({ type: "phone", value: newMobile(), pin: "560066", occurredAt: NOW - H, scam: "other", note: "" });
  const junk: Array<[string, Record<string, unknown>]> = [
    ["phone 12345", { ...reportBody(okBody()), identifier_value: "12345" }],
    ["phone 'test'", { ...reportBody(okBody()), identifier_value: "test" }],
    ["phone 0000000000", { ...reportBody(okBody()), identifier_value: "0000000000" }],
    ["phone +91 99999 99999", { ...reportBody(okBody()), identifier_value: "+91 99999 99999" }],
    ["upi 'test'", { ...reportBody(okBody()), identifier_type: "upi", identifier_value: "test" }],
    ["upi test@ybl", { ...reportBody(okBody()), identifier_type: "upi", identifier_value: "test@ybl" }],
    ["url 'test'", { ...reportBody(okBody()), identifier_type: "url", identifier_value: "test" }],
    ["url 'http://'", { ...reportBody(okBody()), identifier_type: "url", identifier_value: "http://" }],
    ["sender 'AB'", { ...reportBody(okBody()), identifier_type: "sender_id", identifier_value: "AB" }],
    ["type 'email'", { ...reportBody(okBody()), identifier_type: "email" }],
    ["pincode 999999", { ...reportBody(okBody()), pincode: "999999" }],
    ["pincode 12345", { ...reportBody(okBody()), pincode: "12345" }],
    ["time 'yesterday'", { ...reportBody(okBody()), occurred_at: "yesterday" }],
    ["time 2026-13-45", { ...reportBody(okBody()), occurred_at: "2026-13-45T10:00:00+05:30" }],
    ["time in 3 days", { ...reportBody(okBody()), occurred_at: formatIst(NOW + 3 * D) }],
    ["missing reporter_id", { ...reportBody(okBody()), reporter_id: "" }],
  ];
  const junkRes = await Promise.all(junk.map(([, b]) => call("POST", "/reports", b)));
  const junkFail = junk.filter((_, i) => junkRes[i]?.status !== 400).map(([n], i) => `${n}=${junkRes[i]?.status}`);
  check("1 Stops fake reports", `${junk.length} junk reports rejected with 400`, junkFail.length === 0, junkFail.join(" ") || "all 400");

  // A real scam with a spammer and a sybil ring piled on top must still be caught.
  const mixPin = "302017";
  const mixed = newMobile();
  const ringIp = newIp();
  const mixedSpammer = newReporter();
  await postAll([
    ...Array.from({ length: 5 }, () => ({ type: "phone" as const, value: mixed, pin: mixPin, occurredAt: spreadDays(10), scam: "fake-customer-care", note: realNote("other", 0.2) })),
    ...Array.from({ length: 6 }, (_, k) => ({ type: "phone" as const, value: mixed, pin: mixPin, reporter: mixedSpammer, ip: newIp(), occurredAt: NOW - 55 * MIN + k * 9 * MIN, scam: "fake-customer-care", note: "same person again" })),
    ...Array.from({ length: 10 }, () => ({ type: "phone" as const, value: mixed, pin: mixPin, ip: ringIp, occurredAt: NOW - int(10, 100) * MIN, scam: "fake-customer-care", note: "" })),
  ]);
  const lmix = await lookup("phone", mixed);
  check("1 Stops fake reports", "real scam (5 people) + spammer + sybil ring on top -> still KNOWN_SCAM", v(lmix) === "KNOWN_SCAM", `${v(lmix)} people=${dr(lmix)} ${flags(lmix)}`);

  // Report-bombing a verified business.
  await postAll(Array.from({ length: 40 }, (_, k) => ({ type: "phone" as const, value: "+91 80 4100 2233", pin: bombPin1, occurredAt: NOW - 2 * H + k * 60_000, scam: "other", note: variants(k) })));
  const lfb = await lookup("phone", "080-4100-2233");
  check("1 Stops fake reports", "40 reports against verified Fresh Bakes -> VERIFIED_BUSINESS", v(lfb) === "VERIFIED_BUSINESS", v(lfb));

  // ===== Map and alerts =====
  const alertsFor = async (pin: string): Promise<Array<Record<string, unknown>>> =>
    ((await call("GET", `/alerts?pincode=${pin}`)).json.alerts as Array<Record<string, unknown>> | undefined) ?? [];
  const a102 = await alertsFor("560102");
  check("3 Map and alerts", "area with a sudden jump (HSR Layout) gets a SPIKE alert", a102.some((a) => a.type === "SPIKE"), JSON.stringify(a102.map((a) => [a.type, a.count, a.baseline_per_day])));

  const normalPin = "560034";
  const steady: Rep[] = [];
  for (let d = 1; d <= 8; d++) for (let k = 0; k < 2; k++) steady.push({ type: "phone", value: newMobile(), pin: normalPin, occurredAt: NOW - d * D - int(1, 20) * H, scam: k ? "otp-call" : "fake-kyc-link", note: realNote("otp-call") });
  steady.push({ type: "phone", value: newMobile(), pin: normalPin, occurredAt: NOW - 3 * H, scam: "otp-call", note: realNote("otp-call") });
  steady.push({ type: "phone", value: newMobile(), pin: normalPin, occurredAt: NOW - 9 * H, scam: "fake-kyc-link", note: realNote("fake-kyc-link") });
  await postAll(steady);
  const a034 = await alertsFor(normalPin);
  check("3 Map and alerts", "normal area (steady 2 a day) gets no alert", a034.length === 0, JSON.stringify(a034.map((a) => a.type)));

  const newTypePin = "560066";
  const nt: Rep[] = [];
  for (let d = 1; d <= 7; d++) nt.push({ type: "phone", value: newMobile(), pin: newTypePin, occurredAt: NOW - d * D - 2 * H, scam: "otp-call", note: realNote("otp-call") });
  nt.push({ type: "phone", value: newMobile(), pin: newTypePin, occurredAt: NOW - 4 * H, scam: "job-offer", note: realNote("job-offer", 0) });
  await postAll(nt);
  const a066 = await alertsFor(newTypePin);
  check("3 Map and alerts", "new kind of scam (job-offer in Whitefield) gets a NEW_TYPE alert", a066.some((a) => a.type === "NEW_TYPE" && a.scam_type === "job-offer"), JSON.stringify(a066.map((a) => [a.type, a.scam_type])));
  check("3 Map and alerts", "...and no SPIKE there", !a066.some((a) => a.type === "SPIKE"), "");

  const oldPin = "110016";
  const oldRes = await postAll(Array.from({ length: 4 }, () => ({ type: "phone" as const, value: newMobile(), pin: oldPin, occurredAt: NOW - int(32, 40) * D, scam: "lottery-prize", note: realNote("lottery-prize") })));
  check("3 Map and alerts", "month-old reports are accepted (201)", oldRes.every((r) => r.status === 201), oldRes.map((r) => r.status).join(","));
  const mOld = await call("GET", `/map?pincode=${oldPin}&days=7&radius_km=2`);
  const oldClusters = (mOld.json.clusters as Array<Record<string, unknown>> | undefined) ?? [];
  check("3 Map and alerts", "month-old reports are not on the map", !oldClusters.some((c) => c.pincode === oldPin), JSON.stringify(oldClusters));

  const m2 = await call("GET", "/map?pincode=560102&days=7&radius_km=2");
  const mDefault = await call("GET", "/map?pincode=560102");
  const m10 = await call("GET", "/map?pincode=560102&days=7&radius_km=10");
  const pins = (r: Resp): string[] => ((r.json.clusters as Array<Record<string, unknown>> | undefined) ?? []).map((c) => String(c.pincode));
  check("3 Map and alerts", "radius 2 km around HSR shows only HSR", JSON.stringify(pins(m2)) === JSON.stringify(["560102"]), pins(m2).join(","));
  check("3 Map and alerts", "missing days/radius default to 7 and 2", JSON.stringify(pins(mDefault)) === JSON.stringify(pins(m2)), pins(mDefault).join(","));
  check("3 Map and alerts", "radius 10 km includes Koramangala", pins(m10).includes("560034"), pins(m10).join(","));
  const allClusters = (m10.json.clusters as Array<Record<string, unknown>> | undefined) ?? [];
  check("3 Map and alerts", "every cluster sits on its area's official point", allClusters.every((c) => {
    const a = AREA_BY_PIN.get(String(c.pincode));
    return a !== undefined && c.lat === a.lat && c.lng === a.lng;
  }), "");
  const hsr = allClusters.find((c) => c.pincode === "560102");
  check("3 Map and alerts", "HSR cluster counts (nearly) the whole wave with severity CRIT", Number(hsr?.count) >= 12 && hsr?.severity === "CRIT", JSON.stringify(hsr));

  // Bonus: fake reports never set off an alert.
  const fakeAreas = [bombPin1, bombPin2, bombPin3, bombPin4, bombPin5, sybilPin, spamPin];
  const fakeAlerts = await Promise.all(fakeAreas.map(alertsFor));
  check("Bonus", "fake reports set off no alerts (7 attacked areas)", fakeAlerts.every((a) => a.length === 0), fakeAreas.map((p, i) => `${p}:${fakeAlerts[i]?.map((a) => a.type).join("+") || "none"}`).join(" "));
  const mFake = await Promise.all(fakeAreas.map((p) => call("GET", `/map?pincode=${p}&radius_km=0`)));
  check("Bonus", "fake reports do not inflate the map", mFake.every((r) => ((r.json.clusters as unknown[] | undefined) ?? []).length === 0), mFake.map((r, i) => `${fakeAreas[i]}:${((r.json.clusters as unknown[] | undefined) ?? []).length}`).join(" "));

  // ===== Privacy =====
  const two = newMobile();
  await postAll(Array.from({ length: 2 }, () => ({ type: "phone" as const, value: two, pin: "226010", occurredAt: spreadDays(3), scam: "otp-call", note: realNote("otp-call") })));
  const l2 = await lookup("phone", two);
  check("4 Privacy", "2 reporters -> phone masked like 98XXXXX210", /^\d{2}X{5}\d{3}$/.test(String(l2.json.display_value)), String(l2.json.display_value));
  const oneUpi = newUpi();
  const oneUrl = newUrl();
  const oneSender = newSender();
  await postAll([
    { type: "upi", value: oneUpi, pin: "682030", occurredAt: NOW - D, scam: "upi-refund-qr", note: "" },
    { type: "url", value: oneUrl, pin: "682030", occurredAt: NOW - D, scam: "fake-kyc-link", note: "" },
    { type: "sender_id", value: oneSender, pin: "682030", occurredAt: NOW - D, scam: "other", note: "" },
  ]);
  const [lU, lL, lS] = await Promise.all([lookup("upi", oneUpi), lookup("url", oneUrl), lookup("sender_id", oneSender)]);
  check("4 Privacy", "1 reporter -> UPI masked like r***@okaxis", /^.\*\*\*@[a-z0-9]+$/.test(String(lU?.json.display_value)), String(lU?.json.display_value));
  check("4 Privacy", "1 reporter -> link masked like sbi***.in/...", /\*\*\*\./.test(String(lL?.json.display_value)) && !String(lL?.json.display_value).includes(norm("url", oneUrl).replace("https://", "")), String(lL?.json.display_value));
  check("4 Privacy", "1 reporter -> sender masked like HD****", /^[A-Z0-9]{2}\*{4}$/.test(String(lS?.json.display_value)), String(lS?.json.display_value));
  const evidenceKeys = new Set<string>();
  for (const r of [l7, l3, lmix, lwA, lb, lsy]) for (const e of (r.json.evidence as Array<Record<string, unknown>> | undefined) ?? []) Object.keys(e).forEach((k) => evidenceKeys.add(k));
  check("4 Privacy", "evidence only has occurred_at, channel, scam_type, pincode", [...evidenceKeys].every((k) => ["occurred_at", "channel", "scam_type", "pincode"].includes(k)), [...evidenceKeys].join(","));
  const wording = responseLog.filter((t) => /"message_(en|hi)":"[^"]*(fraud|scammer|criminal|cheat)/i.test(t));
  check("4 Privacy", "result wording never says fraud / scammer", wording.length === 0, `${wording.length} bad messages`);
  const clusterKeys = new Set<string>();
  for (const c of allClusters) Object.keys(c).forEach((k) => clusterKeys.add(k));
  check("4 Privacy", "map clusters carry only area-level fields", [...clusterKeys].every((k) => ["pincode", "locality", "city", "count", "top_scam_type", "severity", "lat", "lng", "spike"].includes(k)), [...clusterKeys].join(","));

  // Personal-number protection: one person can never label a number publicly.
  const personal = newMobile();
  await postAll([{ type: "phone", value: personal, pin: "560034", occurredAt: NOW - 2 * H, scam: "other", note: realNote("other", 0) }]);
  const lp1 = await lookup("phone", personal);
  check("4 Privacy", "1 person reports a number -> public verdict stays NO_REPORTS (awaiting confirmation)", v(lp1) === "NO_REPORTS" && lp1.json.confirmation === "awaiting_confirmation" && (lp1.json.evidence as unknown[]).length === 0, `${v(lp1)} ${String(lp1.json.confirmation)}`);
  await postAll([{ type: "phone", value: personal, pin: "560038", occurredAt: NOW - 30 * H, scam: "other", note: realNote("other", 0) }]);
  const lp2 = await lookup("phone", personal);
  check("4 Privacy", "a 2nd unrelated person -> SUSPICIOUS, number still masked", v(lp2) === "SUSPICIOUS" && /X/.test(String(lp2.json.display_value)), `${v(lp2)} ${String(lp2.json.display_value)}`);
  const grudge = newMobile();
  await postAll(["My ex boyfriend keeps calling from this number, he owes me money", "This is my ex husband's number, report him, revenge", "He owes me money and blocked me, my ex"].map((note, k) => ({ type: "phone" as const, value: grudge, pin: "560010", occurredAt: NOW - (k + 1) * 30 * H, scam: "other", note })));
  const lg = await lookup("phone", grudge);
  check("4 Privacy", "3 'my ex / owes me money' grudge reports -> stays NO_REPORTS (private)", v(lg) === "NO_REPORTS", `${v(lg)} ${flags(lg)}`);

  // ===== Bonus: verified list and disputes =====
  const verifiedSpellings: Array<[IdentifierType, string]> = [
    ["phone", "1930"], ["phone", "1909"], ["phone", "1800-1600"], ["phone", "18002600"], ["phone", "1800 1080"], ["phone", "+91 1800 1234"],
    ["phone", "1800 2100"], ["phone", "1860-419-5555"], ["phone", "1860 266 2666"], ["phone", "08041002233"], ["phone", "+91 80 2553 0190"],
    ["sender_id", "AD-HDFCBK"], ["sender_id", "icicib"], ["sender_id", "VM-SBIINB-T"], ["sender_id", "AXISBK"], ["sender_id", "JD-KOTAKB"],
    ["url", "http://www.cybercrime.gov.in/"], ["url", "https://sancharsaathi.gov.in/?ref=sms"], ["upi", "FreshBakes@OKAXIS"],
  ];
  const ver = await Promise.all(verifiedSpellings.map(([t, x]) => lookup(t, x)));
  const verBad = verifiedSpellings.filter((_, i) => v(ver[i] as Resp) !== "VERIFIED_BUSINESS").map(([t, x]) => `${t}:${x}`);
  check("Bonus", `all ${verifiedSpellings.length} verified numbers/senders/links -> VERIFIED_BUSINESS`, verBad.length === 0, verBad.join(" ") || "all verified");

  const disputed = newMobile();
  await postAll(Array.from({ length: 4 }, () => ({ type: "phone" as const, value: disputed, pin: pick(REAL_PINS), occurredAt: spreadDays(6), scam: "fake-customer-care", note: realNote("other", 0) })));
  const before = await lookup("phone", disputed);
  const ch = await call("POST", "/challenges", { identifier_type: "phone", identifier_value: `+91 ${disputed}`, claimant_name: "Test Shop", contact_email: "owner@example.com", proof_note: "GST certificate attached" });
  const after = await lookup("phone", disputed);
  check("Bonus", "POST /challenges -> 201 under_review", ch.status === 201 && ch.json.status === "under_review", `${ch.status} ${String(ch.json.status)}`);
  check("Bonus", "challenged number shows challenged:true and is never KNOWN_SCAM", after.json.challenged === true && v(after) !== "KNOWN_SCAM", `before=${v(before)} after=${v(after)} challenged=${String(after.json.challenged)}`);
  check("4 Privacy", "challenge contact_email is never returned", !responseLog.some((t) => t.includes("owner@example.com")), "");

  // ===== Leak scan and speed =====
  const leaks = [...submittedSecrets].filter((sec) => responseLog.some((t) => t.includes(sec)));
  check("4 Privacy", `leak scan: ${submittedSecrets.size} reporter ids, networks and notes never appear in any reply`, leaks.length === 0, leaks.slice(0, 5).join(" | "));

  const targets: Array<[IdentifierType, string]> = [["phone", real7], ["phone", bakery], ["upi", realUpi], ["url", realUrl], ["sender_id", realSender], ["phone", "1930"]];
  const times: number[] = [];
  const jobs = Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? (["phone", newMobile()] as [IdentifierType, string]) : pick(targets)));
  await Promise.all(Array.from({ length: 10 }, async () => {
    for (let j = jobs.shift(); j; j = jobs.shift()) times.push((await lookup(j[0], j[1])).ms);
  }));
  times.sort((a, b) => a - b);
  const pct = (p: number): number => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))] ?? 0;
  check("2 Lookup gives the right answer", `300 lookups: p50 ${pct(50).toFixed(0)} ms, p95 ${pct(95).toFixed(0)} ms, p99 ${pct(99).toFixed(0)} ms (< 500 ms)`, pct(99) < 500, "");

  // ===== Extras: message analysis, analytics, briefing =====
  const scamText = `This is CBI officer. A parcel with drugs is booked on your Aadhaar. You are under digital arrest. Do not tell anyone. Call +91 ${real7.slice(0, 5)} ${real7.slice(5)} and pay the security deposit now.`;
  const an = await call("POST", "/analyze", { text: scamText });
  const anIds = (an.json.identifiers as Array<Record<string, unknown>> | undefined) ?? [];
  check("Extra features", "POST /analyze: digital-arrest message -> high risk, finds the reported number", an.status === 200 && an.json.level === "high" && anIds.some((i) => i.verdict === "KNOWN_SCAM"), `${an.status} ${String(an.json.level)} ${String(an.json.score)}`);
  const anOk = await call("POST", "/analyze", { text: "Hi, are we still meeting for lunch tomorrow at 1? I'll book the table." });
  check("Extra features", "POST /analyze: ordinary message -> no rule-based red flags", anOk.status === 200 && ((anOk.json.signals as unknown[]) ?? [1]).length === 0, `${String(anOk.json.level)}`);
  const st = await call("GET", "/stats?days=30");
  const tot = st.json.totals as Record<string, number> | undefined;
  check("Extra features", "GET /stats: analytics with trusted, set-aside and rejected counts", st.status === 200 && Boolean(tot) && (tot?.counted ?? 0) > 0 && (tot?.set_aside ?? 0) > 0 && (tot?.rejected ?? 0) > 0, JSON.stringify(tot));
  const br = await call("GET", "/insights/briefing?days=7");
  check("Extra features", "GET /insights/briefing: written summary (Gemini or rules)", br.status === 200 && typeof br.json.headline_en === "string" && Array.isArray(br.json.insights), `${String(br.json.source)}`);

  // ===== Licence (optional, needs keys/private.pem) =====
  if (process.argv.includes("--licence")) await licenceDemo([real7, "KNOWN_SCAM"]);

  if (process.argv.includes("--clean")) {
    await call("POST", "/admin/reset");
    const gone = await lookup("phone", real7);
    check("2 Lookup gives the right answer", "after reset the real scam is gone (NO_REPORTS)", v(gone) === "NO_REPORTS", v(gone));
  }

  // ===== Scorecard =====
  const rows: Array<[Row, number]> = [["1 Stops fake reports", 20], ["2 Lookup gives the right answer", 15], ["3 Map and alerts", 10], ["4 Privacy", 15], ["5 Licence", 15], ["Bonus", 0], ["Extra features", 0]];
  let failed = 0;
  console.log("");
  for (const [row, pts] of rows) {
    const cs = checks.filter((c) => c.row === row);
    if (cs.length === 0) continue;
    const passed = cs.filter((c) => c.pass).length;
    failed += cs.length - passed;
    const est = pts ? `  ~${((pts * passed) / cs.length).toFixed(1)}/${pts} pts` : "";
    console.log(`${row.padEnd(34)} ${passed}/${cs.length} checks${est}`);
    for (const c of cs) console.log(`   ${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail && (!c.pass || process.argv.includes("--verbose")) ? `   [${c.detail}]` : ""}`);
  }
  const avgPost = postTimes.reduce((a, b) => a + b, 0) / Math.max(1, postTimes.length);
  console.log(`\nPOST /reports: ${postTimes.length} sent, statuses ${JSON.stringify(Object.fromEntries(statusCounts))}, avg ${avgPost.toFixed(0)} ms`);
  console.log(`Seed ${SEED}. Rows 6 and 7 (report screen, demo) are judged by people and are not simulated.`);
  console.log(failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

async function licenceDemo(known: [string, string]): Promise<void> {
  const keyPath = path.join(process.cwd(), "keys/private.pem");
  if (!existsSync(keyPath)) {
    check("5 Licence", "keys/private.pem present (needed to sign test licences)", false, "run npm run gen-keys");
    return;
  }
  const pem = readFileSync(keyPath, "utf8");
  const secs = Number(arg("licence-seconds") ?? 20);
  const original = (await call("GET", "/license")).json;
  const shortLic = signLicence({ licensee: "Simulator Bank", expires_at: formatIst(Date.now() + secs * 1000) }, pem);
  const tampered = { ...shortLic, expires_at: formatIst(Date.now() + 365 * D) };
  const tRes = await call("POST", "/license", tampered);
  check("5 Licence", "licence with an edited date is rejected (400)", tRes.status === 400, `${tRes.status} ${tRes.text}`);
  const up = await call("POST", "/license", shortLic);
  check("5 Licence", `upload a licence that expires in ${secs} s -> 200`, up.status === 200, up.text);
  const okLookup = await lookup("phone", known[0]);
  check("5 Licence", "lookup works while valid", okLookup.status === 200, String(okLookup.status));
  console.log(`   waiting ${secs + 2} s for the licence to expire...`);
  await new Promise((r) => setTimeout(r, (secs + 2) * 1000));
  const exp = await lookup("phone", known[0]);
  const expPost = await call("POST", "/reports", reportBody({ type: "phone", value: newMobile(), pin: "560066", occurredAt: NOW - H }));
  const h = await call("GET", "/health");
  const lget = await call("GET", "/license");
  check("5 Licence", "after expiry: lookup -> 403 LICENSE_EXPIRED", exp.status === 403 && exp.json.error === "LICENSE_EXPIRED", `${exp.status} ${exp.text}`);
  check("5 Licence", "after expiry: POST /reports -> 403", expPost.status === 403, String(expPost.status));
  check("5 Licence", "after expiry: /health and /license still answer", h.status === 200 && lget.status === 200 && lget.json.status === "EXPIRED", `${h.status} ${lget.status} ${String(lget.json.status)}`);
  const longLic = signLicence({ licensee: String(original.licensee ?? "Demo Bank"), expires_at: formatIst(Date.now() + 30 * D) }, pem);
  const re = await call("POST", "/license", longLic);
  const back = await lookup("phone", known[0]);
  check("5 Licence", "renewal works without restart, old data still there", re.status === 200 && back.status === 200 && v(back) === known[1], `${re.status} ${back.status} ${v(back)}`);
  console.log(`   licence renewed for 30 days as "${longLic.licensee}".`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
