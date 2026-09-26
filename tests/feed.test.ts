import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { type FeedItem, FeedService } from "../apps/server/src/feed.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close();
});

test("the Feed searches each followed topic once each morning", async () => {
  const searched: string[] = [];
  let now = Date.parse("2026-09-27T09:00:00Z"); // 4 am in Chicago
  const feed = new FeedService(
    db,
    {
      search: async (query) => {
        searched.push(query);
        return {
          answer: `News for ${query.slice(15, 30)}`,
          sources: [{ title: "Source", url: "https://news.example/a" }],
        };
      },
    },
    async () => "America/Chicago",
    () => now,
  );
  const owner = "reader";
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20));
  await feed.setTopics(owner, { topics: ["Houston Astros", "AI agents", "AI agents"] });
  await settled();
  // Adding topics fetches them right away, once each.
  assert.equal(searched.length, 2);
  let state = await feed.get(owner);
  assert.deepEqual(state.topics, ["Houston Astros", "AI agents"]);
  assert.equal(state.items.length, 2);
  assert.deepEqual(state.items[0]?.sources, [{ title: "Source", url: "https://news.example/a" }]);

  // Before 6 am local time the morning refresh waits.
  await feed.refreshDue();
  assert.equal(searched.length, 2);
  now = Date.parse("2026-09-27T12:30:00Z"); // 7:30 am
  await feed.refreshDue();
  assert.equal(searched.length, 4);
  // Same day, same topic: the item is replaced, not duplicated.
  state = await feed.get(owner);
  assert.equal(state.items.length, 2);
  await feed.refreshDue();
  assert.equal(searched.length, 4);

  await assert.rejects(feed.refreshNow(owner), /a few minutes ago/);
  now += 11 * 60 * 1000;
  await feed.refreshNow(owner);
  await settled();
  assert.equal(searched.length, 6);

  // A week later old items are cleared out.
  now = Date.parse("2026-10-05T13:00:00Z");
  await feed.refreshDue();
  const items = await db.list<FeedItem>(owner, "feed-items");
  assert.ok(items.every((item) => item.day === "2026-10-05"));
  await assert.rejects(
    new FeedService(db, undefined, async () => "UTC").refreshNow(owner),
    /web search/,
  );
});
