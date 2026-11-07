import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { Whereabouts, whereaboutsToolSpecs } from "../apps/server/src/whereabouts.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close?.();
});

test("location is kept only when it's on, only the latest spot, and forgotten after an hour", async () => {
  let now = Date.parse("2026-10-08T15:00:00Z");
  const lookups: number[] = [];
  const where = new Whereabouts(
    db,
    async (lat) => {
      lookups.push(lat);
      return "Main Street, Midtown, Houston";
    },
    () => now,
  );
  const owner = "where-1";
  // Off to start with: nothing is kept.
  assert.deepEqual(await where.report(owner, { lat: 29.75, lng: -95.36 }), { kept: false });
  assert.equal(await where.current(owner), undefined);
  await where.setEnabled(owner, true);
  await where.report(owner, { lat: 29.75, lng: -95.36, accuracy: 30 });
  const here = await where.current(owner);
  assert.equal(here?.place, "Main Street, Midtown, Houston");
  assert.equal(here?.minutesAgo, 0);
  // A step down the street keeps the name without another lookup.
  await where.report(owner, { lat: 29.7502, lng: -95.3601 });
  await where.current(owner);
  assert.equal(lookups.length, 1);
  // An hour later it's forgotten.
  now += 61 * 60_000;
  assert.equal(await where.current(owner), undefined);
  // Turning it off forgets at once.
  await where.report(owner, { lat: 29.75, lng: -95.36 });
  await where.setEnabled(owner, false);
  assert.equal(await where.current(owner), undefined);
});

test("“where am I” says when it's off or unknown, and can be turned on by voice", async () => {
  const where = new Whereabouts(db, undefined);
  const tools = whereaboutsToolSpecs(where, "where-2");
  const whereAmI = tools.find((t) => t.name === "where_am_i");
  const setSharing = tools.find((t) => t.name === "set_location_sharing");
  assert.ok(whereAmI && setSharing);
  assert.equal(((await whereAmI.execute({} as never)) as { off?: boolean }).off, true);
  await (setSharing.execute as (a: { on: boolean }) => Promise<unknown>)({ on: true });
  assert.equal(((await whereAmI.execute({} as never)) as { unknown?: boolean }).unknown, true);
});

test("a parked car is saved from where they are, found again with how far, and cleared only when it's theirs", async () => {
  let now = Date.parse("2026-11-07T15:00:00Z");
  const where = new Whereabouts(
    db,
    async () => "Main Street, Midtown, Houston",
    () => now,
  );
  const owner = "car-1";
  const park = whereaboutsToolSpecs(where, owner).find((t) => t.name === "park_car");
  assert.ok(park);
  const run = (args: { do: "save" | "find" | "clear"; note?: string }) =>
    (park.execute as (a: typeof args) => Promise<Record<string, unknown>>)(args);

  // With sharing off or no recent spot, nothing is saved and it says why.
  assert.equal((await run({ do: "save" })).off, true);
  await where.setEnabled(owner, true);
  assert.equal((await run({ do: "save" })).unknown, true);
  assert.equal((await run({ do: "find" })).none, true);

  // Saved from where they are, with their note; the card has the spot and when.
  await where.report(owner, { lat: 29.75, lng: -95.36, accuracy: 20 });
  const saved = (await run({ do: "save", note: "Level 3 by the elevator" })) as {
    parked: { place: string; note: string; at: number; accuracyMeters: number };
    shown: string;
  };
  assert.equal(saved.parked.place, "Main Street, Midtown, Houston");
  assert.equal(saved.parked.note, "Level 3 by the elevator");
  assert.equal(saved.parked.accuracyMeters, 20);
  assert.match(saved.shown, /Directions/);

  // Found later, a few streets away: how long ago and how far on foot.
  now += 2 * 60 * 60_000;
  await where.report(owner, { lat: 29.754, lng: -95.36 });
  const found = (await run({ do: "find" })) as { parkedAgo: string; fromThem: string };
  assert.equal(found.parkedAgo, "2 hours ago");
  assert.match(found.fromThem, /^about 1[0-9]{3} ft|^about 0\.[0-9] mi/);
  assert.match(found.fromThem, /minutes on foot/);

  // A card from the first parking can't clear a newer one.
  const first = saved.parked.at;
  await where.report(owner, { lat: 29.76, lng: -95.37 });
  const second = (await run({ do: "save" })) as { parked: { at: number } };
  assert.notEqual(second.parked.at, first);
  assert.equal(await where.clearParked(owner, first), "replaced");
  assert.ok(await where.parkedCar(owner));
  assert.equal(await where.clearParked(owner, second.parked.at), "cleared");
  assert.equal(await where.clearParked(owner, second.parked.at), "none");

  // Saved for good, but only for a week.
  await run({ do: "save" });
  now += 6 * 24 * 60 * 60_000;
  assert.ok(await where.parkedCar(owner));
  now += 2 * 24 * 60 * 60_000;
  assert.equal(await where.parkedCar(owner), undefined);
  // Clearing by voice says when there's nothing.
  assert.equal((await run({ do: "clear" })).none, true);
});

