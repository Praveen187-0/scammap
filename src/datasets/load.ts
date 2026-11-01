// Reads dataset files from disk. Recognises two shapes by their header:
//   messages:  a label column (label/category/v1/class/type) and a text column (message/text/sms/v2/content)
//   cards:     the ULB credit card file (Time, V1..V28, Amount, Class)
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { V_COUNT, type CardData } from "./cardModel.js";
import { readCsv, readHeader } from "./csv.js";
import { categorize, detectLang, parseLabel, type LabelledText } from "./textModel.js";

const LABEL_COLS = ["label", "category", "v1", "class", "type", "is_scam", "is_spam", "target"];
const TEXT_COLS = ["message", "text", "sms", "v2", "content", "body", "msg", "message_text"];

export type DatasetKind = "messages" | "cards" | "unknown";

export function kindOfHeader(header: readonly string[]): { kind: DatasetKind; label?: number; text?: number } {
  const h = header.map((x) => x.trim().replace(/^"|"$/g, "").toLowerCase());
  if (h.includes("v1") && h.includes("v28") && h.includes("amount") && h.includes("class")) return { kind: "cards" };
  const label = h.findIndex((x) => LABEL_COLS.includes(x));
  const text = h.findIndex((x) => TEXT_COLS.includes(x));
  if (label >= 0 && text >= 0 && label !== text) return { kind: "messages", label, text };
  return { kind: "unknown" };
}

export async function detectKind(file: string): Promise<ReturnType<typeof kindOfHeader>> {
  return kindOfHeader(await readHeader(file));
}

/** Known public datasets get a proper citation; anything else is credited by file name. */
export function citationFor(file: string, kind: DatasetKind): { source: string; citation: string } {
  const name = basename(file).toLowerCase();
  if (kind === "cards") {
    return {
      source: "ulb-creditcard",
      citation: "Credit Card Fraud Detection (Sept 2013, European cardholders), Worldline and ULB Machine Learning Group; Dal Pozzolo et al. Kaggle: mlg-ulb/creditcardfraud.",
    };
  }
  if (name.includes("financial_scam") || name.includes("financial-scam")) {
    return {
      source: "financial-scams-bd",
      citation: "Al Rafi Ahmed, Gazi Faizul Islam (2025). Financial scams detection dataset (English and Bangla). Mendeley Data. doi:10.17632/znsk27yk3h.1",
    };
  }
  if (name === "spam.csv" || name.includes("smsspam")) {
    return { source: "uci-sms-spam", citation: "Almeida, Hidalgo. SMS Spam Collection. UCI Machine Learning Repository." };
  }
  return { source: name.replace(/\.csv$/, "").replace(/[^a-z0-9_-]+/g, "-").slice(0, 40) || "custom", citation: `Imported from ${basename(file)}` };
}

export async function loadMessages(file: string): Promise<{ docs: LabelledText[]; skipped: number }> {
  const meta = await detectKind(file);
  if (meta.kind !== "messages" || meta.label === undefined || meta.text === undefined) throw new Error(`${basename(file)} is not a label,message CSV`);
  const docs: LabelledText[] = [];
  let skipped = 0;
  let first = true;
  const seen = new Set<string>();
  for await (const row of readCsv(file)) {
    if (first) {
      first = false;
      continue;
    }
    const label = parseLabel(row[meta.label] ?? "");
    const text = (row[meta.text] ?? "").replace(/\s+/g, " ").trim();
    if (!label || text.length < 3 || text.length > 2000) {
      skipped++;
      continue;
    }
    const key = `${label}|${text}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    docs.push({ text, label, lang: detectLang(text), category: categorize(text) });
  }
  return { docs, skipped };
}

/** Fast path for the 150 MB card file: plain numbers, so a line split is enough. */
export async function loadCards(file: string, onProgress?: (rows: number) => void): Promise<CardData> {
  let cap = 1 << 19;
  let time = new Int32Array(cap), v = new Float32Array(cap * V_COUNT), amount = new Float64Array(cap), fraud = new Uint8Array(cap);
  let n = 0;
  let header = true;
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (header) {
      header = false;
      if (!/v1/i.test(line)) throw new Error("creditcard.csv: unexpected header");
      continue;
    }
    if (!line) continue;
    const p = line.split(",");
    if (p.length < V_COUNT + 3) continue;
    if (n === cap) {
      cap *= 2;
      const t2 = new Int32Array(cap); t2.set(time); time = t2;
      const v2 = new Float32Array(cap * V_COUNT); v2.set(v); v = v2;
      const a2 = new Float64Array(cap); a2.set(amount); amount = a2;
      const f2 = new Uint8Array(cap); f2.set(fraud); fraud = f2;
    }
    time[n] = Math.round(Number(p[0]));
    for (let j = 0; j < V_COUNT; j++) v[n * V_COUNT + j] = Number(p[1 + j]);
    amount[n] = Number(p[V_COUNT + 1]);
    fraud[n] = p[V_COUNT + 2]!.replace(/"/g, "").trim() === "1" ? 1 : 0;
    n++;
    if (onProgress && n % 50_000 === 0) onProgress(n);
  }
  return { n, time: time.subarray(0, n), v: v.subarray(0, n * V_COUNT), amount: amount.subarray(0, n), fraud: fraud.subarray(0, n) };
}
