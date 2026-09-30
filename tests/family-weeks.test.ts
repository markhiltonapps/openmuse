import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  FamilyWeeks,
  localToday,
  mondayOf,
  summarize,
  weekForAgent,
} from "../apps/server/src/family-weeks.ts";
import {
  dietWords,
  RecipeKitchen,
  type RecipeRequest,
  writeRecipes,
} from "../apps/server/src/recipe-writer.ts";
import { Spaces } from "../apps/server/src/spaces.ts";
import {
  choreStars,
  cooked,
  dishEmoji,
  type FamilyWeek,
  type WeekDinner,
} from "../packages/domain/src/family-week.ts";
import type { FamilySpace } from "../packages/domain/src/spaces.ts";

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

test("chore stars add up per person, whatever the case of their name", () => {
  const day = (n: number) => Array.from({ length: 7 }, (_, i) => i < n);
  assert.deepEqual(
    choreStars([
      { who: "Maya", stamps: day(3) },
      { who: "Leo ", stamps: day(0) },
      { who: "maya", stamps: day(5) },
    ]),
    [
      { who: "Maya", stars: 8, total: 14 },
      { who: "Leo", stars: 0, total: 7 },
    ],
  );
});

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
  // Each person's stars, for the stars-per-person table in "Our weeks".
  assert.deepEqual(board.past[0]?.chores.people, [
    { who: "Maya", stars: 1, total: 7 },
    { who: "Leo", stars: 0, total: 7 },
  ]);
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

