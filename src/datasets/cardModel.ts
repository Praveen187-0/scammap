// Card-fraud model for the public ULB / Worldline credit card dataset (creditcard.csv: Time, V1..V28, Amount, Class).
// Logistic regression with Adam, class weighting and L2, trained on the EARLIEST transactions and tested on the
// LATEST ones (a time-ordered split, like a real deployment), with the alert threshold tuned on a validation slice.
// Pure TypeScript, no native dependencies, trains in a few seconds.

export const V_COUNT = 28;
export const FEATURES = V_COUNT + 3; // V1..V28, log(1 + amount), sin/cos of the time of day

export interface CardData {
  n: number;
  time: Int32Array; // seconds since the first transaction
  v: Float32Array; // n x 28
  amount: Float64Array;
  fraud: Uint8Array;
}

export interface CardModel {
  mean: number[];
  std: number[];
  w: number[];
  b: number;
  threshold: number;
}

export interface CardMetrics {
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  average_precision: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  fraud_amount_total: number;
  fraud_amount_caught: number;
}

export function rawFeatures(d: CardData, i: number, out: Float64Array): void {
  for (let j = 0; j < V_COUNT; j++) out[j] = d.v[i * V_COUNT + j]!;
  out[V_COUNT] = Math.log1p(Math.max(0, d.amount[i]!));
  const day = ((d.time[i]! % 86400) / 86400) * 2 * Math.PI;
  out[V_COUNT + 1] = Math.sin(day);
  out[V_COUNT + 2] = Math.cos(day);
}

export function splitPoints(n: number): { trainEnd: number; validEnd: number } {
  return { trainEnd: Math.floor(n * 0.6), validEnd: Math.floor(n * 0.75) };
}

function standardiser(d: CardData, end: number): { mean: number[]; std: number[] } {
  const x = new Float64Array(FEATURES);
  const sum = new Float64Array(FEATURES);
  const sq = new Float64Array(FEATURES);
  for (let i = 0; i < end; i++) {
    rawFeatures(d, i, x);
    for (let j = 0; j < FEATURES; j++) {
      sum[j]! += x[j]!;
      sq[j]! += x[j]! * x[j]!;
    }
  }
  const mean = Array.from(sum, (s) => s / end);
  const std = Array.from(sq, (s, j) => Math.sqrt(Math.max(1e-9, s / end - mean[j]! * mean[j]!)));
  return { mean, std };
}

export function scoreRow(m: CardModel, d: CardData, i: number, buf = new Float64Array(FEATURES)): number {
  rawFeatures(d, i, buf);
  let z = m.b;
  for (let j = 0; j < FEATURES; j++) z += m.w[j]! * ((buf[j]! - m.mean[j]!) / m.std[j]!);
  return 1 / (1 + Math.exp(-z));
}

export function trainCardModel(d: CardData, opts: { epochs?: number; lr?: number; l2?: number; seed?: number } = {}): CardModel {
  const { trainEnd } = splitPoints(d.n);
  const { mean, std } = standardiser(d, trainEnd);
  const X = new Float32Array(trainEnd * FEATURES);
  const buf = new Float64Array(FEATURES);
  let pos = 0;
  for (let i = 0; i < trainEnd; i++) {
    rawFeatures(d, i, buf);
    for (let j = 0; j < FEATURES; j++) X[i * FEATURES + j] = (buf[j]! - mean[j]!) / std[j]!;
    pos += d.fraud[i]!;
  }
  // Frauds are ~0.17% of rows: weight them by sqrt(neg/pos), a middle ground between ignoring and over-fitting them.
  const posWeight = pos ? Math.sqrt((trainEnd - pos) / pos) : 1;
  // At least ~2,000 optimiser steps, so small files are not under-trained.
  const epochs = opts.epochs ?? Math.max(8, Math.ceil(2000 / Math.ceil(trainEnd / 1024)));
  const lr = opts.lr ?? 0.01;
  const l2 = opts.l2 ?? 1e-4;
  const w = new Float64Array(FEATURES);
  let b = Math.log(Math.max(pos, 1) / Math.max(trainEnd - pos, 1));
  const mW = new Float64Array(FEATURES), vW = new Float64Array(FEATURES);
  let mB = 0, vB = 0, t = 0;
  const b1 = 0.9, b2 = 0.999, eps = 1e-8, batch = 1024;
  const order = Uint32Array.from({ length: trainEnd }, (_, i) => i);
  let s = opts.seed ?? 42;
  const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gW = new Float64Array(FEATURES);
  for (let e = 0; e < epochs; e++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    for (let start = 0; start < trainEnd; start += batch) {
      gW.fill(0);
      let gB = 0, wsum = 0;
      const end = Math.min(trainEnd, start + batch);
      for (let k = start; k < end; k++) {
        const i = order[k]!;
        const off = i * FEATURES;
        let z = b;
        for (let j = 0; j < FEATURES; j++) z += w[j]! * X[off + j]!;
        const p = 1 / (1 + Math.exp(-z));
        const y = d.fraud[i]!;
        const sw = y ? posWeight : 1;
        const g = (p - y) * sw;
        for (let j = 0; j < FEATURES; j++) gW[j]! += g * X[off + j]!;
        gB += g;
        wsum += sw;
      }
      t++;
      for (let j = 0; j < FEATURES; j++) {
        const g = gW[j]! / wsum + l2 * w[j]!;
        mW[j] = b1 * mW[j]! + (1 - b1) * g;
        vW[j] = b2 * vW[j]! + (1 - b2) * g * g;
        w[j]! -= (lr * (mW[j]! / (1 - b1 ** t))) / (Math.sqrt(vW[j]! / (1 - b2 ** t)) + eps);
      }
      const g = gB / wsum;
      mB = b1 * mB + (1 - b1) * g;
      vB = b2 * vB + (1 - b2) * g * g;
      b -= (lr * (mB / (1 - b1 ** t))) / (Math.sqrt(vB / (1 - b2 ** t)) + eps);
    }
  }
  return { mean, std, w: Array.from(w), b, threshold: 0.5 };
}

