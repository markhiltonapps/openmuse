# Neddy makes phone calls (plan)

Status: proposal only. Nothing here is built yet. Written 2026-10-10.

## The idea in one line

You say "Book Friday dinner for four at Uchi, between 7 and 8," and Neddy books it online when it
can, or phones the restaurant when it can't, then tells you what happened and puts it on your
calendar.

## What it would feel like

1. **You ask, by voice or in the chat.** "Call Uchi and book Friday for four, 7 to 8. If they
   can't, 6:30 is fine." Neddy repeats what it understood.
2. **Online first.** If the restaurant takes bookings on OpenTable, Neddy books it there (it can
   already open a restaurant's OpenTable page with the date, time and party size filled in). It
   only phones when there's no online booking, or online booking is full.
3. **One OK before it dials.** An Approve card (in the chat, on a call and on Home's Needs you)
   shows:
   - who Neddy will call, and the number;
   - what it may agree to (Friday, 7:00–8:00, or 6:30, four people, your name and mobile);
   - what it must never do (pay a deposit, give card details, agree to anything else).

   You can approve it by tapping or by saying "yes, go ahead" on a call.
4. **The call runs as a job.** Working on (on Home) shows "Calling Uchi…". You can open it to read
   the conversation as it happens, and there's a **Take over** button if you'd rather talk
   yourself.
5. **What happened.** "Booked: Friday 7:15, four people, under Mark. They hold the table 15
   minutes." It comes with an Approve card to add it to your calendar. If they wanted a deposit or
   asked something outside the brief, Neddy says so politely, ends the call and asks you.

## What already exists

- **Talking live** (OpenAI's live voice), including Neddy handing a question to the chat agent
  mid-call and reading back answers.
- **Background jobs** that run steps, stop for approvals and report results.
- **Approve cards** that work in the chat, on calls and on Home, and approving by voice. Money and
  sign-in codes still need a tap.
- **OpenTable links** with the booking details filled in, and Neddy's own browser for websites.
- **Calendar events** through an Approve card.

## What's new

1. **A phone line.** An account with a calling service (Twilio or Telnyx) and a phone number.
   The server places the call and passes its sound back and forth.
2. **Connecting the phone line to Neddy's voice.** Today the live voice runs between your browser
   and OpenAI. For a phone call, the server connects the phone line to the voice model instead.
   OpenAI's live voice service has supported phone calls (SIP) since 2025; the first slice
   confirms that for the model we use, or falls back to streaming the call's audio through our
   server.
3. **A caller mode for Neddy.** Separate instructions for talking to a stranger on your behalf:
   - say at the start that it's an AI assistant calling for you;
   - stick to the brief, and never invent details it wasn't given;
   - handle phone menus ("press 2 for reservations") by sending key tones;
   - wait on hold, up to a limit;
   - recognise voicemail and either leave a short message or hang up (your choice);
   - read back what was agreed before hanging up ("So that's Friday at 7:15 for four under Mark,
     is that right?").
4. **The call as a job,** with its own Approve card, a live transcript, Take over, and a result
   card.
5. **Finding the number.** From a business lookup (Google Places) or a web search. You see the
   number on the Approve card before anything is dialled.
6. **Help and the app guide** get a "Neddy can make calls" topic, so you can ask how it works.

## Guardrails

- **Always says it's an AI**, in the first sentence of every call.
- **Only calls businesses,** and only after your OK. No calls to private people at first.
- **Money never by voice.** No deposits, card numbers or payment links over the phone. Neddy comes
  back to you instead.
- **A time limit.** Hangs up after, say, 15 minutes in total or 10 minutes on hold, and reports
  back.
- **One call at a time,** and no calling the same place twice in an hour without asking you.
- **No surprises on your bill.** A spending limit per call and per month, shown on the admin
  usage card next to the AI costs.

## Legal and compliance (to check before others use it)

- **Saying it's an AI.** In 2024 the FCC ruled that AI-generated voices count as "artificial
  voices" under US calling law (the TCPA). The strictest rules are about calls to consumers and
  telemarketing. A one-off call to a business to book a table is a different case, but a quick
  check with a lawyer is worth it before other people use the feature.
- **Recording.** Some states (including California and Florida) need everyone on a call to agree
  before it's recorded. Simplest: keep only the written transcript and no audio, or have Neddy
  say "this call may be recorded."
- **Caller ID.** Calls from new numbers are often marked "Spam likely". The number needs to be
  registered with the calling service (its business profile and call verification). Calls could
  also show your own mobile number once it's verified.

## Rough costs (estimates to confirm)

- **Phone number:** about $1–2 a month.
- **Calling:** about 1–2¢ a minute in the US.
- **Voice model:** most of the cost. Charged per minute of talking and listening, somewhere from
  a few cents to tens of cents a minute depending on the model. A typical booking call is 2–4
  minutes, so roughly well under a dollar, but a long hold adds up. The time limit keeps it in
  check.

## In slices

**Slice 0: spike (about a day).** Prove the plumbing before building screens.
- Set up a phone number and the calling service on a test account.
- Neddy calls your own phone with a scripted brief; you play the restaurant.
- Confirm the voice model connects over the phone line, the transcript reaches the server, key
  tones work for menus, and voicemail is recognised.
- Measure the delay, sound quality and cost per minute.
- Done when: a 3-minute test call to your phone works end to end and the costs are known.

**Slice 1: a booking call, start to finish.**
- The "phone a business" step for jobs, with its Approve card (who, number, the brief, the limits).
- Caller mode instructions, with the read-back before hanging up.
- Result card and an Approve card for the calendar.
- Online first: try OpenTable before calling.
- Live transcript on the job's page and in Working on.
- Help topic and app guide line.
- Done when: you can say "book Friday dinner at …" and get a booked table, or a clear "they're
  full, want 6:30 instead?"

**Slice 2: listen in and take over.**
- Listen to the call live from the app, and a **Take over** button that hands the call to your
  phone or the app.
- Done when: you can step in halfway through a call without it dropping.

**Slice 3: when they call back.**
- Calls and texts to Neddy's number ("we can do 7:30 instead") reach the right job.
- Neddy answers and handles it, or tells you.
- Done when: a callback updates the right booking and you hear about it.

**Slice 4: other kinds of calls.**
- Appointments (haircut, dentist), simple questions ("are you open on Monday?", "do you have …
  in stock?").
- Each new kind gets its own brief and limits.

## How it would be built (for whoever builds it)

- **New pieces:**
  - a phone-calls service in `apps/server/src`, next to `voice-live.ts`, reusing its session
    set-up and transcript handling;
  - webhook routes for the calling service (call started, answered, ended, menu tones);
  - a "phone_call" job step with its own Approve card, matched by what it does (business +
    number + brief), never by its wording;
  - caller-mode instructions that are separate from VOICE_RULES.
- **App:**
  - the live transcript and Take over on the job page;
  - "Calling …" in Working on;
  - the result card in the chat and on calls.
- **Railway variables:** the calling service's account keys and the phone number. The owner adds
  them in Railway, then chooses Deploy on the banner (variables do nothing until then).
- **Testing:**
  - api.openai.com and the calling service are blocked in the sandbox, so tests use a fake call
    and a fake voice socket, as the live voice tests do;
  - real test calls go to your own phone first, with your OK each time (they cost money).
- **Following the project's rules:**
  - check each request field's type against the provider's SDK types;
  - log the provider's own error reasons (never keys);
  - Help is updated in the same commit;
  - the new screens go through the Design division.

## Decisions needed from you

1. **Calling service:** Twilio (best known, most examples) or Telnyx (usually cheaper)? I'd start
   with Twilio for Slice 0.
2. **Caller ID:** a new number for Neddy, or calls that show your own mobile?
3. **Recording:** transcript only (no audio), or record with an announcement?
4. **Limits:** how much per call and per month, and how long on hold before giving up?
5. **Voicemail:** leave a short message ("This is Neddy, an assistant calling for Mark about a
   table on Friday; I'll try again later") or just hang up?
6. **Who can use it:** only you at first, or everyone with an account?
7. **Voice credit:** the OpenAI account needs credit before any of this can be tested; it's
   currently out.

## Risks and unknowns

- **People hanging up on a robot.** Some will. The opening line matters, and so does online
  booking first.
- **Noisy lines, accents, long holds.** It'll work most of the time, not every time. The result
  card has to be honest when it doesn't.
- **The voice model over a phone line.** Sound quality and delay are unknown until Slice 0.
- **Rules can change.** The legal check should be repeated before the feature is opened to other
  people.
