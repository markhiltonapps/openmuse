import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { nextRun } from "../apps/server/src/engine/routines.ts";
import type { AgentTask, Routine } from "../packages/domain/src/agent.ts";

test("next run respects the time zone, chosen days and daylight saving", () => {
  const weekdays = { time: "07:30", days: [1, 2, 3, 4, 5], timeZone: "America/Los_Angeles" };
  // Friday 2026-09-25 15:00 UTC is 08:00 PDT, so the next weekday run is Monday.
  assert.equal(nextRun(weekdays, Date.parse("2026-09-25T15:00:00Z")), "2026-09-28T14:30:00.000Z");
  // Earlier the same Friday, before 07:30 PDT.
  assert.equal(nextRun(weekdays, Date.parse("2026-09-25T13:00:00Z")), "2026-09-25T14:30:00.000Z");
  // US daylight saving ends 2026-11-01: 07:30 PST is 15:30 UTC.
  assert.equal(
    nextRun({ ...weekdays, days: [1] }, Date.parse("2026-10-30T00:00:00Z")),
    "2026-11-02T15:30:00.000Z",
  );
  assert.equal(
    nextRun(
      { time: "18:00", days: [0], timeZone: "Asia/Tokyo" },
      Date.parse("2026-09-26T00:00:00Z"),
    ),
    "2026-09-27T09:00:00.000Z",
  );
});

let db: Store, directory: string, server: Awaited<ReturnType<typeof createApp>>;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-routines-"));
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

test("due routines start one task per occurrence and skip long-missed runs", async () => {
  const agent = server.agent;
  await agent.setTimeZone("routine-user", "America/New_York");
  const routine = await agent.createRoutine("routine-user", {
    title: "Morning brief",
    prompt: "Brief me on today.",
    time: "08:00",
    days: [1, 2, 3, 4, 5],
  });
  assert.equal(routine.timeZone, "America/New_York");
  await assert.rejects(
    agent.createRoutine("routine-user", { title: "Bad", prompt: "x", time: "8am" }),
    /24-hour time/,
  );

  const due = "2026-09-28T12:00:00.000Z";
  await db.put("routine-user", "routines", { ...routine, nextRunAt: due });
  const now = Date.parse("2026-09-28T12:00:30Z");
  await Promise.all([agent.runDueRoutines(now), agent.runDueRoutines(now)]);
  const tasks = await db.list<AgentTask>("routine-user", "tasks");
  assert.equal(tasks.length, 1);
  assert.match(tasks[0]?.title ?? "", /^Morning brief · Sep 28$/);
  assert.match(tasks[0]?.prompt ?? "", /Brief me on today\./);
  const saved = await db.get<Routine>("routine-user", "routines", routine.id);
  assert.equal(saved?.lastTaskId, tasks[0]?.id);
  assert.equal(saved?.nextRunAt, "2026-09-29T12:00:00.000Z");

  await db.put("routine-user", "routines", { ...saved, nextRunAt: "2026-09-20T12:00:00.000Z" });
  await agent.runDueRoutines(Date.parse("2026-09-29T13:00:00Z"));
  assert.equal((await db.list<AgentTask>("routine-user", "tasks")).length, 1);

  await agent.updateRoutine("routine-user", routine.id, { enabled: false });
  const paused = await db.get<Routine>("routine-user", "routines", routine.id);
  await db.put("routine-user", "routines", { ...paused, nextRunAt: due } as Routine);
  await agent.runDueRoutines(now);
  assert.equal((await db.list<AgentTask>("routine-user", "tasks")).length, 1);

  const manual = await agent.runRoutine("routine-user", routine.id);
  assert.equal((await db.list<AgentTask>("routine-user", "tasks")).length, 2);
  assert.equal(manual.kind, "agent");
  await agent.deleteRoutine("routine-user", routine.id);
  assert.equal((await agent.snapshot("routine-user")).routines.length, 0);
});
