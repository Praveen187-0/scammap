# ScamMap pitch (3 minutes) and judge Q&A

## The 3-minute pitch

**0:00, the problem (20 s).**
Ravi's father lost ₹2 lakh to a "digital arrest" video call. The next day the same number called Priya across the city,
and she had no way to check it. ScamMap is the place to ask: *has anyone reported this number, UPI ID or link?*

**0:20, licence first (10 s).** *(Start the 5-minute licence now, so it expires while you present.)*
"This server is licensed to Demo Bank. I've just installed a licence that expires in five minutes. We'll come back to it."

**0:30, report in seconds (35 s).** On a phone, Hindi on: paste the whole SMS. The app finds the number, suggests
"बिजली कटने का SMS", the channel and time are pre-filled, the area is remembered. Tap रिपोर्ट करें.
"**Nine seconds.** No login. We store the area, never the person."

**1:05, check before you trust (25 s).** Paste a number from the digital-arrest wave: **Known scam, reported by 5 people
near you**, with what to do and a Call 1930 button. Then paste the *whole* fake-police message: risk 86, every red flag
named, the number inside it found and looked up, and Gemini's reading in English and Hindi, sent with numbers removed.
"Lookups take about 15 milliseconds."

**1:30, the hard half: fake reports (45 s).**
"Counting reports is easy to game. **We count people, not reports.**" Show the bombed sweet shop: 30 copy-paste reports in
40 minutes → **one person, so nothing is shown**. Tap **See how the reports were counted**: the dots on the timeline fly
into a single grey bubble labelled *copy-paste*. "That's the whole trust engine, on one screen." "22 accounts on one Wi-Fi are one person. One person
reporting six times is one person. Junk like 12345 is rejected. But a real wave of unrelated people writing in their own
words still comes back **Known scam**, and lights up the map." Show the alert: "**Scam reports in HSR Layout jumped:
8 in the last 24 hours, none in the week before.**" "And the bakery that was bombed? **No alert.** Fakes never set off alerts."
"Fakes are **quarantined, never deleted**: if real victims show up, the verdict updates."

*(If asked about spoofing: `npm run demo -- spoof`: "one laptop cycling ten fake network prefixes is still one person:
we group by /16 block in a 5-minute sliding window. Three real people elsewhere still confirm it.")*

**2:15, privacy and grudges (15 s).** "Anyone can type their ex's number. So **one report shows nothing at all**. Two
unrelated people: Suspicious, number masked. Three: Known scam. Three 'my ex owes me money' reports? Still nothing."
Flash the Insights screen: "84 fake reports set aside this week, and why."

**2:30, the licence lock (20 s).** Check a number: lock screen, "Licence expired. Contact your provider." in English and
Hindi; `curl` shows 403. Upload the 30-day licence from the laptop: the app unlocks by itself within 10 seconds, all data still there.
"The private key never leaves this laptop. Edit the date and the signature fails. Set the server clock back a year and it refuses."

**Bonus round, if the judges ask "what else?" (pick two, 15 s each):**
- *Link check:* paste `sbi-yono-kyc.top/update` → **Visit the link safely** → *Proven phishing*: "the look-alike name is
  confirmed live: the page asks for password, OTP and card, and posts them to another site."
- *Campaigns:* the fake-KYC campaign: SMS sender + link + number + UPI ID joined from pasted messages, its kill chain,
  and how it spread Bengaluru → Pune → Hyderabad. The network graph shows it beside two other campaigns.
- *Partners:* paste the bank's key: every report touching SBI look-alikes and SBI senders, live, with signed webhooks;
  "dashboards read hourly rollups; on a laptop, `npm run load-test` did 2,500 requests a second with lookups at p95 31 ms."
- *Lost money:* the first-hour plan with a complaint text and a bank letter, generated on the phone.
- *Telegram:* forward the scam SMS to the bot, get the verdict back in Hindi.

*(Optional, if time allows: open **Live** with `npm run live-demo` running: reports ping on the map, an attack is caught
in the feed, "Whitefield: alert level in about 4 h at this pace".)*

**Bonus: Hindi notes and time travel (if time allows, 20 s each).**
- `npm run demo -- hindi`: a Hinglish note with the type left blank, *"ladki ne video call pe… recording bhej dungi"*.
  Keyword rules guess digital arrest; the local Llama 3.2 model on this laptop reads it as **video call blackmail** and
  re-labels the report. "The note never left this laptop and was never stored."
- `npm run demo -- clock` (or change the Windows date with `npm run demo -- watch` running): every call returns
  `CLOCK_ROLLBACK_DETECTED`, the app shows the safety lock; put the clock back and it unlocks by itself.

**2:50, close (10 s).** "Report in seconds. Check in milliseconds. Fakes counted once. ScamMap."

## Live licence demo script

```bash
# before you start talking
npm run sign-licence -- --licensee "Demo Bank" --minutes 5 --upload https://<server>
# show
curl -s https://<server>/license
# ~5 minutes later
curl -s "https://<server>/lookup?type=phone&value=1930"         # 403 LICENSE_EXPIRED
# renew
npm run sign-licence -- --licensee "Demo Bank" --days 30 --upload https://<server>
```

## 18 questions judges are likely to ask

1. **Why wasn't the fake-reported bakery labelled a scam?**
   Forty reports collapsed into one voice: their notes were copies, and they arrived as a dense burst where almost nobody
   wrote a first-hand note. The `explain` field on every lookup lists the flags. Known scam needs three *unrelated* people.

2. **A real scam wave also arrives as a burst. How do you avoid missing it?**
   Bursts alone don't matter. A burst is set aside only if its notes contain very few different texts (40 friends share one
   to three) or most reports came from the same few networks. Real waves are unrelated people telling their own stories.
   `npm run bench-trust` shows real waves, even ones that reuse stock sentences, are labelled correctly 99%+ of the time,
   while every bombing pattern is stopped.

