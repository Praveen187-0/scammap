// npm run seed-demo -- [--base http://localhost:8080] [--reset] [--seed 7]
//
// MANUAL ONLY. Builds a realistic, clearly SYNTHETIC month of activity across all 25 areas so the map, alerts and
// insights have something to show: each city has its own scam mix, some numbers are reported by many unrelated
// people (Known scam), some by two (Suspicious), many by one (awaiting confirmation), plus live events and attacks.
// Everything goes through POST /reports, so the trust rules treat it exactly like real traffic.
//
// The phone numbers, UPI IDs and links are random and made up. Random numbers can still collide with someone's
// real number, so use this ONLY on a local or demo server, and never right before the judges' test tool.
import { AREAS, type Area } from "../shared/areas.js";
import { loadDotEnv } from "../src/lib/dotenv.js";
import { formatIst } from "../src/lib/time.js";

loadDotEnv();
const argOf = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const BASE = (argOf("base") ?? process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/+$/, "");
let seed = Number(argOf("seed") ?? 20261031) >>> 0;
const rnd = (): number => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a: number, b: number): number => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
const chance = (p: number): boolean => rnd() < p;
const hex = (n: number): string => Array.from({ length: n }, () => "0123456789abcdef"[int(0, 15)]).join("");
function weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[items.length - 1]![0];
}

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const NOW = Date.now();

// ------------------------------------------------------------------ city scam mixes
type Mix = ReadonlyArray<readonly [string, number]>;
const MIX: Record<string, Mix> = {
  Bengaluru: [["digital-arrest", 3], ["courier-customs", 3], ["job-offer", 2], ["fake-kyc-link", 2], ["otp-call", 2], ["investment-group", 2], ["electricity-disconnection", 2], ["upi-refund-qr", 1], ["fake-customer-care", 1], ["loan-app-harassment", 1], ["lottery-prize", 1], ["sextortion", 1]],
  Mumbai: [["investment-group", 4], ["digital-arrest", 3], ["courier-customs", 2], ["fake-kyc-link", 2], ["otp-call", 1], ["sextortion", 1]],
  Delhi: [["sextortion", 3], ["loan-app-harassment", 3], ["fake-kyc-link", 2], ["digital-arrest", 2], ["lottery-prize", 2]],
  Hyderabad: [["job-offer", 4], ["investment-group", 3], ["otp-call", 2]],
  Chennai: [["electricity-disconnection", 3], ["fake-kyc-link", 2], ["otp-call", 2], ["courier-customs", 1]],
  Pune: [["job-offer", 3], ["investment-group", 2], ["upi-refund-qr", 2]],
  Kolkata: [["electricity-disconnection", 3], ["lottery-prize", 2], ["loan-app-harassment", 2]],
  Ahmedabad: [["investment-group", 3], ["upi-refund-qr", 2], ["fake-kyc-link", 2]],
  Jaipur: [["lottery-prize", 3], ["fake-kyc-link", 2], ["otp-call", 2]],
  Lucknow: [["electricity-disconnection", 2], ["fake-kyc-link", 2], ["loan-app-harassment", 2], ["lottery-prize", 2]],
  Kochi: [["job-offer", 2], ["courier-customs", 2], ["investment-group", 2]],
};
// Reports per day per area (Bengaluru areas are busier in this demo).
const rateFor = (a: Area): number => (a.city === "Bengaluru" ? 0.9 + rnd() * 0.9 : 0.6 + rnd() * 0.8);

