import assert from "node:assert/strict";
import { test } from "node:test";
import type { DayEvent, TodayCalendar } from "../apps/server/src/calendar-today.ts";
import { createStore } from "../apps/server/src/db.ts";
import { HeadsUps, headsUpToolSpecs } from "../apps/server/src/heads-ups.ts";

const ZONE = "America/Chicago";
const at = (iso: string) => Date.parse(iso);
let n = 0;
const event = (
  title: string,
  start: string,
  end: string,
  extra: Partial<DayEvent> = {},
): DayEvent => ({
  id: `ev${++n}`,
  title,
  start: `2026-10-22T${start}:00Z`,
  end: `2026-10-22T${end}:00Z`,
  allDay: false,
  app: "googlecalendar",
  ...extra,
});
// 1:00-2:00 pm and 2:30-3:00 pm in Chicago (CDT).
const DENTIST = event("Dentist", "18:00", "19:00");
const ZOOM = event("Zoom with Dana", "19:30", "20:00");

async function setUp(start: string, events: DayEvent[] = [DENTIST, ZOOM], quiet?: string) {
  const db = await createStore();
  let now = at(start);
  const sent: { title: string; body: string; push: boolean; key: string }[] = [];
  const emails: { title: string }[] = [];
  const reads: string[] = [];
  let calendar: TodayCalendar | Error = { events, checked: ["googlecalendar"], failed: [] };
  const headsUps = new HeadsUps(db, {
    events: async (_owner, from) => {
      reads.push(from);
      if (calendar instanceof Error) throw calendar;
      return calendar;
    },
    timeZone: async () => ZONE,
    quietHours: async () => quiet,
    owners: async () => ["me"],
    notify: async (_owner, note) => {
      sent.push(note);
      return true;
    },
    email: async (_owner, item) => {
      emails.push(item);
    },
    now: () => now,
  });
  return {
    db,
    headsUps,
    sent,
    emails,
    reads,
    at: (iso: string) => {
      now = at(iso);
    },
    setCalendar: (value: TodayCalendar | Error) => {
      calendar = value;
    },
  };
}

test("the dentist and the Zoom: told when to leave, then to head back, each once", async () => {
  // 12:10 pm in Chicago: 20 minutes before it's time to leave for the dentist (12:30).
  const { headsUps, sent, at: move, reads } = await setUp("2026-10-22T17:10:00Z");
  await headsUps.due();
  assert.deepEqual(
    sent.map((s) => s.title),
    ["Leave for Dentist by 12:30 pm"],
  );
  await headsUps.due();
  assert.equal(reads.length, 1, "not looked at again before its time");
  // 12:46 pm: the appointment is about to begin, so the heads-up about getting back arrives.
  move("2026-10-22T17:46:00Z");
  await headsUps.due();
  await headsUps.due();
  assert.deepEqual(
    sent.map((s) => s.title),
    ["Leave for Dentist by 12:30 pm", "Head back right after Dentist"],
  );
  assert.match(sent[1]?.body ?? "", /Dentist ends at 2:00 pm and Zoom with Dana starts at 2:30 pm/);
  assert.ok(sent.every((s) => s.push));
  // Looked at again later, nothing is said twice.
  move("2026-10-22T18:30:00Z");
  await headsUps.due();
  assert.equal(sent.length, 2);
});

test("quiet hours: nothing is read or said, and it picks up when they end", async () => {
  // 11 pm in Chicago, default quiet hours 10 pm to 7 am.
  const { headsUps, sent, reads, at: move, db } = await setUp("2026-10-23T04:00:00Z");
  await headsUps.due();
  assert.equal(reads.length, 0);
  assert.equal(sent.length, 0);
  const state = await db.get<{ nextCheckAt: string }>("me", "heads-up-state", "state");
  assert.equal(state?.nextCheckAt, "2026-10-23T12:00:00.000Z");
  move("2026-10-23T12:00:30Z");
  await headsUps.due();
  assert.equal(reads.length, 1);
});

test("their own words set the quiet hours", async () => {
  // 9:30 pm: quiet for someone who said "9 pm to 8 am", not for the default.
  const quiet = await setUp("2026-10-23T02:30:00Z", [], "9 pm to 8 am");
  await quiet.headsUps.due();
  assert.equal(quiet.reads.length, 0);
  const open = await setUp("2026-10-23T02:30:00Z", []);
  await open.headsUps.due();
  assert.equal(open.reads.length, 1);
});

test("turned off, it says nothing; turned back on, it looks again at once", async () => {
  const { headsUps, sent, reads } = await setUp("2026-10-22T17:10:00Z");
  await headsUps.update("me", { on: false });
  await headsUps.due();
  assert.equal(sent.length, 0);
  assert.equal(reads.length, 0);
  await headsUps.update("me", { on: true });
  await headsUps.due();
  assert.equal(sent.length, 1);
});

