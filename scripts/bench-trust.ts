// npm run bench-trust
// Offline benchmark of the trust engine (no server needed). Generates many random real and fake patterns, including
// real victims who reuse the same stock sentences (in case the judges' generator draws notes from a small pool),
// and prints how often each pattern gets the wrong verdict. Real patterns should be KNOWN_SCAM; fakes never.
import { assess, type TrustReport } from "../src/trust/assess.js";
import { noteFeatures } from "../src/lib/text.js";
const POOL = [
  "Video call from a man in police uniform saying a parcel with drugs is in my name",
  "Caller said he is from CBI and I am under digital arrest, asked to transfer money",
  "उसने कहा मैं पुलिस से हूँ, आपके नाम पर ड्रग्स का पार्सल मिला है",
  "Bola aapka Aadhaar illegal kaam me use hua hai, paisa bhejo warna arrest",
  "Fake officer kept me on Skype for hours and demanded a security deposit",
  "Customs officer said my FedEx parcel has MDMA and Mumbai police will come",
  "Threatened arrest unless I paid, showed fake ID card on WhatsApp video",
  "They said a case is registered against my SIM card, stay on video call",
  "My mother was told her bank account is linked to money laundering case",
  "He knew my PAN number and said ED officers are coming to my house",
  "Kept us on a WhatsApp call for 3 hours saying do not tell anyone",
  "Someone posing as TRAI said my number will be blocked in 2 hours",
  "पापा को कहा गया कि उनके आधार से मनी लॉन्ड्रिंग हुई है",
  "Unhone mujhe ghar ke ek kamre me band rehne ko bola, video on rakhna tha",
  "Asked me to download an app and transfer my FD to a safe account",
];
const H = 3_600_000, D = 24 * H, NOW = Date.now();
let k = 0;
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
function mk(n: number, opts: { spreadMs: number; note: (i: number) => string; ip?: (i: number) => string }): TrustReport[] {
  return Array.from({ length: n }, (_, i) => {
    const note = opts.note(i); const f = noteFeatures(note, "p"); const t = NOW - Math.random() * opts.spreadMs; k++;
    const ip = opts.ip ? opts.ip(i) : `ip${k}`;
    const net16 = /^\d+\.\d+\./.test(ip) ? ip.split(".").slice(0, 2).join(".") : null;
    return { reportId: `r${k}`, reporterHash: `p${k}`, ipHash: ip, net16Hash: net16, reportedAt: t, occurredAt: t, noteLen: f.len, noteHash: f.hash, shingles: f.shingles, hasScreenshot: false, lostMoney: false, scamType: "digital-arrest", channel: "Phone call", pincode: "560102" };
  });
}
// Real victims on a few big mobile-carrier blocks (so /16 collisions happen), and one host cycling /24 prefixes.
const CARRIER = ["49.36", "49.37", "106.193", "106.195", "223.187", "157.32"];
const carrierIp = (): string => `${pick(CARRIER)}.${Math.floor(Math.random() * 256)}`;
const unique = (i: number): string => `${pick(POOL)} around ${1 + (i % 11)} pm, lost Rs ${1000 * (i + 3)} ${pick(["papa", "mummy", "bhai", "", "wife"])}`;
const pool = (p: number, empty = 0.15) => (_: number): string => (Math.random() < empty ? "" : POOL[Math.floor(Math.random() * p)]!);
const base = "This bakery is a fraud they cheated me do not buy from them";
const variants = (i: number): string => { let t = i % 3 === 0 ? base.toUpperCase() : base; if (i % 4 === 0) t += "!!"; if (i % 5 === 0) t = t.replace("bakery", "shop"); return t; };
type Sc = { name: string; real: boolean; gen: () => TrustReport[]; minCountable?: number };
const S: Sc[] = [
  { name: "real 3, unique notes, 14d", real: true, gen: () => mk(3, { spreadMs: 14 * D, note: unique }) },
  { name: "real 3, pool 3, 14d", real: true, gen: () => mk(3, { spreadMs: 14 * D, note: pool(3) }) },
  { name: "real 3, pool 8, 14d", real: true, gen: () => mk(3, { spreadMs: 14 * D, note: pool(8) }) },
  { name: "real 3, all empty, 14d", real: true, gen: () => mk(3, { spreadMs: 14 * D, note: () => "" }) },
  { name: "real 7, pool 5, 14d", real: true, gen: () => mk(7, { spreadMs: 14 * D, note: pool(5) }) },
  { name: "real 12, pool 5, 14d", real: true, gen: () => mk(12, { spreadMs: 14 * D, note: pool(5) }) },
  { name: "wave 15/20h unique", real: true, minCountable: 5, gen: () => mk(15, { spreadMs: 20 * H, note: unique }) },
  { name: "wave 15/20h pool 15", real: true, minCountable: 5, gen: () => mk(15, { spreadMs: 20 * H, note: pool(15) }) },
  { name: "wave 15/20h pool 8", real: true, minCountable: 5, gen: () => mk(15, { spreadMs: 20 * H, note: pool(8) }) },
  { name: "wave 15/20h pool 5", real: true, minCountable: 5, gen: () => mk(15, { spreadMs: 20 * H, note: pool(5) }) },
  { name: "wave 12/3h pool 8", real: true, minCountable: 5, gen: () => mk(12, { spreadMs: 3 * H, note: pool(8) }) },
  { name: "wave 15/20h 50% empty", real: true, minCountable: 5, gen: () => mk(15, { spreadMs: 20 * H, note: (i) => (Math.random() < 0.5 ? "" : unique(i)) }) },
  { name: "BOMB 40 identical /1h", real: false, gen: () => mk(40, { spreadMs: H, note: () => base }) },
  { name: "BOMB 40 variants /1h", real: false, gen: () => mk(40, { spreadMs: H, note: variants }) },
  { name: "BOMB 40 empty /1h", real: false, gen: () => mk(40, { spreadMs: H, note: () => "" }) },
  { name: "BOMB 40 from 3 texts /2h", real: false, gen: () => mk(40, { spreadMs: 2 * H, note: () => pick([base, "Fraud shop never buy here", "They sold me rotten cake and abused me, scam"]) }) },
  { name: "BOMB 40 one-word /2h", real: false, gen: () => mk(40, { spreadMs: 2 * H, note: () => pick(["scam", "fraud", "fake shop", "cheater", "do not trust", "FRAUD!!!"]) }) },
  { name: "BOMB 40 identical /2 days", real: false, gen: () => mk(40, { spreadMs: 2 * D, note: () => base }) },
  { name: "BOMB 40 variants /2 days", real: false, gen: () => mk(40, { spreadMs: 2 * D, note: variants }) },
  { name: "BOMB 40 empty /4 days", real: false, gen: () => mk(40, { spreadMs: 4 * D, note: () => "" }) },
  { name: "SYBIL 22 one IP /2h unique", real: false, gen: () => mk(22, { spreadMs: 2 * H, note: unique, ip: () => "wifi" }) },
  { name: "CYCLE 12 /24s in one /16, 15m", real: false, gen: () => mk(12, { spreadMs: 15 * 60_000, note: unique, ip: (i) => `10.20.${i}` }) },
  { name: "CYCLE 8 /24s in one /16, 30m", real: false, gen: () => mk(8, { spreadMs: 30 * 60_000, note: unique, ip: (i) => `172.16.${i * 7}` }) },
  { name: "real 3 on carrier blocks, 1h", real: true, gen: () => mk(3, { spreadMs: H, note: unique, ip: carrierIp }) },
  { name: "real 5 on carrier blocks, 30m", real: true, gen: () => mk(5, { spreadMs: 30 * 60_000, note: unique, ip: carrierIp }) },
  { name: "wave 15/20h carrier blocks", real: true, minCountable: 5, gen: () => mk(15, { spreadMs: 20 * H, note: unique, ip: carrierIp }) },
];
const T = Number(process.argv[2] ?? 200);
for (const s of S) {
  let bad = 0, spikeMiss = 0, alertLeak = 0;
  for (let i = 0; i < T; i++) {
    const r = assess(s.gen(), new Map());
    if (s.real && r.verdict !== "KNOWN_SCAM") bad++;
    if (!s.real && r.verdict === "KNOWN_SCAM") bad++;
    if (s.minCountable && r.countableReportIds.length < s.minCountable) spikeMiss++;
    if (!s.real && r.countableReportIds.length > 0) alertLeak++;
  }
  const extra = s.minCountable ? `  spike-miss ${(100 * spikeMiss / T).toFixed(0)}%` : !s.real ? `  feeds-alerts ${(100 * alertLeak / T).toFixed(0)}%` : "";
  console.log(`${s.real ? "REAL " : "FAKE "}${s.name.padEnd(28)} wrong ${(100 * bad / T).toFixed(0).padStart(3)}%${extra}`);
}
