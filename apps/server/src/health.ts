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
export interface Workout extends z.infer<typeof workoutSchema> {
  id: string;
  minutes: number;
  createdAt: string;
}

/** The local date (YYYY-MM-DD) of an instant in a time zone. */
const localDay = (at: string | number, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));

/** Meals and workouts the person logs, and the workout plans the agent designs. */
export class HealthService {
  constructor(
    private readonly db: Store,
    private readonly timeZone: (owner: string) => Promise<string>,
    private readonly now: () => number = Date.now,
  ) {}
  async logMeal(owner: string, raw: unknown) {
    const meal = mealSchema.parse(raw);
    const entry: HealthEntry = {
      id: randomUUID(),
      kind: "meal",
      at: new Date(this.now()).toISOString(),
      ...meal,
    };
    await this.db.put(owner, "health-log", entry);
    return { entry, today: (await this.summary(owner)).today };
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