test("a night's recipes: the pick's ingredients go on the list, and a new pick swaps them", async () => {
  const weeks = new FamilyWeeks(db, () => new Date("2026-09-29T16:00:00Z")); // Tuesday
  const recipe = (name: string, items: string[], have: string[] = []) => ({
    name,
    serves: 4,
    prepMinutes: 10,
    cookMinutes: 30,
    ingredients: [
      ...items.map((item) => ({ item, qty: "1", aisle: "Pantry" })),
      ...have.map((item) => ({ item, have: true })),
    ],
    steps: ["Heat the oven.", "Cook it."],
  });
  const W = "2026-09-28";
  const saved = await weeks.save(
    "rae",
    "fam",
    {
      week: "this",
      dinners: [
        { day: "Tuesday", dish: "Sheet-pan chicken" },
        { day: "Wednesday", dish: "Taco night" },
        { day: "Thursday", dish: "Leftovers" },
      ],
      groceries: [{ item: "Milk" }, { item: "Lime", qty: "2" }],
    },
    LA,
  );
  assert.equal(saved.weekStart, W);
  await weeks.addGrocery("rae", "fam", W, { item: "Cereal" });
  await weeks.saveRecipes("rae", "fam", W, {
    day: "Tuesday",
    recipes: [
      recipe("Lemon chicken", ["Chicken thighs", "Lemon", "Limes"], ["Olive oil"]),
      recipe("Garlic chicken", ["Chicken breasts", "Garlic"]),
    ],
    links: [{ title: "Sheet-pan lemon chicken", url: "https://example.com/lemon-chicken" }],
  });
  await weeks.saveRecipes("rae", "fam", W, {
    day: "Wednesday",
    recipes: [recipe("Beef tacos", ["Lemons", "Taco shells", "Cereal"])],
  });
  const week = async () => (await weeks.get("rae", "fam", W)) as FamilyWeek;
  const list = async () =>
    (await week()).groceries.map(
      (g) =>
        `${g.item}${g.qty ? ` ${g.qty}` : ""}${g.for?.length ? `@${g.for.join(",")}` : ""}${g.done ? "✓" : ""}`,
    );
  // The plan's lime (for other meals too) keeps its 2 and the recipe's adds on; pantry oil stays
  // off; the family's cereal stays theirs; the lemon two nights share adds up.
  assert.deepEqual(await list(), [
    "Milk",
    "Lime 2 + 1@1",
    "Cereal",
    "Chicken thighs 1@1",
    "Lemon 1 + 1@1,2",
    "Taco shells 1@2",
  ]);
  const thighs = (await week()).groceries.find((g) => g.item === "Chicken thighs");
  await weeks.setGrocery("rae", "fam", W, thighs?.id ?? "", { done: true });
  // Picking the other recipe: the lime goes back to the plan's 2, ticked thighs stay with what
  // was bought, Wednesday still needs its lemon.
  await weeks.chooseRecipe("rae", "fam", W, 1, { recipe: 1 });
  assert.deepEqual(await list(), [
    "Milk",
    "Lime 2",
    "Cereal",
    "Chicken thighs 1✓",
    "Lemon 1@2",
    "Taco shells 1@2",
    "Chicken breasts 1@1",
    "Garlic 1@1",
  ]);
  // Back again: the unticked garlic and breasts come off.
  const back = await weeks.chooseRecipe("rae", "fam", W, 1, { recipe: 0 });
  assert.equal(back.dinners.find((d) => d.day === 1)?.chosen, 0);
  assert.deepEqual(await list(), [
    "Milk",
    "Lime 2 + 1@1",
    "Cereal",
    "Chicken thighs 1@1✓",
    "Lemon 1 + 1@2,1",
    "Taco shells 1@2",
  ]);
  // Typing an item that's there makes it the family's; taken off by hand, the button puts a
  // recipe's item back.
  await weeks.addGrocery("rae", "fam", W, { item: "taco shells" });
  const shells = (await week()).groceries.find((g) => g.item === "Taco shells");
  assert.equal(shells?.by, "family");
  assert.equal(shells?.for, undefined);
  const lime = (await week()).groceries.find((g) => g.item === "Lime");
  await weeks.setGrocery("rae", "fam", W, lime?.id ?? "", { remove: true });
  await weeks.addRecipeGroceries("rae", "fam", W, 1);
  assert.ok((await list()).includes("Limes 1@1"));
  // A rewritten list keeps what the recipes need and what the family added; a reworded dish
  // keeps its recipes, a new one drops them and says so.
  const rewrite = await weeks.save(
    "rae",
    "fam",
    {
      groceries: [{ item: "Bread" }],
      dinners: [
        { day: "Tuesday", dish: "Sheet pan chicken!" },
        { day: "Wednesday", dish: "Fish sticks" },
      ],
    },
    LA,
  );
  assert.deepEqual(rewrite.recipesDropped, ["Wednesday"]);
  const after = await week();
  assert.equal(after.dinners[0]?.recipes?.length, 2, "same dish, same recipes");
  assert.equal(after.dinners[1]?.recipes, undefined);
  assert.deepEqual(await list(), [
    "Bread",
    "Cereal",
    "Chicken thighs 1@1✓",
    "Lemon 1@1",
    "Taco shells 1",
    "Limes 1@1",
  ]);
  // Recipes written for a dish that has since changed aren't saved.
  await assert.rejects(
    weeks.saveRecipes(
      "rae",
      "fam",
      W,
      { day: "Wednesday", recipes: [recipe("Beef tacos", ["Beef"])] },
      "Taco night",
    ),
    /changed/,
  );
  // The agent reads recipe names, not every step, and the list as it writes it; past weeks
  // carry just the plates.
  const forAgent = weekForAgent(after);
  assert.deepEqual(forAgent.dinners[0], {
    day: 1,
    dish: "Sheet pan chicken!",
    cook: true,
    recipes: ["Lemon chicken", "Garlic chicken"],
    cooking: "Lemon chicken",
  });
  assert.deepEqual(
    forAgent.groceries.map(({ id: _, ...g }) => g),
    [
      { item: "Bread", done: false },
      { item: "Cereal", done: false, addedBy: "family" },
      { item: "Chicken thighs", qty: "1", aisle: "Pantry", done: true, for: ["Tuesday"] },
      { item: "Lemon", qty: "1", aisle: "Pantry", done: false, for: ["Tuesday"] },
      { item: "Taco shells", qty: "1", aisle: "Pantry", done: false, addedBy: "family" },
      { item: "Limes", qty: "1", aisle: "Pantry", done: false, for: ["Tuesday"] },
    ],
  );
  assert.equal("recipes" in (summarize(after).dinners[0] ?? {}), false);
  await assert.rejects(
    weeks.saveRecipes("rae", "fam", W, { day: "Sunday", recipes: [recipe("Soup", ["Leeks"])] }),
    /no dinner on Sunday/,
  );
  await assert.rejects(
    weeks.saveRecipes("rae", "fam", W, {
      day: "Tuesday",
      recipes: [recipe("Soup", ["Leeks"])],
      links: [{ title: "Soup", url: "http://example.com" }],
    }),
  );
  await assert.rejects(weeks.chooseRecipe("rae", "fam", W, 1, { recipe: 5 }), /not found/);
  await weeks.removeSpace("rae", "fam");
});

