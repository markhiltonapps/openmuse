import { z } from "zod";
import {
  precipWord,
  type Weather,
  type WeatherAlert,
  type WeatherDay,
  type WeatherResult,
  type WeatherUnavailable,
} from "../../../packages/domain/src/weather.ts";
import type { Area, Areas } from "./area.ts";
import type { Geocoder } from "./rich-cards.ts";

/**
 * The local forecast for the person's home city, from the US National Weather Service: free,
 * no key, and fine to use in a paid app. It covers the US only. The city is found once (its own
 * coordinates, not the person's), and forecasts are shared by everyone in the same city for half
 * an hour; alerts for five minutes.
 */

const BASE = "https://api.weather.gov";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** How long an older forecast still stands in when the Weather Service is down. */
const STALE = 6 * HOUR;

interface Period {
  startTime: string;
  endTime?: string;
  isDaytime: boolean;
  temperature: number;
  probabilityOfPrecipitation?: { value?: number | null } | null;
  relativeHumidity?: { value?: number | null } | null;
  windSpeed?: string;
  shortForecast: string;
  detailedForecast?: string;
}
interface Point {
  forecast: string;
  hourly: string;
  timeZone: string;
}
interface AlertProperties {
  id?: string;
  event?: string;
  headline?: string | null;
  severity?: string;
  ends?: string | null;
  expires?: string | null;
  description?: string | null;
  instruction?: string | null;
}

/** An emoji for the Weather Service's words, by day or by night. */
export function skyEmoji(sky: string, day: boolean) {
  const s = sky.toLowerCase();
  if (/thunder|t-storm/.test(s)) return "⛈️";
  if (/snow|flurr|blizzard|sleet|freezing|\bice\b/.test(s)) return "🌨️";
  if (/rain|shower|drizzle/.test(s))
    return day && /chance|slight|isolated|scattered/.test(s) && !/likely/.test(s) ? "🌦️" : "🌧️";
  if (/fog|haze|smoke|mist|dust/.test(s)) return "🌫️";
  if (/mostly cloudy|considerable cloud/.test(s)) return day ? "🌥️" : "☁️";
  if (/partly (cloudy|sunny)/.test(s)) return day ? "⛅" : "☁️";
  if (/cloudy|overcast/.test(s)) return "☁️";
  if (/mostly (sunny|clear)/.test(s)) return day ? "🌤️" : "🌙";
  if (/sunny|clear|fair|hot/.test(s)) return day ? "☀️" : "🌙";
  if (/wind|breez|blustery|gust/.test(s)) return "🌬️";
  return day ? "⛅" : "🌙";
}

/** The fastest wind in "5 to 10 mph", in mph. */
const mph = (wind?: string) => {
  const numbers = (wind ?? "").match(/\d+/g)?.map(Number) ?? [];
  return numbers.length ? Math.max(...numbers) : undefined;
};

/**
 * What it feels like, worked out the Weather Service's way: the wind chill at 50°F or below
 * with some wind, the heat index at 80°F or above, otherwise the temperature itself.
 */
