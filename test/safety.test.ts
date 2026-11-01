import { describe, expect, it } from "vitest";
import { detectLanguage, hinglishScore, NoteParser, scriptOf, type LocalReading } from "../src/ai/noteParser.js";
import type { Ollama } from "../src/ai/ollama.js";
import { isLocalUrl } from "../src/ai/ollama.js";
import { ClockGuard, type ClockStore } from "../src/licence/clockGuard.js";
import { networkBuckets } from "../src/lib/netprefix.js";
import { noteFeatures } from "../src/lib/text.js";
import { assess, type TrustReport } from "../src/trust/assess.js";
import { suggestScamType } from "../shared/scamTypes.js";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 1, 6, 0);

// ------------------------------------------------------------------ 1. time-travel defence
function memStore(): ClockStore & { hw: number | null; saves: number } {
  const s = {
    hw: null as number | null,
    saves: 0,
    loadHighWater: async () => s.hw,
    saveHighWater: async (ms: number) => {
      s.saves++;
      s.hw = Math.max(s.hw ?? 0, ms); // atomic GREATEST, like the SQL
      return s.hw;
    },
  };
  return s;
}

describe("clock guard (time-travel defence)", () => {
  it("locks when the clock goes behind the high-water mark, and unlocks by itself when it is fixed", async () => {
    let now = T0;
    const g = new ClockGuard(memStore(), () => now, { toleranceMs: 2 * MIN, persistEveryMs: 0 });
    await g.init();
    await g.tick();
    now = T0 - 30_000; // NTP-sized correction: fine
    expect(g.rolledBack()).toBe(false);
    now = T0 - 86_400_000; // someone sets the clock back a day
    expect(g.rolledBack()).toBe(true);
    expect(g.state().status).toBe("CLOCK_ROLLBACK");
    expect(g.state().behind_seconds).toBe(86_400);
    now = T0 + 5_000; // clock put right
    expect(g.rolledBack()).toBe(false);
    expect(g.state().lock_events).toBe(1);
  });

  it("persists atomically and survives a restart", async () => {
    let now = T0;
    const store = memStore();
    const g = new ClockGuard(store, () => now, { persistEveryMs: 0 });
    await g.init();
    await g.tick();
    await g.flush();
    expect(store.hw).toBe(T0);
    now = T0 - 365 * 86_400_000;
    const restarted = new ClockGuard(store, () => now);
    await restarted.init();
    expect(restarted.rolledBack()).toBe(true);
  });

  it("a request dated in the future can't push the mark ahead (no lock-out by one fake request)", async () => {
    const now = T0;
    const g = new ClockGuard(memStore(), () => now, { persistEveryMs: 0 });
    await g.init();
    g.observe(T0 + 10 * 86_400_000, "report");
    expect(g.highWater).toBe(T0);
    expect(g.rolledBack()).toBe(false);
  });

  it("the database clock is a second witness: it catches a rollback even on a fresh install", async () => {
    const now = T0 - 86_400_000; // our clock was set back before the server ever ran
    const store = { ...memStore(), dbNow: async () => T0 };
    const g = new ClockGuard(store, () => now, { persistEveryMs: 0 });
    await g.init();
    expect(g.rolledBack()).toBe(false);
    await g.tick();
    expect(g.rolledBack()).toBe(true);
    expect(g.state().database_clock_offset_seconds).toBe(86_400);
  });

  it("small skew between the app and database clocks never locks", async () => {
    const now = T0;
    const g = new ClockGuard({ ...memStore(), dbNow: async () => T0 + 45_000 }, () => now, { persistEveryMs: 0 });
    await g.init();
    await g.tick();
    expect(g.rolledBack()).toBe(false);
  });
});