// ------------------------------------------------------------------ identifiers (synthetic)
type IdType = "phone" | "upi" | "url" | "sender_id";
const used = new Set<string>();
const uniq = (f: () => string): string => {
  for (;;) {
    const v = f();
    if (!used.has(v)) {
      used.add(v);
      return v;
    }
  }
};
const mobile = (): string => uniq(() => `+91 ${pick(["6", "7", "8", "9"])}${String(int(0, 9999)).padStart(4, "0")} ${String(int(0, 99999)).padStart(5, "0")}`);
const landline = (): string => uniq(() => `+91 80 ${int(2000, 4999)} ${String(int(0, 9999)).padStart(4, "0")}`);
const URL_SHAPES: Record<string, string[]> = {
  "fake-kyc-link": ["sbi-kyc-update-%.top/login", "hdfc-netbank-verify-%.click/kyc", "icici-rekyc-%.xyz/update", "yono-sbi-%.shop/verify"],
  "courier-customs": ["indiapost-redelivery-%.shop/track", "fedex-customs-%.online/pay", "bluedart-hold-%.site/release"],
  "investment-group": ["ipo-allotment-%.live/vip", "nse-tips-club-%.top/join", "crypto-double-%.xyz/invest"],
  "job-offer": ["daily-task-earn-%.site/register", "wfh-jobs-%.online/apply"],
  "electricity-disconnection": ["bescom-bill-pay-%.xyz/pay", "power-bill-update-%.top/now"],
};
function identifierFor(type: string): { idType: IdType; value: string } {
  const dist: Record<string, Mix> = {
    "fake-kyc-link": [["url", 6], ["sender_id", 2], ["phone", 2]],
    "upi-refund-qr": [["upi", 1]],
    "investment-group": [["phone", 6], ["url", 4]],
    "courier-customs": [["phone", 6], ["url", 4]],
    "job-offer": [["phone", 5], ["upi", 3], ["url", 2]],
    "lottery-prize": [["phone", 5], ["upi", 5]],
    "electricity-disconnection": [["phone", 5], ["sender_id", 5]],
  };
  const idType = weighted((dist[type] ?? [["phone", 1]]) as ReadonlyArray<readonly [IdType, number]>);
  if (idType === "url") return { idType, value: `https://${pick(URL_SHAPES[type] ?? URL_SHAPES["fake-kyc-link"]!).replace("%", hex(4))}` };
  if (idType === "upi") return { idType, value: uniq(() => `${pick(["refund.help", "kbc.lottery", "task.pay", "fedex.custom", "cashback.desk", "ipo.allot"])}${int(10, 999)}@${pick(["ybl", "paytm", "okaxis", "ibl", "axl", "okhdfcbank"])}`) };
  if (idType === "sender_id") return { idType, value: uniq(() => `${pick(["VM", "AD", "JD", "BZ", "VK"])}-${pick(["KYCUPD", "ELCTRB", "PWRBIL", "SBIKYC", "BSCMBL", "RWDPTS"]).slice(0, 4)}${pick(["AL", "IN", "UP", "PY", "NT"])}`) };
  return { idType, value: mobile() };
}

