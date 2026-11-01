// npm run import-data                      imports every CSV in ./data (recognised by its header)
// npm run import-data -- path/a.csv b.csv   imports the given files
// npm run import-data -- --replace          drops a source's old rows before importing it again
//
// Message datasets: any CSV with a label column (label/category/v1/class) and a text column (message/text/v2),
// labels like scam/spam/ham/legit/1/0. Card dataset: the ULB creditcard.csv (Time, V1..V28, Amount, Class).
// Uses DATABASE_URL from .env. Safe to run again: messages are de-duplicated, the card table is rebuilt.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { createPool, migrate, type Pool } from "../src/db/db.js";
import { fitAndEvaluate, V_COUNT, type CardData } from "../src/datasets/cardModel.js";
import { citationFor, detectKind, loadCards, loadMessages } from "../src/datasets/load.js";
import { crossValidate } from "../src/datasets/textModel.js";
import { readEnv } from "../src/env.js";
import { loadDotEnv } from "../src/lib/dotenv.js";

const args = process.argv.slice(2);
const replace = args.includes("--replace");

async function files(): Promise<string[]> {
  const given = args.filter((a) => !a.startsWith("--"));
  if (given.length) return given.map((f) => path.resolve(f));
  const dir = path.resolve("data");
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".csv")).sort().map((f) => path.join(dir, f));
}

async function importMessages(pool: Pool, file: string): Promise<void> {
  const { source, citation } = citationFor(file, "messages");
  const { docs, skipped } = await loadMessages(file);
  if (replace) await pool.query("DELETE FROM dataset_messages WHERE source = $1", [source]);
  let added = 0;
  for (let i = 0; i < docs.length; i += 1000) {
    const part = docs.slice(i, i + 1000);
    const r = await pool.query(
      `INSERT INTO dataset_messages (source, label, message, lang, category)
       SELECT $1, l, m, g, c FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS t(l, m, g, c)
       ON CONFLICT (source, message) DO NOTHING`,
      [source, part.map((d) => d.label), part.map((d) => d.text), part.map((d) => d.lang ?? "en"), part.map((d) => d.category ?? "other")],
    );
    added += r.rowCount ?? 0;
  }
  const total = (await pool.query<{ c: number }>("SELECT count(*)::int AS c FROM dataset_messages WHERE source = $1", [source])).rows[0]?.c ?? 0;
  await pool.query(
    `INSERT INTO dataset_sources (source, kind, file_name, rows, citation) VALUES ($1, 'messages', $2, $3, $4)
     ON CONFLICT (source) DO UPDATE SET file_name = EXCLUDED.file_name, rows = EXCLUDED.rows, citation = EXCLUDED.citation, imported_at = now()`,
    [source, path.basename(file), total, citation],
  );
  const all = (await pool.query<{ message: string; label: "scam" | "ham" }>("SELECT message, label FROM dataset_messages")).rows.map((r) => ({ text: r.message, label: r.label }));
  const cv = crossValidate(all);
  await pool.query(
    `INSERT INTO dataset_models (name, params, metrics) VALUES ('text_nb', $1, $2)
     ON CONFLICT (name) DO UPDATE SET trained_at = now(), params = EXCLUDED.params, metrics = EXCLUDED.metrics`,
    [JSON.stringify({ kind: "multinomial naive bayes, char 3-4-grams + words", alpha: 0.3 }), JSON.stringify(cv)],
  );
  const scam = docs.filter((d) => d.label === "scam").length;
  console.log(`  ${path.basename(file)} -> ${source}: ${docs.length} messages (${scam} scam, ${docs.length - scam} ham), ${added} new, ${skipped} skipped`);
  console.log(`  text model, 5-fold cross-validation on all ${cv.n} unique messages: accuracy ${pct(cv.accuracy)}, precision ${pct(cv.precision)}, recall ${pct(cv.recall)}`);
}

