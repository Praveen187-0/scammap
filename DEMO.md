# Demo runbook: every requirement, step by step

Two Git Bash terminals in `~/Videos/scammap`: **T1** runs the server, **T2** runs commands. The app is open at
http://localhost:8080 (and on a phone on the same Wi-Fi at `http://<your-PC-IP>:8080`).

## A. Full test, the way the judges' tool will (10 minutes)

The simulator is our stand-in for their tool: it resets the database, posts real and fake reports, checks every
endpoint and prints a scorecard in the rubric's rows. Run it on your laptop, never on the deployed server right before
judging.

```bash
# T1: a clean build, then the server
npm run check-all                 # typecheck + 117 tests + build: must end with "built in …"
npm start
# T2
npm run sign-licence -- --licensee "Demo Bank" --days 30 --upload http://localhost:8080
npm run simulate -- --licence     # must print ALL CHECKS PASSED (it also tests licence expiry and renewal)
npm run simulate -- --seed 42     # a second random run
npm run bench-trust               # offline: how often each real and fake pattern gets the wrong verdict
```
Then by hand, against the same server (copy-paste each line):
```bash
curl -s http://localhost:8080/health                                           # {"ok":true}
curl -s "http://localhost:8080/lookup?type=phone&value=9876543210"             # 200, NO_REPORTS
curl -s "http://localhost:8080/lookup?type=phone&value=12345"                  # 400 junk
curl -s "http://localhost:8080/map?pincode=560102&days=7&radius_km=2"          # clusters (Appendix A shape)
curl -s "http://localhost:8080/alerts?pincode=560102"                          # alerts list
curl -s -o /dev/null -w "%{time_total}s\n" "http://localhost:8080/lookup?type=phone&value=%2B919876543210"   # well under 0.5 s
```
Before handing the deployed URL to the judges: `npm run simulate -- --base <URL> --licence`, then
`curl -X POST <URL>/admin/reset`, and make sure `DEMO_TIME_TRAVEL` is not set there.

## 0. Before the judges arrive (5 minutes)

```bash
# T1
npm run build && npm start                      # log shows: local_ai "llama3.2:3b at http://127.0.0.1:11434"
# T2
npm run sign-licence -- --licensee "Demo Bank" --days 30 --upload http://localhost:8080
npm run partner -- demo                         # copy the bank key for the Partners screen
npm run seed-demo -- --reset                    # synthetic data; prints the numbers used below
npm run demo -- hindi                           # also loads the model into memory so later answers are quick
```
For the clock demo without touching Windows, put `DEMO_TIME_TRAVEL=true` in `.env` before `npm start`. Remove it before
deploying. Never run seed-demo or the demos against the judged server.

## 1. Report in under 60 seconds, area only
App → **Report a scam** → paste `Call from +91 93456 12780 said my parcel has drugs, digital arrest` → pick type, area →
**Send report**. The timer shows the seconds (about 10-15 s). Help → *What we store* shows `reports.pincode` = area only.
Also try **From a screenshot** (text read on the phone), and turn off Wi-Fi to show the report saved offline.

## 2. Lookup in under 0.5 s, with the four verdicts
**Check** screen:
| Paste | Shows |
|---|---|
| `+91 98823 19275` | **Known scam**, reported by N people, number shown |
| `task.pay24@ybl` | **Suspicious** (2 people), UPI ID masked as `t***@ybl` |
| `+91 93456 12780` (the one you just reported) | **No reports**: one report never labels a number |
| `+91 80 4100 2233` | **Verified business** (bombed bakery, still green) |
`curl -s -o /dev/null -w "%{time_total}\n" "http://localhost:8080/lookup?type=phone&value=%2B919882319275"` → about 0.01 s.

## 3. Fake reports are stopped
- Bakery `+91 80 4100 2233` → **See how the reports were counted**: 25 reports fly into one grey bubble.
- Sybil `+91 89374 02165`: 22 accounts on one Wi-Fi → one "one network" bubble.
- Grudge `+91 88192 69826`: "my ex" reports → still No reports.
- **Spoofed networks:** `npm run demo -- spoof` (10 accounts cycling `ip_prefix` inside one /16 → 1 person; then 3 real
  people elsewhere → Known scam with 4 people). Then paste the printed number on Check → the "one network block" bubble.

## 4. Map (7 days) and alerts only when unusual
**Map**: circles per area, areas under 3 reports hidden. **Alerts**: SPIKE + NEW_TYPE in HSR Layout, NEW_TYPE in
Whitefield, "All normal" elsewhere. Run `npm run live-demo -- --fast` in T2 and open **Live**: reports ping, attacks are
caught in the feed, and blank-type Hindi notes show "Local AI read a hinglish note…".

