import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppConnector, AppTool } from "../apps/server/src/apps.ts";
import { CalendarToday, eventsIn, rangeArguments } from "../apps/server/src/calendar-today.ts";

const ZONE = "America/Chicago";
const OUTLOOK_VIEW: AppTool = {
  slug: "OUTLOOK_GET_CALENDAR_VIEW",
  name: "Get calendar view",
  description: "",
  app: "outlook",
  readOnly: true,
  parameters: {
    properties: { start_datetime: {}, end_datetime: {}, top: {}, user_id: {} },
    required: ["start_datetime", "end_datetime"],
  },
};

test("a range action's own parameter names are filled in, and ones it can't fill rule it out", () => {
  assert.deepEqual(rangeArguments(OUTLOOK_VIEW, "A", "B"), {
    start_datetime: "A",
    end_datetime: "B",
    top: 50,
  });
  assert.deepEqual(
    rangeArguments(
      {
        app: "googlecalendar",
        parameters: {
          properties: {
            calendarId: {},
            timeMin: {},
            timeMax: {},
            singleEvents: {},
            orderBy: {},
            maxResults: {},
          },
        },
      },
      "A",
      "B",
    ),
    {
      calendarId: "primary",
      timeMin: "A",
      timeMax: "B",
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    },
  );
  assert.equal(
    rangeArguments(
      { app: "outlook", parameters: { properties: { filter: {}, top: {} } } },
      "A",
      "B",
    ),
    undefined,
  );
  assert.equal(
    rangeArguments(
      {
        app: "outlook",
        parameters: { properties: { start: {}, end: {}, event_id: {} }, required: ["event_id"] },
      },
      "A",
      "B",
    ),
    undefined,
  );
});

test("Outlook and Google Calendar answers both read as today's events", () => {
  const outlook = eventsIn(
    {
      data: {
        value: [
          {
            id: "o1",
            subject: "Budget review",
            start: { dateTime: "2026-09-28T19:00:00.0000000", timeZone: "UTC" },
            end: { dateTime: "2026-09-28T19:30:00.0000000", timeZone: "UTC" },
            location: { displayName: "Teams" },
          },
          {
            subject: "Cancelled sync",
            isCancelled: true,
            start: { dateTime: "2026-09-28T20:00:00", timeZone: "UTC" },
          },
          {
            id: "o2",
            subject: "Team offsite",
            isAllDay: true,
            start: { dateTime: "2026-09-28T00:00:00.0000000", timeZone: "UTC" },
            end: { dateTime: "2026-09-29T00:00:00.0000000", timeZone: "UTC" },
          },
        ],
      },
    },
    "outlook",
    ZONE,
  );
  assert.deepEqual(
    outlook.map((e) => [e.title, e.start, e.allDay, e.location]),
    [
      ["Budget review", "2026-09-28T19:00:00.000Z", false, "Teams"],
      ["Team offsite", "2026-09-28", true, undefined],
    ],
  );
  const google = eventsIn(
    {
      items: [
        {
          id: "g1",
          summary: "Dentist",
          start: { dateTime: "2026-09-28T15:30:00-05:00" },
          end: { dateTime: "2026-09-28T16:30:00-05:00" },
        },
        { summary: "Mom's birthday", start: { date: "2026-09-28" }, end: { date: "2026-09-29" } },
        { summary: "Old", status: "cancelled", start: { date: "2026-09-28" } },
      ],
    },
    "googlecalendar",
    ZONE,
  );
  assert.deepEqual(
    google.map((e) => [e.title, e.start, e.allDay]),
    [
      ["Dentist", "2026-09-28T20:30:00.000Z", false],
      ["Mom's birthday", "2026-09-28", true],
    ],
  );
  // A wall-clock time in a named zone is read in that zone.
  const [named] = eventsIn(
    { value: [{ subject: "Call", start: { dateTime: "2026-09-28T09:00:00", timeZone: ZONE } }] },
    "outlook",
    "UTC",
  );
  assert.equal(named?.start, "2026-09-28T14:00:00.000Z");
});

test("today's events come from each connected calendar app, for the person's own day", async () => {
  const calls: { slug: string; args: Record<string, unknown> }[] = [];
  let broken = false;
  const apps = {
    connections: async () => [
      { app: "outlook", name: "Outlook", connected: true },
      { app: "slack", name: "Slack", connected: true },
    ],
    tool: async (_owner: string, slug: string) => {
      if (slug === "OUTLOOK_GET_CALENDAR_VIEW") return OUTLOOK_VIEW;
      throw new Error("Unknown app action");
    },
    search: async () => ({ tools: [], apps: [], guidance: [] }),
    execute: async (_owner: string, slug: string, args: Record<string, unknown>) => {
      calls.push({ slug, args });
      if (broken) throw new Error("The sign-in to outlook has expired");
      return {
        value: [
          {
            subject: "Standup",
            start: { dateTime: "2026-09-28T14:00:00", timeZone: "UTC" },
            end: { dateTime: "2026-09-28T14:15:00", timeZone: "UTC" },
          },
          // Yesterday's, returned anyway: left out.
          {
            subject: "Yesterday",
            start: { dateTime: "2026-09-27T14:00:00", timeZone: "UTC" },
            end: { dateTime: "2026-09-27T15:00:00", timeZone: "UTC" },
          },
        ],
      };
    },
  } as unknown as AppConnector;
  let now = Date.parse("2026-09-28T13:00:00Z"); // 8 am in Houston
  const calendar = new CalendarToday(
    apps,
    async () => ZONE,
    () => now,
  );
  const day = await calendar.today("me");
  assert.deepEqual(day.checked, ["outlook"], "only calendar apps are asked");
  assert.deepEqual(
    day.events.map((e) => e.title),
    ["Standup"],
  );
  assert.deepEqual(calls[0]?.args, {
    start_datetime: "2026-09-28T05:00:00.000Z",
    end_datetime: "2026-09-29T05:00:00.000Z",
    top: 50,
  });
  // Kept a few minutes; a failure says which calendar couldn't be read.
  await calendar.today("me");
  assert.equal(calls.length, 1);
  broken = true;
  now += 11 * 60 * 1000;
  const failed = await calendar.today("me");
  assert.deepEqual(failed.failed, ["outlook"]);
  assert.deepEqual(failed.events, []);
  // No app connector (sample mode): nothing to check.
  assert.deepEqual(await new CalendarToday(undefined, async () => ZONE).today("me"), {
    events: [],
    checked: [],
    failed: [],
  });
});
