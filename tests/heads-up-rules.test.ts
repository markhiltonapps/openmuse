import assert from "node:assert/strict";
import { test } from "node:test";
import type { DayEvent } from "../apps/server/src/calendar-today.ts";
import {
  clock,
  headsUpsFor,
  inQuiet,
  joinLink,
  parseQuietHours,
  placeOf,
  quietEnds,
  type RuleContext,
} from "../apps/server/src/heads-up-rules.ts";

const ZONE = "America/Chicago";
// 11:00 am in Chicago (CDT, UTC-5) on 22 Oct 2026.
const NOW = Date.parse("2026-10-22T16:00:00Z");
const ctx = (patch: Partial<RuleContext> = {}): RuleContext => ({
  now: NOW,
  buffer: 30,
  timeZone: ZONE,
  chatty: "normal",
  ...patch,
});
let n = 0;
const event = (
  title: string,
  start: string,
  end: string,
  extra: Partial<DayEvent> = {},
): DayEvent => ({
  id: `e${++n}`,
  title,
  start: `2026-10-22T${start}:00Z`,
  end: `2026-10-22T${end}:00Z`,
  allDay: false,
  app: "googlecalendar",
  ...extra,
});
// 1:00 pm to 2:00 pm and 2:30 pm to 3:00 pm in Chicago.
const dentist = () => event("Dentist", "18:00", "19:00");
const zoom = () => event("Zoom with Dana", "19:30", "20:00");
const kinds = (events: DayEvent[], patch?: Partial<RuleContext>) =>
  headsUpsFor(events, ctx(patch)).map((h) => h.kind);

test("places: a link or call is online, a dentist is away, a room is the desk", () => {
  assert.equal(placeOf({ title: "Zoom with Dana" }), "online");
  assert.equal(
    placeOf({ title: "Sync", location: "https://meet.google.com/abc-defg-hij" }),
    "online",
  );
  assert.equal(placeOf({ title: "Dentist" }), "away");
  assert.equal(placeOf({ title: "Dana", location: "412 Main St, Austin" }), "away");
  assert.equal(placeOf({ title: "Planning", location: "Conference Room B" }), "desk");
  assert.equal(placeOf({ title: "Planning", location: "Home" }), "desk");
  assert.equal(placeOf({ title: "Planning" }), "desk");
  assert.equal(
    joinLink({ title: "Sync", location: "Join: https://us02web.zoom.us/j/123456789?pwd=x." }),
    "https://us02web.zoom.us/j/123456789?pwd=x",
  );
});

test("places: lunch or a gym need a real place; an office floor or a call to a dentist aren't trips", () => {
  assert.equal(placeOf({ title: "Lunch with the team" }), "desk");
  assert.equal(placeOf({ title: "Lunch with Dana", location: "Cafe Roma, 12 Main St" }), "away");
  assert.equal(placeOf({ title: "Interview" }), "desk");
  assert.equal(placeOf({ title: "Planning", location: "HQ 3rd floor" }), "desk");
  assert.equal(placeOf({ title: "Dr. Lee review" }), "desk");
  assert.equal(placeOf({ title: "Call with Dana" }), "online");
  assert.equal(placeOf({ title: "Dentist: call to confirm" }), "online");
  assert.equal(placeOf({ title: "Doctor video visit" }), "online");
  assert.equal(placeOf({ title: "Therapist (telehealth)" }), "online");
  assert.equal(placeOf({ title: "Dentist" }), "away");
  assert.equal(placeOf({ title: "Standup", location: "https://chime.aws/123456" }), "online");
  assert.equal(placeOf({ title: "Sync", location: "https://example.org/room/7" }), "online");
});

