/** Calendars read through connected apps (Outlook, Google Calendar), which chat reads too. */
export const CALENDAR_NAMES: Record<string, string> = {
  outlook: "Outlook",
  googlecalendar: "Google Calendar",
};
export interface AppCalendarEvent {
  id: string;
  title: string;
  /** An instant (ISO), or a date (YYYY-MM-DD) for all-day events. */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  app: string;
}
export interface AppDay {
  events: AppCalendarEvent[];
  /** Calendar apps that were checked, and ones that couldn't be read. */
  checked: string[];
  failed: string[];
}
export const calendarName = (app: string) => CALENDAR_NAMES[app] ?? "your calendar";

/** A date as YYYY-MM-DD in the person's own calendar (never UTC's day). */
export const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * What's left on today's calendar, from the app's own calendar and connected calendar apps:
 * the same meeting from two connections once, all-day ones first, then by time.
 */
export function todaysEvents<
  T extends { id: string; title: string; start: string; end: string; allDay: boolean },
>(events: T[], now = new Date()) {
  const today = localDay(now);
  const seen = new Set<string>();
  return events
    .filter((e) => {
      const key = `${e.title.trim().toLowerCase()}|${e.allDay ? e.start.slice(0, 10) : new Date(e.start).getTime()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter((e) =>
      e.allDay ? e.start.slice(0, 10) === today : localDay(new Date(e.start)) === today,
    )
    .filter((e) => e.allDay || new Date(e.end) > now)
    .sort(
      (a, b) =>
        (a.allDay ? 0 : Date.parse(a.start)) - (b.allDay ? 0 : Date.parse(b.start)) ||
        a.title.localeCompare(b.title),
    );
}
