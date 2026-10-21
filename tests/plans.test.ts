import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EventType } from "@ag-ui/core";
import { lastValueFrom, toArray } from "rxjs";
import { AccountService } from "../apps/server/src/accounts.ts";
import { createApp } from "../apps/server/src/app.ts";
import { ADMIN_OWNER } from "../apps/server/src/auth.ts";
import { createStore } from "../apps/server/src/db.ts";
import { ConversationAgent } from "../apps/server/src/engine/conversation.ts";
import { nextMonthDay, Plans } from "../apps/server/src/plans.ts";
import { UsageMeter } from "../apps/server/src/usage.ts";
import { PIPECAT_MODEL, voiceAllowance } from "../apps/server/src/voice-pipecat.ts";
import { CONTACT_EMAIL, EXTRAS, limitText, nextPlan, PLANS } from "../packages/domain/src/plans.ts";

const early = { callMinutes: 200, meetingHours: 10 };

test("the paid plans are final and Max is exactly five times Neddy", () => {
  assert.deepEqual(
    [PLANS.starter, PLANS.neddy, PLANS.max].map((p) => p.price),
    [10, 20, 100],
  );
  for (const key of ["price", "callMinutes", "messages", "meetingHours", "jobs"] as const)
    assert.equal(PLANS.max[key], (PLANS.neddy[key] as number) * 5, key);
  // Free costs real money, so it stays small.
  assert.ok((PLANS.free.messages as number) <= 100 && PLANS.free.callMinutes <= 5);
  assert.equal(nextPlan("free")?.id, "starter");
  assert.equal(nextPlan("max"), undefined);
  assert.equal(nextPlan("early"), undefined);
});

test("someone with no plan keeps today's limits and nothing is counted", async () => {
  const db = await createStore();
  const plans = new Plans(db, { early });
  const { plan, limit } = await plans.limits("sam");
  assert.equal(plan.id, "early");
  assert.deepEqual(limit, { callMinutes: 200, messages: null, meetingHours: 10, jobs: null });
  for (let i = 0; i < 300; i++) assert.equal((await plans.claimMessage("sam", `m${i}`)).ok, true);
  // A limit of 0 from the old variables still means no limit.
  const open = new Plans(db, { early: { callMinutes: 0, meetingHours: 0 } });
  assert.equal((await open.limits("sam")).limit.callMinutes, null);
  await db.close();
});

test("messages count once each, stop at the plan's number, and come back next month", async () => {
  const db = await createStore();
  let now = new Date("2026-10-20T12:00:00Z");
  const plans = new Plans(db, { early, now: () => now });
  await plans.setPlan("sam", "free");
  const limit = PLANS.free.messages as number;
  for (let i = 0; i < limit; i++) assert.equal((await plans.claimMessage("sam", `m${i}`)).ok, true);
  // A retry of a message already counted goes through and isn't counted again.
  assert.equal((await plans.claimMessage("sam", `m${limit - 1}`)).ok, true);
  assert.equal((await plans.counts("sam")).messages, limit);
  const refused = await plans.claimMessage("sam", "one-too-many");
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? "" : refused.text, /used this month’s 100 messages on the Free plan/);
  assert.match(refused.ok ? "" : refused.text, /November 1/);
  assert.match(refused.ok ? "" : refused.text, /hello@neatoventures\.com/);
  // Other people are unaffected, and the next month starts fresh.
  assert.equal((await plans.claimMessage("kim", "m0")).ok, true);
  now = new Date("2026-11-01T00:30:00Z");
  assert.equal((await plans.claimMessage("sam", "one-too-many")).ok, true);
  assert.equal((await plans.counts("sam")).messages, 1);
  await db.close();
});

test("two messages sent at the same moment can't both slip under the limit", async () => {
  const db = await createStore();
  const plans = new Plans(db, { early });
  await plans.setPlan("sam", "free");
  for (let i = 0; i < 99; i++) await plans.claimMessage("sam", `m${i}`);
  const both = await Promise.all([plans.claimMessage("sam", "a"), plans.claimMessage("sam", "b")]);
  assert.deepEqual(both.map((r) => r.ok).sort(), [false, true]);
  await db.close();
});

