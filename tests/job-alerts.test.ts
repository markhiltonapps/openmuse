import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { createStore } from "../apps/server/src/db.ts";
import type { AgentTask } from "../packages/domain/src/agent.ts";

test("a job the person handed off emails them once when it's done, needs them, or fails", async () => {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-job-alerts-"));
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
    const owner = "mark";
    const agent = server.agent;
    const sent: { to: string; subject: string; text: string }[] = [];
    const pushed: { url?: string }[] = [];
    agent.jobMail = {
      send: async (message) => {
        sent.push(message);
      },
      appUrl: "https://muse.example.com",
      to: async (who) => (who === owner ? "mark@example.com" : undefined),
    };
    agent.push = {
      notify: async (_who, message) => {
        pushed.push(message);
      },
    };
    const publish = (task: AgentTask) =>
      (
        agent as unknown as { publishOutcome(o: string, t: AgentTask): Promise<void> }
      ).publishOutcome(owner, task);
    const settle = async (task: AgentTask, patch: Partial<AgentTask>) => {
      await db.put(owner, "tasks", { ...task, ...patch });
      await publish(task);
      // Maintenance publishes again every minute; that must not send a second email.
      await publish(task);
      await new Promise((resolve) => setTimeout(resolve, 20));
    };

    const job = await agent.delegate(owner, { prompt: "Compare three robot vacuums" });
    assert.equal(job.input.handedOff, true);
    await settle(job, { status: "succeeded", result: "**Top pick:** Roborock Q5" });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, "mark@example.com");
    assert.match(sent[0]?.subject ?? "", /^Done: /);
    assert.match(sent[0]?.text ?? "", /Top pick: Roborock Q5/);
    assert.match(sent[0]?.text ?? "", new RegExp(`\\?task=${job.id}`));
    // Tapping the phone notification opens that job.
    assert.equal(pushed.at(-1)?.url, `/?task=${encodeURIComponent(job.id)}`);

    const asks = await agent.delegate(owner, { prompt: "Check my order status" });
    await settle(asks, { status: "waiting_input", question: "Which site?" });
    assert.match(sent.at(-1)?.subject ?? "", /needs your answer/);

    // Routine runs and other automatic jobs don't email.
    const automatic = await agent.createTask(owner, { prompt: "Morning brief" });
    await settle(automatic, { status: "succeeded", result: "Brief" });
    assert.equal(sent.length, 2);

    // Turned off in Alerts: nothing is emailed, but the bell and push still work.
    await db.put(owner, "agent-settings", {
      id: "identity",
      name: "Neddy",
      tone: "warm",
      emailJobUpdates: false,
    });
    const quiet = await agent.delegate(owner, { prompt: "Find a gift" });
    await settle(quiet, { status: "failed", error: "The site was down" });
    assert.equal(sent.length, 2);
    assert.equal(pushed.at(-1)?.url, `/?task=${encodeURIComponent(quiet.id)}`);
  } finally {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
