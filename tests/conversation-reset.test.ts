import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { createStore } from "../apps/server/src/db.ts";

test("clearing the main chat deletes it and starts a new one", async () => {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-reset-"));
  const deleted: string[] = [];
  const server = await createApp(
    db,
    {
      mode: "sample",
      port: 8787,
      host: "127.0.0.1",
      publicUrl: "http://localhost:8787",
      dataDir: directory,
      agentBackend: "sample",
      intelligenceApiKey: "test-project-key-never-sent",
      googleRedirectUri: "http://localhost:8787/api/google/callback",
      allowedOrigins: [],
    },
    {
      intelligence: {
        getOrCreateThread: (async () => ({})) as never,
        deleteThread: async ({ threadId }) => {
          deleted.push(threadId);
        },
      },
    },
  );
  try {
    const { token } = await (
      await server.app.request("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).json();
    const call = (path: string, body?: unknown, method?: string) =>
      server.app.request(path, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const first = (await (await call("/api/main-thread")).json()).threadId;
    await call(
      "/api/conversation",
      { messages: [{ id: "m1", role: "user", content: "Hello" }] },
      "PUT",
    );
    assert.equal((await call("/api/main-thread/reset", {})).status, 200);
    const second = (await (await call("/api/main-thread")).json()).threadId;
    assert.notEqual(second, first);
    assert.deepEqual(deleted, [first]);
    assert.deepEqual((await (await call("/api/conversation")).json()).messages, []);
  } finally {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
