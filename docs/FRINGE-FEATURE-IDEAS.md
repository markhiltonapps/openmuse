# Fringe feature ideas for Neddy (researched 2026-10-23)

Four research passes (about 150 searches and page reads) looked for unusual features that real products or
projects have shipped or demoed, then asked what we could build on the pieces we already have. Evidence is
mostly vendor pages, app-store listings, Product Hunt and a few Hacker News threads; Reddit was mostly out of
reach. **Costs and effort are estimates, not measurements.** Anything marked (unverified) rests on one weak source.

## The short list (strongest signal first)

Ideas that two or more of the four passes found on their own are marked **x2** or **x3**.

| # | Idea | What the person gets | Built on | Effort | Running cost |
|---|---|---|---|---|---|
| 1 | **"Tell me only if…" watches** (x3) | Say "tell me when the medium is back" or "if it drops under $50". Neddy checks the page on a schedule and speaks up only on a real change. | routines + agent browser + push; cheap text compare, the model reads the page only when it changed | about 1 day | under 1¢ a check, about 15¢ when something changed |
| 2 | **"What Neddy used" receipts** | A chip under each answer: the saved facts and mail it used, "2 card numbers hidden", and a Forget button on each fact. | the redaction guards already know what they hid; log it per turn | 2–3 days | about nothing |
| 3 | **Walk-and-talk brain dump** (x2) | Ramble for a minute or two; it comes back as reminders, notes, tasks and facts, each as an approval card. | meeting recorder + Soniox + one Haiku pass | about 2 days | about 2¢ for 5 minutes |
| 4 | **Rehearse a hard conversation** (x2) | Neddy plays the landlord, boss or cable company by voice, then scores you (filler words, pace, three tips). Also interview and language practice. | call pipeline, another voice, notes pass | 1–2 days | about 8¢ a 5-minute session (cap per plan) |
| 5 | **Drifting-friend nudges** | Once a day: "You haven't talked to Dana in 6 weeks", with a ready opener. "Last contact" is read from mail, calendar and meetings, not typed in. | People notes + Gmail/Calendar via Composio + meetings | about 1.5 days | under 1¢ per person a month |
| 6 | **"Is this a scam?" checker** (x2) | Forward a text, email or screenshot; the sandbox browser opens the link, not you; plain verdict card. Good for parents. | agent browser + redaction + family dashboard | 1–2 days | 2–15¢ a check |
| 7 | **Commute briefing by voice** | Tap a home-screen link and Neddy reads Needs action / FYI and offers replies while you walk or drive. | call pipeline + the existing answer layout | about 1 day | about 1.6¢ a minute |
| 8 | **Decision journal + letter from your past self** | "I decided to…" is spotted; weeks later it asks "would you make this call again?" and hands back your own words. | chat/meeting detection + reminders + approved memory | 1–2 days | pennies |
| 9 | **"Reply CANCEL" for forgotten trials** | Before a trial bills, a push asks "cancel?"; yes starts the cancel job (you take over at sign-in). | Find my subscriptions + routines + browser + vault | about 2 days | about 15¢ a cancel |
| 10 | **Neddy calls you** | For urgent things the alert opens the call screen with Neddy already speaking. (Real phone version needs Twilio: 4–6 days.) | heads-ups/jobs as triggers + calls | 1–2 days | normal call cost |

## More ideas, by theme

