import { createHash } from "node:crypto";
import type { AppConnector, AppTool } from "./apps.ts";
import { localInstant } from "./engine/routines.ts";
import { backgroundFailure } from "./log.ts";

/**
 * Today's events from the calendar apps the person connected (Outlook, Google Calendar), for the
 * Feed's "your day" card. Chat reads the same calendars through its app tools; this reads them
 * directly, with no model in between.
 */
export interface DayEvent {
  id: string;
  title: string;
  /** An instant (ISO), or a date (YYYY-MM-DD) for all-day events. */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  app: string;
}
export interface TodayCalendar {
  events: DayEvent[];
  /** Calendar apps that were checked, and ones that couldn't be read. */
  checked: string[];
  failed: string[];
}

/** Actions that list events in a time range, most direct first. */
const CALENDAR_ACTIONS: Record<string, string[]> = {
  outlook: ["OUTLOOK_GET_CALENDAR_VIEW", "OUTLOOK_LIST_EVENTS"],
  googlecalendar: ["GOOGLECALENDAR_EVENTS_LIST", "GOOGLECALENDAR_FIND_EVENT"],
};
const KEEP = 10 * 60 * 1000;

interface Schema {
  properties?: Record<string, unknown>;
  required?: string[];
}
/** Arguments for a "list events between two times" action, from its own parameter names. */
export function rangeArguments(
  tool: Pick<AppTool, "app" | "parameters">,
  from: string,
  to: string,
): Record<string, unknown> | undefined {
  const schema = (tool.parameters ?? {}) as Schema;
  const names = Object.keys(schema.properties ?? {});
  const find = (pattern: RegExp) => names.find((name) => pattern.test(name));
  const start = find(/^(time_?min|start_?(date_?)?time|start_?date|start)$/i);
  const end = find(/^(time_?max|end_?(date_?)?time|end_?date|end)$/i);
  if (!start || !end) return undefined;
  const args: Record<string, unknown> = { [start]: from, [end]: to };
  const single = find(/^single_?events$/i);
  if (single) args[single] = true;
  const most = find(/^(max_?results|top|limit|page_?size)$/i);
  if (most) args[most] = 50;
  if (tool.app === "googlecalendar") {
    const calendar = find(/^calendar_?id$/i);
    if (calendar) args[calendar] = "primary";
    const order = find(/^order_?by$/i);
    if (order) args[order] = "startTime";
  }
  // A required detail we can't fill in means this isn't the right action.
  if ((schema.required ?? []).some((name) => !(name in args))) return undefined;
  return args;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/** When an event starts or ends, as Google ({dateTime}|{date}) or Outlook ({dateTime, timeZone}) says it. */
function when(value: unknown, zone: string): { at: string; date: boolean } | undefined {
  const raw = record(value)
    ? text(value.dateTime) || text(value.date_time) || text(value.date)
    : text(value);
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { at: raw, date: true };
  if (/(z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? { at: new Date(ms).toISOString(), date: false } : undefined;
  }
  // A wall-clock time: in the zone the event names, else UTC (Outlook's default), else theirs.
  const named = record(value) ? text(value.timeZone) || text(value.time_zone) : "";
  const wall = raw.replace(" ", "T").slice(0, 16);
  const ms =
    !named || /^(utc|etc\/utc|gmt)$/i.test(named)
      ? Date.parse(`${wall}:00Z`)
      : localInstant(wall, validZone(named) ? named : zone);
  return Number.isFinite(ms) ? { at: new Date(ms).toISOString(), date: false } : undefined;
}

/** Calendar events anywhere in an app's answer, however deeply it wraps them. */
export function eventsIn(data: unknown, app: string, zone: string): DayEvent[] {
  const found: DayEvent[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 5) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 200)) visit(item, depth + 1);
      return;
    }
    if (!record(value)) return;
    const title = text(value.summary) || text(value.subject) || text(value.title);
    const start = when(value.start ?? value.startTime ?? value.start_time, zone);
    if (title && start) {
      if (value.status === "cancelled" || value.isCancelled === true) return;
      const end = when(value.end ?? value.endTime ?? value.end_time, zone) ?? start;
      const allDay = value.isAllDay === true || start.date;
      const location = record(value.location)
        ? text(value.location.displayName)
        : text(value.location);
      found.push({
        id:
          text(value.id) ||
          createHash("sha256").update(`${title}:${start.at}`).digest("hex").slice(0, 24),
        title: title.slice(0, 200),
        start: allDay ? start.at.slice(0, 10) : start.at,
        end: allDay ? end.at.slice(0, 10) : end.at,
        allDay,
        ...(location ? { location: location.slice(0, 200) } : {}),
        app,
      });
      return;
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(data, 0);
  return found;
}

export class CalendarToday {
  private cache = new Map<string, { at: number; day: string; value: TodayCalendar }>();
  constructor(
    private readonly apps: AppConnector | undefined,
    private readonly timeZone: (owner: string) => Promise<string>,
    private readonly now: () => number = Date.now,
  ) {}
  /** Today's events in the person's time zone, from every connected calendar app. */
  async today(owner: string, fresh = false): Promise<TodayCalendar> {
    const zone = await this.timeZone(owner);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(this.now());
    const cached = this.cache.get(owner);
    if (!fresh && cached && cached.day === day && this.now() - cached.at < KEEP)
      return cached.value;
    const value: TodayCalendar = { events: [], checked: [], failed: [] };
    const apps = this.apps;
    if (!apps) return value;
    const calendars = (await apps.connections(owner).catch(() => []))
      .filter((c) => c.connected && c.app in CALENDAR_ACTIONS)
      .map((c) => c.app);
    const from = new Date(localInstant(`${day}T00:00`, zone)).toISOString();
    const to = new Date(localInstant(`${day}T23:59`, zone) + 60_000).toISOString();
    for (const app of calendars) {
      value.checked.push(app);
      try {
        value.events.push(...(await this.read(owner, app, from, to, zone)));
      } catch (error) {
        value.failed.push(app);
        backgroundFailure(`today's ${app} calendar`, error);
      }
    }
    value.events.sort((a, b) => a.start.localeCompare(b.start));
    this.cache.set(owner, { at: this.now(), day, value });
    return value;
  }
  private async read(owner: string, app: string, from: string, to: string, zone: string) {
    const apps = this.apps;
    if (!apps) return [];
    const candidates: AppTool[] = [];
    for (const slug of CALENDAR_ACTIONS[app] ?? [])
      candidates.push(
        ...(await apps
          .tool(owner, slug)
          .then((t) => [t])
          .catch(() => [])),
      );
    // Actions get renamed: ask the app directory when none of the usual ones fit.
    if (!candidates.some((t) => t.readOnly && rangeArguments(t, from, to)))
      candidates.push(
        ...(await apps.search(owner, `list ${app} calendar events between two times`)).tools.filter(
          (t) => t.app === app,
        ),
      );
    let failure: unknown = new Error(`No ${app} action lists events in a time range`);
    for (const tool of candidates) {
      const args = tool.readOnly ? rangeArguments(tool, from, to) : undefined;
      if (!args) continue;
      try {
        const events = eventsIn(await apps.execute(owner, tool.slug, args), app, zone);
        // Some actions ignore the range: keep only what overlaps today.
        return events.filter((e) =>
          e.allDay
            ? e.start <= to.slice(0, 10) && e.end >= from.slice(0, 10)
            : e.start < to && e.end > from,
        );
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  }
}
