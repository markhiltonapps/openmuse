import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { HealthService } from "../apps/server/src/health.ts";
import { healthToolSpecs } from "../apps/server/src/health-tools.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close();
});

test("meals add up for the person's own day and workouts are logged when finished", async () => {
  let now = Date.parse("2026-09-27T04:30:00Z"); // 11:30 pm the day before in Chicago
  const health = new HealthService(
    db,
    async () => "America/Chicago",
    () => now,
  );
  const owner = "eater";
  const [logMeal, createWorkout] = healthToolSpecs(health, owner);
  await logMeal?.execute({ title: "Late snack", calories: 200, protein: 5 });
  now = Date.parse("2026-09-27T13:00:00Z"); // 8 am
  const breakfast = (await logMeal?.execute({
    title: "Eggs and toast",
    items: ["2 eggs", "1 slice toast"],
    meal: "breakfast",
    calories: 350.4,
    protein: 20,
    carbs: 25,
    fat: 18,
  })) as { entry: { id: string; estimated: boolean }; today: { calories: number } };
  assert.equal(breakfast.entry.estimated, true);
  // Last night's snack belongs to yesterday.
  assert.equal(breakfast.today.calories, 350);
  await assert.rejects(Promise.resolve(logMeal?.execute({ title: "", calories: -1 })));

  const workout = (await createWorkout?.execute({
    title: "Quick morning",
    steps: [
      { name: "March in place", seconds: 60, cue: "Warm up" },
      { name: "Squats", seconds: 45 },
      { name: "Stretch", seconds: 75 },
    ],
  })) as { workoutId: string; minutes: number };
  assert.equal(workout.minutes, 3);
  await health.completeWorkout(owner, workout.workoutId, 170);
  const summary = await health.summary(owner);
  assert.deepEqual(summary.today, {
    meals: 1,
    calories: 350,
    protein: 20,
    carbs: 25,
    fat: 18,
    workoutMinutes: 3,
  });
  assert.equal(summary.entries.length, 3);
  assert.equal(summary.workouts[0]?.title, "Quick morning");
  await health.remove(owner, breakfast.entry.id);
  assert.equal((await health.summary(owner)).today.calories, 0);
  await assert.rejects(health.completeWorkout("someone-else", workout.workoutId, 60), /not found/);
});
