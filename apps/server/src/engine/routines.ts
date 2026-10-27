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
  routine: Pick<Routine, "time" | "days" | "timeZone"> & { date?: string },
  after: number = Date.now(),
): string {
  const [hour = 0, minute = 0] = routine.time.split(":").map(Number);
  // A one-time job: its own day and time, whether or not that's still ahead.
  if (routine.date)
    return new Date(
      localInstant(`${routine.date}T${routine.time}`, routine.timeZone),
    ).toISOString();
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
  const kind = routine.date ? "one-time job" : "routine";
  return `${routine.prompt}\n\nThis is the scheduled ${kind} “${routine.title}”. Work from current data: mail, calendar, connected apps, goals and tasks as relevant. Keep the result short and skimmable, then call finish_task with it. Anything that sends, creates, changes or deletes still needs the person's review.`;
}

export const routineTemplates = [
  {
    title: "Morning brief",
    prompt:
      "Give me a brief for today: the weather, my calendar, important unread email, anything waiting on me, and progress on my goals.",
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

/** Errands that need details, or can only happen later (a place that's closed until Monday). */
export const errandInstructions =
  " When a request needs details you don't have (an errand, a booking, a form), ask for all of the missing ones together in one short message, never one at a time. Save lasting ones (such as their mobile number) to About you with save_about_person; never save a one-off detail there. If the thing can only happen later (a business that is closed right now, which you can check from its hours with search_web, or something they want done on a day), say so and offer to set it up for when it can happen: once they say yes, call create_routine with date and time (for example the next morning when the place opens), and write its prompt with every detail needed to do the job later without this chat. Say in one line what will happen and when, and that the result will come back to them in the app. Never say it has been done until the job's result says so.";
