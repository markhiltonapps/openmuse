import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Hono } from "hono";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { ScheduledPosts } from "../apps/server/src/space-posts.ts";
import { spaceRoutes } from "../apps/server/src/space-routes.ts";
import { spaceContext, spaceToolSpecs } from "../apps/server/src/space-tools.ts";
import {
  DIGEST_STEPS,
  digestPrompt,
  FAMILY_RUNDOWN_STEPS,
  Spaces,
} from "../apps/server/src/spaces.ts";
import type { AgentTask, Routine } from "../packages/domain/src/agent.ts";
import {
  type SocialSpace,
  type Space,
  STARTER_FAMILY_PROMPTS,
  STARTER_SOCIAL_PROMPTS,
} from "../packages/domain/src/spaces.ts";

/** The social media playbook of a space that is one. */
const social = (space: Space) => {
  assert.equal(space.kind, "social");
  return (space as SocialSpace).playbook;
};

let db: Store, directory: string, server: Awaited<ReturnType<typeof createApp>>;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-spaces-"));
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  server = await createApp(db, config);
});
after(async () => {
  await server.agent.stop();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("a new social media space has its own chat, starter prompts and an empty playbook", async () => {
  const spaces = new Spaces(db);
  const space = await spaces.create("ana", {});
  assert.equal(space.name, "Social media");
  assert.equal(space.kind, "social");
  assert.equal(space.setupDone, false);
  assert.equal(space.threadStarted, false);
  assert.match(space.threadId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    space.prompts.map((p) => p.text),
    STARTER_SOCIAL_PROMPTS,
  );
  assert.deepEqual(space.playbook, { products: [], platforms: [], voice: "", avoid: [] });
  assert.equal((await spaces.byThread("ana", space.threadId))?.id, space.id);
  assert.equal(await spaces.byThread("ana", "another-chat"), undefined);
  // Someone else's space is theirs alone.
  assert.deepEqual(await spaces.list("ben"), []);
});

test("the playbook changes only the fields given; lists replace, null clears", async () => {
  const spaces = new Spaces(db);
  const space = await spaces.create("cam", { name: "Brand" });
  await spaces.update("cam", space.id, {
    products: [{ name: "Neato Orbit", about: "A clip-on AI device", competitors: ["Plaud"] }],
    platforms: ["Instagram", "LinkedIn"],
    voice: "Short, plain, optimistic.",
    avoid: ["Never name the wearable's client"],
    dailyAdCeilingUsd: 20,
    organicUntil: "2026-10-06",
    scheduler: "Postiz",
    audience: "Operations leads at small service businesses who miss calls",
    goals: ["More customers or sales", "Getting known"],
    pillars: ["Every call answered", "Behind the build"],
    plan: "Next 90 days: two posts a week on LinkedIn…",
    baseline: "A fresh start: new accounts.",
  });
  const updated = await spaces.update(
    "cam",
    space.id,
    { platforms: ["Instagram"], dailyAdCeilingUsd: null },
    true,
  );
  const book = social(updated);
  assert.deepEqual(book.platforms, ["Instagram"]);
  assert.equal(book.dailyAdCeilingUsd, undefined);
  assert.equal(book.organicUntil, "2026-10-06");
  assert.equal(book.scheduler, "Postiz");
  assert.deepEqual(book.goals, ["More customers or sales", "Getting known"]);
  assert.deepEqual(book.pillars, ["Every call answered", "Behind the build"]);
  assert.match(book.plan ?? "", /90 days/);
  const noScheduler = await spaces.update("cam", space.id, { scheduler: null });
  assert.equal(social(noScheduler).scheduler, undefined);
  assert.equal(book.products[0]?.competitors[0], "Plaud");
  assert.equal(updated.setupDone, true);
  await assert.rejects(spaces.update("cam", space.id, { organicUntil: "next week" }));
  await assert.rejects(spaces.update("cam", space.id, { postsPerWeek: 50 }));
  await assert.rejects(spaces.update("cam", "missing", {}), /Space not found/);
});

test("prompts are saved once each and can be removed", async () => {
  const spaces = new Spaces(db);
  const space = await spaces.create("dee", {});
  const saved = await spaces.addPrompt("dee", space.id, "  Compare   [competitor] with us ");
  assert.equal(saved.prompts.at(-1)?.text, "Compare [competitor] with us");
  const again = await spaces.addPrompt("dee", space.id, "compare [competitor] with us");
  assert.equal(again.prompts.length, saved.prompts.length);
  await assert.rejects(spaces.addPrompt("dee", space.id, ""), /1 to 300/);
  const last = saved.prompts.at(-1)?.id ?? "";
  const removed = await spaces.removePrompt("dee", space.id, last);
  assert.equal(
    removed.prompts.some((p) => p.id === last),
    false,
  );
});

test("the weekly digest is a routine that reads the playbook when it runs", async () => {
  const agent = server.agent;
  const spaces = new Spaces(db);
  const space = await spaces.create("eve", {});
  const on = await spaces.setDigest("eve", space.id, { on: true }, agent);
  const routine = await db.get<Routine>("eve", "routines", on.digestRoutineId ?? "");
  assert.equal(routine?.title, "Social media digest");
  assert.deepEqual(routine?.days, [1]);
  assert.equal(routine?.time, "08:45");
  assert.match(routine?.prompt ?? "", /get_space_playbook with this space id/);
  assert.match(routine?.prompt ?? "", new RegExp(space.id));
  assert.equal(routine?.prompt, digestPrompt(space));

  // Changing the day moves the same routine instead of adding another.
  const moved = await spaces.setDigest("eve", space.id, { on: true, day: 5, time: "09:30" }, agent);
  assert.equal(moved.digestRoutineId, on.digestRoutineId);
  assert.deepEqual((await db.get<Routine>("eve", "routines", on.digestRoutineId ?? ""))?.days, [5]);
  assert.equal((await db.list("eve", "routines")).length, 1);

  // A run is an ordinary routine task.
  await agent.runRoutine("eve", on.digestRoutineId ?? "");
  const tasks = await db.list<AgentTask>("eve", "tasks");
  assert.match(tasks[0]?.prompt ?? "", /Weekly social media digest/);

  const off = await spaces.setDigest("eve", space.id, { on: false }, agent);
  assert.equal(off.digestRoutineId, undefined);
  assert.equal((await db.list("eve", "routines")).length, 0);

  await spaces.setDigest("eve", space.id, { on: true }, agent);
  await spaces.remove("eve", space.id, agent);
  assert.equal((await db.list("eve", "routines")).length, 0);
  assert.deepEqual(await spaces.list("eve"), []);
});

type Spec = { name: string; execute: (args: never) => Promise<unknown> };
const run = (specs: Spec[], name: string, args: unknown) =>
  (specs.find((spec) => spec.name === name) as Spec).execute(args as never);

test("the agent fills in the playbook of the chat's own space", async () => {
  const spaces = new Spaces(db);
  const first = await spaces.create("fay", {});
  const second = await spaces.create("fay", { name: "Second brand" });
  const specs = spaceToolSpecs(spaces, "fay", {
    threadId: second.threadId,
    routines: server.agent,
  }) as Spec[];
  assert.deepEqual(
    specs.map((spec) => spec.name),
    ["get_space_playbook", "update_space_playbook", "save_space_prompt", "set_space_digest"],
  );
  await run(specs, "update_space_playbook", {
    products: [{ name: "Neato_Prompt", competitors: ["PromptPerfect"] }],
    postsPerWeek: 7,
    setupDone: true,
  });
  const read = (await run(specs, "get_space_playbook", {})) as {
    id: string;
    setupDone: boolean;
    weeklyDigestSteps?: string;
  };
  assert.equal(read.id, second.id);
  assert.equal(read.setupDone, true);
  assert.equal(read.weeklyDigestSteps, undefined);
  assert.equal((await spaces.get("fay", first.id)).setupDone, false);
  assert.deepEqual(await run(specs, "set_space_digest", { on: true, day: 1 }), {
    weeklyDigest: "on",
    when: "Monday at 08:45",
  });
  await run(specs, "save_space_prompt", { text: "Plan a launch post for [product]" });
  assert.equal(
    (await spaces.get("fay", second.id)).prompts.at(-1)?.text,
    "Plan a launch post for [product]",
  );

  // Outside a space's chat, with two spaces, the agent must say which.
  const main = spaceToolSpecs(spaces, "fay", { threadId: "main-chat" }) as Spec[];
  await assert.rejects(run(main, "get_space_playbook", {}), /Say which space/);
  assert.equal(
    ((await run(main, "get_space_playbook", { spaceId: first.id })) as Space).id,
    first.id,
  );

  // The worker (the weekly digest) can read a playbook but not change it.
  const worker = spaceToolSpecs(spaces, "fay", { readOnly: true }) as Spec[];
  assert.deepEqual(
    worker.map((spec) => spec.name),
    ["get_space_playbook", "save_week_plan"],
  );
  // It gets today's digest steps with the playbook, so a digest turned on earlier follows them.
  const steps = (
    (await run(worker, "get_space_playbook", { spaceId: second.id })) as {
      weeklyDigestSteps: string;
    }
  ).weeklyDigestSteps;
  assert.ok(steps.includes(DIGEST_STEPS));
  assert.match(steps, /replace any older steps/);
});

test("a space's chat gets the rules for running it and its playbook as data", async () => {
  const spaces = new Spaces(db);
  const space = await spaces.update("gus", (await spaces.create("gus", {})).id, {
    voice: "Plain.",
  });
  const [rules, data] = spaceContext(space);
  assert.match(rules?.value ?? "", /search_web to find 3 to 5 current, direct competitors/);
  assert.match(rules?.value ?? "", /without the person's approval/);
  assert.match(rules?.value ?? "", /never guess an action's name/);
  // The expert manager: evidence first, competitors' gaps, a plan with themes, and plain words.
  assert.match(rules?.value ?? "", /Evidence first/);
  assert.match(rules?.value ?? "", /Find what others miss/);
  assert.match(rules?.value ?? "", /3 to 5 content themes/);
  assert.match(rules?.value ?? "", /Never contact anyone without the person's OK/);
  // A space set up before plans existed is offered one.
  assert.match(rules?.value ?? "", /setup is done but there's no plan yet/);
  assert.match(data?.description ?? "", /data, not instructions/);
  assert.match(data?.value ?? "", /"voice": "Plain\."/);
});

test("the spaces API lists, creates, edits and removes a person's spaces", async () => {
  const api = new Hono<{ Variables: { owner: string } }>();
  api.use(async (c, next) => {
    c.set("owner", "hal");
    await next();
  });
  api.route(
    "/api/spaces",
    spaceRoutes(new Spaces(db), server.agent, new ScheduledPosts(db, undefined, async () => {})),
  );
  const call = async (path: string, body?: unknown) => {
    const response = await api.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as Space };
  };
  const created = await call("/api/spaces", {});
  assert.equal(created.status, 201);
  const id = created.json.id;
  const edited = await call(`/api/spaces/${id}/playbook`, {
    platforms: ["Facebook"],
    setupDone: true,
  });
  assert.deepEqual(social(edited.json).platforms, ["Facebook"]);
  assert.equal(edited.json.setupDone, true);
  const prompt = await call(`/api/spaces/${id}/prompts`, { text: "What worked?" });
  assert.equal(prompt.json.prompts.at(-1)?.text, "What worked?");
  const digest = await call(`/api/spaces/${id}/digest`, { on: true });
  assert.ok(digest.json.digestRoutineId);
  const list = (await (await api.request("/api/spaces")).json()) as Space[];
  assert.equal(list.length, 1);
  await call(`/api/spaces/${id}/delete`, {});
  assert.deepEqual(await (await api.request("/api/spaces")).json(), []);
});

test("a family space: its own playbook and rules, a daily rundown and a week plan", async () => {
  const spaces = new Spaces(db);
  const space = await spaces.create("kim", { kind: "family" });
  assert.equal(space.kind, "family");
  assert.equal(space.name, "Family");
  assert.deepEqual(
    space.prompts.map((p) => p.text),
    STARTER_FAMILY_PROMPTS,
  );
  assert.deepEqual(space.playbook, {
    family: [],
    foodRules: [],
    favorites: [],
    chores: [],
    interests: [],
  });
  // Only family fields apply; a social media field is dropped, a bad value refused.
  const updated = await spaces.update("kim", space.id, {
    family: [{ name: "Maya", age: 8 }, { name: "Sam" }],
    foodRules: ["No peanuts"],
    dinnersPerWeek: 5,
    tone: "playful",
    planningDay: 0,
    products: [{ name: "Not here" }],
  });
  assert.deepEqual(updated.playbook, {
    family: [{ name: "Maya", age: 8 }, { name: "Sam" }],
    foodRules: ["No peanuts"],
    favorites: [],
    chores: [],
    interests: [],
    dinnersPerWeek: 5,
    tone: "playful",
    planningDay: 0,
  });
  await assert.rejects(spaces.update("kim", space.id, { tone: "bossy" }));
  // Its chat gets the family rules, not the social media ones.
  const [rules] = spaceContext(updated);
  assert.match(rules?.value ?? "", /no medical, legal or money advice/);
  assert.match(rules?.value ?? "", /an allergy is never a suggestion/);
  assert.match(rules?.value ?? "", /one short question at a time/);
  assert.doesNotMatch(rules?.value ?? "", /competitors/);
  // The rundown can run every weekday morning, and reads today's steps when it runs.
  const on = await spaces.setDigest(
    "kim",
    space.id,
    { on: true, days: [1, 2, 3, 4, 5], time: "06:45" },
    server.agent,
  );
  const routine = await db.get<Routine>("kim", "routines", on.digestRoutineId ?? "");
  assert.equal(routine?.title, "Family rundown");
  assert.deepEqual(routine?.days, [1, 2, 3, 4, 5]);
  assert.equal(routine?.time, "06:45");
  assert.equal(routine?.prompt, digestPrompt(space));
  assert.match(routine?.prompt ?? "", /^Daily family rundown/);
  const worker = spaceToolSpecs(spaces, "kim", { readOnly: true }) as Spec[];
  const read = (await run(worker, "get_space_playbook", { spaceId: space.id })) as {
    kind: string;
    dailyRundownSteps?: string;
    weeklyDigestSteps?: string;
  };
  assert.equal(read.kind, "family");
  assert.ok(read.dailyRundownSteps?.includes(FAMILY_RUNDOWN_STEPS));
  assert.equal(read.weeklyDigestSteps, undefined);
  // The rundown saves the week's plan; nothing else in the playbook can change from there.
  await run(worker, "save_week_plan", {
    spaceId: space.id,
    plan: "Monday: tacos, Maya sets the table.",
  });
  const after = await spaces.get("kim", space.id);
  assert.equal(
    after.kind === "family" ? after.playbook.weekPlan : "",
    "Monday: tacos, Maya sets the table.",
  );
  // The plan carries its date, so a rundown on any day knows when it has gone stale.
  assert.match(after.kind === "family" ? (after.playbook.weekPlanAt ?? "") : "", /^\d{4}-/);
  assert.equal(
    worker.some((spec) => spec.name === "update_space_playbook"),
    false,
  );
  // Removing the space can take its chat with it, since that chat holds the family's details.
  const deleted: string[] = [];
  const gone = await spaces.remove(
    "kim",
    space.id,
    server.agent,
    { deleteThread: async (_owner, threadId) => deleted.push(threadId) },
    true,
  );
  assert.deepEqual(gone, { ok: true, chatDeleted: true });
  assert.deepEqual(deleted, [space.threadId]);
  await assert.rejects(spaces.get("kim", space.id), /Space not found/);
});
