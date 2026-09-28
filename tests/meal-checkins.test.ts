import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import { HealthService } from "../apps/server/src/health.ts";
import { asksAboutMeals, MealCheckIns } from "../apps/server/src/meal-checkins.ts";
import type { Routine } from "../packages/domain/src/agent.ts";

const ZONE = "America/Chicago";
async function setUp(start: string) {
  const db = await createStore();
  let now = Date.parse(start);
  const sent: { id: string; title: string; key: string }[] = [];
  const health = new HealthService(
    db,
    async () => ZONE,
    () => now,
  );
  const checkIns = new MealCheckIns(
    db,
    health,
    async () => ZONE,
    async (_owner, note) => {
      sent.push(note);
    },
    () => now,
  );
  health.onMeal = (owner, entry) => checkIns.mealLogged(owner, entry);
  return {
    db,
    health,
    checkIns,
    sent,
    at: (iso: string) => {
      now = Date.parse(iso);
    },
  };
}

test("check-ins ask about each meal once, at its time, in the person's time zone", async () => {
  // 8:00 am in Chicago (CDT, UTC-5).
  const { db, checkIns, sent, at } = await setUp("2026-09-28T13:00:00Z");
  await checkIns.update("me", { enabled: true });
  await checkIns.due();
  assert.equal(sent.length, 0, "not before 8:30");
  at("2026-09-28T13:31:00Z");
  await checkIns.due();
  await checkIns.due();
  assert.deepEqual(
    sent.map((n) => [n.id, n.title]),
    [["2026-09-28:breakfast", "What did you have for breakfast?"]],
  );
  const { open } = await checkIns.current("me");
  assert.equal(open.length, 1);
  assert.equal(open[0]?.question, "What did you have for breakfast?");
  assert.equal(open[0]?.yesterday, undefined);
  await assert.rejects(
    checkIns.sameAsYesterday("me", "2026-09-28:breakfast"),
    /Nothing was logged for breakfast yesterday/,
  );
  // Answering in chat closes it; the agent logs the meal from what they said.
  await checkIns.answer("me", "2026-09-28:breakfast");
  assert.equal((await checkIns.current("me")).open.length, 0);
  // Lunch is skipped; nothing more is asked for it.
  at("2026-09-28T17:31:00Z");
  await checkIns.due();
  await checkIns.skip("me", "2026-09-28:lunch");
  await checkIns.due();
  assert.deepEqual(
    sent.map((n) => n.id),
    ["2026-09-28:breakfast", "2026-09-28:lunch"],
  );
  // A check-in that would fire hours late (server down) is skipped, not asked.
  at("2026-09-29T03:00:00Z");
  await checkIns.due();
  assert.equal(sent.length, 2, "dinner at 6:30 pm is too old to ask at 10 pm");
  // Nobody else is asked, and turning it off stops it.
  await checkIns.update("me", { enabled: false });
  at("2026-09-29T13:31:00Z");
  await checkIns.due();
  assert.equal(sent.length, 2);
  await db.close();
});

test("a meal logged in chat answers its check-in, and one already logged isn't asked about", async () => {
  const { db, health, checkIns, sent, at } = await setUp("2026-09-28T13:10:00Z");
  await checkIns.update("me", { enabled: true });
  // Breakfast logged before 8:30: no question at 8:30.
  await health.logMeal("me", { title: "Oatmeal", meal: "breakfast", calories: 300 });
  at("2026-09-28T13:31:00Z");
  await checkIns.due();
  assert.equal(sent.length, 0);
  // Lunch is asked, then logged from chat, which answers it.
  at("2026-09-28T17:31:00Z");
  await checkIns.due();
  assert.equal((await checkIns.current("me")).open[0]?.meal, "lunch");
  await health.logMeal("me", { title: "Turkey sandwich", meal: "lunch", calories: 520 });
  assert.equal((await checkIns.current("me")).open.length, 0);
  await db.close();
});

