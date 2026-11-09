import { z } from "zod";
import type { CalendarEvent } from "../../../packages/domain/src/index.ts";
import type { DayEvent, TodayCalendar } from "./calendar-today.ts";
import { localInstant } from "./engine/routines.ts";
import { localDay } from "./health.ts";

/** A date some days on, as YYYY-MM-DD. */
const plusDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The same meeting from two calendars, written either way, is one. */
const sameEvent = (event: Pick<DayEvent, "title" | "start" | "allDay">) =>
  `${event.title.trim().toLowerCase()}|${event.allDay ? event.start.slice(0, 10) : Date.parse(event.start)}`;

/**
 * The calendar apps' events with the app's own calendar (the built-in Google connection, or the
 * sample one), each meeting once, all-day ones first and then by time.
 */
export function withOwnCalendar(
  apps: TodayCalendar,
  own: CalendarEvent[] | "failed" | undefined,
): TodayCalendar {
  if (!own) return apps;
  if (own === "failed") return { ...apps, failed: [...apps.failed, "calendar"] };
  const seen = new Set(apps.events.map(sameEvent));
  const mine = own
    .filter((event) => !seen.has(sameEvent(event)))
    .map(
      (event): DayEvent => ({
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        ...(event.location ? { location: event.location } : {}),
        app: "calendar",
      }),
    );
  const at = (event: DayEvent) => (event.allDay ? 0 : Date.parse(event.start));
  return {
    events: [...mine, ...apps.events].sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) || at(a) - at(b) || a.start.localeCompare(b.start),
    ),
    checked: [...apps.checked, "calendar"],
    failed: apps.failed,
  };
}

/**
 * When an event is, in the person's own words and clock ("Tuesday 10:00 AM to 11:00 AM"). The events themselves carry
 * UTC instants, and a model converting those to a local time gets it wrong (a 10 AM meeting read as 9 AM), so the
 * server does the conversion and the agent reads this.
 */
export function whenText(event: Pick<DayEvent, "start" | "end" | "allDay">, zone: string) {
  if (event.allDay) return "all day";
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime())) return "";
  const at = (date: Date, options: Intl.DateTimeFormatOptions) =>
    date.toLocaleString("en-US", { timeZone: zone, ...options });
  const clock = { hour: "numeric", minute: "2-digit" } as const;
  const until = Number.isNaN(end.getTime()) || end.getTime() === start.getTime();
  return `${at(start, { weekday: "long" })} ${at(start, clock)}${until ? "" : ` to ${at(end, clock)}`}`;
}

/**
 * What's on: every connected calendar app's events and the person's reminders for a day or a
 * few, as a card in the chat (the Feed and calls read the calendar the same way).
 */
export function calendarToolSpec(
  deps: {
    between: (owner: string, from: string, to: string) => Promise<TodayCalendar>;
    timeZone: (owner: string) => Promise<string>;
    reminders?: (owner: string) => Promise<{ text: string; dueAt: string; when?: string }[]>;
    now?: () => number;
  },
  owner: string,
  /** A background job: nothing is on the person's screen, and it asks them with ask_user. */
  options: {
    background?: boolean;
    /** A call from a watch-style device: there is no call screen to show a card on. */
    device?: boolean;
  } = {},
) {
  const background = Boolean(options.background);
  const device = Boolean(options.device) && !background;
  return {
    name: "look_at_calendar",
    description: background
      ? "What's on the person's calendar (every connected calendar app at once) and their reminders, for one day or up to a week."
      : device
        ? "What's on the person's calendar (every connected calendar app at once) and their reminders, for one day or up to a week. Use it for 'what's on today / tomorrow / this week' and 'what's my first meeting'. Each event's `when` is its time in their own clock: say that, never convert times yourself."
        : "What's on the person's calendar (every connected calendar app at once) and their reminders, for one day or up to a week. Use it for 'what's on today / tomorrow / this week' and 'what does my day look like'. When the result has `shown`, they can see it as a card: answer in a sentence or two and don't list every event. Each event's `when` is its time in their own clock: say that, never convert times yourself.",
    parameters: z.object({
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("The first day, YYYY-MM-DD, in their time zone; today if left out"),
      days: z.number().int().min(1).max(7).optional().describe("How many days; 1 if left out"),
    }),
    execute: async ({ date, days = 1 }: { date?: string; days?: number }) => {
      const zone = await deps.timeZone(owner);
      const first = date ?? localDay(deps.now?.() ?? Date.now(), zone);
      const from = new Date(localInstant(`${first}T00:00`, zone)).toISOString();
      const to = new Date(localInstant(`${plusDays(first, days)}T00:00`, zone)).toISOString();
      const [calendar, reminders] = await Promise.all([
        deps.between(owner, from, to),
        (deps.reminders?.(owner) ?? Promise.resolve([])).catch(() => []),
      ]);
      const due = reminders
        .filter((reminder) => reminder.dueAt >= from && reminder.dueAt < to)
        .slice(0, 20)
        .map(({ text, dueAt }) => ({ text, dueAt }));
      const nowMs = deps.now?.() ?? Date.now();
      return {
        from: first,
        days,
        timeZone: zone,
        now: new Date(nowMs).toLocaleString("en-US", {
          timeZone: zone,
          weekday: "long",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
        events: calendar.events
          .slice(0, 60)
          .map((event) => ({ ...event, when: whenText(event, zone) })),
        reminders: due,
        ...(calendar.failed.length
          ? {
              couldNotRead: calendar.failed,
              next: background
                ? "Some calendars couldn't be read. If list_connected_apps shows one needs reconnecting, call connect_app and give them its link with ask_user. Otherwise, say it couldn't be read just now."
                : "Some calendars couldn't be read. If list_connected_apps shows one needs reconnecting, call connect_app so its Connect card appears. Otherwise, tell them it couldn't be read just now.",
            }
          : {}),
        ...(calendar.checked.length
          ? {}
          : {
              note: background
                ? "No calendar app is connected, so this has only their reminders."
                : "No calendar app is connected, so this has only their reminders. Offer to connect one with connect_app.",
            }),
        // Only when there's something to show (a call shows no card for an empty day); a job
        // shows nothing.
        ...(!background && !device && (calendar.events.length || due.length)
          ? {
              shown:
                "This is on the person's screen as a card; don't list every event in your reply.",
            }
          : {}),
        ...(device && (calendar.events.length || due.length)
          ? {
              next: "Nothing is on their watch screen yet. Say the first one or two events with their `when` times, in a sentence. For three or more you can put them on the watch with show_on_watch (kind list: the title as the label and its start time, like 9:00 AM, as the value).",
            }
          : {}),
      };
    },
  };
}
