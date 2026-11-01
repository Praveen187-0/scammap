import { describe, expect, it } from "vitest";
import { computeAlerts, computeClusters, severityFor, type CountableRow } from "../src/alerts/alerts.js";
import { AREA_BY_PIN, areasWithin } from "../shared/areas.js";

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.UTC(2026, 9, 31, 12);
const row = (pincode: string, scamType: string, ago: number): CountableRow => ({ pincode, scamType, occurredAt: NOW - ago });

describe("SPIKE", () => {
  it("fires at >= 5 and >= 2x the prior 7-day daily average", () => {
    const rows = [...Array.from({ length: 14 }, (_, i) => row("560102", "otp-call", D + (i + 1) * 11 * H)), ...Array.from({ length: 5 }, (_, i) => row("560102", "otp-call", i * H))];
    const spike = computeAlerts(rows, "560102", NOW).find((a) => a.type === "SPIKE");
    expect(spike).toMatchObject({ type: "SPIKE", count: 5, baseline_per_day: 2, window: "24h" });
  });
  it("does not fire under 5, or under double the baseline", () => {
    expect(computeAlerts(Array.from({ length: 4 }, (_, i) => row("560102", "otp-call", i * H)), "560102", NOW)).toHaveLength(1); // NEW_TYPE only
    const steady = [...Array.from({ length: 28 }, (_, i) => row("560102", "otp-call", D + (i + 1) * 5 * H)), ...Array.from({ length: 6 }, (_, i) => row("560102", "otp-call", i * H))];
    expect(computeAlerts(steady, "560102", NOW).some((a) => a.type === "SPIKE")).toBe(false);
  });
  it("with no history, 5 reports in a day is a spike", () => {
    expect(computeAlerts(Array.from({ length: 5 }, (_, i) => row("560038", "job-offer", i * H)), "560038", NOW).some((a) => a.type === "SPIKE")).toBe(true);
  });
});

describe("NEW_TYPE", () => {
  it("fires for a type not seen in the 30 days before", () => {
    const rows = [row("560066", "otp-call", 3 * D), row("560066", "job-offer", 2 * H)];
    expect(computeAlerts(rows, "560066", NOW)).toEqual([expect.objectContaining({ type: "NEW_TYPE", scam_type: "job-offer", window: "24h" })]);
  });
  it("does not fire for a type seen 10 days ago, but does for one last seen 40 days ago", () => {
    expect(computeAlerts([row("560066", "otp-call", 10 * D), row("560066", "otp-call", H)], "560066", NOW)).toHaveLength(0);
    expect(computeAlerts([row("560066", "otp-call", 40 * D), row("560066", "otp-call", H)], "560066", NOW)).toHaveLength(1);
  });
});

describe("map", () => {
  it("2 km around HSR is only HSR; 10 km reaches Koramangala", () => {
    const hsr = AREA_BY_PIN.get("560102")!;
    expect(areasWithin(hsr, 2).map((a) => a.pincode)).toEqual(["560102"]);
    expect(areasWithin(hsr, 10).map((a) => a.pincode)).toContain("560034");
  });
  it("only the window counts, and points come from the area table", () => {
    const rows = [row("560102", "otp-call", H), row("560102", "otp-call", 30 * D)];
    const [c] = computeClusters(rows, [AREA_BY_PIN.get("560102")!], 7, NOW);
    expect(c).toMatchObject({ pincode: "560102", count: 1, lat: 12.9116, lng: 77.6473 });
  });
  it("severity scale", () => {
    expect(severityFor(2, false)).toBe("MED");
    expect(severityFor(5, false)).toBe("HIGH");
    expect(severityFor(10, false)).toBe("CRIT");
    expect(severityFor(1, true)).toBe("CRIT");
  });
});
