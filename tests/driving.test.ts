import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { DayEvent } from "../apps/server/src/calendar-today.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { headsUpsFor } from "../apps/server/src/heads-up-rules.ts";
import { PlaceReminders } from "../apps/server/src/place-reminders.ts";
import { Whereabouts, whereaboutsToolSpecs } from "../apps/server/src/whereabouts.ts";
import {
  localDate,
  localDayStart,
  milesWords,
  periodStart,
} from "../packages/domain/src/location.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close?.();
});

const tool = (where: Whereabouts, owner: string, name: string) => {
  const spec = whereaboutsToolSpecs(where, owner, { timeZone: async () => "America/Chicago" }).find(
    (t) => t.name === name,
  );
  return (spec as NonNullable<typeof spec>).execute as (
    args: unknown,
  ) => Promise<Record<string, unknown>>;
};

test("driving: the phone's own speed, held through a red light, believed over a passenger's word", async () => {
  let now = Date.parse("2026-11-08T15:00:00Z");
  const where = new Whereabouts(db, undefined, () => now);
  const owner = "drive-1";
  await where.setEnabled(owner, true);
  await where.report(owner, { lat: 29.75, lng: -95.36, accuracy: 10, speed: 2 });
  assert.equal(await where.driving(owner), false, "walking pace is not driving");
  now += 10_000;
  await where.report(owner, { lat: 29.751, lng: -95.36, accuracy: 10, speed: 15 });
  assert.equal(await where.driving(owner), false, "one fast fix isn't a drive (a bus, a bike)");
  now += 10_000;
  await where.report(owner, { lat: 29.7512, lng: -95.36, accuracy: 10, speed: 15 });
  assert.equal(await where.driving(owner), true);
  // Stopped at a light for two minutes: still on a drive.
  now += 2 * 60_000;
  await where.report(owner, { lat: 29.751, lng: -95.36, accuracy: 10, speed: 0 });
  assert.equal(await where.driving(owner), true);
  // Parked for good: after the hold it's over.
  now += 5 * 60_000;
  assert.equal(await where.driving(owner), false);
  // A passenger says so.
  now += 1000;
  await where.report(owner, { lat: 29.76, lng: -95.36, accuracy: 10, speed: 20 });
  now += 10_000;
  await where.report(owner, { lat: 29.7601, lng: -95.36, accuracy: 10, speed: 20 });
  assert.equal(await where.driving(owner), true);
  where.notDriving(owner);
  assert.equal(await where.driving(owner), false);
  // …but only for half an hour.
  now += 31 * 60_000;
  await where.report(owner, { lat: 29.77, lng: -95.36, accuracy: 10, speed: 20 });
  now += 10_000;
  await where.report(owner, { lat: 29.7701, lng: -95.36, accuracy: 10, speed: 20 });
  assert.equal(await where.driving(owner), true);
  // Turned off for good.
  await where.setDriving(owner, false);
  assert.equal(await where.driving(owner), false);
  assert.equal((await where.view(owner)).drivingMode, false);
  // Turning location sharing off and on again keeps that choice.
  await where.setEnabled(owner, false);
  await where.setEnabled(owner, true);
  assert.equal(await where.drivingMode(owner), false);
});

test("driving: speed worked out from two reports, and a poor fix can't claim it", async () => {
  let now = Date.parse("2026-11-08T15:00:00Z");
  const where = new Whereabouts(db, undefined, () => now);
  const owner = "drive-2";
  await where.setEnabled(owner, true);
  await where.report(owner, { lat: 29.75, lng: -95.36, accuracy: 20, speed: null });
  now += 30_000;
  // About 0.0045° of latitude (500 m) in 30 s is 16 m/s.
  await where.report(owner, { lat: 29.7545, lng: -95.36, accuracy: 20 });
  now += 30_000;
  await where.report(owner, { lat: 29.759, lng: -95.36, accuracy: 20 });
  assert.equal(await where.driving(owner), true);
  const here = await where.current(owner);
  assert.ok((here?.speedMetersPerSecond ?? 0) > 14);
  // A jump with a terrible fix (a cell tower guess) is not driving.
  const other = "drive-3";
  await where.setEnabled(other, true);
  await where.report(other, { lat: 29.75, lng: -95.36, accuracy: 3000, speed: 30 });
  assert.equal(await where.driving(other), false);
  // Off: nothing is known and nothing is driving.
  await where.setEnabled(owner, false);
  assert.equal(await where.driving(owner), false);
});