// ------------------------------------------------------------------ 3. anti-spoofing
describe("network buckets", () => {
  it("reduces addresses to /24 and /16", () => {
    expect(networkBuckets("49.36.12")).toEqual({ p24: "49.36.12", p16: "49.36" });
    expect(networkBuckets("49.36.12.7")).toEqual({ p24: "49.36.12", p16: "49.36" });
    expect(networkBuckets("49.36.12.0/24")).toEqual({ p24: "49.36.12", p16: "49.36" });
    expect(networkBuckets("2409:40F2:1023::1")).toEqual({ p24: "2409:40f2:1023", p16: "2409:40f2" });
    expect(networkBuckets("wifi-home")).toEqual({ p24: "wifi-home", p16: null });
    expect(networkBuckets("")).toEqual({ p24: null, p16: null });
  });
});

let k = 0;
function rep(net24: string, net16: string | null, at: number, note = ""): TrustReport {
  k++;
  const f = noteFeatures(note, "pepper");
  return {
    reportId: `s${k}`, reporterHash: `acct${k}`, ipHash: net24, net16Hash: net16, reportedAt: at, occurredAt: at,
    noteLen: f.len, noteHash: f.hash, shingles: f.shingles, hasScreenshot: false, lostMoney: false,
    scamType: "digital-arrest", channel: "Phone call", pincode: "560102",
  };
}
const NOTES = [
  "Video call from a fake police officer about drugs in a parcel",
  "उसने कहा CBI से हूँ और आधार पर केस है, पैसे भेजो",
  "Bola aapka sim illegal kaam me use hua, turant paisa bhejo",
  "Kept on Skype for hours by a fake customs officer asking for money",
  "Caller knew my PAN and threatened arrest unless I paid",
  "Man in uniform said don't tell anyone, stay on the call",
];

describe("subnet clustering (prefix cycling)", () => {
  it("one host cycling /24 prefixes inside one /16 within minutes = one person", () => {
    const reps = Array.from({ length: 8 }, (_, i) => rep(`10.20.${i}`, "10.20", T0 + i * 40_000, NOTES[i % 6]));
    const r = assess(reps, new Map());
    expect(r.distinctReporters).toBe(1);
    expect(r.flags).toContain("SUBNET_CLUSTER");
    expect(r.verdict).not.toBe("KNOWN_SCAM");
    expect(r.countableReportIds).toHaveLength(0); // never feeds the map or alerts
  });

  it("the cluster is one vote: unrelated people elsewhere still confirm a real scam", () => {
    const cluster = Array.from({ length: 6 }, (_, i) => rep(`10.20.${i}`, "10.20", T0 + i * 30_000, NOTES[i % 6]));
    const others = [
      rep("49.36.1", "49.36", T0 - 50 * MIN, "My mother got a WhatsApp call from someone in a police uniform asking for a fine"),
      rep("106.193.4", "106.193", T0 - 30 * MIN, "वीडियो कॉल पर नकली अफसर ने गिरफ्तारी की धमकी दी और 50 हज़ार माँगे"),
      rep("223.187.9", "223.187", T0 - 9 * MIN, "Said my courier had MDMA and I must transfer money to clear my name"),
    ];
    const r = assess([...cluster, ...others], new Map());
    expect(r.distinctReporters).toBe(4);
    expect(r.verdict).toBe("KNOWN_SCAM");
  });

  it("real neighbours on one carrier block are NOT merged: reports more than 5 minutes apart", () => {
    const reps = [rep("49.36.1", "49.36", T0, NOTES[0]), rep("49.36.2", "49.36", T0 + 7 * MIN, NOTES[1]), rep("49.36.3", "49.36", T0 + 15 * MIN, NOTES[2])];
    const r = assess(reps, new Map());
    expect(r.distinctReporters).toBe(3);
    expect(r.verdict).toBe("KNOWN_SCAM");
  });

  it("two people in one block within minutes are not enough to merge", () => {
    const r = assess([rep("49.36.1", "49.36", T0, NOTES[0]), rep("49.36.2", "49.36", T0 + MIN, NOTES[1])], new Map());
    expect(r.distinctReporters).toBe(2);
    expect(r.flags).not.toContain("SUBNET_CLUSTER");
  });
});

