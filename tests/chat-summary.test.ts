import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ChatSummaries,
  cutPoint,
  LIMIT,
  searchEarlier,
  transcript,
} from "../apps/server/src/chat-summary.ts";
import { createStore } from "../apps/server/src/db.ts";

/** A chat of `turns` exchanges, each about `size` characters long. */
function chat(turns: number, size = 2000) {
  return Array.from({ length: turns }, (_, i) => [
    { id: `u${i}`, role: "user", content: `question ${i} ${"x".repeat(size)}` },
    {
      id: `a${i}`,
      role: "assistant",
      content: `answer ${i}`,
      toolCalls: [{ id: `c${i}`, function: { name: "search_web", arguments: "{}" } }],
    },
    { id: `t${i}`, role: "tool", toolCallId: `c${i}`, content: `result ${i}` },
  ]).flat();
}

test("short chats pass through untouched and cost nothing", async () => {
  const db = await createStore();
  let calls = 0;
  const chats = new ChatSummaries(db, async () => {
    calls++;
    return "summary";
  });
  const messages = chat(5);
  const result = await chats.compact("o", "t1", messages);
  assert.equal(result.messages, messages);
  assert.equal(result.summary, undefined);
  assert.equal(calls, 0);
});

test("long chats keep recent messages word for word and summarize the rest once", async () => {
  const db = await createStore();
  const asked: string[] = [];
  const chats = new ChatSummaries(db, async (_owner, previous, text) => {
    asked.push(`${previous}|${text.slice(0, 40)}`);
    return `summary ${asked.length}`;
  });
  const messages = chat(80);
  const first = await chats.compact("o", "t1", messages);
  assert.equal(first.summary, "summary 1");
  assert.equal(first.messages[0]?.role, "user", "the kept part starts at a person's message");
  assert.ok(first.messages.length >= 12 && first.messages.length < messages.length);
  assert.equal(first.earlier.length + first.messages.length, messages.length);
  // A few more messages: the saved summary still covers the older part, so no new call.
  const more = [...messages, ...chat(3).map((m) => ({ ...m, id: `n${m.id}` }))];
  const second = await chats.compact("o", "t1", more);
  assert.equal(second.summary, "summary 1");
  assert.equal(asked.length, 1);
  // Much longer: the summary is extended from where it left off, not rewritten from scratch.
  const longer = [...more, ...chat(60).map((m) => ({ ...m, id: `m${m.id}` }))];
  const third = await chats.compact("o", "t1", longer);
  assert.equal(third.summary, "summary 2");
  assert.match(asked[1] ?? "", /^summary 1\|/);
  const size = third.messages.reduce((sum, m) => sum + JSON.stringify(m).length, 0);
  assert.ok(size <= LIMIT);
});

test("a failed summary falls back to the recent messages instead of breaking the chat", async () => {
  const db = await createStore();
  const chats = new ChatSummaries(db, async () => {
    throw new Error("model down");
  });
  const result = await chats.compact("o", "t1", chat(80));
  assert.equal(result.summary, undefined);
  assert.equal(result.messages[0]?.role, "user");
});

test("the cut never separates a tool result from its call, and older messages stay searchable", () => {
  const messages = chat(80);
  const cut = cutPoint(messages);
  assert.equal(messages[cut]?.role, "user");
  const hits = searchEarlier(
    [{ id: "1", role: "user", content: "Book the Hotel Esmeralda for June 3" }, ...messages],
    "esmeralda hotel",
  );
  assert.deepEqual(hits[0], { from: "person", text: "Book the Hotel Esmeralda for June 3" });
  assert.match(transcript(messages.slice(0, 3)), /^Person: question 0/);
  assert.match(transcript(messages.slice(0, 3)), /\[used search_web/);
});