test("a calendar that isn't connected costs one look an hour, not one a pass", async () => {
  const { headsUps, reads, setCalendar, at: move } = await setUp("2026-10-22T17:10:00Z");
  setCalendar({ events: [], checked: [], failed: [] });
  await headsUps.due();
  await headsUps.due();
  assert.equal(reads.length, 1);
  move("2026-10-22T18:11:00Z");
  await headsUps.due();
  assert.equal(reads.length, 2);
});

test("connecting a calendar after none is looked at straight away", async () => {
  const { headsUps, reads, setCalendar } = await setUp("2026-10-22T17:10:00Z");
  setCalendar({ events: [], checked: [], failed: [] });
  await headsUps.due();
  setCalendar({ events: [DENTIST, ZOOM], checked: ["googlecalendar"], failed: [] });
  await headsUps.due();
  assert.equal(reads.length, 1, "no poke yet: still waiting out the hour");
  await headsUps.poke("me");
  await headsUps.due();
  assert.equal(reads.length, 2);
  // A person who has a calendar isn't looked at again just because Apps was opened.
  await headsUps.poke("me");
  await headsUps.due();
  assert.equal(reads.length, 2);
});

test("a calendar that can't be read backs off, longer each time, and recovers", async () => {
  const { headsUps, reads, setCalendar, at: move, db } = await setUp("2026-10-22T17:10:00Z");
  setCalendar(new Error("Composio is down"));
  await headsUps.due();
  await headsUps.due();
  assert.equal(reads.length, 1, "not hammered");
  let state = await db.get<{ nextCheckAt: string; failures: number }>(
    "me",
    "heads-up-state",
    "state",
  );
  assert.equal(state?.failures, 1);
  assert.equal(state?.nextCheckAt, "2026-10-22T17:25:00.000Z");
  move("2026-10-22T17:26:00Z");
  await headsUps.due();
  state = await db.get("me", "heads-up-state", "state");
  assert.equal(state?.failures, 2);
  assert.equal(state?.nextCheckAt, "2026-10-22T17:56:00.000Z");
  setCalendar({ events: [DENTIST, ZOOM], checked: ["googlecalendar"], failed: [] });
  move("2026-10-22T17:57:00Z");
  await headsUps.due();
  state = await db.get("me", "heads-up-state", "state");
  assert.equal(state?.failures, 0);
});

test("Not useful closes it and stops that kind; the others carry on", async () => {
  const { headsUps, sent, at: move } = await setUp("2026-10-22T17:10:00Z");
  await headsUps.due();
  const { open } = await headsUps.current("me");
  assert.equal(open[0]?.kind, "leave_for");
  const muted = await headsUps.mute("me", open[0]?.id ?? "");
  assert.equal(muted.kind, "leave_for");
  assert.equal((await headsUps.current("me")).open.length, 0);
  assert.equal((await headsUps.settings("me")).kinds.leave_for, false);
  move("2026-10-22T17:46:00Z");
  await headsUps.due();
  assert.deepEqual(
    sent.map((s) => s.title),
    ["Leave for Dentist by 12:30 pm", "Head back right after Dentist"],
  );
  assert.equal((await headsUps.current("me")).kinds.find((k) => k.kind === "leave_for")?.on, false);
});

test("later: a snoozed heads-up comes back once, then it's done", async () => {
  const { headsUps, sent, at: move } = await setUp("2026-10-22T17:10:00Z");
  await headsUps.due();
  const first = (await headsUps.current("me")).open[0];
  assert.ok(first);
  const { remindAt } = (await headsUps.snooze("me", first.id)) as { remindAt: string };
  assert.equal(remindAt, "2026-10-22T17:20:00.000Z", "ten minutes for what's about to happen");
  assert.equal((await headsUps.current("me")).open.length, 0, "hidden while snoozed");
  move("2026-10-22T17:21:00Z");
  await headsUps.due();
  assert.equal((await headsUps.current("me")).open[0]?.id, first.id);
  assert.equal(sent.length, 2, "told again");
  assert.equal(sent[1]?.push, true, "what's about to happen can buzz again");
  // A second "later" is just done, so nothing nags.
  assert.deepEqual(await headsUps.snooze("me", first.id), { ok: true, reason: "last" });
  assert.equal((await headsUps.current("me")).open.length, 0);
});

test("later, too close to the time to matter, just closes it (and says so)", async () => {
  const { headsUps, at: move } = await setUp("2026-10-22T17:10:00Z");
  await headsUps.due();
  const first = (await headsUps.current("me")).open[0];
  assert.ok(first);
  // 12:25 pm: the dentist starts at 1:00, but 10 more minutes is still before it.
  move("2026-10-22T17:55:00Z");
  assert.deepEqual(await headsUps.snooze("me", first.id), { ok: true, reason: "close" });
});