export function feelsLike(temp: number, humidity?: number, wind?: number) {
  if (temp <= 50 && wind !== undefined && wind >= 3) {
    const v = wind ** 0.16;
    return Math.round(35.74 + 0.6215 * temp - 35.75 * v + 0.4275 * temp * v);
  }
  if (temp >= 80 && humidity !== undefined) {
    const [t, r] = [temp, humidity];
    let index = 0.5 * (t + 61 + (t - 68) * 1.2 + r * 0.094);
    if ((index + t) / 2 >= 80) {
      index =
        -42.379 +
        2.04901523 * t +
        10.14333127 * r -
        0.22475541 * t * r -
        0.00683783 * t * t -
        0.05481717 * r * r +
        0.00122874 * t * t * r +
        0.00085282 * t * r * r -
        0.00000199 * t * t * r * r;
      if (r < 13 && t <= 112) index -= ((13 - r) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
      else if (r > 85 && t <= 87) index += ((r - 85) / 10) * ((87 - t) / 5);
    }
    return Math.round(index);
  }
  return Math.round(temp);
}

/**
 * An alert's text as plain sentences. The Weather Service writes "* WHAT...Heat index up to 108."
 * and breaks its lines at 70 characters; this gives "What: Heat index up to 108.", a paragraph
 * per line.
 */
export function alertText(text: string) {
  return text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((part) =>
      part
        .replace(/\s*\n\s*/g, " ")
        .trim()
        // "* WHAT...", or "HAZARD..." in a warning, becomes "What: ", "Hazard: ".
        .replace(
          /^(?:\*\s*)?([A-Z][A-Z /]*?)\.\.\.\s*/,
          (_, key: string) => `${key.charAt(0)}${key.slice(1).toLowerCase()}: `,
        )
        .replace(/^\*\s+/, ""),
    )
    .filter(Boolean)
    .join("\n");
}

/** "Chance Showers And Thunderstorms" → "Chance showers and thunderstorms". */
const sentence = (text: string) => {
  const lower = text.trim().toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};
const chance = (p?: Period) => p?.probabilityOfPrecipitation?.value ?? undefined;
const most = (...values: (number | undefined)[]) => {
  const known = values.filter((v): v is number => typeof v === "number");
  return known.length ? Math.max(...known) : undefined;
};
/** The city's own date of a Weather Service time, which carries the city's offset. */
const dateOf = (time: string) => time.slice(0, 10);
const RANK: Record<string, number> = { Extreme: 0, Severe: 1, Moderate: 2 };

/** The Weather Service's answers as the Feed shows them. */
export function shapeWeather(input: {
  place: string;
  timeZone: string;
  daily: Period[];
  hourly: Period[];
  alerts: AlertProperties[];
  now: Date;
  /** When the forecast itself was fetched. */
  fetchedAt?: Date;
}): Weather {
  const today = input.now.toLocaleDateString("en-CA", { timeZone: input.timeZone });
  const ahead = input.hourly.filter(
    (p) => new Date(p.endTime ?? p.startTime).getTime() > input.now.getTime(),
  );
  const current = ahead[0] ?? input.hourly[0];
  if (!current) throw new Error("The Weather Service sent no hours");
  const nights = new Map<string, Period>();
  const days = new Map<string, Period>();
  // After midnight the first period is the rest of the night: it counts toward today.
  let overnight: Period | undefined;
  for (const period of input.daily) {
    const date = dateOf(period.startTime);
    if (!period.isDaytime && Number(period.startTime.slice(11, 13)) < 12) {
      if (date === today) overnight = period;
      continue;
    }
    (period.isDaytime ? days : nights).set(date, period);
  }
  const dates = [...new Set([...days.keys(), ...nights.keys()])]
    .filter((date) => date >= today)
    .sort()
    .slice(0, 7);
  const week = dates.map((date): WeatherDay => {
    const day = days.get(date);
    const night = nights.get(date);
    const main = (day ?? night) as Period;
    const early = date === today ? overnight : undefined;
    const rain = most(chance(day), chance(night), chance(early));
    const low = night?.temperature ?? early?.temperature;
    return {
      date,
      ...(day ? { high: day.temperature } : {}),
      ...(low !== undefined ? { low } : {}),
      sky: sentence(main.shortForecast),
      emoji: skyEmoji(main.shortForecast, Boolean(day)),
      ...(rain !== undefined ? { rain } : {}),
      ...(main.detailedForecast ? { detail: main.detailedForecast } : {}),
    };
  });
  const first = week[0]?.date === today ? week[0] : undefined;
  const humidity = current.relativeHumidity?.value ?? undefined;
  const alerts = input.alerts
    .filter((a) => a.event && a.severity && a.severity in RANK)
    .filter((a) => {
      const end = a.ends ?? a.expires;
      return !end || new Date(end).getTime() > input.now.getTime();
    })
    .sort((a, b) => (RANK[a.severity ?? ""] ?? 9) - (RANK[b.severity ?? ""] ?? 9))
    .slice(0, 3)
    .map(
      (a, i): WeatherAlert => ({
        id: a.id ?? `alert-${i}`,
        event: a.event ?? "",
        severity: a.severity ?? "",
        ...(a.headline ? { headline: a.headline } : {}),
        // Only when the hazard ends: "expires" is when this notice is next updated.
        ...(a.ends ? { ends: a.ends } : {}),
        ...(a.description ? { description: alertText(a.description).slice(0, 2000) } : {}),
        ...(a.instruction ? { instruction: alertText(a.instruction).slice(0, 1000) } : {}),
      }),
    );
  return {
    place: input.place,
    timeZone: input.timeZone,
    now: {
      temp: current.temperature,
      feelsLike: feelsLike(current.temperature, humidity, mph(current.windSpeed)),
      sky: sentence(current.shortForecast),
      emoji: skyEmoji(current.shortForecast, current.isDaytime),
    },
    today: {
      ...(first?.high !== undefined ? { high: first.high } : {}),
      ...(first?.low !== undefined ? { low: first.low } : {}),
      ...(first?.rain !== undefined ? { rain: first.rain } : {}),
    },
    hours: ahead.slice(0, 12).map((p) => {
      const rain = chance(p);
      return {
        time: p.startTime,
        temp: p.temperature,
        sky: sentence(p.shortForecast),
        emoji: skyEmoji(p.shortForecast, p.isDaytime),
        ...(rain !== undefined ? { rain } : {}),
      };
    }),
    days: week,
    alerts,
    updatedAt: (input.fetchedAt ?? input.now).toISOString(),
  };
}

/** The city can't be found for the forecast. */
class NotFound extends Error {}

export class WeatherService {
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private readonly loading = new Map<string, Promise<{ at: number; value: unknown }>>();
  constructor(
    private readonly options: {
      areas: Areas;
      /** Finds the city; absent where the server can't reach a geocoder (sample mode, tests). */
      geocode?: Geocoder;
      userAgent: string;
      fetcher?: typeof fetch;
      now?: () => number;
    },
  ) {}
  private get now() {
    return (this.options.now ?? Date.now)();
  }
  /** The person's home city as they saved it, for a message about it. */
  async place(owner: string) {
    return (await this.options.areas.get(owner).catch(() => undefined))?.label;
  }
  /** The person's forecast, or why there isn't one. */
  async forOwner(owner: string): Promise<WeatherResult> {
    const area = await this.options.areas.get(owner);
    if (!area) return { unavailable: "no-area" };
    return this.forArea(area);
  }
  async forArea(area: Area): Promise<WeatherResult> {
    if (area.country && area.country !== "US") return { unavailable: "outside-us" };
    const geocode = this.options.geocode;
    if (!geocode) return { unavailable: "off" };
    try {
      const query = [area.city, area.region, area.country].filter(Boolean).join(", ") || area.label;
      // A miss throws NotFound, so it isn't kept here (the geocoder remembers real misses itself);
      // a busy lookup throws too and shows as "didn't answer".
      const { value: where } = await this.cached(
        `city:${query.toLowerCase()}`,
        7 * 24 * HOUR,
        async () => {
          // A lookup that failed throws (the weather "didn't answer"); only a real miss is NotFound.
          const found = await geocode(query, { strict: true });
          if (!found) throw new NotFound();
          return found;
        },
      );
      const at = `${where.lat.toFixed(4)},${where.lng.toFixed(4)}`;
      // A place the Weather Service doesn't cover is asked about again the next day.
      const { value: point } = await this.cached(
        `point:${at}`,
        (found) => (found ? 7 * 24 * HOUR : 24 * HOUR),
        () => this.point(at),
      );
      if (!point) return { unavailable: "not-found" };
      const [daily, hourly, alerts] = await Promise.all([
        this.cached(`daily:${point.forecast}`, 30 * MINUTE, () => this.periods(point.forecast)),
        this.cached(`hourly:${point.hourly}`, 30 * MINUTE, () => this.periods(point.hourly)),
        // Alerts matter most when they're fresh; the forecast still shows without them.
        this.cached(`alerts:${at}`, 5 * MINUTE, () => this.alerts(at)).catch(() => ({
          at: this.now,
          value: [] as AlertProperties[],
        })),
      ]);
      return {
        weather: shapeWeather({
          place: area.label,
          timeZone: point.timeZone,
          daily: daily.value,
          hourly: hourly.value,
          alerts: alerts.value,
          now: new Date(this.now),
          fetchedAt: new Date(Math.min(daily.at, hourly.at)),
        }),
      };
    } catch (error) {
      if (error instanceof NotFound) return { unavailable: "not-found" };
      console.warn(
        `[OpenMuse] Weather for ${area.label} unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { unavailable: "unreachable" };
    }
  }
  /**
   * A value and when it was fetched: fresh for `fresh` ms, loaded once however many ask, and an
   * older one stands in for a while when loading fails.
   */
  private async cached<T>(
    key: string,
    fresh: number | ((value: T) => number),
    load: () => Promise<T>,
  ): Promise<{ at: number; value: T }> {
    const hit = this.cache.get(key) as { at: number; value: T } | undefined;
    const lasts = (value: T) => (typeof fresh === "number" ? fresh : fresh(value));
    if (hit && this.now - hit.at < lasts(hit.value)) return hit;
    const running = this.loading.get(key) as Promise<{ at: number; value: T }> | undefined;
    if (running) return running;
    const job = load()
      .then((value) => {
        const entry = { at: this.now, value };
        this.cache.set(key, entry);
        return entry;
      })
      .catch((error: unknown) => {
        if (hit && this.now - hit.at < STALE) return hit;
        throw error;
      })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, job as Promise<{ at: number; value: unknown }>);
    return job;
  }
  /** A Weather Service answer; null for a place it doesn't cover. One retry when it's busy. */
  private async get(url: string): Promise<unknown> {
    if (!url.startsWith(`${BASE}/`)) throw new Error("Unexpected Weather Service address");
    for (let attempt = 0; ; attempt++) {
      const response = await (this.options.fetcher ?? fetch)(url, {
        headers: { "user-agent": this.options.userAgent, accept: "application/geo+json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return response.json();
      if (response.status === 404) return null;
      if (attempt === 0 && response.status >= 500) continue;
      throw new Error(`The Weather Service answered ${response.status}`);
    }
  }
  private async point(at: string): Promise<Point | null> {
    const body = pointSchema.safeParse(await this.get(`${BASE}/points/${at}`));
    if (!body.success) return null;
    const { forecast, forecastHourly, timeZone } = body.data.properties;
    return { forecast, hourly: forecastHourly, timeZone };
  }
  private async periods(url: string) {
    const body = periodsSchema.parse(await this.get(url));
    return body.properties.periods as Period[];
  }
  private async alerts(at: string) {
    const body = alertsSchema.safeParse(await this.get(`${BASE}/alerts/active?point=${at}`));
    return body.success ? body.data.features.map((f) => f.properties as AlertProperties) : [];
  }
}

const pointSchema = z.object({
  properties: z.object({
    forecast: z.string().url(),
    forecastHourly: z.string().url(),
    timeZone: z.string().min(1),
  }),
});
const periodSchema = z
  .object({
    startTime: z.string(),
    endTime: z.string().optional(),
    isDaytime: z.boolean(),
    temperature: z.number(),
    shortForecast: z.string(),
  })
  .passthrough();
const periodsSchema = z.object({
  properties: z.object({ periods: z.array(periodSchema).min(1) }),
});
const alertsSchema = z.object({
  features: z.array(z.object({ properties: z.object({}).passthrough() })),
});

/** "Wed 3 PM" from a Weather Service time, in the city's own clock. */
const hourOf = (time: string) => {
  const hour = Number(time.slice(11, 13));
  const day = new Date(`${time.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  return `${day} ${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
};
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "Wednesday, 8:00 PM CDT" in the city's clock. */
const clock = (time: string | number, timeZone: string) =>
  new Date(time).toLocaleString("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  });
const chanceOf = (rain: number | undefined, sky: string) =>
  rain ? `${rain}% chance of ${precipWord(sky)}` : undefined;

/** Why there's no forecast, as the agent should act on it. Background tasks can't ask. */
function unavailable(reason: WeatherUnavailable, place: string | undefined, background: boolean) {
  const where = place ? ` in ${place}` : "";
  const elsewhere = `If you can search the web, search for the weather${where}; otherwise say the forecast isn't available right now.`;
  if (reason === "no-area")
    return background
      ? "No home city is saved. Don't stop to ask: leave the weather out, and at most say in one line that they can add their city on the Feed."
      : "No home city is saved. Ask which city they live in and save it with set_home_area.";
  if (reason === "outside-us") return `This forecast covers US cities only. ${elsewhere}`;
  if (reason === "not-found")
    return `Couldn't get a forecast for their home city${place ? ` (${place})` : ""}. ${elsewhere}`;
  if (reason === "unreachable") return `Couldn't get the forecast just now. ${elsewhere}`;
  return `The forecast isn't set up here. ${elsewhere}`;
}

export const weatherInstructions =
  " For the weather in the person's home city, or anything that depends on it (what to wear, rain at school pickup, outdoor plans, the morning brief, the family rundown), call get_weather: it has conditions now, the next 12 hours, 7 days and any severe-weather alerts, from the US National Weather Service, in the city's own clock. It covers the home city and the next 7 days only; for anywhere else or further out, search the web. Temperatures are °F. When it returns unavailable, do what that says.";

export function weatherToolSpecs(
  weather: WeatherService,
  owner: string,
  /** A scheduled or background task, which can't stop to ask the person anything. */
  options: { background?: boolean } = {},
) {
  return [
    {
      name: "get_weather",
      description:
        "The forecast for the person's home city (US only) from the US National Weather Service: now, the next 12 hours, 7 days and any severe-weather alerts. Not for other places. No arguments.",
      parameters: z.object({}),
      execute: async () => {
        const result = await weather.forOwner(owner);
        if ("unavailable" in result) {
          const place = await weather.place(owner);
          return {
            unavailable: unavailable(result.unavailable, place, Boolean(options.background)),
          };
        }
        const w = result.weather;
        const feels =
          Math.abs(w.now.feelsLike - w.now.temp) >= 3 ? `, feels like ${w.now.feelsLike}°F` : "";
        const todaySky = w.days[0]?.sky ?? w.now.sky;
        return {
          place: w.place,
          timeZone: w.timeZone,
          localTime: clock(Date.now(), w.timeZone),
          now: `${w.now.temp}°F, ${w.now.sky.toLowerCase()}${feels}`,
          today: [
            w.today.high !== undefined ? `High ${w.today.high}°F` : "",
            w.today.low !== undefined ? `low ${w.today.low}°F` : "",
            chanceOf(w.today.rain, todaySky) ?? "",
          ]
            .filter(Boolean)
            .join(", ")
            .replace(/^./, (c) => c.toUpperCase()),
          nextHours: w.hours.map(
            (h) =>
              `${hourOf(h.time)}: ${h.temp}°F, ${h.sky.toLowerCase()}${h.rain ? `, ${chanceOf(h.rain, h.sky)}` : ""}`,
          ),
          days: w.days.map((d) => ({
            day: WEEKDAY[new Date(`${d.date}T12:00:00Z`).getUTCDay()],
            date: d.date,
            ...(d.high !== undefined ? { high: `${d.high}°F` } : {}),
            ...(d.low !== undefined ? { low: `${d.low}°F` } : {}),
            sky: d.sky,
            ...(d.rain ? { chance: chanceOf(d.rain, d.sky) } : {}),
            ...(d.detail ? { detail: d.detail } : {}),
          })),
          alerts: w.alerts.map((a) => ({
            event: a.event,
            severity: a.severity,
            ...(a.headline ? { headline: a.headline } : {}),
            ...(a.ends ? { until: clock(a.ends, w.timeZone) } : {}),
            ...(a.instruction ? { whatToDo: a.instruction } : {}),
          })),
          asOf: clock(w.updatedAt, w.timeZone),
          source: "US National Weather Service",
        };
      },
    },
  ];
}
