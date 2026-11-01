// npm run sign-licence -- --licensee "Demo Bank" --minutes 5 [--out licence-5min.json] [--upload https://your-server]
// npm run sign-licence -- --licensee "Demo Bank" --days 30
// npm run sign-licence -- --licensee "Demo Bank" --expires 2026-11-15T10:05:00+05:30
// Signs with keys/private.pem (on your laptop only) and prints the licence JSON.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { signLicence } from "../src/licence/licence.js";
import { formatIst, parseIsoTime } from "../src/lib/time.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const licensee = arg("licensee") ?? "Demo Bank";
const minutes = arg("minutes");
const days = arg("days");
const seconds = arg("seconds");
const expires = arg("expires");

let expiresMs: number;
if (expires) {
  const p = parseIsoTime(expires);
  if (p === null) throw new Error(`--expires is not a valid ISO time: ${expires}`);
  expiresMs = p;
} else if (seconds) expiresMs = Date.now() + Number(seconds) * 1000;
else if (minutes) expiresMs = Date.now() + Number(minutes) * 60_000;
else expiresMs = Date.now() + Number(days ?? 30) * 86_400_000;

const keyPath = arg("key") ?? path.join(process.cwd(), "keys/private.pem");
let pem: string;
try {
  pem = readFileSync(keyPath, "utf8");
} catch {
  console.error(`Cannot read ${keyPath}. Run \`npm run gen-keys\` first.`);
  process.exit(1);
}

const licence = signLicence({ licensee, expires_at: formatIst(expiresMs), issued_at: formatIst(Date.now()) }, pem);
const json = JSON.stringify(licence, null, 2);
const out = arg("out");
if (out) {
  writeFileSync(out, `${json}\n`);
  console.error(`Wrote ${out} (expires ${licence.expires_at})`);
}
console.log(json);

const upload = arg("upload");
if (upload) {
  const res = await fetch(`${upload.replace(/\/+$/, "")}/license`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(licence),
  });
  console.error(`POST ${upload}/license -> ${res.status} ${await res.text()}`);
  if (!res.ok) process.exit(1);
}
