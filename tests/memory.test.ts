import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import type { AgentMemory } from "../packages/domain/src/agent.ts";

let db: Store, directory: string, server: Awaited<ReturnType<typeof createApp>>;
let headers: Record<string, string>;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-memory-"));
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
  const { token } = await (
    await server.app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  ).json();
  headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
});
after(async () => {
  await server.agent.stop();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("memory suggestions wait for the person and are used only once kept", async () => {
  const agent = server.agent;
  const first = await agent.suggestMemory(
    "local-user",
    { text: "Prefers aisle seats on flights", reason: "Mentioned while planning a trip" },
    "chat",
  );
  assert.equal(first.status, "suggested");
  assert.equal(
    (await agent.suggestMemory("local-user", { text: "prefers  AISLE seats on flights" }, "chat"))
      .status,
    "already_suggested",
  );
  assert.deepEqual(await agent.memoryContext("local-user"), []);
  const snapshot = await agent.snapshot("local-user");
  assert.deepEqual(
    snapshot.memorySuggestions.map((s) => s.text),
    ["Prefers aisle seats on flights"],
  );
  assert.ok(snapshot.notifications.some((n) => n.body === "Prefers aisle seats on flights"));

  const kept = await server.app.request(`/api/agent/memory-suggestions/${first.id}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "keep", text: "Prefers aisle seats" }),
  });
  assert.equal(kept.status, 200);
  assert.deepEqual(await agent.memoryContext("local-user"), ["Prefers aisle seats"]);
  const memories = await db.list<AgentMemory>("local-user", "memories");
  assert.ok(memories.some((m) => m.source === "Suggested from chat"));
  const again = await server.app.request(`/api/agent/memory-suggestions/${first.id}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "dismiss" }),
  });
  assert.equal(again.status, 409);
  assert.equal((await agent.snapshot("local-user")).memorySuggestions.length, 0);
  assert.equal(
    (await agent.suggestMemory("local-user", { text: "Prefers aisle seats" }, "chat")).status,
    "already_remembered",
  );

  const other = await agent.suggestMemory("local-user", { text: "Daughter is named Ava" }, "chat");
  await server.app.request(`/api/agent/memory-suggestions/${other.id}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "dismiss" }),
  });
  assert.deepEqual(await agent.memoryContext("local-user"), ["Prefers aisle seats"]);
});