// ------------------------------------------------------------------ notes in English, Hinglish and Hindi
const AMT = ["4,999", "12,000", "25,000", "49,500", "80,000", "1.2 lakh", "2 lakh", "3.4 lakh"];
const REL_EN = ["my father", "my mother", "my uncle", "my wife", "my neighbour aunty", "I"];
const REL_HL = ["Papa ko", "Mummy ko", "Mujhe", "Bhai ko", "Nani ko"];
const REL_HI = ["मेरे पापा को", "मेरी माँ को", "मुझे", "मेरे भाई को", "मेरी नानी को"];
const CLAIM: Record<string, string[]> = {
  "digital-arrest": ["a man in police uniform on video call said a parcel with drugs was in our name", "a 'CBI officer' said our Aadhaar was used for money laundering", "fake Mumbai cyber cell said we are under digital arrest and must stay on Skype"],
  "fake-kyc-link": ["an SMS said the bank account will be blocked today unless KYC is updated on a link", "got a link to update PAN, page looked exactly like the bank", "message said YONO will be suspended, update KYC now"],
  "upi-refund-qr": ["a buyer on OLX sent a QR to receive money but it asked for my UPI PIN", "someone 'returning a wrong payment' sent a collect request", "refund agent asked to scan a QR to get the refund"],
  "investment-group": ["added to a WhatsApp group promising 30% weekly on IPO tips", "Telegram 'stock mentor' showed fake profits and asked for more deposit", "trading app showed profit but withdrawal needed a 'tax' payment"],
  "courier-customs": ["caller said my FedEx parcel is held at customs and I must pay a fine", "message said India Post parcel undelivered, pay ₹25 to reschedule", "customs officer said the parcel has illegal items, pay to clear"],
  "job-offer": ["part-time job liking YouTube videos, paid 200 first, then asked for a deposit", "task job on Telegram, needed to 'recharge' 5000 to unlock earnings", "work from home offer asked for registration fee"],
  "lottery-prize": ["told I won a KBC lottery of 25 lakh but must pay processing fee", "lucky draw winner message asked for GST payment first", "prize call said a car is waiting, pay delivery charges"],
  "loan-app-harassment": ["instant loan app is threatening to send morphed photos to my contacts", "recovery agent abusing and calling all my contacts", "took a small loan, now asked to repay three times the amount"],
  "electricity-disconnection": ["SMS said power will be cut tonight at 9.30, call the officer", "caller said electricity bill not updated, pay now or disconnection", "message asked to install an app to update the bill"],
  "fake-customer-care": ["searched for refund customer care, the number asked me to install AnyDesk", "fake airline helpline took card details for a refund", "Google search customer care number asked for OTP"],
  "otp-call": ["caller from 'card department' asked for the OTP to stop a charge", "said my card is blocked, asked for CVV and OTP", "bank verification call asked to read out the code"],
  sextortion: ["video call from unknown woman, then threatened to post recording", "blackmail call demanding money after a video call", "fake police called after the video call demanding settlement"],
};
const CLAIM_HL: Record<string, string> = {
  "digital-arrest": "police uniform wala video call pe bola parcel me drugs mila hai",
  "fake-kyc-link": "SMS aaya ki KYC update karo warna account band",
  "upi-refund-qr": "refund ke naam pe QR bheja aur PIN maanga",
  "investment-group": "WhatsApp group me daily profit ka laalach diya",
  "courier-customs": "bola parcel customs me ruka hai, fine bharo",
  "job-offer": "part time task job, pehle deposit maanga",
  "lottery-prize": "lottery jeetne ka bola, pehle fees bharo",
  "loan-app-harassment": "loan app wale contacts ko gaali de rahe hain",
  "electricity-disconnection": "bola aaj raat bijli kat jayegi, officer ko call karo",
  "fake-customer-care": "customer care bol ke AnyDesk download karwaya",
  "otp-call": "bank ka bol ke OTP maang raha tha",
  sextortion: "video call ke baad blackmail kar raha hai",
};
const CLAIM_HI: Record<string, string> = {
  "digital-arrest": "पुलिस की वर्दी में आदमी ने वीडियो कॉल पर कहा पार्सल में ड्रग्स मिले हैं",
  "fake-kyc-link": "SMS आया कि KYC अपडेट करो वरना खाता बंद हो जाएगा",
  "upi-refund-qr": "रिफ़ंड के नाम पर QR भेजा और PIN माँगा",
  "investment-group": "WhatsApp ग्रुप में रोज़ मुनाफ़े का लालच दिया",
  "courier-customs": "कहा पार्सल कस्टम में रुका है, जुर्माना भरो",
  "job-offer": "पार्ट टाइम टास्क नौकरी, पहले पैसे जमा करवाए",
  "lottery-prize": "लॉटरी जीतने का बोला, पहले फ़ीस भरो",
  "loan-app-harassment": "लोन ऐप वाले मेरे कॉन्टैक्ट्स को धमका रहे हैं",
  "electricity-disconnection": "कहा आज रात बिजली कट जाएगी, अफ़सर को कॉल करो",
  "fake-customer-care": "कस्टमर केयर बनकर AnyDesk डाउनलोड करवाया",
  "otp-call": "बैंक का बताकर OTP माँग रहा था",
  sextortion: "वीडियो कॉल के बाद ब्लैकमेल कर रहा है",
};
function note(type: string): string {
  if (chance(0.15)) return "";
  const lang = rnd();
  const amt = pick(AMT);
  if (lang < 0.55) {
    const claim = pick(CLAIM[type] ?? CLAIM["otp-call"]!);
    const end = pick([`We lost Rs ${amt}.`, "I hung up and blocked it.", "Did not pay anything.", `They asked for Rs ${amt}.`, "Reported on 1930 also.", "The number kept calling back."]);
    return `${pick(REL_EN)} got this: ${claim}. ${end} Around ${int(1, 11)} ${pick(["am", "pm"])}.`.replace(/^I got this/, "I got this").replace(/^\w/, (c) => c.toUpperCase());
  }
  if (lang < 0.78) return `${pick(REL_HL)} call/message aaya, ${CLAIM_HL[type] ?? "paise maange"}. ${pick([`Rs ${amt} maang rahe the`, "humne kuch nahi diya", "phone kaat diya", `${int(1, 3)} ghante pareshan kiya`])}.`;
  return `${pick(REL_HI)} कॉल आया, ${CLAIM_HI[type] ?? "पैसे माँगे"}। ${pick([`${amt} रुपये माँगे`, "हमने कुछ नहीं दिया", "मैंने कॉल काट दिया", `${int(1, 3)} घंटे परेशान किया`])}।`;
}