test("driving: the tool changes the setting and a passenger can say so", async () => {
  const now = Date.parse("2026-11-08T15:00:00Z");
  const where = new Whereabouts(db, undefined, () => now);
  const owner = "drive-4";
  await where.setEnabled(owner, true);
  await where.report(owner, { lat: 29.75, lng: -95.36, accuracy: 10, speed: 20 });
  await where.report(owner, { lat: 29.7501, lng: -95.36, accuracy: 10, speed: 20 });
  const set = tool(where, owner, "set_driving_mode");
  assert.equal(((await set({ do: "off" })) as { driving: boolean }).driving, false);
  assert.equal(await where.driving(owner), false);
  await set({ do: "on" });
  assert.equal(await where.driving(owner), true);
  await set({ do: "not_driving" });
  assert.equal(await where.driving(owner), false);
});

test("mileage: a drive is counted only while the log is on, and short shuffles aren't trips", async () => {
  let now = Date.parse("2026-11-08T15:00:00Z");
  const streets = async (lat: number) =>
    lat > 29.8 ? "Elm Street, Houston" : "Main Street, Houston";
  const where = new Whereabouts(db, streets, () => now);
  const owner = "trip-1";
  await where.setEnabled(owner, true);
  // Log off: a drive isn't kept.
  await where.report(owner, { lat: 29.75, lng: -95.36, accuracy: 10, speed: 15 });
  now += 60_000;
  await where.report(owner, { lat: 29.76, lng: -95.36, accuracy: 10, speed: 15 });
  assert.equal((await where.trips(owner)).length, 0);

  await where.setMileage(owner, true);
  // A real drive: a report a minute for six minutes, a bit over 1 km a minute.
  let lat = 29.8;
  for (let i = 0; i < 6; i++) {
    await where.report(owner, { lat, lng: -95.36, accuracy: 10, speed: 17 });
    lat += 0.01;
    now += 60_000;
  }
  // Stopped for longer than five minutes: the trip ends.
  for (let i = 0; i < 7; i++) {
    await where.report(owner, { lat, lng: -95.36, accuracy: 10, speed: 0 });
    now += 60_000;
  }
  await where.settled();
  const trips = await where.trips(owner);
  assert.equal(trips.length, 1);
  const trip = trips[0] as NonNullable<(typeof trips)[number]>;
  assert.ok(trip.meters > 4500 && trip.meters < 6500, `distance ${trip.meters}`);
  assert.equal(trip.from?.place, "Main Street, Houston");
  assert.equal(trip.to?.place, "Elm Street, Houston");
  const view = await where.view(owner);
  assert.equal(view.trips.count, 1);
  assert.equal(view.mileage, true);

  // A 100 m car park shuffle is not a trip.
  now += 20 * 60_000;
  await where.report(owner, { lat: 30.5, lng: -95.36, accuracy: 10, speed: 5 });
  now += 60_000;
  await where.report(owner, { lat: 30.5008, lng: -95.36, accuracy: 10, speed: 5 });
  now += 11 * 60_000;
  assert.equal((await where.trips(owner)).length, 1);
});

test("mileage: a drive whose phone went quiet is closed, labelled, exported and cleared", async () => {
  let now = Date.parse("2026-11-08T15:00:00Z");
  const where = new Whereabouts(db, undefined, () => now);
  const owner = "trip-2";
  await where.setEnabled(owner, true);
  await where.setMileage(owner, true);
  let lat = 29.8;
  for (let i = 0; i < 5; i++) {
    await where.report(owner, { lat, lng: -95.3, accuracy: 10, speed: 18 });
    lat += 0.01;
    now += 60_000;
  }
  // The app was closed at the end of the drive: it's closed when asked about, later.
  now += 20 * 60_000;
  const summary = tool(where, owner, "mileage_log");
  const result = (await summary({ do: "summary", period: "today" })) as {
    tripCount: number;
    totalMiles: string;
    csv: string;
    trips: Array<{ id: string }>;
  };
  assert.equal(result.tripCount, 1);
  assert.match(result.totalMiles, /^\d+\.\d mi$/);
  assert.match(result.csv, /^Date,From,To,Miles,Purpose\n2026-11-08,/);
  const id = (result.trips[0] as { id: string }).id;
  await summary({ do: "label", id, purpose: "business" });
  const again = (await summary({ do: "summary", period: "all" })) as { csv: string };
  assert.match(again.csv, /,business$/m);
  // Clearing needs no model's judgement: it removes what's there.
  assert.deepEqual(await summary({ do: "clear" }), { removed: 1, message: "Deleted 1 trip." });
  assert.equal(((await summary({ do: "summary" })) as { none?: boolean }).none, true);
});

