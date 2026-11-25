import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import { Proactive } from "../apps/server/src/proactive.ts";
import { buildRecap, recapToolSpecs, WeeklyRecap } from "../apps/server/src/recap.ts";

const NOW = Date.parse("2026-11-29T23:30:00Z"); // Sunday 5:30 pm in Chicago
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

async function seed() {
  const db = await createStore();
  const o = "o";
  await db.put(o, "tasks", {
    id: "t1",
    title: "Morning brief",
    status: "succeeded",
    updatedAt: ago(1),
  });
  await db.put(o, "tasks", {
    id: "t2",
    title: "Book the plumber",
    status: "succeeded",
    updatedAt: ago(3),
  });
  await db.put(o, "tasks", {
    id: "t3",
    title: "Find a dentist",
    status: "succeeded",
    updatedAt: ago(4),
  });
  await db.put(o, "tasks", { id: "t4", title: "Old job", status: "succeeded", updatedAt: ago(20) });
  await db.put(o, "tasks", { id: "t5", title: "Failed job", status: "failed", updatedAt: ago(1) });
  await db.put(o, "actions", { id: "a1", status: "succeeded", createdAt: ago(2) });
  await db.put(o, "actions", { id: "a2", status: "denied", createdAt: ago(2) });
  await db.put(o, "reminders", { id: "r1", status: "sent", sentAt: ago(1) });
  await db.put(o, "commitments", { id: "c1", title: "Flight to Denver", createdAt: ago(2) });
  await db.put(o, "memories", { id: "m1", text: "Likes oat milk", createdAt: ago(5) });
  return { db, o };
}

test("the recap counts only this week's real work, in plain words", async () => {
  const { db, o } = await seed();
  const recap = await buildRecap(db, o, NOW - 7 * 86_400_000);
  assert.deepEqual(recap.lines, [
    "Finished 3 jobs: Morning brief, Book the plumber and 1 more",
    "Did 1 thing you approved",
    "Started keeping an eye on 1 plan: Flight to Denver",
    "Sent 1 reminder",
    "Remembered 1 new thing you told me",
  ]);
  assert.equal(recap.counts.jobs, 3, "an old job and a failed one don't count");
});

function recapper(db: Awaited<ReturnType<typeof createStore>>, now: number, quiet?: string) {
  const sent: { title: string; body: string; key: string }[] = [];
  const proactive = new Proactive(db, {
    timeZone: async () => "America/Chicago",
    quietHours: async () => quiet,
    notify: async () => undefined,
    now: () => now,
  });
  const weekly = new WeeklyRecap(
    db,
    proactive,
    async (_o, note) => {
      sent.push(note);
    },
    async () => "America/Chicago",
    async () => ["o"],
    () => now,
  );
  return { weekly, sent, proactive };
}

test("Sunday evening it goes once; never on other days; not at all in an empty week", async () => {
  const { db } = await seed();
  const saturday = recapper(db, NOW - 86_400_000);
  await saturday.weekly.due();
  assert.equal(saturday.sent.length, 0);
  const { weekly, sent } = recapper(db, NOW);
  await weekly.due();
  await weekly.due();
  assert.equal(sent.length, 1, "once a week");
  assert.equal(sent[0]?.title, "Your week, in short");
  assert.match(
    sent[0]?.body ?? "",
    /^Finished 3 jobs: Morning brief, Book the plumber and 1 more\. /,
  );

  const empty = await createStore();
  const quiet = recapper(empty, NOW);
  await quiet.weekly.due();
  assert.equal(quiet.sent.length, 0, "nothing to say, nothing sent");
});

test("its own switch and quiet hours are respected", async () => {
  const { db } = await seed();
  const off = recapper(db, NOW);
  await off.proactive.update("o", { mute: "weekly", muteDays: 365 });
  await off.weekly.due();
  assert.equal(off.sent.length, 0, "turned off");

  const { db: db2 } = await seed();
  const held = recapper(db2, NOW, "5 pm to 9 pm");
  await held.weekly.due();
  assert.equal(held.sent.length, 0, "quiet hours: held, not claimed");
  const later = recapper(db2, NOW + 4 * 3_600_000);
  await later.weekly.due();
  assert.equal(later.sent.length, 1, "goes out after quiet hours, still on time");
});

test("asked by voice or chat, it answers from the same records", async () => {
  const { db, o } = await seed();
  const [tool] = recapToolSpecs(db, o) as unknown as {
    execute: (a: unknown) => Promise<{ lines: string[]; note?: string }>;
  }[];
  const answer = await tool?.execute({ days: 30 });
  assert.match(answer?.lines[0] ?? "", /^Finished 4 jobs/);
  const none = await tool?.execute({ days: 1 });
  assert.ok(none);
});

test("repeats are grouped, end marks dropped, and a recap held Sunday night goes Monday morning", async () => {
  const db = await createStore();
  for (const id of ["r1", "r2", "r3"])
    await db.put("o", "tasks", {
      id,
      title: "Morning brief",
      status: "succeeded",
      updatedAt: ago(1),
    });
  await db.put("o", "tasks", {
    id: "q",
    title: "Is the shop open?",
    status: "succeeded",
    updatedAt: ago(2),
  });
  const recap = await buildRecap(db, "o", NOW - 7 * 86_400_000);
  assert.equal(recap.lines[0], "Finished 4 jobs: Morning brief (3 times), Is the shop open");
  // Quiet hours from 5 pm to 9 am: held all Sunday evening, sent Monday at 9.
  const sunday = recapper(db, NOW, "5 pm to 9 am");
  await sunday.weekly.due();
  assert.equal(sunday.sent.length, 0);
  const mondayNine = Date.parse("2026-11-30T15:05:00Z"); // Monday 9:05 am in Chicago
  const monday = recapper(db, mondayNine, "5 pm to 9 am");
  await monday.weekly.due();
  assert.equal(monday.sent.length, 1, "Sunday's recap, on Monday morning");
  assert.match(monday.sent[0]?.key ?? "", /^weekly:2026-11-29$/);
  const noon = recapper(db, Date.parse("2026-11-30T18:30:00Z"));
  await noon.weekly.due();
  assert.equal(noon.sent.length, 0, "once only, and never after Monday noon");
});
