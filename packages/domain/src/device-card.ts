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
/** A game: short team names and scores (no scores yet for a game still to come), and where it stands. */
export interface ScoreDeviceCard {
  kind: "score";
  league?: string;
  /** "Final", "Q3 4:21", "7:30 PM tonight". */
  status?: string;
  away: { name: string; score?: number };
  home: { name: string; score?: number };
}
/** One headline value: a price, a count, a time, a distance. */
export interface FactDeviceCard {
  kind: "fact";
  label: string;
  value: string;
  sub?: string;
  note?: string;
  /** Colours the line under the value: good (green), bad (red) or plain. */
  tone?: "good" | "bad" | "neutral";
}
/** Up to five rows: a schedule, a standing, a few options. */
export interface ListDeviceCard {
  kind: "list";
  title: string;
  rows: { label: string; value?: string }[];
}
export type DeviceCard = WeatherDeviceCard | ScoreDeviceCard | FactDeviceCard | ListDeviceCard;

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

/**
 * Text the device can draw: plain ASCII (accents dropped), one line, at most `max` characters. The degree
 * sign is kept as code 127, where the device's fonts have it.
 */
export function plainForDevice(text: unknown, max: number): string {
  if (typeof text !== "string") return "";
  const flat = text
    .replace(/°/g, "\uE000")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e\uE000]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\uE000/g, "\x7f");
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
  const sky = plainForDevice(r.sky, 40);
  if (temp === undefined || !sky) return undefined;
  const icon = (WEATHER_ICONS as readonly string[]).includes(String(r.icon))
    ? (r.icon as WeatherIcon)
    : "cloud";
  const feels = whole(r.feels, -100, 150);
  const high = whole(r.high, -100, 150);
  const low = whole(r.low, -100, 150);
  const rain = whole(r.rain, 0, 100);
  const alert = plainForDevice(r.alert, 24);
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

const score = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 999
    ? Math.round(value)
    : undefined;
const optional = <T extends object>(key: string, value: string) =>
  (value ? { [key]: value } : {}) as T;

/**
 * A card from what the agent gave (a tool's arguments): checked, cleaned to plain short text, or the
 * reason it can't be one (so the agent can fix it or skip it).
 */
export function buildDeviceCard(args: unknown): { card: DeviceCard } | { error: string } {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const team = (raw: unknown) => {
    const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return { name: plainForDevice(t.name, 16), score: score(t.score) };
  };
  if (a.kind === "score") {
    const away = team(a.away);
    const home = team(a.home);
    if (!away.name || !home.name) return { error: "A score card needs both teams' short names." };
    const league = plainForDevice(a.league, 16);
    const status = plainForDevice(a.status, 24);
    return {
      card: {
        kind: "score",
        ...(league ? { league } : {}),
        ...(status ? { status } : {}),
        away: { name: away.name, ...(away.score !== undefined ? { score: away.score } : {}) },
        home: { name: home.name, ...(home.score !== undefined ? { score: home.score } : {}) },
      },
    };
  }
  if (a.kind === "fact") {
    const label = plainForDevice(a.label, 24);
    const value = plainForDevice(a.value, 18);
    if (!label || !value) return { error: "A fact card needs a short label and a value." };
    const sub = plainForDevice(a.sub, 44);
    const note = plainForDevice(a.note, 36);
    const tone = a.tone === "good" || a.tone === "bad" || a.tone === "neutral" ? a.tone : undefined;
    return {
      card: {
        kind: "fact",
        label,
        value,
        ...optional<object>("sub", sub),
        ...optional<object>("note", note),
        ...(tone ? { tone } : {}),
      },
    };
  }
  if (a.kind === "list") {
    const title = plainForDevice(a.title, 24);
    const rows = (Array.isArray(a.rows) ? a.rows : [])
      .slice(0, 5)
      .map((row) => {
        const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
        const label = plainForDevice(r.label, 26);
        const value = plainForDevice(r.value, 12);
        return label ? { label, ...(value ? { value } : {}) } : undefined;
      })
      .filter((row): row is { label: string; value?: string } => Boolean(row));
    if (!title || !rows.length)
      return { error: "A list card needs a short title and one to five rows." };
    return { card: { kind: "list", title, rows } };
  }
  return { error: "kind must be score, fact or list." };
}

/**
 * What goes over the wire to the device: flat keys only (the device reads them with a tiny parser, no
 * JSON library), so a list's rows are l0/v0 … l4/v4 and a score's sides are an/as and hn/hs.
 */
export function deviceWire(card: DeviceCard): Record<string, unknown> {
  if (card.kind === "score")
    return {
      kind: "score",
      ...(card.league ? { league: card.league } : {}),
      ...(card.status ? { status: card.status } : {}),
      an: card.away.name,
      ...(card.away.score !== undefined ? { as: card.away.score } : {}),
      hn: card.home.name,
      ...(card.home.score !== undefined ? { hs: card.home.score } : {}),
    };
  if (card.kind === "list") {
    const wire: Record<string, unknown> = { kind: "list", title: card.title, n: card.rows.length };
    card.rows.forEach((row, i) => {
      wire[`l${i}`] = row.label;
      if (row.value) wire[`v${i}`] = row.value;
    });
    return wire;
  }
  return { ...card };
}

/** Any card the device can draw, from a tool result's `card` (weather's or a shown card's). */
export function deviceCardFromLoose(raw: unknown): DeviceCard | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  if ((raw as { kind?: unknown }).kind === "weather") return weatherDeviceCard(raw);
  const built = buildDeviceCard(raw);
  return "card" in built ? built.card : undefined;
}
