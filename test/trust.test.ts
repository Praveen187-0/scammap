import { describe, expect, it } from "vitest";
import { noteFeatures } from "../src/lib/text.js";
import { assess, reporterWeight, type TrustReport } from "../src/trust/assess.js";
import { TRUST } from "../src/trust/config.js";

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.UTC(2026, 9, 31, 12);
let n = 0;
function rep(over: Partial<TrustReport> & { note?: string } = {}): TrustReport {
  n++;
  const f = noteFeatures(over.note ?? "", "pepper");
  return {
    reportId: `r${n}`, reporterHash: `p${n}`, ipHash: `ip${n}`, reportedAt: NOW - n * 7 * H, occurredAt: NOW - n * 7 * H,
    noteLen: f.len, noteHash: f.hash, shingles: f.shingles, hasScreenshot: false, lostMoney: false,
    scamType: "digital-arrest", channel: "Phone call", pincode: "560102", ...over,
  };
}
const story = (i: number): string =>
  [
    "Got a video call from a man in police uniform who said a parcel with drugs was booked in my name",
    "उसने कहा मैं CBI से हूँ और मेरे आधार पर केस है, घंटों वीडियो कॉल पर बैठाए रखा",
    "Bola aapka sim illegal kaam me use hua hai, digital arrest hai, turant paisa bhejo",
    "My father was kept on Skype for three hours by a fake customs officer asking for 2 lakh",
    "Caller already knew my Aadhaar and PAN and threatened arrest unless I paid that evening",
    "पुलिस की वर्दी में आदमी ने कहा घर से बाहर मत जाना और किसी को मत बताना",
    "They showed a fake Mumbai police ID card on WhatsApp and demanded a security deposit",
  ][i % 7] ?? "";

describe("verdict ladder", () => {
  it("no reports -> NO_REPORTS", () => expect(assess([], new Map()).verdict).toBe("NO_REPORTS"));
  it("one or two people -> SUSPICIOUS", () => {
    expect(assess([rep({ note: story(0) })], new Map()).verdict).toBe("SUSPICIOUS");
    expect(assess([rep({ note: story(0) }), rep({ note: story(1) })], new Map()).verdict).toBe("SUSPICIOUS");
  });
  it("three clean first-time reporters -> KNOWN_SCAM, even with empty notes (3 x 0.8 x 0.85 = 2.04)", () => {
    const r = assess([rep(), rep(), rep()], new Map());
    expect(r.weight).toBeCloseTo(2.04, 2);
    expect(r.verdict).toBe("KNOWN_SCAM");
  });
  it("seven real people -> KNOWN_SCAM with 7 voices", () => {
    const r = assess(Array.from({ length: 7 }, (_, i) => rep({ note: story(i) })), new Map());
    expect(r.verdict).toBe("KNOWN_SCAM");
    expect(r.distinctReporters).toBe(7);
  });
});

