import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type BaseEvent, EventType } from "@ag-ui/core";
import { createStore } from "../apps/server/src/db.ts";
import { showOnWatchToolSpec } from "../apps/server/src/device-card-tools.ts";
import {
  DEVICE_SCREEN,
  deviceCardFrom,
  type VoiceBrain,
  voiceAnswer,
  whereShown,
} from "../apps/server/src/voice-brain.ts";
import {
  buildDeviceCard,
  type DeviceCard,
  deviceWire,
  plainForDevice,
  weatherDeviceCard,
  weatherIconFor,
} from "../packages/domain/src/device-card.ts";

test("the weather card is built from loose facts, kept to what the device can draw", () => {
  const card = weatherDeviceCard({
    place: "Houston, Texas",
    temp: 90.4,
    feels: 100,
    sky: "Mostly sunny",
    icon: "sun-cloud",
    high: 91,
    low: 74,
    rain: 40,
    alert: "Heat Advisory",
  });
  assert.deepEqual(card, {
    kind: "weather",
    place: "Houston",
    temp: 90,
    feels: 100,
    sky: "Mostly sunny",
    icon: "sun-cloud",
    high: 91,
    low: 74,
    rain: 40,
    alert: "Heat Advisory",
  });
  // "Feels like" only when it differs by 3 or more; no rain chance means no rain field; negative temperatures stand.
  assert.deepEqual(
    weatherDeviceCard({ place: "Fargo", temp: -4, feels: -3, sky: "Clear", icon: "moon", rain: 0 }),
    { kind: "weather", place: "Fargo", temp: -4, sky: "Clear", icon: "moon" },
  );
  // Nonsense doesn't make a card, and an unknown picture falls back to a cloud.
  assert.equal(weatherDeviceCard(undefined), undefined);
  assert.equal(weatherDeviceCard({ temp: "hot", sky: "Sunny" }), undefined);
  assert.equal(weatherDeviceCard({ temp: 70, sky: "" }), undefined);
  assert.equal(weatherDeviceCard({ temp: 999, sky: "Sunny" }), undefined);
  assert.equal(weatherDeviceCard({ temp: 70, sky: "Windy", icon: "tornado" })?.icon, "cloud");
});

test("text for the device is plain ASCII on one line, cut to fit", () => {
  assert.equal(plainForDevice("Café  déjà\nvu", 40), "Cafe deja vu");
  assert.equal(plainForDevice("Sunny ☀️ and warm", 40), "Sunny and warm");
  assert.equal(plainForDevice("A very long forecast sentence", 10), "A very lo.");
  assert.equal(plainForDevice(42, 10), "");
  assert.equal(
    weatherDeviceCard({ temp: 70, sky: "Sunny", place: "São Paulo, Brazil" })?.place,
    "Sao Paulo",
  );
});

test("the weather picture follows the emoji the forecast already picks by day or night", () => {
  const picks: [string, string][] = [
    ["☀️", "sun"],
    ["🌙", "moon"],
    ["🌤️", "sun-cloud"],
    ["⛅", "partly"],
    ["🌥️", "partly"],
    ["☁️", "cloud"],
    ["🌦️", "sun-rain"],
    ["🌧️", "rain"],
    ["⛈️", "storm"],
    ["🌨️", "snow"],
    ["🌫️", "fog"],
    ["🌬️", "wind"],
    ["?", "cloud"],
  ];
  for (const [emoji, icon] of picks) assert.equal(weatherIconFor(emoji), icon, emoji);
});

const weatherResult = {
  place: "Houston, Texas",
  now: "72°F, partly cloudy",
  deviceCard: {
    place: "Houston, Texas",
    temp: 72,
    feels: 72,
    sky: "Partly cloudy",
    icon: "partly",
    high: 80,
    low: 65,
    rain: 30,
  },
};

test("only a weather look-up gives a card, and only when it has the numbers", () => {
  assert.equal(deviceCardFrom("get_weather", JSON.stringify(weatherResult))?.kind, "weather");
  // "Unavailable" and other tools: nothing to draw, so nothing is claimed.
  assert.equal(
    deviceCardFrom("get_weather", JSON.stringify({ unavailable: "Ask which city." })),
    undefined,
  );
  assert.equal(deviceCardFrom("search_web", JSON.stringify(weatherResult)), undefined);
  assert.equal(deviceCardFrom("get_weather", "not json"), undefined);
});