test("a day and a month are the person's own, not UTC's", () => {
  // 9 pm on 7 Nov in Chicago is 3 am on 8 Nov UTC.
  const lateEvening = Date.parse("2026-11-08T03:00:00Z");
  assert.equal(localDate(lateEvening, "America/Chicago"), "2026-11-07");
  assert.equal(localDate(lateEvening, "UTC"), "2026-11-08");
  const today = localDayStart(lateEvening, "America/Chicago");
  assert.equal(new Date(today).toISOString(), "2026-11-07T06:00:00.000Z");
  assert.equal(
    localDate(periodStart("month", lateEvening, "America/Chicago"), "America/Chicago"),
    "2026-11-01",
  );
  assert.equal(
    localDate(periodStart("year", lateEvening, "America/Chicago"), "America/Chicago"),
    "2026-01-01",
  );
  assert.equal(
    localDate(periodStart("week", lateEvening, "America/Chicago"), "America/Chicago"),
    "2026-11-01",
  );
  assert.equal(periodStart("all", lateEvening, "UTC"), 0);
  assert.equal(milesWords(1609.34 * 12.44), "12.4 mi");
});

const ZONE = "America/Chicago";
const NOW = Date.parse("2026-10-22T16:00:00Z");
const clinic = (): DayEvent => ({
  id: "c1",
  title: "Dentist",
  start: "2026-10-22T18:00:00Z",
  end: "2026-10-22T19:00:00Z",
  allDay: false,
  app: "googlecalendar",
  location: "100 Main St, Houston",
});

test("leave-by: with the phone's spot the time to leave comes from the drive, not the usual buffer", () => {
  const base = { now: NOW, buffer: 30, timeZone: ZONE, chatty: "normal" as const };
  const usual = headsUpsFor([clinic()], base).find((h) => h.kind === "leave_for");
  assert.match(usual?.body ?? "", /about 30 minutes/);
  const near = headsUpsFor([clinic()], { ...base, drive: new Map([["c1", 10]]) }).find(
    (h) => h.kind === "leave_for",
  );
  // 1:00 pm start, 10 min drive + 5 to park: leave by 12:45 pm.
  assert.match(near?.title ?? "", /12:45 pm/);
  assert.match(near?.body ?? "", /about 10 minutes by car/);
  assert.match(near?.body ?? "", /no live traffic/);
  const far = headsUpsFor([clinic()], { ...base, drive: new Map([["c1", 90]]) }).find(
    (h) => h.kind === "leave_for",
  );
  // 90 + 5 minutes before 1:00 pm is 11:25 am: that's already past 11:00? No, 25 minutes ahead.
  assert.match(far?.title ?? "", /11:25 am/);
  // Late: the card says it's time now.
  const late = headsUpsFor([clinic()], {
    ...base,
    now: NOW + 100 * 60_000,
    drive: new Map([["c1", 90]]),
  }).find((h) => h.kind === "leave_for");
  assert.match(late?.title ?? "", /Time to leave/);
  assert.match(late?.body ?? "", /about 90 minutes by car/);
});

test("place reminders: wait for the arrival, once, and not at once if they're already there", async () => {
  let now = Date.parse("2026-11-08T15:00:00Z");
  const sent: string[] = [];
  const pharmacy = { lat: 29.75, lng: -95.36 };
  const reminders = new PlaceReminders(
    db,
    async (_owner, note) => {
      sent.push(`${note.title} | ${note.body}`);
    },
    () => async (query) => (query.includes("nowhere") ? undefined : pharmacy),
    () => now,
  );
  const owner = "place-1";
  const bad = await reminders.add(owner, { text: "buy milk", place: "nowhere land" });
  assert.deepEqual(bad, { reason: "not-found" });
  const far = { lat: 29.8, lng: -95.36, minutesAgo: 1 };
  const made = await reminders.add(
    owner,
    { text: "Pick up the prescription", place: "Corner Pharmacy, Houston" },
    far,
  );
  assert.ok("reminder" in made && made.reminder?.armed);
  // Not there yet.
  await reminders.seen({ owner, ...far, at: now, first: true });
  assert.equal(sent.length, 0);
  // A poor fix near it can't say they arrived.
  now += 60_000;
  await reminders.seen({ owner, ...pharmacy, accuracy: 900, at: now, first: false });
  assert.equal(sent.length, 0);
  // Arrived: told once, and the reminder is gone.
  await reminders.seen({ owner, ...pharmacy, accuracy: 15, at: now, first: false });
  await reminders.seen({ owner, ...pharmacy, accuracy: 15, at: now, first: false });
  assert.equal(sent.length, 1);
  assert.match(sent[0] as string, /^Pick up the prescription \| You’re at Corner Pharmacy/);
  assert.equal((await reminders.list(owner)).length, 0);

  // Made while standing there: waits until they've left and come back.
  const here = { ...pharmacy, minutesAgo: 0 };
  const again = await reminders.add(
    owner,
    { text: "Ask about refills", place: "Corner Pharmacy" },
    here,
  );
  assert.ok("alreadyThere" in again && again.alreadyThere);
  await reminders.seen({ owner, ...pharmacy, accuracy: 15, at: now, first: false });
  assert.equal(sent.length, 1, "not at once");
  await reminders.seen({ owner, ...far, accuracy: 15, at: now, first: false });
  await reminders.seen({ owner, ...pharmacy, accuracy: 15, at: now, first: false });
  assert.equal(sent.length, 2);

  // Two weeks later an unfired one is dropped; one can be cancelled by its words.
  await reminders.add(owner, { text: "Return the library books", place: "Library" }, far);
  assert.equal((await reminders.cancel(owner, undefined, "library")).removed, 1);
  await reminders.add(owner, { text: "Water the plants", place: "Home" }, far);
  now += 15 * 24 * 60 * 60_000;
  assert.equal((await reminders.list(owner)).length, 0);
});

