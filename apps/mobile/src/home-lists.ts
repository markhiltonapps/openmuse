/**
 * The lists on Home that come from the agent's workspace, in plain words. No React here, so a
 * test can run them.
 */
import type { AgentNotification, Routine } from "../../../packages/domain/src/agent";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
/** A small count as a word ("Two"), bigger ones as digits. */
export const countWords = (n: number) => WORDS[n] ?? String(n);
const EVERY = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** "7:30 am" from a routine's "07:30". */
export function clockWords(time: string) {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  const hour = (h as number) % 12 || 12;
  const minute = String(m).padStart(2, "0");
  return h === 12 && m === 0 ? "12:00 pm" : `${hour}:${minute} ${(h as number) < 12 ? "am" : "pm"}`;
}

/** When a routine runs, as a person would say it: "Weekdays at 7:30 am", "Once, Mon 9 Nov at 9:00 am". */
export function scheduleWords(routine: Pick<Routine, "time" | "days" | "date">, now = new Date()) {
  const at = clockWords(routine.time);
  if (routine.date) {
    const [y, mo, d] = routine.date.split("-").map(Number);
    const day = new Date(y as number, (mo as number) - 1, d as number);
    const sameYear = day.getFullYear() === now.getFullYear();
    const when = day.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(sameYear ? {} : { year: "numeric" }),
    });
    return `Once, ${when} at ${at}`;
  }
  const days = [...new Set(routine.days)].sort((a, b) => a - b);
  const key = days.join(",");
  const which =
    key === "0,1,2,3,4,5,6"
      ? "Every day"
      : key === "1,2,3,4,5"
        ? "Weekdays"
        : key === "0,6"
          ? "Weekends"
          : days.length === 1
            ? (EVERY[days[0] as number] as string)
            : days.map((d) => DAYS[d]).join(", ");
  return `${which} at ${at}`;
}

/** The routines and one-time jobs that run next, soonest first. */
export function comingUp<T extends Pick<Routine, "enabled" | "nextRunAt">>(routines: T[], n = 3) {
  return routines
    .filter((routine) => routine.enabled && routine.nextRunAt)
    .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))
    .slice(0, n);
}

/** The newest updates for Home's Recent card: unread first, then newest. */
export function recentFew<T extends Pick<AgentNotification, "read" | "createdAt">>(
  notifications: T[],
  n = 3,
) {
  return [...notifications]
    .sort(
      (a, b) =>
        Number(!!a.read) - Number(!!b.read) || Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )
    .slice(0, n);
}

/** "Yesterday 6:12 pm", "Tuesday", "Just now": when an update arrived, briefly. */
export function whenWords(iso: string, now = new Date()) {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  if (!Number.isFinite(diff)) return "";
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  const time = then
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (daysAgo === 0) return time;
  if (daysAgo === 1) return `Yesterday ${time}`;
  if (daysAgo < 7) return then.toLocaleDateString(undefined, { weekday: "long" });
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
