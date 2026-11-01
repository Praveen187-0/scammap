// Pull phone numbers, UPI IDs, links and sender IDs out of a whole pasted SMS or WhatsApp message,
// so a reporter can paste the message instead of copying the number by hand.
import { detectType, normalizeIdentifier, type IdentifierType } from "./normalize.js";

export interface Candidate {
  type: IdentifierType;
  raw: string;
  value: string;
}

const PATTERNS: ReadonlyArray<{ type: IdentifierType; re: RegExp }> = [
  { type: "upi", re: /upi:\/\/pay\?[^\s"'<>]+/gi },
  { type: "url", re: /\b(?:h(?:tt|xx)ps?:\/\/|www\.)[^\s"'<>]+|\b[a-z0-9][a-z0-9-]*(?:\.|\[\.\])[a-z0-9.-]*[a-z]{2,}\/[^\s"'<>]*/gi },
  { type: "upi", re: /\b[a-z0-9][a-z0-9._-]{1,63}@[a-z][a-z0-9]{1,30}\b(?!\.[a-z])/gi },
  // +1 (818) 322-4089 style North American numbers, with brackets and dots.
  { type: "phone", re: /\+1[\s.-]?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}\b/g },
  { type: "phone", re: /(?:\+|\b)(?:\d[\d\s-]{6,15}\d|1930|1909)\b/g },
  { type: "sender_id", re: /\b[A-Z]{2}-[A-Z0-9]{6}(?:-[PSTG])?\b/g },
];

export function extractCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const t = text.normalize("NFKC");
  for (const { type, re } of PATTERNS) {
    for (const m of t.matchAll(re)) {
      const raw = m[0].replace(/[.,;:!?)\]]+$/, "");
      const res = normalizeIdentifier(type, raw);
      if (!res.ok || seen.has(res.key)) continue;
      seen.add(res.key);
      out.push({ type: res.type, raw, value: res.value });
    }
  }
  return out;
}

/** Best single guess for a short typed value or a long pasted message. */
export function bestCandidate(text: string): Candidate | null {
  const s = text.trim();
  if (!s) return null;
  const direct = detectType(s);
  if (direct) {
    const res = normalizeIdentifier(direct, s);
    if (res.ok) return { type: res.type, raw: s, value: res.value };
  }
  return extractCandidates(s)[0] ?? null;
}
