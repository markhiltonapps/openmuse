import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Directions,
  directionsToolSpecs,
  mapsLink,
  placeLandmarks,
  type RawStep,
  tidySteps,
} from "../apps/server/src/directions.ts";

// The real walking route from Paragon to Hilton Singapore Orchard (OSRM foot, fetched 2026-11-24):
// 246 m, mostly unnamed footpaths across Orchard Road.
const PARAGON = { lat: 1.3037371, lng: 103.8355203 };
const HILTON = { lat: 1.3019079, lng: 103.8359161 };
const ROUTE = {
  code: "Ok",
  routes: [
    {
      distance: 246.3,
      duration: 197,
      legs: [
        {
          steps: [
            ["depart", "left", "Orchard Promenade", 114, [103.8354, 1.303394]],
            ["turn", "right", "", 6, [103.836001, 1.302972]],
            ["turn", "left", "", 9, [103.835979, 1.302922]],
            ["turn", "right", "", 28, [103.836046, 1.302883]],
            ["turn", "left", "", 12, [103.835932, 1.302653]],
            ["turn", "right", "", 78, [103.836026, 1.302605]],
            ["arrive", "left", "", 0, [103.835699, 1.301996]],
          ].map(([type, modifier, name, distance, location]) => ({
            name,
            distance,
            maneuver: { type, modifier, location },
          })),
        },
      ],
    },
  ],
};
const raw = (): RawStep[] =>
  ROUTE.routes[0]?.legs[0]?.steps.map((s) => ({
    type: s.maneuver.type as string,
    modifier: s.maneuver.modifier as string,
    name: s.name as string,
    meters: s.distance as number,
    at: {
      lat: (s.maneuver.location as number[])[1] as number,
      lng: (s.maneuver.location as number[])[0] as number,
    },
  })) ?? [];

test("the router's noise becomes steps a person can follow, and a crossing stays a step of its own", () => {
  const steps = tidySteps(raw());
  assert.deepEqual(
    steps.map((s) => s.text),
    [
      "Start on Orchard Promenade for about 110 m",
      "Follow the walkway or crossing for about 55 m",
      "Turn right for about 80 m",
      "Arrive (it's on your left)",
    ],
  );
});

test("landmarks go to the step they're next to, the big ones first", () => {
  const steps = placeLandmarks(tidySteps(raw()), [
    { name: "Paragon", kind: "mall", lat: 1.30374, lng: 103.83552 },
    { name: "Pandora", kind: "shop", lat: 1.30339, lng: 103.83541 },
    { name: "Ngee Ann City", kind: "mall", lat: 1.30285, lng: 103.83475 },
    { name: "Hilton Singapore Orchard", kind: "hotel", lat: 1.30191, lng: 103.83592 },
    { name: "Far away tower", kind: "building", lat: 1.31, lng: 103.84 },
  ]);
  assert.equal(steps[0]?.landmarks[0], "Paragon", "the mall they're leaving comes first");
  assert.ok(steps[0]?.landmarks.includes("Pandora"));
  assert.ok(steps.some((s) => s.landmarks.includes("Ngee Ann City")));
  assert.ok(
    steps.every((s) => !s.landmarks.includes("Far away tower")),
    "too far from the route",
  );
  assert.ok(steps.at(-1)?.landmarks.includes("Hilton Singapore Orchard"));
});

test("the Maps link navigates live from here to the named place", () => {
  const link = mapsLink(
    PARAGON,
    { ...HILTON, name: "Hilton Singapore Orchard", address: "333 Orchard Road, Singapore" },
    "walk",
  );
  assert.match(
    link,
    /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=1\.303737,103\.835520/,
  );
  assert.match(link, /destination=Hilton%20Singapore%20Orchard%2C%20333%20Orchard%20Road/);
  assert.match(link, /travelmode=walking$/);
});

