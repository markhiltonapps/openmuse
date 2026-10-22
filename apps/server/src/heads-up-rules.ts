import { createHash } from "node:crypto";
import type { Chattiness, HeadsUp, HeadsUpKind } from "../../../packages/domain/src/heads-up.ts";
import type { DayEvent } from "./calendar-today.ts";

/**
 * What Heads-ups notices in a day of calendar events. Plain rules, no model, no clock: the same
 * events always give the same answer, so each rule can be tested with a made-up day. There are no
 * maps here (owner, 2026-10-22): common sense says an appointment away from the desk needs travel
 * before a call or a desk meeting, and the person's usual travel time stands in for the drive.
 */
export type Place = "online" | "away" | "desk";

const JOIN_LINK =
  /https?:\/\/[^\s<>"')]*(?:zoom\.us|zoomgov\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|gotomeeting\.com|chime\.aws|jit\.si|skype\.com|bluejeans\.com|ringcentral\.com|discord\.(?:com|gg)|around\.co|zoho\.com\/meeting)[^\s<>"')]*/i;
const ONLINE_WORDS =
  /\b(zoom|google meet|teams call|teams meeting|webex|video call|phone call|conference call|call with|standup|stand-up|webinar|virtual|online)\b/i;
/** Words that mean "go somewhere" on their own. Lunch, coffee, the gym and interviews count only with a real place. */
const AWAY_WORDS =
  /\b(dentist|dental|orthodontist|doctor|physician|clinic|hospital|dermatologist|therapist|physio|vet|haircut|salon|barber|massage|pick[- ]?up|drop[- ]?off|airport|flight|appointment|reservation|recital|concert)\b/i;
/** A "place" that is really the office, a room, a floor or home. */
const DESK_PLACES =
  /\b(room|conf|conference|office|desk|home|remote|virtual|online|zoom|teams|meet|floor|building|bldg|hq|headquarters|campus)\b/i;

/** A meeting link: a known video service, or a location that is just a web address. */
export const joinLink = (event: Pick<DayEvent, "location" | "title">) => {
  const known = JOIN_LINK.exec(`${event.location ?? ""} ${event.title}`)?.[0];
  const bare = /^https?:\/\/\S+$/i.exec(event.location?.trim() ?? "")?.[0];
  return (known ?? bare)?.replace(/[.,;]+$/, "");
};
/** Words that make an appointment something done from a screen or phone, not a trip. */
const REMOTE_WORDS = /\b(call|phone|video|telehealth|telemedicine|virtual|remote|consult|zoom)\b/i;

export function placeOf(event: Pick<DayEvent, "title" | "location">): Place {
  const location = event.location?.trim() ?? "";
  if (
    joinLink(event) ||
    ONLINE_WORDS.test(event.title) ||
    /^(zoom|teams|meet|online|virtual)/i.test(location)
  )
    return "online";
  // "Doctor call", "Dentist video check-in": an appointment by screen or phone isn't a trip.
  if (AWAY_WORDS.test(event.title) && REMOTE_WORDS.test(event.title)) return "online";
  if (AWAY_WORDS.test(event.title)) return "away";
  if (location && !DESK_PLACES.test(location)) return "away";
  return "desk";
}

export interface RuleContext {
  now: number;
  /** Minutes the person usually needs to get from one place to another. */
  buffer: number;
  timeZone: string;
  chatty: Chattiness;
}
export type Candidate = Omit<HeadsUp, "status" | "createdAt">;

const MINUTE = 60_000;
const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

/** "2:00 pm", in the person's time zone. */
export function clock(instant: string | number, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
    .format(new Date(instant))
    .replace(/\u202f/g, " ")
    .replace(/\s?([AP])M$/i, (_m, ap: string) => ` ${ap.toLowerCase()}m`);
}
/** "" for today, "On Fri, Oct 23, " for another day: a date that stays true however long the card is up. */
function dayPrefix(instant: string, ctx: RuleContext) {
  const day = (ms: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timeZone }).format(new Date(ms));
  if (day(at(instant)) === day(ctx.now)) return "";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: ctx.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(at(instant)));
  return `On ${date}, `;
}
/** A calendar title kept to a length that fits a notification. */
const short = (title: string) => (title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title);
const howLong = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  return minutes === 0 ? "no time at all" : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
};
const list = (names: string[]) =>
  names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const idOf = (kind: HeadsUpKind, events: DayEvent[]) =>
  createHash("sha256")
    .update(`${kind}|${events.map((e) => `${e.id}@${e.start}`).join("|")}`)
    .digest("hex")
    .slice(0, 32);
