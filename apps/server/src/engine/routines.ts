import type { Routine } from "../../../../packages/domain/src/agent.ts";

/** Milliseconds `timeZone` is ahead of UTC at `instant`. */
function offset(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, Number(p.value)]),
  );
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    Math.floor(instant / 1000) * 1000
  );
}

/** The UTC instant of a wall-clock time in `timeZone`, correct across DST changes. */
function zoned(year: number, month: number, day: number, minutes: number, timeZone: string) {
  const guess = Date.UTC(year, month, day, 0, minutes);
  const first = guess - offset(guess, timeZone);
  return guess - offset(first, timeZone);
}

/** The instant of a wall-clock "YYYY-MM-DDTHH:MM" in `timeZone`. */
export function localInstant(local: string, timeZone: string) {
  const [date = "", time = ""] = local.split("T");
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return zoned(year, month - 1, day, hour * 60 + minute, timeZone);
}

/** Next run strictly after `after` on one of `days` (0 = Sunday) at `time` (HH:MM). */
export function nextRun(
  routine: Pick<Routine, "time" | "days" | "timeZone">,
  after: number = Date.now(),
): string {
  const [hour = 0, minute = 0] = routine.time.split(":").map(Number);
  const local = new Date(after + offset(after, routine.timeZone));
  for (let add = 0; add <= 8; add++) {
    const day = new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + add),
    );
    if (!routine.days.includes(day.getUTCDay())) continue;
    const at = zoned(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hour * 60 + minute,
      routine.timeZone,
    );
    if (at > after) return new Date(at).toISOString();
  }
  throw new Error("Routine has no upcoming day");
}

export function routinePrompt(routine: Routine) {
  return `${routine.prompt}\n\nThis is the scheduled routine “${routine.title}”. Work from current data: mail, calendar, connected apps, goals and tasks as relevant. Keep the result short and skimmable, then call finish_task with it. Anything that sends, creates, changes or deletes still needs the person's review.`;
}

export const routineTemplates = [
  {
    title: "Morning brief",
    prompt:
      "Give me a brief for today: my calendar, important unread email, anything waiting on me, and progress on my goals.",
    time: "07:30",
    days: [1, 2, 3, 4, 5],
  },
  {
    title: "Inbox check",
    prompt:
      "Check my inbox for anything urgent or needing a reply today. List each with the sender, why it matters and a suggested next step.",
    time: "16:30",
    days: [1, 2, 3, 4, 5],
  },
  {
    title: "Follow-ups",
    prompt:
      "Find emails I sent in the last week that have not received a reply and suggest short follow-ups for the important ones.",
    time: "15:00",
    days: [5],
  },
  {
    title: "Weekly goal check-in",
    prompt:
      "Review my goals and milestones. Summarize progress this week and suggest the three most useful next steps.",
    time: "18:00",
    days: [0],
  },
];
