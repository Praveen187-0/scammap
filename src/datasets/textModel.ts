// A small, explainable text model trained on public labelled message datasets (scam vs ham).
// Multinomial Naive Bayes over character 3-4-grams plus whole words: it works across English, Hindi and Bangla
// without any tokenizer or download. A TF-IDF similarity index finds the closest labelled examples, so every
// answer can be shown with evidence ("this reads like these known scam messages").

export type Label = "scam" | "ham";
export interface LabelledText {
  id?: number;
  text: string;
  label: Label;
  source?: string;
  lang?: string;
  category?: string;
}

const DIGITS = /[0-9०-९০-৯]/g;

export function normalizeText(t: string): string {
  return t
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/g, " weblink ")
    .replace(/\b\S+\.(com|net|org|xyz|top|bd|in|info|club)\b\S*/g, " weblink ")
    .replace(DIGITS, "0")
    .replace(/0{3,}/g, "000")
    .replace(/[^\p{L}\p{M}0\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function features(text: string): string[] {
  const n = normalizeText(text);
  const out: string[] = [];
  for (const w of n.split(" ")) if (w.length >= 2) out.push(`w:${w}`);
  const padded = ` ${n} `;
  for (let k = 3; k <= 4; k++) for (let i = 0; i + k <= padded.length; i++) out.push(padded.slice(i, i + k));
  return out;
}

export function detectLang(text: string): "bn" | "hi" | "en" | "mixed" {
  const bn = (text.match(/[ঀ-৿]/g) ?? []).length;
  const hi = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  const la = (text.match(/[a-z]/gi) ?? []).length;
  const total = bn + hi + la || 1;
  if (bn / total > 0.6) return "bn";
  if (hi / total > 0.6) return "hi";
  if (la / total > 0.8) return "en";
  return "mixed";
}

// Category tags for the dataset analytics (English, Bangla, Hindi and Hinglish keywords).
const CATEGORIES: Array<[string, RegExp]> = [
  ["otp", /\botp\b|\bpin\b|password|passcode|verification code|ওটিপি|পিন|পাসওয়ার্ড|ओटीपी|पासवर्ड/i],
  ["loan", /\bloan\b|\bcredit (limit|score)|payday|লোন|ঋণ|लोन|ऋण/i],
  ["prize", /\bwon\b|winner|lottery|prize|reward|gift|giveaway|cashback|voucher|bonus|লটারি|জিত|পুরস্কার|ক্যাশব্যাক|ভাউচার|लॉटरी|इनाम|जीत/i],
  ["job", /\bjob\b|salary|hiring|work from home|earn .{0,20}(daily|per day)|shopper|চাকরি|উপার্জন|नौकरी|कमाएं/i],
  ["investment", /invest|crypto|trading|returns?\b|profit|double your|বিনিয়োগ|লাভ|निवेश|मुनाफ़ा|मुनाफा/i],
  ["account", /account|bank|card|login|log in|suspend|blocked|locked|verify|kyc|একাউন্ট|অ্যাকাউন্ট|ব্যাংক|কার্ড|খাता|खाता|बैंक|कार्ड/i],
  ["bill", /\bbill\b|payment|subscription|recharge|\bfee\b|\bfine\b|tax|বিল|পেমেন্ট|রিচার্জ|बिल|भुगतान|रिचार्ज/i],
  ["delivery", /parcel|package|delivery|shipped|order|courier|ডেলিভারি|পার্সেল|डिलीवरी|पार्सल/i],
];
export function categorize(text: string): string {
  for (const [name, re] of CATEGORIES) if (re.test(text)) return name;
  return "other";
}

/** "scam" / "spam" / "fraud" / "1" -> scam; "ham" / "legit" / "0" -> ham; anything else is skipped. */
export function parseLabel(raw: string): Label | null {
  const v = raw.trim().toLowerCase();
  if (["scam", "spam", "fraud", "phishing", "smishing", "1", "true", "yes", "malicious"].includes(v)) return "scam";
  if (["ham", "legit", "legitimate", "normal", "genuine", "0", "false", "no", "benign", "not_spam", "not spam"].includes(v)) return "ham";
  return null;
}

// ------------------------------------------------------------------------------------------ Naive Bayes

interface ClassStats {
  docs: number;
  total: number;
  counts: Map<string, number>;
}
export interface NbModel {
  scam: ClassStats;
  ham: ClassStats;
  vocab: number;
  alpha: number;
}

export function trainNb(docs: readonly LabelledText[], alpha = 0.3): NbModel {
  const mk = (): ClassStats => ({ docs: 0, total: 0, counts: new Map() });
  const m: NbModel = { scam: mk(), ham: mk(), vocab: 0, alpha };
  const vocab = new Set<string>();
  for (const d of docs) {
    const c = m[d.label];
    c.docs++;
    for (const f of features(d.text)) {
      c.counts.set(f, (c.counts.get(f) ?? 0) + 1);
      c.total++;
      vocab.add(f);
    }
  }
  m.vocab = vocab.size;
  return m;
}

function logLik(c: ClassStats, f: string, m: NbModel): number {
  return Math.log(((c.counts.get(f) ?? 0) + m.alpha) / (c.total + m.alpha * m.vocab));
}

/**
 * P(scam). Naive Bayes is famously over-confident because the n-grams overlap, so the log-odds are divided by
 * the square root of the feature count (a simple, monotonic calibration).
 */
export function scoreNb(m: NbModel, text: string): { p: number; words: string[]; coverage: number } {
  const all = features(text);
  if (!all.length || !m.scam.docs || !m.ham.docs) return { p: 0.5, words: [], coverage: 0 };
  // Features never seen in training carry no evidence (and would otherwise favour the smaller class): skip them.
  // Coverage says how much of the text the dataset actually knows; a Hindi message scored by a Bangla/English
  // model has low coverage, and callers should then give the score little weight.
  const fs = all.filter((f) => m.scam.counts.has(f) || m.ham.counts.has(f));
  const coverage = Math.round((fs.length / all.length) * 100) / 100;
  if (!fs.length) return { p: 0.5, words: [], coverage: 0 };
  let diff = Math.log(m.scam.docs / m.ham.docs);
  const wordRatio = new Map<string, number>();
  for (const f of fs) {
    const r = logLik(m.scam, f, m) - logLik(m.ham, f, m);
    diff += r;
    if (f.startsWith("w:")) wordRatio.set(f.slice(2), r);
  }
  const z = diff / Math.max(1, Math.sqrt(fs.length) / 1.5);
  const p = 1 / (1 + Math.exp(-z));
  const words = [...wordRatio.entries()].filter(([w, r]) => r > 1.2 && w.length >= 3 && !STOP.has(w) && !/^0+$/.test(w)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
  return { p: Math.round(p * 1000) / 1000, words, coverage };
}

const STOP = new Set(["weblink", "the", "are", "you", "your", "for", "and", "with", "this", "that", "our", "has", "have", "been", "was", "will", "from", "not", "all", "can", "get", "its", "it's", "now", "here", "into", "out", "under", "any", "who", "how", "what", "may"]);

/** Words most typical of scam messages, for the insights page. */
export function topScamWords(m: NbModel, minCount = 3, k = 12): string[] {
  const out: Array<[string, number]> = [];
  for (const [f, n] of m.scam.counts) {
    if (!f.startsWith("w:") || n < minCount) continue;
    const w = f.slice(2);
    if (w.length < 3 || /^0+$/.test(w) || STOP.has(w)) continue;
    out.push([w, logLik(m.scam, f, m) - logLik(m.ham, f, m)]);
  }
  return out.sort((a, b) => b[1] - a[1]).slice(0, k).map(([w]) => w);
}

// ------------------------------------------------------------------------------------------ similarity

/** Words and 3-grams, but not grams made only of digits and spaces (any two messages with numbers share those). */
const simFeature = (f: string): boolean => (f.startsWith("w:") ? !/^w:0+$/.test(f) : f.length === 3 && !/^[0 ]+$/.test(f));

interface Vec {
  keys: string[];
  vals: Float64Array;
}

/** TF-IDF cosine similarity over character 3-grams and words. Brute force: fine up to tens of thousands of messages. */
export class SimilarityIndex {
  private idf = new Map<string, number>();
  private vecs: Vec[] = [];
  constructor(private readonly docs: readonly LabelledText[]) {
    const df = new Map<string, number>();
    const tfs = docs.map((d) => {
      const tf = new Map<string, number>();
      for (const f of features(d.text)) if (simFeature(f)) tf.set(f, (tf.get(f) ?? 0) + 1);
      for (const k of tf.keys()) df.set(k, (df.get(k) ?? 0) + 1);
      return tf;
    });
    const n = docs.length;
    for (const [k, v] of df) this.idf.set(k, Math.log((n + 1) / (v + 1)) + 1);
    this.vecs = tfs.map((tf) => this.vectorOf(tf));
  }

  private vectorOf(tf: Map<string, number>): Vec {
    const keys: string[] = [];
    const vals: number[] = [];
    let norm = 0;
    for (const [k, c] of tf) {
      const idf = this.idf.get(k);
      if (idf === undefined) continue;
      const w = (1 + Math.log(c)) * idf;
      keys.push(k);
      vals.push(w);
      norm += w * w;
    }
    const s = Math.sqrt(norm) || 1;
    return { keys, vals: Float64Array.from(vals, (v) => v / s) };
  }

  nearest(text: string, k = 3, min = 0.35): Array<{ doc: LabelledText; score: number }> {
    const tf = new Map<string, number>();
    for (const f of features(text)) if (simFeature(f)) tf.set(f, (tf.get(f) ?? 0) + 1);
    const q = this.vectorOf(tf);
    if (!q.keys.length) return [];
    const qm = new Map(q.keys.map((key, i) => [key, q.vals[i]!]));
    const scored: Array<{ doc: LabelledText; score: number }> = [];
    const seen = new Set<string>();
    this.vecs.forEach((v, i) => {
      let dot = 0;
      for (let j = 0; j < v.keys.length; j++) {
        const w = qm.get(v.keys[j]!);
        if (w !== undefined) dot += w * v.vals[j]!;
      }
      if (dot >= min) scored.push({ doc: this.docs[i]!, score: dot });
    });
    return scored
      .sort((a, b) => b.score - a.score)
      .filter((s) => {
        const key = normalizeText(s.doc.text);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, k)
      .map((s) => ({ doc: s.doc, score: Math.round(s.score * 100) / 100 }));
  }
}

// ------------------------------------------------------------------------------------------ evaluation

export interface TextMetrics {
  folds: number;
  n: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

/** Stratified k-fold cross-validation on de-duplicated messages (copies would leak between folds). */
export function crossValidate(docs: readonly LabelledText[], folds = 5, seed = 7): TextMetrics {
  const uniq = new Map<string, LabelledText>();
  for (const d of docs) uniq.set(normalizeText(d.text), d);
  let s = seed;
  const rnd = (): number => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const all = [...uniq.values()].map((d) => ({ d, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.d);
  const byLabel = { scam: all.filter((d) => d.label === "scam"), ham: all.filter((d) => d.label === "ham") };
  const fold = new Map<LabelledText, number>();
  for (const list of [byLabel.scam, byLabel.ham]) list.forEach((d, i) => fold.set(d, i % folds));
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let f = 0; f < folds; f++) {
    const train = all.filter((d) => fold.get(d) !== f);
    const test = all.filter((d) => fold.get(d) === f);
    if (!test.length) continue;
    const m = trainNb(train);
    for (const d of test) {
      const pred = scoreNb(m, d.text).p >= 0.5;
      const actual = d.label === "scam";
      if (pred && actual) tp++;
      else if (pred) fp++;
      else if (actual) fn++;
      else tn++;
    }
  }
  const n = tp + fp + fn + tn;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const r3 = (x: number): number => Math.round(x * 1000) / 1000;
  return { folds, n, accuracy: r3(n ? (tp + tn) / n : 0), precision: r3(precision), recall: r3(recall), f1: r3(precision + recall ? (2 * precision * recall) / (precision + recall) : 0) };
}
