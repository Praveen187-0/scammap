# ScamMap · स्कैम मैप

People warn each other about scam phone numbers, UPI IDs, links and SMS senders, and check one before they trust it.
Reporters stay anonymous. Fake reports (report-bombing, fake accounts, spam, junk, grudges) are caught by trust rules
that **count people, not reports**, and **one report never labels anyone**. A signed licence locks the server when it
expires and unlocks it, with no restart, when renewed.

- **Server:** Node 20.19+ / 22 · TypeScript (strict) · Fastify 5 · PostgreSQL 14+ · Zod. One long-running process.
- **Web app (phone and desktop):** React + Vite PWA served by the same server at the same URL. **9 languages** (English,
  हिंदी, বাংলা, मराठी, தமிழ், తెలుగు, ಕನ್ನಡ, ગુજરાતી, മലയാളം) with read-aloud, icons on every option, no login. Works offline
  for reporting (queued on the phone), installable, ready to package as an Android app. Real map on **OpenStreetMap** (Leaflet). Analytics dashboard. Optional **Gemini** reading of
  suspicious messages and a Gemini-written weekly briefing.
- **Contract:** every endpoint in Appendix A at the root, JSON in and out, plus a few extras (below).

| Screen | What it does |
|---|---|
| **Check** | Paste a number, UPI ID, link or SMS sender → community verdict in under 0.5 s, then a **second opinion** that combines rule checks, the community database and Gemini. Paste a whole SMS, WhatsApp message or email → risk score from 25+ offline rules, every number/link inside looked up, the closest labelled messages from the imported datasets, and Gemini's reading in English and Hindi. |
| **Report** | Paste → pick what happened → send. About 15 s and 3 taps; the scam type is suggested from the text, the channel and area are pre-filled. |
| **Map** | OpenStreetMap data in five open styles (Streets, Light, Dark, Humanitarian, Terrain). One circle per area (never a person's location), sized by reports, coloured by severity, pulsing on a spike, with **SPIKE / NEW_TYPE labels on the map** and an alert strip above it. "Next 24 h" view shows the forecast. New reports ping live. |
| **Live** | Reports and attacks blocked by the trust rules as they happen (Server-Sent Events), areas heading towards an alert with "alert level in about N h at this pace", expected reports for the next 24 hours, scam types picking up, and a replay of the card-fraud model on 71,202 held-out real transactions. |
| **Alerts** | Only when something is unusual (SPIKE, NEW_TYPE). A calm "all normal" state otherwise. |
| **Insights** | Analytics, plus a **Public datasets** section (message dataset breakdown, typical scam words, card fraud by hour and amount, model accuracy): trusted vs set-aside reports per day, what the trust rules did, scam types, channels, weekday × hour heatmap, how fast people report, money lost, languages, area table with change vs the previous period, most reported numbers, junk rejected. Every chart has a table view. A written briefing on top (Gemini, or rules if no key). Filter by 7/30/90 days, city or area. |
| **Lost money** | The first-hour plan: call 1930 (with a first-hour countdown), note the details, a ready complaint text for cybercrime.gov.in and a letter to the bank (copy or download), a safety checklist. Nothing typed there leaves the phone. |
| **Campaigns** | Numbers, UPI IDs, links and SMS senders reported together are joined into **scam campaigns**, each with its **kill chain** (contact → hook → pressure → payment → cash-out), how it spread area by area, and a short story. A **scam network graph** links identifiers seen together, written alike, or hosted on the same server. |
| **Partners** | Console for banks, telecoms and police (own API key): live reports about their UPI handles, brand, SMS senders or areas, hourly rollups vs everyone's, signed webhooks, and the scale panel (load-test results). |
| **Help** | Helplines (1930, cybercrime.gov.in, Sanchar Saathi, 1909), signs of a real call (1600/1601 series, `.bank.in`, TRAI sender IDs), privacy, trust rules, dispute form, **transparency log**, **what we store (read live from the database)**, **integrations**, licence panel. |

Also new on Check: **"See how the reports were counted"** (the trust engine, animated), **"Visit the link safely"** (a
sandboxed live visit of a link, correlated with the static warning signs), **Read aloud**, and "Also listed by" for
identifiers on partner block-lists. On Report: **From a screenshot** (text read on the phone, never uploaded). On Alerts:
**push notifications** for your area. Plus a **Telegram bot**.

---

## Run it on Windows: VS Code + Git Bash + local PostgreSQL

**Install once:** [Node.js 22 LTS](https://nodejs.org) (20.19+ also works), [Git for Windows](https://git-scm.com/download/win)
(gives you Git Bash), [PostgreSQL 16 or 17](https://www.postgresql.org/download/windows/) (remember the password you
set for the `postgres` user; keep port 5432), and VS Code. In VS Code: **Terminal → New Terminal → ˅ → Git Bash**.

```bash
# 1. Unzip, open the folder in VS Code, then in the Git Bash terminal:
cd scammap
node -v                      # v22.x (or v20.19+)

# 2. Make psql available in Git Bash (adjust 17 to your PostgreSQL version), then create the database
export PATH="$PATH:/c/Program Files/PostgreSQL/17/bin"
psql -U postgres -h localhost -c "CREATE DATABASE scammap;"
#   If psql seems to hang waiting for the password in Git Bash, run it as: winpty psql -U postgres -h localhost -c "..."

# 3. Settings
cp .env.example .env
#   Open .env in VS Code and set:
#     DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/scammap
#       (if the password has @ : / # or %, URL-encode it: @ -> %40, # -> %23, : -> %3A, / -> %2F, % -> %25)
#     PEPPER=<any long random string>         node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#     GEMINI_API_KEY=<optional, from https://aistudio.google.com/apikey>

# 4. Install, make your licence key pair, build, start
npm install
npm run gen-keys             # keys/private.pem (never commit) + writes the public key into src/licence/publicKey.ts
npm run build
npm start                    # http://localhost:8080 ; tables are created automatically on first start
```

The server is now **locked** (no licence yet): every API call answers `403 LICENSE_EXPIRED`. Open a **second Git Bash
terminal** (the `+` in the terminal panel) and unlock it:

```bash
npm run sign-licence -- --licensee "Demo Bank" --days 30 --upload http://localhost:8080
npm run seed-demo -- --reset          # optional: ~1,000 synthetic reports so the map, alerts and insights have data
```

Open **http://localhost:8080**. Try the numbers `seed-demo` prints (a digital-arrest wave in HSR Layout, a bombed
bakery, a sybil attack, grudge reports…). On your phone (same Wi-Fi), open `http://<your-PC-IP>:8080`
(find it with `ipconfig`); allow Node through Windows Firewall when asked.

**Day-to-day:** `npm run dev` (server with auto-reload on :8080) and, in a second terminal, `npm run dev:client`
(app with hot reload on http://localhost:5173, API calls proxied to :8080).

**Quick look without a licence (local only):** put `LICENSE_ENFORCE=false` in `.env`. Never deploy with it.

| Problem | Fix |
|---|---|
| `psql: command not found` | the `export PATH=...PostgreSQL/<version>/bin` line above (add it to `~/.bashrc` to keep it) |
| `password authentication failed` | the password in `DATABASE_URL` is wrong or needs URL-encoding |
| `database "scammap" does not exist` | step 2 |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL service is stopped: Windows search → Services → postgresql-x64-17 → Start |
| every call returns 403 | no valid licence yet: run the `sign-licence ... --upload` command |
| `EADDRINUSE :8080` | another server is running; close that terminal or set `PORT=8081` in `.env` |
| map is grey | the browser cannot reach `tile.openstreetmap.org` (offline or blocked network); the circles still work |
| "Gemini is not set up" in the app | add `GEMINI_API_KEY` to `.env` and restart; everything else works without it |

### Add the datasets (recommended)

Both datasets go into PostgreSQL. The Financial Scams Detection CSV is already in `data/`; copy the 150 MB card file next to it, then import (about 15-60 s):

```bash
cp ~/Downloads/creditcard.csv data/
npm run import-data          # imports every CSV in data/, trains both models, prints their accuracy
```

Any other labelled SMS/email CSV with a label column (`label`, `category`, `v1`…: scam/spam/ham/1/0) and a text column
(`message`, `text`, `v2`…) can be dropped into `data/` and imported the same way, for example the UCI SMS Spam Collection.
`data/creditcard.csv` is git-ignored (GitHub rejects files over 100 MB): to fill a hosted database, run
`DATABASE_URL="<external url>" npm run import-data` from your laptop.

### All commands

| Command | What it does |
|---|---|
| `npm run check-all` | typecheck + all unit tests + build, in one go |
| `npm test` | 117 unit tests: normalisation, trust rules (incl. grudges), alert maths, licence and clock checks, dataset models, forecast, live feed, AI privacy, link-check SSRF guard and page analysis, partner matching, connectors, transparency chain, campaigns, clock guard, subnet clustering, Hindi/Hinglish note reading, threat-feed geography and defanging, US numbers and Amazon patterns, integration test sends, webhook signatures, Telegram `/chatid` |
| `npm run typecheck` | strict TypeScript for server, scripts, tests and app |
| `npm run simulate -- [--base URL] [--seed N] [--licence] [--clean]` | randomised stand-in for the judges' test tool, prints a rubric-shaped scorecard (resets the database) |
| `npm run bench-trust [runs]` | offline benchmark: how often each real and fake pattern gets the wrong verdict |
| `npm run seed-demo -- [--base URL] --reset` | **manual only**: synthetic demo data across 25 areas, 30 days, English/Hindi/Hinglish notes |
| `npm run import-data [-- files...] [--replace]` | import labelled message CSVs and `creditcard.csv` into PostgreSQL and train the models |
| `npm run live-demo -- [--minutes 10] [--fast]` | **manual only**: a slow stream of synthetic reports plus staged attacks, so the Live screen moves during a demo |
| `npm run partner -- demo` | create two demo partners (a bank and the Bengaluru police cyber cell) and print their API keys once |
| `npm run partner -- create --name N --kind bank\|telecom\|police [--upi h1,h2] [--brands b1] [--senders S1] [--prefixes 98765] [--domains d.in] [--areas 560102] [--webhook URL]` · `npm run partner -- list` | add or list partners |
| `npm run load-test -- [--seconds 20] [--concurrency 50] [--with-reports]` | load test against the running server; p50/p95/p99 per endpoint, saved and shown in the Partner console |
| `npm run translate [-- ta te] [--all] [--dry]` | fill the missing strings of the 7 extra languages with Gemini (placeholders checked) |
| `npm run demo -- spoof\|hindi\|clock\|watch\|all` | **manual only**: narrated demos of the anti-spoofing rule, the local AI note reader and the time-travel defence |
| `npm run clock [-- reset --yes]` | show (or forget) the stored clock high-water mark |
| `npm run threats` | check your URLhaus Auth-Key and preview map layer B (one request) |
| `npm run integrations [-- test [name\|all] \| secret \| serve-advisory]` | check every connector's `.env` values (sends nothing), send `[TEST]` alerts, make a webhook secret, serve the sample advisory feed |
| `npm run webhook-receiver [-- --port 9900] [--fail]` | a stand-in bank endpoint that verifies the webhook signature and prints events |
| `npm run gen-keys` | create the licence key pair (`--force` to replace) |
| `npm run sign-licence -- --licensee NAME (--minutes N \| --days N \| --seconds N \| --expires ISO) [--out FILE] [--upload URL]` | sign a licence on your laptop |

Docker alternative (any OS): `docker compose up -d db` starts Postgres with the default `.env.example` URL.

---

## Deploy (HTTPS): Render, Singapore

1. Push the repo to GitHub (see *Manual steps*: generate your key first, never commit `keys/`).
2. Render → **New → Blueprint** → pick the repo. `render.yaml` creates the web service (Docker, **Singapore**, health
   check `/health`) and a Postgres database in the same region. `PEPPER` is generated for you.
3. Set `LICENSE_JSON` to the one-line contents of a long licence (so a fresh deploy is never locked out), and
   optionally `GEMINI_API_KEY`.
4. Open `https://<your-service>.onrender.com/license`: it should say `"status":"VALID"`.

**Don't use a sleeping free instance on judging day**: a cold start takes about a minute and fails the half-second lookup
test. Use `plan: starter` (as in `render.yaml`) or keep an uptime monitor on `/health` every 5 minutes.
Any host works (Railway, Fly.io, a VM): one Docker image plus `DATABASE_URL`. For Supabase/Neon set `DB_SSL=true`.

### Environment

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `DB_SSL` | `true` for hosted Postgres that needs TLS |
| `PORT` | listen port (Render sets it) |
| `PEPPER` | secret for HMAC of reporter ids, networks and note fingerprints; **required** in production |
| `LICENSE_ENFORCE` | `true` (default). `false` disables the lock: local development only |
| `LICENSE_JSON` | optional bootstrap licence, loaded only if the database has none |
| `TRUST_BODY_IP_PREFIX` | `true` for judging (the test tool sends `ip_prefix`). `false` in a real deployment |
| `GEMINI_API_KEY` | optional; turns on Gemini for message analysis and the insights briefing |
| `GEMINI_MODEL` | default `gemini-3.5-flash-lite`; falls back to `gemini-flash-latest` if the model is not found |
| `VITE_TILE_URL` | build time, optional: another OSM tile server for heavy traffic |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID` | optional: the Telegram bot, and a group that receives every alert |
| `SLACK_WEBHOOK_URL`, `BANK_WEBHOOK_URL` + `BANK_WEBHOOK_SECRET`, `SMTP_URL` + `ALERT_EMAIL_FROM/TO`, `ADVISORY_FEED_URL` | optional: switch on the connectors in `config/connectors.yaml` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional: web push keys (generated and stored in the database when empty) |
| `LINKSCAN_ALLOW_PRIVATE` | keep `false`: the link sandbox refuses private/local addresses |
| `CLOCK_TOLERANCE_SECONDS`, `CLOCK_WITNESS_URL` | time-travel defence: allowed drift (120) and an optional HTTPS time witness |
| `DEMO_TIME_TRAVEL` | demo only (ignored in production): lets `npm run demo -- clock` move the server clock back |
| `LOCAL_AI`, `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_THREADS`, `OLLAMA_TIMEOUT_SECONDS`, `OLLAMA_ALLOW_REMOTE`, `AUTO_SCAM_TYPE` | local AI note reader (default `llama3.2:3b` at `http://127.0.0.1:11434`) |
| `SUBNET_CLUSTERING`, `SUBNET_WINDOW_MINUTES` | anti-spoofing rule B2 (on, 5 minutes) |
| `URLHAUS_AUTH_KEY`, `THREAT_FEED`, `THREAT_FEED_LIMIT`, `THREAT_FEED_MINUTES`, `THREAT_FEED_DNS` | map layer B: free abuse.ch key, on/off, URLs per fetch (200), minutes between fetches (5, minimum), place generic domains by DNS (true) |
| `VITE_MAPTILER_KEY` | build time, optional: MapTiler key. The Live map then uses MapTiler Dark, and MapTiler Streets is added to the style menu. Falls back to the keyless CARTO style if the key fails |

`.env` is read automatically by `npm start`, `npm run dev` and `seed-demo`; real environment variables win over it.

---

## Platform features

### See-through trust engine
On any number with 2+ reports, **See how the reports were counted** animates every report (a dot on a 24-hour timeline)
into the "people" it belongs to. Bursts, one network, copy-paste groups, repeat reporters and grudges end up in grey,
dashed bubbles with the reason underneath. Try the bombed bakery or the sybil number from `seed-demo`.

### Live link check (static + runtime, correlated)
**Visit the link safely** follows redirects (max 5, ports 80/443 only, 1 MB, 8 s), reads the final page without running
it, and reports what the page actually does: asks for a password, OTP, card, CVV, PIN, Aadhaar, PAN or account number;
uses a bank's name on a foreign domain; posts the form to another site; offers an `.apk`; opens UPI or chat apps. Domain
age and network come from RDAP (no WHOIS personal data). Each static warning sign that the visit **confirms** is shown as
a correlation (for example "look-alike name" + "page collects bank details" = **Proven phishing**).

### Scam campaigns, kill chain and network
Identifiers pasted in one message (the app sends the other numbers, UPI IDs and links from the same message as
`related_identifiers`) and links on the same server are joined into campaigns. Each campaign shows its kill chain, the
order it reached each area, and a short story (Gemini when set, rules otherwise; no identifiers are sent). Similar wording
is drawn in the network graph but never merges campaigns on its own.

### Partner console, rollups and load test
```bash
npm run partner -- demo             # prints two API keys: paste one into the app's Partners screen
npm run seed-demo -- --reset        # run after creating partners, so their matches fill up
npm run load-test -- --seconds 20 --concurrency 50
```
Partners watch UPI handles (`@oksbi`), brand words inside UPI IDs and links (`sbi`, `yono`), SMS senders, number prefixes,
their own domains (look-alikes are matched) and areas. Matches arrive in the console and, with `--webhook`, as POSTs
signed with `x-scammap-signature: sha256=<HMAC of the body>`. Dashboards read **hourly rollups** that are refreshed
incrementally (only the hours touched by new reports), so they stay fast at any size.

### Integrations without code
`config/connectors.yaml` sends alerts, caught attacks and reports to Telegram, Slack, any webhook or email, and reads
block-lists (CSV file or JSON URL) that show as **Also listed by**. Save the file and the server reloads it within
seconds; each connector turns on when its `.env` values are set (restart after editing `.env`). Status and a
**Send test** button per output: Help → Integrations. Step by step: [Integrations setup](#integrations-setup).

### Telegram bot
1. In Telegram, open **@BotFather** → `/newbot` → copy the token into `.env` as `TELEGRAM_BOT_TOKEN`, restart.
2. Message your bot: forward or paste any suspicious SMS to get a verdict, `/check 9876543210`, `/report` (a few taps),
   `/alerts` (pick your city and area, or `/alerts 560102`), `/stop`, `/lang` (English ↔ हिंदी). Long polling: no public
   URL needed. `/stop` deletes your chat id.

### Push alerts on the phone
Alerts → **Turn on alerts for <area>**. Needs HTTPS (or `localhost`): on a phone, use the deployed URL. VAPID keys
are generated once and kept in the database (or set `VAPID_*`). Only alerts are pushed, never single reports.

### Lost money: the first hour
Help → Lost money (or the button on a scam verdict): call 1930, a first-hour countdown, the details form, a ready
complaint text for cybercrime.gov.in and a letter to the bank in English or Hindi, and a checklist. Nothing is sent.

### Languages and read aloud
English and Hindi are complete. Bangla, Marathi, Tamil, Telugu, Kannada, Gujarati and Malayalam cover the main screens and
scam types and fall back to English elsewhere; fill the rest with `npm run translate` (needs `GEMINI_API_KEY`), then
`npm run build`. **Read aloud** uses the phone's own voice for the chosen language.

### Screenshot to report, and offline reports
**From a screenshot** reads the text on the phone (Tesseract.js, English + Hindi, files served from `/ocr`), then finds the
number, UPI ID and link like a paste. With no signal, a report is saved on the phone and sent automatically when the
connection returns (idempotent `report_id`, so it never counts twice).

### Android app (Play Store-ready)
1. Deploy on HTTPS (Render). 2. Go to **pwabuilder.com**, enter the URL, **Package for stores → Android**, download.
3. Copy the `assetlinks.json` from the package to `client/public/.well-known/assetlinks.json`, `npm run build`, redeploy:
   the server serves it at `/.well-known/assetlinks.json`, so the app opens full-screen without a browser bar.
The manifest already has an id, categories, shortcuts (Report, Check, Lost money) and store screenshots.

---

## Integrations setup

Seven connectors, one place: `config/connectors.yaml` says **what** goes **where**, `.env` holds the secrets.

| Connector | Kind | Sends / reads | Needs in `.env` |
|---|---|---|---|
| `area-alerts-telegram` | output | SPIKE / NEW_TYPE alerts | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID` |
| `fraud-team-slack` | output | alerts + attacks the trust rules blocked | `SLACK_WEBHOOK_URL` |
| `bank-fraud-desk` | output | every new report + alerts, **Bengaluru and Mumbai only**, HMAC-signed | `BANK_WEBHOOK_URL`, `BANK_WEBHOOK_SECRET` |
| `alerts-by-email` | output | alerts | `SMTP_URL`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` |
| `partner-blocklist` | input | `data/external/blocklist.csv` | nothing (on) |
| `reddit-amazon-numbers` | input | `data/external/reddit-amazon-scam-numbers.csv` | nothing (on) |
| `advisory-feed` | input | a JSON list from a URL, re-read every 30 min | `ADVISORY_FEED_URL` |

What leaves the server: the **area** (pincode, locality, city), the scam type, the channel and counts. Never a
reporter, a note, or a reported number. Inputs only ever show as "Also listed by"; they never count as reports.

**The loop for each one:** put the values in `.env` → restart the server (Ctrl+C, `npm run dev`) →
`npm run integrations` (checks the values, logs in where it is safe, sends nothing) → **Send test** in Help →
Integrations, or `npm run integrations -- test all`.

### Telegram: area alerts to a group, channel or your own chat
1. Telegram → **@BotFather** → `/newbot` → pick a name and a username ending in `bot` → copy the token.
2. `.env`: `TELEGRAM_BOT_TOKEN=123456789:AA...` → restart the server (this also starts the ScamMap bot).
3. Choose where alerts go and get its id from the bot:
   - **your own chat**: open your bot, press Start, send `/chatid` → a positive number;
   - **a group**: add the bot to the group, send `/chatid@YourBotName` there (with privacy mode on, bots in groups
     only see commands addressed to them) → a negative number;
   - **a channel**: add the bot as an admin that can post, post `/chatid` in the channel → `-100...`
     (public channels can also use `@channelname`).
4. `.env`: `TELEGRAM_ALERT_CHAT_ID=-1001234567890` → restart → **Send test**.

One bot token can run on one server at a time (Telegram allows one long-poll per token); a second copy logs
"Conflict". `/chatid` stores nothing.

### Slack: alerts and blocked attacks in a channel
1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch** → name `ScamMap`, pick
   your workspace.
2. **Incoming Webhooks** → switch **Activate Incoming Webhooks** on → **Add New Webhook** (to Workspace) → pick a
   channel (e.g. `#fraud-alerts`) → **Allow**.
3. Copy the URL (`https://hooks.slack.com/services/T.../B.../...`). Treat it like a password.
4. `.env`: `SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...` → restart → **Send test**.

Errors show Slack's own words in the status line: `no_service` (webhook deleted), `channel_not_found`,
`invalid_token`.

### Bank fraud desk: signed webhook
A partner's endpoint gets `POST {event, text, data}` with headers `x-scammap-event` and
`x-scammap-signature: sha256=<HMAC-SHA256 of the raw body, keyed with the shared secret>`. Failed deliveries are
retried (now, +2 s, +8 s); 4xx answers are not retried.

1. Make a secret: `npm run integrations -- secret` → paste the line into `.env`.
2. Pick a receiver:
   - **local (recommended for the demo):** in a second terminal `npm run webhook-receiver`. It checks every
     signature the way a bank should (`verifySignature` in `src/lib/deliver.ts`) and prints each event.
     `.env`: `BANK_WEBHOOK_URL=http://localhost:9900/scammap`. Add `-- --fail` to show the retries.
   - **online:** open [webhook.site](https://webhook.site), copy "Your unique URL" into `BANK_WEBHOOK_URL`
     (it shows the body and headers; it cannot check the signature for you).
3. Restart → **Send test**. Real traffic: only Bengaluru and Mumbai events (the `filter: cities` in the YAML).

### Email (Gmail SMTP)
1. Google account → **Security** → turn on **2-Step Verification** (app passwords need it).
2. [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → name it `ScamMap` → copy the
   16-letter password and **remove the spaces**.
3. `.env` (an `@` in the user name is written `%40`):
   ```
   SMTP_URL=smtps://you%40gmail.com:abcdefghijklmnop@smtp.gmail.com:465
   ALERT_EMAIL_FROM=ScamMap Alerts <you@gmail.com>
   ALERT_EMAIL_TO=you@gmail.com,teammate@example.com
   ```
4. Restart → `npm run integrations` (logs in, sends nothing) → **Send test** (subject starts with `[TEST]`).

Port 465 blocked on campus Wi-Fi? Use `smtp://you%40gmail.com:...@smtp.gmail.com:587`, or a phone hotspot. Any other
SMTP works the same way (Outlook `smtp://...@smtp-mail.outlook.com:587`, a Mailtrap sandbox for a fake inbox).

### Advisory feed: a JSON list from a URL
The feed is `[{ "type": "phone|upi|url|sender_id", "value": "...", "label": "..." }]` (or `{ "items": [...] }`).
A sample is in `data/external/advisory-sample.json` (made-up demo identifiers, labelled as such).

- **local:** `npm run integrations -- serve-advisory` in another terminal →
  `ADVISORY_FEED_URL=http://localhost:9901/advisory.json`.
- **online:** [gist.github.com](https://gist.github.com) → paste the sample as `advisory.json` → **Create secret
  gist** → **Raw** → copy that URL (drop the long commit id after `/raw/` to always get the latest version).

Restart; the panel shows `advisory-feed  on: 7 listed`. Check `VM-SBIUPD` or `amzrefund.demo@ybl` in the app:
**Also listed by: Sample advisory ...**; the second still says **No reports** (outside lists never count as
reports). The feed is re-read every 30 minutes, or right away when `config/connectors.yaml` is saved.

### See real events flow
With the server running: `npm run live-demo -- --fast` (or `npm run seed-demo -- --reset`). Blocked attacks reach
Slack within seconds, area alerts reach Telegram, Slack and email, Bengaluru/Mumbai reports reach the bank receiver.
Each output sends at most 30 events a minute (the rest are counted as "dropped").

| Problem in the status line | Fix |
|---|---|
| `off: set X in .env, then restart the server` | the value is empty or the server was not restarted |
| `HTTP 401` (Telegram) | token wrong or revoked: `/token` in @BotFather, paste again |
| `HTTP 400: ... chat not found` (Telegram) | wrong `TELEGRAM_ALERT_CHAT_ID`, or the bot is not in that group/channel |
| `HTTP 403: ... bot is not a member` / `not enough rights` | add the bot to the group; in a channel make it an admin that can post |
| `HTTP 400: ... group chat was upgraded to a supergroup` | the group got a new id: send `/chatid@YourBotName` again and update `.env` |
| `HTTP 404: no_service` (Slack) | the webhook was removed: add a new one |
| `fetch failed (ECONNREFUSED)` (bank) | the receiver is not running, or the port differs |
| `HTTP 401: bad signature` (bank) | `BANK_WEBHOOK_SECRET` differs between the server and the receiver |
| `Invalid login: 535` (email) | use an app password, not the Gmail password; no spaces |
| `HTTP 404` / `not JSON` (advisory) | use the Gist's **Raw** URL, not the Gist page |

## Amazon impersonation scams

- **Message checks** (Check screen, `POST /analyze`, Telegram bot) recognise the common Amazon patterns: a robo-call or
  SMS about an expensive order or Prime charge with "call / press 1 to cancel"; a "delivery agent" asking for an OTP over
  a call; an unexpected cash-on-delivery parcel; the Amazon name next to an international (+1) or US-style toll-free
  number (888-xxx-xxxx). Each comes with a plain explanation (Amazon never asks you to call a number to cancel; a real
  delivery OTP is only given at your door).
- **US numbers:** many fake "Amazon support" lines are North American. `+1 830-468-0018`, `+1 (818) 322-4089` and
  `001 877 550 9899` are now valid identifiers (`+18304680018`). A bare `830-468-0018` is still read as an Indian
  number, never guessed; the Check screen offers "Written like a US number? Check +1 830-468-0018 instead".
- **Outside list:** `data/external/reddit-amazon-scam-numbers.csv` holds 17 numbers that Reddit users (r/ScamNumbers,
  r/Scams) reported as fake Amazon support, entered by hand with no usernames. It is loaded through
  `config/connectors.yaml`, so a lookup shows **"Also listed by: Reddit r/ScamNumbers (unverified)"** and the message
  risk goes up, but it **never counts as a report** and never changes the community verdict (one outside claim must not
  label a number). `+1 206-922-0880` is widely listed as Amazon's real international line and is also faked as caller
  ID by scammers, so it carries that warning instead of a scam label. Add more rows (`type,value,label`) and save: the
  server reloads the list within seconds.
- **Demo data:** `seed-demo` adds two synthetic Indian numbers: a fake Amazon order desk (4 people, Known scam) and a
  fake delivery-OTP caller (3 people).

---

## Map layers: A (community reports) and B (global threat feed)

- **Layer A, core:** the community clusters come from the strict Appendix A `GET /map`, unchanged. This is what the
  judges' tool tests.
- **Layer B, the global view:** switch on **Global threats** on the Map or Live screen. The map zooms out to the world
  and draws malicious URLs reported to **URLhaus (abuse.ch)** as small glowing rings; new ones flash as they arrive and a
  ticker lists them on the Live map. Click a ring for details (defanged URL, malware tag, still online or not, country,
  how it was placed, link to the URLhaus page).
- **How it works:** the server (not the browser) calls `GET https://urlhaus-api.abuse.ch/v1/urls/recent/limit/200/` with
  your `Auth-Key` every 5 minutes, the most abuse.ch allows, so the key never reaches the browser and there are no CORS
  problems. The app polls `GET /threats/global` (licence-gated) every minute and reveals new URLs one by one.
- **Where each URL goes (approximate):** an IP address → the country its address block is registered to (RDAP via
  rdap.org, cached a week); a country domain ending (`.ru`, `.in`, `.br`, `.co.uk`) → that country; a generic or
  vanity ending (`.com`, `.xyz`, `.io`, `.tk`) → the address its domain resolves to (a DNS lookup only), then as for an
  IP. Markers sit on a ring around the country's centre. Up to 100 registry lookups per fetch.
- **Safety:** the malicious URLs are **never opened**. They are shown defanged (`hxxp://1[.]2[.]3[.]4/…`) and never as
  links. URLhaus lists mostly **malware download** URLs (botnet payloads, droppers), so the app calls them "malicious
  URLs", not phishing pages. It is public threat data with no personal data; it never mixes with community reports.

**Set it up**
1. Open https://auth.abuse.ch/ and sign in with X, LinkedIn, Google or GitHub. Connect at least one more sign-in
   provider and press **Save profile**. In the **Optional** section, generate an **Auth-Key** and copy it.
2. Add it to `.env`: `URLHAUS_AUTH_KEY=<your key>` (never commit `.env`).
3. Check it: `npm run threats` (one request; prints how many URLs it got and the top countries).
4. Restart the server; the log says `global threat feed updated {"new_urls":200,"located":…}`.
5. App → **Map** → switch on **Global threats**.

---

## Safety: time-travel defence, local AI for Hindi notes, anti-spoofing

### 1. Time-travel defence (clock set back)
- **High-water mark** in `system_metadata` (`key = 'clock.high_water'`): the latest time this server has ever seen. It is
  raised in **one atomic statement** (`INSERT … ON CONFLICT DO UPDATE SET value_ms = GREATEST(…)`), never lowered, so
  restarts and several instances share it.
- **Sources:** a local tick every **2 s**; every request; every accepted report's `occurred_at` / `reported_at`; the
  **database server's own clock** (a different machine on Render, so it catches a clock set back even on a fresh
  install); optionally an HTTPS time witness (`CLOCK_WITNESS_URL`).
- **Request times can only confirm the mark, never push it past the server's clock.** Otherwise one request with a
  future date would lock the server for everyone (and the test tool sends future-dated reports expecting `400`).
- **Lock:** if the clock is more than `CLOCK_TOLERANCE_SECONDS` (120) behind the mark, every API call except `/health`
  and `/license` answers
  `403 {"error":"LICENSE_EXPIRED","reason":"CLOCK_ROLLBACK","code":"CLOCK_ROLLBACK_DETECTED","message":…,"high_water_mark":…,"behind_seconds":…}`
  with header `x-scammap-safety-lock: clock-rollback`. The error code stays `LICENSE_EXPIRED` because that is what
  clients and the test tool expect for a lock; the rest says exactly why. The app shows a dedicated safety screen.
- **Unlock:** automatic as soon as the clock is right. Data is never touched. `npm run clock` shows the state;
  `npm run clock -- reset --yes` forgets the mark (only after a clock that was wrongly far in the *future*).

### 2. Local AI reads Hindi and Hinglish notes (Ollama)
When a report arrives with **`scam_type` blank**:
1. **At once:** keyword rules in English, Hindi and Hinglish (`giraftar`, `bijli`, `naukri`, `खाता बंद`…) pick a type, so
   the reply is never delayed.
2. **In the background:** if the note is in Hindi (Devanagari), Hinglish, or the rules found nothing, the **local model**
   (Ollama, default `llama3.2:3b`) translates it to English and picks one of the 13 scam types with a confidence, using
   Ollama's JSON-schema structured output. If it is sure (≥ 60%) the stored report is re-labelled and the number
   re-assessed; the Live screen shows *"Local AI read a hinglish note in HSR Layout: Video call blackmail"*.
- A type the **reporter chose is never changed.** `reports.scam_type_source` records `reporter`, `rules`, `local_ai` or `default`.
- **Privacy:** the note goes only to Ollama on this computer (`OLLAMA_URL` must be localhost or your private network
  unless `OLLAMA_ALLOW_REMOTE=true`), is held in memory for seconds, and is never stored or logged. Don't set `OLLAMA_DEBUG`.
- **Speed:** the model gets half the CPU cores (`OLLAMA_THREADS`), so lookups stay fast while it reads.
- Without Ollama (for example on Render) everything still works with the keyword rules; Help → Safety checks says why the
  local AI is off. `AUTO_SCAM_TYPE=false` keeps blank types as `other`.
- Try any note: Help → Safety checks → *Try a note*, or `POST /analyze/note {"note":"…"}`.

**Set up Ollama on Windows**
1. Download **OllamaSetup.exe** from https://ollama.com/download and install it (no admin needed). It runs in the tray
   and listens on `http://localhost:11434`.
2. In Git Bash: `ollama pull llama3.2:3b` (about 2 GB, once). Low on RAM? `ollama pull llama3.2:1b` and set
   `OLLAMA_MODEL=llama3.2:1b` in `.env`.
3. Check it: `curl http://localhost:11434/api/tags` lists the model.
4. Restart ScamMap: the log says `local AI ready: llama3.2:3b at http://127.0.0.1:11434`.

### 3. Anti-spoofing (one host cycling fake `ip_prefix` blocks)
Rule **B2** above. Addresses are reduced to /24, and a keyed hash of the /16 block is stored next to the /24 hash (both
cleared after 30 days). One machine rotating `10.20.1`, `10.20.2`, `10.20.3`… within minutes becomes **one person**;
three unrelated people on other networks still make it `KNOWN_SCAM`. `npm run bench-trust` (offline):

| Pattern | Wrong verdicts |
|---|---|
| 12 accounts cycling /24s in one /16 over 15 min | 100% fooled the engine before → **0-1%** now |
| 8 accounts cycling over 30 min (gaps > 5 min) | 100% before → ~35% (`SUBNET_WINDOW_MINUTES=10`: ~3%) |
| 3 real people on big carrier blocks within 1 h | ~20% before and after (shared stock sentences, rule C), so B2 adds no false merges |
| 15-person real wave on carrier blocks | 0% |

### Demo the three, narrated, in a terminal
```bash
npm run demo -- spoof     # 10 accounts on rotating prefixes -> 1 person; then 3 real people -> KNOWN_SCAM
npm run demo -- hindi     # blank types + Hindi/Hinglish notes -> rules at once, local AI translation and fix
npm run demo -- clock     # needs DEMO_TIME_TRAVEL=true: moves the server clock back 1 day -> 403 safety lock -> back
npm run demo -- watch     # or change the real Windows clock and watch the lock appear and disappear
npm run live-demo -- --fast   # continuous incoming reports, incl. blank-type Hindi notes and cycling attacks
```

---

## API

### Appendix A (exact contract)

| Endpoint | Reply |
|---|---|
| `GET /health` | `200 {"ok":true}` (never locked) |
| `POST /reports` | `201 {"report_id","case_id","merged"}` (+ `verdict`, `confirmed`) · `400 {"error"}` for junk identifier, unknown area, bad/future time · `429` per rule H. Duplicate `report_id` is idempotent. Unknown `scam_type` → `other`, unknown channel → `Something else`. Old reports are accepted. Optional `amount_lost_inr`. |
| `GET /lookup?type=&value=[&pincode=]` | `verdict` ∈ `KNOWN_SCAM`/`SUSPICIOUS`/`NO_REPORTS`/`VERIFIED_BUSINESS`, `report_count`, `distinct_reporters` (people after trust rules), `first_seen`, `last_seen`, `scam_type`, `display_value` (masked under 3 people), `evidence` (≤5, only time/channel/type/area), `challenged`. Extras: `confirmation`, `explain`, `message_en`, `message_hi`, `near_you_count`. Unreported → `200 NO_REPORTS`; impossible value → `400`. |
| `GET /map?pincode=&days=7&radius_km=2` | `{"clusters":[{pincode,locality,city,count,top_scam_type,severity,lat,lng}]}`; points from the area table only. Without `pincode`: all areas. |
| `GET /alerts?pincode=` | `{"alerts":[SPIKE…, NEW_TYPE…]}` or `{"alerts":[]}`, computed at request time. Without `pincode`: all areas. |
| `POST /admin/reset` | deletes reports, challenges, reporter stats, rejection counters, caches. Keeps licence, clock mark, verified list. |
| `POST /challenges` | `201 {"challenge_id","status":"under_review"}`; the number then shows `challenged:true` and is never `KNOWN_SCAM` |
| `GET /license` · `POST /license` | licence info · install a signed licence (400 if the signature fails) |

Severity for `/map`: **CRIT** if a SPIKE is active or 10+ reports, **HIGH** if 5+, otherwise **MED**.

### Extras (licence-gated like everything else)

| Endpoint | Reply |
|---|---|
| `POST /analyze` `{"text","pincode?"}` | risk analysis of a whole message or email: `score` 0-100, `level`, `scam_type`, `signals`, `reassurances`, every identifier inside with its community verdict, `community` (if one is a Known scam the score is raised to at least 85), and `ai` (Gemini's reading, or `{"available":false}`) |
| `GET /analyze/quick?type=&value=` | offline risk of one link, phone or sender (look-alike domains, risky TLDs, number series…) |
| `POST /analyze/identifier` `{"type","value","pincode?"}` | second opinion on one identifier: `score`, `level`, `rules`, `community` (the public verdict, unchanged), `ai` (Gemini: summary, checks, safest step, in EN and HI) |
| `GET /datasets/summary` | imported datasets, their breakdowns and the models' accuracy |
| `GET /live/stream` | Server-Sent Events: `report`, `defence` (attack caught), `alert`. Area-level only. Licence re-checked every 15 s |
| `GET /live/forecast` | per area: last 24 h, 7-day baseline, pace per hour, next-24-h forecast, trend, `eta_hours` to the SPIKE level; hourly expectation; rising scam types |
| `GET /live/cards?cursor=&limit=` | held-out card transactions in time order with the model's score (for the replay) |
| `GET /stats?days=7&pincode=\|city=` | all analytics behind the Insights screen |
| `GET /insights/briefing?days=&pincode=\|city=` | short written summary in English and Hindi (Gemini, cached 10 min; rules if no key) |
| `GET /lookup/explain?type=&value=` | how reports became people: each report (whole hours ago, its group, flags) and each group (size, counted or set aside, why). Only when 2+ reports exist |
| `POST /analyze/link` `{"url"}` | live link check in a sandbox: redirects, final page, what it asks for (password, OTP, card, Aadhaar…), brand on a foreign domain, form posting elsewhere, APK downloads, certificate and domain age, hosting network; `verdict` and the static↔live `correlations`. 10 per minute per network |
| `GET /campaigns` · `GET /campaigns/:id` · `GET /network` | scam campaigns (kill chain, spread, identifiers, story) and the network graph. Only identifiers 2+ unrelated people reported; masked under 3 |
| `GET /rollups?hours=48[&pincode=]` · `GET /system/scale` | hourly rollups (counted / set aside) and scale info |
| `GET /partner/me\|hits\|rollups\|deliveries` · `POST /partner/test-webhook` | partner console, header `x-api-key` |
| `GET /push/key` · `POST /push/subscribe\|unsubscribe\|test` | web push for an area |
| `GET /connectors` · `GET /transparency?limit=` · `GET /privacy/schema` | integrations status, hash-chained verdict log (re-verified on read), every table and column with what it holds |
| `POST /connectors/test {name}` | send one `[TEST]` alert through a named output (filters ignored, one every 5 s per output); in production needs `CONNECTOR_TEST_TOKEN` as header `x-connector-test-token` |
| `GET /map?...&k=3` | the app's map: areas with fewer than 3 reports come back as `{"count":0,"suppressed":true}` with no scam type. Without `k` the reply is exactly Appendix A |
| `GET /ocr/*`, `GET /.well-known/assetlinks.json` | on-device OCR engine files; Android app link file (not gated) |
| `GET /threats/global[?since=<id>]` | map layer B: status of the URLhaus feed, newest URLs (defanged, with approximate country and position), top countries, attribution |
| `GET /safety` | clock guard state, local AI status and recent readings (area and types only), anti-spoofing settings, where scam types came from |
| `POST /analyze/note` `{"note"}` | read one note: language, keyword-rule type, the local model's English translation, type and confidence. Nothing stored |
| `POST /demo/time-travel` `{"seconds_back"}` | **only with `DEMO_TIME_TRAVEL=true`**, not gated: move the server clock back (0 = right again) |

Normalisation (one shared function, `shared/normalize.ts`): phones → `+91` + 10 digits (also `0…`, `91…`, `0091…`,
hyphens, spaces, Devanagari digits, a `+` decoded as a space); toll-free `1800/1860…` and helplines (`1930`, `112`…)
keep their digits; all-same digits and `12345` are junk. UPI → lower case, `upi://pay?pa=` QR links unwrapped. Links →
`https://`, no `www.`, no query/fragment/trailing slash, defanged `hxxp`/`[.]` repaired, look-alike Unicode domains turned
into punycode. SMS senders → the 6-character code without the operator prefix (`AD-`) or the TRAI suffix (`-S`, `-T`, `-P`, `-G`).

---

## One report never labels a number (personal-number protection)

Anyone can type anyone's number, including an ex, a neighbour or a business rival. So the public answer climbs a ladder,
and every rung needs **unrelated** people:

| Credible people after the trust rules | Public verdict | What is shown |
|---|---|---|
| 0 | `NO_REPORTS` | "No reports yet. That does not mean it is safe." |
| **1** | **`NO_REPORTS`** (`confirmation: "awaiting_confirmation"`) | Nothing about the report: no type, no dates, no evidence, masked number. The reporter is told it stays private until someone else reports it. |
| 2 | `SUSPICIOUS` | masked number (`98XXXXX210`), "Reported by 2 people. Not yet confirmed…" |
| 3+ with trust weight ≥ 2.0 | `KNOWN_SCAM` | full number, evidence, advice |

"Unrelated" means after rules A-I below: the same device, the same network within a day, copy-pasted notes, a burst of
near-identical reports, or 3+ accounts on one network all count as **one** person. On top of that:

- **Grudge notes** ("my ex", "owes me money", "revenge", "मेरा एक्स", "उधार नहीं लौटाया"…) are recognised in English,
  Hinglish and Hindi. A voice made only of such notes is **not credible**: three grudge reports leave the number at
  `NO_REPORTS`. A grudge note never hides real victims of the same number; they still count.
- **Serial accusers** (people who have reported 3+ numbers that nobody else ever reported) weigh 0.6 instead of 0.8.
- **Owners can dispute** from the result card ("This is my business number"); a disputed number is never `KNOWN_SCAM`.
- Verified businesses and helplines are always `VERIFIED_BUSINESS`.
- Brief rule kept: numbers stay masked until **3** different people. `lookup` with `type`+`value` still returns the
  Appendix A fields, so the judges' tool sees the contract it expects.

---

## Trust rules: how fake reports are stopped

**Count independent people ("voices"), not reports.** For each identifier the latest 200 reports are grouped into voices
with a union-find. Fakes are **quarantined, never deleted**: if real victims show up later, the verdict updates. All
thresholds live in `src/trust/config.ts`; the engine is a pure function in `src/trust/assess.ts`.

| Rule | What it does | Stops |
|---|---|---|
| **A** Same reporter | One `reporter_id` is one person, however many reports. 3+ on one identifier in a day = spam: counted once, never feeds alerts. | One person reporting 6× in an hour |
| **B** Same network | Addresses are reduced to their **/24** (`49.36.12.7` → `49.36.12`). Same /24 on the same identifier within 24 h = one person. 3+ accounts on one /24 = **sybil ring**: one low-trust person (weight ≤ 0.5), never on the map or in alerts. | 22 fake accounts on one Wi-Fi → 1 |
| **B2** Prefix cycling | Same **/16 block**, each report within **5 minutes** of the previous one (sliding window), **3+ different /24s** from **3+ accounts** → one network cluster = **one person** (low trust, never on the map or in alerts). Unrelated people on other networks still count, so a real scam is cross-verified by them. | One machine rotating fake `ip_prefix` values |
| **C** Copy-paste | Notes compared by character 5-gram similarity (Hindi, Hinglish, English). Similar notes from different accounts merge **only with a sign of coordination**: within 6 h of each other, or shared by 5+ accounts. | Friends pasting the same complaint, even edited |
| **D** Coordinated burst | 6+ people within 3 h whose notes have few different texts (distinct ÷ people < 0.3), or < 30% from different networks → one voice, set aside. | 40 friends bombing a bakery |
| **E** Weights | New 0.8, returning 0.9, corroborated up to 1.5, past burst/sybil member 0.5, serial accuser 0.6; empty note ×0.85, screenshot or money lost ×1.1, grudge note ×0.5. A voice is as strong as its **best** member. | New accounts counting as much as proven reporters |
| **F** Protection | Verified list (Appendix C + helplines) is always `VERIFIED_BUSINESS`; disputed numbers are never `KNOWN_SCAM`. | Bombing a real business |
| **G** Junk | Invalid identifier, unknown area, unparseable or future time → `400` (counted on the Insights screen). | `12345`, `test`, "yesterday" |
| **H** Rate limit | 429 when one `reporter_id` sends more than 3 reports on one identifier, or 30 in total, within an hour. Never by `ip_prefix` alone. | Floods |
| **I** Campaign check | 8+ people but fewer than 20% describe anything first-hand → not `KNOWN_SCAM`, off the map and alerts. | Slow empty-note bombing over days |
| **J** Grudges | Voices made only of personal-dispute notes are not credible and never countable. | "Report my ex's number" |

**Map and alerts** use only *countable* reports: one per credible person per identifier, excluding bursts, sybil rings,
spammers, copy-paste groups, campaigns, grudges and reports about verified numbers. SPIKE: last 24 h ≥ 5 and ≥ 2 × the
daily average of the 7 days before. NEW_TYPE: a type not seen in that area in the 30 days before.

**Why wasn't the bakery labelled a scam?** Every lookup returns `explain`, e.g.
`{"raw_reports":40,"independent_voices":1,"credible_voices":0,"flags":["COPY_PASTE_NOTES","COORDINATED_BURST"],"why":"…"}`.

### Simulator scorecard (local run, seed 604)

```
1 Stops fake reports               13/13 checks  ~20.0/20 pts
2 Lookup gives the right answer    15/15 checks  ~15.0/15 pts   (300 lookups: p50 6 ms, p95 13 ms, p99 17 ms)
3 Map and alerts                   11/11 checks  ~10.0/10 pts
4 Privacy                          14/14 checks  ~15.0/15 pts   (incl. 1 person -> private, 2 -> masked Suspicious, grudges -> private)
5 Licence                          7/7 checks    ~15.0/15 pts
Bonus                              5/5 checks
Extra features                     4/4 checks    (analyze, stats, briefing)
ALL CHECKS PASSED
```

Run it against your **live** server: `npm run simulate -- --base https://<server> --licence`, then
`curl -X POST https://<server>/admin/reset`. The simulator is our own stand-in; the judges' data will differ.

---

## Message, email and link checks (offline rules + Gemini)

`shared/risk.ts` runs in the browser **and** on the server, so a result appears instantly and offline:

- **Messages:** asks for OTP/PIN/CVV, remote-access apps (AnyDesk, TeamViewer…), `.apk` links, police/CBI/customs/court
  claims, "don't tell anyone", block/arrest threats, urgency, money asks, prizes, task jobs, investment groups, KYC,
  "scan QR to receive", electricity cut-off, upfront fees, courier holds, generic greetings; English, Hindi and Hinglish.
- **Emails:** Reply-To on another domain, a brand name sent from a non-brand domain, free-mail senders claiming to be a
  company, HTML/ZIP/APK attachments, "verify your account" phishing.
- **Links:** brand look-alikes (`sbi-kyc-update.top`, `amaz0n`, digit-for-letter swaps, typosquats), banks not on
  `.bank.in` (RBI mandate, Oct 2025), government not on `.gov.in`, punycode, raw IPs, shorteners, risky TLDs, many
  hyphens/subdomains/digits, bait words, no HTTPS, `user@host` tricks.
- **Phones and senders:** personal mobiles claiming to be a bank (banks use the **1600/1601** series; telemarketing
  **140**), TRAI sender IDs with `-P/-S/-T/-G` suffixes.
- **Reassurances** lower the score: "never share your OTP", official domains, verified senders.

**Gemini** (`src/ai/`) is optional and only *adds* a reading. Before anything leaves the server, phone numbers, UPI IDs,
email names and link query strings are replaced with placeholders, and the text is capped at 6,000 characters. The
reply must match a JSON schema (risk level, score, scam type, summary and red flags in English and Hindi, advice); the
final score is 60% Gemini + 40% rules. Gemini **never** decides a community verdict: Known scam comes only from people.
Prompts and replies are not logged. Errors back off (1 min on 429, 10 min on a bad key) and the rules carry on.

---

## Datasets, models, live feed and forecast

| Dataset (in PostgreSQL) | Used for | Result |
|---|---|---|
| **Financial Scams Detection** (Al Rafi Ahmed, Gazi Faizul Islam, Mendeley Data 2025, doi:10.17632/znsk27yk3h.1): 520 labelled scam/ham messages, English and Bangla | Naive Bayes text model (character 3-4-grams + words, works across scripts) and a TF-IDF index of the closest labelled examples | 5-fold cross-validation on 516 unique messages: **91.9% accuracy, 91.8% precision, 94.8% recall** |
| **Credit Card Fraud Detection** (Worldline and ULB Machine Learning Group, Dal Pozzolo et al.; Kaggle `mlg-ulb/creditcardfraud`): 284,807 anonymised transactions, 492 frauds, Europe, Sept 2013 | Logistic regression (Adam, class-weighted, L2) on V1-V28, log amount and time of day; **time-ordered split**: first 60% train, next 15% tunes the threshold, last 25% test | On the 71,202 latest transactions it never saw: **precision 100%, recall 66%, average precision 79.5%** (62 of 94 frauds caught, 0 false alarms) |

How they are used, and their limits:
- **Message check:** the dataset model counts for 20-25% of the score **only when it recognises at least 40% of the text**
  (it was trained on Bangladeshi messages; a Hindi message gets no say). The closest labelled examples are shown as
  evidence and passed to Gemini as context. Rules and Gemini still carry most of the score.
- **Card replay (Live screen):** a demonstration of real-time fraud scoring on real data. It is European data from 2013,
  is never placed on the India map and never mixed into community reports.
- Datasets are reference data: `POST /admin/reset` keeps them, and they never appear as reports, on the map or in alerts.

**Second opinion on a number, UPI ID, link or sender** (`POST /analyze/identifier`): the community verdict comes first
and bounds the score (Known scam ≥ 85, verified ≤ 8, Suspicious ≥ 45). Rule checks (number series, look-alike domains,
bank names on personal UPI IDs, risky handles…) can be softened by Gemini but not erased. **Gemini never receives a
phone number or UPI ID**: only a description ("Indian personal mobile number", "PhonePe UPI ID whose name contains a bank
name"), the rule findings and the public community verdict. Results are cached for an hour.

**Live feed:** every new report (area, scam type, channel), every attack the trust rules catch (coordinated burst,
many accounts on one network, copy-paste, repeat reporter, grudge, reports against a verified business, rate limit), and
every new SPIKE/NEW_TYPE alert, pushed over Server-Sent Events. One attack is shown at most once every 3 minutes. Alerts are
checked 3 s after an area's last report, so a bulk load never announces an alert that vanishes a second later.

**Forecast:** Holt linear smoothing on 8 daily counts of trusted reports, blended 60/40 with the last 6 hours' pace. "Alert
level" is exactly the SPIKE rule (5+ and 2× the 7-day average); "at this pace" is shown only after 2+ reports in 6 hours.
Fake reports never feed it.

**Map styles:** OpenStreetMap Standard, CARTO Positron (Light) and Dark Matter, OSM Humanitarian (OSM France) and
OpenTopoMap, all OpenStreetMap data with each provider's attribution. None of them needs a key. Public tile servers are for
light use; for real traffic set `VITE_TILE_URL` or use a tile provider.

**Optional MapTiler key (Live map):** get a free key at https://cloud.maptiler.com/account/keys/ (the free plan is for
non-commercial use and pauses when its monthly quota is used up), add `VITE_MAPTILER_KEY=...` to `.env`, then
`npm run build` and restart. The Live map switches to MapTiler's dark data-visualisation style, and both maps get a
"MapTiler Dark" and "MapTiler Streets" option in the layers menu. The key is built into the page (every browser map key is),
so in MapTiler Cloud limit it to your addresses (`http://localhost:8080` and your `https://…onrender.com`). On Render,
add `VITE_MAPTILER_KEY` as an environment variable; the Dockerfile passes it to the build. If the key is wrong or out of
quota, the map falls back to CARTO Dark Matter by itself.

---

## Licence

- **Ed25519.** `npm run gen-keys` writes the private key to `keys/private.pem` (git-ignored, never leaves your laptop) and
  the public key into `src/licence/publicKey.ts` (committed and deployed).
- A licence is `{"licensee","expires_at","signature"}` (+ `issued_at`). The signature covers the canonical JSON of every
  other field, so editing the date or name breaks it.
- `POST /license` verifies, saves to Postgres and swaps it in memory **immediately, without restart**.
- **Checked on every request.** If not valid, everything except `/health` and `/license` answers
  `403 {"error":"LICENSE_EXPIRED","reason":"EXPIRED|MISSING|CLOCK_ROLLBACK"}`. Data is never deleted. The app shows
  "Licence expired. Contact your provider." in English and Hindi, checks `/license` every 10 s and unlocks itself.
- **Clock set back?** See *Time-travel defence* below: the API locks with `403 {"error":"LICENSE_EXPIRED","reason":"CLOCK_ROLLBACK","code":"CLOCK_ROLLBACK_DETECTED",…}`
  even after a restart, and unlocks by itself when the clock is right. `npm run clock` shows the stored mark.
- **Bootstrap:** with no licence in the database, `LICENSE_JSON` is loaded at startup.

**Live demo:** `npm run sign-licence -- --licensee "Demo Bank" --minutes 5 --upload https://<server>` first; show
everything else; after 5 minutes a check shows the lock screen and `curl …/lookup?type=phone&value=1930` gives 403;
`… --days 30 --upload …` and the app unlocks within 10 s with all data intact. (Also possible in the app: Help → Licence.)

---

## Privacy (breaking these disqualifies)

- **No identity stored:** no login; `reporter_id` and `ip_prefix` are stored only as HMAC-SHA256 with a secret pepper.
  Network hashes are cleared after 30 days.
- **No location stored:** only the area. The map draws the official area point. "Use my location" picks the nearest area
  **on the phone**; coordinates are never sent.
- **No note text stored:** only its length, a keyed hash, keyed shingle hashes, its script (Devanagari/Latin/mixed) and a
  grudge yes/no. Money lost is kept only as a band (none, under ₹10k, ₹10k-1 lakh, over ₹1 lakh).
- **Masked until 3 people;** a single report shows nothing at all.
- **Wording:** "Reported by 7 people", never "scammer" or "fraud".
- **Evidence** has only time, channel, scam type and area. A challenge's `contact_email` is never returned.
- **Logs:** method, route pattern, status, duration. No URLs, bodies, IPs or Gemini prompts.
- **Live feed and forecast** carry the area, scam type and channel only; never a number, ID, link, reporter or network.
- **Second opinion:** phone numbers and UPI IDs never go to Gemini, only a description of them.
- **Map k-anonymity:** the app's map hides areas with fewer than 3 reports (no count, no scam type), so one report can't be
  pinned to a place. The "how reports were counted" view shows times in whole hours and only when 2+ reports exist.
- **Transparency log:** every public verdict change is appended to a hash chain (identifier as a keyed hash); editing or
  deleting any entry breaks every later hash, and the app re-verifies the chain on each read. Help → *What we store*
  lists every table and column, read live from the database.
- **Local AI notes:** a note goes only to Ollama on the same computer (or your private network), is kept in memory until
  it is read, and is never stored or logged; only the resulting scam type and its source are saved.
- **Network blocks:** only keyed hashes of the /24 and /16 are stored, and both are cleared after 30 days.
- **Screenshots** are read on the phone (Tesseract.js, served by our own server); the image is never uploaded.
- **Lost money** details stay on the phone (session storage). **Push** keeps only the browser's push address and the area;
  **Telegram** stores a chat id only for people who send /alerts (deleted with /stop); bot reports use a keyed hash.
- **Partners** see identifiers masked until 3 unrelated people confirm them, like everyone else; their API keys are stored
  only as SHA-256. Webhooks carry area and scam type, never a reporter.
- **Link check** never sends cookies, never runs scripts, never submits forms, strips query strings (they can carry a
  victim's details), and refuses private addresses (SSRF guard: DNS checked, connection pinned to the checked address).
- **No scraping** and no lookups of anyone's data elsewhere. Gemini receives redacted message text only, and only when
  a user asks for a message check.

---

## Data

- **Areas:** the 25 areas of Appendix B with official points. **Verified list, scam types, channels:** Appendix C plus
  public helplines (1930, 1909, 112…).
- **Demo data** (`seed-demo`) is synthetic: generated numbers, links like `sbi-kyc-update-xxxx.top`, notes written for
  this project. It is not a list of real scam numbers, and must not be presented as one.

## Honest limitations

- Coordinated real people writing different text from different networks over days look like real victims. Rules C, D,
  I and J raise the cost; they can't make it impossible.
- Several real people on one carrier prefix reporting the same number within 24 h count as one (slower, never wrong-way).
- The grudge detector is a phrase list; a determined accuser can avoid the words. The 2-person ladder is the real defence.
- `ip_prefix` is trusted from the request body because the test tool sends it; set `TRUST_BODY_IP_PREFIX=false` in production.
- `/admin/reset` is unauthenticated because the brief requires it. Remove or protect it in production.
- OpenStreetMap's public tiles are for light use; set `VITE_TILE_URL` to a tile provider for real traffic.
- The imported datasets come from Bangladesh (messages) and Europe (cards). They improve and explain the answers, but
  Indian scams use other words: that's why the dataset model is weighted low and switched off when it doesn't recognise
  the text. Dataset labels can be noisy.
- The forecast is a short-term trend estimate from a few days of reports, not a prediction of individual scams.

## Manual steps for you

1. **Start a fresh Git repo during the event** and commit as you go: `git init && git add . && git commit -m "ScamMap"`.
2. **Generate your own key pair** (`npm run gen-keys`) and commit `src/licence/publicKey.ts`. Before pushing,
   `git status --ignored | grep keys/` must show keys as ignored, and `git log -p | grep -c "PRIVATE KEY"` must print `0`.
3. Push to GitHub, deploy with the Render Blueprint, set `LICENSE_JSON` (and `GEMINI_API_KEY` if you want AI).
4. Run the simulator against the live URL, then `POST /admin/reset`. **Never** run `seed-demo` on the server right before
   the judges' tool; reset if you did.
5. Phone check: open the URL on Android, "Add to Home screen", report a scam in English and in Hindi, time it.
6. Optional APK: see *Android app* above.
7. Record the 3-minute video with `PITCH.md`.

## Layout

```
shared/            normalisation, areas, scam types, verified list, extraction, risk rules (server AND app)
src/trust/         trust engine (pure) + every threshold
src/alerts/        SPIKE / NEW_TYPE / map clustering (pure)
src/ai/            Gemini client, redaction, schemas, briefing, identifier second opinion; Ollama client + note reader
src/datasets/      CSV reader, dataset loaders, text model + similarity index, card-fraud model, in-memory store
src/live/          live event bus (Server-Sent Events)
data/              dataset CSVs for `npm run import-data` (creditcard.csv is git-ignored)
src/licence/       Ed25519 verify, licence manager, clock guard (time-travel defence), public key
src/services/      database work, /lookup view and verdict ladder, analytics queries, forecast
src/routes/        Fastify routes;  src/app.ts licence gate, JSON parsing, static app
src/db/            migrations (run on startup) and Postgres access
src/partners/      tenants, API keys, matching, signed webhooks        src/connectors/  YAML connectors (hot reload)
src/linkscan/      SSRF-safe fetcher, RDAP, page analysis, static/live correlation
src/campaigns/     campaign + network graph (pure) and service         src/push/ src/telegram/  web push, bot
config/            connectors.yaml                                      data/external/  demo block-list
scripts/           simulate, seed-demo, live-demo, import-data, bench-trust, gen-keys, sign-licence, partner, load-test, translate
client/            React app: screens/, components/, charts/ (dependency-free SVG), i18n.ts (EN + HI), locales/ (7 more)
test/              Vitest
```
