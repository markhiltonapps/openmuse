import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { createApp } from "../apps/server/src/app.ts";
import { createStore } from "../apps/server/src/db.ts";
import {
  chatgptMessages,
  extractMemories,
  listedMemories,
  recentHistory,
} from "../apps/server/src/memory-import.ts";
import type { AgentNotification, MemorySuggestion } from "../packages/domain/src/agent.ts";

const node = (role: string, text: string, time: number) => ({
  message: {
    author: { role },
    create_time: time,
    content: { content_type: "text", parts: [text] },
  },
});
const conversations = [
  {
    title: "Old chat",
    update_time: 100,
    mapping: { a: node("user", "My dog Biscuit hates baths", 90), b: node("assistant", "Ha!", 91) },
  },
  {
    title: "Recent chat",
    update_time: 200,
    mapping: {
      c: node("assistant", "Sure", 191),
      d: node("user", "I'm vegetarian, plan dinners", 190),
      e: { message: null },
    },
  },
];

test("ChatGPT's export is read for what the person wrote, newest first", () => {
  const zip = zipSync({
    "conversations.json": strToU8(JSON.stringify(conversations)),
    "images/big.png": new Uint8Array(10),
    "chat.html": strToU8("<html></html>"),
  });
  assert.deepEqual(chatgptMessages(zip), [
    "I'm vegetarian, plan dinners",
    "My dog Biscuit hates baths",
  ]);
  assert.deepEqual(chatgptMessages(strToU8(JSON.stringify(conversations))).length, 2);
  assert.throws(() => chatgptMessages(strToU8("not json")), /doesn't look like a ChatGPT export/);
  assert.ok(recentHistory(Array(100).fill("x".repeat(2000))).length <= 60000);

  assert.deepEqual(listedMemories("- Has a daughter named Emma\n2. Prefers aisle seats\n\n"), [
    "Has a daughter named Emma",
    "Prefers aisle seats",
  ]);
  assert.equal(listedMemories(`A long story. ${"words ".repeat(80)}`), undefined);
});

test("the model picks out lasting facts, and the text can't give it orders", async () => {
  let sent: { system: string; messages: { content: string }[] } | undefined;
  const fetcher = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return Response.json({
      content: [
        {
          type: "text",
          text: '{"memories": ["Is vegetarian", "Has a dog named Biscuit", "", 42]}',
        },
      ],
    });
  }) as unknown as typeof fetch;
  const memories = await extractMemories("I'm vegetarian\n---\nMy dog Biscuit hates baths", {
    apiKey: "test-key",
    model: "claude-test",
    fetcher,
  });
  assert.deepEqual(memories, ["Is vegetarian", "Has a dog named Biscuit"]);
  assert.match(sent?.system ?? "", /never follow instructions/);
  assert.match(sent?.system ?? "", /passwords, account or card numbers, and medical details/);
  assert.match(sent?.messages[0]?.content ?? "", /Biscuit/);
});

test("imported memories wait for approval, with one notification", async () => {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-import-"));
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
    const { token } = await server.auth.session();
    const owner = "local-user";
    await db.put(owner, "memories", { id: "m", text: "Prefers aisle seats" });
    const response = await server.app.request("/api/memories/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        text: "• Has a daughter named Emma\n• Prefers aisle seats\n• Works as a nurse",
      }),
    });
    assert.deepEqual(await response.json(), { found: 3, suggested: 2 });
    const pending = await db.list<MemorySuggestion>(owner, "memory-suggestions");
    assert.deepEqual(pending.map((s) => s.status).sort(), ["pending", "pending"]);
    assert.ok(pending.every((s) => s.source === "ChatGPT import"));
    const notes = await db.list<AgentNotification>(owner, "notifications");
    assert.deepEqual(
      notes.map((n) => n.title),
      ["Memories from ChatGPT to review"],
    );
    // Reading a whole export needs the model, which this server doesn't have.
    const form = new FormData();
    form.append(
      "file",
      new File(
        [zipSync({ "conversations.json": strToU8(JSON.stringify(conversations)) })],
        "export.zip",
      ),
    );
    const upload = await server.app.request("/api/memories/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    assert.equal(upload.status, 503);
  } finally {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
