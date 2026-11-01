import { describe, expect, it } from "vitest";
import { detectType, maskValue, normalizeIdentifier } from "../shared/normalize.js";
import { bestCandidate, extractCandidates } from "../shared/extract.js";

const val = (t: Parameters<typeof normalizeIdentifier>[0], v: string): string | null => {
  const r = normalizeIdentifier(t, v);
  return r.ok ? r.value : null;
};

describe("phone", () => {
  it("treats every spelling of one number as one", () => {
    for (const s of ["+91 98765 43210", "09876543210", "919876543210", "98765-43210", "9876543210", "+91-98765-43210", " 91 98765 43210", "0091 98765 43210", "(+91) 98765 43210"]) {
      expect(val("phone", s), s).toBe("+919876543210");
    }
  });
  it("accepts Devanagari digits", () => expect(val("phone", "९८७६५४३२१०")).toBe("+919876543210"));
  it("keeps landlines as +91 and 10 digits", () => {
    expect(val("phone", "+91 80 4100 2233")).toBe("+918041002233");
    expect(val("phone", "080-4100-2233")).toBe("+918041002233");
    expect(val("phone", "011 2345 6789")).toBe("+911123456789");
  });
  it("accepts toll-free and helpline numbers", () => {
    expect(val("phone", "1800 1600")).toBe("18001600");
    expect(val("phone", "+91 1800 1600")).toBe("18001600");
    expect(val("phone", "1860 419 5555")).toBe("18604195555");
    expect(val("phone", "1930")).toBe("1930");
    expect(val("phone", "112")).toBe("112");
  });
  it("rejects junk", () => {
    for (const s of ["12345", "1234", "test", "abc", "0000000000", "+91 99999 99999", "", "98765", "98765432101234"]) expect(val("phone", s), s).toBeNull();
  });
  it("does not reject sequential numbers", () => expect(val("phone", "9876543210")).toBe("+919876543210"));
});

describe("upi", () => {
  it("lower-cases and strips spaces", () => {
    expect(val("upi", "Ravi12@OKAXIS")).toBe("ravi12@okaxis");
    expect(val("upi", " ravi12 @ okaxis ")).toBe("ravi12@okaxis");
  });
  it("reads the payee from a QR deep link", () => expect(val("upi", "upi://pay?pa=Ravi12%40okaxis&pn=Ravi&am=10")).toBe("ravi12@okaxis"));
  it("rejects junk", () => {
    for (const s of ["test", "test@ybl", "abc@", "@ybl", "a@gmail.com", "ravi@ok axis.com"]) expect(val("upi", s), s).toBeNull();
  });
});

describe("url", () => {
  it("normalises scheme, www, query, fragment, trailing slash and case", () => {
    for (const s of ["http://www.sbi-kyc.in/pay?utm=sms", "https://sbi-kyc.in/pay/", "SBI-KYC.in/Pay", "hxxp://sbi-kyc[.]in/pay", "https://sbi-kyc.in/pay#top", "https://www.sbi-kyc.in:443/pay"]) {
      expect(val("url", s), s).toBe("https://sbi-kyc.in/pay");
    }
  });
  it("converts Unicode look-alike domains to punycode", () => expect(val("url", "https://sbі-kyc.in/a")).toMatch(/^https:\/\/xn--/));
  it("accepts raw IP links", () => expect(val("url", "http://45.12.3.4/kyc")).toBe("https://45.12.3.4/kyc"));
  it("rejects junk", () => {
    for (const s of ["test", "http://", "localhost", "abc", "javascript:alert(1)", "https://site.test/x", "ftp://files.example.in"]) expect(val("url", s), s).toBeNull();
  });
});

describe("sender_id", () => {
  it("drops operator prefix and category suffix", () => {
    for (const s of ["HDFCBK", "AD-HDFCBK", "VM-HDFCBK", "hdfcbk", "VMHDFCBK", "VM-HDFCBK-S", "JD HDFCBK T"]) expect(val("sender_id", s), s).toBe("HDFCBK");
  });
  it("rejects junk", () => {
    for (const s of ["AB", "HDFC BANK", "AAAAAA", "TESTER"]) expect(val("sender_id", s), s).toBeNull();
  });
});

describe("masking (shown until 3 people report)", () => {
  it("matches the brief's formats", () => {
    expect(maskValue("phone", "+919876543210")).toBe("98XXXXX210");
    expect(maskValue("upi", "ravi12@okaxis")).toBe("r***@okaxis");
    expect(maskValue("url", "https://sbi-kyc.in/pay")).toBe("sbi***.in/...");
    expect(maskValue("sender_id", "HDFCBK")).toBe("HD****");
  });
});

describe("detection and extraction for the app", () => {
  it("detects the type of a typed value", () => {
    expect(detectType("+91 98765 43210")).toBe("phone");
    expect(detectType("ravi@okaxis")).toBe("upi");
    expect(detectType("sbi-kyc.in/pay")).toBe("url");
    expect(detectType("AD-HDFCBK")).toBe("sender_id");
  });
  it("pulls identifiers out of a pasted SMS", () => {
    const c = extractCandidates("Your SBI account will be blocked. Update KYC at http://sbi-kyc.in/pay?id=2 or call +91 98765 43210. Pay ravi12@okaxis");
    expect(c.map((x) => x.value)).toEqual(["https://sbi-kyc.in/pay", "ravi12@okaxis", "+919876543210"]);
    expect(bestCandidate("बिजली कट जाएगी, तुरंत 9876543210 पर कॉल करें")?.value).toBe("+919876543210");
  });
});