## 4b. Map layer B: the world view
Map → switch on **Global threats**. Say: "Layer A is our own community data from the strict `/map` endpoint. Layer B is
URLhaus, abuse.ch's live feed of malicious URLs, fetched by our server every 5 minutes and placed by domain ending or
IP registry. They are never opened, only shown defanged." Click a flashing ring for details, then open **Live** with the
switch on: the ticker shows URLs as they arrive. (Needs `URLHAUS_AUTH_KEY`; check with `npm run threats`.)

## 5. Hindi and Hinglish notes, read by the local model
`npm run demo -- hindi`: four reports with `scam_type` blank. Keyword rules answer at once; Llama 3.2 on this laptop
translates each note and fixes the type when sure (the "ladki ne video call pe… recording" note: rules say digital
arrest, the model says **video call blackmail**). In the app: Help → **Safety checks** → *Try a note*.

## 5b. Amazon impersonation
- Check → example **Fake Amazon order**: Very likely a scam, with "Says an order was placed on your Amazon account and asks
  you to call to cancel it", "international number", and the number flagged "On an outside scam list".
- Type `888-814-2357` → tap **"Written like a US number? Check +1 888-814-2357 instead"** → No reports from our community,
  but "Also listed by: Reddit r/ScamNumbers (unverified)". Say: "outside lists inform, they never label: only 3 unrelated
  people can".
- `+1 206-922-0880` → the spoofing warning: Amazon's real line, often faked as caller ID.
- The synthetic numbers seed-demo prints for the fake Amazon order desk (Known scam, 4 people) and the delivery-OTP caller.

## 6. Disputes
`+91 80 4712 5595` is already disputed: it shows "under review" and can never be Known scam. To file one live: Check
`+91 88192 69826` → **This is my business number** → fill in → **Send**.

## 7. Licence: every request, 403, renew without restart
```bash
npm run sign-licence -- --licensee "Demo Bank" --minutes 2 --upload http://localhost:8080
# wait 2 minutes: the app shows "Licence expired", and:
curl -s "http://localhost:8080/lookup?type=phone&value=1930"         # 403 LICENSE_EXPIRED
npm run sign-licence -- --licensee "Demo Bank" --days 30 --upload http://localhost:8080   # unlocks in ~5 s, data intact
```
Edit the date inside a licence file and upload it → 400 INVALID_SIGNATURE.

## 8. Clock set back (time-travel defence)
- With `DEMO_TIME_TRAVEL=true`: `npm run demo -- clock` → 403 `CLOCK_ROLLBACK_DETECTED`, the app shows the safety lock →
  clock put back → 200, no restart.
- With the real clock: run `npm run demo -- watch` in T2, then Windows **Settings → Time & language → Date & time** →
  turn off *Set time automatically* → **Change** → yesterday. T2 prints `CLOCK_ROLLBACK | lookup 403`. Turn *Set time
  automatically* back on → `VALID | lookup 200`. Stop and restart the server while the date is wrong: still locked.
- `npm run clock` prints the stored mark from `system_metadata`.

## 9. Privacy
Help → **What we store** (live from the database), **Transparency log** (hash chain verified). Show the T1 log: method,
route, status and time only; no numbers, notes or IPs.

## 10. Extras, if asked
Campaigns (kill chain, spread, network), link check (`http://sbi-yono-kyc.top/update` → Visit the link safely),
Partners (paste the bank key), Lost money, Telegram bot, 9 languages + Read aloud.

## 11. Integrations (2 minutes, if asked "how does a bank or police team plug in?")
Before: set the `.env` values (README → Integrations setup), restart, and in two more terminals run
`npm run webhook-receiver` and `npm run integrations -- serve-advisory`.
- Help → **Integrations**: seven green dots. Press **Send test** on each output: the Telegram group, the Slack channel,
  the inbox and the receiver terminal (`signature OK`) all get the `[TEST]` alert.
- `npm run demo -- spoof` (or `npm run live-demo -- --fast`): Slack shows "Blocked in …: accounts rotating through one
  network block" within seconds; the receiver prints Bengaluru reports, area and type only.
- Say: "the config is one YAML file that reloads by itself; every partner gets a signed body with the area only, never
  a reporter or a number". Check `VM-SBIUPD`: **Also listed by: Sample advisory** next to the community verdict.

## Before handing over to the judges' tool
`npm run simulate -- --base <URL> --licence` must print ALL CHECKS PASSED; then `curl -X POST <URL>/admin/reset`.