async function importCards(pool: Pool, file: string): Promise<void> {
  const { source, citation } = citationFor(file, "cards");
  const t0 = Date.now();
  const d: CardData = await loadCards(file, (n) => process.stdout.write(`\r  reading ${path.basename(file)}: ${n.toLocaleString("en-IN")} rows`));
  process.stdout.write(`\r  read ${d.n.toLocaleString("en-IN")} transactions in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
  const fit = fitAndEvaluate(d);
  const t = fit.test;
  console.log(`  model on the latest 25% (never seen in training): precision ${pct(t.precision)}, recall ${pct(t.recall)}, average precision ${pct(t.average_precision)}`);
  console.log(`  caught ${t.tp} of ${t.tp + t.fn} frauds with ${t.fp} false alarms among ${(t.tp + t.fp + t.fn + t.tn).toLocaleString("en-IN")} transactions`);

  await pool.query("TRUNCATE card_transactions");
  const SPLIT = ["train", "valid", "test"];
  const batch = 4000;
  for (let i = 0; i < d.n; i += batch) {
    const end = Math.min(d.n, i + batch);
    const ids: number[] = [], times: number[] = [], amounts: string[] = [], vs: string[] = [], fraud: boolean[] = [], split: string[] = [], scores: number[] = [];
    for (let k = i; k < end; k++) {
      ids.push(k + 1);
      times.push(d.time[k]!);
      amounts.push(d.amount[k]!.toFixed(2));
      const row: string[] = [];
      for (let j = 0; j < V_COUNT; j++) row.push(Number(d.v[k * V_COUNT + j]!.toPrecision(7)).toString());
      vs.push(`{${row.join(",")}}`);
      fraud.push(d.fraud[k] === 1);
      split.push(SPLIT[fit.split[k]!]!);
      scores.push(Number(fit.scores[k]!.toPrecision(6)));
    }
    await pool.query(
      `INSERT INTO card_transactions (id, time_s, amount, v, is_fraud, split, score)
       SELECT a, b, c, d::real[], e, f, g FROM unnest($1::int[], $2::int[], $3::numeric[], $4::text[], $5::bool[], $6::text[], $7::real[]) AS t(a, b, c, d, e, f, g)`,
      [ids, times, amounts, vs, fraud, split, scores],
    );
    process.stdout.write(`\r  saving to PostgreSQL: ${end.toLocaleString("en-IN")} / ${d.n.toLocaleString("en-IN")}`);
  }
  process.stdout.write("\n");
  await pool.query(
    `INSERT INTO dataset_models (name, params, metrics) VALUES ('card_lr', $1, $2)
     ON CONFLICT (name) DO UPDATE SET trained_at = now(), params = EXCLUDED.params, metrics = EXCLUDED.metrics`,
    [JSON.stringify({ kind: "logistic regression (Adam, class-weighted, L2)", ...fit.model }), JSON.stringify({ test: fit.test, valid: fit.valid, split: "first 60% train, next 15% threshold tuning, last 25% test (time order)" })],
  );
  await pool.query(
    `INSERT INTO dataset_sources (source, kind, file_name, rows, citation) VALUES ($1, 'cards', $2, $3, $4)
     ON CONFLICT (source) DO UPDATE SET file_name = EXCLUDED.file_name, rows = EXCLUDED.rows, citation = EXCLUDED.citation, imported_at = now()`,
    [source, path.basename(file), d.n, citation],
  );
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  loadDotEnv();
  const env = readEnv();
  const list = await files();
  if (!list.length) {
    console.log("No CSV files found. Put them in the data/ folder (for example data/creditcard.csv) or pass their paths.");
    return;
  }
  const pool = createPool(env.databaseUrl, env.dbSsl);
  await migrate(pool);
  try {
    for (const f of list) {
      if (!existsSync(f)) {
        console.log(`! ${f}: file not found`);
        continue;
      }
      const meta = await detectKind(f);
      console.log(`${path.basename(f)}: ${meta.kind === "unknown" ? "not recognised (needs label,message columns or the creditcard.csv layout), skipped" : meta.kind}`);
      if (meta.kind === "messages") await importMessages(pool, f);
      if (meta.kind === "cards") await importCards(pool, f);
    }
    console.log("Imported. A running server picks the new data up within a minute (no restart needed).");
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
