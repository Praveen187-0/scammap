// Note features. The raw note is never stored: only its length, a keyed hash and keyed character-shingle
// hashes survive, which is enough to spot copy-pasted reports and nothing more.
import { hmacHex, hmacInt32 } from "./hmac.js";

export interface NoteFeatures {
  len: number;
  hash: string | null;
  shingles: number[];
  script: "deva" | "latn" | "mixed" | "none";
}

const SHINGLE = 5;
const MAX_SHINGLES = 400;

/** Unicode-aware: keeps letters, combining marks (Devanagari vowel signs) and digits. Never ASCII-only. */
export function normaliseNote(note: string): string {
  return note
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function noteFeatures(note: string | null | undefined, pepper: string): NoteFeatures {
  const n = normaliseNote(note ?? "");
  const chars = Array.from(n);
  if (chars.length === 0) return { len: 0, hash: null, shingles: [], script: "none" };
  const set = new Set<number>();
  // Character 5-grams survive small edits (one word swapped, punctuation changed) far better than word shingles.
  for (let i = 0; i + SHINGLE <= chars.length && set.size < MAX_SHINGLES; i++) {
    set.add(hmacInt32(pepper, "sh", chars.slice(i, i + SHINGLE).join("")));
  }
  const deva = /\p{Script=Devanagari}/u.test(n);
  const latn = /\p{Script=Latin}/u.test(n);
  return {
    len: chars.length,
    hash: hmacHex(pepper, "note", n),
    shingles: [...set],
    script: deva && latn ? "mixed" : deva ? "deva" : latn ? "latn" : "none",
  };
}

export function jaccard(a: ReadonlySet<number>, b: ReadonlySet<number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// A grudge, not a scam: the note talks about a personal relationship with the number's owner.
const PERSONAL = /\b(my ex\b|ex[- ]?(boyfriend|girlfriend|husband|wife|bf|gf)|owes me( money)?|took my money and (left|ran)|revenge|personal (enmity|fight|dispute|matter)|mera ex|meri ex|udhaa?r (nahi|nhi) (lauta|diya))/i;
const PERSONAL_HI = ["बदला लेना", "उधार नहीं लौटा", "मेरा एक्स", "मेरी एक्स", "निजी दुश्मनी"];
export function isPersonalDispute(note: string | null | undefined): boolean {
  const t = (note ?? "").normalize("NFKC");
  return PERSONAL.test(t) || PERSONAL_HI.some((w) => t.includes(w));
}