test("the plan's dinner items are the recipe's to size; items for other meals never shrink", async () => {
  const weeks = new FamilyWeeks(db, () => new Date("2026-09-29T16:00:00Z"));
  const W = "2026-09-28";
  const recipe = (name: string, items: [string, string][]) => ({
    name,
    ingredients: items.map(([item, qty]) => ({ item, qty })),
    steps: ["Cook it."],
  });
  await weeks.save(
    "kit",
    "fam",
    {
      week: "this",
      dinners: [
        { day: "Tuesday", dish: "Chicken pot pie" },
        { day: "Wednesday", dish: "Tacos" },
        { day: "Thursday", dish: "Chili", note: "Big batch, leftovers Friday" },
        { day: "Friday", dish: "Thai takeout" },
      ],
      groceries: [
        { item: "Eggs", qty: "1 dozen" },
        { item: "Milk", qty: "1 gallon" },
        { item: "Chicken thighs", qty: "2 lb", for: ["Tuesday"] },
        { item: "Pie crust", qty: "2", for: ["Tuesday"] },
        { item: "Tortillas", qty: "12", for: ["Wednesday"] },
      ],
    },
    LA,
  );
  const week = async () => (await weeks.get("kit", "fam", W)) as FamilyWeek;
  const list = async () =>
    (await week()).groceries.map((g) => `${g.item}${g.qty ? ` ${g.qty}` : ""}${g.done ? "✓" : ""}`);
  // Cooking is saved for each night from the dish alone.
  assert.deepEqual(
    (await week()).dinners.map((d) => d.cook),
    [true, true, true, false],
  );
  await weeks.saveRecipes("kit", "fam", W, {
    day: "Tuesday",
    recipes: [
      recipe("Skillet pot pie", [
        ["Chicken thighs", "1½ lb"],
        ["Eggs", "1"],
        ["Milk", "½ cup"],
        ["Puff pastry", "1 sheet"],
      ]),
      recipe("Biscuit pot pie", [
        ["Chicken breasts", "1 lb"],
        ["Biscuit dough", "1 can"],
      ]),
    ],
  });
  // Breakfast eggs and milk keep their amounts with the recipe's added on; the plan's chicken
  // guess for Tuesday is the recipe's now, and the pie crust it doesn't use comes off.
  assert.deepEqual(await list(), [
    "Eggs 1 dozen + 1",
    "Milk 1 gallon + ½ cup",
    "Chicken thighs 1½ lb",
    "Tortillas 12",
    "Puff pastry 1 sheet",
  ]);
  // A pick without eggs or milk leaves them for the other meals.
  await weeks.chooseRecipe("kit", "fam", W, 1, { recipe: 1 });
  assert.deepEqual(await list(), [
    "Eggs 1 dozen",
    "Milk 1 gallon",
    "Tortillas 12",
    "Chicken breasts 1 lb",
    "Biscuit dough 1 can",
  ]);
  // A new dish on Wednesday takes the plan's tortillas with the old one.
  await weeks.save(
    "kit",
    "fam",
    {
      dinners: [
        { day: "Tuesday", dish: "Chicken pot pie" },
        { day: "Wednesday", dish: "Fish sticks" },
        { day: "Thursday", dish: "Chili", note: "Big batch, leftovers Friday" },
        { day: "Friday", dish: "Thai takeout" },
      ],
    },
    LA,
  );
  assert.deepEqual(await list(), [
    "Eggs 1 dozen",
    "Milk 1 gallon",
    "Chicken breasts 1 lb",
    "Biscuit dough 1 can",
  ]);
  // The list rewritten: Tuesday's recipe has the say over items listed for Tuesday.
  await weeks.save(
    "kit",
    "fam",
    {
      groceries: [
        { item: "Eggs", qty: "1 dozen" },
        { item: "Pie crust", qty: "2", for: ["Tuesday"] },
        { item: "Chicken breasts", qty: "2 lb", for: ["Tuesday"] },
      ],
    },
    LA,
  );
  assert.deepEqual(await list(), ["Eggs 1 dozen", "Chicken breasts 1 lb", "Biscuit dough 1 can"]);
  // Typed by the family, an item is theirs: no pick changes it.
  await weeks.addGrocery("kit", "fam", W, { item: "chicken breasts", qty: "3 lb" });
  await weeks.chooseRecipe("kit", "fam", W, 1, { recipe: 0 });
  const breasts = (await week()).groceries.find((g) => g.item === "Chicken breasts");
  assert.equal(breasts?.qty, "3 lb");
  assert.equal(breasts?.by, "family");
  // Only the dish's own name says it isn't cooked.
  assert.equal(cooked({ dish: "Leftovers" }), false);
  assert.equal(cooked({ dish: "Thai takeout" }), false);
  assert.equal(cooked({ dish: "Better-than-takeout orange chicken" }), true);
  assert.equal(cooked({ dish: "Restaurant-style fried rice" }), true);
  assert.equal(cooked({ dish: "Grandma's roast", cook: true }), true);
  assert.equal(cooked({ dish: "Sheet-pan chicken" }), true);
  await weeks.removeSpace("kit", "fam");
});

