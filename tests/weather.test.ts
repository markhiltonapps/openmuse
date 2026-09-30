import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Areas } from "../apps/server/src/area.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  alertText,
  feelsLike,
  shapeWeather,
  skyEmoji,
  WeatherService,
  weatherToolSpecs,
} from "../apps/server/src/weather.ts";
import { precipWord } from "../packages/domain/src/weather.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close();
});

// A Wednesday afternoon in Houston (UTC−5 in September).
const NOW = new Date("2026-09-30T20:30:00Z");
const period = (
  startTime: string,
  isDaytime: boolean,
  temperature: number,
  shortForecast: string,
  rain: number | null = null,
  extra: Record<string, unknown> = {},
) => ({
  startTime,
  endTime: startTime,
  isDaytime,
  temperature,
  shortForecast,
  detailedForecast: `${shortForecast}, with a high near ${temperature}.`,
  probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: rain },
  ...extra,
});
const DAILY = [
  period("2026-09-30T13:00:00-05:00", true, 91, "Mostly Sunny", 10),
  period("2026-09-30T18:00:00-05:00", false, 74, "Chance Showers And Thunderstorms", 40),
  period("2026-10-01T06:00:00-05:00", true, 88, "Showers Likely", 70),
  period("2026-10-01T18:00:00-05:00", false, 70, "Partly Cloudy", 20),
  period("2026-10-02T06:00:00-05:00", true, 85, "Sunny", 0),
  period("2026-10-02T18:00:00-05:00", false, 68, "Clear", null),
];
const HOURLY = Array.from({ length: 16 }, (_, i) => {
  const hour = 15 + i;
  const day = hour < 24 ? "30" : "01";
  const month = hour < 24 ? "09" : "10";
  const hh = String(hour % 24).padStart(2, "0");
  const next = String((hour + 1) % 24).padStart(2, "0");
  return {
    ...period(
      `2026-${month}-${day}T${hh}:00:00-05:00`,
      hour < 19,
      90 - i,
      i === 3 ? "Chance Showers" : "Mostly Sunny",
      i === 3 ? 30 : 5,
    ),
    endTime: `2026-${month}-${hour + 1 < 24 ? "30" : "01"}T${next}:00:00-05:00`,
    relativeHumidity: { value: 60 },
    windSpeed: "10 mph",
  };
});
const ALERTS = [
  {
    id: "a1",
    event: "Heat Advisory",
    severity: "Moderate",
    headline: "Heat Advisory issued September 30",
    ends: "2026-10-01T01:00:00Z",
    description: "Heat index values up to 108.",
    instruction: "Drink plenty of fluids.",
  },
  { id: "a2", event: "Special Weather Statement", severity: "Minor" },
  { id: "a3", event: "Flood Warning", severity: "Severe", ends: "2026-09-30T10:00:00Z" },
  { id: "a4", event: "Tornado Warning", severity: "Extreme", expires: "2026-09-30T22:00:00Z" },
];

