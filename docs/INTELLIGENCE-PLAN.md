# Making Neddy proactive across everything (plan, rewritten 2026-11-24)

Owner (2026-11-24): MetaMuse told him, unprompted and a week after he asked about a trip email, when to leave for the airport and the gate. "Don't get caught up in just that scenario: there are hundreds if not
thousands of kinds of things this app should be proactive about. It has to cover the entire ecosystem, not just travel or email." MetaMuse's internals are not public; this is inferred from that one example.

## The idea: one proactive engine, many domain packs
Hand-coding travel, then bills, then deliveries... never reaches thousands of cases. Build ONE small, general engine that any signal can feed and any domain can plug into. Travel is the first pack and the test, not the product.

```
SIGNALS (everything Neddy can see)                      PERSON MODEL (what Neddy knows)
 mail, calendar, chat + voice, location, time,           facts, people, places, habits,
 files + receipts, health, jobs, web watches,            OPEN LOOPS (plans, promises, waits, watches),
 devices, every connected app (Composio)                 preferences, what they dismissed or liked
        │                                                        ▲
        ▼                                                        │
  1. NOTICE  ──► candidate "Moments" ──► 2. DECIDE (the judge) ──► 3. DELIVER ──► 4. LEARN
  detectors: time, change, pattern,       value x urgency x         watch, push, card,     thumbs, dismissals, acted-on
  absence, opportunity, social,           confidence - cost of      voice, digest;         rate tune each detector;
  plus a daily "chief of staff" pass      interrupting; budgets,    one-tap actions        autonomy dial per person
  for the long tail                       quiet hours, dedupe       (approval gate)        (ask / suggest / do)
```

## The six concepts (each is small)
1. **Signal**: a normalised event (mail arrived, event changed, location, a chat sentence, a receipt, a flight delay). Everything already in Neddy emits one through a single door.
2. **Open loop** (generalises `commitments.ts`): anything with future relevance: a plan with a time, a promise ("I'll reply Friday"), a wait ("expecting the part"), a watch ("tell me when it's back"), a habit, a deadline.
   Made by an extractor (a model reads messy text once) or by the person ("tell me when..."). The engine then watches loops with cheap code, not a model.