test("extras raise this month's limit, and jobs count the same way", async () => {
  const db = await createStore();
  const plans = new Plans(db, { early });
  await plans.setPlan("sam", "free");
  assert.equal((await plans.claimJob("sam", "job1")).ok, true);
  const noRoom = await plans.claimJob("sam", "job2");
  assert.equal(noRoom.ok, false);
  assert.match(
    noRoom.ok ? "" : noRoom.text,
    /this month’s background job on the Free plan\. It comes back on/,
  );
  const view = await plans.addExtra("sam", "jobs", 2);
  assert.equal(view.limit.jobs, (PLANS.free.jobs as number) + 2 * EXTRAS.jobs.amount);
  assert.equal((await plans.claimJob("sam", "job2")).ok, true);
  assert.equal((await plans.claimJob("sam", "job3")).ok, true);
  assert.equal((await plans.claimJob("sam", "job4")).ok, false);
  await assert.rejects(plans.addExtra("sam", "messages", 0), /between 1 and 100/);
  await db.close();
});

test("call minutes and meeting hours follow the plan, with early access's own numbers", async () => {
  const db = await createStore();
  const plans = new Plans(db, { early: { callMinutes: 150, meetingHours: 8 } });
  assert.equal((await plans.limits("sam")).limit.callMinutes, 150);
  await plans.setPlan("sam", "neddy");
  const { limit } = await plans.limits("sam");
  assert.equal(limit.callMinutes, 60);
  assert.equal(limit.meetingHours, 3);
  await plans.addExtra("sam", "callMinutes");
  assert.equal((await plans.limits("sam")).limit.callMinutes, 90);
  await assert.rejects(plans.setPlan("sam", "bogus" as never), /isn’t one of the plans/);
  await db.close();
});

test("what people are told says when it comes back and how to get more", () => {
  assert.equal(nextMonthDay("UTC", new Date("2026-12-15T12:00:00Z")), "January 1");
  const text = limitText("callMinutes", PLANS.starter, 20, "November 1");
  // The call screen recognizes a used-up month by how this starts.
  assert.ok(text.startsWith("You’ve used this month’s"));
  assert.match(text, /20 minutes of live talk on the Starter plan/);
  assert.match(text, /you can still type/);
  assert.match(text, new RegExp(CONTACT_EMAIL.replace(".", "\\.")));
  const withBilling = limitText("messages", PLANS.max, 5000, "November 1", true);
  assert.match(withBilling, /add 50 more messages for \$4/);
  // Prices read like prices: 80¢, $1.50, $3.60.
  assert.match(
    limitText("meetingHours", PLANS.neddy, 3, "May 1", true),
    /another meeting hour for 80¢/,
  );
  assert.match(
    limitText("jobs", PLANS.neddy, 5, "May 1", true),
    /another background job for \$1\.50/,
  );
  assert.match(
    limitText("callMinutes", PLANS.neddy, 60, "May 1", true),
    /30 more call minutes for \$3\.60/,
  );
  assert.match(limitText("messages", PLANS.early, 10, "May 1"), /on early access\./);
  assert.doesNotMatch(withBilling, /move up/);
  assert.match(
    limitText("meetingHours", PLANS.free, 0.5, "May 1"),
    /30 minutes of recorded meetings/,
  );
});

