# Neddy: proactive heads-ups, approval gate and redaction (plan, 2026-10-22)

Status: a plan, nothing built. Written from a read of the code on branch
`claude/deploy-openmuse-repo-oza7s9` at `9b5cd65`. The "Claude Duet" details come from the
owner's overview and were not checked against Anthropic's own words.

Owner's decisions so far (2026-10-22):

- Heads-ups are **on for everyone** and can be turned off.
- Travel: no maps in v1. Neddy uses **common sense** (an appointment away from the desk needs
  travel before a call or desk meeting). A maps lookup can come later.
- Calendars: Google first, Outlook ready. Reads go through Composio, so the plan must respect its
  limits.
- Delivery: look at everything: push, the bell, inline in the chat, email now, text later. A native
  iPhone app is wanted eventually.

---

## Phase 1: what the code does today

### Always-on and proactive

| Piece | Where | How it runs | Weakness for "always-on" |
|---|---|---|---|
| Maintenance loop | `engine/service.ts` `maintain()` (line ~226), every 60 s under a database lease | Runs ~15 jobs **one after another** | One slow step (a calendar read) delays all the others; no per-feature time budget or back-off |
| Reminders that follow calendar events | `reminders.ts` `followEvents`, called every 15 min | **One calendar read per linked reminder** (±7 days each) | Cost grows with reminders, not with people; should be one read per person |
| Commitments nudges | `commitments.ts` `nudgeDue` | Day-before and "soon" nudges | Fine, but has its own nudge/dedupe/quiet-hours handling |
| Meal check-ins, feed refresh | `meal-checkins.ts`, `feed.ts` | Same loop | Each feature decides its own timing |
| New-mail alerts | `mail-alerts.ts` | Composio **webhook triggers** (push, not polling) | Good pattern; none exists for calendar |
| Routines | `engine/routines.ts`, `runDueRoutines` | A scheduled **full AI job** | Costly for simple checks; right for the morning brief |
| Notifications | `service.notify()` (line ~1557), `push.ts` | `insertIfAbsent` by key, then web push | No channel choice, no quiet hours, no daily cap, no urgency |
| Quiet hours | `persona.ts` key `prefs.quietHours` | Saved on About you | **Never read by anything** (task #108 is still open) |

State is durable (records in the Store), so a restart loses nothing. The gap is not the loop, it
is that there is no shared "signal → rule → deliver" path: every feature reinvents it.

### Approvals (human in the loop)

Strong already. The design is: nothing changes anything without a stored proposal.

- `actions.ts` `ActionService.propose` stores a proposal with a **hash of exactly what it will do**,
  `expiresAt` 30 minutes, an idempotency key, and the target's version (calendar edits).
- `decide` needs the matching hash, still-valid expiry, a live connection for Google, an
  `authorize` hook (spending limits, sign-in code format), then `db.claim` (compare-and-swap) so it
  runs **once**; failures can end as `outcome_unknown` instead of retrying a send.
- There is **no tool the model can call to approve** (the prompts say so; `approve_by_voice` checks
  the person's own transcript after a server-written read-back).
- Cards appear in chat, on calls and in Activity. Purchases always ask; destructive actions never
  run on an app-wide "always allow" rule (`approval-rules.ts` `destructiveAction`); apps can be
  read-only.
- Unknown verbs fail closed: `apps.ts` `readOnlyAction` only skips review for a clear read verb or a
  `readOnlyHint`.

Gaps against a strict gate:

1. **Sending is not treated like deleting.** An app-wide "allow Gmail actions" rule lets
   `GMAIL_SEND_EMAIL` run unattended. External messaging should need its own per-action rule, as
   destructive actions do.
2. **The decision is scattered** in four places (`apps.ts` use_app, `engine/model.ts:588` jobs,
   `engine/conversation.ts:1036` chat, `ApprovalRules.allows`). One function should decide.
3. **No notion of who is asking** (live person, voice, background job, proactive). A proactive
   heads-up must never run anything; today nothing forces that.
4. **30-minute expiry** is too short for a draft Neddy prepares while the person is away.
5. **No test that proves the invariant** ("no non-read tool runs without a proposal").

### Sensitive data

- Saved passwords and codes never reach the model (`sign-in-tools.ts` `typedSecret`; the vault in
  `packages/integrations/src/vault.ts` is AES-256-GCM). Good.
- Everything else is **instructions only**: the persona prompt says "never save account numbers,
  passwords…". There is **no code that finds or removes** a card number, SSN, key or password in
  text before it reaches the model. Email bodies, connector output (`apps.ts` `bounded()`), file
  text, web pages and the person's own typing all go through as they are.

---

## Phase 2.1: proactive Heads-ups (build first)

Goal: Neddy watches the day and speaks first, at near-zero cost.

### Design in one picture

```
calendar (Composio, one read per person)  ─┐
commitments / reminders                   ─┼─> signals ─> rules (pure code, no AI)
mail alerts (webhook)                     ─┘                    │
                                                                 v
                          filters: settings, quiet hours, snooze, daily cap, dedupe
                                                                 │
                                                                 v
        deliver by urgency: push · bell · chat card · (digest email) · (text later)
```

- **No AI per check.** Rules are plain functions; messages are templates. AI is used once a day for
  the morning digest (worker model) and only when the person is on a plan that allows it.
- **One calendar read per person per tick**, shared by Heads-ups, reminders-follow-events and the
  Feed (`calendar-today.ts` already caches 10 minutes). Replace the per-reminder reads.
- **Adaptive polling:** per person store `nextCheckAt` = the sooner of 15 min and (next event − lead
  time); sleep (quiet hours) and "no calendar connected" cost nothing.
- **Webhook later:** Composio calendar triggers (like `mail-alerts.ts`) mark a person "dirty" so a
  change is seen in seconds and the poll can drop to every 30–60 min.
- **Back-off:** on a rate limit (`apps.ts` already retries 3×) or an expired sign-in, back off for
  that person (15 → 30 → 60 min), say "reconnect Google" **once**, never loop.

### Common-sense travel (the dentist example)

No maps. Each event gets a **place kind**:

| Kind | How it's decided | Travel needed |
|---|---|---|
| `online` | link in location/description (zoom.us, meet.google.com, teams…) or words like "call", "zoom", "standup" | none |
| `away` | has a physical location, or title words (dentist, doctor, haircut, lunch, pickup, gym, flight, interview…), or is a tracked appointment/reservation | yes |
| `desk` | everything else | none |

Rule `leaveBy`: for an `away` event followed by an `online`/`desk` event:

- gap ≥ buffer → "Dentist ends 2:00. Zoom with Dana at 2:30. Leave by 2:05." (buffer = the person's
  usual travel time, default 30 min)
- gap < buffer → "Tight: dentist ends 2:00 and you need ~30 min to get back for 2:30. Want me to
  draft a note asking to start 15 min later?" (draft waits for their OK)

Also: first `away` event of the day ("Leave by 12:30 for the dentist"), `away` → `away` (use the
buffer between), overlaps, "starting in 10 min" with the join link, a day of 4+ back-to-back
events with no 30-min break. Neddy asks once, by voice or card, "How long does getting around town
usually take: 15, 30, 45, 60 min?" and saves it (`prefs.travelBuffer`). Later upgrades (not v1):
Google Maps through Composio when connected (the apps prompt already lists it), or a routing API
from the home address.

### Delivery (decision: all of them, by urgency)

| Channel | Use | Notes |
|---|---|---|
| Web push | `now` (next ~60 min) | iPhone only after "Add to Home Screen" (iOS 16.4+); needs the permission prompt |
| Bell (notifications) | everything | exists (`notify`) |
| Inline chat card | `now` and `today` | needs the "spoken-call" trick: the app runs the agent with `forwardedProps {headsUp: id}` and `ConversationAgent` emits a `headsup-…` message with no model (CopilotKit Intelligence has no append API; see CLAUDE.md) |
| Email (Resend, exists) | morning digest, "tomorrow" items | too slow for "leave in 10 min"; never send urgent items by email |
| Text (SMS) | later | Twilio. A US business must register (10DLC or toll-free verification, can take days to weeks); needs phone number + consent; STOP handling; ~1–2¢ per message. Email-to-text gateways are unreliable |
| Native iPhone app | later | `apps/mobile` is Expo, so an EAS build gives real APNs push (reliable, no Home Screen step). Needs an Apple Developer account ($99/yr). Voice (WebRTC) on native is its own piece of work |

My recommendation: ship push + bell + chat card + digest email now; plan the native app as the
fix for iPhone push; add text only if testers still miss things after that.

### Files

New:

- `packages/domain/src/heads-up.ts`: types (`HeadsUp`, `HeadsUpKind`, `Urgency`, `HeadsUpSettings`).
- `apps/server/src/heads-up-rules.ts`: pure rule functions (below). Unit-tested without a server.
- `apps/server/src/heads-ups.ts`: `HeadsUps` class (watcher, filters, delivery, settings, tools).
- `tests/heads-up-rules.test.ts`, `tests/heads-ups.test.ts`.

Change:

- `engine/service.ts`: add `headsUps?: HeadsUps`; in `maintain()` call `this.headsUps?.due()`; later
  move it onto its own interval + lease (`"heads-ups"`) so a slow read can't hold up the loop.
- `engine/service.ts` `notify()`: add `urgency`, `channels` and enforce quiet hours + daily cap in
  one place (this finishes task #108 for every feature).
- `reminders.ts` `followEvents`: take events from the shared per-person read.
- `app.ts`: construct `HeadsUps`; routes `GET/POST /api/heads-ups/settings`,
  `POST /api/heads-ups/:id/{done|snooze|mute-kind}`; give the chat/voice agents tools
  `my_heads_ups`, `set_heads_up_preferences` (the voice-first rule: "stop telling me about lunch").
- `persona.ts`: keys `prefs.travelBuffer`, `prefs.headsUps`.
- `apps/mobile`: Heads-ups settings card (Account), `HeadsUpCard` in chat rows (like
  `approval-card.tsx`), Help topic in `packages/domain/src/help.ts`, a Help shot.
- Plans: heads-ups cost no AI, so they are on every plan; only the AI digest counts toward limits.

### Stubs

```ts
// packages/domain/src/heads-up.ts
export type HeadsUpKind = "leave_by" | "tight_gap" | "overlap" | "starting_soon" | "no_break";
export type Urgency = "now" | "today" | "digest";
export interface HeadsUp {
  id: string; // hash of kind + event ids + day, so the same thing is said once
  kind: HeadsUpKind;
  urgency: Urgency;
  title: string;
  body: string;
  /** What the buttons can act on. */
  eventIds: string[];
  /** When it becomes useful, and when it stops mattering. */
  showAt: string;
  expiresAt: string;
  status: "pending" | "sent" | "done" | "snoozed" | "muted";
}
export interface HeadsUpSettings {
  id: "heads-up-settings";
  on: boolean; // default true for everyone
  chatty: "important" | "normal" | "chatty";
  kinds: Partial<Record<HeadsUpKind, boolean>>;
  channels: { push: boolean; bell: boolean; chat: boolean; email: boolean };
  travelBuffer: 15 | 30 | 45 | 60;
}
```

```ts
// apps/server/src/heads-up-rules.ts (pure: no store, no clock, no model)
import type { DayEvent } from "./calendar-today.ts";
import type { HeadsUp } from "../../../packages/domain/src/heads-up.ts";

const ONLINE = /(zoom\.us|meet\.google\.com|teams\.microsoft\.com|webex|\bzoom\b|\bcall\b|\bstandup\b)/i;
const AWAY =
  /\b(dentist|doctor|dr\.?|clinic|haircut|salon|lunch|dinner|pickup|pick-up|gym|flight|airport|interview|appointment)\b/i;
export type Place = "online" | "away" | "desk";
export function placeOf(e: Pick<DayEvent, "title" | "location">): Place {
  const text = `${e.title} ${e.location ?? ""}`;
  if (ONLINE.test(text)) return "online";
  // A street address or a named place means "not at my desk".
  if (e.location?.trim() || AWAY.test(text)) return "away";
  return "desk";
}

export interface RuleContext {
  now: number;
  travelBufferMin: number;
}
const min = 60_000;
const at = (iso: string) => Date.parse(iso);
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Heads-ups the person's next events call for. `events` are timed, sorted, not all-day. */
export function leaveByRules(events: DayEvent[], ctx: RuleContext): Omit<HeadsUp, "id" | "status">[] {
  const out: Omit<HeadsUp, "id" | "status">[] = [];
  for (let i = 0; i < events.length - 1; i++) {
    const [a, b] = [events[i], events[i + 1]];
    if (!a || !b || placeOf(a) !== "away" || placeOf(b) === "away") continue;
    const gap = (at(b.start) - at(a.end)) / min;
    if (at(b.start) < ctx.now) continue;
    const leave = new Date(at(b.start) - ctx.travelBufferMin * min).toISOString();
    out.push(
      gap >= ctx.travelBufferMin
        ? {
            kind: "leave_by",
            urgency: at(a.end) - ctx.now < 90 * min ? "now" : "today",
            title: `Leave ${a.title} by ${time(a.end)}`,
            body: `${a.title} ends ${time(a.end)} and ${b.title} starts at ${time(b.start)}. Leave by about ${time(new Date(Math.max(at(a.end), at(leave))).toISOString())} to get back in time.`,
            eventIds: [a.id, b.id],
            showAt: new Date(at(a.start) - 5 * min).toISOString(),
            expiresAt: b.start,
          }
        : {
            kind: "tight_gap",
            urgency: "now",
            title: `Tight between ${a.title} and ${b.title}`,
            body: `${a.title} ends ${time(a.end)} and you'll need about ${ctx.travelBufferMin} minutes to get back for ${b.title} at ${time(b.start)}. Want me to draft a note asking to start a little later? It won't send until you say so.`,
            eventIds: [a.id, b.id],
            showAt: new Date(at(a.start) - 5 * min).toISOString(),
            expiresAt: b.start,
          },
    );
  }
  return out;
}
```

```ts
// apps/server/src/heads-ups.ts
export class HeadsUps {
  constructor(
    private readonly db: Store,
    private readonly deps: {
      /** One read per person, shared with the Feed and reminders. */
      events: (owner: string, from: string, to: string) => Promise<DayEvent[]>;
      notify: AgentService["notify"]; // with urgency + channels after the change above
      quiet: (owner: string, at: number) => Promise<boolean>; // reads prefs.quietHours
      settings: (owner: string) => Promise<HeadsUpSettings>;
      now?: () => number;
    },
  ) {}
  /** From maintain(): people whose nextCheckAt has come. */
  async due() {
    const now = this.deps.now?.() ?? Date.now();
    for (const { owner, value } of await this.db.scan<{ id: string; nextCheckAt?: string; failures?: number }>("heads-up-state")) {
      if (value.nextCheckAt && Date.parse(value.nextCheckAt) > now) continue;
      await this.check(owner, now).catch((error) => this.backOff(owner, value, error));
    }
  }
  private async check(owner: string, now: number) {
    const s = await this.deps.settings(owner);
    if (!s.on) return this.later(owner, 60);
    const events = (await this.deps.events(owner, new Date(now).toISOString(), new Date(now + 36 * 3_600_000).toISOString()))
      .filter((e) => !e.allDay)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    for (const candidate of leaveByRules(events, { now, travelBufferMin: s.travelBuffer })) {
      if (!s.kinds[candidate.kind] && s.kinds[candidate.kind] !== undefined) continue;
      if (Date.parse(candidate.showAt) > now || Date.parse(candidate.expiresAt) < now) continue;
      const id = createHash("sha256").update(`${owner}:${candidate.kind}:${candidate.eventIds.join(",")}`).digest("hex");
      // insertIfAbsent: said once, even across restarts and two copies of the server.
      const saved = await this.db.insertIfAbsent(owner, "heads-ups", { ...candidate, id, status: "pending" });
      if (saved && !(await this.deps.quiet(owner, now)))
        await this.deliver(owner, saved, s);
    }
    await this.later(owner, this.minutesUntilNext(events, now));
  }
}
```

(`later`, `backOff`, `deliver`, `minutesUntilNext` are small helpers: store `nextCheckAt`; count
failures and widen; call `notify` with `urgency`; sleep until ~20 min before the next event, never
longer than 15 minutes while something is coming within 6 hours.)

Tests to write first: the dentist case (1:00–2:00 then a Zoom at 2:30 → one `leave_by`), a gap
smaller than the buffer (`tight_gap`), a Zoom followed by a desk meeting (nothing), the same
candidate twice (one notification), quiet hours (stored, not sent), a failing calendar (back-off,
one "reconnect" message), Outlook events through the same path.

### Cost and limits

- Heads-up tick: **0 tokens**. Calendar reads: one per person when something is within ~36 h, at
  most every 15 minutes, none while asleep or with no calendar; with Composio calendar triggers,
  far fewer. Check Composio's request quota for the plan in use before rollout.
- Morning digest: one worker-model call a day per person (a few cents a month). Put it behind the
  cost guard from task #106/#108.

---

## Phase 2.2: one approval gate (human in the loop)

The stored-proposal design already freezes risky calls. The work is to make it **one rule in one
place** and strictest where it matters.

### New: `apps/server/src/action-guard.ts`

```ts
import type { Store } from "./db.ts";
import type { ApprovalRules } from "./approval-rules.ts";

/** What a tool call would do, decided from the tool, never from the model's own words. */
export type Effect = "read" | "write" | "message" | "money" | "destructive" | "credentials";
/** Who is asking. A proactive or background caller can never skip review. */
export type Actor = "person" | "voice" | "job" | "proactive";
export type Verdict =
  | { run: true; why?: string }
  | { run: false; review: true; ttlMinutes: number }
  | { run: false; review: false; refuse: string };

export class ActionGuard {
  constructor(
    private readonly rules: ApprovalRules,
    private readonly db: Store,
  ) {}
  /** The only place that decides run / review / refuse. */
  async decide(
    owner: string,
    call: { slug: string; app: string; effect: Effect; readOnlyApp?: boolean },
    actor: Actor,
  ): Promise<Verdict> {
    if (call.effect === "read") return { run: true };
    if (call.readOnlyApp) return { run: false, review: false, refuse: "That app is set to read-only." };
    // Proactive work only ever drafts; the person decides when they're back.
    if (actor === "proactive") return { run: false, review: true, ttlMinutes: 12 * 60 };
    // Money, sign-in codes, deleting AND sending never ride an app-wide rule.
    const needsOwnRule = ["money", "credentials", "destructive", "message"].includes(call.effect);
    const rule = await this.rules.allows(owner, {
      slug: call.slug,
      app: call.app,
      destructive: needsOwnRule,
    });
    if (rule && call.effect !== "money" && call.effect !== "credentials")
      return { run: true, why: rule };
    return { run: false, review: true, ttlMinutes: actor === "job" ? 120 : 30 };
  }
}
```

### Change

- `approval-rules.ts`: add `messageAction(slug, app, tags)` (SEND, REPLY, FORWARD, POST, PUBLISH,
  INVITE, SHARE, TEXT…) next to `destructiveAction`; `allows()` treats it like destructive.
- `apps.ts` `use_app` (~line 827): replace the inline `readOnly` / rule / purchase branches by
  `guard.decide(...)`; the `tool.effect` comes from `readOnlyAction` + `destructiveAction` +
  `messageAction` + `isPurchase`.
- `engine/model.ts:588` and `engine/conversation.ts:1036`: call the same guard (`actor: "job"` /
  `"person"`; `"voice"` on calls).
- `actions.ts` `propose`: take `ttlMinutes` (today fixed at 30) and keep re-checking the target
  version on approve, so a long-lived draft can't act on a changed calendar event.
- `proposalSchema` (`packages/domain/src/index.ts:192`): no new kinds needed.
- Heads-up buttons ("Draft a note…") call `propose` with `actor: "proactive"`, so the draft appears
  as the existing Approve card and is never sent on its own.

### Prove it (add first)

`tests/action-guard.test.ts`:

- every Composio fixture slug that is not a read verb returns `review` for `proactive` and `job`
  even with an app-wide rule set;
- `GMAIL_SEND_EMAIL` with an app-wide Gmail rule → `review` (new behaviour); with a tool-level rule →
  `run`;
- money and sign-in codes → `review` always;
- an unknown verb → `review` (fail closed).

---

## Phase 2.3: structural redaction (before the model sees it)

### New: `packages/domain/src/redact.ts` (pure, shared by server and app)

```ts
export type Found = { kind: string; at: number; length: number };
export interface Redacted {
  text: string;
  found: Found[];
}

const luhn = (digits: string) => {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double && (n *= 2) > 9) n -= 9;
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
};
const SECRETS =
  /\b(?:sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const SSN = /\b(?!000|666|9\d\d)\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
/** Only near a word that says what it is, or every long number would be hidden. */
const KEYED =
  /\b(password|passcode|pin|routing(?: number)?|account(?: number| #)?|passport|driver'?s? licen[sc]e|license number|iban|swift)\b[^\n]{0,20}?[:=#]?\s*([A-Za-z0-9-]{6,})/gi;

export function redact(input: string): Redacted {
  const found: Found[] = [];
  let text = input.replace(SECRETS, (m, offset: number) => {
    found.push({ kind: "secret", at: offset, length: m.length });
    return "[secret removed]";
  });
  text = text.replace(CARD, (m, offset: number) => {
    const digits = m.replace(/\D/g, "");
    if (!luhn(digits)) return m; // a phone or order number, not a card
    found.push({ kind: "card", at: offset, length: m.length });
    return `[card ending ${digits.slice(-4)}]`;
  });
  text = text.replace(SSN, (m, offset: number) => {
    found.push({ kind: "ssn", at: offset, length: m.length });
    return `[SSN ending ${m.replace(/\D/g, "").slice(-4)}]`;
  });
  text = text.replace(KEYED, (m, label: string, offset: number) => {
    found.push({ kind: label.toLowerCase(), at: offset, length: m.length });
    return `${label}: [removed]`;
  });
  return { text, found };
}
```

Known limits (say so in the tests): passports and licenses are only caught next to a keyword;
foreign ID formats need their own patterns; this reduces risk, it is not a guarantee.

### Where to call it (all in `apps/server/src`)

| Point | File | What |
|---|---|---|
| Connector output | `apps.ts` `bounded()` (line ~106) | `redact(JSON.stringify(value))` before the size cut: covers every Composio read, including Gmail/Outlook |
| Built-in mail | `engine/conversation.ts` `search_mail` (line 227), `read_mail_thread` (line 258), and the job copies in `engine/model.ts` | redact message bodies |
| The person's typing | `engine/conversation.ts` `run()` (line ~108) | redact the latest user message; if something was found, add a one-line note: "I hid a card number so I never see it" |
| Files and pages | `file-tools.ts` `read_file` (line 197), `browse_web`/page text in `browser-tools.ts` | redact extracted text |
| Memory writes | `conversation.ts` `remember_fact` (718), `suggest_memory` (743), `persona.ts` `save_about_person` (158) | **refuse** to save anything that matches (stronger than the prompt asking the model not to) |
| Logs and usage | `log.ts` | run messages through `redact` so a failing call can't leak into Railway logs |
| Meeting transcripts | `meetings.ts` summary prompt | redact before the summary model sees it (the saved transcript stays as spoken) |

A person can still hand Neddy a number on purpose (e.g. "use my card for this booking"): that goes
through the browser's saved-sign-in/typed-secret path, never through the model's context. A later
step can swap matches for reversible tokens (`⟦card:1⟧`) that the server resolves only when an
approved action runs; not needed for v1.

---

## Suggested order

1. `heads-up-rules.ts` + tests (the dentist case), `HeadsUps`, bell + push + chat card, settings
   card, voice tools, Help. (Phase 2.1, about one session.)
2. `notify()` quiet hours / daily cap / urgency, and one calendar read per person (fixes
   `followEvents`).
3. `redact.ts` at `bounded()`, mail, typing and memory writes. (Phase 2.3, small and independent.)
4. `ActionGuard` with the new "messages need their own rule" behaviour and the invariant tests.
5. Digest email, Composio calendar triggers, native iPhone app, text.

## Open questions

- Default travel buffer: 30 minutes, asked once. OK?
- Should the first heads-up a new person sees be an explanation card ("Neddy now tells you when
  something needs attention. Turn off in Heads-ups.")?
- Redaction wording: tell the person every time something was hidden, or only in the chat note?
- Text: build only if testers still miss notifications after the iPhone app?