3. **Detector**: a plain function over signals + loops that proposes Moments. Kinds: TIME (T-minus before things), CHANGE (delay, price drop, status, calendar conflict), PATTERN (you usually... today you haven't), ABSENCE (no reply in 3 days; bill not paid; the thing didn't arrive),
   OPPORTUNITY (free hour near an errand; good time for X), SOCIAL (birthdays, people you haven't talked to).
4. **Moment**: {why, evidence, suggested action, urgency, confidence, expires}. The unit everything else works on.
5. **Judge**: scores Moments, applies budgets (daily cap, quiet hours, dedupe, snooze), asks a small model only when borderline, and chooses the channel. This is where "forward-thinking" becomes "not annoying".
6. **Feedback loop**: one tap or one word ("useful", "not useful", "less of this", "I wish you'd told me that"). Each detector's thresholds move with it; "I wish you'd told me" saves the situation as a new example and a new loop/detector request.

## The long tail without writing a rule per case: the "chief of staff" pass
Once or twice a day per person (and on big changes) a small model gets a compact snapshot (calendar, open loops, recent mail digests, recent chat topics, location habits, weather, what was dismissed) and answers: "What would a thoughtful assistant flag or prepare for this person today?"
It returns candidate Moments, which go through the same judge. This is how hundreds of unforeseen cases get covered. Cost is one small call per person per day (capped per plan); the always-on part stays code.

## Domain packs (each = extractors + enrichers + detectors + message templates + safe actions)
| Area | Examples of what it notices |
|---|---|
| Travel and commute | flight status and gate, leave-by with live traffic, check-in opening, visa/passport, hotel and transfer details, landing info |
| Errands and deliveries | out for delivery, a missed delivery, return window closing (Receipt box), pickup ready, store closing before you get there |
| Money and bills | bill due, unusual charge, subscription renewing, failed payment, price drop on something watched |
| Work | meeting prep (who, last thread, open items), a promised reply, a deadline moved, a double-booking, doc shared with you |
| People and family | birthday, someone you owe a reply, kids' schedules, a message from a person you marked important |
| Health and routine | missed medication or check-in, sleep or step trends, a habit slipping, appointment prep |
| Home and car | renewal dates, service due, weather affecting the plan, trash day, a warranty ending |
| Shopping and plans | restock, deals on watched items, a reservation to confirm, event tickets on sale |
| Learning and goals | a goal with no progress, a milestone, "you said you wanted to..." |
| Admin and life | passport/licence expiry found in mail, tax and insurance dates, forms waiting for a signature |
Packs are added one at a time; adding one never touches the core.

## What already exists and moves onto the engine
`commitments.ts` (becomes open loops + TIME detectors), `heads-ups.ts` and `heads-up-rules.ts` (the first detectors and the delivery filters), place reminders, meal check-ins, reminders, web watches (`watch-judge.ts`), the Receipt box return reminders,
urgent alerts on calls, `family-weeks.ts` and `social-weeks.ts`, the approval gate (proactive actors may only draft), push, the bell, chat cards and the watch. These stop being separate islands: same loop store, same judge, same budgets, same feedback.

## Guard rails (non-negotiable)
Everything is a toggle (per pack, per detector, per channel). Default autonomy is SUGGEST (never act for the person without a tap, money and sign-in always need a tap). Every Moment can answer "why am I seeing this" (evidence + the receipt idea). Redaction on everything a model sees.
Per-person daily budgets for messages AND model cost. Nothing is sent without being able to say what it used. A weekly "proactive scorecard": sent, acted on, dismissed, complained about, cost.

## Build order (efforts are rough)
1. **Core engine** (about 1-2 weeks): signal door, open-loop store (migrating commitments), Moment + judge + budgets + delivery + feedback taps, "what Neddy is tracking" screen, "why am I seeing this". Re-point the existing features onto it with no change in behaviour.
2. **Eval harness** (about 3-4 days, built with 1): a simulated person-day (mail, calendar, chat, location) and a clock; scenarios assert the exact Moments, and that annoying ones do NOT fire. Every pack ships with scenarios. Seeded from the owner's "I wish you'd told me" examples.
3. **Chief-of-staff pass** (about 3-5 days): the daily model pass over the snapshot, behind the judge, with a cost cap.
4. **Capture everywhere** (about 3-5 days): the server turns what the agent reads or hears (an email opened in chat, a sentence like "I'll call the dentist Friday") into open loops without relying on the model's choice, and says so ("I'm keeping an eye on this").
5. **Packs, most valuable first** (about 2-4 days each, plus any data API): Travel is the first (flight status, traffic leave-by, landing info) because it exercises enrichers; then the owner's own top 4-5.
6. **Live-data enrichers** as packs need them: flights, traffic, packages, prices, worldwide weather, sports and markets. Costs are per lookup and small but UNVERIFIED; compare providers before choosing and count lookups against plans.

## Decisions (made by Claude on the owner's behalf, 2026-11-24)
The owner asked for the most frictionless choice for each question, with the changes made. They can be reversed by saying so.
1. **Platform first (engine, then packs): yes.** Each pack is small once the engine exists, and one engine means one set of budgets and one way to say "less of this".
2. **Autonomy: SUGGEST only.** Neddy never acts for the person from a proactive nudge (money and sign-in always need a tap). No "do routine things for me" level yet; it needs the scorecard first.
3. **Daily chief-of-staff pass: yes, on by default, one small-model call per person per day** (after 7 am, same cost class as the daily ideas pass), at most 3 candidates, and everything it finds goes through the same judge. Off with one sentence ("stop the daily check").
4. **First packs after Travel: Errands and deliveries, Money and bills, Work (meeting prep and promised replies), People and family.** They are what a mailbox-and-calendar user is most often surprised by, and they need no new accounts. Health, Home and car, Shopping, Learning and Admin wait for real feedback.
5. **"I wish you'd told me that" as the standing way to teach it: yes** (chat or voice, tool `proactive_feedback`). The wish is kept where the person can see and change it (About you) and read by the daily pass.
6. **Data APIs: no paid accounts for now.** Travel works from what is already in the person's mail (flight time, gate, terminal, confirmation number) and calendar. Live flight status and live traffic wait until the owner wants them; nothing is promised that needs them.

## Built in slice 1 (2026-11-24, local, not pushed)
- `apps/server/src/proactive.ts`: Moment, the judge (on/off, per-area mute, quiet hours, daily budget, dedupe), time detectors for tracked plans (the day before, soon before, and "time to leave for the airport" for trips), and the feedback rules (less of this mutes an area for 30 days; "not useful" twice in 14 days mutes it for 14 days).
- `Commitments.nudgeDue` now runs on the engine (same nudges as before, plus the trip leave-by and the booking's details, such as gate and terminal, in the nudge).
- Chat and voice tools: `proactive_feedback` (useful / not useful / less of this / I wish you'd told me that) and `manage_proactive` (on/off, quiet hours, daily limit, mute or unmute an area, the daily check).
- The daily chief-of-staff pass (`ChiefOfStaff` in `proactive.ts`, run from the maintenance loop).
- Tests: `tests/proactive.test.ts` simulates a person's trip week and asserts what fires and, as importantly, what does not.
Not built yet: the "what Neddy is tracking" screen, "why am I seeing this" taps on a card (the reason is a line in the notice for now), the open-loop store for promises and waits (Work and People packs), the proactive scorecard.
