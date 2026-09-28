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
