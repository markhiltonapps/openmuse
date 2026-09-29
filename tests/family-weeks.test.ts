import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { FamilyWeeks, localToday, mondayOf } from "../apps/server/src/family-weeks.ts";
import { Spaces } from "../apps/server/src/spaces.ts";
import { dishEmoji, type FamilyWeek } from "../packages/domain/src/family-week.ts";

let db: Store, directory: string;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-weeks-"));
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});
const LA = "America/Los_Angeles";

test("weeks start on Monday in the family's own time zone", () => {
  // 2 AM Tuesday in London is still Monday evening in Los Angeles.
  const late = new Date("2026-09-29T02:00:00Z");
  assert.deepEqual(localToday(LA, late), { date: "2026-09-28", day: 0 });
  assert.deepEqual(localToday("Europe/London", late), { date: "2026-09-29", day: 1 });
  assert.equal(mondayOf("2026-10-04"), "2026-09-28");
  assert.equal(mondayOf("2026-10-04", 1), "2026-10-05");
  assert.equal(mondayOf("2026-09-28"), "2026-09-28");
  assert.equal(dishEmoji({ dish: "Taco night" }), "🌮");
  assert.equal(dishEmoji({ dish: "Grandma cooks" }), "🍽️");
  assert.equal(dishEmoji({ dish: "Anything", emoji: "🥘" }), "🥘");
});

test("a planned week keeps ticks and stars when it's rewritten, and becomes a past week", async () => {
  let now = new Date("2026-09-29T16:00:00Z"); // Tuesday
  const weeks = new FamilyWeeks(db, () => now);
  const saved = await weeks.save(
    "ana",
    "fam",
    {
      summary: "Swim starts Tuesday",
      dinners: [
        { day: "Tuesday", dish: "Sheet-pan chicken", note: "35 min" },
        { day: "Monday", dish: "Pesto pasta", emoji: "🍝" },
      ],
      schedule: [{ day: "Tuesday", time: "4:30 PM", title: "Swim", who: "Maya · Sam drives" }],
      groceries: [
        { item: "Chicken thighs", qty: "8", aisle: "Meat and fish" },
        { item: "Pesto", aisle: "Pantry" },
      ],
      chores: [{ who: "Maya", task: "Set the table" }],
      ideas: [{ title: "Dinosaur hall", for: "Maya", when: "Saturday" }],
    },
    LA,
  );
  assert.equal(saved.week, "this");
  assert.equal(saved.weekStart, "2026-09-28");
  let board = await weeks.board("ana", "fam", LA);
  assert.equal(board.today, 1);
  const week = board.week as FamilyWeek;
  assert.deepEqual(
    week.dinners.map((d) => [d.day, d.dish]),
    [
      [0, "Pesto pasta"],
      [1, "Sheet-pan chicken"],
    ],
  );
  // The family ticks off chicken and stamps Maya's Monday.
  const chicken = week.groceries.find((g) => g.item === "Chicken thighs");
  await weeks.setGrocery("ana", "fam", "2026-09-28", chicken?.id ?? "", { done: true });
  const chore = week.chores[0];
  await weeks.stamp("ana", "fam", "2026-09-28", chore?.id ?? "", { day: 0, done: true });
  await assert.rejects(
    weeks.stamp("ana", "fam", "2026-09-28", chore?.id ?? "", { day: 9, done: true }),
    /Unknown day/,
  );
  // The agent rewrites the list and chores: what was done stays done; added items aren't doubled.
  await weeks.save(
    "ana",
    "fam",
    {
      groceries: [{ item: "chicken thighs", qty: "8" }, { item: "Limes" }],
      addGroceries: [{ item: "Limes" }, { item: "Milk", aisle: "Dairy and eggs" }],
      chores: [
        { who: "Maya", task: "Set the table" },
        { who: "Leo", task: "Toys away" },
      ],
    },
    LA,
  );
  await weeks.addGrocery("ana", "fam", "2026-09-28", { item: "milk" });
  board = await weeks.board("ana", "fam", LA);
  assert.deepEqual(
    board.week?.groceries.map((g) => [g.item, g.done]),
    [
      ["chicken thighs", true],
      ["Limes", false],
      ["Milk", false],
    ],
  );
  assert.deepEqual(
    board.week?.chores.map((c) => [c.who, c.stamps.filter(Boolean).length]),
    [
      ["Maya", 1],
      ["Leo", 0],
    ],
  );
  assert.equal(board.week?.summary, "Swim starts Tuesday", "sections left out stay");
  // Sunday: the recap closes this week, the plan goes to next week, and the board moves to it.
  now = new Date("2026-10-04T18:00:00Z");
  await weeks.save("ana", "fam", { week: "this", recap: "Leo tried peas." }, LA);
  const next = await weeks.save(
    "ana",
    "fam",
    { dinners: [{ day: "Monday", dish: "Taco night" }] },
    LA,
  );
  assert.equal(next.week, "next");
  assert.equal(next.weekStart, "2026-10-05");
  board = await weeks.board("ana", "fam", LA);
  assert.equal(board.week?.weekStart, "2026-10-05");
  assert.equal(board.nextPlanned, true);
  // This week stays reachable: today's timeline, and "Our weeks".
  assert.equal(board.current?.weekStart, "2026-09-28");
  assert.equal(board.today, 6);
  assert.deepEqual(
    board.past.map((w) => w.weekStart),
    ["2026-09-28"],
  );
  // A week later, the first week is in "Our weeks" with its recap and counts.
  now = new Date("2026-10-06T18:00:00Z");
  board = await weeks.board("ana", "fam", LA);
  assert.deepEqual(
    board.past.map((w) => [w.weekStart, w.recap, w.chores.stamped, w.chores.total, w.groceries]),
    [["2026-09-28", "Leo tried peas.", 1, 14, 3]],
  );
  // Last week's grocery list comes back unticked.
  const reused = await weeks.reuseGroceries("ana", "fam", "2026-09-28", "2026-10-05");
  assert.deepEqual(
    reused.groceries.map((g) => [g.item, g.done]),
    [
      ["chicken thighs", false],
      ["Limes", false],
      ["Milk", false],
    ],
  );
  await weeks.removeSpace("ana", "fam");
  assert.deepEqual(await weeks.all("ana", "fam"), []);
});

