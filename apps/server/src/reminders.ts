import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.ts";
import { localInstant } from "./engine/routines.ts";
import { AppError } from "./errors.ts";

const localTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use the local time as YYYY-MM-DDTHH:MM");
const when = {
  /** Wall-clock time in the person's time zone. */
  at: localTime.optional(),
  /** Or a delay, for "in 20 minutes". */
  inMinutes: z
    .number()
    .int()
    .min(1)
    .max(366 * 24 * 60)
    .optional(),
};
/** The calendar event a reminder is for, so it moves when the event moves. */
const linkedEvent = z
  .object({
    title: z.string().trim().min(1).max(300),
    /** The event's start, as look_at_calendar gave it. */
    start: z.string().min(10).max(40),
    id: z.string().max(300).optional(),
  })
  .describe(
    "The calendar event this reminder is for (from look_at_calendar), e.g. “30 minutes before the dentist”: the reminder then moves when the event moves",
  );
export const reminderInputSchema = z
  .object({ text: z.string().trim().min(1).max(300), ...when, event: linkedEvent.optional() })
  .refine((value) => value.at || value.inMinutes, { message: "Say when to remind them" });
export const reminderChangeSchema = z.object({
  id: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(300).optional(),
  ...when,
});

export interface Reminder {
  id: string;
  text: string;
  dueAt: string;
  timeZone: string;
  status: "upcoming" | "sent";
  createdAt: string;
  sentAt?: string;
  /** The event it's for: it keeps the same distance from the event's start when that moves. */
  event?: { title: string; start: string; id?: string; offsetMs: number; gone?: boolean };
}
/** A calendar event, as the calendar apps give it. */
export interface CalendarEvent {
  id?: string;
  title: string;
  start: string;
  allDay?: boolean;
}
const MAX_UPCOMING = 100;
/** Sent reminders stay listed this long, then are cleared away. */
const KEEP_SENT = 7 * 24 * 60 * 60 * 1000;

