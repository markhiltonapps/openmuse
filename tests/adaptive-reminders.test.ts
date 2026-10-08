import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { type CalendarEvent, ReminderService } from "../apps/server/src/reminders.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close?.();
});

test("a reminder for an event moves when the event moves, and says so; a lost event is said once", async () => {
  let now = Date.parse("2026-10-08T14:00:00Z");
  const told: { title: string; body: string }[] = [];
  const reminders = new ReminderService(
    db,
    async () => "America/Chicago",
    async (_owner, reminder) => {
      told.push(reminder);
    },
    () => now,
  );
  // 30 minutes before the dentist at 3 PM Chicago (20:00 UTC) on Oct 9.
  const set = await reminders.set("adapt-1", {
    text: "Leave for the dentist",
    at: "2026-10-09T14:30",
    event: { title: "Dentist", start: "2026-10-09T20:00:00Z", id: "ev1" },
  });
  let calendar: CalendarEvent[] = [{ id: "ev1", title: "Dentist", start: "2026-10-09T20:00:00Z" }];
  const read = async () => calendar;
  await reminders.followEvents(read);
  assert.equal(told.length, 0, "nothing moved, nothing said");
  // The dentist moves an hour later: the reminder keeps its 30 minutes.
  calendar = [{ id: "ev1", title: "Dentist", start: "2026-10-09T21:00:00Z" }];
  await reminders.followEvents(read);
  const moved = (await reminders.list("adapt-1")).upcoming[0];
  assert.equal(moved?.id, set.id);
  assert.equal(moved?.dueAt, "2026-10-09T20:30:00.000Z");
  assert.equal(told[0]?.title, "Reminder moved");
  assert.match(told[0]?.body ?? "", /“Dentist” moved to .*4:00 PM.*now at .*3:30 PM/);
  // Gone from the calendar: said once, and the reminder stays.
  calendar = [];
  await reminders.followEvents(read);
  await reminders.followEvents(read);
  assert.equal(told.length, 2);
  assert.match(told[1]?.body ?? "", /can’t find “Dentist”/);
  assert.equal((await reminders.list("adapt-1")).upcoming.length, 1);
  // A calendar that couldn't be read changes nothing.
  now += 60_000;
  await reminders.followEvents(async () => {
    throw new Error("offline");
  });
  assert.equal(told.length, 2);
});
