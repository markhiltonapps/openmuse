import { z } from "zod";
import type { Routine } from "../../../packages/domain/src/agent.ts";
import type { Store } from "./db.ts";
import { localInstant } from "./engine/routines.ts";
import { AppError } from "./errors.ts";
import { type HealthEntry, type HealthService, localDay } from "./health.ts";

/**
 * Meal check-ins: at set times the app asks "What did you have for lunch?", and the person answers
 * from a card in chat by talking or typing, or with Skipped it, Same as yesterday or Remind me
 * later. One setting for all three meals, instead of three routines that each start a task.
 */
export const MEALS = ["breakfast", "lunch", "dinner"] as const;
export type Meal = (typeof MEALS)[number];
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 08:30");
export const checkInSettingsSchema = z.object({
  enabled: z.boolean(),
  times: z.object({ breakfast: hhmm, lunch: hhmm, dinner: hhmm }),
  /** Meals to ask about; the others stay quiet. */
  meals: z
    .array(z.enum(MEALS))
    .max(3)
    .transform((meals) => MEALS.filter((meal) => meals.includes(meal))),
  /** Days to ask on, 0 = Sunday. */
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .transform((days) => [...new Set(days)].sort()),
});
export type CheckInSettings = z.infer<typeof checkInSettingsSchema> & {
  id: "settings";
  updatedAt: string;
  /** Routines that asked about meals before check-ins, switched off when check-ins took over. */
  replacedRoutines?: string[];
};
export const DEFAULT_CHECKINS: z.infer<typeof checkInSettingsSchema> = {
  enabled: false,
  times: { breakfast: "08:30", lunch: "12:30", dinner: "18:30" },
  meals: [...MEALS],
  days: [0, 1, 2, 3, 4, 5, 6],
};

export interface CheckIn {
  /** `${day}:${meal}`, so each meal is asked about once a day. */
  id: string;
  day: string;
  meal: Meal;
  status: "open" | "snoozed" | "answered" | "skipped";
  askedAt: string;
  /** When a snoozed check-in asks again. */
  remindAt?: string;
  closedAt?: string;
}
/** A check-in that fires this late (the server was down) is skipped rather than asked. */
const TOO_LATE = 3 * 60 * 60 * 1000;
/** Check-ins are kept for this long, then cleared away; the food log keeps the meals. */
const KEEP = 14 * 24 * 60 * 60 * 1000;
export const SNOOZE_MINUTES = 60;

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const previousDay = (day: string) =>
  new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
export const mealQuestion = (meal: string) =>
  meal === "breakfast"
    ? "What did you have for breakfast?"
    : meal === "lunch"
      ? "What did you have for lunch?"
      : "What did you have for dinner?";

/** Routines people set up before check-ins existed to be asked what they ate. */
const ASKS_ABOUT_MEALS = [
  /\bwhat\b[^.?!\n]{0,40}\b(ate|eaten|eat|had for|have for)\b/i,
  /\b(log|track|record)\w*\b[^.?!\n]{0,30}\b(food|meals?|breakfast|lunch|dinner|snacks?|calories)\b/i,
  /\bmeal check.?ins?\b|\bfood (log|diary|journal)\b/i,
];
export const asksAboutMeals = (routine: Pick<Routine, "title" | "prompt">) =>
  ASKS_ABOUT_MEALS.some((pattern) => pattern.test(`${routine.title}\n${routine.prompt}`));

