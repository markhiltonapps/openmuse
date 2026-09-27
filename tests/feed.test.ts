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

test("the Feed tells the news as stories with headlines and pictures", async () => {
  const feed = new FeedService(
    db,
    {
      search: async () => ({ answer: "unused", sources: [] }),
      stories: async (topic) => ({
        stories: [
          {
            emoji: "🎬",
            headline: `${topic}: ads restored`,
            summary: "Meta called it an error and [restored the ads](https://news.example/ads).",
            url: "https://news.example/ads",
          },
          { emoji: "📰", headline: "A second story", summary: "Without a picture this time." },
        ],
        sources: [{ title: "News", url: "https://news.example/ads" }],
      }),
    },
    async () => "UTC",
  );
  feed.preview = async (url) => (url.endsWith("/ads") ? "https://img.example/ads.jpg" : undefined);
  await feed.setTopics("stories", { topics: ["Musk documentary"] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const [item] = (await feed.get("stories")).items;
  assert.equal(item?.stories?.length, 2);
  assert.deepEqual(item?.stories?.[0], {
    emoji: "🎬",
    headline: "Musk documentary: ads restored",
    summary: "Meta called it an error and [restored the ads](https://news.example/ads).",
    url: "https://news.example/ads",
    image: "https://img.example/ads.jpg",
  });
  assert.equal(item?.stories?.[1]?.image, undefined);
  assert.match(item?.summary ?? "", /\*\*A second story\*\*/);
});

test("story replies are read safely, and pictures come only from public pages", async () => {
  const { parseStories } = await import("../apps/server/src/web-search.ts");
  const { imageFromHtml, previewImage, publicAddress } = await import(
    "../apps/server/src/link-preview.ts"
  );
  assert.deepEqual(
    parseStories(
      'Here you go: {"stories":[{"emoji":"x","headline":"Rates fall","summary":"Mortgage rates fell to 6.1% [per Freddie](javascript:alert).","url":"http://insecure.example"},{"headline":"no"}]}',
    ),
    [{ emoji: "📰", headline: "Rates fall", summary: "Mortgage rates fell to 6.1% per Freddie." }],
  );
  assert.deepEqual(parseStories("not json"), []);
  assert.equal(
    imageFromHtml(
      `<head><meta name="twitter:image" content="https://cdn.example/t.jpg"><meta content='/img/og.jpg?a=1&amp;b=2' property='og:image'></head>`,
      "https://news.example/story",
    ),
    "https://news.example/img/og.jpg?a=1&b=2",
  );
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "::1",
    "fd12::1",
    "::ffff:192.168.1.1",
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("93.184.216.34"), true);
  const fetched: string[] = [];
  const html = `<html><head><meta property="og:image" content="https://cdn.example/a.jpg"></head>`;
  const fetcher = (async (url: string | URL) => {
    fetched.push(String(url));
    if (String(url).includes("moved"))
      return new Response(null, { status: 301, headers: { location: "http://internal.example/" } });
    return new Response(html, { headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  const resolve = async (host: string) => [
    { address: host === "internal.example" ? "10.0.0.5" : "93.184.216.34" },
  ];
  assert.equal(
    await previewImage("https://news.example/a", { fetcher, resolve }),
    "https://cdn.example/a.jpg",
  );
  // A redirect into a private network, a private address and a non-standard port are refused.
  assert.equal(await previewImage("https://news.example/moved", { fetcher, resolve }), undefined);
  assert.equal(await previewImage("http://127.0.0.1/", { fetcher, resolve }), undefined);
  assert.equal(await previewImage("https://news.example:8443/", { fetcher, resolve }), undefined);
  assert.deepEqual(fetched, ["https://news.example/a", "https://news.example/moved"]);
});

test("thumbs up and down steer later stories, and old text items are fetched again once", async () => {
  const tastes: unknown[] = [];
  let now = Date.parse("2026-09-28T14:00:00Z");
  const feed = new FeedService(
    db,
    {
      search: async () => ({
        answer:
          "I'll search for that. **Weather:** A storm is flooding the coast. Thousands lost power. Roads are closed. More rain is coming Monday.",
        sources: [{ title: "NPR", url: "https://npr.example/storm" }],
      }),
      stories: async (topic, _usage, taste) => {
        tastes.push(taste);
        return {
          stories: [
            { emoji: "🦄🦄", headline: `${topic} one`, summary: "First story here." },
            { emoji: "🌧️", headline: `${topic} two`, summary: "Second story here." },
          ],
          sources: [],
        };
      },
    },
    async () => "UTC",
    () => now,
  );
  feed.preview = async () => undefined;
  const owner = "taste";
  // An item saved the old way, before stories.
  await db.put(owner, "agent-settings", {
    id: "feed",
    topics: ["Weather"],
    refreshedOn: "2026-09-28",
  });
  await db.put(owner, "feed-items", {
    id: "old",
    topic: "Weather",
    summary: "A wall of text",
    sources: [],
    day: "2026-09-28",
    createdAt: new Date(now).toISOString(),
  });
  await feed.refreshDue();
  let state = await feed.get(owner);
  const fresh = state.items.find((item) => item.stories);
  assert.ok(fresh, "today's news was fetched again as stories");
  // An emoji without a 3D picture becomes the newspaper.
  assert.equal(fresh.stories?.[0]?.emoji, "📰");
  assert.equal(fresh.stories?.[1]?.emoji, "🌧️");
  // Once upgraded, it isn't fetched again the same day.
  const calls = tastes.length;
  await feed.refreshDue();
  assert.equal(tastes.length, calls);

  state = await feed.feedback(owner, { itemId: fresh.id, headline: "Weather one", feedback: "up" });
  await feed.feedback(owner, { itemId: fresh.id, headline: "Weather two", feedback: "down" });
  const saved = state.items.find((item) => item.id === fresh.id);
  assert.equal(saved?.stories?.[0]?.feedback, "up");
  now = Date.parse("2026-09-29T14:00:00Z");
  await feed.refreshDue();
  assert.deepEqual(tastes.at(-1), {
    liked: ["Weather one (Weather)"],
    disliked: ["Weather two (Weather)"],
  });
  // Taking a thumbs back removes it.
  await feed.feedback(owner, { itemId: fresh.id, headline: "Weather one", feedback: null });
  await assert.rejects(
    feed.feedback(owner, { itemId: fresh.id, headline: "Missing", feedback: "up" }),
    /Story not found/,
  );

  // A search that can't tell stories apart still gives a short story, not a wall of text.
  const plain = new FeedService(
    db,
    {
      search: async () => ({
        answer:
          "I'll search for that. **Weather:** A storm is flooding the coast. Thousands lost power. Roads are closed. More rain is coming Monday.",
        sources: [{ title: "NPR", url: "https://npr.example/storm" }],
      }),
      stories: async () => ({ stories: [], sources: [] }),
    },
    async () => "UTC",
    () => now,
  );
  await plain.setTopics("plain", { topics: ["Storms"] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const [item] = (await plain.get("plain")).items;
  assert.deepEqual(item?.stories, [
    {
      emoji: "📰",
      headline: "Storms",
      summary:
        "A storm is flooding the coast. Thousands lost power. Roads are closed. More rain is coming Monday.",
      url: "https://npr.example/storm",
    },
  ]);
});

test("emoji are drawn from the 3D set when there's a picture", async () => {
  const { emojiCode, emojiPicture, hasEmojiPicture } = await import("../apps/server/src/emoji.ts");
  assert.equal(emojiCode("📰"), "1f4f0");
  assert.equal(emojiCode("🌧️"), "1f327");
  assert.equal(hasEmojiPicture("⚾"), true);
  assert.equal(hasEmojiPicture("🦄🦄"), false);
  const picture = await emojiPicture("1f4f0");
  assert.ok(picture && picture.length > 500);
  assert.equal(await emojiPicture("../../etc/passwd"), undefined);
});
