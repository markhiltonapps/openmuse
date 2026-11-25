import { z } from "zod";
import type { Store } from "./db.ts";
import { localInstant } from "./engine/routines.ts";
import type { Moment, Proactive } from "./proactive.ts";

/**
 * Calm by design (owner, 2026-11-25): once a week, a short "here's what I did for you", counted
 * from Neddy's own records (no model call, so it can't make anything up), and nothing at all in a
 * week with nothing to say. It goes through the same judge as every other unprompted notice: quiet
 * hours, "fewer like that", and its own switch ("Your weekly recap"). Neddy never messages people
 * just to bring them back to the app; this is the one regular note, and it can be turned off.
 */
const DAY = 86_400_000;

interface Item {
  status?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  sentAt?: string;
  startedAt?: string;
  archivedAt?: string | null;
  at?: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const within = (value: string | undefined, since: number) => !!value && Date.parse(value) >= since;

export interface Recap {
  /** One line each, already in words: "Finished 4 jobs: Morning brief, Book the plumber and 2 more". */
  lines: string[];
  /** Everything counted, for tests and the agent. */
  counts: Record<string, number>;
}

/** What Neddy did for this person since `since`. */
export async function buildRecap(db: Store, owner: string, since: number): Promise<Recap> {
  const [tasks, actions, reminders, commitments, meetings, memories, meals] = await Promise.all([
    db.list<Item>(owner, "tasks"),
    db.list<Item>(owner, "actions"),
    db.list<Item>(owner, "reminders"),
    db.list<Item>(owner, "commitments"),
    db.list<Item>(owner, "meetings"),
    db.list<Item>(owner, "memories"),
    db.list<Item>(owner, "health-log"),
  ]);
  const newest = (key: keyof Item) => (a: Item, b: Item) =>
    String(b[key] ?? "").localeCompare(String(a[key] ?? ""));
  const jobs = tasks
    .filter((t) => t.status === "succeeded" && within(t.updatedAt, since))
    .sort(newest("updatedAt"));
  const approved = actions.filter((a) => a.status === "succeeded" && within(a.createdAt, since));
  const reminded = reminders.filter((r) => r.status === "sent" && within(r.sentAt, since));
  const tracked = commitments.filter((c) => within(c.createdAt, since));
  const recorded = meetings.filter((m) => m.status === "done" && within(m.startedAt, since));
  const remembered = memories.filter((m) => within(m.createdAt, since));
  const logged = meals.filter((m) => within(m.at ?? m.createdAt, since));
  // Repeats are grouped ("Morning brief, 7 times"), and end marks dropped so a line never ends "?.".
  const names = (items: Item[]) => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const title = item.title
        ?.replace(/\s+/g, " ")
        .trim()
        .replace(/[.!?…:;,]+$/, "");
      if (title) counts.set(title, (counts.get(title) ?? 0) + 1);
    }
    const titles = [...counts].map(([title, n]) => (n > 1 ? `${title} (${n} times)` : title));
    const shown = titles.slice(0, 2).join(", ");
    return titles.length > 2 ? `${shown} and ${titles.length - 2} more` : shown;
  };
  const lines = [
    jobs.length
      ? `Finished ${plural(jobs.length, "job", "jobs")}${names(jobs) ? `: ${names(jobs)}` : ""}`
      : "",
    approved.length ? `Did ${plural(approved.length, "thing", "things")} you approved` : "",
    tracked.length
      ? `Started keeping an eye on ${plural(tracked.length, "plan", "plans")}${names(tracked) ? `: ${names(tracked)}` : ""}`
      : "",
    reminded.length ? `Sent ${plural(reminded.length, "reminder", "reminders")}` : "",
    recorded.length
      ? `Wrote up ${plural(recorded.length, "recording", "recordings")}${names(recorded) ? `: ${names(recorded)}` : ""}`
      : "",
    remembered.length
      ? `Remembered ${plural(remembered.length, "new thing", "new things")} you told me`
      : "",
    logged.length ? `Logged ${plural(logged.length, "meal", "meals")}` : "",
  ].filter(Boolean);
  return {
    lines,
    counts: {
      jobs: jobs.length,
      approved: approved.length,
      plans: tracked.length,
      reminders: reminded.length,
      recordings: recorded.length,
      memories: remembered.length,
      meals: logged.length,
    },
  };
}

