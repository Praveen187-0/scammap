// One normaliser for every identifier, used by reports, lookups, challenges and the verified list,
// so "+91 98765 43210", "09876543210" and "919876543210" can never become different records.

export const IDENTIFIER_TYPES = ["phone", "upi", "url", "sender_id"] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

export type NormalizeResult =
  | { ok: true; type: IdentifierType; value: string; key: string }
  | { ok: false; error: string };

const TYPE_ALIASES: Record<string, IdentifierType> = {
  phone: "phone",
  mobile: "phone",
  number: "phone",
  upi: "upi",
  upi_id: "upi",
  vpa: "upi",
  url: "url",
  link: "url",
  website: "url",
  sender_id: "sender_id",
  sender: "sender_id",
  sms_sender: "sender_id",
  header: "sender_id",
};

export function parseIdentifierType(raw: unknown): IdentifierType | null {
  if (typeof raw !== "string") return null;
  return TYPE_ALIASES[raw.trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? null;
}

// Short service codes that are real (helplines). Any other 3 to 5 digit value, like "12345", is junk.
export const SHORT_CODES: ReadonlySet<string> = new Set([
  "100", "101", "102", "108", "112", "139", "181", "1033", "1064", "1091", "1098", "1363", "1909", "1930", "14416", "14567",
]);

// Placeholder words people type when testing. Rejected so they never become records.
const JUNK_WORDS: ReadonlySet<string> = new Set([
  "test", "testing", "tester", "abc", "abcd", "xyz", "asdf", "qwerty", "dummy", "sample", "null", "none", "na", "nil",
  "foo", "bar", "example", "fake", "unknown",
]);

const TOLL_FREE = /^(1800|1860)\d{4,7}$/;
// North American numbers (+1: USA, Canada), used by many "Amazon support" and tech-support callers. Accepted ONLY with
// the country code written out (+1 or 001): in India a bare 830 468 0018 is a mobile number, and 1800... is toll-free.
const NANP = /^1([2-9]\d{2}[2-9]\d{6})$/;

function ok(type: IdentifierType, value: string): NormalizeResult {
  return { ok: true, type, value, key: `${type}:${value}` };
}
function fail(error: string): NormalizeResult {
  return { ok: false, error };
}

/** Devanagari digits (०-९) to ASCII, after NFKC has folded full-width forms. */
function asciiDigits(s: string): string {
  return s.replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966));
}

export function normalizePhone(raw: string): NormalizeResult {
  const s = asciiDigits(raw.normalize("NFKC")).trim();
  if (!s) return fail("phone number is empty");
  if (/[^\d\s+\-().\/]/.test(s)) return fail("a phone number can only contain digits, spaces, + and -");
  // A "+" in an unencoded query string arrives as a space, so a leading space before 91 also means "+91".
  const hadPlus = /^\s*\+/.test(raw) || /^\s+91/.test(raw);
  let d = s.replace(/\D/g, "");
  if (!d) return fail("phone number has no digits");
  // "+1 ..." (a "+" in an unencoded query string arrives as a space, so " 1 830 ..." counts too) or "001 ...".
  const plusOne = /^\s*\+\s*1/.test(raw) || (/^\s+1[\s(.-]*[2-9]\d{2}/.test(raw) && d.length === 11);
  if (plusOne && NANP.test(d)) return ok("phone", `+${d}`);
  if (d.startsWith("001") && NANP.test(d.slice(2))) return ok("phone", `+${d.slice(2)}`);

  if (d.startsWith("0091")) d = d.slice(4);
  else if (d.length === 13 && d.startsWith("091")) d = d.slice(3);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.startsWith("91") && (hadPlus || d.length !== 10) && TOLL_FREE.test(d.slice(2))) d = d.slice(2);
  if (d.startsWith("0") && TOLL_FREE.test(d.slice(1))) d = d.slice(1);

  // Toll-free numbers keep their own form; they are not 10-digit mobiles.
  if (TOLL_FREE.test(d)) return ok("phone", d);
  if (d.length <= 5) return SHORT_CODES.has(d) ? ok("phone", d) : fail("not a valid phone number");

  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10 || d.startsWith("0")) return fail("not a valid phone number");
  // All-same digits are junk. Sequential digits are NOT: 9876543210 is the brief's own example.
  if (/^(\d)\1+$/.test(d)) return fail("not a valid phone number");
  return ok("phone", `+91${d}`);
}

