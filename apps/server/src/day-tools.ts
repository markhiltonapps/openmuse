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
) {
  return {
    name: "look_at_calendar",
    description:
      "What's on the person's calendar (every connected calendar app at once) and their reminders, for one day or up to a week. Use it for 'what's on today / tomorrow / this week' and 'what does my day look like'. When the result has `shown`, they can see it as a card: answer in a sentence or two and don't list every event.",
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
      return {
        from: first,
        days,
        timeZone: zone,
        events: calendar.events.slice(0, 60),
        reminders: due,
        ...(calendar.failed.length
          ? {
              couldNotRead: calendar.failed,
              next: "Some calendars couldn't be read. If list_connected_apps shows one needs reconnecting, call connect_app so its Connect card appears. Otherwise, tell them it couldn't be read just now.",
            }
          : {}),
        ...(calendar.checked.length
          ? {}
          : {
              note: "No calendar app is connected, so this has only their reminders. Offer to connect one with connect_app.",
            }),
        // Only when there's something to show (a call shows no card for an empty day).
        ...(calendar.events.length || due.length
          ? {
              shown:
                "This is on the person's screen as a card; don't list every event in your reply.",
            }
          : {}),
      };
    },
  };
}