// ------------------------------------------------------------------ report building
interface Rep {
  idType: IdType;
  value: string;
  area: Area;
  at: number;
  type: string;
  note?: string;
  reporter?: string;
  ip?: string;
  delay?: number;
  lost?: number;
  shot?: boolean;
  channel?: string;
  /** Other identifiers seen in the same message (for campaign detection). */
  related?: Array<{ type: IdType; value: string }>;
}
const channelFor = (idType: IdType, type: string): string =>
  idType === "url" ? pick(["Fake website", "SMS or WhatsApp"]) : idType === "upi" ? (type === "upi-refund-qr" ? pick(["QR code", "UPI request"]) : "UPI request")
    : idType === "sender_id" ? "SMS or WhatsApp" : ["job-offer", "investment-group", "fake-kyc-link"].includes(type) ? pick(["SMS or WhatsApp", "Phone call"]) : "Phone call";
const delayMs = (): number => weighted([[int(3, 59) * MIN, 40], [int(1, 6) * H, 30], [int(6, 24) * H, 15], [int(1, 3) * D, 10], [int(3, 6) * D, 5]] as const);
/** Evening- and lunch-heavy time of day, as scam calls are. */
const hourOfDay = (): number => weighted([[9, 2], [10, 4], [11, 5], [12, 5], [13, 4], [14, 3], [15, 3], [16, 3], [17, 4], [18, 5], [19, 6], [20, 5], [21, 3], [22, 2], [7, 1], [8, 1]] as const);
const ip = (): string => `${int(100, 223)}.${int(0, 255)}.${int(0, 255)}`;
const reporters: string[] = Array.from({ length: 40 }, () => `r_${hex(8)}`); // a few regular, helpful reporters

let n = 0;
function body(r: Rep): Record<string, unknown> {
  const occurred = r.at;
  const reported = Math.min(NOW - MIN, occurred + (r.delay ?? delayMs()));
  return {
    report_id: `demo_${hex(6)}_${++n}`,
    occurred_at: formatIst(occurred),
    reported_at: formatIst(Math.max(occurred, reported)),
    reporter_id: r.reporter ?? (chance(0.08) ? pick(reporters) : `r_${hex(8)}`),
    ip_prefix: r.ip ?? ip(),
    channel: r.channel ?? channelFor(r.idType, r.type),
    scam_type: r.type,
    identifier_type: r.idType,
    identifier_value: r.value,
    pincode: r.area.pincode,
    locality: r.area.locality,
    city: r.area.city,
    note: r.note ?? note(r.type),
    has_screenshot: r.shot ?? chance(0.25),
    amount_lost_inr: r.lost ?? (chance(0.15) ? pick([2500, 8000, 25000, 60000, 150000, 340000]) : 0),
    ...(r.related?.length ? { related_identifiers: r.related } : {}),
  };
}

// Campaigns: identifiers reused by many unrelated victims, per city and nationally.
interface Campaign {
  idType: IdType;
  value: string;
  type: string;
  weight: number;
}
const campaigns = new Map<string, Campaign[]>();
const national: Campaign[] = [];
for (const [city, mix] of Object.entries(MIX)) {
  const list: Campaign[] = [];
  for (const [type, w] of mix) {
    for (let k = 0; k < 2 + w; k++) {
      const id = identifierFor(type);
      const c = { ...id, type, weight: 1 / (k + 1) ** 1.2 };
      list.push(c);
      if (k === 0 && chance(0.35)) national.push(c);
    }
  }
  campaigns.set(city, list);
}