**Agent browser and jobs**
- Appointment-slot watcher that books only after you approve (DMV, visa, vet). Seen: us-visa-bot, ncdmv-reservation. Government sites ban fast polling: poll slowly, hand CAPTCHAs to the person.
- Post-purchase price-drop refunds: read receipts, recheck during the store's adjustment window, draft the request. Seen: Paribus, Earny (windows 10–30 days). Amazon has no price guarantee.
- "Money you're owed": match purchases to open class-action settlements, unclaimed property. Seen: Class Action Finder, Settlemate. Thin demand evidence; verify the case against court records; claim services take a cut. Show estimates only.
- Insurance-denial appeal drafter (Counterforce Health is nonprofit and free). Health data: draft only, plain disclaimer, no promised outcomes. DoNotPay paid the FTC $193,000 over "robot lawyer" claims.
- Campsite/restaurant cancellation alerts (alert only, never auto-book; New York 2024 law targets resellers).
- Fare and hotel threshold tracker (a variant of idea 1).
- Teach by showing: record your own takeover in the browser, save it as a routine with fill-in fields, AI repairs a step only when it breaks. Seen: browser-use/workflow-use. 4–6 days; early-stage elsewhere.

**Voice and ambient**
- Quiet mode for public places (mic gain up, voice reply off, captions and cards only). Check Soniox on whispers before promising. About 1 day.
- Daily check-in for a parent: a "Mom's page" with one big Talk button and a daily push, summary to the family dashboard, a missed check-in pings you. 3–4 days, about $2.40 a month per person. Contested: one reviewer called an AI that calls parents "dystopian".
- Ambient capture only with consent: a "Record this talk" button that reads a consent line and has a pause. Not always-on. Wiretap-law risk is rising (Amazon Bee, Limitless/Meta).
- Voice flashcards from your own meetings (spaced repetition). Only one real user found.
- Agent phones businesses for you: Google ships "agentic calling". Do the web version first; phone needs Twilio into the voice pipeline, an AI-disclosure line, script approval. A stretch (1–2 weeks).

**Memory, life and trust**
- Receipt and warranty vault that fills itself from mail, with 30/7/1-day expiry alerts and a claim pack. Value is the alert and the claim pack, not storage.
- Promise ledger that closes itself when you reply, shows "owed to me", and saves nudges as drafts, never sends. Under 1 day (we already track commitments).
- Mood and energy: one tap a day, a weekly plain-statistics comparison with workouts, meals and calendar load. Keep wording non-clinical.
- Overnight "dreaming": merge duplicate facts and ask "still true?". Gate it on changed facts: unbounded runs burn budget.
- A morning briefing you steer by replying. Cautionary tale: Poke's date and time-zone mistakes.
- Emergency handoff ("if something happens to me"): a page or key-split bundle for trusted people if you stop checking in. Strong interest (HN: 84 points/105 comments, ReMemory 402/233) but needs careful key design and a security review: 3–5 days.
- A paste-able memory pack: export About-you facts and People notes as text for any assistant. Half a day.
- Earned-trust approvals ("allow this exact kind of thing for 30 days, up to $X"). We already have "always allow" and "one OK per job".

## Skip or later
- Emotion-aware voice (Hume EVI is developer-only, value unproven).
- Sound-event awareness (a browser tab can't do it reliably).
- "When I get to the store" geofence reminders (a web app can't geofence in the background; unverified). Calendar-place heads-ups are the cheap substitute.
- Data-broker opt-outs: California's DROP is a single consumer filing from Aug 1, 2026 that third parties can't use directly. A link and a 45-day reminder is the safe product.

## Risks the research kept raising
- Scraping and terms of service: government and retail sites block headless Chrome and ban fast polling. Alert, don't auto-act, wherever a site's terms say no.
- Legal claims: the Ninth Circuit vacated Amazon's injunction against Perplexity's shopping agent in August 2026 (the user, not the agent, is accessing the site); the ruling is narrow and the case continues (reported; the opinion was not read).
- Health, legal and money advice: drafts only, plain disclaimers, never promise outcomes.
- Recording people: consent line, visible indicator, pause.

## Best fit for what Neddy already is
1. **Receipts** (2) and **watches** (1) lean on redaction, the agent browser and routines: they make "private by default" and "does things for you" visible.
2. **Brain dump** (3), **rehearsal** (4) and **commute** (7) reuse the call and meeting pipelines for little new code.
3. **Drifting friends** (5) and **scam checker** (6) are cheap and good for the family dashboard.
