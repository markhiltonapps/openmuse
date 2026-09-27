import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import { nominatim, richCardToolSpecs } from "../apps/server/src/rich-cards.ts";

type Tool = { execute: (a: unknown) => Promise<Record<string, unknown>> };

test("places are found on the map by the server, not written by the agent", async () => {
  const asked: string[] = [];
  const [places] = richCardToolSpecs(async (query) => {
    asked.push(query);
    if (query.startsWith("1100 S Lamar")) return { lat: 30.25, lng: -97.76 };
    if (query === "Veracruz All Natural, Austin, TX") return { lat: 30.26, lng: -97.72 };
    return undefined;
  }) as unknown as Tool[];
  const shown = await places?.execute({
    title: "Tacos in Austin",
    near: "Austin, TX",
    places: [
      { name: "Tacodeli", address: "1100 S Lamar Blvd", note: "Breakfast tacos" },
      { name: "Veracruz All Natural" },
      { name: "Nowhere Tacos", address: "1 Imaginary St" },
    ],
  });
  assert.deepEqual(shown?.places, [
    {
      name: "Tacodeli",
      address: "1100 S Lamar Blvd",
      note: "Breakfast tacos",
      lat: 30.25,
      lng: -97.76,
    },
    { name: "Veracruz All Natural", lat: 30.26, lng: -97.72 },
  ]);
  assert.deepEqual(shown?.notFound, ["Nowhere Tacos"]);
  // With an address that isn't found alone, the name is tried with it.
  assert.ok(asked.includes("Nowhere Tacos, 1 Imaginary St"));
});

test("product pictures come from the product pages", async () => {
  const [, products] = richCardToolSpecs(
    async () => undefined,
    async (page) => (page.includes("rei.com") ? "https://www.rei.com/media/tent.jpg" : undefined),
  ) as unknown as Tool[];
  const shown = await products?.execute({
    products: [
      { title: "Half Dome 2 tent", price: "$249.00", store: "REI", url: "https://www.rei.com/p/1" },
      { title: "Other tent", url: "https://shop.example.com/t" },
    ],
  });
  assert.deepEqual(shown?.products, [
    {
      title: "Half Dome 2 tent",
      price: "$249.00",
      store: "REI",
      url: "https://www.rei.com/p/1",
      image: "https://www.rei.com/media/tent.jpg",
    },
    { title: "Other tent", url: "https://shop.example.com/t" },
  ]);
});

test("the geocoder is asked politely and answers are remembered", async () => {
  const db = await createStore();
  let clock = 1_000_000;
  const calls: { url: string; agent: string | null }[] = [];
  const geocode = nominatim(
    db,
    "Neato_Muse/1.0 (+https://muse.test)",
    (async (url: string, init?: RequestInit) => {
      calls.push({ url, agent: new Headers(init?.headers).get("user-agent") });
      return new Response(
        JSON.stringify(url.includes("Tacodeli") ? [{ lat: "30.25", lon: "-97.76" }] : []),
        { headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
    () => (clock += 2000),
  );
  assert.deepEqual(await geocode("Tacodeli, Austin"), { lat: 30.25, lng: -97.76 });
  assert.deepEqual(await geocode("  tacodeli,   AUSTIN "), { lat: 30.25, lng: -97.76 });
  assert.equal(await geocode("Nowhere"), undefined);
  assert.equal(await geocode("Nowhere"), undefined);
  assert.equal(calls.length, 2, "repeat questions come from the cache");
  assert.match(
    calls[0]?.url ?? "",
    /nominatim\.openstreetmap\.org\/search\?format=jsonv2&limit=1&q=Tacodeli/,
  );
  assert.equal(calls[0]?.agent, "Neato_Muse/1.0 (+https://muse.test)");
});