const reps: Rep[] = [];
const WHITEFIELD = "560066";
for (const area of AREAS) {
  const rate = rateFor(area);
  const list = campaigns.get(area.city) ?? [];
  for (let d = 2; d <= 29; d++) {
    const count = Math.round(rate + (rnd() - 0.5) * 1.6);
    for (let k = 0; k < count; k++) {
      let c: Campaign | null = chance(0.62) ? weighted(list.map((x) => [x, x.weight] as const)) : chance(0.12) && national.length ? pick(national) : null;
      // Keep Whitefield free of job-offer reports, so today's job-offer reports there raise a NEW_TYPE alert.
      if (c && area.pincode === WHITEFIELD && c.type === "job-offer") c = null;
      const type = c?.type ?? weighted((MIX[area.city] ?? MIX.Bengaluru!).filter(([t]) => !(area.pincode === WHITEFIELD && t === "job-offer")));
      const id = c ?? { ...identifierFor(type) };
      const day = NOW - d * D;
      const at = day - ((day + 330 * MIN) % D) + hourOfDay() * H + int(0, 59) * MIN; // IST midnight of that day + an IST hour
      reps.push({ idType: id.idType, value: id.value, area, at: Math.min(at, NOW - 2 * D), type });
    }
  }
}
const area = (pin: string): Area => AREAS.find((a) => a.pincode === pin)!;

// Live event 1: a digital-arrest wave in HSR Layout over the last 20 hours (SPIKE).
const waveNums = [mobile(), mobile(), mobile()];
for (let k = 0; k < 13; k++) reps.push({ idType: "phone", value: waveNums[k % 3]!, area: area("560102"), at: NOW - int(20, 20 * 60) * MIN, type: "digital-arrest", delay: int(5, 90) * MIN });
// Live event 2: a new kind of scam in Whitefield today (NEW_TYPE).
const jobNum = mobile();
for (let k = 0; k < 3; k++) reps.push({ idType: "phone", value: jobNum, area: area(WHITEFIELD), at: NOW - int(1, 18) * H, type: "job-offer", delay: int(5, 60) * MIN });
// Event 3: a fake KYC link spreading in Hauz Khas over the last 2 days.
const kycLink = `https://sbi-kyc-update-${hex(4)}.top/login`;
for (let k = 0; k < 7; k++) reps.push({ idType: "url", value: kycLink, area: area(pick(["110016", "110016", "302017", "226010"])), at: NOW - int(4, 46) * H, type: "fake-kyc-link" });
// Campaign A: one fake-KYC SMS campaign (sender ID + link + call-back number + a UPI ID for "fees"), spreading from
// Bengaluru to Pune and Hyderabad over 4 days. Victims report what they saw, and the other identifiers from the same
// SMS travel with the report, so the campaign view can join them into one attack story.
const kycA = { sender: `VM-SBIUPD`, link: `https://sbi-yono-rewards-${hex(4)}.top/kyc`, phone: mobile(), upi: `kyc.verify${int(10, 99)}@ybl` };
const kycSms = [{ type: "sender_id" as IdType, value: kycA.sender }, { type: "url" as IdType, value: kycA.link }, { type: "phone" as IdType, value: kycA.phone }];
const kycTrail = [...["560034", "560102", "560076", "560078"].map((p, i) => [p, 4 * D - i * 5 * H] as const), ...["411014", "411014"].map((p, i) => [p, 2.5 * D - i * 6 * H] as const), ...["500081", "500081"].map((p, i) => [p, 1.2 * D - i * 5 * H] as const)];
kycTrail.forEach(([pin, ago], i) => {
  const primary = kycSms[i % 3]!;
  reps.push({ idType: primary.type, value: primary.value, area: area(pin), at: NOW - ago - int(0, 90) * MIN, type: "fake-kyc-link", related: kycSms.filter((x) => x !== primary) });
  reps.push({ idType: kycSms[(i + 1) % 3]!.type, value: kycSms[(i + 1) % 3]!.value, area: area(pin), at: NOW - ago + int(30, 240) * MIN, type: "fake-kyc-link", related: kycSms.filter((x) => x !== kycSms[(i + 1) % 3]) });
});
for (const pin of ["560034", "411014", "500081"]) reps.push({ idType: "upi", value: kycA.upi, area: area(pin), at: NOW - int(20, 70) * H, type: "fake-kyc-link", lost: pick([8000, 25000, 60000]), related: [{ type: "url", value: kycA.link }] });
// Campaign B: the HSR digital-arrest callers also share one UPI ID for the "verification deposit".
const arrestUpi = `cbi.verify${int(10, 99)}@okaxis`;
for (let k = 0; k < 3; k++) reps.push({ idType: "upi", value: arrestUpi, area: area(pick(["560102", "560103", "560034"])), at: NOW - int(2, 18) * H, type: "digital-arrest", lost: pick([95000, 150000, 240000]), related: [{ type: "phone", value: waveNums[k]! }, { type: "phone", value: waveNums[(k + 1) % 3]! }] });
// Campaign C: a task-job scam (Telegram-style link + UPI for deposits + recruiter number) moving Hyderabad -> Pune -> Mumbai.
const jobC = { link: `https://daily-task-earn-${hex(4)}.site/register`, upi: `task.pay${int(10, 99)}@ybl`, phone: mobile() };
const jobIds = [{ type: "url" as IdType, value: jobC.link }, { type: "upi" as IdType, value: jobC.upi }, { type: "phone" as IdType, value: jobC.phone }];
[["500081", 6 * D], ["500081", 5.5 * D], ["411014", 4 * D], ["411014", 3.5 * D], ["400050", 2 * D], ["400050", 1.5 * D], ["400050", 0.6 * D]].forEach(([pin, ago], i) => {
  const primary = jobIds[i % 3]!;
  reps.push({ idType: primary.type, value: primary.value, area: area(String(pin)), at: NOW - Number(ago) - int(0, 120) * MIN, type: "job-offer", related: jobIds.filter((x) => x !== primary) });
});

