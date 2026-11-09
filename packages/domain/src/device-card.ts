/**
 * Cards for the small screen on the watch-style device. The device draws them itself from a few
 * plain facts (no pictures travel): the server sends the facts, the device has the art and fonts.
 * Only plain ASCII text can be drawn there, so the text here is cleaned to that.
 */

/** The weather pictures the device can draw. */
export const WEATHER_ICONS = [
  "sun",
  "moon",
  "sun-cloud",
  "partly",
  "cloud",
  "sun-rain",
  "rain",
  "storm",
  "snow",
  "fog",
  "wind",
] as const;
export type WeatherIcon = (typeof WEATHER_ICONS)[number];

export interface WeatherDeviceCard {
  kind: "weather";
  /** The city: "Houston". */
  place: string;
  /** Degrees Fahrenheit, now. */
  temp: number;
  /** What it feels like; only when it differs from the temperature by 3 or more. */
  feels?: number;
  /** "Partly cloudy". */
  sky: string;
  icon: WeatherIcon;
  high?: number;
  low?: number;
  /** Today's chance of rain or snow, in percent. */
  rain?: number;
  /** The most serious severe-weather alert, if any: "Heat Advisory". */
  alert?: string;
}
export type DeviceCard = WeatherDeviceCard;

/** The weather picture for an emoji (the server picks emoji by day or night). */
export function weatherIconFor(emoji: string): WeatherIcon {
  const e = emoji.replace(/️/g, "");
  switch (e) {
    case "☀":
      return "sun";
    case "🌙":
      return "moon";
    case "🌤":
      return "sun-cloud";
    case "⛅":
    case "🌥":
      return "partly";
    case "🌦":
      return "sun-rain";
    case "🌧":
      return "rain";
    case "⛈":
      return "storm";
    case "🌨":
      return "snow";
    case "🌫":
      return "fog";
    case "🌬":
      return "wind";
    default:
      return "cloud";
  }
}

/** Text the device can draw: plain ASCII (accents dropped), one line, at most `max` characters. */
export function plainForDevice(text: unknown, max: number): string {
  if (typeof text !== "string") return "";
  const flat = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}.` : flat;
}

const whole = (value: unknown, lo: number, hi: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= lo && value <= hi
    ? Math.round(value)
    : undefined;

/** A weather card from loose facts (the get_weather result's `card`); undefined when it isn't one. */
export function weatherDeviceCard(raw: unknown): WeatherDeviceCard | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const temp = whole(r.temp, -100, 150);
  const sky = plainForDevice(r.sky, 28);
  if (temp === undefined || !sky) return undefined;
  const icon = (WEATHER_ICONS as readonly string[]).includes(String(r.icon))
    ? (r.icon as WeatherIcon)
    : "cloud";
  const feels = whole(r.feels, -100, 150);
  const high = whole(r.high, -100, 150);
  const low = whole(r.low, -100, 150);
  const rain = whole(r.rain, 0, 100);
  const alert = plainForDevice(r.alert, 30);
  return {
    kind: "weather",
    place: plainForDevice(r.place, 24).replace(/,.*$/, "").trim() || "Here",
    temp,
    ...(feels !== undefined && Math.abs(feels - temp) >= 3 ? { feels } : {}),
    sky,
    icon,
    ...(high !== undefined ? { high } : {}),
    ...(low !== undefined ? { low } : {}),
    ...(rain ? { rain } : {}),
    ...(alert ? { alert } : {}),
  };
}