/** The local date's parts in a zone. */
function localParts(at: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    weekday: String(parts.weekday),
  };
}

export class WeeklyRecap {
  constructor(
    private readonly db: Store,
    private readonly proactive: Proactive,
    private readonly notify: (
      owner: string,
      note: { title: string; body: string; key: string },
    ) => Promise<unknown>,
    private readonly timeZone: (owner: string) => Promise<string>,
    private readonly owners: () => Promise<string[]>,
    private readonly now: () => number = Date.now,
  ) {}
  /**
   * Sunday from 5 pm, once a week per person: the recap, if there's anything in it. A week with
   * nothing is marked done silently. Held by quiet hours, it tries again until Monday noon (Monday
   * morning counts as Sunday's week).
   */
  async due() {
    for (const owner of await this.owners()) {
      const zone = await this.timeZone(owner).catch(() => "UTC");
      const local = localParts(this.now(), zone);
      // Sunday from 5 pm, or (held by quiet hours) Monday morning, under Sunday's key.
      const sunday =
        local.weekday === "Sun" && local.hour >= 17
          ? local.day
          : local.weekday === "Mon" && local.hour < 12
            ? localParts(this.now() - DAY, zone).day
            : undefined;
      if (!sunday) continue;
      const key = `weekly:${sunday}`;
      const done = await this.db.get<{ id: string; key?: string }>(owner, "proactive", "weekly");
      if (done?.key === key) continue;
      const recap = await buildRecap(this.db, owner, this.now() - 7 * DAY);
      if (!recap.lines.length) {
        await this.db.put(owner, "proactive", { id: "weekly", key, empty: true });
        continue;
      }
      const monday = new Date(Date.parse(`${sunday}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
      const moment: Moment = {
        key,
        area: "weekly",
        detector: "weekly recap",
        title: "Your week, in short",
        body: `${recap.lines.join(". ")}.`,
        why: "Once a week, a short note of what Neddy did for you. Turn it off in Plans & bookings, or say “no more weekly recaps.”",
        urgency: "normal",
        expires: localInstant(`${monday}T12:00`, zone),
      };
      const verdict = await this.proactive.decide(owner, moment);
      if (verdict.action === "hold") continue;
      // Claimed first, so two servers (or a slow notify) never send it twice.
      await this.db.put(owner, "proactive", { id: "weekly", key });
      if (verdict.action !== "send") continue;
      await this.notify(owner, { title: moment.title, body: moment.body, key });
      await this.proactive.sent(owner, moment);
    }
  }
}

export const recapInstructions =
  " When the person asks what you've done for them lately (“what did you do for me this week?”), call weekly_recap and answer from it in a few short lines; never add things it doesn't list.";

export function recapToolSpecs(db: Store, owner: string) {
  return [
    {
      name: "weekly_recap",
      description:
        "What Neddy did for the person in the last few days, counted from its own records: jobs finished, things they approved, plans it started keeping an eye on, reminders sent, recordings written up, new things remembered, meals logged. Nothing else counts.",
      parameters: z.object({ days: z.number().int().min(1).max(31).optional() }),
      execute: async ({ days }: { days?: number }) => {
        const recap = await buildRecap(db, owner, Date.now() - (days ?? 7) * DAY);
        return recap.lines.length
          ? { days: days ?? 7, ...recap }
          : {
              days: days ?? 7,
              ...recap,
              note: "Nothing to report for these days. Say so plainly.",
            };
      },
    },
  ];
}