test("the sky, the feels-like temperature and the forecast as the Feed shows them", () => {
  assert.equal(skyEmoji("Chance Showers And Thunderstorms", true), "⛈️");
  assert.equal(skyEmoji("Slight Chance Rain Showers", true), "🌦️");
  assert.equal(skyEmoji("Rain Showers Likely", true), "🌧️");
  assert.equal(skyEmoji("Mostly Sunny", true), "🌤️");
  assert.equal(skyEmoji("Mostly Clear", false), "🌙");
  assert.equal(skyEmoji("Partly Cloudy", false), "☁️");
  assert.equal(skyEmoji("Patchy Fog", true), "🌫️");
  assert.equal(skyEmoji("Light Snow", false), "🌨️");
  // Wind chill when cold and windy, the heat index when hot, else the temperature itself.
  assert.equal(feelsLike(30, 50, 15), 19);
  assert.equal(feelsLike(90, 70, 5), 106);
  assert.equal(feelsLike(72, 50, 20), 72);
  assert.equal(feelsLike(40, 50, 0), 40);
  assert.equal(
    alertText(
      "* WHAT...Heat index values up to\n108 expected.\n\n* WHERE...Harris County.\n\n* IMPACTS...Heat illness.",
    ),
    "What: Heat index values up to 108 expected.\nWhere: Harris County.\nImpacts: Heat illness.",
  );

  const w = shapeWeather({
    place: "Houston, Texas",
    timeZone: "America/Chicago",
    daily: DAILY,
    hourly: HOURLY,
    alerts: ALERTS,
    now: NOW,
    fetchedAt: new Date("2026-09-30T20:10:00Z"),
  });
  assert.equal(w.now.temp, 90);
  // The Weather Service's words in sentence case.
  assert.equal(w.now.sky, "Mostly sunny");
  assert.equal(w.days[0]?.sky, "Mostly sunny");
  assert.equal(w.updatedAt, "2026-09-30T20:10:00.000Z");
  assert.equal(w.now.emoji, "🌤️");
  assert.equal(w.now.feelsLike, 100);
  assert.deepEqual(w.today, { high: 91, low: 74, rain: 40 });
  assert.equal(w.hours.length, 12);
  assert.equal(w.hours[3]?.rain, 30);
  assert.deepEqual(
    w.days.map((d) => [d.date, d.high, d.low, d.emoji, d.rain]),
    [
      ["2026-09-30", 91, 74, "🌤️", 40],
      ["2026-10-01", 88, 70, "🌧️", 70],
      ["2026-10-02", 85, 68, "☀️", 0],
    ],
  );
  // The most serious first; minor notices and ones that already ended are left out. "Until"
  // is only when the hazard ends: "expires" is just when the notice is next updated.
  assert.deepEqual(
    w.alerts.map((a) => [a.event, a.ends]),
    [
      ["Tornado Warning", undefined],
      ["Heat Advisory", "2026-10-01T01:00:00Z"],
    ],
  );
  assert.equal(w.alerts[1]?.instruction, "Drink plenty of fluids.");

  // Past midnight the rest of the night counts toward today: its rain chance and its low.
  const early = shapeWeather({
    place: "Houston, Texas",
    timeZone: "America/Chicago",
    daily: [
      period("2026-09-30T02:00:00-05:00", false, 66, "Showers And Thunderstorms", 90),
      ...DAILY,
    ],
    hourly: HOURLY,
    alerts: [],
    now: new Date("2026-09-30T07:30:00Z"),
  });
  assert.deepEqual(early.today, { high: 91, low: 74, rain: 90 });
  // Late evening there's no high any more: just tonight's low.
  const late = shapeWeather({
    place: "Houston, Texas",
    timeZone: "America/Chicago",
    daily: DAILY.slice(1),
    hourly: HOURLY,
    alerts: [],
    now: NOW,
  });
  assert.deepEqual(late.today, { low: 74, rain: 40 });
  assert.equal(late.days[0]?.high, undefined);

  // A warning's own format reads as sentences too.
  assert.equal(
    alertText("HAZARD...60 mph wind gusts.\n\nSOURCE...Radar indicated.\n\n* Until 445 PM CDT."),
    "Hazard: 60 mph wind gusts.\nSource: Radar indicated.\nUntil 445 PM CDT.",
  );
  assert.equal(precipWord("Light snow"), "snow");
  assert.equal(precipWord("Rain and snow showers"), "rain or snow");
  assert.equal(precipWord("Chance showers and thunderstorms"), "rain");
});

