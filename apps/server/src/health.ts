import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

const amount = (max: number) => z.number().min(0).max(max).optional();
export const mealSchema = z.object({
  title: z.string().trim().min(1).max(160),
  items: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  meal: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  calories: amount(10000),
  protein: amount(1000),
  carbs: amount(1000),
  fat: amount(1000),
  /** The photo it was estimated from, if any. */
  fileId: z.string().max(200).optional(),
  /** True when the numbers are the agent's estimate rather than the person's. */
  estimated: z.boolean().default(true),
});
export const workoutSchema = z.object({
  title: z.string().trim().min(1).max(120),
  level: z.enum(["easy", "moderate", "hard"]).default("moderate"),
  steps: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        seconds: z.number().int().min(5).max(1800),
        cue: z.string().trim().max(300).default(""),
      }),
    )
    .min(1)
    .max(40),
});
export interface HealthEntry {
  id: string;
  kind: "meal" | "workout";
  title: string;
  at: string;
  items?: string[];
  meal?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  estimated?: boolean;
  fileId?: string;
  minutes?: number;
  workoutId?: string;
}
/** Fixing a logged meal: its name, which meal it was, or the numbers. */
export const mealChangeSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  meal: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  /** null clears a number the person isn't sure of. */
  calories: amount(10000).nullable(),
  protein: amount(1000).nullable(),
  carbs: amount(1000).nullable(),
  fat: amount(1000).nullable(),
});
export interface Workout extends z.infer<typeof workoutSchema> {
  id: string;
  minutes: number;
  createdAt: string;
}

/** The local date (YYYY-MM-DD) of an instant in a time zone. */
export const localDay = (at: string | number, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));

/** A calendar date (YYYY-MM-DD) moved by whole days. */
export function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
/** The Monday on or before a calendar date: weeks start on Monday, as on the family board. */
export const mondayOf = (day: string) =>
  addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