test("a clash snoozed to later comes back quietly, without a buzz", async () => {
  const a = event("Parent conference", "18:00", "19:00");
  const b = event("Board call", "18:30", "19:30");
  const { headsUps, sent, at: move } = await setUp("2026-10-22T14:00:00Z", [a, b]);
  await headsUps.due();
  const clash = (await headsUps.current("me")).open.find((h) => h.kind === "overlap");
  assert.ok(clash);
  const { remindAt } = (await headsUps.snooze("me", clash.id)) as { remindAt: string };
  assert.equal(remindAt, "2026-10-22T18:00:00.000Z", "four hours on");
  move("2026-10-22T18:01:00Z");
  await headsUps.due();
  assert.equal(sent.at(-1)?.push, false);
});

test("a meeting about to start is a card and a bell entry, never a phone buzz", async () => {
  const standup = event("Standup", "17:00", "17:30", {
    location: "https://meet.google.com/abc-defg-hij",
  });
  const { headsUps, sent } = await setUp("2026-10-22T16:55:00Z", [standup]);
  await headsUps.due();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.title, "Standup starts at 12:00 pm");
  assert.equal(sent[0]?.push, false);
  assert.ok(
    !sent[0]?.body.includes("http"),
    "the link is for the Join button, not the notification",
  );
});

test("no time zone yet, no heads-ups: every time would be wrong; a known UTC is fine", async () => {
  const make = async (known: boolean) => {
    const db = await createStore();
    const sent: string[] = [];
    const headsUps = new HeadsUps(db, {
      events: async () => ({ events: [DENTIST, ZOOM], checked: ["googlecalendar"], failed: [] }),
      timeZone: async () => "UTC",
      zoneKnown: async () => known,
      quietHours: async () => undefined,
      owners: async () => ["me"],
      notify: async (_owner, note) => {
        sent.push(note.title);
        return true;
      },
      now: () => at("2026-10-22T17:10:00Z"),
    });
    await headsUps.due();
    return { sent, look: (await headsUps.current("me")).look };
  };
  assert.deepEqual(await make(false), { sent: [], look: "no-zone" });
  assert.equal((await make(true)).sent.length, 1);
});

test("Undo gives a kind back to the level: null clears its own setting", async () => {
  const { headsUps } = await setUp("2026-10-22T17:10:00Z");
  await headsUps.update("me", { kinds: { leave_for: false } });
  assert.equal((await headsUps.settings("me")).kinds.leave_for, false);
  await headsUps.update("me", { kinds: { leave_for: null } });
  assert.equal("leave_for" in (await headsUps.settings("me")).kinds, false);
  assert.equal((await headsUps.current("me")).kinds.find((k) => k.kind === "leave_for")?.on, true);
});

test("the tools say when nothing is being watched, and refuse email the server can't send", async () => {
  const db = await createStore();
  const headsUps = new HeadsUps(db, {
    events: async () => ({ events: [], checked: [], failed: [] }),
    timeZone: async () => ZONE,
    quietHours: async () => undefined,
    owners: async () => ["me"],
    notify: async () => true,
    now: () => at("2026-10-22T17:10:00Z"),
  });
  await headsUps.due();
  const [mine, set] = headsUpToolSpecs(headsUps, "me");
  assert.ok(mine && set);
  const seen = (await mine.execute({})) as { next: string; look: string };
  assert.equal(seen.look, "none");
  assert.match(seen.next, /No calendar is connected/);
  const changed = (await set.execute({ email: true })) as { email: boolean; next: string };
  assert.equal(changed.email, false);
  assert.match(changed.next, /Email isn’t available yet/);
});

test("the intro and the screen know when no calendar is connected, and whether email works", async () => {
  const { headsUps, setCalendar } = await setUp("2026-10-22T17:10:00Z");
  assert.equal((await headsUps.current("me")).calendar, true, "not known yet: no accusation");
  setCalendar({ events: [], checked: [], failed: [] });
  await headsUps.due();
  const state = await headsUps.current("me");
  assert.equal(state.calendar, false);
  assert.equal(state.email, true);
  await headsUps.update("me", { on: false });
  assert.deepEqual((await headsUps.current("me")).open, [], "off shows nothing");
});

test("Got it closes a heads-up and it isn't said again", async () => {
  const { headsUps, sent, at: move } = await setUp("2026-10-22T17:10:00Z");
  await headsUps.due();
  const first = (await headsUps.current("me")).open[0];
  assert.ok(first);
  await headsUps.done("me", first.id);
  assert.equal((await headsUps.current("me")).open.length, 0);
  move("2026-10-22T17:20:00Z");
  await headsUps.due();
  assert.equal(sent.length, 1);
  await assert.rejects(headsUps.done("me", "0".repeat(32)), /already been cleared/);
});