export function normalizeUpi(raw: string): NormalizeResult {
  let s = raw.normalize("NFKC").trim();
  // QR codes contain upi://pay?pa=<id>&pn=...; pull out the payee address.
  if (/^upi:\/\//i.test(s)) {
    let pa: string | null = null;
    try {
      pa = new URL(s).searchParams.get("pa");
    } catch {
      pa = null;
    }
    if (!pa) return fail("UPI link has no pa= payee address");
    s = pa;
  }
  s = s.replace(/\s+/g, "").toLowerCase();
  const m = /^([a-z0-9][a-z0-9._-]{0,255})@([a-z][a-z0-9]{1,63})$/.exec(s);
  if (!m) return fail("not a valid UPI ID");
  const local = m[1] ?? "";
  const handle = m[2] ?? "";
  if (JUNK_WORDS.has(local) || JUNK_WORDS.has(handle)) return fail("not a valid UPI ID");
  return ok("upi", s);
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOSTNAME = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;
const RESERVED_TLDS = /\.(test|example|invalid|localhost|local)$/;

export function normalizeUrl(raw: string): NormalizeResult {
  let s = raw.normalize("NFKC").trim();
  if (!s) return fail("link is empty");
  // Undo common "defanging" so hxxp://sbi-kyc[.]in matches https://sbi-kyc.in.
  s = s
    .replace(/^h(?:xx|\*\*|tt)p(s?)/i, "http$1")
    .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\)/gi, ".")
    .replace(/\[:\]/g, ":");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return fail("not a valid link");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return fail("only web links can be reported");
  // WHATWG URL already lower-cases the host and converts Unicode look-alikes to punycode (xn--).
  let host = u.hostname.toLowerCase().replace(/\.$/, "");
  host = host.replace(/^www\d*\./, "");
  if (!IPV4.test(host)) {
    if (!HOSTNAME.test(host) || RESERVED_TLDS.test(host) || /^example\.(com|org|net)$/.test(host)) {
      return fail("not a valid link");
    }
  }
  const port = u.port ? `:${u.port}` : "";
  // Query, fragment and trailing slash are dropped; the path is lower-cased so /Pay and /pay match.
  const path = u.pathname.toLowerCase().replace(/\/+$/, "");
  return ok("url", `https://${host}${port}${path}`);
}

export function normalizeSender(raw: string): NormalizeResult {
  const s = raw.normalize("NFKC").toUpperCase().trim();
  const parts = s.split(/[^A-Z0-9]+/).filter(Boolean);
  let cand: string | undefined = parts.find((p) => p.length === 6);
  const only = parts.length === 1 ? parts[0] : undefined;
  // Phones show AD-HDFCBK or VMHDFCBK: a 2-letter operator prefix. Since 2025 a -S/-T/-P/-G suffix may follow.
  if (!cand && only && only.length === 8) cand = only.slice(2);
  if (!cand && only && only.length === 9 && /[PSTG]$/.test(only)) cand = only.slice(2, 8);
  if (!cand || !/^[A-Z0-9]{6}$/.test(cand)) return fail("an SMS sender ID has 6 letters, like HDFCBK");
  if (/^(.)\1{5}$/.test(cand) || JUNK_WORDS.has(cand.toLowerCase())) return fail("not a valid SMS sender ID");
  return ok("sender_id", cand);
}

export function normalizeIdentifier(type: IdentifierType, raw: unknown): NormalizeResult {
  if (typeof raw !== "string" && typeof raw !== "number") return fail("identifier_value is required");
  const value = String(raw);
  if (value.length > 2048) return fail("identifier_value is too long");
  switch (type) {
    case "phone":
      return normalizePhone(value);
    case "upi":
      return normalizeUpi(value);
    case "url":
      return normalizeUrl(value);
    case "sender_id":
      return normalizeSender(value);
  }
}

/** Guess the type of a typed or pasted value. Used by the app's check-as-you-type box. */
export function detectType(raw: string): IdentifierType | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^upi:\/\//i.test(s)) return "upi";
  if (s.includes("@") && !s.includes("/") && normalizeUpi(s).ok) return "upi";
  if (/^(h(xx|tt)ps?:\/\/|www\.)/i.test(s) || (/[a-z0-9-]+(\.|\[\.\])[a-z]{2,}(\/|$)/i.test(s) && !s.includes("@"))) {
    if (normalizeUrl(s).ok) return "url";
  }
  if (/^[\s+\d\-().०-९]+$/.test(s) && normalizePhone(s).ok) return "phone";
  if (/^[A-Za-z]{2}[-\s]?[A-Za-z0-9]{6}([-\s][PSTGpstg])?$/.test(s) || /^[A-Za-z]{6}$/.test(s)) {
    if (normalizeSender(s).ok) return "sender_id";
  }
  return null;
}

/** Display form of a normalised value: "+919876543210" stays as stored, as Appendix A shows. */
export function maskValue(type: IdentifierType, value: string): string {
  switch (type) {
    case "phone": {
      if (/^\+1\d{10}$/.test(value)) return `+1 ${value.slice(2, 4)}${"X".repeat(5)}${value.slice(-3)}`;
      const n = value.startsWith("+91") ? value.slice(3) : value;
      if (n.length >= 6) return n.slice(0, 2) + "X".repeat(n.length - 5) + n.slice(-3);
      return n.slice(0, 1) + "X".repeat(Math.max(0, n.length - 1));
    }
    case "upi": {
      const [local = "", handle = ""] = value.split("@");
      return `${local.slice(0, 1)}***@${handle}`;
    }
    case "url": {
      const rest = value.replace(/^https?:\/\//, "");
      const slash = rest.indexOf("/");
      const host = slash === -1 ? rest : rest.slice(0, slash);
      const hasPath = slash !== -1 && rest.length > slash + 1;
      const hostNoPort = host.replace(/:\d+$/, "");
      if (IPV4.test(hostNoPort)) return `${hostNoPort.split(".")[0] ?? ""}.***${hasPath ? "/..." : ""}`;
      const labels = hostNoPort.split(".");
      const tld = labels.pop() ?? "";
      const name = labels.join(".");
      return `${name.slice(0, 3)}***.${tld}${hasPath ? "/..." : ""}`;
    }
    case "sender_id":
      return `${value.slice(0, 2)}****`;
  }
}