test("a typed message past the limit gets a kind note, not a model call", async () => {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-plans-"));
  const config = {
    mode: "sample" as const,
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample" as const,
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  const { agent } = await createApp(db, config);
  try {
    const plans = agent.plans as Plans;
    await plans.setPlan("local-user", "free");
    for (let i = 0; i < (PLANS.free.messages as number); i++)
      await plans.claimMessage("local-user", `used-${i}`);
    const run = (id: string, threadId = "plans-test") =>
      lastValueFrom(
        new ConversationAgent(config, agent, "local-user")
          .run({
            threadId,
            runId: `run-${id}`,
            messages: [{ id, role: "user", content: "Show my calendar" }],
            tools: [],
            context: [],
            state: {},
          })
          .pipe(toArray()),
      );
    const refused = await run("over-the-limit");
    const types = refused.map((e) => e.type);
    assert.deepEqual(types, [
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    assert.match(JSON.stringify(refused), /used this month’s 100 messages on the Free plan/);
    assert.doesNotMatch(JSON.stringify(refused), /Your local calendar has/);
    // A live call's hand-off isn't a typed message: it carries on as before.
    const handOff = await run("from-a-call", "voice-123");
    assert.match(JSON.stringify(handOff), /Your local calendar has/);
    // More room, and the same person can chat again.
    await plans.addExtra("local-user", "messages");
    assert.match(JSON.stringify(await run("after-extras")), /Your local calendar has/);
    // A job handed off past the limit is refused kindly too.
    await plans.claimJob("local-user", "first-job");
    await assert.rejects(
      agent.delegate("local-user", { prompt: "Find me a flight to Denver", kind: "agent" }),
      /background job on the Free plan/,
    );
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the admin sets plans and extras through the routes, and anyone reads their own plan", async () => {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-plans-routes-"));
  const config = {
    mode: "sample" as const,
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample" as const,
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  const { app, agent } = await createApp(db, config);
  try {
    const { token } = await (
      await app.request("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).json();
    const call = (path: string, body?: unknown) =>
      app.request(path, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const plans = agent.plans as Plans;
    const admin = ADMIN_OWNER;
    assert.equal((await plans.planOf(admin)).id, "early");
    const before = await (await call("/api/plan")).json();
    assert.equal(before.plan, "early");
    assert.equal(before.contact, "hello@neatoventures.com");
    assert.equal((await call(`/api/accounts/${admin}/plan`, { plan: "starter" })).status, 200);
    assert.equal((await plans.planOf(admin)).id, "starter");
    const extra = await call(`/api/accounts/${admin}/extras`, { kind: "messages", packs: 2 });
    assert.equal((await extra.json()).limit.messages, 600);
    assert.equal((await call(`/api/accounts/${admin}/plan`, { plan: "bogus" })).status, 422);
    assert.equal((await call(`/api/accounts/nobody/plan`, { plan: "free" })).status, 404);
    const mine = await (await call("/api/plan")).json();
    assert.equal(mine.name, "Starter");
    assert.equal(mine.limit.callMinutes, 20);
    assert.equal(mine.messages, 0);
    // The plan tools the chat and calls use: ask, and the admin changes a plan by saying so.
    const asked = (await agent.planTools?.mine(admin)) as { plan: string; comesBack: string };
    assert.equal(asked.plan, "Starter");
    assert.match(asked.comesBack, /^[A-Z][a-z]+ 1$/);
    assert.deepEqual(await agent.planTools?.setPlan(admin, "me", "neddy"), {
      who: "you",
      plan: "Neddy",
    });
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("people invited from now on start on Free; people already here keep early access", async () => {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-plans-invite-"));
  const config = {
    mode: "live" as const,
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    accessKey: "a-private-test-key-with-enough-characters",
    agentBackend: "model" as const,
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
    appUrl: "https://app.test/",
    adminEmail: "boss@example.com",
    resendApiKey: "re_test",
  };
  const sent: unknown[] = [];
  const server = await createApp(db, config, {
    mailer: {
      send: async (message) => {
        sent.push(message);
      },
    },
  });
  try {
    const accounts = new AccountService(db, config, server.auth, {
      send: async (message) => {
        sent.push(message);
      },
    });
    const plans = server.agent.plans as Plans;
    const person = await accounts.invite(ADMIN_OWNER, { email: "dana@example.com", name: "Dana" });
    assert.equal((await plans.planOf(person.id)).id, "free");
    assert.equal((await plans.planOf(ADMIN_OWNER)).id, "early");
    // Someone who was here before plans keeps what they had.
    assert.equal((await plans.planOf("an-earlier-tester")).id, "early");
  } finally {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a plan counts live talk on either voice; early access only ever counted our own", async () => {
  const db = await createStore();
  const usage = new UsageMeter(db);
  await usage.recordSeconds("sam", "gpt-live-1", 120);
  await usage.recordSeconds("sam", PIPECAT_MODEL, 60);
  const config = { voiceMonthlyMinutes: 200 };
  const early = await voiceAllowance(usage, config, "sam", 200, false);
  assert.equal(early.usedMinutes, 1);
  const onAPlan = await voiceAllowance(usage, config, "sam", 5, true);
  assert.equal(onAPlan.usedMinutes, 3);
  assert.equal(onAPlan.limitMinutes, 5);
  assert.equal(onAPlan.leftSeconds, 120);
  await db.close();
});
