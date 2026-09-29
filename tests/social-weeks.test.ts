import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { SocialWeeks } from "../apps/server/src/social-weeks.ts";
import { spaceToolSpecs } from "../apps/server/src/space-tools.ts";
import { Spaces } from "../apps/server/src/spaces.ts";
import { aimProgress, type SocialWeek, weekReach } from "../packages/domain/src/social-week.ts";

let db: Store, directory: string;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-results-"));
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});
const LA = "America/Los_Angeles";

test("the digest saves last week's results, and a later save replaces only the parts it gives", async () => {
  const now = new Date("2026-09-29T16:00:00Z"); // Tuesday
  const results = new SocialWeeks(db, () => now);
  const saved = await results.save(
    "ana",
    "shop",
    {
      headline: "Video beat photos 3 to 1",
      reach: [
        { platform: "Instagram", people: 1200 },
        { platform: "Facebook", people: 300 },
      ],
      best: "The latte art reel",
      competitors: [
        { name: "Bean There", what: "Ran a 2-for-1 ad", opening: "Nobody posts mornings" },
      ],
    },
    LA,
  );
  assert.deepEqual(saved, { weekStart: "2026-09-21", saved: true });
  await results.save(
    "ana",
    "shop",
    {
      week: "last",
      aims: [{ aim: "500 followers", current: 200, target: 500, status: "200 of 500" }],
    },
    LA,
  );
  await results.save(
    "ana",
    "shop",
    { week: "this", reach: [{ platform: "Instagram", people: 90 }] },
    LA,
  );
  await assert.rejects(
    results.save("ana", "shop", { reach: [{ platform: "Instagram", people: -1 }] }, LA),
  );
  const weeks = await results.all("ana", "shop");
  assert.deepEqual(
    weeks.map((w) => [w.weekStart, weekReach(w)]),
    [
      ["2026-09-21", 1500],
      ["2026-09-28", 90],
    ],
  );
  const last = weeks[0] as SocialWeek;
  assert.equal(last.headline, "Video beat photos 3 to 1", "parts left out stay");
  assert.equal(aimProgress(last.aims[0] as SocialWeek["aims"][number]), 0.4);
  await assert.rejects(
    results.save(
      "ana",
      "shop",
      { aims: [{ aim: "Sales", current: 5, target: 0, status: "?" }] },
      LA,
    ),
    "an aim needs a real target",
  );
  assert.deepEqual(await results.all("bo", "shop"), [], "only the person's own");
  await results.removeSpace("ana", "shop");
  assert.deepEqual(await results.all("ana", "shop"), []);
});

test("save_week_results is only for social spaces, and the playbook shows the latest week", async () => {
  const spaces = new Spaces(db);
  const social = await spaces.create("cy", { kind: "social" });
  const family = await spaces.create("cy", { kind: "family" });
  const results = new SocialWeeks(db, () => new Date("2026-09-29T16:00:00Z"));
  const tools = spaceToolSpecs(spaces, "cy", { results, timeZone: async () => LA });
  const save = tools.find((tool) => tool.name === "save_week_results");
  assert.ok(save, "the chat can save results");
  const execute = save.execute as (input: unknown) => Promise<unknown>;
  assert.deepEqual(
    await execute({ spaceId: family.id, reach: [{ platform: "Instagram", people: 5 }] }),
    { error: "Only a social media space has weekly results." },
  );
  await execute({ spaceId: social.id, reach: [{ platform: "TikTok", people: 40 }] });
  const read = tools.find((tool) => tool.name === "get_space_playbook")?.execute as (
    input: unknown,
  ) => Promise<{ lastWeekResults?: SocialWeek }>;
  const playbook = await read({ spaceId: social.id });
  assert.equal(playbook.lastWeekResults?.reach[0]?.people, 40);
  assert.ok(
    !spaceToolSpecs(spaces, "cy", {}).some((tool) => tool.name === "save_week_results"),
    "no results store, no tool",
  );
  // The first plan starts its 90 days; an edit keeps them; a new plan starts them again.
  let now = new Date("2026-09-14T17:00:00Z");
  const dated = new Spaces(db, () => now);
  const planAt = (space: { playbook: object }) => (space.playbook as { planAt?: string }).planAt;
  const planned = await dated.update("cy", social.id, { plan: "Aims: 500 followers" });
  assert.equal(planAt(planned), "2026-09-14T17:00:00.000Z");
  assert.equal("newPlan" in planned.playbook, false, "the flag isn't kept");
  now = new Date("2026-10-12T17:00:00Z");
  const edited = await dated.update("cy", social.id, { plan: "Aims: 600 followers" });
  assert.equal(planAt(edited), "2026-09-14T17:00:00.000Z");
  const fresh = await dated.update("cy", social.id, { plan: "Aims: sales", newPlan: true });
  assert.equal(planAt(fresh), "2026-10-12T17:00:00.000Z");
  // Once the 90 days are over, a changed plan is a new one even without newPlan.
  now = new Date("2027-01-12T17:00:00Z");
  const after = await dated.update("cy", social.id, { plan: "Aims: more sales" });
  assert.equal(planAt(after), "2027-01-12T17:00:00.000Z");
});

test("the Results tab's route is the person's own", async () => {
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
  const headers = { Authorization: `Bearer ${(await session.json()).token}` };
  const space = await new Spaces(db).create("local-user", { kind: "social" });
  await new SocialWeeks(db).save(
    "local-user",
    space.id,
    { reach: [{ platform: "Instagram", people: 700 }] },
    await server.agent.timeZone("local-user"),
  );
  const response = await server.app.request(`/api/spaces/${space.id}/results`, { headers });
  const { weeks } = (await response.json()) as { weeks: SocialWeek[] };
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0]?.reach[0]?.people, 700);
  const other = await server.app.request("/api/spaces/nope/results", { headers });
  assert.equal(other.status, 404);
});
