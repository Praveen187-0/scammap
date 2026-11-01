import { describe, expect, it } from "vitest";
import { analyzeUpi, describeUpi } from "../shared/risk.js";
import { combine, describeForAi } from "../src/ai/identifier.js";
import { averagePrecision, bestThreshold, evaluate, fitAndEvaluate, V_COUNT, type CardData } from "../src/datasets/cardModel.js";
import { kindOfHeader } from "../src/datasets/load.js";
import { categorize, crossValidate, detectLang, parseLabel, scoreNb, SimilarityIndex, trainNb, type LabelledText } from "../src/datasets/textModel.js";
import { LiveBus } from "../src/live/bus.js";
import { computeForecast, holt } from "../src/services/forecast.js";

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.UTC(2026, 9, 31, 12);

const SCAM = [
  "Claim your loan approved by sending OTP immediately.", "Your account has been suspended, verify OTP now!", "Congratulations! You won a prize. Send OTP to claim.",
  "Earn BDT 3000 daily working from home. Register now!", "Your debit card has been blocked. Verify now at this link.", "Double your money in 7 days. Invest now.",
  "Final notice: claim your government grant within 24 hours", "Urgent! Verify your bank details to prevent account suspension.",
  "আপনার একাউন্ট বন্ধ হতে যাচ্ছে, এখনি OTP দিন।", "আপনি লটারি জিতেছেন! এখনই তথ্য পাঠান।",
];
const HAM = [
  "Your OTP is 8741, do not share it with anyone.", "Payment received successfully. Thank you.", "Your parcel is out for delivery today.",
  "Team meeting is at 3 PM, please confirm.", "Your electricity bill payment was successful.", "Let's meet at the cafe around 8 PM?",
  "Your mobile recharge was successful, thank you.", "Salary credited to your account.", "আপনার মোবাইল রিচার্জ সফল হয়েছে। ধন্যবাদ।", "আপনার বিল পরিশোধ সফল হয়েছে।",
];
const docs: LabelledText[] = [...SCAM.map((text) => ({ text, label: "scam" as const })), ...HAM.map((text) => ({ text, label: "ham" as const }))];

describe("text dataset model", () => {
  it("parses labels from common datasets", () => {
    expect(parseLabel("scam")).toBe("scam");
    expect(parseLabel("SPAM")).toBe("scam");
    expect(parseLabel("1")).toBe("scam");
    expect(parseLabel("ham")).toBe("ham");
    expect(parseLabel("legit")).toBe("ham");
    expect(parseLabel("maybe")).toBeNull();
  });
  it("recognises dataset files by their header", () => {
    expect(kindOfHeader(["label", "message"]).kind).toBe("messages");
    expect(kindOfHeader(["v1", "v2", "", "", ""]).kind).toBe("messages");
    expect(kindOfHeader(["Time", ...Array.from({ length: 28 }, (_, i) => `V${i + 1}`), "Amount", "Class"]).kind).toBe("cards");
    expect(kindOfHeader(["a", "b"]).kind).toBe("unknown");
  });
  it("tags language and category", () => {
    expect(detectLang("আপনার একাউন্ট বন্ধ")).toBe("bn");
    expect(detectLang("Your account is blocked")).toBe("en");
    expect(categorize("Send your OTP to claim")).toBe("otp");
    expect(categorize("Loan approved, apply now")).toBe("loan");
  });
  it("scores scam-like text high and ordinary text low", () => {
    const m = trainNb(docs);
    expect(scoreNb(m, "Your account is suspended. Send OTP to verify now!").p).toBeGreaterThan(0.7);
    expect(scoreNb(m, "Payment received, thank you. See you at the meeting.").p).toBeLessThan(0.3);
  });
  it("ignores words it has never seen (coverage), instead of guessing", () => {
    const m = trainNb(docs);
    const r = scoreNb(m, "पुलिस की वर्दी में आदमी ने कहा");
    expect(r.coverage).toBeLessThan(0.2);
  });
  it("finds the closest labelled examples", () => {
    const idx = new SimilarityIndex(docs);
    const near = idx.nearest("Congratulations you won a prize, send OTP to claim it", 2);
    expect(near[0]?.doc.label).toBe("scam");
    expect(near[0]!.score).toBeGreaterThan(0.4);
  });
  it("cross-validates without crashing on tiny data", () => {
    const cv = crossValidate(docs, 5);
    expect(cv.n).toBe(docs.length);
    expect(cv.accuracy).toBeGreaterThan(0.5);
  });
});

