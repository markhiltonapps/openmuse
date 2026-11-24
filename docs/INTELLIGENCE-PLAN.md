# Making Neddy more forward-thinking (plan, 2026-11-24)

Why: the owner uses MetaMuse more than Neddy because it speaks first. Example: he asked it to check an email from his partner with the Cambodia trip itinerary. A week later,
unprompted, it said "leave about 7:15 to make it to the airport" and already had the gate. MetaMuse's internals are not public; the pattern below is inferred from that one example.

## The pattern behind the example
ASK ONCE -> SAVED AS A STRUCTURED TRIP (flight, time, airport, reference) -> LATER, A SCHEDULER ENRICHES IT WITH LIVE DATA (flight status and gate, traffic from where you are)
-> IT SPEAKS UP AT THE RIGHT MOMENTS, UNSOLICITED. Three layers: **Capture**, **Enrich**, **Act**.

## What Neddy already has (checked in the code, 2026-11-24)
- `commitments.ts`: reservation, delivery, trip, appointment, bill, event; tracked from chat (`track_commitment`) or from new email (`engine/service.ts` ~line 1111: a keyword filter `looksLikeConfirmation`,
  then one small-model call); de-duplicated by confirmation reference; two generic nudges ("day" and "soon", 2 h before); closed a day after.
- Heads-ups (`heads-ups.ts`, `heads-up-rules.ts`): calendar rules, leave-by using the person's usual travel time or a rough car estimate ("no live traffic"), push + bell + chat card + watch.
- Urgent alerts on a call, place reminders, location while the app is open, mail alerts (Composio webhook), jobs, About-you facts, Receipt box, the ESP32 watch.

## Why Neddy did not do the Cambodia thing
1. **Capture is fragile.** An email the person asks about in chat is tracked only if the model chooses to call `track_commitment`. The automatic path sees only mail that arrives after the mail watch is on,
   and only if the subject/preview match the keyword filter. An itinerary forwarded by a person ("from Amanda") may match nothing.
2. **One email = one commitment with one time.** A real itinerary has several legs (outbound, return, hotel, transfers).
3. **No live data:** no flight status, gate, terminal or delay; no real traffic; no weather at the destination.
4. **Generic, few nudges:** "Coming up: Flight..." the day before and 2 h before. Nothing like "leave by 7:15", "check-in is open", "gate changed", "you've landed: here's your hotel".
5. **Silent tracking.** Neddy never says "I noticed this and I'm tracking it", so there is no trust and no feedback.

## Plan, in order of impact per effort (efforts are rough)
**Phase A, capture everything (a few days).**
- A1. Whenever the agent reads an email in chat (Gmail/Outlook read results), the SERVER runs the extractor on it (not the model's choice) and says "I'm tracking your flight to Phnom Penh on Dec 3".
- A2. Trips as containers: one email can yield several linked legs (flight out, flight back, hotel, transfer); dedupe by reference (exists).
- A3. Better filter: a cheap two-stage check instead of one keyword list; a one-time, capped backfill of the last 30 days of mail after the person turns it on (opt-in); calendar events as a second source.
- A4. "Track this" / "what's on for Cambodia?" by voice and chat.

**Phase B, enrich with live data (about a week plus accounts and keys).**
- B1. Flight status (gate, terminal, delay, cancellation): a flight-data API, polled adaptively (a few times a day far out, every ~15 min in the last 3 h). Needs flight number + date from the extractor.
- B2. Real travel time with live traffic (a routing API) from where the person is, or home when we don't know. Leave-by = departure - airport buffer (about 2 h domestic, 3 h international) - drive - parking, recomputed as traffic changes.
- B3. Weather at the destination (worldwide source; NWS is US-only). B4. Package tracking and delivery windows.
- Costs are per lookup and small (roughly a cent or less each; about 10-20 lookups per trip) but UNVERIFIED: compare providers' real prices and free tiers before choosing, and count lookups against plans.

**Phase C, the "moments" engine (about a week).** Per kind, a timeline of rule-based moments with templates (a small model only for wording), delivered by push, watch, chat card, and spoken on a call:
- Flight: 48 h "check-in opens tomorrow" (link); 24 h check-in, weather, passport/visa reminder (international); ~3-4 h "leave by 7:15, traffic adds 12 min"; 2 h gate and terminal; gate change; delay or cancellation with options;
  landing "welcome, your hotel is at..., transfer...".
- Hotel (check-in time, address), reservation (leave-by), delivery (out for delivery, arriving today), bill (due in 3 days with amount), appointment (leave-by, forms).
- Guard rails: quiet hours, daily cap, dedupe, snooze, "stop tracking this", per-moment toggles (everything is a toggle).

**Phase D, anticipation beyond travel (ongoing).** Conflicts and tight connections; follow-ups ("you told Dana you'd reply by Friday"); important mail unanswered; renewals and expiries found in mail (passport, registration);
bills and subscriptions tied to the Receipt box; birthdays; a smarter morning brief and a "week ahead"; proactive drafts that wait for approval (the approval gate already forces review for proactive actors).

**Phase E, trust and control (built alongside).** A visible "What Neddy is tracking" list with Stop; "why am I seeing this" (uses the receipts idea); the first time per kind, ask once ("I found a flight in your mail: track flights like this automatically?");
redaction on everything that reaches a model; cost caps per person; thumbs up/down on each proactive message to tune rules.

## First slice ("Cambodia in a box", about 1-2 weeks)
A1 + A2 + B1 + B2 + the flight moments from C. It reproduces the example end to end. Golden test: a fixture itinerary email goes in; with a simulated clock the tests expect the exact messages at the exact times.

## Decisions needed from the owner
1. Build order A -> B -> C with travel as the first scenario?
2. OK to add two paid data APIs (flight status, traffic routing)? The owner creates the accounts and adds the keys as Railway variables (and presses Deploy).
3. Mail scanning: track what the person asks about and new confirmations automatically, but make the 30-day backfill opt-in? (Recommended.)
4. Home address and airport buffers: ask once and save in About you.
5. Delivery: push, watch and chat card now; SMS later (needs a business registration).
