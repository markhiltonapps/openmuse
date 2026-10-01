import { Bell } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { usePlace } from "./app-places-ui";
import { Shell } from "./approval-card";
import { type AppCalendarEvent, calendarName } from "./calendar-apps";
import { colors, s } from "./ui";

interface CalendarResult {
  from: string;
  days: number;
  timeZone?: string;
  events: AppCalendarEvent[];
  reminders: { text: string; dueAt: string }[];
  couldNotRead?: string[];
  note?: string;
}

function parse(result: unknown): CalendarResult | undefined {
  let value = result;
  if (typeof value === "string")
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  const r = (value ?? {}) as Partial<CalendarResult>;
  if (typeof r.from !== "string" || !Array.isArray(r.events)) return undefined;
  return {
    from: r.from,
    days: typeof r.days === "number" ? r.days : 1,
    timeZone: typeof r.timeZone === "string" ? r.timeZone : undefined,
    events: r.events,
    reminders: Array.isArray(r.reminders) ? r.reminders : [],
    couldNotRead: Array.isArray(r.couldNotRead) ? r.couldNotRead : undefined,
    note: typeof r.note === "string" ? r.note : undefined,
  };
}

/** A day some days on, as YYYY-MM-DD (noon UTC keeps it on the same date everywhere). */
const plusDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** The person's calendar day for an instant, in their time zone (never UTC's day). */
const dayIn = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone });
const time = [
  s.small,
  {
    width: 64,
    fontSize: 13,
    lineHeight: 23,
    color: colors.mutedStrong,
    alignSelf: "flex-start" as const,
  },
];
/** "calendar" is the app's own calendar (its built-in Google connection, or the sample one). */
const nameOf = (app: string) => (app === "calendar" ? "Google Calendar" : calendarName(app));
const timeIn = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });

function dayName(day: string, timeZone?: string) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone });
  if (day === today) return "Today";
  if (day === plusDays(today, 1)) return "Tomorrow";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/**
 * What's on, from every connected calendar and their reminders, right in the conversation (the chat
 * or a call). Each day reads top to bottom: all-day things first, then by time.
 */