/** One-off reminders: "remind me at 3 tomorrow to call the dentist". */
export class ReminderService {
  constructor(
    private readonly db: Store,
    private readonly timeZone: (owner: string) => Promise<string>,
    private readonly notify: (
      owner: string,
      reminder: { id: string; title: string; body: string; key: string },
    ) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}
  private async due(owner: string, value: { at?: string; inMinutes?: number }) {
    const timeZone = await this.timeZone(owner);
    const at = value.at
      ? localInstant(value.at, timeZone)
      : this.now() + (value.inMinutes ?? 0) * 60000;
    if (!Number.isFinite(at)) throw new AppError("That time isn't valid", 422);
    if (at < this.now() - 60000)
      throw new AppError("That time has already passed; choose a time in the future", 422);
    return { dueAt: new Date(at).toISOString(), timeZone };
  }
  /** How the reminder's time reads to the person, such as "Mon, Sep 28, 3:00 PM". */
  describe(reminder: Reminder) {
    return new Date(reminder.dueAt).toLocaleString("en-US", {
      timeZone: reminder.timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  private view(reminder: Reminder) {
    return { ...reminder, when: this.describe(reminder) };
  }
  async set(owner: string, raw: unknown, key?: string) {
    const input = reminderInputSchema.parse(raw);
    const upcoming = (await this.db.list<Reminder>(owner, "reminders")).filter(
      (r) => r.status === "upcoming",
    );
    if (upcoming.length >= MAX_UPCOMING)
      throw new AppError("Cancel some reminders before adding more", 409);
    const due = await this.due(owner, input);
    const eventStart = input.event ? Date.parse(input.event.start) : Number.NaN;
    const reminder: Reminder = {
      id: key ? createHash("sha256").update(`reminder:${key}`).digest("hex") : randomUUID(),
      text: input.text,
      ...due,
      status: "upcoming",
      createdAt: new Date(this.now()).toISOString(),
      ...(input.event && Number.isFinite(eventStart)
        ? {
            event: {
              title: input.event.title,
              start: new Date(eventStart).toISOString(),
              ...(input.event.id ? { id: input.event.id } : {}),
              offsetMs: eventStart - Date.parse(due.dueAt),
            },
          }
        : {}),
    };
    return this.view((await this.db.insertIfAbsent(owner, "reminders", reminder)) ?? reminder);
  }
  async change(owner: string, raw: unknown) {
    const input = reminderChangeSchema.parse(raw);
    const current = await this.db.get<Reminder>(owner, "reminders", input.id);
    if (current?.status !== "upcoming") throw new AppError("Reminder not found", 404);
    const next: Reminder = {
      ...current,
      text: input.text ?? current.text,
      ...(input.at || input.inMinutes ? await this.due(owner, input) : {}),
    };
    return this.view(await this.db.put(owner, "reminders", next));
  }
  /** Brings a reminder back in a few minutes, whether it has gone off yet or not. */
  async snooze(owner: string, id: string, minutes: number) {
    const current = await this.db.get<Reminder>(owner, "reminders", id);
    if (!current) throw new AppError("Reminder not found", 404);
    const { sentAt: _sent, ...rest } = current;
    return this.view(
      await this.db.put(owner, "reminders", {
        ...rest,
        status: "upcoming",
        dueAt: new Date(this.now() + Math.min(Math.max(minutes, 1), 24 * 60) * 60000).toISOString(),
      } satisfies Reminder),
    );
  }
  async cancel(owner: string, id: string) {
    if (!(await this.db.take(owner, "reminders", id)))
      throw new AppError("Reminder not found", 404);
    return { ok: true };
  }
  /** Upcoming reminders, soonest first, then ones sent in the last week. */
  async list(owner: string) {
    const all = await this.db.list<Reminder>(owner, "reminders");
    return {
      upcoming: all
        .filter((r) => r.status === "upcoming")
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
        .map((r) => this.view(r)),
      sent: all
        .filter((r) => r.status === "sent")
        .sort((a, b) => b.dueAt.localeCompare(a.dueAt))
        .slice(0, 20)
        .map((r) => this.view(r)),
    };
  }
  /**
   * Adaptive reminders (owner, 2026-10-08): a reminder for a calendar event keeps the same
   * distance from it when the event moves, and the person is told. An event that's gone is said
   * once; the reminder stays. `events` reads their calendars between two times.
   */
  async followEvents(
    events: (owner: string, from: string, to: string) => Promise<CalendarEvent[]>,
  ) {
    const now = this.now();
    const linked = (await this.db.scan<Reminder>("reminders")).filter(
      ({ value }) =>
        value.status === "upcoming" &&
        value.event &&
        !value.event.gone &&
        Date.parse(value.dueAt) > now &&
        Date.parse(value.dueAt) - now < 30 * 86_400_000,
    );
    for (const { owner, value } of linked) {
      const event = value.event as NonNullable<Reminder["event"]>;
      const was = Date.parse(event.start);
      const found = await events(
        owner,
        new Date(was - 7 * 86_400_000).toISOString(),
        new Date(was + 7 * 86_400_000).toISOString(),
      ).catch(() => undefined);
      // A calendar that couldn't be read says nothing about the event.
      if (!found) continue;
      const same = found
        .filter((e) =>
          event.id ? e.id === event.id : e.title.trim().toLowerCase() === event.title.toLowerCase(),
        )
        .sort(
          (a, b) => Math.abs(Date.parse(a.start) - was) - Math.abs(Date.parse(b.start) - was),
        )[0];
      if (!same) {
        // Gone, renamed or moved more than a week: said once, and the reminder stays.
        const moved = await this.db.compareAndSwap<Reminder>(
          owner,
          "reminders",
          value.id,
          { status: "upcoming", dueAt: value.dueAt },
          { event: { ...event, gone: true } },
        );
        if (moved)
          await this.notify(owner, {
            id: value.id,
            title: "Can’t find the event for a reminder",
            body: `I can’t find “${event.title}” on your calendar any more. Your reminder “${value.text}” stays at ${this.describe(value)}; ask me to move or cancel it.`,
            key: `reminder-gone:${value.id}`,
          });
        continue;
      }
      const start = Date.parse(same.start);
      if (!Number.isFinite(start) || Math.abs(start - was) < 60_000) continue;
      const dueAt = new Date(Math.max(start - event.offsetMs, now + 60_000)).toISOString();
      const next = await this.db.compareAndSwap<Reminder>(
        owner,
        "reminders",
        value.id,
        { status: "upcoming", dueAt: value.dueAt },
        { dueAt, event: { ...event, start: new Date(start).toISOString() } },
      );
      if (!next) continue;
      const moved = { ...value, dueAt };
      const eventAt = this.describe({ ...value, dueAt: new Date(start).toISOString() });
      await this.notify(owner, {
        id: value.id,
        title: "Reminder moved",
        body: `“${event.title}” moved to ${eventAt}, so your reminder “${value.text}” is now at ${this.describe(moved)}.`,
        key: `reminder-moved:${value.id}:${dueAt}`,
      });
    }
  }
  /** Sends each due reminder once (claimed by compare-and-swap) and clears old sent ones. */
  async deliverDue(skip: (owner: string) => Promise<boolean> = async () => false) {
    const now = this.now();
    for (const { owner, value } of await this.db.scan<Reminder>("reminders")) {
      if (value.status === "sent") {
        if (now - Date.parse(value.sentAt ?? value.dueAt) > KEEP_SENT)
          await this.db.take(owner, "reminders", value.id);
        continue;
      }
      if (Date.parse(value.dueAt) > now || (await skip(owner))) continue;
      const claimed = await this.db.compareAndSwap<Reminder>(
        owner,
        "reminders",
        value.id,
        { status: "upcoming", dueAt: value.dueAt },
        { status: "sent", sentAt: new Date(now).toISOString() },
      );
      if (!claimed) continue;
      const late = now - Date.parse(value.dueAt) > 15 * 60000;
      await this.notify(owner, {
        id: value.id,
        title: late ? `Reminder (from ${this.describe(value)})` : "Reminder",
        body: value.text,
        key: `reminder:${value.id}:${value.dueAt}`,
      });
    }
  }
}

/** Chat tools for reminders. */
export function reminderToolSpecs(
  reminders: ReminderService,
  owner: string,
  key: (name: string, args: unknown) => string,
) {
  return [
    {
      name: "set_reminder",
      description:
        "Remind the person about something once, at a time: a notification on their devices and an update in chat. Use `at` as their local wall-clock time (YYYY-MM-DDTHH:MM, from the current date and time you were given), or `inMinutes` for a delay. When it's for something on their calendar (“30 minutes before the dentist”), find it with look_at_calendar and pass it as `event`: the reminder then moves when the event moves, and they're told. For something that repeats, create a routine instead. Confirm the time back in plain words.",
      parameters: reminderInputSchema,
      execute: (args: z.infer<typeof reminderInputSchema>) =>
        reminders.set(owner, args, key("reminder", args)),
    },
    {
      name: "list_reminders",
      description: "List the person's upcoming reminders (with ids) and ones sent recently.",
      parameters: z.object({}),
      execute: () => reminders.list(owner),
    },
    {
      name: "change_reminder",
      description:
        "Move or reword an upcoming reminder, such as “move my Monday reminder to Tuesday”. Find its id with list_reminders first.",
      parameters: reminderChangeSchema,
      execute: (args: z.infer<typeof reminderChangeSchema>) => reminders.change(owner, args),
    },
    {
      name: "cancel_reminder",
      description: "Cancel an upcoming reminder. Find its id with list_reminders first.",
      parameters: z.object({ id: z.string().min(1).max(100) }),
      execute: ({ id }: { id: string }) => reminders.cancel(owner, id),
    },
  ];
}