test("distances and times are said in plain words", async () => {
  const { agoWords, directionsLink, mapLink, metersBetween, walkingWords } = await import(
    "../apps/server/src/whereabouts.ts"
  );
  assert.ok(Math.abs(metersBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111_195) < 200);
  assert.equal(walkingWords(90), "about 300 ft, a minute's walk");
  assert.equal(walkingWords(800), "about 0.5 mi, about 10 minutes on foot");
  assert.equal(agoWords(30_000), "just now");
  assert.equal(agoWords(35 * 60_000), "35 minutes ago");
  assert.equal(agoWords(3 * 24 * 3_600_000), "3 days ago");
  assert.equal(
    mapLink({ lat: 29.75, lng: -95.36 }),
    "https://www.google.com/maps/search/?api=1&query=29.75,-95.36",
  );
  assert.match(directionsLink({ lat: 1, lng: 2 }), /travelmode=walking/);
});

test("an old location isn't taken as where the car is; parking again says so; Undo and the saved row work", async () => {
  let now = Date.parse("2026-11-07T15:00:00Z");
  const where = new Whereabouts(
    db,
    async () => "Elm Street, Houston",
    () => now,
  );
  const owner = "car-2";
  const park = whereaboutsToolSpecs(where, owner).find((t) => t.name === "park_car");
  assert.ok(park);
  const run = (args: { do: "save" | "find" | "clear"; note?: string }) =>
    (park.execute as (a: typeof args) => Promise<Record<string, unknown>>)(args);
  await where.setEnabled(owner, true);

  // The phone last reported ten minutes ago: that may be where they last stopped, so nothing is saved.
  await where.report(owner, { lat: 29.75, lng: -95.36 });
  now += 10 * 60_000;
  const stale = await run({ do: "save" });
  assert.equal(stale.stale, true);
  assert.match(String(stale.message), /10 minutes ago/);
  assert.equal(await where.parkedCar(owner), undefined);
  assert.equal((await where.view(owner)).parked, null);

  // A fresh report saves it, and the Account screen can show it.
  await where.report(owner, { lat: 29.75, lng: -95.36 });
  const first = (await run({ do: "save", note: "Row C" })) as { parked: { at: number } };
  const shown = (await where.view(owner)).parked;
  assert.equal(shown?.place, "Elm Street, Houston");
  assert.equal(shown?.note, "Row C");

  // Parking somewhere else says what it replaced.
  now += 60_000;
  await where.report(owner, { lat: 29.8, lng: -95.4 });
  const second = (await run({ do: "save" })) as { message: string; parked: { at: number } };
  assert.match(second.message, /replaced the spot they saved earlier at Elm Street/);

  // Undo puts a cleared spot back, but never over a newer one.
  const earlier = {
    lat: 29.75,
    lng: -95.36,
    place: "Elm Street, Houston",
    note: "Row C",
    at: first.parked.at,
  };
  assert.equal(await where.restoreParked(owner, earlier), false, "a newer spot is already saved");
  assert.equal(await where.clearParked(owner, second.parked.at), "cleared");
  assert.equal(await where.restoreParked(owner, earlier), true);
  assert.equal((await where.parkedCar(owner))?.note, "Row C");
  // Not for a spot older than a week.
  await where.clearParked(owner);
  assert.equal(
    await where.restoreParked(owner, { ...earlier, at: now - 8 * 24 * 60 * 60_000 }),
    false,
  );
});

test("“tell Dana I'm 15 minutes away” gets words with a map link, only from a fresh location", async () => {
  let now = Date.parse("2026-11-07T15:00:00Z");
  const where = new Whereabouts(
    db,
    async () => "Main Street, Midtown, Houston",
    () => now,
  );
  const owner = "share-1";
  const places: Record<string, { lat: number; lng: number } | undefined> = {
    "500 Main St": { lat: 29.78, lng: -95.37 },
  };
  const share = whereaboutsToolSpecs(where, owner, {
    geocode: async (query) => places[query],
  }).find((t) => t.name === "share_where_i_am");
  assert.ok(share);
  const run = (args: { minutesAway?: number; to?: string }) =>
    (share.execute as (a: typeof args) => Promise<Record<string, unknown>>)(args);

  // Nothing shared yet: it says so, and nothing is drafted.
  assert.equal((await run({})).off, true);
  await where.setEnabled(owner, true);
  assert.equal((await run({})).unknown, true);

  // What they said: their words, the street, and a link to the exact spot.
  await where.report(owner, { lat: 29.7547, lng: -95.3677 });
  const said = await run({ minutesAway: 15 });
  assert.equal(
    said.text,
    "I’m at Main Street, Midtown, Houston, about 15 minutes away. Here’s exactly where I am: https://www.google.com/maps/search/?api=1&query=29.7547,-95.3677",
  );
  assert.doesNotMatch(String(said.message), /rough estimate/);

  // Where they're headed: a rough time from the distance, and said to be a rough one.
  const worked = await run({ to: "500 Main St" });
  assert.match(String(worked.text), /about \d+ minutes away\./);
  assert.match(String(worked.message), /rough estimate/);
  // A place that can't be found: no time is made up.
  const lost = await run({ to: "Nowhere Land" });
  assert.doesNotMatch(String(lost.text), /minutes away/);
  assert.match(String(lost.message), /Couldn’t work out the time/);
  // No time at all: just where they are.
  assert.match(String((await run({})).text), /^I’m at Main Street, Midtown, Houston\. Here’s/);

  // An old spot isn't sent to someone else as if it were now.
  now += 8 * 60_000;
  const stale = await run({ minutesAway: 10 });
  assert.equal(stale.stale, true);
  assert.equal(stale.text, undefined);
});