export class MealCheckIns {
  constructor(
    private readonly db: Store,
    private readonly health: HealthService,
    private readonly timeZone: (owner: string) => Promise<string>,
    private readonly notify: (
      owner: string,
      note: { id: string; title: string; body: string; key: string },
    ) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}
  async settings(owner: string): Promise<CheckInSettings> {
    return (
      (await this.db.get<CheckInSettings>(owner, "meal-checkin-settings", "settings")) ?? {
        id: "settings",
        ...DEFAULT_CHECKINS,
        updatedAt: new Date(0).toISOString(),
      }
    );
  }
  async update(owner: string, raw: unknown) {
    const current = await this.settings(owner);
    const input = checkInSettingsSchema.parse({ ...current, ...(raw as object) });
    return this.db.put(owner, "meal-checkin-settings", {
      ...current,
      ...input,
      id: "settings",
      updatedAt: new Date(this.now()).toISOString(),
    } satisfies CheckInSettings);
  }
  /** The routines check-ins took over, to show them and switch them back on. */
  async replaced(owner: string) {
    const ids = new Set((await this.settings(owner)).replacedRoutines ?? []);
    return (await this.db.list<Routine>(owner, "routines"))
      .filter((routine) => ids.has(routine.id))
      .map(({ id, title, time, enabled }) => ({ id, title, time, enabled }));
  }
  /**
   * For people who asked to be reminded what they ate before check-ins existed: turns check-ins on
   * at the usual times and switches off (never deletes) the routines that did the asking. Runs once
   * per person; after that, their settings are theirs.
   */
  async adoptMealRoutines() {
    const byOwner = new Map<string, Routine[]>();
    for (const { owner, value } of await this.db.scan<Routine>("routines"))
      if (value.enabled && asksAboutMeals(value))
        byOwner.set(owner, [...(byOwner.get(owner) ?? []), value]);
    for (const [owner, routines] of byOwner) {
      const settings: CheckInSettings = {
        id: "settings",
        ...DEFAULT_CHECKINS,
        enabled: true,
        updatedAt: new Date(this.now()).toISOString(),
        replacedRoutines: routines.map((r) => r.id),
      };
      if (!(await this.db.insertIfAbsent(owner, "meal-checkin-settings", settings))) continue;
      for (const routine of routines)
        await this.db.compareAndSwap<Routine>(
          owner,
          "routines",
          routine.id,
          { enabled: true },
          { enabled: false },
        );
    }
  }
  /** Meals logged on a local day, by meal. */
  private async logged(owner: string, day: string, zone: string) {
    return (await this.db.list<HealthEntry>(owner, "health-log")).filter(
      (entry) => entry.kind === "meal" && localDay(entry.at, zone) === day,
    );
  }
  /** Asks about each meal once a day at its time, and again when a snooze runs out. */
  async due(skip: (owner: string) => Promise<boolean> = async () => false) {
    const now = this.now();
    for (const { owner, value: settings } of await this.db.scan<CheckInSettings>(
      "meal-checkin-settings",
    )) {
      if (!settings.enabled || (await skip(owner))) continue;
      const zone = await this.timeZone(owner);
      const today = localDay(now, zone);
      if (!settings.days.includes(weekday(today))) continue;
      for (const meal of settings.meals) {
        const at = localInstant(`${today}T${settings.times[meal]}`, zone);
        if (at > now || now - at > TOO_LATE) continue;
        if (await this.db.get(owner, "meal-checkins", `${today}:${meal}`)) continue;
        // Already logged (in chat, from a photo): nothing to ask.
        const already = (await this.logged(owner, today, zone)).some((e) => e.meal === meal);
        const checkIn: CheckIn = {
          id: `${today}:${meal}`,
          day: today,
          meal,
          status: already ? "answered" : "open",
          askedAt: new Date(now).toISOString(),
          ...(already ? { closedAt: new Date(now).toISOString() } : {}),
        };
        // Inserted once, so a meal is asked about once even with several servers.
        if (!(await this.db.insertIfAbsent(owner, "meal-checkins", checkIn)) || already) continue;
        await this.ask(owner, checkIn);
      }
    }
    for (const { owner, value } of await this.db.scan<CheckIn>("meal-checkins")) {
      if (now - Date.parse(value.askedAt) > KEEP) {
        await this.db.take(owner, "meal-checkins", value.id);
        continue;
      }
      if (value.status !== "snoozed" || !value.remindAt || Date.parse(value.remindAt) > now)
        continue;
      if (await skip(owner)) continue;
      const claimed = await this.db.compareAndSwap<CheckIn>(
        owner,
        "meal-checkins",
        value.id,
        { status: "snoozed", remindAt: value.remindAt },
        { status: "open" },
      );
      if (claimed) await this.ask(owner, value, value.remindAt);
    }
  }
  private ask(owner: string, checkIn: CheckIn, again?: string) {
    return this.notify(owner, {
      id: checkIn.id,
      title: mealQuestion(checkIn.meal),
      body: "Tap to answer. You can say it out loud or type it.",
      key: `meal-checkin:${checkIn.id}${again ? `:${again}` : ""}`,
    });
  }
  private async get(owner: string, id: string) {
    const checkIn = await this.db.get<CheckIn>(owner, "meal-checkins", id);
    if (!checkIn) throw new AppError("That check-in has already been cleared away.", 404);
    return checkIn;
  }
  private close(owner: string, id: string, status: "answered" | "skipped") {
    return this.db.compareAndSwap<CheckIn>(
      owner,
      "meal-checkins",
      id,
      {},
      { status, closedAt: new Date(this.now()).toISOString() },
    );
  }
  /** Today's open check-ins, latest meal first, each with what was logged the day before. */
  async current(owner: string) {
    const zone = await this.timeZone(owner);
    const today = localDay(this.now(), zone);
    const yesterday = await this.logged(owner, previousDay(today), zone);
    const open = (await this.db.list<CheckIn>(owner, "meal-checkins"))
      .filter((c) => c.day === today && c.status === "open")
      .sort((a, b) => MEALS.indexOf(b.meal) - MEALS.indexOf(a.meal));
    return {
      open: open.map((checkIn) => {
        const last = yesterday
          .filter((e) => e.meal === checkIn.meal)
          .sort((a, b) => b.at.localeCompare(a.at))[0];
        return {
          ...checkIn,
          question: mealQuestion(checkIn.meal),
          ...(last ? { yesterday: { title: last.title, calories: last.calories } } : {}),
        };
      }),
    };
  }
  /** The person answered in chat; the agent logs the meal from what they said. */
  async answer(owner: string, id: string) {
    await this.get(owner, id);
    await this.close(owner, id, "answered");
    return { ok: true };
  }
  async skip(owner: string, id: string) {
    await this.get(owner, id);
    await this.close(owner, id, "skipped");
    return { ok: true };
  }
  async snooze(owner: string, id: string, minutes = SNOOZE_MINUTES) {
    await this.get(owner, id);
    const remindAt = new Date(this.now() + minutes * 60_000).toISOString();
    await this.db.compareAndSwap<CheckIn>(
      owner,
      "meal-checkins",
      id,
      {},
      { status: "snoozed", remindAt },
    );
    return { remindAt };
  }
  /** Logs the same meal as the day before, as a new entry. */
  async sameAsYesterday(owner: string, id: string) {
    const checkIn = await this.get(owner, id);
    const zone = await this.timeZone(owner);
    const last = (await this.logged(owner, previousDay(checkIn.day), zone))
      .filter((e) => e.meal === checkIn.meal)
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!last)
      throw new AppError(
        `Nothing was logged for ${checkIn.meal} yesterday. Say or type what you had instead.`,
        404,
      );
    const logged = await this.health.logMeal(owner, {
      title: last.title,
      items: last.items ?? [],
      meal: checkIn.meal,
      calories: last.calories,
      protein: last.protein,
      carbs: last.carbs,
      fat: last.fat,
      estimated: last.estimated ?? true,
    });
    await this.close(owner, id, "answered");
    return logged;
  }
  /** A meal logged any other way (in chat, from a photo) answers that meal's check-in too. */
  async mealLogged(owner: string, entry: HealthEntry) {
    if (entry.kind !== "meal" || !entry.meal || entry.meal === "snack") return;
    const day = localDay(entry.at, await this.timeZone(owner));
    const id = `${day}:${entry.meal}`;
    const checkIn = await this.db.get<CheckIn>(owner, "meal-checkins", id);
    if (checkIn && (checkIn.status === "open" || checkIn.status === "snoozed"))
      await this.close(owner, id, "answered");
  }
}