async function answerFixture(events: BaseEvent[]) {
  const db = await createStore();
  const brain: VoiceBrain = {
    db,
    now: () => Date.parse("2026-10-01T19:00:00Z"),
    run: () => {
      throw new Error("replaced below");
    },
    timeZone: async () => "America/Chicago",
    chat: async () => [],
    name: async () => "Neddy",
  } as unknown as VoiceBrain;
  const { Observable } = await import("rxjs");
  brain.run = () =>
    new Observable<BaseEvent>((subscriber) => {
      for (const event of events) subscriber.next(event);
      subscriber.complete();
    });
  return { brain, db };
}
const toolEvents = (id: string, name: string, result: unknown): BaseEvent[] => [
  { type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: name } as BaseEvent,
  { type: EventType.TOOL_CALL_END, toolCallId: id } as BaseEvent,
  {
    type: EventType.TOOL_CALL_RESULT,
    toolCallId: id,
    messageId: randomUUID(),
    content: JSON.stringify(result),
  } as BaseEvent,
];

test("on a device call the weather look-up sends its card; on other calls nothing is sent and the screen is described truly", async () => {
  const { brain, db } = await answerFixture([
    ...toolEvents("w1", "get_weather", weatherResult),
    {
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId: "r",
      delta: "It's 72 and partly cloudy.",
    } as BaseEvent,
  ]);
  const base = {
    owner: "owner",
    sessionId: "s1",
    delegationId: "d1",
    turns: [{ role: "user" as const, text: "What's the weather?" }],
    progress: () => {},
    signal: new AbortController().signal,
  };
  const cards: DeviceCard[] = [];
  const said = await voiceAnswer(brain)({ ...base, device: true, card: (c) => cards.push(c) });
  assert.equal(said, "It's 72 and partly cloudy.");
  // The watch is told a look-up started (Neddy reads his book), gets the weather card, and is told it ended.
  assert.deepEqual(
    cards.map((c) => (c.kind === "lookup" ? `lookup ${c.on ? "on" : "off"}` : c.kind)),
    ["lookup on", "weather", "lookup off"],
  );
  const first = cards.find((c) => c.kind === "weather");
  if (first?.kind !== "weather") throw new Error("not a weather card");
  assert.equal(first.temp, 72);
  assert.equal(first.place, "Houston");

  // Not a device call: no card goes anywhere (the app's call screen has no weather card yet).
  const other: DeviceCard[] = [];
  await voiceAnswer(brain)({ ...base, card: (c) => other.push(c) });
  assert.deepEqual(other, []);

  // The device is described as it is: weather only, never "on their screen" for anything else.
  assert.match(DEVICE_SCREEN, /one card at a time/);
  assert.match(DEVICE_SCREEN, /show_on_watch/);
  assert.match(DEVICE_SCREEN, /pass place/);
  assert.notEqual(DEVICE_SCREEN, whereShown(false));
  await db.close();
});

