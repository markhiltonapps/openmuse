import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { localNow } from "../apps/server/src/engine/conversation.ts";
import { ReminderService, reminderToolSpecs } from "../apps/server/src/reminders.ts";
import type { AgentNotification } from "../packages/domain/src/agent.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close();
});

test("reminders go off once at the person's local time, and can be moved or snoozed", async () => {
  let now = Date.parse("2026-09-27T20:00:00Z"); // 3 pm Sunday in Chicago
  const sent: { owner: string; title: string; body: string; key: string }[] = [];
  const reminders = new ReminderService(
    db,
    async () => "America/Chicago",
    async (owner, reminder) => {
      sent.push({ owner, ...reminder });
    },
    () => now,
  );
  const owner = "forgetful";
  const [set, list, change, cancel] = reminderToolSpecs(
    reminders,
    owner,
    (name, args) => `${name}:${JSON.stringify(args)}`,
  );
  const dentist = (await set?.execute({
    text: "Call the dentist",
    at: "2026-09-28T15:00",
  } as never)) as { id: string; dueAt: string; when: string };
  assert.equal(dentist.dueAt, "2026-09-28T20:00:00.000Z");
  assert.equal(dentist.when, "Mon, Sep 28, 3:00 PM");
  const again = (await set?.execute({
    text: "Call the dentist",
    at: "2026-09-28T15:00",
  } as never)) as { id: string };
  assert.equal(again.id, dentist.id, "a repeated request doesn't add a second reminder");
  const soon = (await set?.execute({ text: "Take the bread out", inMinutes: 20 } as never)) as {
    id: string;
    dueAt: string;
  };
  assert.equal(soon.dueAt, "2026-09-27T20:20:00.000Z");
  await assert.rejects(
    reminders.set(owner, { text: "Too late", at: "2026-09-27T09:00" }),
    /already passed/,
  );
  await assert.rejects(reminders.set(owner, { text: "When?" }));

  // "Move my Monday reminder to Tuesday"
  const moved = await change?.execute({ id: dentist.id, at: "2026-09-29T15:00" } as never);
  assert.equal((moved as { when: string }).when, "Tue, Sep 29, 3:00 PM");
  const listed = (await list?.execute({} as never)) as { upcoming: { text: string }[] };
  assert.deepEqual(
    listed.upcoming.map((r) => r.text),
    ["Take the bread out", "Call the dentist"],
  );

  now = Date.parse("2026-09-27T20:21:00Z");
  await reminders.deliverDue();
  await reminders.deliverDue();
  assert.deepEqual(
    sent.map(({ title, body }) => ({ title, body })),
    [{ title: "Reminder", body: "Take the bread out" }],
    "sent once",
  );
  const snoozed = await reminders.snooze(owner, soon.id, 10);
  assert.equal(snoozed.status, "upcoming");
  now = Date.parse("2026-09-27T20:32:00Z");
  await reminders.deliverDue();
  assert.equal(sent.length, 2);
  assert.notEqual(sent[0]?.key, sent[1]?.key, "a snoozed reminder notifies again");

  // A person whose account was removed gets nothing; the server being down means a late label.
  now = Date.parse("2026-09-29T21:00:00Z");
  await reminders.deliverDue(async () => true);
  assert.equal(sent.length, 2);
  await reminders.deliverDue();
  assert.match(sent[2]?.title ?? "", /^Reminder \(from Tue, Sep 29, 3:00 PM\)$/);
  assert.equal((await reminders.list(owner)).sent.length, 2);

  await set?.execute({ text: "Renew passport", at: "2026-10-05T09:00" } as never);
  const renew = (await reminders.list(owner)).upcoming[0];
  assert.deepEqual(await cancel?.execute({ id: renew?.id } as never), { ok: true });
  assert.equal((await reminders.list(owner)).upcoming.length, 0);
  // Sent reminders are cleared a week later.
  now += 8 * 24 * 60 * 60 * 1000;
  await reminders.deliverDue();
  assert.equal((await reminders.list(owner)).sent.length, 0);
  assert.equal((await reminders.list("someone-else")).upcoming.length, 0);
});

test("the agent knows the date and time, and reminders reach the app as updates", async () => {
  assert.equal(
    localNow("America/Chicago", Date.parse("2026-09-28T01:45:00Z")),
    "Sunday, September 27, 2026 at 8:45 PM (America/Chicago)",
  );
  const directory = await mkdtemp(join(tmpdir(), "openmuse-reminders-"));
  const store = await createStore();
  const server = await createApp(store, {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  });
  try {
    const { token } = await server.auth.session();
    const owner = "local-user";
    const reminder = await server.agent.reminders?.set(owner, {
      text: "Stretch",
      inMinutes: 1,
    });
    assert.ok(reminder);
    const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
    const listed = await server.app.request("/api/reminders", { headers });
    assert.equal(((await listed.json()) as { upcoming: unknown[] }).upcoming.length, 1);
    await store.compareAndSwap(
      owner,
      "reminders",
      reminder.id,
      {},
      {
        dueAt: new Date(Date.now() - 1000).toISOString(),
      },
    );
    await server.agent.reminders?.deliverDue();
    const notes = await store.list<AgentNotification>(owner, "notifications");
    assert.deepEqual(
      notes.map((n) => ({ title: n.title, body: n.body, reminderId: n.reminderId })),
      [{ title: "Reminder", body: "Stretch", reminderId: reminder.id }],
    );
    const snoozed = await server.app.request(`/api/reminders/${reminder.id}/snooze`, {
      method: "POST",
      headers,
      body: JSON.stringify({ minutes: 5 }),
    });
    assert.equal(snoozed.status, 200);
    const cancelled = await server.app.request(`/api/reminders/${reminder.id}/cancel`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(cancelled.status, 200);
  } finally {
    await server.agent.stop();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
