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
  const [whereAmI, setSharing] = whereaboutsToolSpecs(where, "where-2");
  assert.ok(whereAmI && setSharing);
  assert.equal(((await whereAmI.execute({} as never)) as { off?: boolean }).off, true);
  await (setSharing.execute as (a: { on: boolean }) => Promise<unknown>)({ on: true });
  assert.equal(((await whereAmI.execute({} as never)) as { unknown?: boolean }).unknown, true);
});
