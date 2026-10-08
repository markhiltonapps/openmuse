import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { UrgentAlerts, urgentKind } from "../apps/server/src/urgent-alerts.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close?.();
});

const on = {
  timeToLeave: true,
  security: true,
  money: true,
  people: true,
  peopleList: ["dana@acme.com", "Mom"],
};

test("what counts as urgent: security, money, and people they chose", () => {
  assert.equal(urgentKind({ title: "New sign-in from Chrome on Windows" }, on), "security");
  assert.equal(urgentKind({ title: "Your password was changed" }, on), "security");
  // An ordinary sign-in code isn't urgent (they come all day, and the code would be read aloud).
  assert.equal(urgentKind({ title: "Your verification code is 482913" }, on), undefined);
  // A name matches the sender's name as a whole word; an address matches exactly.
  assert.equal(
    urgentKind({ from: "Mom's Bakery <hi@bakery.com>", title: "Fresh bread" }, on),
    undefined,
  );
  assert.equal(urgentKind({ from: "Dana <dana@acme.com>", title: "Quick one" }, on), "people");
  assert.equal(urgentKind({ from: "Dan <dan@acme.com.au>", title: "Hi" }, on), undefined);
  assert.equal(urgentKind({ title: "Payment failed for your subscription" }, on), "money");
  assert.equal(urgentKind({ title: "Your card was declined" }, on), "money");
  assert.equal(urgentKind({ from: "Mom <mom@example.com>", title: "Call me" }, on), "people");
  assert.equal(urgentKind({ from: "news@shop.com", title: "50% off everything" }, on), undefined);
  // Each kind has its own switch.
  assert.equal(urgentKind({ title: "Your card was declined" }, { ...on, money: false }), undefined);
});

test("switches change by voice or tap, and an urgent email is said on the call once it's on", async () => {
  const said: [string, string][] = [];
  const alerts = new UrgentAlerts(db, {
    speak: (_owner, line, key) => {
      said.push([line, key]);
      return true;
    },
  });
  const owner = "urgent-1";
  assert.equal((await alerts.settings(owner)).security, true);
  await alerts.update(owner, { money: false, addPeople: ["Dana at Acme"] });
  const settings = await alerts.settings(owner);
  assert.equal(settings.money, false);
  assert.deepEqual(settings.peopleList, ["Dana at Acme"]);
  assert.equal(
    await alerts.consider(owner, { title: "Payment failed", key: "m1" }),
    undefined,
    "money is off",
  );
  assert.equal(
    await alerts.consider(owner, {
      title: "Suspicious sign-in attempt",
      from: "Google",
      key: "s1",
    }),
    "security",
  );
  assert.match(said[0]?.[0] ?? "", /security alert just came in from Google/);
  // Removing takes the exact entry only.
  await alerts.update(owner, { removePeople: ["dana"] });
  assert.deepEqual((await alerts.settings(owner)).peopleList, ["Dana at Acme"]);
  await alerts.update(owner, { removePeople: ["dana at acme"] });
  assert.deepEqual((await alerts.settings(owner)).peopleList, []);
});

test("time to leave: something starting in 10 to 20 minutes is said on the call", async () => {
  const now = Date.parse("2026-10-08T19:45:00Z");
  const said: string[] = [];
  const alerts = new UrgentAlerts(db, {
    speak: (_owner, line) => {
      said.push(line);
      return true;
    },
    events: async () => [
      { title: "Dentist", start: "2026-10-08T20:00:00Z", location: "12 Main St" },
      { title: "Holiday", start: "2026-10-08T20:00:00Z", allDay: true },
      { title: "Later meeting", start: "2026-10-08T21:00:00Z" },
    ],
    timeZone: async () => "America/Chicago",
    now: () => now,
  });
  await alerts.checkLeave("urgent-2");
  assert.deepEqual(said, [
    "Heads up: “Dentist” starts in about 15 minutes, at 3:00 PM. It’s at 12 Main St.",
  ]);
  await alerts.update("urgent-2", { timeToLeave: false });
  said.length = 0;
  await alerts.checkLeave("urgent-2");
  assert.deepEqual(said, []);
});