test("the service finds the city once, shares forecasts, and says why when there's none", async () => {
  const areas = new Areas(db);
  let clock = NOW.getTime();
  const asked: string[] = [];
  let down = false;
  const fetcher = (async (url: string) => {
    asked.push(url.replace("https://api.weather.gov", ""));
    if (down) return new Response("busy", { status: 503 });
    if (url.includes("/points/51.5074,-0.1278")) return new Response("{}", { status: 404 });
    if (url.includes("/points/"))
      return Response.json({
        properties: {
          forecast: "https://api.weather.gov/gridpoints/HGX/65,97/forecast",
          forecastHourly: "https://api.weather.gov/gridpoints/HGX/65,97/forecast/hourly",
          timeZone: "America/Chicago",
        },
      });
    if (url.endsWith("/forecast/hourly")) return Response.json({ properties: { periods: HOURLY } });
    if (url.endsWith("/forecast")) return Response.json({ properties: { periods: DAILY } });
    if (url.includes("/alerts/active"))
      return Response.json({ features: ALERTS.map((properties) => ({ properties })) });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const places: Record<string, { lat: number; lng: number }> = {
    "Houston, Texas, US": { lat: 29.76043, lng: -95.36979 },
    "Somewhere, Oregon": { lat: 51.5074, lng: -0.1278 },
  };
  const geocoded: string[] = [];
  let geocoderBusy = false;
  const weather = new WeatherService({
    areas,
    geocode: async (query) => {
      geocoded.push(query);
      return geocoderBusy ? undefined : places[query];
    },
    userAgent: "test",
    fetcher,
    now: () => clock,
  });

  assert.deepEqual(await weather.forOwner("nia"), { unavailable: "no-area" });
  // The geocoder was busy: said so, but not remembered, so the next look finds the city.
  geocoderBusy = true;
  const missed = await weather.forArea({
    id: "area",
    label: "Houston, Texas",
    city: "Houston",
    region: "Texas",
    country: "US",
    setAt: "",
  });
  assert.deepEqual(missed, { unavailable: "not-found" });
  geocoderBusy = false;
  geocoded.length = 0;
  await db.put("nia", "agent-settings", {
    id: "area",
    label: "Houston, Texas",
    city: "Houston",
    region: "Texas",
    country: "US",
    setAt: NOW.toISOString(),
  });
  const first = await weather.forOwner("nia");
  assert.ok("weather" in first);
  assert.equal(first.weather.place, "Houston, Texas");
  assert.equal(first.weather.now.temp, 90);
  assert.deepEqual(asked, [
    "/points/29.7604,-95.3698",
    "/gridpoints/HGX/65,97/forecast",
    "/gridpoints/HGX/65,97/forecast/hourly",
    "/alerts/active?point=29.7604,-95.3698",
  ]);
  // Asked again soon (by anyone in the same city): nothing new is fetched.
  await weather.forOwner("nia");
  assert.equal(asked.length, 4);
  assert.deepEqual(geocoded, ["Houston, Texas, US"]);
  // After 10 minutes only the alerts are looked at again.
  clock += 10 * 60_000;
  await weather.forOwner("nia");
  assert.deepEqual(asked.slice(4), ["/alerts/active?point=29.7604,-95.3698"]);
  // The Weather Service is down: the forecast from a little while ago stands in.
  down = true;
  clock += 40 * 60_000;
  const stale = await weather.forOwner("nia");
  assert.ok("weather" in stale);
  // Down for longer than that: it says the weather isn't available.
  clock += 7 * 60 * 60_000;
  assert.deepEqual(await weather.forOwner("nia"), { unavailable: "unreachable" });
  down = false;

  // Outside the US it's not looked up at all; a place the service doesn't cover says so too.
  const abroad = await weather.forArea({
    id: "area",
    label: "London, England",
    country: "GB",
    setAt: "",
  });
  assert.deepEqual(abroad, { unavailable: "outside-us" });
  const uncovered = await weather.forArea({ id: "area", label: "Somewhere, Oregon", setAt: "" });
  assert.deepEqual(uncovered, { unavailable: "not-found" });

  // The agent's tool reads the same forecast, in words, and passes on why when there's none.
  clock = NOW.getTime();
  const [tool] = weatherToolSpecs(weather, "nia");
  const said = (await tool?.execute()) as {
    now: string;
    today: string;
    nextHours: string[];
    days: unknown[];
    alerts: { event: string; until?: string }[];
  };
  assert.equal(said.now, "90°F, mostly sunny, feels like 100°F");
  assert.equal(said.today, "High 91°F, low 74°F, 40% chance of rain");
  assert.equal(said.nextHours[0], "Wed 3 PM: 90°F, mostly sunny, 5% chance of rain");
  assert.equal(said.days.length, 3);
  assert.equal(said.alerts[1]?.until, "Wednesday, 8:00 PM CDT");
  // With no city, chat asks for it; a scheduled task doesn't stop to ask.
  const none = weatherToolSpecs(weather, "zed")[0];
  assert.ok(none);
  const reply = (await none.execute()) as { unavailable: string };
  assert.match(reply.unavailable, /Ask which city/);
  const quiet = weatherToolSpecs(weather, "zed", { background: true })[0];
  assert.ok(quiet);
  const background = (await quiet.execute()) as { unavailable: string };
  assert.match(background.unavailable, /Don't stop to ask/);
  await db.remove("nia", "agent-settings", "area");
});
