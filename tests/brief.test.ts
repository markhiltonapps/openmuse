import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { briefToolSpec } from "../apps/server/src/brief.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close?.();
});

test("“brief me” puts the day together: calendar, what's waiting, jobs, coming up", async () => {
  const owner = "brief-1";
  const later = new Date(Date.now() + 3_600_000).toISOString();
  await db.put(owner, "actions", {
    id: "a1",
    kind: "email.send",
    title: "Email Bob about Friday",
    status: "awaiting_review",
    expiresAt: later,
    createdAt: new Date().toISOString(),
    data: {},
  });
  await db.put(owner, "tasks", {
    id: "t1",
    title: "Find a plumber",
    status: "waiting_input",
    updatedAt: new Date().toISOString(),
  });
  const calendar = {
    execute: async () => ({
      events: [{ title: "Dentist", start: later }],
      reminders: [],
      timeZone: "America/Chicago",
    }),
  };
  const brief = briefToolSpec(
    { db, calendar: calendar as never, comingUp: async () => "- Flight to Denver (Fri)" },
    owner,
  );
  const result = (await brief.execute()) as Record<string, unknown>;
  assert.deepEqual((result.today as { events: unknown[] }).events.length, 1);
  assert.deepEqual(result.waitingForYourOk, ["Email Bob about Friday"]);
  assert.deepEqual((result.jobs as Record<string, string[]>).needYourAnswer, ["Find a plumber"]);
  assert.match(String(result.comingUp), /Denver/);
  // A calendar that can't be read is said so, not left as an empty day.
  const noCalendar = briefToolSpec({ db }, owner);
  assert.match(
    String(((await noCalendar.execute()) as { today: { note?: string } }).today.note),
    /couldn't be read/,
  );
});
