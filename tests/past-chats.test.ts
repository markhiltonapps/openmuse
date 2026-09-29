import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { PastChats, pastChatToolSpecs } from "../apps/server/src/past-chats.ts";
import { ownWords, parseChatExport } from "../packages/domain/src/chat-export.ts";

let db: Store, directory: string;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-past-chats-"));
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});
const config = (): Config => ({
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir: directory,
  agentBackend: "sample",
  intelligenceApiKey: "test-project-key-never-sent",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: ["http://localhost:8081"],
});

/** ChatGPT's conversations.json: a tree of messages, where an edit starts a new branch. */
const chatgpt = [
  {
    id: "gpt-pricing",
    title: "Pricing page ideas",
    create_time: 1727000000,
    update_time: 1727003600,
    current_node: "a2",
    mapping: {
      root: { parent: null, message: null },
      sys: {
        parent: "root",
        message: {
          author: { role: "system" },
          content: { content_type: "text", parts: ["You are ChatGPT"] },
        },
      },
      u1: {
        parent: "sys",
        message: {
          author: { role: "user" },
          create_time: 1727000100,
          content: {
            content_type: "text",
            parts: ["Draft three tiers for the Neato pricing page"],
          },
        },
      },
      a1old: {
        parent: "u1",
        message: {
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["An answer the person regenerated"] },
        },
      },
      a1: {
        parent: "u1",
        message: {
          author: { role: "assistant" },
          create_time: 1727000200,
          content: {
            content_type: "text",
            parts: ["Starter at $9, Pro at $29 and Team at $79 a month."],
          },
        },
      },
      tool: {
        parent: "a1",
        message: {
          author: { role: "assistant" },
          recipient: "python",
          content: { content_type: "code", text: "print(1)" },
        },
      },
      u2: {
        parent: "tool",
        message: {
          author: { role: "user" },
          create_time: 1727003000,
          content: {
            content_type: "multimodal_text",
            parts: [{ content_type: "image_asset_pointer" }, "Make Pro the highlighted tier"],
          },
        },
      },
      a2: {
        parent: "u2",
        message: {
          author: { role: "assistant" },
          create_time: 1727003100,
          content: { content_type: "text", parts: ["Done: Pro is highlighted as most popular."] },
        },
      },
    },
  },
  {
    id: "gpt-trip",
    title: "Lisbon trip",
    create_time: 1726000000,
    update_time: 1726000500,
    current_node: "t2",
    mapping: {
      t1: {
        parent: null,
        message: {
          author: { role: "user" },
          content: { content_type: "text", parts: ["Plan four days in Lisbon in May"] },
        },
      },
      t2: {
        parent: "t1",
        message: {
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Day one: Alfama and the castle."] },
        },
      },
    },
  },
];
/** Claude's conversations.json: messages in order, newer ones split into content blocks. */
const claude = [
  {
    uuid: "cl-launch",
    name: "Launch email",
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-02T09:00:00.000Z",
    chat_messages: [
      {
        sender: "human",
        text: "Write the launch email for the pricing page",
        created_at: "2026-08-01T10:00:00.000Z",
        attachments: [{ file_name: "tiers.pdf", extracted_content: "long text" }],
      },
      {
        sender: "assistant",
        text: "",
        content: [
          { type: "thinking", thinking: "Planning the email" },
          { type: "text", text: "Subject: Meet the new Neato pricing" },
          { type: "tool_use", name: "search" },
        ],
        created_at: "2026-08-01T10:00:30.000Z",
      },
    ],
  },
  { uuid: "cl-empty", name: "", chat_messages: [] },
];

test("both exports are read the way the person saw the chats", () => {
  const gpt = parseChatExport(chatgpt);
  assert.equal(gpt.source, "chatgpt");
  assert.equal(gpt.chats.length, 2);
  const pricing = gpt.chats[0];
  assert.equal(pricing?.title, "Pricing page ideas");
  assert.deepEqual(
    pricing?.messages.map((m) => [m.role, m.text]),
    [
      ["user", "Draft three tiers for the Neato pricing page"],
      ["assistant", "Starter at $9, Pro at $29 and Team at $79 a month."],
      ["user", "Make Pro the highlighted tier\n[picture]"],
      ["assistant", "Done: Pro is highlighted as most popular."],
    ],
  );
  assert.equal(pricing?.updatedAt, new Date(1727003600 * 1000).toISOString());
  const cl = parseChatExport(claude);
  assert.equal(cl.source, "claude");
  assert.equal(cl.chats.length, 1, "a chat with nothing said is skipped");
  assert.deepEqual(
    cl.chats[0]?.messages.map((m) => [m.role, m.text]),
    [
      ["user", "Write the launch email for the pricing page\n[attached: tiers.pdf]"],
      ["assistant", "Subject: Meet the new Neato pricing"],
    ],
  );
  assert.throws(() => parseChatExport([{ something: "else" }]), /ChatGPT or Claude export/);
  assert.throws(() => parseChatExport({}), /ChatGPT or Claude export/);
  assert.match(ownWords([...gpt.chats, ...cl.chats]), /launch email[\s\S]*highlighted tier/);
  // A very long chat keeps its start and end.
  const long = parseChatExport([
    {
      uuid: "long",
      name: "Long",
      created_at: "2026-01-01T00:00:00Z",
      chat_messages: Array.from({ length: 60 }, (_, i) => ({
        sender: i % 2 ? "assistant" : "human",
        text: `${i} ${"x".repeat(19000)}`,
      })),
    },
  ]).chats[0];
  assert.ok(long?.omitted && long.omitted > 0);
  assert.equal(long?.messages[0]?.text.startsWith("0 "), true);
  assert.equal(long?.messages.at(-1)?.text.startsWith("59 "), true);
});