3. **Many Indians share mobile IPs. Don't you merge real victims?**
   Only on the same identifier within 24 hours, and at worst they count as one person, which only makes us slower to say
   Known scam. We never block or rate-limit by IP; rate limits are per reporter.

4. **Can a scammer dispute their own number to escape?**
   The brief requires a disputed number never to show Known scam while under review, and we follow it. But the lookup still
   says "Reported by N people", shows the warning and the advice, so users stay protected. Disputes with many independent
   reporters would be reviewed first.

5. **What stops someone deleting browser storage to get a new reporter id?**
   Nothing, and that's fine: a new id is a new *account*, not a new *person*. Network merging, copy-paste detection, bursts
   and the campaign rule all work across accounts, and new accounts carry lower weight.

6. **What exactly do you store about a reporter?**
   A keyed hash of their device id and of their network prefix (cleared after 30 days), the area code, times, channel and
   scam type. No name, number, coordinates or note text, only a fingerprint of the note to spot copies.

7. **How is the licence protected against editing or clock tricks?**
   Ed25519 signature over the canonical JSON; the public key is compiled in, the private key stays on the owner's laptop.
   The server saves the latest time it has ever seen; a clock more than 2 minutes behind it locks the server, even after restart.

8. **Why is the lookup fast?**
   Each new report recomputes that identifier's verdict once and stores it; a lookup is one in-memory read (or one
   primary-key read). The server runs in Singapore, the closest region to India. p99 in our test: under 60 ms.

9. **Did you hardcode anything for the test?**
   No identifier is special-cased. The only fixed lists are the ones in the brief: the 25 areas and the verified numbers.
   Every rule is in `src/trust/config.ts` and runs the same way for every number.

10. **What if someone reports my personal number out of spite?**
    One report never shows anything: the number still reads "No reports", with no type, dates or evidence. It takes a
    second *unrelated* person (different device, different network, own words) to reach Suspicious, and the number stays
    masked until three. Grudge phrasing ("my ex", "owes me money", "मेरा एक्स") is recognised and never counts towards a
    label, and the owner can dispute from the result card.

11. **What does Gemini decide?**
    Nothing about the community verdict. It reads a pasted message (with numbers, UPI IDs and email names replaced first)
    and explains the red flags in English and Hindi; the score blends it 60/40 with our offline rules, which work without
    it. It also writes the Insights headline from the aggregated numbers. Known scam only ever comes from people.

12. **What do the datasets add?**
    Two public datasets live in PostgreSQL. 520 labelled scam/ham messages train a small text model (91.9% accuracy in
    5-fold cross-validation) and give "this reads like these known scam messages" evidence; it only gets a say when it
    recognises the text. 284,807 real anonymised card transactions train a fraud model tested on the latest 25% it never
    saw (100% precision, 66% recall); the Live screen replays it in real time. Neither is mixed into community reports.

13. **Is the live link check safe? Couldn't someone use it to attack your network?**
    It refuses private and local addresses after resolving DNS, pins the connection to the address it checked (no DNS
    rebinding), allows only ports 80/443, at most 5 redirects, 1 MB and 8 s, sends no cookies, never runs scripts or
    submits forms, strips query strings, and is rate-limited per network.

14. **How do campaigns avoid joining unrelated numbers?**
    Only strong links join: identifiers pasted in the same message, or links on the same server. Similar wording is shown in
    the graph but never merges campaigns, because victims of the same kind of scam describe it alike. Only identifiers that
    2+ unrelated people reported are used, so one person can't build a fake campaign.

15. **Can a bank or the police see who reported?**
    No. Partners get the same masked view as everyone (full value only after 3 unrelated people), the area and scam type.
    Their key is stored only as a hash. The public transparency log hashes identifiers too.

16. **What if the judges set the server clock back?**
    The latest time the server has seen is stored in `system_metadata` every 2 seconds and only ever raised (one atomic
    GREATEST). A clock behind it by more than 2 minutes locks every API call with `CLOCK_ROLLBACK_DETECTED`, even after a
    restart; the database server's clock is a second witness. Request timestamps can only confirm the mark, never push it
    ahead, so nobody can lock us out with a future-dated request.

17. **One machine sending reports with rotating ip_prefix values?**
    Addresses count by /24. Same /16 block, 3+ different /24s from 3+ accounts, each within 5 minutes of the previous
    one, is one person. We measured it: a 12-account rotation fooled the engine 100% of the time before, about 1% now,
    with no extra false merges for real victims on big carrier blocks.

18. **What would you add with more time?**
    A moderator queue for disputes and quarantined bursts, a WhatsApp Business bot on the same code as the Telegram bot,
    and the official 1930 and Sanchar Saathi feeds as low-weight corroboration through the connectors file.
