import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { parseIdeas } from "../apps/server/src/ideas-ai.ts";

test("the agent writes ideas from what it knows, once a day or when asked", async () => {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-ideas-"));
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
  const server = await createApp(db, config);
  const agent = server.agent;
  // Written ideas need a model; the sample agent has none.
  Object.assign(agent.config, { agentBackend: "model", model: "anthropic/claude-test" });
  const prompts: string[] = [];
  agent.complete = async ({ prompt }) => {
    prompts.push(prompt);
    return `Here you go: {"ideas":[{"emoji":"📣","title":"I can watch competitor ads for Frontline, Council and Prompt","reason":"Each week I'd scan public ad libraries for your competitors and send one digest.","prompt":"Every Monday, look up new ads from Frontline, Council and Prompt competitors and send me a digest."},{"title":"no"}]}`;
  };
  const owner = "idea-writer";
  // Nothing known yet: no model call.
  await agent.refreshIdeas(owner, true);
  assert.equal(prompts.length, 0);
  await db.put(owner, "memories", {
    id: "m1",
    text: "Runs Neato, which sells Frontline, Council and Prompt",
    source: "chat",
    createdAt: new Date().toISOString(),
  });
  const ideas = await agent.refreshIdeas(owner, true);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0] ?? "", /Frontline, Council and Prompt/);
  const written = ideas.find((idea) => idea.input.source === "written");
  assert.equal(written?.emoji, "📣");
  assert.equal(written?.status, "new");
  assert.match(written?.title ?? "", /competitor ads/);
  // Asked again right away, or by the background check the same day: no second call.
  await agent.refreshIdeas(owner, true);
  await agent.refreshIdeas(owner);
  assert.equal(prompts.length, 1);
  await agent.stop();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("written ideas are read safely from the model's reply", () => {
  assert.deepEqual(parseIdeas("no json"), []);
  assert.deepEqual(
    parseIdeas(
      '{"ideas":[{"emoji":"abc","title":"I can plan your trip to Denver","reason":"You mentioned a trip.","prompt":"Plan a 3-day Denver trip."}]}',
    ),
    [
      {
        emoji: "💡",
        title: "I can plan your trip to Denver",
        reason: "You mentioned a trip.",
        prompt: "Plan a 3-day Denver trip.",
      },
    ],
  );
});