// Ordinary recent activity everywhere in the last day.
for (const a of AREAS) {
  if (!chance(0.5)) continue;
  const t = pick((MIX[a.city] ?? MIX.Bengaluru!).map(([x]) => x).filter((x) => !(a.pincode === WHITEFIELD && x === "job-offer")));
  reps.push({ ...identifierFor(t), area: a, at: NOW - int(2, 22) * H, type: t });
}
// Month-old reports (should never appear on the 7-day map).
for (let k = 0; k < 6; k++) reps.push({ ...identifierFor("lottery-prize"), area: pick(AREAS), at: NOW - int(32, 40) * D, type: "lottery-prize" });

// Attacks the trust rules should stop.
const bakeryNote = "This bakery is a fraud, they cheated me, do not buy from them";
for (let k = 0; k < 25; k++) reps.push({ idType: "phone", value: "+91 80 4100 2233", area: area("560038"), at: NOW - 6 * H + k * 2 * MIN, type: "other", note: k % 2 ? bakeryNote : bakeryNote.toUpperCase(), delay: MIN });
const sweetShop = landline();
for (let k = 0; k < 30; k++) reps.push({ idType: "phone", value: sweetShop, area: area("560011"), at: NOW - 30 * H + k * 2 * MIN, type: "other", note: "This sweet shop is a scam, they cheated me, never go there!!", delay: MIN });
const sybilNum = mobile();
const sybilIp = ip();
for (let k = 0; k < 15; k++) reps.push({ idType: "phone", value: sybilNum, area: area("560037"), at: NOW - 3 * H + k * 5 * MIN, type: "digital-arrest", ip: sybilIp, delay: MIN });
const spamNum = mobile();
const spammer = `r_${hex(8)}`;
for (let k = 0; k < 6; k++) reps.push({ idType: "phone", value: spamNum, area: area("560076"), at: NOW - 55 * MIN + k * 8 * MIN, type: "otp-call", reporter: spammer, delay: MIN });
const exNum = mobile();
for (const t of ["My ex boyfriend's number, he owes me money, report him", "This is my ex husband, he took my money and left"]) reps.push({ idType: "phone", value: exNum, area: area("560010"), at: NOW - int(5, 40) * H, type: "other", note: t });