test("snooze asks again in an hour; same as yesterday copies yesterday's meal", async () => {
  const { db, health, checkIns, sent, at } = await setUp("2026-09-27T17:40:00Z");
  await checkIns.update("me", { enabled: true, meals: ["lunch"] });
  await health.logMeal("me", {
    title: "Chicken salad",
    items: ["chicken", "greens"],
    meal: "lunch",
    calories: 450,
    protein: 35,
  });
  at("2026-09-28T17:31:00Z");
  await checkIns.due();
  const [lunch] = (await checkIns.current("me")).open;
  assert.deepEqual(lunch?.yesterday, { title: "Chicken salad", calories: 450 });
  await checkIns.snooze("me", "2026-09-28:lunch");
  assert.equal((await checkIns.current("me")).open.length, 0, "out of the way while snoozed");
  at("2026-09-28T18:00:00Z");
  await checkIns.due();
  assert.equal(sent.length, 1);
  at("2026-09-28T18:32:00Z");
  await checkIns.due();
  assert.equal(sent.length, 2, "asked again an hour later");
  assert.notEqual(sent[0]?.key, sent[1]?.key, "a new notification, not a duplicate");
  const logged = await checkIns.sameAsYesterday("me", "2026-09-28:lunch");
  assert.equal(logged.entry.title, "Chicken salad");
  assert.equal(logged.entry.meal, "lunch");
  assert.equal(logged.today.calories, 450);
  assert.equal((await checkIns.current("me")).open.length, 0);
  // The food log groups by day, newest first.
  const history = await health.history("me");
  assert.deepEqual(
    history.days.map((d) => [d.day, d.meals.length, d.calories]),
    [
      ["2026-09-28", 1, 450],
      ["2026-09-27", 1, 450],
    ],
  );
  await db.close();
});

test("fixing a logged meal keeps the numbers the person typed", async () => {
  const { db, health } = await setUp("2026-09-28T17:40:00Z");
  const { entry } = await health.logMeal("me", { title: "Burrito", calories: 900 });
  const fixed = await health.changeMeal("me", entry.id, { meal: "lunch", calories: 700 });
  assert.equal(fixed.meal, "lunch");
  assert.equal(fixed.calories, 700);
  assert.equal(fixed.estimated, false);
  const cleared = await health.changeMeal("me", entry.id, { calories: null });
  assert.equal("calories" in cleared, false, "cleared, not kept");
  assert.equal(cleared.title, "Burrito");
  await assert.rejects(health.changeMeal("someone-else", entry.id, { calories: 1 }), /not found/);
  await db.close();
});

test("routines that asked what the person ate hand over to check-ins, once", async () => {
  const { db, checkIns } = await setUp("2026-09-28T13:00:00Z");
  const routine = (id: string, title: string, prompt: string): Routine => ({
    id,
    title,
    prompt,
    time: "12:00",
    days: [0, 1, 2, 3, 4, 5, 6],
    timeZone: ZONE,
    enabled: true,
    nextRunAt: "2026-09-28T17:00:00Z",
    createdAt: "2026-09-01T00:00:00Z",
  });
  for (const r of [
    routine("r1", "Breakfast check", "Ask me what I ate for breakfast and log it."),
    routine("r2", "Lunch check", "Ask Mark what he had for lunch."),
    routine("r3", "Dinner reminder", "Remind me to cook dinner."),
    routine("r4", "Morning brief", "Summarize my email and calendar."),
  ])
    await db.put("me", "routines", r);
  assert.equal(asksAboutMeals({ title: "Food diary", prompt: "Track my meals" }), true);
  await checkIns.adoptMealRoutines();
  const settings = await checkIns.settings("me");
  assert.equal(settings.enabled, true);
  assert.deepEqual(settings.times, { breakfast: "08:30", lunch: "12:30", dinner: "18:30" });
  const enabled = async (id: string) => (await db.get<Routine>("me", "routines", id))?.enabled;
  assert.equal(await enabled("r1"), false);
  assert.equal(await enabled("r2"), false);
  assert.equal(await enabled("r3"), true, "cooking dinner isn't asking what they ate");
  assert.equal(await enabled("r4"), true);
  assert.deepEqual((await checkIns.replaced("me")).map((r) => r.id).sort(), ["r1", "r2"]);
  // Switched back on by the person: never switched off again.
  await db.compareAndSwap("me", "routines", "r1", {}, { enabled: true });
  await checkIns.adoptMealRoutines();
  assert.equal(await enabled("r1"), true);
  await db.close();
});