test("the kitchen writes each home-cooked night once, from today on, with links only from search results", async () => {
  const spaces = new Spaces(db);
  const space = (await spaces.create("sol", { kind: "family" })) as FamilySpace;
  await spaces.update("sol", space.id, {
    foodRules: ["Ada (6): no peanuts, she's allergic"],
    family: [{ name: "Ada" }],
  });
  const family = (await spaces.get("sol", space.id)) as FamilySpace;
  const clock = () => new Date("2026-09-29T16:00:00Z"); // Tuesday in Los Angeles
  const weeks = new FamilyWeeks(db, clock);
  await weeks.save(
    "sol",
    space.id,
    {
      week: "this",
      dinners: [
        { day: "Monday", dish: "Pasta" },
        { day: "Tuesday", dish: "Tacos" },
        { day: "Wednesday", dish: "Soup" },
        { day: "Friday", dish: "Takeout", cook: false },
      ],
      groceries: [{ item: "Salad greens", for: ["Tuesday"] }],
    },
    LA,
  );
  const asked: RecipeRequest[] = [];
  let hold = Promise.resolve();
  const kitchen = new RecipeKitchen(
    db,
    async (request) => {
      asked.push(request);
      await hold;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        recipes: [
          {
            name: `${request.dinner.dish} ${request.wish ?? "one"}`,
            ingredients: [{ item: request.dinner.dish }],
            steps: ["Cook."],
          },
        ],
        links: [],
      };
    },
    undefined,
    clock,
  );
  const W = "2026-09-28";
  const weekId = `${space.id}:${W}`;
  // Two asks at once for the same week write each night once; Monday has passed and takeout
  // gets none. While they're written, the board can say which nights are on the way.
  const both = Promise.all([
    kitchen.fill("sol", family, W, { timeZone: LA }),
    kitchen.fill("sol", family, W, { timeZone: LA }),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.deepEqual(kitchen.pending("sol", weekId), [1, 2]);
  const [first] = await both;
  assert.deepEqual(first.written, ["Tuesday", "Wednesday"]);
  assert.deepEqual(kitchen.pending("sol", weekId), []);
  assert.deepEqual(asked.map((r) => r.dinner.dish).sort(), ["Soup", "Tacos"]);
  assert.deepEqual(asked[0]?.playbook.foodRules, ["Ada (6): no peanuts, she's allergic"]);
  // The writer hears what the plan listed for the night, so a side isn't lost.
  assert.deepEqual(asked.find((r) => r.dinner.day === 1)?.planned, ["Salad greens"]);
  const week = async () => (await weeks.get("sol", space.id, W)) as FamilyWeek;
  assert.deepEqual(
    (await week()).dinners.map((d) => d.recipes?.[0]?.name ?? "-"),
    ["-", "Tacos one", "Soup one", "-"],
  );
  // Nothing left to write from today on; Monday is written when it's asked for.
  assert.deepEqual((await kitchen.fill("sol", family, W, { timeZone: LA })).written, []);
  assert.deepEqual((await kitchen.fill("sol", family, W, { nights: [0] })).written, ["Monday"]);

  // A wish while that night is being written waits for it, then writes its own.
  let release = () => {};
  hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const plain = kitchen.fill("sol", family, W, { nights: [1] });
  const wished = kitchen.fill("sol", family, W, { nights: [1], wish: "vegetarian" });
  release();
  assert.deepEqual((await plain).written, ["Tuesday"]);
  assert.deepEqual((await wished).written, ["Tuesday"]);
  assert.equal((await week()).dinners[1]?.recipes?.[0]?.name, "Tacos vegetarian");
  // A dish changed while its recipes are written gets its own; the old ones aren't saved.
  hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const old = kitchen.fill("sol", family, W, { nights: [2] });
  await new Promise((resolve) => setTimeout(resolve, 1));
  await weeks.save(
    "sol",
    space.id,
    {
      week: "this",
      dinners: [
        { day: "Monday", dish: "Pasta" },
        { day: "Tuesday", dish: "Tacos" },
        { day: "Wednesday", dish: "Stew" },
        { day: "Friday", dish: "Takeout", cook: false },
      ],
    },
    LA,
  );
  const fresh = kitchen.fill("sol", family, W, { nights: [2] });
  release();
  assert.deepEqual((await old).failed, ["Wednesday"]);
  assert.deepEqual((await fresh).written, ["Wednesday"]);
  assert.equal((await week()).dinners[2]?.recipes?.[0]?.name, "Stew one");

  // The writer: food rules go to the model, only diet words to the search; links are picked by
  // number from real results.
  assert.deepEqual(
    dietWords(["Leo (6): severe peanut allergy", "Vegetarian on Mondays", "Mia loves eggs"]),
    ["peanut-free", "vegetarian"],
  );
  let sent: { system: string; messages: { content: string }[] } | undefined;
  let searched = "";
  const draft = await writeRecipes(
    {
      dinner: (await week()).dinners[0] as WeekDinner,
      week: (await week()).dinners,
      playbook: family.playbook,
      groceries: [],
    },
    {
      apiKey: "test",
      model: "claude-test",
      search: {
        search: async (query: string) => {
          searched = query;
          return {
            answer: "",
            sources: [
              { title: "Easy pasta", url: "https://example.com/pasta" },
              { title: "Old page", url: "http://example.com/insecure" },
              { title: "Peanut noodles", url: "https://example.com/peanut" },
            ],
          };
        },
      },
      fetcher: (async (_url: string, init: { body: string }) => {
        sent = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            content: [
              {
                type: "tool_use",
                name: "save_recipes",
                input: {
                  recipes: [
                    {
                      name: "Garlic pasta",
                      ingredients: [{ item: "Spaghetti" }],
                      steps: ["Boil."],
                    },
                  ],
                  links: [1, 7],
                },
              },
            ],
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
        );
      }) as unknown as typeof fetch,
    },
  );
  assert.equal(searched, "Pasta recipe peanut-free");
  assert.match(sent?.system ?? "", /food rules exactly/);
  assert.match(sent?.messages[0]?.content ?? "", /no peanuts/);
  assert.deepEqual(draft.links, [{ title: "Easy pasta", url: "https://example.com/pasta" }]);
  await weeks.removeSpace("sol", space.id);
});

