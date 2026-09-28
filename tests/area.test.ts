import assert from "node:assert/strict";
import { test } from "node:test";
import { Areas, nominatimPlaces, placeFrom, searchPlace } from "../apps/server/src/area.ts";
import { createStore } from "../apps/server/src/db.ts";
import { FeedService } from "../apps/server/src/feed.ts";
import { AnthropicWebSearch, type WebSearch } from "../apps/server/src/web-search.ts";

const HOUSTON = {
  city: "Houston",
  county: "Harris County",
  state: "Texas",
  country: "United States",
  country_code: "us",
};

test("a place reads like a person would say it, from an OpenStreetMap address", () => {
  assert.deepEqual(placeFrom(HOUSTON), {
    label: "Houston, Texas",
    city: "Houston",
    region: "Texas",
    country: "US",
  });
  assert.equal(
    placeFrom({ town: "Katy", state: "Texas", country_code: "us" })?.label,
    "Katy, Texas",
  );
  assert.equal(
    placeFrom({ city: "Lyon", country: "France", country_code: "fr" })?.label,
    "Lyon, France",
  );
  assert.equal(placeFrom({}), undefined);
});

test("the area comes from a typed city or a rounded location, and only the city is kept", async () => {
  const urls: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return String(url).includes("/reverse")
      ? Response.json({ address: HOUSTON })
      : String(url).includes("nowhere")
        ? Response.json([])
        : Response.json([{ address: { ...HOUSTON, city: "Pearland" } }]);
  }) as typeof fetch;
  let clock = 0;
  const find = nominatimPlaces("test", fetcher, () => (clock += 2000));
  const db = await createStore();
  const areas = new Areas(db, find, () => Date.parse("2026-09-28T12:00:00Z"));
  const typed = await areas.set("me", { place: "Pearland TX" });
  assert.equal(typed.label, "Pearland, Texas");
  assert.match(urls[0] ?? "", /search\?.*q=Pearland%20TX/);
  const located = await areas.set("me", { lat: 29.76043, lng: -95.3698 });
  assert.equal(located.label, "Houston, Texas");
  assert.match(
    urls[1] ?? "",
    /lat=29\.76&lon=-95\.37/,
    "only about a kilometer of precision leaves",
  );
  const saved = await areas.get("me");
  assert.equal(saved?.label, "Houston, Texas");
  assert.equal("lat" in (saved ?? {}), false, "no coordinates are stored");
  await assert.rejects(areas.set("me", { place: "nowhere at all" }), /couldn’t find/);
  assert.equal(await areas.get("someone-else"), undefined);
  await areas.clear("me");
  assert.equal(await areas.get("me"), undefined);
  // Without a lookup (sample mode), a typed place is kept as typed.
  const plain = new Areas(db);
  assert.equal((await plain.set("me", { place: "Houston, TX" })).label, "Houston, TX");
  await assert.rejects(plain.set("me", { lat: 1, lng: 2 }), /Type it instead/);
  await db.close();
});

test("searches are told where local is; a place the provider won't take doesn't stop them", async () => {
  const bodies: Record<string, unknown>[] = [];
  let reject = false;
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    const tool = (body.tools as { user_location?: unknown }[])[0];
    if (reject && tool?.user_location)
      return Response.json(
        { error: { message: "user_location.country: not a country the search provider supports" } },
        { status: 400 },
      );
    return Response.json({ content: [{ type: "text", text: '{"stories":[]}' }] });
  }) as typeof fetch;
  const search = new AnthropicWebSearch("k", { fetcher });
  const where = searchPlace(
    {
      id: "area",
      label: "Houston, Texas",
      city: "Houston",
      region: "Texas",
      country: "US",
      setAt: "",
    },
    "America/Chicago",
  );
  await search.stories("Local news", undefined, undefined, where);
  const toolOf = (i: number) => ((bodies[i]?.tools ?? []) as { user_location?: unknown }[])[0];
  const tool = toolOf(0);
  assert.deepEqual(tool?.user_location, {
    type: "approximate",
    city: "Houston",
    region: "Texas",
    country: "US",
    timezone: "America/Chicago",
  });
  const prompt = JSON.stringify(bodies[0]?.messages);
  assert.match(prompt, /lives in Houston, Texas/);
  reject = true;
  const found = await search.search("weather this weekend", undefined, "web", where);
  assert.equal(found.answer, '{"stories":[]}');
  assert.equal(bodies.length, 3, "tried once with the place, then without");
  assert.equal(toolOf(2)?.user_location, undefined);
  // Nothing saved and a UTC clock: nothing to say about where.
  assert.equal(searchPlace(undefined, "UTC"), undefined);
  assert.deepEqual(searchPlace(undefined, "America/Chicago"), { timezone: "America/Chicago" });
});

test("the Feed looks up each topic for the person's area and says which area it is", async () => {
  const db = await createStore();
  const asked: unknown[] = [];
  const search: WebSearch = {
    search: async () => ({ answer: "No results found.", sources: [] }),
    stories: async (_topic, _usage, _taste, where) => {
      asked.push(where);
      return { stories: [], sources: [] };
    },
  };
  const feed = new FeedService(db, search, async () => "America/Chicago");
  feed.where = async () => ({ label: "Houston, Texas", city: "Houston", country: "US" });
  await feed.setTopics("me", { topics: ["Local news"] });
  await feed.refresh("me");
  assert.deepEqual(asked.at(-1), { label: "Houston, Texas", city: "Houston", country: "US" });
  assert.equal((await feed.get("me")).area, "Houston, Texas");
  await db.close();
});