// Amazon impersonation (synthetic numbers): a fake "order cancellation desk" and a fake delivery agent after OTPs.
const amazonNum = mobile();
const amazonNotes = [
  "Robo call said an iPhone 15 was ordered on my Amazon account, press 1 to cancel. The man then asked me to install AnyDesk.",
  "Amazon ke naam se call aaya, bola 54,999 ka TV order hua hai, cancel karne ke liye card details maange.",
  "अमेज़न से बोल रहे थे, कहा आपके खाते से महंगा ऑर्डर हुआ है, रद्द करने के लिए ओटीपी बताओ।",
  "Caller posing as Amazon support said my Prime membership was charged Rs 2,999 and asked me to read the SMS code.",
];
amazonNotes.forEach((nt, i) => reps.push({ idType: "phone", value: amazonNum, area: area(["560102", "400050", "110016", "560034"][i]!), at: NOW - (40 - i * 9) * H, type: "fake-customer-care", note: nt, delay: int(10, 90) * MIN }));
const amazonOtpNum = mobile();
[
  "Delivery boy called saying my Amazon parcel needs an OTP; the SMS was actually an account login code.",
  "Bola delivery agent hoon, parcel ka OTP batao, lekin wo OTP Amazon login ka tha.",
  "A COD parcel I never ordered: he wanted Rs 699 and then the OTP that came on my phone.",
].forEach((nt, i) => reps.push({ idType: "phone", value: amazonOtpNum, area: area(["560066", "500081", "600020"][i]!), at: NOW - (30 - i * 8) * H, type: "otp-call", note: nt, delay: int(5, 60) * MIN }));

async function post(b: Record<string, unknown>): Promise<number> {
  const r = await fetch(`${BASE}/reports`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  return r.status;
}

async function main(): Promise<void> {
  const lic = await fetch(`${BASE}/license`).then((r) => r.json() as Promise<{ status?: string }>).catch(() => ({ status: "UNREACHABLE" }));
  if (lic.status !== "VALID") {
    console.error(`Server at ${BASE} says licence ${lic.status}. Upload one first: npm run sign-licence -- --days 30 --upload ${BASE}`);
    process.exit(1);
  }
  if (process.argv.includes("--reset")) await fetch(`${BASE}/admin/reset`, { method: "POST" });
  const queue = reps.map(body).sort(() => rnd() - 0.5);
  const counts = new Map<number, number>();
  let done = 0;
  await Promise.all(Array.from({ length: 10 }, async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      const s = await post(b);
      counts.set(s, (counts.get(s) ?? 0) + 1);
      if (++done % 200 === 0) process.stdout.write(`  ${done} reports...\n`);
    }
  }));
  // Junk that should be rejected (fills the "rejected" counter on the insights page).
  for (const v of ["12345", "test", "0000000000", "abc", "+91 99999 99999"]) await post({ ...body({ idType: "phone", value: "9000000000", area: area("560034"), at: NOW - H, type: "other" }), identifier_value: v });
  for (const pin of ["999999", "12345"]) await post({ ...body({ idType: "phone", value: mobile(), area: area("560034"), at: NOW - H, type: "other" }), pincode: pin });
  await fetch(`${BASE}/challenges`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier_type: "phone", identifier_value: sweetShop, claimant_name: "Sri Lakshmi Sweets", contact_email: "owner@example.com", proof_note: "FSSAI licence and GST certificate" }) });

  console.log(`\nPosted ${reps.length} synthetic reports to ${BASE}: ${JSON.stringify(Object.fromEntries(counts))}`);
  console.log("\nTry these in the app (all synthetic):");
  console.log(`  Digital-arrest wave, HSR Layout:  ${waveNums[0]}`);
  console.log(`  Fake KYC link:                    ${kycLink}`);
  console.log(`  New job-offer scam, Whitefield:   ${jobNum}`);
  console.log(`  Bombed sweet shop (disputed):     ${sweetShop}`);
  console.log(`  Bombed verified bakery:           +91 80 4100 2233`);
  console.log(`  22-style sybil attack:            ${sybilNum}`);
  console.log(`  Grudge reports ("my ex"):         ${exNum}`);
  console.log(`  Campaign: fake KYC SMS sender:     ${kycA.sender} (also its link, number and UPI ID)`);
  console.log(`  Campaign: task-job UPI ID:        ${jobC.upi}`);
  console.log(`  Fake Amazon order desk:           ${amazonNum}`);
  console.log(`  Fake Amazon delivery OTP caller:  ${amazonOtpNum}`);
  console.log(`  Amazon numbers from Reddit (outside list, US): +1 888-814-2357, +1 (818) 322-4089`);
  console.log("  Alerts to expect: SPIKE + NEW_TYPE in HSR Layout (560102), NEW_TYPE in Whitefield (560066).");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
