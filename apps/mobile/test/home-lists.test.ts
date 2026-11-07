import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clockWords,
  comingUp,
  countWords,
  recentFew,
  scheduleWords,
  whenWords,
} from "../src/home-lists.ts";

test("a routine's schedule in plain words", () => {
  const now = new Date(2026, 10, 7, 9, 0);
  assert.equal(scheduleWords({ time: "07:30", days: [1, 2, 3, 4, 5] }, now), "Weekdays at 7:30 am");
  assert.equal(
    scheduleWords({ time: "20:00", days: [0, 1, 2, 3, 4, 5, 6] }, now),
    "Every day at 8:00 pm",
  );
  assert.equal(scheduleWords({ time: "09:15", days: [6, 0] }, now), "Weekends at 9:15 am");
  assert.equal(scheduleWords({ time: "18:00", days: [2] }, now), "Tuesdays at 6:00 pm");
  assert.equal(scheduleWords({ time: "18:00", days: [1, 3] }, now), "Mon, Wed at 6:00 pm");
  assert.match(
    scheduleWords({ time: "09:00", days: [], date: "2026-11-09" }, now),
    /^Once, Mon.*Nov.*9 at 9:00 am$/,
  );
  assert.equal(clockWords("00:05"), "12:05 am");
  assert.equal(clockWords("12:00"), "12:00 pm");
  assert.equal(clockWords("12:30"), "12:30 pm");
});

test("coming up is the enabled routines, soonest first, three at most", () => {
  const rows = comingUp([
    { enabled: true, nextRunAt: "2026-11-09T14:00:00Z" },
    { enabled: false, nextRunAt: "2026-11-07T10:00:00Z" },
    { enabled: true, nextRunAt: "2026-11-08T12:00:00Z" },
    { enabled: true, nextRunAt: "2026-11-10T12:00:00Z" },
    { enabled: true, nextRunAt: "2026-11-11T12:00:00Z" },
  ]);
  assert.deepEqual(
    rows.map((r) => r.nextRunAt),
    ["2026-11-08T12:00:00Z", "2026-11-09T14:00:00Z", "2026-11-10T12:00:00Z"],
  );
});

test("recent updates: unread first, then newest", () => {
  const rows = recentFew([
    { read: true, createdAt: "2026-11-07T08:00:00Z" },
    { read: false, createdAt: "2026-11-05T08:00:00Z" },
    { read: true, createdAt: "2026-11-06T08:00:00Z" },
    { read: false, createdAt: "2026-11-06T09:00:00Z" },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.read, r.createdAt]),
    [
      [false, "2026-11-06T09:00:00Z"],
      [false, "2026-11-05T08:00:00Z"],
      [true, "2026-11-07T08:00:00Z"],
    ],
  );
});

test("when an update arrived, briefly", () => {
  const now = new Date(2026, 10, 7, 9, 0);
  const at = (d: Date) => d.toISOString();
  assert.equal(whenWords(at(new Date(2026, 10, 7, 8, 59, 30)), now), "Just now");
  assert.equal(whenWords(at(new Date(2026, 10, 7, 8, 40)), now), "20 min ago");
  assert.match(whenWords(at(new Date(2026, 10, 7, 7, 5)), now), /^7:05/);
  assert.match(whenWords(at(new Date(2026, 10, 6, 18, 12)), now), /^Yesterday 6:12/);
  assert.equal(whenWords(at(new Date(2026, 10, 3, 18, 12)), now), "Tuesday");
  assert.match(whenWords(at(new Date(2026, 9, 20, 18, 12)), now), /Oct/);
  assert.equal(whenWords("not a date", now), "");
});

test("small counts are words", () => {
  assert.equal(countWords(0), "No");
  assert.equal(countWords(2), "Two");
  assert.equal(countWords(14), "14");
});