test("the board's routes are the person's own and only for family spaces", async () => {
  const server = await createApp(db, {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  } satisfies Config);
  const session = await server.app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const headers = {
    Authorization: `Bearer ${(await session.json()).token}`,
    "Content-Type": "application/json",
  };
  const space = await new Spaces(db).create("local-user", { kind: "family" });
  const timeZone = await server.agent.timeZone("local-user");
  const weeks = new FamilyWeeks(db);
  const { weekStart } = await weeks.save(
    "local-user",
    space.id,
    { week: "this", groceries: [{ item: "Apples" }], chores: [{ who: "Leo", task: "Toys away" }] },
    timeZone,
  );
  const board = (await (
    await server.app.request(`/api/spaces/${space.id}/weeks`, { headers })
  ).json()) as { week: FamilyWeek };
  assert.equal(board.week.weekStart, weekStart);
  const post = (path: string, body: unknown) =>
    server.app.request(`/api/spaces/${space.id}/weeks/${weekStart}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const apples = board.week.groceries[0]?.id;
  const ticked = (await (await post(`/groceries/${apples}`, { done: true })).json()) as FamilyWeek;
  assert.equal(ticked.groceries[0]?.done, true);
  const added = (await (await post("/groceries", { item: "Bread" })).json()) as FamilyWeek;
  assert.equal(added.groceries.length, 2);
  const chore = board.week.chores[0]?.id;
  const stamped = (await (
    await post(`/chores/${chore}`, { day: 3, done: true })
  ).json()) as FamilyWeek;
  assert.deepEqual(stamped.chores[0]?.stamps, [false, false, false, true, false, false, false]);
  assert.equal((await post("/groceries/nope", { done: true })).status, 404);
  assert.equal((await post("/groceries", { item: "" })).status, 422);
  const other = await server.app.request("/api/spaces/nope/weeks", { headers });
  assert.equal(other.status, 404);
});
