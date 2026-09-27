import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { createStore } from "../apps/server/src/db.ts";
import type { AgentNotification } from "../packages/domain/src/agent.ts";

test("dismissing an update clears every update about that task", async () => {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-notes-"));
  const server = await createApp(db, {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  });
  try {
    const owner = "reader";
    const agent = server.agent;
    await assert.rejects(
      agent.createTask(owner, { kind: "document", prompt: "Summarize the brochure PDF" }),
      /use read_file/,
    );
    const task = await agent.createTask(owner, { prompt: "Plan a trip" });
    const other = await agent.createTask(owner, { prompt: "Find a gift" });
    await agent.notify(owner, "Task needs attention", "It failed", task.id, "a");
    await agent.notify(owner, "Task needs attention", "It failed again", task.id, "b");
    await agent.notify(owner, "Task needs attention", "Other", other.id, "c");
    const unread = async () =>
      (await db.list<AgentNotification>(owner, "notifications"))
        .filter((n) => !n.read)
        .map((n) => n.body)
        .sort();
    assert.equal(await agent.readTaskNotifications(owner, task.id), 2);
    assert.deepEqual(await unread(), ["Other"]);
    // Cancelling a task also answers its updates.
    await agent.control(owner, other.id, "cancel");
    assert.deepEqual(await unread(), []);
  } finally {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
