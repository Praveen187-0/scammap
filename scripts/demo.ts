// npm run demo -- clock   [--base URL]    time-travel defence (moves the server clock back and forward again)
// npm run demo -- watch   [--base URL]    prints the lock state every 2 s while YOU change the Windows clock
// npm run demo -- spoof   [--base URL]    one host cycling fake ip_prefix blocks, then real people cross-verify
// npm run demo -- hindi   [--base URL]    blank scam types + Hindi / Hinglish notes, read by the local AI
// npm run demo -- all     [--base URL]    spoof, hindi, then clock
//
// MANUAL ONLY: narrated demos for judges. Uses made-up numbers and notes. Never run against the judged server.
import { AREA_BY_PIN } from "../shared/areas.js";
import { loadDotEnv } from "../src/lib/dotenv.js";
import { formatIst } from "../src/lib/time.js";

loadDotEnv();
const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const BASE = (arg("base") ?? process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/+$/, "");
const MODE = process.argv.slice(2).find((a) => !a.startsWith("--") && a !== arg("base")) ?? "all";
const MIN = 60_000;
const int = (a: number, b: number): number => a + Math.floor(Math.random() * (b - a + 1));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const C = { b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", x: "\x1b[0m" };
const say = (s: string): void => console.log(s);
const step = (s: string): void => console.log(`\n${C.b}${C.c}▶ ${s}${C.x}`);

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
const mobile = (): string => `+91 9${int(1000, 9999)}${String(int(0, 99999)).padStart(5, "0")}`;
const area = AREA_BY_PIN.get("560102")!;
function report(over: Record<string, unknown>): Record<string, unknown> {
  const now = Date.now();
  return {
    report_id: `demo-${now}-${int(1, 1e9)}`, occurred_at: formatIst(now - 5 * MIN), reported_at: formatIst(now),
    reporter_id: `demo-r-${int(1, 1e9)}`, ip_prefix: `${int(11, 223)}.${int(0, 255)}.${int(0, 255)}`, channel: "Phone call",
    scam_type: "digital-arrest", identifier_type: "phone", identifier_value: mobile(), pincode: area.pincode, locality: area.locality, city: area.city, note: "",
    ...over,
  };
}
async function ensureLicence(): Promise<boolean> {
  const l = await call("GET", "/license");
  if (l.json.status === "VALID") return true;
  say(`${C.r}Licence status is ${String(l.json.status)}.${C.x} Upload one first:  npm run sign-licence -- --licensee "Demo Bank" --days 30 --upload ${BASE}`);
  return false;
}
function lookupLine(j: Record<string, unknown>): string {
  const ex = j.explain as { flags?: string[]; why?: string } | string | undefined;
  const why = !ex ? "" : typeof ex === "string" ? ex : `${ex.why ?? ""}${ex.flags?.length ? ` [${ex.flags.join(", ")}]` : ""}`;
  return `verdict ${C.b}${String(j.verdict)}${C.x}, reports ${String(j.report_count)}, independent people ${C.b}${String(j.distinct_reporters)}${C.x}${why ? `\n     ${C.d}why: ${why}${C.x}` : ""}`;
}

// ------------------------------------------------------------------ 3. anti-spoofing
async function spoof(): Promise<void> {
  step("Anti-spoofing: ONE machine cycles through fake ip_prefix values to look like 10 different people");
  const num = mobile();
  const block = `${int(11, 99)}.${int(0, 255)}`;
  const notes = [
    "Caller said he is from Mumbai police, parcel in my name has drugs",
    "Video call from fake CBI officer, said I am under digital arrest",
    "Bola aapka Aadhaar illegal kaam me use hua, turant paisa bhejo",
    "उसने कहा पुलिस से हूँ, आपके नाम पर ड्रग्स का पार्सल मिला है",
    "Fake officer kept me on Skype and asked for a security deposit",
    "Threatened arrest unless I paid, showed a fake ID on WhatsApp",
    "They said a case is registered on my SIM, stay on video call",
    "Customs officer said FedEx parcel has MDMA, police will come",
    "He knew my PAN number and said ED officers are coming home",
    "Kept us on WhatsApp call for 3 hours saying do not tell anyone",
  ];
  const t0 = Date.now() - 12 * MIN;
  for (let i = 0; i < 10; i++) {
    const at = t0 + i * 50_000;
    const prefix = `${block}.${int(0, 255)}`;
    const r = await call("POST", "/reports", report({ identifier_value: num, ip_prefix: prefix, reporter_id: `cycle-${Date.now()}-${i}`, occurred_at: formatIst(at - 2 * MIN), reported_at: formatIst(at), note: notes[i] }));
    say(`   POST /reports  account #${String(i + 1).padStart(2)}  ip_prefix ${prefix.padEnd(15)} -> ${r.status}`);
  }
  const l1 = await call("GET", `/lookup?type=phone&value=${encodeURIComponent(num)}`);
  say(`\n   GET /lookup ${num}\n   -> ${lookupLine(l1.json)}`);
  say(`   ${C.g}10 accounts, 10 different /24 prefixes, but all inside ${block}.x.x within minutes: counted as ONE person.${C.x}`);
  say(`   ${C.g}One person never labels a number, so the public still sees "${String(l1.json.verdict)}".${C.x}`);

  step("Cross-verification: three unrelated people on other networks report the same number, hours apart");
  const real = [
    ["49.36.18", "My mother got a WhatsApp video call from someone in police uniform asking for a fine", 5 * 60],
    ["106.193.77", "वीडियो कॉल पर नकली अफसर ने गिरफ्तारी की धमकी दी और 50 हज़ार माँगे", 3 * 60],
    ["223.187.140", "Said my courier had MDMA and I must transfer money to clear my name", 90],
  ] as const;
  for (const [prefix, note, minsAgo] of real) {
    const at = Date.now() - minsAgo * MIN;
    const r = await call("POST", "/reports", report({ identifier_value: num, ip_prefix: prefix, occurred_at: formatIst(at - 10 * MIN), reported_at: formatIst(at), note, has_screenshot: true }));
    say(`   POST /reports  real person on ${prefix.padEnd(12)} (${Math.round(minsAgo / 60)} h ago) -> ${r.status}`);
  }
  const l2 = await call("GET", `/lookup?type=phone&value=${encodeURIComponent(num)}`);
  say(`\n   GET /lookup ${num}\n   -> ${lookupLine(l2.json)}`);
  say(`   ${C.g}The ring is still one vote; three unrelated people plus that one = ${String(l2.json.distinct_reporters)} people.${C.x}`);
  say(`   In the app: Check -> paste ${num} -> "See how the reports were counted" shows the grey "one network block" bubble.`);
}

// ------------------------------------------------------------------ 2. local AI notes
async function hindi(): Promise<void> {
  step("Local AI: reports arrive with the scam type BLANK and a note in Hindi or Hinglish");
  const s = await call("GET", "/safety");
  const ai = (s.json.local_ai ?? {}) as Record<string, unknown>;
  if (ai.ready) say(`   Local model ready: ${C.b}${String(ai.model)}${C.x} at ${String(ai.url)} (on this computer, notes never leave it)`);
  else say(`   ${C.y}Local AI not ready: ${String(ai.reason ?? "off")}.${C.x} Keyword rules still fill the type; start Ollama to see the translation.`);
  const notes = [
    "Mujhe ek call aaya, bola main CBI se hoon, aapke naam pe parcel me drugs mile hain, video call pe raho warna giraftar karenge",
    "बिजली विभाग से मैसेज आया कि आज रात 9 बजे कनेक्शन कट जाएगा, इस नंबर पर तुरंत बात करो",
    // The keyword rules get this one wrong ("video call pe" looks like digital arrest); the local model corrects it.
    "Ek anjaan ladki ne raat ko video call pe baat ki, ab bol rahi hai paise do warna recording sab rishtedaron ko bhej dungi",
    "एक आदमी ने खुद को बैंक का अधिकारी बताया और कहा कि मेरे कार्ड पर संदिग्ध लेन-देन हुआ है, फिर उसने मुझसे फ़ोन पर आया कोड पूछा",
  ];
  const before = Number(ai.read ?? 0);
  for (const note of notes) {
    const r = await call("POST", "/reports", report({ scam_type: "", note }));
    say(`\n   POST /reports  scam_type: ""  note: "${note.slice(0, 70)}…"  -> ${r.status} (answered at once)`);
    const reading = await call("POST", "/analyze/note", { note });
    const j = reading.json;
    const local = j.local_ai as Record<string, unknown> | undefined;
    say(`     language: ${String(j.language)}   keyword rules: ${String(j.rules ?? "none")}`);
    if (local?.available) say(`     local AI (${(Number(local.ms) / 1000).toFixed(1)} s): ${C.b}${String(local.scam_type)}${C.x} (${Math.round(Number(local.confidence) * 100)}%)  "${String(local.english)}"`);
    else say(`     local AI: ${String(local?.reason ?? "off")}`);
    say(`     ${C.g}scam type used: ${String(j.chosen)} (by ${String(j.chosen_by)})${C.x}`);
  }
  if (ai.ready) {
    say(`\n   Waiting for the background reader to re-label the stored reports…`);
    for (let i = 0; i < 90; i++) {
      const st = ((await call("GET", "/safety")).json.local_ai ?? {}) as Record<string, unknown>;
      if (Number(st.queue) === 0 && Number(st.read) >= before + notes.length * 2) break;
      await sleep(2000);
    }
    const st = ((await call("GET", "/safety")).json.local_ai ?? {}) as Record<string, unknown>;
    for (const r of ((st.recent ?? []) as Array<Record<string, unknown>>).slice(0, notes.length)) {
      say(`     stored report in ${String(r.pincode)} (${String(r.language)}): ${String(r.from)} -> ${C.b}${String(r.to)}${C.x}  ${String(r.outcome)}`);
    }
  }
  say(`\n   In the app: Live shows "Local AI read a hinglish note…"; Help -> Safety checks shows the counts and a box to try any note.`);
}

// ------------------------------------------------------------------ 1. time-travel defence
async function showLicence(label: string): Promise<void> {
  const l = (await call("GET", "/license")).json;
  const c = (l.clock ?? {}) as Record<string, unknown>;
  say(`   ${label}: licence ${C.b}${String(l.status)}${C.x}, server clock ${String(l.server_time).slice(0, 19)}, latest time seen ${String(c.high_water_mark ?? "").slice(0, 19)}, behind ${String(c.behind_seconds ?? 0)} s`);
}
async function clock(): Promise<void> {
  step("Time-travel defence: someone sets the server clock back to dodge licence expiry");
  await showLicence("now");
  const tt = await call("GET", "/demo/time-travel");
  if (tt.status !== 200) {
    say(`   ${C.y}DEMO_TIME_TRAVEL is not on, so this script can't move the clock.${C.x} Two options:`);
    say("   a) put DEMO_TIME_TRAVEL=true in .env and restart the server, then run this again, or");
    say("   b) change the real Windows clock while running:  npm run demo -- watch");
    return;
  }
  const lk = await call("GET", "/lookup?type=phone&value=1930");
  say(`   GET /lookup?type=phone&value=1930 -> ${lk.status}`);
  say(`\n   Moving the server clock back by 1 day (like changing the Windows date)…`);
  await call("POST", "/demo/time-travel", { seconds_back: 86_400 });
  const locked = await call("GET", "/lookup?type=phone&value=1930");
  say(`   GET /lookup -> ${C.r}${locked.status}${C.x}`);
  say(`   ${JSON.stringify(locked.json, null, 2).split("\n").join("\n   ")}`);
  const rep = await call("POST", "/reports", report({}));
  say(`   POST /reports -> ${C.r}${rep.status}${C.x} (writes are locked too)`);
  await showLicence("locked");
  say(`\n   Putting the clock right again…`);
  await call("POST", "/demo/time-travel", { seconds_back: 0 });
  const ok = await call("GET", "/lookup?type=phone&value=1930");
  say(`   GET /lookup -> ${C.g}${ok.status}${C.x}  (unlocked by itself, no restart, all data intact)`);
  await showLicence("after");
}
async function watch(): Promise<void> {
  step("Watching the lock. Now change the Windows date (Settings > Time & language > Date & time). Ctrl+C to stop.");
  let last = "";
  for (;;) {
    const l = await call("GET", "/license").catch(() => null);
    const lk = await call("GET", "/lookup?type=phone&value=1930").catch(() => null);
    const line = `${String(l?.json.status)} | lookup ${String(lk?.status)} | ${String((lk?.json as Record<string, unknown> | undefined)?.code ?? "")}`;
    if (line !== last) {
      say(`   ${new Date().toLocaleTimeString("en-IN")}  ${line.includes("ROLLBACK") ? C.r : C.g}${line}${C.x}`);
      last = line;
    }
    await sleep(2000);
  }
}

async function main(): Promise<void> {
  say(`${C.d}ScamMap demo against ${BASE}${C.x}`);
  const h = await call("GET", "/health").catch(() => null);
  if (!h || h.status !== 200) throw new Error(`No server at ${BASE}. Start it with npm start (or npm run dev).`);
  if (MODE === "watch") return watch();
  if (MODE === "clock") return clock();
  if (!(await ensureLicence())) return;
  if (MODE === "spoof") return spoof();
  if (MODE === "hindi") return hindi();
  await spoof();
  await hindi();
  await clock();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