test("the driving note changes every turn, so it goes after the conversation (prompt caching)", async () => {
  const { VOLATILE_CONTEXT } = await import("../apps/server/src/engine/tanstack-agent.ts");
  assert.ok(VOLATILE_CONTEXT.test("Driving right now (from their phone's speed)"));
});

test("driving: a second device can't make the phone look like it is driving, and a passenger's bus isn't logged", async () => {
  let now = Date.parse("2026-11-08T15:00:00Z");
  const where = new Whereabouts(db, undefined, () => now);
  const owner = "drive-5";
  await where.setEnabled(owner, true);
  await where.setMileage(owner, true);
  // A laptop at home and a phone in the car take turns: the jumps between them are not speed.
  for (let i = 0; i < 4; i++) {
    await where.report(owner, { lat: 29.75, lng: -95.36, accuracy: 10, device: "laptop" });
    now += 20_000;
    await where.report(owner, { lat: 29.85, lng: -95.36, accuracy: 10, device: "phone" });
    now += 20_000;
  }
  assert.equal(await where.driving(owner), false);
  assert.equal((await where.trips(owner)).length, 0);
  // The phone really driving: only the phone's screen is told so.
  for (let i = 0; i < 3; i++) {
    await where.report(owner, {
      lat: 29.85 + i * 0.002,
      lng: -95.36,
      accuracy: 10,
      speed: 18,
      device: "phone",
    });
    now += 10_000;
  }
  assert.equal(await where.driving(owner, "phone"), true);
  assert.equal(await where.driving(owner, "laptop"), false);

  // A passenger says so: what was counted of that ride is dropped, and it isn't counted afterwards.
  const bus = "drive-6";
  await where.setEnabled(bus, true);
  await where.setMileage(bus, true);
  let lat = 29.9;
  const ride = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await where.report(bus, { lat, lng: -95.4, accuracy: 10, speed: 17, device: "phone" });
      lat += 0.008;
      now += 60_000;
    }
  };
  await ride(3);
  where.notDriving(bus);
  await ride(4);
  for (let i = 0; i < 7; i++) {
    await where.report(bus, { lat, lng: -95.4, accuracy: 10, speed: 0, device: "phone" });
    now += 60_000;
  }
  await where.settled();
  assert.equal((await where.trips(bus)).length, 0);
});

test("mileage: a bike ride (never at car speed) and a long silence aren't trips, and a gap isn't bridged", async () => {
  let now = Date.parse("2026-11-08T15:00:00Z");
  const where = new Whereabouts(db, undefined, () => now);
  const owner = "trip-3";
  await where.setEnabled(owner, true);
  await where.setMileage(owner, true);
  // 6 m/s is a quick bike: moving, but not a car.
  let lat = 29.9;
  for (let i = 0; i < 8; i++) {
    await where.report(owner, { lat, lng: -95.3, accuracy: 10, speed: 6, device: "phone" });
    lat += 0.003;
    now += 60_000;
  }
  now += 30 * 60_000;
  assert.equal((await where.trips(owner)).length, 0);
  // A drive, then the app closes for an hour, then another drive: two trips, not one with a straight line across the gap.
  for (let i = 0; i < 4; i++) {
    await where.report(owner, { lat, lng: -95.3, accuracy: 10, speed: 17, device: "phone" });
    lat += 0.01;
    now += 60_000;
  }
  now += 60 * 60_000;
  lat += 0.5;
  for (let i = 0; i < 4; i++) {
    await where.report(owner, { lat, lng: -95.3, accuracy: 10, speed: 17, device: "phone" });
    lat += 0.01;
    now += 60_000;
  }
  now += 30 * 60_000;
  const trips = await where.trips(owner);
  assert.equal(trips.length, 2);
  for (const trip of trips) assert.ok(trip.meters < 6000, `no bridged gap: ${trip.meters}`);
});