test("long titles are cut, short gaps are plural-safe, and another day is named", () => {
  const long = event("A".repeat(90), "18:00", "19:00", { location: "12 Main St" });
  const next = event("Zoom with Dana", "19:01", "20:00");
  const tight = headsUpsFor([long, next], ctx()).find((h) => h.kind === "tight_gap");
  assert.ok(tight);
  assert.ok(tight.title.length < 100);
  assert.match(tight.body, /That’s 1 minute, and getting there usually takes about 30 minutes\./);
  const tomorrowA = event("Parent conference", "18:00", "19:00");
  const tomorrowB = { ...event("Board call", "18:30", "19:30") };
  const shift = (e: DayEvent): DayEvent => ({
    ...e,
    start: e.start.replace("22T", "23T"),
    end: e.end.replace("22T", "23T"),
  });
  const clash = headsUpsFor([shift(tomorrowA), shift(tomorrowB)], ctx()).find(
    (h) => h.kind === "overlap",
  );
  assert.match(clash?.body ?? "", /^On Fri, Oct 23, Parent conference/);
  assert.match(clash?.body ?? "", /overlap from 1:30 pm to 2:00 pm\./);
});

test("the dentist and the Zoom: head back as soon as the appointment ends", () => {
  const found = headsUpsFor([dentist(), zoom()], ctx());
  const leaveBy = found.find((h) => h.kind === "leave_by");
  assert.ok(leaveBy, "a heads-up about getting back");
  assert.equal(leaveBy.title, "Head back right after Dentist");
  assert.match(leaveBy.body, /Dentist ends at 2:00 pm and Zoom with Dana starts at 2:30 pm/);
  assert.match(leaveBy.body, /as soon as it ends/);
  assert.match(leaveBy.body, /about 30 minutes/);
  assert.equal(leaveBy.expiresAt, "2026-10-22T19:30:00Z", "useless once the Zoom has started");
  assert.ok(
    found.some((h) => h.kind === "leave_for"),
    "and one about leaving for the dentist",
  );
  assert.equal(found.filter((h) => h.kind === "tight_gap").length, 0);
});

test("leaving for something away: buffer before the start, said 20 minutes ahead", () => {
  const [leave] = headsUpsFor([dentist()], ctx()).filter((h) => h.kind === "leave_for");
  assert.ok(leave);
  assert.equal(leave.title, "Leave for Dentist by 12:30 pm");
  assert.equal(leave.showAt, "2026-10-22T17:10:00.000Z");
});

test("more room than the buffer says when the latest departure is", () => {
  const late = event("Zoom with Dana", "20:30", "21:00");
  const [h] = headsUpsFor([dentist(), late], ctx()).filter((x) => x.kind === "leave_by");
  assert.ok(h);
  assert.equal(h.title, "Head back from Dentist by 3:00 pm");
  assert.match(h.body, /Leave by 3:00 pm at the latest/);
});

test("less room than the buffer is a tight gap, with the one to move", () => {
  const close = event("Zoom with Dana", "19:15", "20:00");
  const found = headsUpsFor([dentist(), close], ctx());
  const tight = found.find((h) => h.kind === "tight_gap");
  assert.ok(tight);
  assert.equal(tight.moveTitle, "Zoom with Dana");
  assert.match(tight.body, /That’s 15 minutes/);
  assert.equal(found.filter((h) => h.kind === "leave_by").length, 0);
  // A desk meeting before something away is just as tight.
  const desk = event("Planning", "17:00", "17:50");
  const dentistSoon = event("Dentist", "18:00", "19:00");
  assert.deepEqual(kinds([desk, dentistSoon]), ["tight_gap"]);
});

test("two online or desk meetings need no travel, however close", () => {
  const a = event("Standup", "17:00", "17:30");
  const b = event("Planning", "17:30", "18:00");
  assert.deepEqual(kinds([a, b]), []);
});

test("away to away needs travel unless it's the same place", () => {
  const a = event("Dentist", "18:00", "19:00", { location: "12 Oak St" });
  const same = event("Pharmacy", "19:05", "19:20", { location: "12 Oak St" });
  const other = event("Pharmacy", "19:05", "19:20", { location: "400 Elm St" });
  assert.equal(kinds([a, same]).includes("tight_gap"), false);
  assert.equal(kinds([a, other]).includes("tight_gap"), true);
});

test("overlapping events are said once, and the same event from two calendars is one", () => {
  const a = event("Parent conference", "18:00", "19:00");
  const b = event("Board call", "18:30", "19:30");
  const found = headsUpsFor([a, b], ctx()).filter((h) => h.kind === "overlap");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.moveTitle, "Board call");
  assert.match(found[0]?.body ?? "", /Parent conference \(1:00 pm to 2:00 pm\) and Board call/);
  const twin = { ...a, id: "other-calendar", app: "outlook" };
  assert.equal(kinds([a, twin]).includes("overlap"), false, "the same event on two calendars");
});

