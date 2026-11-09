import { z } from "zod";
import { weatherIconFor } from "../../../packages/domain/src/device-card.ts";
import { sunTimes } from "../../../packages/domain/src/sun.ts";
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

/** The part of Open-Meteo's answer used here. */
interface OpenMeteo {
  timezone?: string;
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
    is_day?: number;
  };
  daily?: {
    time?: string[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
    weather_code?: (number | null)[];
  };
}

/** The Weather Service-style words for a WMO weather code. */
export function wmoSky(code: number, day: boolean) {
  if (code === 0) return day ? "Sunny" : "Clear";
  if (code === 1) return day ? "Mostly sunny" : "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing drizzle";
  if (code === 61 || code === 80) return "Light rain";
  if (code === 63 || code === 81) return "Rain";
  if (code === 65 || code === 82) return "Heavy rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code === 71 || code === 85) return "Light snow";
  if (code === 73 || code === 86) return "Snow";
  if (code === 75) return "Heavy snow";
  if (code === 77) return "Snow grains";
  if (code === 95) return "Thunderstorms";
  if (code === 96 || code === 99) return "Thunderstorms with hail";
  return day ? "Partly cloudy" : "Cloudy";
}

/** Open-Meteo's answer as a `Weather` (today and the next two days; no hours or alerts). */
export function shapeOpenMeteo(raw: OpenMeteo, place: string, now: Date): WeatherResult {
  const current = raw.current;
  if (!current || typeof current.temperature_2m !== "number") return { unavailable: "unreachable" };
  const day = current.is_day !== 0;
  const sky = wmoSky(Number(current.weather_code ?? -1), day);
  const temp = Math.round(current.temperature_2m);
  const feelsLike = Math.round(current.apparent_temperature ?? current.temperature_2m);
  const daily = raw.daily ?? {};
  const days = (daily.time ?? []).slice(0, 3).map((date, i) => {
    const high = daily.temperature_2m_max?.[i];
    const low = daily.temperature_2m_min?.[i];
    const rain = daily.precipitation_probability_max?.[i];
    const code = daily.weather_code?.[i];
    const forecastSky = i === 0 ? sky : typeof code === "number" ? wmoSky(code, true) : sky;
    return {
      date,
      ...(typeof high === "number" ? { high: Math.round(high) } : {}),
      ...(typeof low === "number" ? { low: Math.round(low) } : {}),
      sky: forecastSky,
      emoji: skyEmoji(forecastSky, i === 0 ? day : true),
      ...(typeof rain === "number" && rain > 0 ? { rain: Math.round(rain) } : {}),
    };
  });
  const first = days[0];
  return {
    weather: {
      place,
      timeZone: raw.timezone ?? "UTC",
      now: { temp, feelsLike, sky, emoji: skyEmoji(sky, day) },
      today: {
        ...(first?.high !== undefined ? { high: first.high } : {}),
        ...(first?.low !== undefined ? { low: first.low } : {}),
        ...(first?.rain !== undefined ? { rain: first.rain } : {}),
      },
      hours: [],
      days,
      alerts: [],
      updatedAt: now.toISOString(),
    },
  };
}

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
    let where: { lat: number; lng: number };
    try {
      const query = [area.city, area.region, area.country].filter(Boolean).join(", ") || area.label;
      // A miss throws NotFound, so it isn't kept here (the geocoder remembers real misses itself);
      // a busy lookup throws too and shows as "didn't answer".
      ({ value: where } = await this.cached(
        `city:${query.toLowerCase()}`,
        7 * 24 * HOUR,
        async () => {
          // A lookup that failed throws (the weather "didn't answer"); only a real miss is NotFound.
          const found = await geocode(query, { strict: true });
          if (!found) throw new NotFound();
          return found;
        },
      ));
    } catch (error) {
      if (error instanceof NotFound) return { unavailable: "not-found" };
      console.warn(
        `[OpenMuse] Weather for ${area.label} unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { unavailable: "unreachable" };
    }
    return this.forPoint(where.lat, where.lng, area.label);
  }
  /**
   * The weather for any place by name, worldwide: the Weather Service where it covers (the US), Open-Meteo
   * (free, no key) everywhere else. A place that can't be found is "not-found".
   */
  async forPlace(name: string): Promise<WeatherResult> {
    const geocode = this.options.geocode;
    if (!geocode) return { unavailable: "off" };
    const label = name.trim().replace(/\s+/g, " ").slice(0, 80);
    let where: { lat: number; lng: number } | undefined;
    try {
      where = await geocode(label, { strict: true });
    } catch (error) {
      console.warn(
        `[OpenMuse] Weather for ${label} unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { unavailable: "unreachable" };
    }
    if (!where) return { unavailable: "not-found" };
    const us = await this.forSpot(where.lat, where.lng, label);
    if (!("unavailable" in us) || us.unavailable !== "not-found") return us;
    return this.worldwide(where.lat, where.lng, label);
  }
  /** Open-Meteo's current conditions and today, shaped like the Weather Service's (no hourly or alerts). */
  private async worldwide(lat: number, lng: number, label: string): Promise<WeatherResult> {
    try {
      const url =
        "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
        "&current=temperature_2m,apparent_temperature,weather_code,is_day" +
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code" +
        "&temperature_unit=fahrenheit&timezone=auto&forecast_days=3";
      const { value } = await this.cached(
        `world:${lat.toFixed(2)},${lng.toFixed(2)}`,
        30 * MINUTE,
        async () => {
          const response = await (this.options.fetcher ?? fetch)(url, {
            headers: { "User-Agent": this.options.userAgent },
            signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}`);
          return (await response.json()) as OpenMeteo;
        },
      );
      return shapeOpenMeteo(value, label, new Date(this.now));
    } catch (error) {
      console.warn(
        `[OpenMuse] Weather for ${label} unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { unavailable: "unreachable" };
    }
  }
  /**
   * The forecast where the person is right now (their shared spot). The spot is rounded to about
   * 100 m, so people near each other share one lookup; the Weather Service's own grid is far
   * coarser. A place outside the US comes back "not-found".
   */
  async forSpot(lat: number, lng: number, label: string): Promise<WeatherResult> {
    return this.forPoint(Number(lat.toFixed(3)), Number(lng.toFixed(3)), label);
  }
  private async forPoint(lat: number, lng: number, label: string): Promise<WeatherResult> {
    try {
      const at = `${lat.toFixed(4)},${lng.toFixed(4)}`;
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
          place: label,
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
        `[OpenMuse] Weather for ${label} unavailable: ${error instanceof Error ? error.message : String(error)}`,
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

/** Where the person is right now, as the Whereabouts service answers. */
export interface WhereNow {
  current(
    owner: string,
  ): Promise<{ lat: number; lng: number; place?: string; minutesAgo: number } | undefined>;
  enabled(owner: string): Promise<boolean>;
}

/** "Rain likely from Wed 3 PM (60%)", or that none is expected in the hours ahead. */
export function rainOutlook(hours: Weather["hours"]) {
  const wet = hours.find((h) => (h.rain ?? 0) >= 40);
  if (wet) return `${precipWord(wet.sky)} likely from ${hourOf(wet.time)} (${wet.rain}% chance)`;
  const maybe = hours.find((h) => (h.rain ?? 0) >= 20);
  if (maybe)
    return `A small chance of ${precipWord(maybe.sky)} around ${hourOf(maybe.time)} (${maybe.rain}%)`;
  return `No rain expected in the next ${hours.length} hours`;
}

/** "6:44 AM" in the spot's clock. */
const timeIn = (ms: number, timeZone: string) =>
  new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });

/** Sunrise and sunset at a spot, today, in its own clock. */
export function sunToday(lat: number, lng: number, timeZone: string, now: Date) {
  const day = now.toLocaleDateString("en-CA", { timeZone });
  const sun = sunTimes(lat, lng, day);
  if (sun.always)
    return {
      sun:
        sun.always === "up" ? "The sun stays up all day here" : "The sun stays down all day here",
    };
  if (sun.sunrise === undefined || sun.sunset === undefined) return {};
  const left = sun.sunset - now.getTime();
  return {
    sunrise: timeIn(sun.sunrise, timeZone),
    sunset: timeIn(sun.sunset, timeZone),
    ...(left > 0 && now.getTime() >= sun.sunrise
      ? {
          daylightLeft: `${Math.floor(left / 3_600_000)} h ${Math.round((left % 3_600_000) / 60_000)} min`,
        }
      : {}),
  };
}

export const weatherInstructions =
  " For the weather in the person's home city, or anything that depends on it (what to wear, rain at school pickup, outdoor plans, the morning brief, the family rundown), call get_weather: it has conditions now, the next 12 hours, 7 days and any severe-weather alerts, from the US National Weather Service, in the city's own clock. For the weather right where they are now (“will it rain on my walk”, “when's sunset here”, they're travelling or out), call get_weather with here true: it uses their shared location and also gives sunrise and sunset. It covers the home city or where they are, and the next 7 days, in the US only; for anywhere else or further out, search the web. Temperatures are °F. When it returns unavailable, do what that says.";

/** A forecast as the agent reads it, in words and numbers (and the card a watch-style device draws). */
function weatherFacts(
  w: Weather,
  where: {
    spot?: { lat: number; lng: number; minutesAgo: number };
    /** A named place ("for Denver") instead of the home city or where they are. */
    named?: string;
  } = {},
) {
  const { spot } = where;
  const feels =
    Math.abs(w.now.feelsLike - w.now.temp) >= 3 ? `, feels like ${w.now.feelsLike}°F` : "";
  const todaySky = w.days[0]?.sky ?? w.now.sky;
  return {
    place: w.place,
    timeZone: w.timeZone,
    localTime: clock(Date.now(), w.timeZone),
    now: `${w.now.temp}°F, ${w.now.sky.toLowerCase()}${feels}`,
    // What the watch-style device draws as a card (the numbers it needs; other screens ignore it).
    deviceCard: {
      place: w.place,
      temp: w.now.temp,
      feels: w.now.feelsLike,
      sky: w.now.sky,
      icon: weatherIconFor(w.now.emoji),
      high: w.today.high,
      low: w.today.low,
      rain: w.today.rain,
      alert: w.alerts[0]?.event,
    },
    today: [
      w.today.high !== undefined ? `High ${w.today.high}°F` : "",
      w.today.low !== undefined ? `low ${w.today.low}°F` : "",
      chanceOf(w.today.rain, todaySky) ?? "",
    ]
      .filter(Boolean)
      .join(", ")
      .replace(/^./, (c) => c.toUpperCase()),
    rainSoon: w.hours.length ? rainOutlook(w.hours) : undefined,
    ...(spot
      ? {
          forWhere: "where they are now (from their phone's shared location)",
          ...(spot.minutesAgo > 10
            ? {
                spotAge: `their phone last shared where they are ${spot.minutesAgo} minutes ago: say so`,
              }
            : {}),
          ...sunToday(spot.lat, spot.lng, w.timeZone, new Date()),
        }
      : {}),
    ...(where.named ? { forWhere: where.named } : {}),
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
    source:
      w.alerts.length || w.hours.length
        ? "US National Weather Service"
        : "Open-Meteo or the US National Weather Service",
  };
}

export function weatherToolSpecs(
  weather: WeatherService,
  owner: string,
  /** A scheduled or background task, which can't stop to ask the person anything. */
  options: {
    background?: boolean;
    /** Lets get_weather answer for where the person is now (chat and calls only). */
    where?: WhereNow;
  } = {},
) {
  return [
    {
      name: "get_weather",
      description:
        "The forecast: now, today's high and low and rain chance, and more. By default for the person's home city. With here true, for where they are right now, from their shared location (it also gives sunrise and sunset there). With place, for any city or place in the world ('Denver', 'Paris, France'): use that whenever they name somewhere else. On a call from their watch the weather card appears on its screen by itself.",
      parameters: z.object({
        here: z
          .boolean()
          .optional()
          .describe("True for the weather where they are right now, instead of their home city"),
        place: z
          .string()
          .trim()
          .max(80)
          .optional()
          .describe(
            "A city or place to get the weather for instead of their home city, anywhere in the world: 'Denver', 'Paris, France'",
          ),
      }),
      execute: async (args?: { here?: boolean; place?: string }) => {
        const named = args?.place?.trim();
        if (named) {
          const found = await weather.forPlace(named);
          if ("unavailable" in found)
            return {
              unavailable:
                found.unavailable === "not-found"
                  ? `Couldn't find a place called "${named}". Ask them which place they mean (the city and state or country), or search the web.`
                  : "Couldn't get the forecast for that place just now. If you can search the web, search for it; otherwise say it isn't available right now.",
            };
          return weatherFacts(found.weather, { named: `for ${named}` });
        }
        const here = args?.here === true && !options.background;
        let spot: Awaited<ReturnType<WhereNow["current"]>>;
        if (here) {
          const where = options.where;
          if (!where)
            return {
              unavailable:
                "Where they are isn't available here. Use their home city (call again without here), or ask where they are and search the web.",
            };
          spot = await where.current(owner);
          if (!spot)
            return (await where.enabled(owner))
              ? {
                  unavailable:
                    "Their phone hasn't shared a location in the last hour (the app shares it only while it's open). Ask where they are or ask them to open the app; or give their home city's weather (call again without here).",
                }
              : {
                  unavailable:
                    "Location sharing is off. Offer to turn it on with set_location_sharing (their phone asks the next time the app is open), or ask where they are; or give their home city's weather (call again without here).",
                };
        }
        const result = spot
          ? await weather.forSpot(spot.lat, spot.lng, spot.place ?? "where they are")
          : await weather.forOwner(owner);
        if ("unavailable" in result) {
          if (spot)
            return {
              unavailable:
                result.unavailable === "not-found"
                  ? "This forecast covers the US only, and the Weather Service has none for where they are. If you can search the web, search for the weather there; otherwise say it isn't available."
                  : "Couldn't get the forecast for where they are just now. If you can search the web, search for the weather there; otherwise say the forecast isn't available right now.",
            };
          const place = await weather.place(owner);
          return {
            unavailable: unavailable(result.unavailable, place, Boolean(options.background)),
          };
        }
        return weatherFacts(result.weather, { spot });
      },
    },
  ];
}