test("past the day's limit it's still a card and a bell entry, but no phone buzz", async () => {
  // Nine different things away from the desk at once, plus every pair overlapping.
  const crowd = Array.from({ length: 9 }, (_, i) =>
    event(`Errand ${i + 1}`, "18:00", "19:00", { location: `${i + 1} Main St` }),
  );
  const { headsUps, sent } = await setUp("2026-10-22T17:15:00Z", crowd);
  await headsUps.due();
  const pushed = sent.filter((s) => s.push).length;
  assert.equal(pushed, 8, "normal chattiness: eight phone notifications a day");
  assert.ok(sent.length > 8);
  const { open, more } = await headsUps.current("me");
  assert.equal(open.length, 3);
  assert.ok(more > 0);
});

test("email is for what can wait: an overlap yes, 'leave now' never", async () => {
  const meeting = event("Parent conference", "18:00", "19:00");
  const board = event("Board call", "18:30", "19:30");
  // 12:45-1:00 pm at the dentist, right before the conference at 1:00.
  const quick = event("Dentist", "17:45", "18:00");
  const { headsUps, emails, sent } = await setUp("2026-10-22T17:15:00Z", [quick, meeting, board]);
  await headsUps.update("me", { channels: { email: true } });
  await headsUps.due();
  assert.ok(sent.some((s) => /^(Leave|Time to leave) for Dentist/.test(s.title)));
  assert.ok(sent.some((s) => s.title.startsWith("Tight between")));
  assert.deepEqual(
    emails.map((e) => e.title),
    ["Parent conference and Board call overlap"],
  );
});

test("push can be turned off and the bell still gets it", async () => {
  const { headsUps, sent } = await setUp("2026-10-22T17:10:00Z");
  await headsUps.update("me", { channels: { push: false } });
  await headsUps.due();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.push, false);
});

test("settings: defaults are on, normal, 30 minutes; bad values are refused", async () => {
  const { headsUps } = await setUp("2026-10-22T17:10:00Z");
  const settings = await headsUps.settings("me");
  assert.deepEqual(
    [settings.on, settings.chatty, settings.travelBuffer, settings.introSeen],
    [true, "normal", 30, false],
  );
  assert.equal((await headsUps.current("me")).intro, true);
  await headsUps.update("me", { introSeen: true, travelBuffer: 45 });
  const after = await headsUps.current("me");
  assert.equal(after.intro, false);
  assert.equal(after.settings.travelBuffer, 45);
  await assert.rejects(headsUps.update("me", { travelBuffer: 20 }));
  await assert.rejects(headsUps.update("me", { chatty: "loud" }));
});

test("by voice or chat: ask what's flagged, and change it in plain words", async () => {
  const { headsUps } = await setUp("2026-10-22T17:10:00Z");
  await headsUps.due();
  const [mine, set] = headsUpToolSpecs(headsUps, "me");
  assert.ok(mine && set);
  const seen = (await mine.execute({})) as { open: { title: string }[]; on: boolean };
  assert.equal(seen.on, true);
  assert.deepEqual(
    seen.open.map((o) => o.title),
    ["Leave for Dentist by 12:30 pm"],
  );
  const changed = (await set.execute({
    travelMinutes: 40,
    chatty: "important",
    kind: "overlaps",
    kindOn: false,
  })) as {
    travelMinutes: number;
    kindsOff: string[];
  };
  assert.equal(changed.travelMinutes, 45, "the nearest of 15, 30, 45 and 60");
  assert.deepEqual(changed.kindsOff.includes("Two things at the same time"), true);
  const unknown = (await set.execute({ kind: "weather" })) as { error?: string };
  assert.match(unknown.error ?? "", /don’t know a heads-up called/);
  assert.equal(
    (await headsUps.settings("me")).introSeen,
    true,
    "saying so counts as having seen the intro",
  );
});

test("reconnecting a calendar that couldn't be read is looked at straight away", async () => {
  const { headsUps, reads, setCalendar, at: move } = await setUp("2026-10-22T17:10:00Z");
  setCalendar(new Error("sign-in expired"));
  await headsUps.due();
  assert.equal((await headsUps.current("me")).look, "failed");
  setCalendar({ events: [DENTIST, ZOOM], checked: ["googlecalendar"], failed: [] });
  move("2026-10-22T17:11:00Z");
  await headsUps.due();
  assert.equal(reads.length, 1, "backing off");
  await headsUps.poke("me");
  await headsUps.due();
  assert.equal(reads.length, 2);
  assert.equal((await headsUps.current("me")).look, "ok");
});
