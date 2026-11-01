// npm run live-demo -- [--base http://localhost:8080] [--minutes 10] [--fast]
//
// MANUAL ONLY, for demos. Sends a slow stream of SYNTHETIC reports through POST /reports so the Live screen, map
// pings, forecast and alerts move in front of an audience. Every minute or so it also stages an attack (a group
// of accounts on one network pasting the same complaint, or one person reporting again and again) so you can
// show the trust rules catching it live. All numbers are random and made up; never run this on the judged server.
import { AREAS } from "../shared/areas.js";
import { loadDotEnv } from "../src/lib/dotenv.js";
import { formatIst } from "../src/lib/time.js";

loadDotEnv();
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const BASE = (arg("base") ?? process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/+$/, "");
const FAST = process.argv.includes("--fast");
const END = Date.now() + Number(arg("minutes") ?? 30) * 60_000;
const rnd = Math.random;
const int = (a: number, b: number): number => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TYPES: Array<[string, string, string[]]> = [
  ["digital-arrest", "Phone call", ["Caller said he was from Mumbai police and kept me on video call, asked for money to clear my name", "CBI officer bola aapke Aadhaar pe case hai, video call pe rehna padega", "पुलिस की वर्दी में आदमी ने कहा आप डिजिटल अरेस्ट में हैं, पैसे भेजो"]],
  ["fake-kyc-link", "SMS or WhatsApp", ["SMS said my account will be blocked today, link to update PAN KYC", "KYC update link aaya bank ke naam se, login page fake tha", "बैंक के नाम से KYC अपडेट का लिंक आया"]],
  ["job-offer", "SMS or WhatsApp", ["Part time job liking videos, then asked deposit to unlock earnings", "Telegram task job, paid 200 first then asked 5000", "घर बैठे काम का ऑफर, पहले रजिस्ट्रेशन फ़ीस माँगी"]],
  ["electricity-disconnection", "SMS or WhatsApp", ["Message said power will be cut tonight, call this officer number", "Bijli kat jayegi aaj raat, turant call karo bola", "बिजली आज रात कटेगी, इस नंबर पर कॉल करें"]],
  ["investment-group", "SMS or WhatsApp", ["WhatsApp group promised 30% IPO returns, app showed fake profits", "Stock tips group, could not withdraw after investing", "निवेश ग्रुप में मुनाफ़ा दिखाया पर पैसे नहीं निकले"]],
  ["upi-refund-qr", "UPI request", ["Buyer on OLX sent QR saying scan to receive payment, money got debited", "Refund ke liye QR scan karwaya aur paise kat gaye"]],
  ["courier-customs", "Phone call", ["Courier call said parcel held at customs with drugs, transfer to fake officer", "FedEx wala call, parcel me illegal items, paisa maanga"]],
];
const pool = Array.from({ length: 24 }, () => `+91 9${String(int(0, 9999)).padStart(4, "0")} ${String(int(0, 99999)).padStart(5, "0")}`);
const hot = [...AREAS].sort(() => rnd() - 0.5).slice(0, 4);
let seq = 0;

async function post(body: Record<string, unknown>): Promise<number> {
  const res = await fetch(`${BASE}/reports`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 403) throw new Error("Licence not valid: upload one first (npm run sign-licence -- --days 30 --upload " + BASE + ").");
  return res.status;
}

function report(over: Record<string, unknown> = {}): Record<string, unknown> {
  const [type, channel, notes] = pick(TYPES);
  const area = rnd() < 0.55 ? pick(hot) : pick(AREAS);
  const now = Date.now();
  return {
    report_id: `live-${Date.now()}-${++seq}`, occurred_at: formatIst(now - int(1, 50) * 60_000), reported_at: formatIst(now),
    reporter_id: `live-r-${int(1, 1e9)}`, ip_prefix: `${int(11, 223)}.${int(0, 255)}.${int(0, 255)}`, channel, scam_type: type,
    identifier_type: "phone", identifier_value: rnd() < 0.7 ? pick(pool) : `+91 8${String(int(0, 9999)).padStart(4, "0")} ${String(int(0, 99999)).padStart(5, "0")}`,
    pincode: area.pincode, locality: area.locality, city: area.city, note: pick(notes), has_screenshot: rnd() < 0.3, ...over,
  };
}