test("a meeting with a link says it's about to start; without one only when chatty", () => {
  const withLink = event("Standup", "17:00", "17:30", {
    location: "https://meet.google.com/abc-defg-hij",
  });
  const [soon] = headsUpsFor([withLink], ctx()).filter((h) => h.kind === "starting_soon");
  assert.ok(soon);
  assert.equal(soon.joinUrl, "https://meet.google.com/abc-defg-hij");
  assert.equal(soon.showAt, "2026-10-22T16:50:00.000Z");
  const plain = event("Planning", "17:00", "17:30");
  assert.equal(kinds([plain]).includes("starting_soon"), false);
  assert.equal(kinds([plain], { chatty: "chatty" }).includes("starting_soon"), true);
});

test("four meetings back to back is a long stretch with no break", () => {
  const day = [
    event("One", "15:00", "15:30"),
    event("Two", "15:35", "16:05"),
    event("Three", "16:10", "16:40"),
    event("Four", "16:45", "17:15"),
  ];
  const found = headsUpsFor(day, ctx({ now: Date.parse("2026-10-22T13:00:00Z") }));
  const stretch = found.find((h) => h.kind === "no_break");
  assert.ok(stretch);
  assert.equal(stretch.urgency, "digest");
  assert.equal(stretch.eventIds.length, 4);
  assert.equal(
    kinds(day.slice(0, 3), { now: Date.parse("2026-10-22T13:00:00Z") }).includes("no_break"),
    false,
  );
});

test("finished events, all-day events and nonsense times are ignored", () => {
  const over = event("Dentist", "13:00", "14:00");
  const allDay = event("Holiday", "00:00", "23:59", { allDay: true });
  const broken = { ...event("Odd", "18:00", "19:00"), start: "not a time" };
  assert.deepEqual(kinds([over, allDay, broken]), []);
});

test("an event that moves is a new heads-up; the same day read again is not", () => {
  const [d, z] = [dentist(), zoom()];
  const leaveBy = (events: DayEvent[]) =>
    headsUpsFor(events, ctx()).find((h) => h.kind === "leave_by");
  const was = leaveBy([d, z]);
  const moved = leaveBy([d, { ...z, start: "2026-10-22T19:45:00Z" }]);
  assert.ok(was && moved);
  assert.notEqual(was.id, moved.id);
  assert.equal(leaveBy([d, z])?.id, was.id);
});

test("times read the way people say them", () => {
  assert.equal(clock("2026-10-22T19:00:00Z", ZONE), "2:00 pm");
  assert.equal(clock("2026-10-22T14:05:00Z", ZONE), "9:05 am");
});

test("quiet hours: said in words, with a default, across midnight", () => {
  assert.deepEqual(parseQuietHours("9 pm to 8 am"), { start: 21 * 60, end: 8 * 60 });
  assert.deepEqual(parseQuietHours("10pm-7"), { start: 22 * 60, end: 7 * 60 });
  assert.deepEqual(parseQuietHours("9 to 8 am"), { start: 21 * 60, end: 8 * 60 });
  assert.deepEqual(parseQuietHours("never"), { start: 22 * 60, end: 7 * 60 });
  assert.deepEqual(parseQuietHours(undefined), { start: 22 * 60, end: 7 * 60 });
  const window = parseQuietHours("9 pm to 8 am");
  // 10 pm and 3 am in Chicago are quiet; 11 am is not.
  assert.equal(inQuiet(Date.parse("2026-10-23T03:00:00Z"), ZONE, window), true);
  assert.equal(inQuiet(Date.parse("2026-10-22T08:00:00Z"), ZONE, window), true);
  assert.equal(inQuiet(NOW, ZONE, window), false);
  // From 10 pm it ends at 8 am the next morning.
  const ends = quietEnds(Date.parse("2026-10-23T03:00:00Z"), ZONE, window);
  assert.equal(new Date(ends).toISOString(), "2026-10-23T13:00:00.000Z");
});
