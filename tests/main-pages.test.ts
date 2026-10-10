import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  earlierPages,
  MainPages,
  mainSettings,
  PAGE_BYTES,
  searchEarlierPages,
} from "../apps/server/src/main-pages.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close?.();
});

const big = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 ? "assistant" : "user",
    content: `${i % 2 ? "Reply" : "Question"} ${i} about the Lisbon trip ${"x".repeat(200)}`,
  }));

function setup() {
  const stored = new Map<string, unknown[]>();
  const created: string[] = [];
  const merged: { previous: string; count: number }[] = [];
  const threads = {
    getOrCreateThread: async ({ threadId }: { threadId: string }) => {
      created.push(threadId);
      return {};
    },
    getThreadMessages: async ({ threadId }: { threadId: string }) => ({
      messages: stored.get(threadId) ?? [],
    }),
  };
  const chats = {
    saved: async () => null,
    merge: async (_owner: string, previous: string, messages: unknown[]) => {
      merged.push({ previous, count: messages.length });
      return `Summary through ${messages.length} messages`;
    },
  };
  const pages = new MainPages(db, threads, chats as never, async () => []);
  return { pages, stored, created, merged };
}

test("the main chat starts a new page once it's big, and keeps the old one whole", async () => {
  const owner = "pages-1";
  const { pages, stored, created, merged } = setup();
  const first = await pages.open(owner);
  assert.equal(first.pages, undefined);
  const messages = big(4000);
  stored.set(first.threadId, messages);

  // Small: nothing happens.
  await pages.noteSize(owner, first.threadId, 10_000);
  assert.equal((await pages.open(owner)).threadId, first.threadId);
  // Another chat's size never turns the main one.
  await pages.noteSize(owner, "side-chat", PAGE_BYTES * 2);
  assert.equal((await mainSettings(db, owner))?.turnDue, undefined);

  await pages.noteSize(owner, first.threadId, PAGE_BYTES + 1);
  const turned = await pages.open(owner);
  assert.notEqual(turned.threadId, first.threadId);
  assert.ok(created.includes(turned.threadId));
  assert.deepEqual(
    turned.pages?.map((page) => [page.threadId, page.count]),
    [[first.threadId, 4000]],
  );
  // The finished page is all there, for "Show earlier conversation".
  assert.equal((await pages.page(owner, first.threadId))?.length, 4000);
  assert.equal(await pages.page(owner, "not-a-page"), undefined);
  // Opening again doesn't turn another page.
  assert.equal((await pages.open(owner)).threadId, turned.threadId);

  // The summary is written in the background, from at most the most recent part.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(merged.length, 1);
  assert.ok((merged[0]?.count ?? 0) < 4000);
  const earlier = await earlierPages(db, owner, turned.threadId);
  assert.match(earlier.summary ?? "", /Summary through/);
  assert.equal(earlier.pages, 1);
  // Only the main chat gets the earlier pages.
  assert.deepEqual(await earlierPages(db, owner, "side-chat"), { summary: undefined, pages: 0 });
  // The agent's search reaches them, a page at a time.
  const hits = await searchEarlierPages(db, owner, (messages) =>
    messages
      .filter((m) => String(m.content).includes("Question 10 "))
      .map((m) => ({ from: "person", text: String(m.content) })),
  );
  assert.equal(hits.length, 1);

  // A second page carries the first one's summary forward.
  stored.set(turned.threadId, big(10));
  await pages.noteSize(owner, turned.threadId, PAGE_BYTES + 1);
  const third = await pages.open(owner);
  assert.equal(third.pages?.length, 2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(merged.at(-1)?.previous ?? "", /Summary through/);

  await pages.clear(owner, third.pages);
  assert.equal(await pages.page(owner, first.threadId), undefined);
});