describe("card fraud model", () => {
  it("average precision is 1 for a perfect ranking and threshold maximises F1", () => {
    expect(averagePrecision([0.9, 0.8, 0.1, 0.05], [1, 1, 0, 0])).toBeCloseTo(1);
    expect(bestThreshold([0.9, 0.8, 0.3, 0.1], [1, 1, 0, 0])).toBeCloseTo(0.8);
    const m = evaluate([0.9, 0.2, 0.7], [1, 1, 0], [100, 50, 10], 0.5);
    expect([m.tp, m.fn, m.fp, m.fraud_amount_caught]).toEqual([1, 1, 1, 100]);
  });
  it("learns a separable synthetic pattern with a time-ordered split", () => {
    const n = 6000;
    const d: CardData = { n, time: new Int32Array(n), v: new Float32Array(n * V_COUNT), amount: new Float64Array(n), fraud: new Uint8Array(n) };
    let s = 3;
    const r = (): number => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < n; i++) {
      const f = r() < 0.03 ? 1 : 0;
      d.fraud[i] = f;
      d.time[i] = i * 10;
      d.amount[i] = 10 + r() * 100;
      for (let j = 0; j < V_COUNT; j++) d.v[i * V_COUNT + j] = (r() - 0.5) * 2 + (j === 3 && f ? 4 : 0);
    }
    const res = fitAndEvaluate(d);
    expect(res.test.recall).toBeGreaterThan(0.8);
    expect(res.test.precision).toBeGreaterThan(0.6);
  });
});

describe("forecast and live feed", () => {
  it("holt follows a rising series", () => {
    expect(holt([1, 2, 3, 4, 5])).toBeGreaterThan(5);
    expect(holt([])).toBe(0);
  });
  it("flags an area in a SPIKE and estimates the pace of another", () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => ({ pincode: "560102", scamType: "digital-arrest", occurredAt: NOW - i * H })),
      ...Array.from({ length: 4 }, (_, i) => ({ pincode: "560034", scamType: "fake-kyc-link", occurredAt: NOW - i * 1.2 * H })),
      ...Array.from({ length: 7 }, (_, i) => ({ pincode: "560034", scamType: "fake-kyc-link", occurredAt: NOW - (i + 2) * D })),
    ];
    const f = computeForecast(rows, NOW);
    const hsr = f.areas.find((a) => a.pincode === "560102")!;
    expect(hsr.spike_now).toBe(true);
    expect(hsr.eta_hours).toBe(0);
    const kor = f.areas.find((a) => a.pincode === "560034")!;
    expect(kor.spike_now).toBe(false);
    expect(kor.eta_hours).not.toBeNull();
    expect(f.areas[0]!.pincode).toBe("560102");
  });
  it("live events carry the area only and attacks are shown once per window", () => {
    let t = NOW;
    const bus = new LiveBus(() => t);
    const seen: unknown[] = [];
    bus.subscribe((e) => seen.push(e));
    bus.publish({ type: "report", pincode: "560102", scam_type: "digital-arrest", channel: "Phone call", counted: true });
    for (let i = 0; i < 5; i++) bus.publish({ type: "defence", pincode: "560102", kind: "SYBIL_RING", scam_type: "other", reports: 10 + i, people: 1, key: "phone:+919999999999" });
    expect(seen).toHaveLength(2);
    expect(JSON.stringify(seen)).not.toContain("+91999");
    t += 4 * 60_000;
    bus.publish({ type: "defence", pincode: "560102", kind: "SYBIL_RING", scam_type: "other", reports: 20, people: 1, key: "phone:+919999999999" });
    expect(seen).toHaveLength(3);
  });
});

describe("identifier second opinion", () => {
  it("never sends a phone number or UPI ID to the AI, only a description", () => {
    expect(JSON.stringify(describeForAi("phone", "+919876543210"))).not.toContain("9876543210");
    expect(JSON.stringify(describeForAi("upi", "9876543210@ybl"))).not.toContain("9876543210");
    expect(JSON.stringify(describeForAi("upi", "ramesh.k@okaxis"))).not.toContain("ramesh");
    expect(describeForAi("url", "https://sbi-kyc.top/login")).toMatchObject({ host: "sbi-kyc.top" });
  });
  it("describes UPI IDs and flags brand names on personal IDs", () => {
    expect(describeUpi("sbi.refund@ybl")).toMatchObject({ app: "PhonePe", local: "brand" });
    expect(analyzeUpi("sbi.refund@ybl").score).toBeGreaterThanOrEqual(40);
    expect(analyzeUpi("ramesh.k@okaxis").score).toBe(0);
  });
  it("the community verdict bounds the combined score", () => {
    const rules = { score: 70, level: "high" as const, signals: [], reassurances: [] };
    const ai = { available: false as const, reason: "x" };
    const base = { people: 0, scam_type: null, channels: [], challenged: false, verified_owner: null, awaiting: false };
    expect(combine(rules, { ...base, verdict: "VERIFIED_BUSINESS" }, ai).score).toBeLessThanOrEqual(8);
    expect(combine({ ...rules, score: 5 }, { ...base, verdict: "KNOWN_SCAM" }, ai).score).toBeGreaterThanOrEqual(85);
    expect(combine({ ...rules, score: 5 }, { ...base, verdict: "SUSPICIOUS" }, ai).score).toBeGreaterThanOrEqual(45);
  });
});
