import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { addDays, HealthService, mondayOf } from "../apps/server/src/health.ts";
import { healthToolSpecs } from "../apps/server/src/health-tools.ts";

let db: Store;
type Tools = ReturnType<typeof healthToolSpecs>;
/** A tool by name, called with plain arguments the way the agent calls it. */
const toolNamed = (tools: Tools, name: string) => {
  const found = tools.find((tool) => tool.name === name);
  return found && { execute: found.execute as (args: Record<string, unknown>) => Promise<unknown> };
};
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
  const tools = healthToolSpecs(health, owner);
  const logMeal = toolNamed(tools, "log_meal");
  const createWorkout = toolNamed(tools, "create_workout");
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
    logged: ["breakfast"],
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

test("the food log reads a week at a time, Monday to Sunday in the person's own days", async () => {
  // Wednesday, Sep 30, 2026, 9 am in Chicago.
  let now = Date.parse("2026-09-30T14:00:00Z");
  const health = new HealthService(
    db,
    async () => "America/Chicago",
    () => now,
  );
  const owner = "weekly-eater";
  const tools = healthToolSpecs(health, owner, async () => ({ calories: 2000, protein: 120 }));
  const log = toolNamed(tools, "log_meal");
  const read = toolNamed(tools, "get_food_log");
  assert.equal(mondayOf("2026-09-30"), "2026-09-28");
  assert.equal(mondayOf("2026-09-28"), "2026-09-28");
  assert.equal(mondayOf("2026-10-04"), "2026-09-28");
  assert.equal(addDays("2026-09-28", -7), "2026-09-21");

  await log?.execute({ title: "Oatmeal", meal: "breakfast", calories: 400, protein: 15 });
  now = Date.parse("2026-09-30T18:00:00Z");
  await log?.execute({ title: "Chicken salad", meal: "lunch", calories: 600, protein: 45 });
  // Sunday 11:30 pm in Chicago is still last week there, though it's Monday in UTC.
  now = Date.parse("2026-09-28T04:30:00Z");
  await log?.execute({ title: "Popcorn", meal: "snack", calories: 300, protein: 5 });

  now = Date.parse("2026-09-30T20:00:00Z");
  const week = (await read?.execute({})) as {
    weekStart: string;
    targets: { calories: number };
    days: { date: string; meals: { title: string }[]; totals: { calories: number } }[];
    weeks: { weekStart: string; daysLogged: number; averageCalories: number }[];
  };
  assert.equal(week.weekStart, "2026-09-28");
  assert.equal(week.targets.calories, 2000);
  assert.deepEqual(
    week.days.map((day) => day.date),
    [
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ],
  );
  assert.equal(week.days[2]?.totals.calories, 1000);
  assert.deepEqual(
    week.days[2]?.meals.map((meal) => meal.title),
    ["Oatmeal", "Chicken salad"],
  );
  assert.equal(week.days[0]?.meals.length, 0);
  // The trend: 8 weeks, this one last; the popcorn is last week's Sunday.
  assert.equal(week.weeks.length, 8);
  assert.deepEqual(week.weeks.at(-1), {
    weekStart: "2026-09-28",
    daysLogged: 1,
    averageCalories: 1000,
    averageProtein: 60,
    workoutMinutes: 0,
  });
  assert.equal(week.weeks.at(-2)?.averageCalories, 300);

  const last = (await read?.execute({ week: "2026-09-27" })) as { weekStart: string };
  assert.equal(last.weekStart, "2026-09-21");
});

test("weigh-ins: one a day in pounds, kilograms converted, and how it compares", async () => {
  let now = Date.parse("2026-09-24T13:00:00Z"); // 8 am in Chicago
  const health = new HealthService(
    db,
    async () => "America/Chicago",
    () => now,
  );
  const owner = "weigher";
  const tools = healthToolSpecs(health, owner);
  const log = toolNamed(tools, "log_weight");
  const history = toolNamed(tools, "get_weight_history");
  const remove = toolNamed(tools, "remove_weight");
  const first = (await log?.execute({ pounds: 175 })) as {
    entry: { day: string };
    change?: number;
  };
  assert.equal(first.entry.day, "2026-09-24");
  assert.equal(first.change, undefined);
  now = Date.parse("2026-09-30T13:00:00Z");
  await log?.execute({ kilograms: 79.5 }); // 175.3 lb
  now = Date.parse("2026-10-01T13:00:00Z");
  // "I weighed 173 this morning": compared with yesterday and about a week ago.
  const today = (await log?.execute({ pounds: 173 })) as {
    entry: { day: string; pounds: number };
    unit: string;
    change: number;
    changeSinceWeekAgo: number;
    weekAgo: { day: string };
  };
  assert.equal(today.unit, "lb");
  assert.equal(today.entry.pounds, 173);
  assert.equal(today.change, -2.3);
  assert.equal(today.weekAgo.day, "2026-09-24");
  assert.equal(today.changeSinceWeekAgo, -2);
  assert.equal((today as { replaced?: number }).replaced, undefined);
  // A second weigh-in the same day replaces the first, and says what it replaced.
  const again = (await log?.execute({ pounds: 172.6 })) as { replaced?: number };
  assert.equal(again.replaced, 173);
  const listed = (await history?.execute({})) as
    | { entries: { day: string; pounds: number }[] }
    | undefined;
  const days = listed?.entries ?? [];
  assert.deepEqual(
    days.map((entry) => [entry.day, entry.pounds]),
    [
      ["2026-09-24", 175],
      ["2026-09-30", 175.3],
      ["2026-10-01", 172.6],
    ],
  );
  // A day they name, but not one that hasn't happened.
  await log?.execute({ pounds: 176, date: "2026-09-20" });
  await assert.rejects(
    log?.execute({ pounds: 170, date: "2026-10-02" }) ?? Promise.resolve(),
    /hasn't happened/,
  );
  await assert.rejects(log?.execute({}) ?? Promise.resolve(), /pounds or kilograms/);
  // A wrong one comes off.
  await remove?.execute({ date: "2026-09-20" });
  assert.equal((await health.weights(owner)).entries.length, 3);
  await assert.rejects(health.removeWeight(owner, "2026-09-20"), /already removed/);
});