// ------------------------------------------------------------------ 2. Hindi / Hinglish notes
describe("note language and rules", () => {
  it("detects Devanagari, Hinglish and English", () => {
    expect(scriptOf("बिजली कट जाएगी")).toBe("devanagari");
    expect(detectLanguage("बिजली विभाग से फोन आया, कनेक्शन कट जाएगा")).toBe("hindi");
    expect(detectLanguage("mujhe bola aapka khata band ho jayega")).toBe("hinglish");
    expect(hinglishScore("mujhe bola aapka khata band ho jayega")).toBeGreaterThanOrEqual(4);
    expect(detectLanguage("They said my account will be blocked")).toBe("english");
  });
  it("Hinglish keywords pick a type at once", () => {
    expect(suggestScamType("police wale ne bola giraftar karenge")).toBe("digital-arrest");
    expect(suggestScamType("bijli ka connection kat jayega aaj raat")).toBe("electricity-disconnection");
    expect(suggestScamType("ghar baithe naukri, registration fee bhejo")).toBe("job-offer");
  });
  it("only private / local Ollama addresses are accepted by default", () => {
    expect(isLocalUrl("http://localhost:11434")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:11434")).toBe(true);
    expect(isLocalUrl("http://192.168.1.20:11434")).toBe(true);
    expect(isLocalUrl("https://api.example.com")).toBe(false);
  });
});

function fakeOllama(reply: Partial<LocalReading> | null): Ollama {
  return {
    model: "fake:3b",
    url: "http://localhost:11434",
    check: async () => ({ ok: true, reason: null, models: ["fake:3b"] }),
    json: async (_s: string, _u: string, _schema: unknown, parse: (v: unknown) => unknown) => (reply ? { data: parse({ language: "hinglish", english: "x", scam_type: "other", confidence: 0.9, ...reply }), ms: 12 } : null),
  } as unknown as Ollama;
}

describe("local AI note parser", () => {
  it("re-labels a report when the model is confident, and keeps the text out of its stats", async () => {
    const p = new NoteParser(fakeOllama({ scam_type: "digital-arrest", confidence: 0.92, english: "A fake policeman threatened arrest." }));
    const seen: string[] = [];
    p.onReading = async (job, r) => {
      seen.push(`${job.reportId}:${r.scam_type}`);
      return "changed";
    };
    expect(p.wants("mujhe police wale ne video call pe dhamki di", null)).toBe(true);
    p.enqueue({ reportId: "rep1", note: "mujhe police wale ne video call pe dhamki di", current: "other", pincode: "560102" });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(["rep1:digital-arrest"]);
    const st = p.status({ ok: true, reason: null });
    expect(st.changed).toBe(1);
    expect(JSON.stringify(st)).not.toContain("dhamki");
  });
  it("a low-confidence or 'other' reading is not accepted", () => {
    const p = new NoteParser(fakeOllama(null));
    expect(p.accept({ language: "hindi", english: "", scam_type: "other", confidence: 0.99, model: "m", ms: 1 })).toBe(false);
    expect(p.accept({ language: "hindi", english: "", scam_type: "otp-call", confidence: 0.4, model: "m", ms: 1 })).toBe(false);
    expect(p.accept({ language: "hindi", english: "", scam_type: "otp-call", confidence: 0.8, model: "m", ms: 1 })).toBe(true);
  });
  it("read() returns the translation and both opinions", async () => {
    const p = new NoteParser(fakeOllama({ scam_type: "electricity-disconnection", confidence: 0.9, english: "The power will be cut tonight." }));
    const r = await p.read("बिजली विभाग से फोन आया, आज रात कनेक्शन कट जाएगा");
    expect(r.language).toBe("hindi");
    expect(r.rules).toBe("electricity-disconnection");
    expect(r.chosen_by).toBe("local_ai");
    expect(r.local_ai.available && r.local_ai.english).toBe("The power will be cut tonight.");
  });
  it("without Ollama the rules still decide", async () => {
    const p = new NoteParser(null);
    const r = await p.read("ghar baithe naukri, registration fee bhejo");
    expect(r.local_ai.available).toBe(false);
    expect(r.chosen).toBe("job-offer");
    expect(r.chosen_by).toBe("rules");
  });
});
