import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { createApp } from "../apps/server/src/app.ts";
import { withoutHidden } from "../apps/server/src/data-controls.ts";
import { createStore } from "../apps/server/src/db.ts";

test("a deleted reply takes its tool results with it", () => {
  const messages = [
    { id: "u1", role: "user" },
    { id: "a1", role: "assistant", toolCalls: [{ id: "call-1" }] },
    { id: "t1", role: "tool", toolCallId: "call-1" },
    { id: "a2", role: "assistant" },
    { id: "u2", role: "user" },
  ];
  assert.deepEqual(
    withoutHidden(messages, new Set(["a1", "u2"])).map((m) => m.id),
    ["u1", "a2"],
  );
  assert.equal(withoutHidden(messages, new Set()), messages);
});

test("people can delete a message, download everything, and reset their agent", async () => {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-data-"));
  const deleted: string[] = [];
  const intelligence = {
    getOrCreateThread: async () => ({ thread: {}, created: false }) as never,
    deleteThread: async ({ threadId }: { threadId: string }) => {
      deleted.push(threadId);
    },
    listThreads: async () => ({
      threads: [{ id: "thread-side-1234", name: "Trip plans" }],
      joinCode: "",
    }),
    getThreadMessages: async () => ({
      messages: [{ id: "m1", role: "user", content: "Plan Lisbon" }],
    }),
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
    const owner = "local-user";
    const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
    const post = (path: string, body: unknown = {}) =>
      server.app.request(path, { method: "POST", headers, body: JSON.stringify(body) });

    // Delete one message from a chat.
    const hidden = await post("/api/threads/thread-side-1234/messages/m1/delete");
    assert.deepEqual(await hidden.json(), { messageIds: ["m1"] });
    const listed = await server.app.request("/api/threads/thread-side-1234/hidden", { headers });
    assert.deepEqual(await listed.json(), { messageIds: ["m1"] });
    const other = await server.app.request("/api/threads/another/hidden", { headers });
    assert.deepEqual(await other.json(), { messageIds: [] });

    // Some data to export and reset.
    await db.put(owner, "memories", { id: "mem-1", text: "Allergic to peanuts" });
    await db.put(owner, "credentials", { id: "google", secret: "never-exported" });
    await db.put(owner, "agent-settings", { id: "preferences", timeZone: "America/Chicago" });
    await db.put(owner, "conversation-settings", { id: "main", threadId: "thread-main" });
    const file = await server.agent.files.import(
      owner,
      "notes.txt",
      new TextEncoder().encode("Pack sunscreen"),
      "Uploaded by you",
    );

    const link = (await (await post("/api/account/export-link")).json()) as { url: string };
    const url = new URL(link.url);
    const download = await server.app.request(`${url.pathname}${url.search}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/zip");
    assert.match(download.headers.get("content-disposition") ?? "", /openmuse-export-.*\.zip/);
    const zip = unzipSync(new Uint8Array(await download.arrayBuffer()));
    assert.deepEqual(JSON.parse(strFromU8(zip["data/memories.json"] ?? new Uint8Array())), [
      { id: "mem-1", text: "Allergic to peanuts" },
    ]);
    assert.equal(zip["data/credentials.json"], undefined, "sign-in secrets stay out");
    assert.ok(!Object.values(zip).some((bytes) => strFromU8(bytes).includes("never-exported")));
    const chat = Object.keys(zip).find((name) => name.startsWith("chats/Trip_plans"));
    assert.ok(chat);
    assert.match(strFromU8(zip[chat] ?? new Uint8Array()), /Plan Lisbon/);
    const saved = Object.keys(zip).find((name) => name.endsWith("notes.txt"));
    assert.equal(strFromU8(zip[saved ?? ""] ?? new Uint8Array()), "Pack sunscreen");
    assert.ok(zip["README.txt"]);
    // Without the signature, or with someone else's session, there's no export.
    assert.equal((await server.app.request("/api/account/export")).status, 401);

    // Reset needs the word RESET, then clears what the agent knows and made.
    assert.equal((await post("/api/account/reset", {})).status, 422);
    const reset = await post("/api/account/reset", { confirm: "RESET" });
    assert.equal(reset.status, 200);
    assert.deepEqual(deleted.sort(), ["thread-main", "thread-side-1234"]);
    assert.deepEqual(await db.list(owner, "memories"), []);
    assert.deepEqual(await db.list(owner, "files"), []);
    assert.deepEqual(await db.list(owner, "hidden-messages"), []);
    await assert.rejects(access(join(directory, "files", `${file.id}.txt`)));
    assert.ok(await db.get(owner, "credentials", "google"), "connected services stay connected");
    assert.deepEqual(await db.get(owner, "agent-settings", "preferences"), {
      id: "preferences",
      timeZone: "America/Chicago",
    });
    assert.equal((await server.app.request("/api/me", { headers })).status, 200);
  } finally {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
