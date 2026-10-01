import assert from "node:assert/strict";
import { test } from "node:test";
import type { TodayCalendar } from "../apps/server/src/calendar-today.ts";
import { calendarToolSpec, withOwnCalendar } from "../apps/server/src/day-tools.ts";
import type { CalendarEvent } from "../packages/domain/src/index.ts";

// 11 pm on 1 October in Chicago (already 2 October in UTC).
const NOW = Date.parse("2026-10-02T04:00:00Z");

test("look_at_calendar reads the person's own days, in their time zone, with reminders due then", async () => {
  const asked: { from: string; to: string }[] = [];
  const tool = calendarToolSpec(
    {
      between: async (_owner, from, to) => {
        asked.push({ from, to });
        return {
          events: [
            {
              id: "e1",
              title: "Dentist",
              start: "2026-10-01T21:00:00Z",
              end: "2026-10-01T22:00:00Z",
              allDay: false,
              app: "outlook",
            },
          ],
          checked: ["outlook"],
          failed: ["googlecalendar"],
        };
      },
      timeZone: async () => "America/Chicago",
      reminders: async () => [
        { text: "Call mom", dueAt: "2026-10-01T23:30:00Z" },
        { text: "Tomorrow's", dueAt: "2026-10-02T15:00:00Z" },
      ],
      now: () => NOW,
    },
    "owner",
  );
  const today = await tool.execute({});
  // "Today" is Chicago's 1 October, not UTC's 2 October.
  assert.equal(today.from, "2026-10-01");
  assert.deepEqual(asked[0], { from: "2026-10-01T05:00:00.000Z", to: "2026-10-02T05:00:00.000Z" });
  assert.deepEqual(today.reminders, [{ text: "Call mom", dueAt: "2026-10-01T23:30:00Z" }]);
  assert.deepEqual(today.couldNotRead, ["googlecalendar"]);
  assert.match(today.shown ?? "", /on the person's screen as a card/);
  const week = await tool.execute({ date: "2026-10-05", days: 7 });
  assert.deepEqual(asked[1], { from: "2026-10-05T05:00:00.000Z", to: "2026-10-12T05:00:00.000Z" });
  assert.equal(week.days, 7);
  // Nothing on: it doesn't claim a card is on screen (a call shows none for an empty day).
  const empty = await calendarToolSpec(
    {
      between: async () => ({ events: [], checked: [], failed: [] }),
      timeZone: async () => "UTC",
      now: () => NOW,
    },
    "owner",
  ).execute({});
  assert.equal(empty.shown, undefined);
  assert.match(empty.note ?? "", /No calendar app is connected/);
});

test("in a background job, look_at_calendar claims no card and asks with ask_user", async () => {
  const job = calendarToolSpec(
    {
      between: async () => ({
        events: [
          {
            id: "e1",
            title: "Dentist",
            start: "2026-10-01T21:00:00Z",
            end: "2026-10-01T22:00:00Z",
            allDay: false,
            app: "outlook",
          },
        ],
        checked: ["outlook"],
        failed: ["googlecalendar"],
      }),
      timeZone: async () => "America/Chicago",
      now: () => NOW,
    },
    "owner",
    { background: true },
  );
  assert.doesNotMatch(job.description, /shown|card/);
  const day = await job.execute({});
  assert.equal(day.events.length, 1);
  assert.equal(day.shown, undefined);
  assert.match(day.next ?? "", /ask_user/);
  assert.doesNotMatch(day.next ?? "", /Connect card/);
});

test("the app's own calendar joins the calendar apps, each meeting once, all-day first", () => {
  const apps: TodayCalendar = {
    events: [
      {
        id: "o1",
        title: "Standup",
        start: "2026-10-01T15:00:00Z",
        end: "2026-10-01T15:15:00Z",
        allDay: false,
        app: "outlook",
      },
    ],
    checked: ["outlook"],
    failed: [],
  };
  const own = (id: string, title: string, start: string, allDay = false): CalendarEvent => ({
    id,
    calendarId: "primary",
    title,
    start,
    end: start,
    allDay,
    timeZone: "UTC",
    location: "",
    description: "",
    attendees: [],
  });
  const merged = withOwnCalendar(apps, [
    own("g1", " standup ", "2026-10-01T15:00:00.000Z"),
    own("g2", "Lunch", "2026-10-01T12:00:00Z"),
    own("g3", "Mom's birthday", "2026-10-01", true),
  ]);
  assert.deepEqual(
    merged.events.map((event) => `${event.title}:${event.app}`),
    ["Mom's birthday:calendar", "Lunch:calendar", "Standup:outlook"],
  );
  assert.deepEqual(merged.checked, ["outlook", "calendar"]);
  assert.deepEqual(withOwnCalendar(apps, "failed").failed, ["calendar"]);
  assert.equal(withOwnCalendar(apps, undefined), apps);
});