test("cards the agent makes: a score, one headline fact, a short list; anything else is turned back", () => {
  const score = buildDeviceCard({
    kind: "score",
    league: "NBA",
    status: "Q3 4:21",
    away: { name: "Lakers", score: 78 },
    home: { name: "Golden State Warriors and more", score: 81 },
  });
  assert.deepEqual(score, {
    card: {
      kind: "score",
      league: "NBA",
      status: "Q3 4:21",
      away: { name: "Lakers", score: 78 },
      home: { name: "Golden State Wa.", score: 81 },
    },
  });
  // A game still to come has no scores.
  assert.deepEqual(
    buildDeviceCard({
      kind: "score",
      status: "7:30 PM tonight",
      away: { name: "Celtics" },
      home: { name: "Knicks" },
    }),
    {
      card: {
        kind: "score",
        status: "7:30 PM tonight",
        away: { name: "Celtics" },
        home: { name: "Knicks" },
      },
    },
  );
  assert.ok("error" in buildDeviceCard({ kind: "score", away: { name: "Celtics" } }));

  assert.deepEqual(
    buildDeviceCard({
      kind: "fact",
      label: "AAPL",
      value: "$187.42",
      sub: "+1.2% today",
      tone: "good",
      note: "As of 3:58 PM",
    }),
    {
      card: {
        kind: "fact",
        label: "AAPL",
        value: "$187.42",
        sub: "+1.2% today",
        note: "As of 3:58 PM",
        tone: "good",
      },
    },
  );
  // The degree sign survives (the device's fonts have it at code 127); other symbols are dropped.
  const hot = buildDeviceCard({ kind: "fact", label: "Oven", value: "350°F ✓" });
  assert.deepEqual(hot, { card: { kind: "fact", label: "Oven", value: "350\x7fF" } });
  assert.ok("error" in buildDeviceCard({ kind: "fact", label: "Only a label" }));

  const list = buildDeviceCard({
    kind: "list",
    title: "Today",
    rows: [
      { label: "Standup", value: "9:00 AM" },
      { label: "Lunch with Sam", value: "12:30 PM" },
      { label: "" },
      { label: "Dentist" },
      { label: "a" },
      { label: "b" },
      { label: "too many" },
    ],
  });
  assert.deepEqual(list, {
    card: {
      kind: "list",
      title: "Today",
      rows: [
        { label: "Standup", value: "9:00 AM" },
        { label: "Lunch with Sam", value: "12:30 PM" },
        { label: "Dentist" },
        { label: "a" },
      ],
    },
  });
  assert.ok("error" in buildDeviceCard({ kind: "list", title: "Empty", rows: [] }));
  assert.ok("error" in buildDeviceCard({ kind: "poem" }));
  assert.ok("error" in buildDeviceCard(undefined));
});

test("the device is sent flat keys only, so its tiny reader can take them", () => {
  assert.deepEqual(
    deviceWire({
      kind: "score",
      league: "NBA",
      status: "Final",
      away: { name: "Lakers", score: 98 },
      home: { name: "Suns" },
    }),
    { kind: "score", league: "NBA", status: "Final", an: "Lakers", as: 98, hn: "Suns" },
  );
  assert.deepEqual(
    deviceWire({
      kind: "list",
      title: "Today",
      rows: [{ label: "Standup", value: "9:00 AM" }, { label: "Dentist" }],
    }),
    { kind: "list", title: "Today", n: 2, l0: "Standup", v0: "9:00 AM", l1: "Dentist" },
  );
  const fact = { kind: "fact" as const, label: "AAPL", value: "$1", tone: "bad" as const };
  assert.deepEqual(deviceWire(fact), fact);
});

test("show_on_watch makes the card only for good facts, and the call sends it to the device", async () => {
  const spec = showOnWatchToolSpec();
  const good = (await spec.execute({
    kind: "fact",
    label: "Drive home",
    value: "24 min",
    tone: "neutral",
  })) as {
    shown: boolean;
    card: { kind: string };
  };
  assert.equal(good.shown, true);
  assert.equal(good.card.kind, "fact");
  const bad = (await spec.execute({ kind: "fact", label: "No value" })) as {
    error: string;
    shown?: boolean;
  };
  assert.match(bad.error, /value/);
  assert.equal(bad.shown, undefined);
  // Only a shown card is a card; an error result, or another tool's, is not.
  assert.equal(deviceCardFrom("show_on_watch", JSON.stringify(bad)), undefined);
  assert.equal(deviceCardFrom("show_on_watch", JSON.stringify(good))?.kind, "fact");
  assert.equal(deviceCardFrom("search_web", JSON.stringify(good)), undefined);

  const { brain, db } = await answerFixture([
    ...toolEvents("s1", "show_on_watch", good),
    ...toolEvents("s2", "show_on_watch", bad),
    { type: EventType.TEXT_MESSAGE_CHUNK, messageId: "r", delta: "24 minutes." } as BaseEvent,
  ]);
  const cards: DeviceCard[] = [];
  await voiceAnswer(brain)({
    owner: "owner",
    sessionId: "s1",
    delegationId: "d1",
    turns: [{ role: "user", text: "How long to get home?" }],
    progress: () => {},
    device: true,
    card: (c) => cards.push(c),
    signal: new AbortController().signal,
  });
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.kind, "fact");
  await db.close();
});

test("the look-up signal goes to the watch as plain numbers", () => {
  assert.deepEqual(deviceWire({ kind: "lookup", on: true }), { kind: "lookup", on: 1 });
  assert.deepEqual(deviceWire({ kind: "lookup", on: false }), { kind: "lookup", on: 0 });
});