describe("tricks", () => {
  it("C: real victims reusing the same stock sentence days apart stay separate people", () => {
    const same = "Video call from a man in police uniform saying a parcel with drugs is in my name";
    const r = assess([rep({ note: same, reportedAt: NOW - 9 * D }), rep({ note: same, reportedAt: NOW - 4 * D }), rep({ note: same, reportedAt: NOW - D })], new Map());
    expect(r.distinctReporters).toBe(3);
    expect(r.verdict).toBe("KNOWN_SCAM");
  });
  it("C: the same sentence pasted by 3 accounts within an hour is one voice", () => {
    const same = "This bakery is a fraud they cheated me do not buy from them";
    const r = assess([0, 1, 2].map((i) => rep({ note: same, reportedAt: NOW - i * 10 * 60_000 })), new Map());
    expect(r.distinctReporters).toBe(1);
  });
  it("A: one person reporting 6 times is one person", () => {
    const r = assess(Array.from({ length: 6 }, (_, i) => rep({ reporterHash: "same", note: story(i) })), new Map());
    expect(r.distinctReporters).toBe(1);
    expect(r.verdict).toBe("SUSPICIOUS");
    expect(r.countableReportIds).toHaveLength(0); // spam never feeds alerts
  });
  it("B: 22 accounts on one network within hours is one low-trust person", () => {
    const r = assess(Array.from({ length: 22 }, (_, i) => rep({ ipHash: "wifi", reportedAt: NOW - i * 5 * 60_000, note: story(i) })), new Map());
    expect(r.distinctReporters).toBe(1);
    expect(r.verdict).toBe("SUSPICIOUS");
    expect(r.countableReportIds).toHaveLength(0);
  });
  it("C: 40 copy-pasted notes collapse to one voice", () => {
    const base = "This bakery is a fraud they cheated me do not buy from them";
    const r = assess(Array.from({ length: 40 }, (_, i) => rep({ reportedAt: NOW - i * D, note: i % 2 ? base.toUpperCase() : `${base}!!` })), new Map());
    expect(r.distinctReporters).toBe(1);
    expect(r.verdict).toBe("SUSPICIOUS");
  });
  it("C: two real victims who write alike (days apart) are NOT merged", () => {
    const a = "Got a call from someone claiming to be CBI, asked me to transfer Rs 25,000 to clear my name, I hung up.";
    const b = "Got a call from someone claiming to be CBI, asked me to transfer Rs 80,000 to clear my name, we lost Rs 2 lakh.";
    const r = assess([rep({ note: a }), rep({ note: b }), rep({ note: story(3) })], new Map());
    expect(r.distinctReporters).toBe(3);
    expect(r.verdict).toBe("KNOWN_SCAM");
  });
  it("D: 40 empty-note reports in one hour from different networks are a coordinated burst", () => {
    const r = assess(Array.from({ length: 40 }, (_, i) => rep({ reportedAt: NOW - i * 90_000 })), new Map());
    expect(r.flags).toContain("COORDINATED_BURST");
    expect(r.verdict).toBe("SUSPICIOUS");
    expect(r.countableReportIds).toHaveLength(0);
  });
  it("D: a real wave of 15 unrelated people in their own words is NOT a burst", () => {
    const r = assess(Array.from({ length: 15 }, (_, i) => rep({ reportedAt: NOW - i * 20 * 60_000, note: `${story(i)} (${i * 7 + 3} pm, Rs ${i * 1000 + 500})` })), new Map());
    expect(r.flags).not.toContain("COORDINATED_BURST");
    expect(r.verdict).toBe("KNOWN_SCAM");
    expect(r.countableReportIds.length).toBeGreaterThanOrEqual(5); // enough to raise a SPIKE
  });
  it("D: a burst built from only a few texts is coordinated", () => {
    const texts = ["This bakery is a fraud they cheated me", "Fraud shop never buy here ever again", "They sold me rotten cake and abused me"];
    const r = assess(Array.from({ length: 40 }, (_, i) => rep({ reportedAt: NOW - i * 2 * 60_000, note: texts[i % 3] })), new Map());
    expect(r.verdict).toBe("SUSPICIOUS");
    expect(r.countableReportIds).toHaveLength(0);
  });
  it("large campaign with no first-hand detail is not KNOWN_SCAM and never feeds alerts", () => {
    const r = assess(Array.from({ length: 30 }, (_, i) => rep({ reportedAt: NOW - i * 4 * H })), new Map());
    expect(r.flags).toContain("NO_FIRST_HAND_DETAIL");
    expect(r.verdict).toBe("SUSPICIOUS");
    expect(r.countableReportIds).toHaveLength(0);
  });
  it("personal grudges ('my ex', 'owes me money') never move a number up the ladder", () => {
    const grudges = ["My ex boyfriend, he owes me money", "This is my ex husband, report him", "revenge, he owes me money"];
    const r = assess(grudges.map((note) => rep({ note, personalDispute: true })), new Map());
    expect(r.credibleVoices).toBe(0);
    expect(r.verdict).not.toBe("KNOWN_SCAM");
    expect(r.countableReportIds).toHaveLength(0);
  });
  it("a grudge note does not hide real victims of the same number", () => {
    const r = assess([rep({ note: "my ex, owes me money", personalDispute: true }), ...[0, 1, 2].map((i) => rep({ note: story(i) }))], new Map());
    expect(r.credibleVoices).toBe(3);
    expect(r.verdict).toBe("KNOWN_SCAM");
  });
  it("a real scam survives a spammer and a sybil ring piled on top", () => {
    const real = Array.from({ length: 5 }, (_, i) => rep({ reportedAt: NOW - (i + 2) * D, note: story(i) }));
    const spam = Array.from({ length: 3 }, () => rep({ reporterHash: "spammer", reportedAt: NOW - H }));
    const ring = Array.from({ length: 10 }, (_, i) => rep({ ipHash: "ring", reportedAt: NOW - i * 6 * 60_000 }));
    expect(assess([...real, ...spam, ...ring], new Map()).verdict).toBe("KNOWN_SCAM");
  });
});

describe("weights", () => {
  it("new < returning < corroborated, flagged is capped", () => {
    expect(reporterWeight(undefined)).toBe(TRUST.weightNewReporter);
    expect(reporterWeight({ hasOtherReports: true, corroborated: 0, flagged: 0 })).toBe(TRUST.weightReturningReporter);
    expect(reporterWeight({ hasOtherReports: true, corroborated: 1, flagged: 0 })).toBe(1.25);
    expect(reporterWeight({ hasOtherReports: true, corroborated: 9, flagged: 0 })).toBe(TRUST.weightMax);
    expect(reporterWeight({ hasOtherReports: true, corroborated: 3, flagged: 1 })).toBe(TRUST.weightFlaggedReporter);
  });
  it("a voice is as strong as its best member, not the sum", () => {
    const r = assess(Array.from({ length: 5 }, () => rep({ reporterHash: "same", note: story(1) })), new Map());
    expect(r.weight).toBeLessThanOrEqual(TRUST.weightNewReporter);
  });
});