function sumOf(a: ArrayLike<number>): number {
  let t = 0;
  for (let i = 0; i < a.length; i++) t += a[i]!;
  return t;
}

/** Average precision (area under the precision-recall curve), the honest metric for rare fraud. */
export function averagePrecision(scores: ArrayLike<number>, y: ArrayLike<number>): number {
  const idx = Array.from({ length: scores.length }, (_, i) => i).sort((a, b) => scores[b]! - scores[a]!);
  const totalPos = sumOf(y);
  if (!totalPos) return 0;
  let tp = 0, ap = 0;
  idx.forEach((i, rank) => {
    if (y[i]) {
      tp++;
      ap += tp / (rank + 1);
    }
  });
  return ap / totalPos;
}

/** Threshold with the best F1 on the given rows (used on the validation slice only). */
export function bestThreshold(scores: ArrayLike<number>, y: ArrayLike<number>): number {
  const idx = Array.from({ length: scores.length }, (_, i) => i).sort((a, b) => scores[b]! - scores[a]!);
  const totalPos = sumOf(y);
  let tp = 0, best = 0, thr = 0.5;
  idx.forEach((i, rank) => {
    if (y[i]) tp++;
    const prec = tp / (rank + 1);
    const rec = totalPos ? tp / totalPos : 0;
    const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
    if (f1 > best) {
      best = f1;
      thr = scores[i]!;
    }
  });
  return thr;
}

export function evaluate(scores: ArrayLike<number>, y: ArrayLike<number>, amounts: ArrayLike<number>, threshold: number): CardMetrics {
  let tp = 0, fp = 0, fn = 0, tn = 0, total = 0, caught = 0;
  for (let i = 0; i < scores.length; i++) {
    const pred = scores[i]! >= threshold;
    if (y[i]) {
      total += amounts[i]!;
      if (pred) {
        tp++;
        caught += amounts[i]!;
      } else fn++;
    } else if (pred) fp++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const r = (x: number, k = 3): number => Math.round(x * 10 ** k) / 10 ** k;
  return {
    threshold: r(threshold, 4), precision: r(precision), recall: r(recall), f1: r(precision + recall ? (2 * precision * recall) / (precision + recall) : 0),
    average_precision: r(averagePrecision(scores, y)), tp, fp, fn, tn, fraud_amount_total: r(total, 2), fraud_amount_caught: r(caught, 2),
  };
}

/** Train on the first 60%, tune the threshold on the next 15%, report on the last 25%. Returns every row's score. */
export function fitAndEvaluate(d: CardData): { model: CardModel; scores: Float32Array; split: Uint8Array; test: CardMetrics; valid: CardMetrics } {
  const model = trainCardModel(d);
  const scores = new Float32Array(d.n);
  const buf = new Float64Array(FEATURES);
  for (let i = 0; i < d.n; i++) scores[i] = scoreRow(model, d, i, buf);
  const { trainEnd, validEnd } = splitPoints(d.n);
  const split = new Uint8Array(d.n); // 0 train, 1 valid, 2 test
  for (let i = trainEnd; i < d.n; i++) split[i] = i < validEnd ? 1 : 2;
  const vs = scores.subarray(trainEnd, validEnd), vy = d.fraud.subarray(trainEnd, validEnd), va = d.amount.subarray(trainEnd, validEnd);
  model.threshold = bestThreshold(vs, vy);
  const valid = evaluate(vs, vy, va, model.threshold);
  const test = evaluate(scores.subarray(validEnd), d.fraud.subarray(validEnd), d.amount.subarray(validEnd), model.threshold);
  return { model, scores, split, test, valid };
}
