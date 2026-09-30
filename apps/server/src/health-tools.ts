import { z } from "zod";
import { type HealthService, mealSchema, workoutSchema } from "./health.ts";
import type { Spaces } from "./spaces.ts";

export const healthToolInstructions =
  " To log a meal, identify the food (with look_at_image when there is a photo), estimate the portions, calories, protein, carbs and fat, then call log_meal and say the numbers are estimates. For a workout, ask about time, level and equipment only if unknown, then design a safe plan with create_workout (warm-up first, cool-down last, clear cues) and tell the person to press Start on the card. Suggest checking with a doctor if they mention an injury or medical condition. For what they've eaten, their workouts or how a week went, read get_food_log; never guess from memory. Everything logged is shown in Spaces → Health: Overview has today and the week in charts, Food log lists every meal, and Food plan puts the family's planned dinners next to what was eaten.";

/** The person's daily targets, from their health space's playbook, when set. */
export type HealthTargets = () => Promise<
  { calories?: number; protein?: number; workoutMinutes?: number } | undefined
>;

/** The targets in the person's health space, if they have one. */
export function healthTargets(spaces: Spaces, owner: string): HealthTargets {
  return async () => {
    const space = (await spaces.list(owner)).find((item) => item.kind === "health");
    if (space?.kind !== "health") return undefined;
    const { calorieTarget, proteinTarget, workoutMinutes } = space.playbook;
    return { calories: calorieTarget, protein: proteinTarget, workoutMinutes };
  };
}

/** Lets an agent log meals, read the food log and design guided workouts. */
export function healthToolSpecs(health: HealthService, owner: string, targets?: HealthTargets) {
  return [
    {
      name: "get_food_log",
      description:
        "Read what the person has eaten and their workouts, one week at a time (Monday to Sunday, in their time zone): each day's meals with calories, protein, carbs and fat, workout minutes, the weekly averages for the 8 weeks up to it, and their targets when set (calories and grams of protein a day, workout minutes a week). Numbers are estimates unless the person changed them.",
      parameters: z.object({
        week: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Any date in the week to read, YYYY-MM-DD. This week when left out."),
      }),
      execute: async ({ week }: { week?: string }) => {
        const found = await health.week(owner, week);
        return {
          today: found.today,
          weekStart: found.weekStart,
          targets: (await targets?.()) ?? "none set",
          days: found.days.map((day) => ({
            date: day.date,
            meals: day.meals.map((meal) => ({
              at: meal.at,
              meal: meal.meal,
              title: meal.title,
              calories: meal.calories,
              protein: meal.protein,
              carbs: meal.carbs,
              fat: meal.fat,
            })),
            totals: {
              calories: day.calories,
              protein: day.protein,
              carbs: day.carbs,
              fat: day.fat,
            },
            workouts: day.workouts.map((workout) => ({
              title: workout.title,
              minutes: workout.minutes,
            })),
          })),
          weeks: found.weeks,
        };
      },
    },
    {
      name: "log_meal",
      description:
        "Log a meal or snack in the person's food log, with estimated calories, protein, carbs and fat. Returns today's totals so far.",
      parameters: mealSchema,
      execute: async (args: unknown) => health.logMeal(owner, args),
    },
    {
      name: "create_workout",
      description:
        "Design a guided workout the person can follow in the app: timed steps (exercise or rest) with a short spoken cue each. The app times each step, reads the cues aloud and logs it when finished.",
      parameters: workoutSchema,
      execute: async (args: unknown) => {
        const workout = await health.saveWorkout(owner, args);
        return {
          workoutId: workout.id,
          title: workout.title,
          minutes: workout.minutes,
          steps: workout.steps,
          message:
            "Ready. The person can press Start on the card, or find it in Spaces → Health under Workouts.",
        };
      },
    },
  ];
}
