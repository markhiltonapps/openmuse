import assert from "node:assert/strict";
import { test } from "node:test";
import { Nearby, nearbyQuery, nearbyToolSpecs, safeName } from "../apps/server/src/nearby.ts";
import { driveMinutes } from "../packages/domain/src/location.ts";

const SPOT = { lat: 29.7547, lng: -95.3677 };
/** A pharmacy this many degrees of latitude north of the spot (0.001° is about 111 m). */
const at = (north: number, tags: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  type: "node",
  lat: SPOT.lat + north,
  lon: SPOT.lng,
  tags,
  ...extra,
});

function service(answers: (query: string, url: string) => Response) {
  const calls: { url: string; query: string }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const query = decodeURIComponent(String(init?.body).replace(/^data=/, ""));
    calls.push({ url, query });
    return answers(query, url);
  }) as unknown as typeof fetch;
  let now = 1_800_000_000_000;
  const nearby = new Nearby({ userAgent: "test", fetcher, now: () => now });
  return { nearby, calls, later: (ms: number) => (now += ms) };
}

test("a name can't change the query, and the query asks for what was meant", () => {
  assert.equal(safeName('Star"bucks"]; out;'), "Star bucks out");
  assert.equal(safeName("  O’Reilly & Sons  "), "O Reilly & Sons");
  const q = nearbyQuery(SPOT, 1500, "grocery");
  assert.match(q, /nwr\["shop"="supermarket"\]\(around:1500,29\.75470,-95\.36770\);/);
  assert.match(q, /nwr\["shop"="convenience"\]/);
  assert.match(
    nearbyQuery(SPOT, 1500, "pharmacy", 'CVS"'),
    /\["amenity"="pharmacy"\]\["name"~"CVS",i\]/,
  );
  // A name with no kind looks for anything with that name.
  assert.match(
    nearbyQuery(SPOT, 1500, undefined, "Starbucks"),
    /nwr\["name"~"Starbucks",i\]\(around/,
  );
});

test("places come back closest first, with address, walking time, hours and a website", async () => {
  const { nearby } = service(() =>
    Response.json({
      elements: [
        at(0.004, { name: "Far Pharmacy", opening_hours: "Mo-Su 08:00-22:00" }),
        at(0.001, {
          name: "Near Pharmacy",
          "addr:housenumber": "500",
          "addr:street": "Main Street",
          "addr:city": "Houston",
          opening_hours: "Mo-Fr 09:00-18:00",
          website: "https://near.example.com",
        }),
        // Mapped twice (a building and its point): one place.
        at(0.001, { name: "Near Pharmacy" }, { type: "way" }),
        // Odd links and ways with only a centre are handled.
        {
          type: "way",
          center: { lat: SPOT.lat + 0.002, lon: SPOT.lng },
          tags: { name: "Middle Pharmacy", website: "javascript:alert(1)" },
        },
        { type: "node", tags: { name: "No position" } },
      ],
    }),
  );
  const found = await nearby.find(SPOT, { what: "pharmacy" });
  assert.ok(found);
  assert.equal(found.title, "Pharmacies near you");
  assert.deepEqual(
    found.places.map((p) => p.name),
    ["Near Pharmacy", "Middle Pharmacy", "Far Pharmacy"],
  );
  const [first, middle] = found.places;
  assert.equal(first?.address, "500 Main Street, Houston");
  assert.equal(first?.url, "https://near.example.com");
  assert.match(String(first?.note), /^about 350 ft, about 1 minutes? on foot|a minute's walk/);
  assert.match(String(first?.note), /Hours on the map: Mo-Fr 09:00-18:00/);
  assert.equal(middle?.url, undefined, "only web links are kept");
});

test("it looks wider when little is close, remembers answers for ten minutes, and falls back to a second server", async () => {
  let call = 0;
  const { nearby, calls, later } = service((query) => {
    call++;
    // The close look finds one; the wide look finds three.
    return Response.json({
      elements: query.includes("around:1500")
        ? [at(0.002, { name: "One" })]
        : [at(0.002, { name: "One" }), at(0.02, { name: "Two" }), at(0.03, { name: "Three" })],
    });
  });
  const found = await nearby.find(SPOT, { what: "gas" });
  assert.equal(found?.places.length, 3);
  assert.equal(found?.radiusMeters, 6000);
  assert.equal(call, 2);
  await nearby.find(SPOT, { what: "gas" });
  assert.equal(call, 2, "kept");
  later(11 * 60_000);
  await nearby.find(SPOT, { what: "gas" });
  assert.equal(call, 4, "asked again after ten minutes");
  // Asked only that far when they name a distance.
  await nearby.find(SPOT, { what: "gas", miles: 0.5 });
  assert.match(calls.at(-1)?.query ?? "", /around:805/);

  // The first server is busy: the second answers.
  const urls: string[] = [];
  const busy = new Nearby({
    userAgent: "t",
    fetcher: (async (url: string) => {
      urls.push(url);
      return url.includes("overpass-api.de")
        ? new Response("busy", { status: 504 })
        : Response.json({ elements: [at(0.001, { name: "Backup" })] });
    }) as unknown as typeof fetch,
  });
  assert.equal((await busy.find(SPOT, { what: "atm" }))?.places[0]?.name, "Backup");
  // A close look and a wider one, each trying the busy server first.
  assert.equal(urls.length, 4);
});

test("private parking and customer-only toilets are left out, and nothing mapped is said as none", async () => {
  const { nearby } = service(() =>
    Response.json({
      elements: [
        at(0.001, { name: "Staff lot", access: "private" }),
        at(0.002, { name: "Public garage", access: "yes" }),
      ],
    }),
  );
  const lots = await nearby.find(SPOT, { what: "parking" });
  assert.deepEqual(
    lots?.places.map((p) => p.name),
    ["Public garage"],
  );
  const empty = service(() => Response.json({ elements: [] }));
  assert.equal(await empty.nearby.find(SPOT, { what: "pharmacy" }), null);
});

test("the tool says what to do when location is off, old or the map is down, and gives the card when found", async () => {
  const { nearby } = service(() => Response.json({ elements: [at(0.001, { name: "Near" })] }));
  let spot: { lat: number; lng: number; minutesAgo: number } | undefined;
  let sharing = true;
  const where = { current: async () => spot, enabled: async () => sharing };
  const [tool] = nearbyToolSpecs(nearby, where, "n1");
  assert.ok(tool);
  const run = (args: Record<string, unknown>) =>
    tool.execute(args as never) as Promise<Record<string, unknown>>;

  assert.match(String((await run({})).error), /what to look for/);
  assert.equal((await run({ what: "pharmacy" })).unknown, true);
  sharing = false;
  assert.equal((await run({ what: "pharmacy" })).off, true);

  sharing = true;
  spot = { ...SPOT, minutesAgo: 25 };
  const done = (await run({ what: "pharmacy" })) as {
    title: string;
    places: { name: string; meters?: number }[];
    shown: string;
    spotAge: string;
  };
  assert.equal(done.title, "Pharmacies near you");
  assert.equal(done.places[0]?.name, "Near");
  assert.equal(done.places[0]?.meters, undefined, "the card's data has no sort key");
  assert.match(done.shown, /map/);
  assert.match(done.spotAge, /25 minutes ago/);

  // Nothing mapped, and a map service that's down, each say so.
  const none = nearbyToolSpecs(
    service(() => Response.json({ elements: [] })).nearby,
    where,
    "n1",
  )[0];
  assert.equal(((await none?.execute({ what: "atm" } as never)) as { none: boolean }).none, true);
  const down = nearbyToolSpecs(
    new Nearby({
      userAgent: "t",
      fetcher: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch,
    }),
    where,
    "n1",
  )[0];
  assert.match(
    String(
      ((await down?.execute({ what: "atm" } as never)) as { unavailable: string }).unavailable,
    ),
    /didn't answer/,
  );
});

test("a rough drive time grows with the distance and is rounded", () => {
  assert.equal(driveMinutes(300), 1);
  assert.equal(driveMinutes(2_000), 4);
  assert.equal(driveMinutes(5_000), 10);
  assert.equal(driveMinutes(20_000), 30);
  assert.equal(driveMinutes(100_000), 95);
});