export interface HealthDay {
  date: string;
  meals: HealthEntry[];
  workouts: HealthEntry[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  workoutMinutes: number;
}
/** One past week at a glance, for the trend. */
export interface HealthWeekSummary {
  weekStart: string;
  /** Days with at least one meal logged. */
  daysLogged: number;
  /** Per logged day, so a day with nothing logged doesn't pull it down. */
  averageCalories: number;
  averageProtein: number;
  workoutMinutes: number;
}

/** Meals and workouts the person logs, and the workout plans the agent designs. */
export class HealthService {
  constructor(
    private readonly db: Store,
    private readonly timeZone: (owner: string) => Promise<string>,
    private readonly now: () => number = Date.now,
  ) {}
  /** Told about each meal logged, so a check-in for that meal is answered too. */
  onMeal?: (owner: string, entry: HealthEntry) => Promise<void>;
  async logMeal(owner: string, raw: unknown) {
    const meal = mealSchema.parse(raw);
    const entry: HealthEntry = {
      id: randomUUID(),
      kind: "meal",
      at: new Date(this.now()).toISOString(),
      ...meal,
    };
    await this.db.put(owner, "health-log", entry);
    await this.onMeal?.(owner, entry);
    return { entry, today: (await this.summary(owner)).today };
  }
  async changeMeal(owner: string, id: string, raw: unknown) {
    const change = mealChangeSchema.parse(raw);
    const current = await this.db.get<HealthEntry>(owner, "health-log", id);
    if (current?.kind !== "meal") throw new AppError("Entry not found", 404);
    const numbers = ["calories", "protein", "carbs", "fat"] as const;
    const { calories, protein, carbs, fat, ...words } = change;
    const entry: HealthEntry = { ...current, ...words };
    for (const [key, value] of Object.entries({ calories, protein, carbs, fat }))
      if (value === null) delete entry[key as (typeof numbers)[number]];
      else if (value !== undefined) entry[key as (typeof numbers)[number]] = value;
    // Numbers the person typed are theirs, not an estimate.
    if (numbers.some((key) => change[key] !== undefined)) entry.estimated = false;
    await this.db.put(owner, "health-log", entry);
    await this.onMeal?.(owner, entry);
    return entry;
  }
  /** The food log by local day, newest first, with each day's totals. */
  async history(owner: string, days = 30) {
    const zone = await this.timeZone(owner);
    const since = this.now() - Math.min(Math.max(days, 1), 366) * 24 * 60 * 60 * 1000;
    const meals = (await this.db.list<HealthEntry>(owner, "health-log"))
      .filter((entry) => entry.kind === "meal" && Date.parse(entry.at) >= since)
      .sort((a, b) => b.at.localeCompare(a.at));
    const byDay = new Map<string, HealthEntry[]>();
    for (const meal of meals) {
      const day = localDay(meal.at, zone);
      byDay.set(day, [...(byDay.get(day) ?? []), meal]);
    }
    const sum = (entries: HealthEntry[], key: "calories" | "protein" | "carbs" | "fat") =>
      Math.round(entries.reduce((total, entry) => total + (entry[key] ?? 0), 0));
    return {
      today: localDay(this.now(), zone),
      days: [...byDay].map(([day, entries]) => ({
        day,
        meals: entries,
        calories: sum(entries, "calories"),
        protein: sum(entries, "protein"),
        carbs: sum(entries, "carbs"),
        fat: sum(entries, "fat"),
      })),
    };
  }
  async saveWorkout(owner: string, raw: unknown) {
    const plan = workoutSchema.parse(raw);
    const workout: Workout = {
      ...plan,
      id: randomUUID(),
      minutes: Math.max(
        1,
        Math.round(plan.steps.reduce((sum, step) => sum + step.seconds, 0) / 60),
      ),
      createdAt: new Date(this.now()).toISOString(),
    };
    await this.db.put(owner, "workouts", workout);
    return workout;
  }
  async completeWorkout(owner: string, id: string, seconds: number) {
    const workout = await this.db.get<Workout>(owner, "workouts", id);
    if (!workout) throw new AppError("Workout not found", 404);
    const entry: HealthEntry = {
      id: randomUUID(),
      kind: "workout",
      title: workout.title,
      at: new Date(this.now()).toISOString(),
      minutes: Math.max(1, Math.round(Math.min(seconds, 4 * 3600) / 60)),
      workoutId: id,
    };
    await this.db.put(owner, "health-log", entry);
    return entry;
  }
  async remove(owner: string, id: string) {
    if (!(await this.db.take(owner, "health-log", id))) throw new AppError("Entry not found", 404);
    return { ok: true };
  }
  /**
   * A week, Monday to Sunday, in the person's time zone: each day's meals, workouts and totals,
   * and the weeks before it at a glance (`weeks`, oldest first, this one last).
   */
  async week(owner: string, start?: string, weeksBack = 8) {
    const zone = await this.timeZone(owner);
    const today = localDay(this.now(), zone);
    const weekStart = mondayOf(start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : today);
    const first = addDays(weekStart, -7 * (weeksBack - 1));
    const end = addDays(weekStart, 7);
    const entries = (await this.db.list<HealthEntry>(owner, "health-log"))
      .map((entry) => ({ entry, day: localDay(entry.at, zone) }))
      .filter(({ day }) => day >= first && day < end)
      .sort((a, b) => a.entry.at.localeCompare(b.entry.at));
    const dayOf = (date: string): HealthDay => {
      const on = entries.filter(({ day }) => day === date).map(({ entry }) => entry);
      const meals = on.filter((entry) => entry.kind === "meal");
      const sum = (key: "calories" | "protein" | "carbs" | "fat") =>
        Math.round(meals.reduce((total, entry) => total + (entry[key] ?? 0), 0));
      const workouts = on.filter((entry) => entry.kind === "workout");
      return {
        date,
        meals,
        workouts,
        calories: sum("calories"),
        protein: sum("protein"),
        carbs: sum("carbs"),
        fat: sum("fat"),
        workoutMinutes: workouts.reduce((total, entry) => total + (entry.minutes ?? 0), 0),
      };
    };
    const weekOf = (monday: string): HealthWeekSummary => {
      const days = Array.from({ length: 7 }, (_, index) => dayOf(addDays(monday, index)));
      const logged = days.filter((day) => day.meals.length);
      const average = (key: "calories" | "protein") =>
        logged.length
          ? Math.round(logged.reduce((total, day) => total + day[key], 0) / logged.length)
          : 0;
      return {
        weekStart: monday,
        daysLogged: logged.length,
        averageCalories: average("calories"),
        averageProtein: average("protein"),
        workoutMinutes: days.reduce((total, day) => total + day.workoutMinutes, 0),
      };
    };
    return {
      today,
      weekStart,
      days: Array.from({ length: 7 }, (_, index) => dayOf(addDays(weekStart, index))),
      weeks: Array.from({ length: weeksBack }, (_, index) => weekOf(addDays(first, 7 * index))),
    };
  }
  /** The last week of entries, today's totals and recent workout plans. */
  async summary(owner: string) {
    const zone = await this.timeZone(owner);
    const today = localDay(this.now(), zone);
    const weekAgo = this.now() - 7 * 24 * 60 * 60 * 1000;
    const entries = (await this.db.list<HealthEntry>(owner, "health-log"))
      .filter((entry) => Date.parse(entry.at) >= weekAgo)
      .sort((a, b) => b.at.localeCompare(a.at));
    const todays = entries.filter((entry) => localDay(entry.at, zone) === today);
    const total = (key: "calories" | "protein" | "carbs" | "fat" | "minutes") =>
      Math.round(todays.reduce((sum, entry) => sum + (entry[key] ?? 0), 0));
    const workouts = (await this.db.list<Workout>(owner, "workouts"))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10);
    return {
      today: {
        meals: todays.filter((e) => e.kind === "meal").length,
        /** Which meals are logged today: breakfast, lunch, dinner, snack. */
        logged: [...new Set(todays.flatMap((e) => (e.kind === "meal" && e.meal ? [e.meal] : [])))],
        calories: total("calories"),
        protein: total("protein"),
        carbs: total("carbs"),
        fat: total("fat"),
        workoutMinutes: total("minutes"),
      },
      entries,
      workouts,
    };
  }
}
