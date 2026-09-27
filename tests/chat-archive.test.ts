import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { createStore } from "../apps/server/src/db.ts";

test("chats are kept by the app, so they outlive CopilotKit's retention", async () => {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-archive-"));
  const intelligence = {
    getOrCreateThread: async () => ({ thread: {}, created: false }) as never,
    deleteThread: async () => undefined,
  };
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
    { intelligence: intelligence as never },
  );
  try {
    const { token } = await server.auth.session();
    const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
    const call = (path: string, method = "GET", body?: unknown) =>
      server.app.request(path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const messages = [
      { id: "u1", role: "user", content: "Plan a weekend   in Austin with the kids" },
      { id: "a1", role: "assistant", content: "Here's a plan." },
    ];
    const saved = await call("/api/threads/side-1/archive", "PUT", { messages });
    assert.deepEqual(await saved.json(), { saved: 2 });
    assert.deepEqual(
      await (
        await call("/api/threads/side-2/archive", "PUT", { messages: [{ nope: true }] })
      ).json(),
      { saved: 0 },
      "only real chat messages are kept",
    );
    const list = (await (await call("/api/threads/archive")).json()) as {
      threadId: string;
      name: string;
    }[];
    assert.deepEqual(
      list.map(({ threadId, name }) => ({ threadId, name })),
      [{ threadId: "side-1", name: "Plan a weekend in Austin with the kids" }],
    );
    const restored = (await (await call("/api/threads/side-1/archive")).json()) as {
      messages: unknown[];
    };
    assert.deepEqual(restored.messages, messages);
    assert.deepEqual(await (await call("/api/threads/unknown/archive")).json(), { messages: [] });

    // Clearing the main chat clears its copy too.
    const main = (await (await call("/api/main-thread")).json()) as { threadId: string };
    await call(`/api/threads/${main.threadId}/archive`, "PUT", { messages });
    await call("/api/main-thread/reset", "POST", {});
    assert.deepEqual(await (await call(`/api/threads/${main.threadId}/archive`)).json(), {
      messages: [],
    });

    assert.equal((await call("/api/threads/side-1/archive/delete", "POST", {})).status, 200);
    assert.equal((await call("/api/threads/side-1/archive/delete", "POST", {})).status, 404);
  } finally {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