/** A pretend internet: Nominatim, the router and Overpass, answering what the real ones did. */
function fakeMaps(options: { overpassDown?: boolean; places?: Record<string, unknown[]> } = {}) {
  const asked: string[] = [];
  const places: Record<string, unknown[]> = options.places ?? {
    hilton: [
      {
        lat: String(HILTON.lat),
        lon: String(HILTON.lng),
        name: "Hilton Singapore Orchard",
        address: { house_number: "333", road: "Orchard Road", city: "Singapore" },
      },
    ],
    paragon: [
      {
        lat: String(PARAGON.lat),
        lon: String(PARAGON.lng),
        name: "Paragon",
        address: { house_number: "290", road: "Orchard Road", city: "Singapore" },
      },
    ],
  };
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.includes("nominatim")) {
      const q = decodeURIComponent(new URL(url).searchParams.get("q") ?? "").toLowerCase();
      const key = Object.keys(places).find((k) => q.includes(k));
      return json(key ? places[key] : []);
    }
    if (url.includes("routing.openstreetmap.de")) return json(ROUTE);
    if (url.includes("overpass")) {
      if (options.overpassDown) return new Response("busy", { status: 504 });
      assert.match(String(init?.body), /around/);
      // The road at the crossing.
      if (/highway/.test(decodeURIComponent(String(init?.body))))
        return json({
          elements: [{ type: "way", tags: { name: "Orchard Road", highway: "primary" } }],
        });
      return json({
        elements: [
          {
            type: "way",
            center: { lat: 1.30374, lon: 103.83552 },
            tags: { name: "Paragon", shop: "mall" },
          },
          {
            type: "way",
            center: { lat: 1.30285, lon: 103.83475 },
            tags: { name: "Ngee Ann City", shop: "mall" },
          },
          {
            type: "node",
            lat: 1.30191,
            lon: 103.83592,
            tags: { name: "Hilton Singapore Orchard", tourism: "hotel" },
          },
        ],
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetcher, asked };
}

test("from where they are, the strong model writes the steps from the map's facts, with the Maps link", async () => {
  const maps = fakeMaps();
  const prompts: string[] = [];
  const directions = new Directions({
    userAgent: "test",
    fetcher: maps.fetcher,
    write: async (_owner, prompt) => {
      prompts.push(prompt);
      return "About 250 m, 3 minutes on foot.\n1. Leave Paragon by the Orchard Road doors.\n2. Cross at the junction toward Ngee Ann City.\n3. The Hilton is on your left.";
    },
  });
  const result = (await directions.directions(
    "o",
    { to: "Hilton Orchard", here: "Uni-Glow, between Pandora and Estée Lauder", mode: "walk" },
    { ...PARAGON, place: "Paragon, Orchard Road" },
  )) as unknown as Record<string, string | number>;
  assert.match(String(result.directions), /^About 250 m/);
  assert.equal(result.distance, "250 m");
  assert.equal(result.minutes, 3);
  assert.match(String(result.mapsLink), /travelmode=walking/);
  assert.match(String(result.limits), /no floor plans/);
  // The writer saw the facts: where they say they are, each step and its landmarks, the address.
  const facts = JSON.parse(prompts[0]?.split("\n").slice(1).join("\n") ?? "{}");
  assert.equal(facts.whereTheySayTheyAre, "Uni-Glow, between Pandora and Estée Lauder");
  assert.equal(facts.to.address, "333 Orchard Road, Singapore");
  assert.ok(facts.steps[0].landmarks.includes("Paragon"));
  assert.equal(facts.steps.length, 4);
  // The destination was looked for near where they are.
  assert.ok(maps.asked.some((u) => u.includes("nominatim") && u.includes("viewbox=")));
  assert.equal(facts.steps[1].do, "Cross Orchard Road by the walkway or crossing (about 55 m)");
});

test("without the phone's location, the building they name is the start", async () => {
  const maps = fakeMaps();
  const directions = new Directions({ userAgent: "test", fetcher: maps.fetcher });
  const result = (await directions.directions("o", {
    to: "Hilton Orchard",
    here: "Paragon, Singapore",
    mode: "walk",
  })) as unknown as Record<string, string>;
  assert.match(result.directions ?? "", /1\. Start on Orchard Promenade/);
  assert.match(result.directions ?? "", /you'll see Paragon/);
  assert.match(result.mapsLink ?? "", /origin=1\.303737,103\.835520/);
});

test("when the map service is busy the steps still come, just without landmarks; a bad write falls back", async () => {
  const maps = fakeMaps({ overpassDown: true });
  const directions = new Directions({
    userAgent: "test",
    fetcher: maps.fetcher,
    write: async () => "Sorry, I can't help with that.",
  });
  const result = (await directions.directions(
    "o",
    { to: "Hilton", mode: "walk" },
    PARAGON,
  )) as unknown as Record<string, string>;
  assert.match(
    result.directions ?? "",
    /^About 250 m, 3 min on foot\.\n1\. Start on Orchard Promenade/,
  );
  assert.doesNotMatch(result.directions ?? "", /you'll see/);
});

test("it says what it can't do: no start, place not found, too far to walk", async () => {
  const maps = fakeMaps();
  const directions = new Directions({ userAgent: "test", fetcher: maps.fetcher });
  const noStart = await directions.directions("o", { to: "Hilton", mode: "walk" });
  assert.ok("needStart" in noStart);
  const missing = await directions.directions("o", { to: "Atlantis Tower", mode: "walk" }, PARAGON);
  assert.ok("notFound" in missing);
  const far = (await directions.directions(
    "o",
    { to: "Hilton", mode: "walk" },
    { lat: 1.36, lng: 103.99 },
  )) as unknown as Record<string, string>;
  assert.match(far.tooFar ?? "", /too far to walk/);
  assert.match(far.mapsLink ?? "", /travelmode=transit/);
});

test("the tool uses the phone's spot, and a failing service still gives a Maps link", async () => {
  const maps = fakeMaps();
  const where = {
    current: async () => ({ ...PARAGON, place: "Paragon", minutesAgo: 1 }),
    enabled: async () => true,
  };
  const [tool] = directionsToolSpecs(
    new Directions({ userAgent: "test", fetcher: maps.fetcher }),
    where,
    "o",
  ) as unknown as { execute: (a: unknown) => Promise<Record<string, string>> }[];
  const answer = await tool?.execute({ to: "Hilton Orchard" });
  assert.match(answer?.directions ?? "", /Orchard Promenade/);
  const broken = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const [down] = directionsToolSpecs(
    new Directions({ userAgent: "test", fetcher: broken }),
    where,
    "o",
  ) as unknown as { execute: (a: unknown) => Promise<Record<string, string>> }[];
  const failed = await down?.execute({ to: "Hilton Orchard" });
  assert.match(failed?.unavailable ?? "", /didn't answer/);
  assert.match(failed?.mapsLink ?? "", /destination=Hilton%20Orchard/);
});