export function CalendarCard({
  result,
  onCall = false,
  wide = false,
}: {
  result: unknown;
  onCall?: boolean;
  wide?: boolean;
}) {
  const calendar = parse(result);
  const { go, label } = usePlace({ place: "calendar" });
  const { data } = useAgentWorkspace();
  const agent = data?.identity.name || "Neddy";
  if (!calendar) return null;
  const { from, days, timeZone } = calendar;
  const range = Array.from({ length: Math.min(Math.max(days, 1), 7) }, (_, i) => plusDays(from, i));
  // An all-day event is on each day from its start until (not including) its end; some calendars
  // give a one-day event the same start and end.
  const onDay = (event: AppCalendarEvent, day: string) => {
    if (!event.allDay) return dayIn(event.start, timeZone) === day;
    const first = event.start.slice(0, 10);
    const end = event.end.slice(0, 10);
    return first <= day && day < (end > first ? end : plusDays(first, 1));
  };
  const apps = new Set(calendar.events.map((event) => event.app));
  const groups = range
    .map((day) => ({
      day,
      events: calendar.events.filter((event) => onDay(event, day)),
      reminders: calendar.reminders.filter((reminder) => dayIn(reminder.dueAt, timeZone) === day),
    }))
    .filter((group) => days === 1 || group.events.length || group.reminders.length);
  const empty = groups.every((group) => !group.events.length && !group.reminders.length);
  const heading =
    days === 1
      ? dayName(from, timeZone)
      : `${dayName(from, timeZone)} to ${dayName(plusDays(from, days - 1), timeZone)}`;
  const unread = [...new Set((calendar.couldNotRead ?? []).map(nameOf))];
  const either =
    unread.length > 1 ? `${unread.slice(0, -1).join(", ")} or ${unread.at(-1)}` : unread[0];
  // No calendar app: whatever shows is only their reminders, so it says so.
  const noCalendar = calendar.note
    ? empty
      ? `No calendar is connected yet. Ask ${agent} to connect one.`
      : "No calendar is connected yet, so these are only your reminders."
    : "";
  return (
    <Shell wide={wide} label={`Calendar: ${heading}`}>
      <View style={{ gap: 2 }}>
        <Text style={[s.label, { color: colors.mutedStrong }]}>Calendar</Text>
        <Text role="heading" aria-level={3} style={[s.heading, { fontSize: 17, lineHeight: 23 }]}>
          {heading}
        </Text>
      </View>
      {/* What's missing goes first, so the list below isn't taken as everything. */}
      {noCalendar || either ? (
        <Text style={[s.small, { fontSize: 13, lineHeight: 18, color: colors.mutedStrong }]}>
          {noCalendar || `Couldn’t read ${either} just now, so this may not be everything.`}
        </Text>
      ) : null}
      {empty ? (
        noCalendar || either ? null : (
          <Text style={s.muted}>Nothing on your calendar.</Text>
        )
      ) : (
        groups.map((group, index) => (
          <View key={group.day} style={{ gap: 8, marginTop: days > 1 && index > 0 ? 6 : 0 }}>
            {days > 1 && (
              <Text role="heading" aria-level={4} style={[s.text, { fontWeight: "700" }]}>
                {dayName(group.day, timeZone)}
              </Text>
            )}
            {/* Events and reminders together, in time order (all-day ones first). */}
            {[
              ...group.events.map((event) => ({
                at: event.allDay ? 0 : Date.parse(event.start),
                event,
                reminder: undefined,
              })),
              ...group.reminders.map((reminder) => ({
                at: Date.parse(reminder.dueAt),
                event: undefined,
                reminder,
              })),
            ]
              .sort((a, b) => a.at - b.at)
              .map(({ event, reminder }) =>
                event ? (
                  <View key={`${event.app}-${event.id}-${group.day}`} style={[s.row, { gap: 12 }]}>
                    <Text style={time}>
                      {event.allDay ? "All day" : timeIn(event.start, timeZone)}
                    </Text>
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={[s.text, { fontWeight: "600" }]}>{event.title}</Text>
                      {event.location || apps.size > 1 ? (
                        <Text
                          numberOfLines={1}
                          style={[s.small, { fontSize: 13, color: colors.mutedStrong }]}
                        >
                          {[event.location, apps.size > 1 ? nameOf(event.app) : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ) : reminder ? (
                  <View key={`${reminder.dueAt}-${reminder.text}`} style={[s.row, { gap: 12 }]}>
                    <Text style={time}>{timeIn(reminder.dueAt, timeZone)}</Text>
                    {/* The bell stays by the first line when the reminder wraps. */}
                    <View style={[s.row, { flex: 1, gap: 6, alignItems: "flex-start" }]}>
                      <View role="img" aria-label="Reminder" style={{ marginTop: 5 }}>
                        <Bell size={13} color={colors.mutedStrong} />
                      </View>
                      <Text style={[s.text, { flex: 1 }]}>{reminder.text}</Text>
                    </View>
                  </View>
                ) : null,
              )}
          </View>
        ))
      )}
      {/* Another screen would end a call, so this is for the chat only. */}
      {!onCall && (
        <Pressable
          role="link"
          onPress={(event) => go(event?.currentTarget)}
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            minHeight: 44,
            justifyContent: "center",
            marginVertical: -8,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={[s.text, { color: colors.blueText, fontWeight: "600" }]}>{label}</Text>
        </Pressable>
      )}
    </Shell>
  );
}

/** In the chat: what look_at_calendar found. */
export function ToolCalendar({ result, loading }: { result: unknown; loading: boolean }) {
  return loading ? null : <CalendarCard result={result} />;
}
