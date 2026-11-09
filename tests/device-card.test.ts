import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type BaseEvent, EventType } from "@ag-ui/core";
import { createStore } from "../apps/server/src/db.ts";
import {
  DEVICE_SCREEN,
  deviceCardFrom,
  type VoiceBrain,
  voiceAnswer,
  whereShown,
} from "../apps/server/src/voice-brain.ts";
import {
  type DeviceCard,
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
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.temp, 72);
  assert.equal(cards[0]?.place, "Houston");

  // Not a device call: no card goes anywhere (the app's call screen has no weather card yet).
  const other: DeviceCard[] = [];
  await voiceAnswer(brain)({ ...base, card: (c) => other.push(c) });
  assert.deepEqual(other, []);

  // The device is described as it is: weather only, never "on their screen" for anything else.
  assert.match(DEVICE_SCREEN, /only one thing besides words: the weather/);
  assert.notEqual(DEVICE_SCREEN, whereShown(false));
  await db.close();
});
