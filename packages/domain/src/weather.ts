/**
 * The local forecast on the Feed, for the person's home city, from the US National Weather
 * Service. Temperatures are in °F; `rain` is the chance of rain or snow, in percent.
 */

export interface WeatherNow {
  temp: number;
  /** With the wind chill or the heat and humidity; the same as `temp` when neither counts. */
  feelsLike: number;
  /** In the Weather Service's words, in sentence case: "Mostly sunny", "Chance showers and thunderstorms". */
  sky: string;
  emoji: string;
}
export interface WeatherHour {
  /** When the hour starts, with the city's own offset: "2026-09-30T15:00:00-05:00". */
  time: string;
  temp: number;
  sky: string;
  emoji: string;
  rain?: number;
}
export interface WeatherDay {
  /** The city's own date, YYYY-MM-DD. */
  date: string;
  /** The daytime high; missing for today once the day is over. */
  high?: number;
  /** The low that night. */
  low?: number;
  sky: string;
  emoji: string;
  rain?: number;
  /** The Weather Service's own sentence for the day (or the night, once the day is over). */
  detail?: string;
}
export interface WeatherAlert {
  id: string;
  /** "Heat Advisory", "Severe Thunderstorm Warning". */
  event: string;
  headline?: string;
  /** Extreme, Severe or Moderate: minor notices aren't shown. */
  severity: string;
  /** When the hazard ends; missing when the Weather Service doesn't say. */
  ends?: string;
  description?: string;
  instruction?: string;
}
export interface Weather {
  /** The home city as the person saved it: "Houston, Texas". */
  place: string;
  /** The city's time zone, for the hours and days. */
  timeZone: string;
  now: WeatherNow;
  today: { high?: number; low?: number; rain?: number };
  /** The next 12 hours. */
  hours: WeatherHour[];
  /** Today and the 6 days after it. */
  days: WeatherDay[];
  /** The most serious first. */
  alerts: WeatherAlert[];
  /** When the Weather Service's forecast was fetched: older when it was down and an earlier one stands in. */
  updatedAt: string;
}
/**
 * Why there's no forecast: no home city yet, one outside the US, a city the forecast can't find,
 * the service is down, or weather isn't set up on the server.
 */
export type WeatherUnavailable = "no-area" | "outside-us" | "not-found" | "unreachable" | "off";

/** What falls from the sky, for "a 60% chance of …": the chance covers rain and snow alike. */
export function precipWord(sky: string) {
  const s = sky.toLowerCase();
  const snow = /snow|flurr|blizzard|sleet|freezing|\bice\b/.test(s);
  const rain = /rain|shower|drizzle|thunder|t-storm/.test(s);
  return snow && rain ? "rain or snow" : snow ? "snow" : "rain";
}
export type WeatherResult = { weather: Weather } | { unavailable: WeatherUnavailable };