// Notes with the scam type left blank: keyword rules pick a type at once, the local AI (Ollama) reads them next.
const BLANK_NOTES = [
  "Mujhe call aaya ki main CBI se hoon, aapke naam pe parcel me drugs mila, video call pe raho warna giraftar",
  "बिजली विभाग से मैसेज आया कि आज रात 9 बजे कनेक्शन कट जाएगा, इस नंबर पर तुरंत बात करो",
  "Ghar baithe YouTube video like karne ka kaam bola, pehle 500 registration fee maangi",
  "बैंक वाले बनकर बोले आपका खाता बंद हो जाएगा, लिंक पर KYC अपडेट करो",
  "OLX pe buyer ne bola QR scan karo paise aayenge, scan kiya to mere paise kat gaye",
  "Loan app wale meri photo viral karne ki dhamki de rahe hain, contacts ko message bhej diye",
];

async function attack(): Promise<void> {
  const area = pick(AREAS);
  const target = `+91 80 ${int(2000, 4999)} ${String(int(0, 9999)).padStart(4, "0")}`;
  const roll = rnd();
  if (roll < 0.35) {
    // One machine rotating fake ip_prefix values: a new /24 for every account, all inside one /16 block.
    const block = `${int(11, 99)}.${int(0, 255)}`;
    const mobile = `+91 9${String(int(0, 9999)).padStart(4, "0")} ${String(int(0, 99999)).padStart(5, "0")}`;
    let ok = 0;
    for (let i = 0; i < 10; i++) {
      const [type, channel, notes] = pick(TYPES);
      if ((await post(report({ reporter_id: `cycle-${seq}-${i}`, ip_prefix: `${block}.${int(0, 255)}`, scam_type: type, channel, note: `${pick(notes)} (${i + 1})`, identifier_value: mobile, pincode: area.pincode, locality: area.locality, city: area.city }))) === 201) ok++;
      await sleep(FAST ? 80 : 600);
    }
    console.log(`  attack: 10 accounts cycling ip_prefix inside ${block}.x.x on one number in ${area.locality} (${ok} accepted, counted as one person)`);
    return;
  }
  if (roll < 0.75) {
    const net = `172.${int(16, 31)}.${int(0, 255)}`;
    const note = "This shop is a total fraud, everyone report this number now";
    let ok = 0;
    for (let i = 0; i < 12; i++) {
      if ((await post(report({ reporter_id: `bomb-${seq}-${i}`, ip_prefix: net, note, scam_type: "other", channel: "Phone call", identifier_value: target, pincode: area.pincode, locality: area.locality, city: area.city }))) === 201) ok++;
      await sleep(FAST ? 50 : 400);
    }
    console.log(`  attack: 12 copy-paste reports from one network on a landline in ${area.locality} (${ok} accepted, counted as one person)`);
  } else {
    const who = `spammer-${seq}`;
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push(await post(report({ reporter_id: who, identifier_value: target, pincode: area.pincode, locality: area.locality, city: area.city })));
    console.log(`  attack: one person reported the same number 6 times in ${area.locality}: ${codes.join(" ")}`);
  }
}

async function main(): Promise<void> {
  console.log(`Live demo against ${BASE}. Hot areas: ${hot.map((a) => a.locality).join(", ")}. Ctrl+C to stop.`);
  let nextAttack = Date.now() + (FAST ? 15_000 : 45_000);
  while (Date.now() < END) {
    // About one report in five leaves the scam type blank, with a Hindi or Hinglish note.
    const r = rnd() < 0.2 ? report({ scam_type: "", note: pick(BLANK_NOTES) }) : report();
    const code = await post(r);
    console.log(`${new Date().toLocaleTimeString("en-IN")}  ${code}  ${String(r.scam_type || "(blank: note read)").padEnd(26)} ${String(r.locality)}`);
    if (Date.now() > nextAttack) {
      await attack();
      nextAttack = Date.now() + (FAST ? 20_000 : int(50, 80) * 1000);
    }
    await sleep(FAST ? int(400, 1200) : int(2500, 6000));
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
