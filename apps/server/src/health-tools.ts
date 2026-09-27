import { type HealthService, mealSchema, workoutSchema } from "./health.ts";

export const healthToolInstructions =
  " To log a meal, identify the food (with look_at_image when there is a photo), estimate the portions, calories, protein, carbs and fat, then call log_meal and say the numbers are estimates. For a workout, ask about time, level and equipment only if unknown, then design a safe plan with create_workout (warm-up first, cool-down last, clear cues) and tell the person to press Start on the card. Suggest checking with a doctor if they mention an injury or medical condition.";

/** Lets an agent log meals and design guided workouts. */
export function healthToolSpecs(health: HealthService, owner: string) {
  return [
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
          message: "Ready. The person can press Start on the card, or find it under Goals.",
        };
      },
    },
  ];
}