test("the board's Get recipes writes a night's recipes, or says why it can't", async () => {
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
  const { weekStart } = await new FamilyWeeks(db).save(
    "local-user",
    space.id,
    { week: "this", dinners: [{ day: "Monday", dish: "Soup" }] },
    await server.agent.timeZone("local-user"),
  );
  const ask = () =>
    server.app.request(`/api/spaces/${space.id}/weeks/${weekStart}/recipes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ day: 0 }),
    });
  // Without the Anthropic key there's no kitchen, and nothing's on the way.
  assert.equal((await ask()).status, 503);
  const board = await server.app.request(`/api/spaces/${space.id}/weeks`, { headers });
  assert.deepEqual(((await board.json()) as { recipesWriting: number[] }).recipesWriting, []);
  server.agent.recipes = new RecipeKitchen(db, async () => ({
    recipes: [{ name: "Tomato soup", ingredients: [{ item: "Tomatoes" }], steps: ["Simmer."] }],
    links: [],
  }));
  const done = (await (await ask()).json()) as { written: string[]; week: FamilyWeek };
  assert.deepEqual(done.written, ["Monday"]);
  assert.equal(done.week.dinners[0]?.recipes?.[0]?.name, "Tomato soup");
  assert.equal(done.week.groceries[0]?.item, "Tomatoes");
});