export const checkInInstructions =
  " When the person wants to be asked what they ate (a few times a day, at meals), use set_meal_checkins, not a routine: the app asks at each meal time and they answer by voice or text from a card in chat. When a message says “Log my breakfast/lunch/dinner: …”, log it with log_meal and that meal type, then reply in one short line with the estimate.";

export function checkInToolSpecs(checkIns: MealCheckIns, owner: string) {
  return [
    {
      name: "set_meal_checkins",
      description:
        "Turn meal check-ins on or off, or change their times: the app asks “What did you have for lunch?” at each meal time, and the person answers by talking or typing. Times are 24-hour HH:MM in their time zone (defaults 08:30, 12:30, 18:30). meals picks which meals to ask about; days use 0 = Sunday.",
      parameters: z.object({
        enabled: z.boolean(),
        times: z.object({ breakfast: hhmm, lunch: hhmm, dinner: hhmm }).partial().optional(),
        meals: z.array(z.enum(MEALS)).max(3).optional(),
        days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
      }),
      execute: async (input: {
        enabled: boolean;
        times?: Partial<Record<Meal, string>>;
        meals?: Meal[];
        days?: number[];
      }) => {
        const current = await checkIns.settings(owner);
        const settings = await checkIns.update(owner, {
          ...input,
          times: { ...current.times, ...input.times },
        });
        return {
          enabled: settings.enabled,
          times: settings.times,
          meals: settings.meals,
          days: settings.days,
          next: "Confirm the times in plain words (for example 8:30 am, 12:30 pm and 6:30 pm). Tell them the questions show up as a notification and as a card just above the chat box, and their food log is in Feed under Today: tap View food log.",
        };
      },
    },
  ];
}