const same = (a: string | undefined, b: string | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** Whether getting from one event to the next takes travel. */
function travel(a: DayEvent, b: DayEvent) {
  const [pa, pb] = [placeOf(a), placeOf(b)];
  if (pa === "away" && pb === "away") return !(a.location && same(a.location, b.location));
  return (pa === "away") !== (pb === "away");
}

/** Timed events that matter now, in order, with the same event from two calendars counted once. */
export function usable(events: DayEvent[], now: number) {
  const seen = new Set<string>();
  return events
    .filter((e) => !e.allDay && Number.isFinite(at(e.start)) && Number.isFinite(at(e.end)))
    .filter((e) => at(e.end) > now && at(e.end) > at(e.start))
    .sort((a, b) => at(a.start) - at(b.start) || at(a.end) - at(b.end))
    .filter((e) => {
      const key = `${e.title.trim().toLowerCase()}@${e.start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Everything today's events call for. The watcher decides which of these are due to be said. */
export function headsUpsFor(allEvents: DayEvent[], ctx: RuleContext): Candidate[] {
  const events = usable(allEvents, ctx.now);
  const out: Candidate[] = [];
  const t = (instant: string | number) => clock(instant, ctx.timeZone);
  const buffer = ctx.buffer * MINUTE;

  for (let i = 0; i < events.length; i++) {
    const a = events[i] as DayEvent;
    const previous = events[i - 1];
    const next = events[i + 1];
    const name = short(a.title);

    // Something away from the desk is coming: when to leave for it.
    if (placeOf(a) === "away" && at(a.start) > ctx.now) {
      const leave = at(a.start) - buffer;
      const crowded = previous && at(previous.end) > leave && travel(previous, a);
      if (!crowded)
        out.push({
          id: idOf("leave_for", [a]),
          kind: "leave_for",
          urgency: "now",
          title:
            leave <= ctx.now ? `Time to leave for ${name}` : `Leave for ${name} by ${t(leave)}`,
          body:
            leave <= ctx.now
              ? `${name} starts at ${t(a.start)}. I plan for about ${ctx.buffer} minutes to get there.`
              : `${name} starts at ${t(a.start)}. If getting there takes about ${ctx.buffer} minutes, leave by ${t(leave)}.`,
          eventIds: [a.id],
          showAt: iso(leave - 20 * MINUTE),
          expiresAt: a.start,
        });
    }

    // The next thing after it, and whether there's time to get there.
    if (next && at(next.start) >= at(a.end) && travel(a, next)) {
      const gap = at(next.start) - at(a.end);
      const other = short(next.title);
      if (gap < buffer && at(next.start) > ctx.now) {
        out.push({
          id: idOf("tight_gap", [a, next]),
          kind: "tight_gap",
          urgency: "now",
          title: `Tight between ${name} and ${other}`,
          body: `${name} ends at ${t(a.end)} and ${other} starts at ${t(next.start)}. That’s ${howLong(gap)}, and getting there usually takes about ${ctx.buffer} minutes. You may want to leave ${name} early or ask ${other} to start a little later.`,
          eventIds: [a.id, next.id],
          moveTitle: other,
          showAt: iso(at(a.start) - 60 * MINUTE),
          expiresAt: next.start,
        });
      } else if (gap >= buffer && placeOf(a) === "away" && placeOf(next) !== "away") {
        const latest = at(next.start) - buffer;
        const right = latest - at(a.end) <= 10 * MINUTE;
        out.push({
          id: idOf("leave_by", [a, next]),
          kind: "leave_by",
          urgency: "now",
          title: right ? `Head back right after ${name}` : `Head back from ${name} by ${t(latest)}`,
          body: `${name} ends at ${t(a.end)} and ${other} starts at ${t(next.start)}. ${right ? `Head out as soon as it ends. You’ll need about ${ctx.buffer} minutes to get back.` : `Leave by ${t(latest)} at the latest. You’ll need about ${ctx.buffer} minutes to get back.`}`,
          eventIds: [a.id, next.id],
          showAt: iso(at(a.start) - 15 * MINUTE),
          expiresAt: next.start,
        });
      }
    }

    // A meeting about to start, with its link.
    const link = joinLink(a);
    if (link || ctx.chatty === "chatty")
      out.push({
        id: idOf("starting_soon", [a]),
        kind: "starting_soon",
        urgency: "now",
        title: `${name} starts at ${t(a.start)}`,
        body: link
          ? "The meeting link is ready."
          : a.location
            ? `It’s at ${a.location.slice(0, 80)}.`
            : "It’s about to start.",
        eventIds: [a.id],
        ...(link ? { joinUrl: link } : {}),
        showAt: iso(at(a.start) - 10 * MINUTE),
        expiresAt: iso(at(a.start) + 5 * MINUTE),
      });

    // Two things at the same time.
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j] as DayEvent;
      if (at(b.start) >= at(a.end)) break;
      const other = short(b.title);
      out.push({
        id: idOf("overlap", [a, b]),
        kind: "overlap",
        urgency: "today",
        title: `${name} and ${other} overlap`,
        body: `${dayPrefix(a.start, ctx)}${name} (${t(a.start)} to ${t(a.end)}) and ${other} (${t(b.start)} to ${t(b.end)}) overlap from ${t(b.start)} to ${t(Math.min(at(a.end), at(b.end)))}.`,
        eventIds: [a.id, b.id],
        moveTitle: other,
        showAt: iso(at(a.start) - 24 * 60 * MINUTE),
        expiresAt: b.start,
      });
    }
  }

  // A long run of back-to-back events.
  let run = 0;
  for (let i = 1; i <= events.length; i++) {
    const [a, b] = [events[i - 1] as DayEvent, events[i]];
    if (b && at(b.start) - at(a.end) <= 15 * MINUTE) {
      run++;
      continue;
    }
    if (run >= 3) {
      const streak = events.slice(i - 1 - run, i);
      const [first, last] = [streak[0] as DayEvent, streak.at(-1) as DayEvent];
      const names = streak.map((e) => short(e.title));
      out.push({
        id: idOf("no_break", streak),
        kind: "no_break",
        urgency: "digest",
        title: `${streak.length} things back to back`,
        body: `${dayPrefix(first.start, ctx)}from ${t(first.start)} to ${t(last.end)} you have ${list(names.length > 5 ? [...names.slice(0, 4), `${names.length - 4} more`] : names)} with 15 minutes or less between them. Could you fit in a break?`.replace(
          /^[a-z]/,
          (c) => c.toUpperCase(),
        ),
        eventIds: streak.map((e) => e.id),
        showAt: iso(at(first.start) - 60 * MINUTE),
        expiresAt: last.start,
      });
    }
    run = 0;
  }
  return out;
}

/** Quiet hours as minutes after midnight, from words like "9 pm to 8 am". */
export interface QuietWindow {
  start: number;
  end: number;
}
export const DEFAULT_QUIET: QuietWindow = { start: 22 * 60, end: 7 * 60 };
export function parseQuietHours(text: string | undefined): QuietWindow {
  const match =
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–|until|till|through)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(
      text ?? "",
    );
  if (!match) return DEFAULT_QUIET;
  const [, h1, m1, p1, h2, m2, p2] = match;
  if (Number(h1) > 24 || Number(h2) > 24 || (!p1 && !p2)) return DEFAULT_QUIET;
  const minutes = (hour: string, minute: string | undefined, meridiem: string) =>
    ((Number(hour) % 12) + (meridiem === "pm" ? 12 : 0)) * 60 + Number(minute ?? 0);
  // "9 to 8 am" and "10 pm to 7": one side has no am/pm, so it takes the opposite of the other.
  const opposite = (meridiem: string) => (meridiem === "am" ? "pm" : "am");
  const startMeridiem = (p1 ?? opposite((p2 as string).toLowerCase())).toLowerCase();
  const endMeridiem = (p2 ?? opposite(startMeridiem)).toLowerCase();
  const start = minutes(h1 as string, m1, startMeridiem);
  const end = minutes(h2 as string, m2, endMeridiem);
  return start === end ? DEFAULT_QUIET : { start, end };
}
export function minutesOfDay(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, Number(p.value)]),
  );
  return (parts.hour ?? 0) * 60 + (parts.minute ?? 0);
}
export function inQuiet(instant: number, timeZone: string, window: QuietWindow) {
  const m = minutesOfDay(instant, timeZone);
  return window.start < window.end
    ? m >= window.start && m < window.end
    : m >= window.start || m < window.end;
}
/** The first moment after `instant` that isn't quiet. */
export function quietEnds(instant: number, timeZone: string, window: QuietWindow) {
  const m = minutesOfDay(instant, timeZone);
  const wait = (window.end - m + 1440) % 1440 || 1;
  return Math.floor(instant / MINUTE) * MINUTE + wait * MINUTE;
}