test("the agent finds and reads past chats, and nothing else", async () => {
  const chats = new PastChats(db);
  const specs = pastChatToolSpecs(chats, "ava");
  const search = specs.find((s) => s.name === "search_past_chats")?.execute as (
    input: unknown,
  ) => Promise<{ results: { id: string; app: string; excerpts: string[] }[]; note?: string }>;
  const read = specs.find((s) => s.name === "read_past_chat")?.execute as (
    input: unknown,
  ) => Promise<Record<string, unknown>>;
  assert.match((await search({ query: "pricing" })).note ?? "", /hasn't brought over/);
  const gpt = parseChatExport(chatgpt);
  await chats.save("ava", { source: "chatgpt", chats: gpt.chats });
  await chats.finish("ava", "chatgpt");
  const { chats: fromClaude } = await chats.importFile(
    "ava",
    zipSync({ "conversations.json": strToU8(JSON.stringify(claude)), "users.json": strToU8("[]") }),
  );
  assert.equal(fromClaude.length, 1);
  assert.deepEqual(
    (await chats.sources("ava")).map((s) => [s.name, s.count]),
    [
      ["ChatGPT", 2],
      ["Claude", 1],
    ],
  );
  const found = await search({ query: "Neato pricing tiers" });
  assert.deepEqual(
    found.results.map((r) => r.app),
    ["ChatGPT", "Claude"],
  );
  assert.match(found.results[0]?.excerpts.join(" ") ?? "", /The person: Draft three tiers/);
  // No chat has every word: the ones with the telling words still come up.
  assert.equal((await search({ query: "Lisbon pricing zebra" })).results.length, 3);
  assert.deepEqual(
    (await search({ query: "pricing", app: "claude" })).results.map((r) => r.app),
    ["Claude"],
  );
  assert.match((await search({ query: "quantum" })).note ?? "", /No chats matched/);
  // JSON field names aren't words people search for.
  assert.equal((await search({ query: "role text" })).results.length, 0);
  const opened = await read({ id: found.results[0]?.id });
  assert.equal(opened.title, "Pricing page ideas");
  assert.deepEqual(
    (opened.messages as { from: string }[]).map((m) => m.from),
    ["The person", "ChatGPT", "The person", "ChatGPT"],
  );
  await assert.rejects(read({ id: "chatgpt:nope" }), /isn't in the history/);
  // Another person's chats never show up.
  const other = pastChatToolSpecs(chats, "bo").find((spec) => spec.name === "search_past_chats")
    ?.execute as (input: unknown) => Promise<{ note: string }>;
  const nothing = await other({ query: "pricing" });
  assert.match(nothing.note, /hasn't brought over/);
  // Bringing the same export over again replaces it rather than doubling it.
  await chats.save("ava", { source: "chatgpt", chats: gpt.chats });
  assert.equal((await chats.finish("ava", "chatgpt")).count, 2);
  await chats.remove("ava", "chatgpt");
  assert.deepEqual(
    (await chats.sources("ava")).map((s) => s.name),
    ["Claude"],
  );
  assert.deepEqual((await search({ query: "Lisbon" })).results, []);
});

test("the app sends chats in batches, or the file itself from a phone", async () => {
  const server = await createApp(db, config());
  const session = await server.app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const headers = {
    Authorization: `Bearer ${(await session.json()).token}`,
    "Content-Type": "application/json",
  };
  const post = (path: string, body: unknown) =>
    server.app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  const { chats } = parseChatExport(chatgpt);
  assert.equal((await post("/api/past-chats/batch", { source: "chatgpt", chats })).status, 200);
  const bad = await post("/api/past-chats/batch", {
    source: "chatgpt",
    chats: [{ ...chats[0], messages: [{ role: "system", text: "x" }] }],
  });
  assert.equal(bad.status, 422);
  const done = (await (await post("/api/past-chats/finish", { source: "chatgpt" })).json()) as {
    summary: { count: number };
    suggesting: boolean;
  };
  assert.equal(done.summary.count, 2);
  assert.equal(done.suggesting, false, "no model key in tests, so no memory suggestions");
  const form = new FormData();
  form.append(
    "file",
    new File([JSON.stringify(claude)], "conversations.json", { type: "application/json" }),
  );
  const upload = await server.app.request("/api/past-chats/upload", {
    method: "POST",
    headers: { Authorization: headers.Authorization },
    body: form,
  });
  assert.equal(upload.status, 200);
  const listed = (await (await server.app.request("/api/past-chats", { headers })).json()) as {
    sources: { name: string; count: number }[];
  };
  assert.deepEqual(
    listed.sources.map((s) => [s.name, s.count]),
    [
      ["ChatGPT", 2],
      ["Claude", 1],
    ],
  );
  const junk = new FormData();
  junk.append("file", new File(["not json"], "notes.txt"));
  const refused = await server.app.request("/api/past-chats/upload", {
    method: "POST",
    headers: { Authorization: headers.Authorization },
    body: junk,
  });
  assert.equal(refused.status, 422);
  const removed = (await (await post("/api/past-chats/remove", { source: "claude" })).json()) as {
    sources: { name: string }[];
  };
  assert.deepEqual(
    removed.sources.map((s) => s.name),
    ["ChatGPT"],
  );
});
