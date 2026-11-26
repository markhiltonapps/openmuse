import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { AppConnector } from "../apps/server/src/apps.ts";
import { createStore } from "../apps/server/src/db.ts";
import { draftOnlyToThem, onlyToThem, recipientsIn } from "../apps/server/src/self-send.ts";
import type { AgentTask } from "../packages/domain/src/agent.ts";
import { modelFixture } from "./helpers/model.ts";

const ME = ["mark@example.com", "Mark.Work@Example.com"];

test("only an email whose every recipient is the person counts as sending to themselves", () => {
  assert.deepEqual(recipientsIn({ recipient_email: "Mark@Example.com", subject: "x" }), [
    "mark@example.com",
  ]);
  assert.deepEqual(
    recipientsIn({
      toRecipients: [{ emailAddress: { address: "mark@example.com" } }],
      body: "write to sam@else.com",
    }),
    ["mark@example.com"],
    "addresses in the body aren't recipients",
  );
  assert.equal(onlyToThem("GMAIL_SEND_EMAIL", { recipient_email: "mark@example.com" }, ME), true);
  assert.equal(
    onlyToThem("OUTLOOK_SEND_EMAIL", { to: ["mark.work@example.com", "mark@example.com"] }, ME),
    true,
  );
  assert.equal(
    onlyToThem("GMAIL_SEND_EMAIL", { recipient_email: "mark@example.com", cc: ["sam@x.com"] }, ME),
    false,
    "anyone else on cc means it asks",
  );
  assert.equal(
    onlyToThem(
      "GMAIL_SEND_EMAIL",
      { recipient_email: "mark@example.com", extra_recipients: ["sam@x.com"] },
      ME,
    ),
    false,
  );
  assert.equal(onlyToThem("GMAIL_SEND_EMAIL", { subject: "no one" }, ME), false, "no recipient");
  assert.equal(onlyToThem("GMAIL_SEND_EMAIL", { recipient_email: "mark@example.com" }, []), false);
  assert.equal(
    onlyToThem("GMAIL_REPLY_TO_THREAD", { recipient_email: "mark@example.com" }, ME),
    false,
    "a reply's people can't be seen",
  );
  assert.equal(onlyToThem("SLACK_SEND_MESSAGE", { channel: "me" }, ME), false);
  assert.equal(draftOnlyToThem({ to: ["MARK@example.com"] }, ME), true);
  assert.equal(draftOnlyToThem({ to: ["mark@example.com"], bcc: ["boss@x.com"] }, ME), false);
});

async function setup(
  t: Parameters<typeof modelFixture>[0],
  calls: { name: string; arguments: object }[],
) {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-self-send-"));
  const db = await createStore();
  await modelFixture(t, (index) => calls[index % calls.length]);
  const sent: unknown[] = [];
  const apps: AppConnector = {
    search: async () => ({ tools: [], apps: [], guidance: [] }),
    tool: async (_owner, slug) => ({
      slug,
      name: "Send email",
      description: "Send an email",
      app: "gmail",
      readOnly: false,
    }),
    execute: async (_owner, slug, args) => {
      sent.push({ slug, args });
      return { successful: true, data: { id: "sent-1" } };
    },
    connect: async () => ({ connected: true }),
    connections: async () => [{ app: "gmail", name: "Gmail", connected: true }],
    directory: async () => [],
    disconnect: async () => {},
  };
  const server = await createApp(
    db,
    {
      mode: "sample",
      port: 8787,
      host: "127.0.0.1",
      publicUrl: "http://localhost:8787",
      dataDir: directory,
      agentBackend: "model",
      intelligenceApiKey: "test-project-key-never-sent",
      model: "openai/fixture",
      googleRedirectUri: "http://localhost:8787/api/google/callback",
      allowedOrigins: [],
    },
    { apps },
  );
  server.agent.accountEmail = async () => "mark@example.com";
  return {
    server,
    db,
    sent,
    done: async () => {
      await server.agent.stop();
      await db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("a routine's email only to the person goes without review; to anyone else it still asks", async (t) => {
  const calls = [
    {
      name: "use_app",
      arguments: {
        tool: "GMAIL_SEND_EMAIL",
        arguments: { recipient_email: "mark@example.com", subject: "Your brief", body: "…" },
        summary: "Email Mark his daily brief",
      },
    },
    { name: "finish_task", arguments: { summary: "Sent your brief." } },
  ];
  const { server, sent, done } = await setup(t, calls);
  try {
    const routine = await server.agent.createRoutine("o", {
      title: "Daily brief",
      prompt: "Email me a short brief",
      time: "08:00",
    });
    const run = await server.agent.runRoutine("o", routine.id, "2026-11-26T14:00:00.000Z");
    await server.agent.worker.tick();
    const saved = await server.agent.getTask("o", run.id);
    assert.equal(saved.status, "succeeded", saved.error ?? saved.question);
    assert.equal(sent.length, 1, "it ran without a card");

    // The same email to someone else waits for the person's OK.
    calls[0] = {
      name: "use_app",
      arguments: {
        tool: "GMAIL_SEND_EMAIL",
        arguments: { recipient_email: "dana@example.com", subject: "Brief", body: "…" },
        summary: "Email Dana the brief",
      },
    };
    const other = await server.agent.runRoutine("o", routine.id, "2026-11-27T14:00:00.000Z");
    await server.agent.worker.tick();
    assert.equal((await server.agent.getTask("o", other.id)).status, "waiting_approval");
    assert.equal(sent.length, 1);

    // A job the person handed off (not a routine) keeps asking even for their own address.
    calls[0] = {
      name: "use_app",
      arguments: {
        tool: "GMAIL_SEND_EMAIL",
        arguments: { recipient_email: "mark@example.com", subject: "x", body: "…" },
        summary: "Email Mark",
      },
    };
    const handed = await server.agent.createTask("o", { prompt: "Email me the list" });
    await server.agent.worker.tick();
    assert.equal((await server.agent.getTask("o", handed.id)).status, "waiting_approval");
  } finally {
    await done();
  }
});

test("a new run of a routine puts away older runs still waiting on the person", async (t) => {
  const { server, db, done } = await setup(t, [
    { name: "finish_task", arguments: { summary: "Done." } },
  ]);
  try {
    const routine = await server.agent.createRoutine("o", {
      title: "Social media digest",
      prompt: "Summarize my feeds",
      time: "09:00",
    });
    const first = await server.agent.runRoutine("o", routine.id, "2026-11-16T15:00:00.000Z");
    await db.put("o", "tasks", {
      ...(await server.agent.getTask("o", first.id)),
      status: "waiting_input",
      question: "Which feeds?",
    } as AgentTask);
    const unrelated = await server.agent.createTask("o", { prompt: "Something else" });
    await db.put("o", "tasks", {
      ...(await server.agent.getTask("o", unrelated.id)),
      status: "waiting_input",
      question: "Which one?",
    } as AgentTask);
    const second = await server.agent.runRoutine("o", routine.id, "2026-11-17T15:00:00.000Z");
    const old = await server.agent.getTask("o", first.id);
    assert.ok(old.archivedAt, "the older run is put away");
    assert.equal(old.state.supersededBy, second.id);
    assert.notEqual(old.status, "waiting_input", "and stopped, so it no longer needs an answer");
    assert.ok(!(await server.agent.getTask("o", unrelated.id)).archivedAt, "other jobs stay");
    assert.ok(!(await server.agent.getTask("o", second.id)).archivedAt);
  } finally {
    await done();
  }
});
