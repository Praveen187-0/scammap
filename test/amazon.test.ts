import { describe, expect, it } from "vitest";
import { extractCandidates } from "../shared/extract.js";
import { maskValue, normalizePhone } from "../shared/normalize.js";
import { analyzeText } from "../shared/risk.js";
import { suggestScamType } from "../shared/scamTypes.js";

describe("US (+1) numbers used by fake Amazon support", () => {
  it("are accepted only with the country code", () => {
    expect(normalizePhone("+1 830-468-0018")).toMatchObject({ ok: true, value: "+18304680018" });
    expect(normalizePhone("+1 (818) 322-4089")).toMatchObject({ ok: true, value: "+18183224089" });
    expect(normalizePhone("001 877 550 9899")).toMatchObject({ ok: true, value: "+18775509899" });
    // Without +1 the Indian reading stays: never guess a country for a bare 10-digit number.
    expect(normalizePhone("830-468-0018")).toMatchObject({ ok: true, value: "+918304680018" });
    expect(normalizePhone("1-800-535-6890")).toMatchObject({ ok: true, value: "18005356890" });
    expect(normalizePhone("+1 123 456 7890").ok).toBe(false);
    expect(normalizePhone("+12345").ok).toBe(false);
    expect(maskValue("phone", "+18304680018")).toBe("+1 83XXXXX018");
  });
  it("are found inside pasted messages, brackets and all", () => {
    expect(extractCandidates("call +1 (818) 322-4089 or +1 888-814-2357").map((c) => c.value)).toEqual(["+18183224089", "+18888142357"]);
  });
});

describe("Amazon impersonation patterns", () => {
  it("fake order + call to cancel + number abroad = high risk", () => {
    const r = analyzeText("Amazon: Your order of Apple iPhone 15 Pro (Rs 1,34,900) has been placed. If you did not place this order, call our cancellation desk at +1 888-814-2357 immediately.");
    expect(r.signals.map((s) => s.id)).toEqual(expect.arrayContaining(["amazon-fake-order", "brand-abroad"]));
    expect(r.level).toBe("high");
  });
  it("US-style toll-free number with the Amazon name, not mistaken for an Indian mobile", () => {
    const r = analyzeText("This is Amazon. A charge of $499 for Prime membership renewal was placed on your account. Press 1 or call 888-386-1719.");
    const ids = r.signals.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["amazon-fake-order", "us-tollfree"]));
    expect(ids).not.toContain("call-mobile");
  });
  it("a delivery agent asking for an OTP", () => {
    const r = analyzeText("Sir I am delivery boy from Amazon, your parcel OTP not received, please tell the OTP you got just now");
    expect(r.signals.map((s) => s.id)).toEqual(expect.arrayContaining(["delivery-otp", "asks-code"]));
    expect(suggestScamType("Sir I am delivery boy from Amazon, your parcel OTP not received, please tell the OTP you got just now")).toBe("otp-call");
  });
  it("a real Amazon shipping SMS stays low", () => {
    const r = analyzeText("Your Amazon order #402-1234567 has been shipped and will arrive tomorrow. Track it in Your Orders.");
    expect(r.level).toBe("low");
    expect(r.signals).toHaveLength(0);
  });
  it("fake order calls are typed as fake customer care", () => {
    expect(suggestScamType("Amazon ke naam se call aaya, order cancel karne ke liye press 1 bola")).toBe("fake-customer-care");
  });
});
