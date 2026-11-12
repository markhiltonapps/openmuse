import {
  plainForDevice,
  weatherDeviceCard,
  weatherIconFor,
} from "../../../packages/domain/src/device-card.ts";
import type { TodayCalendar } from "./calendar-today.ts";
import { type Device, settingsOf } from "./devices.ts";
import type { WeatherService } from "./weather.ts";

export interface IdleDeps {
  timeZone: (owner: string) => Promise<string>;
  weather: () => WeatherService | undefined;
  calendar: (owner: string, from: string, to: string) => Promise<TodayCalendar | undefined>;
  now?: () => number;
}

/** Minutes the person's clock is ahead of UTC at an instant (negative in the Americas). */
export function zoneOffsetMinutes(ms: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), ms);
      timer.unref?.();
    }),
  ]).catch(() => undefined);

/**
 * What a device's idle screen needs, as flat keys the device reads with a tiny parser: the time (so it keeps its
 * own clock in the person's zone), the weather in brief and the next meeting, plus its settings.
 * Weather and calendar are best effort: whatever can't be read is left out and the screen leaves it out.
 */
export async function idleInfo(deps: IdleDeps, owner: string, device: Device) {
  const settings = settingsOf(device);
  const nowMs = (deps.now ?? Date.now)();
  const zone = await deps.timeZone(owner).catch(() => "UTC");
  const info: Record<string, unknown> = {
    type: "idle",
    t: Math.floor(nowMs / 1000),
    off: zoneOffsetMinutes(nowMs, zone),
    after: settings.idleAfter,
    dim: settings.dim ? 1 : 0,
    da: settings.dimAfter,
    sw: settings.showWeather ? 1 : 0,
    sm: settings.showMeeting ? 1 : 0,
    sb: settings.showBattery ? 1 : 0,
    fps: settings.animation === "saver" ? 0 : settings.animation === "smooth" ? 2 : 1,
    face: settings.face === "analog" ? 1 : settings.face === "neon" ? 2 : 0,
    rw: settings.raiseToWake ? 1 : 0,
    vol: settings.volume,
    bs: settings.batterySaver ? 1 : 0,
  };
  const [forecast, calendar] = await Promise.all([
    settings.idleAfter && settings.showWeather
      ? within(deps.weather()?.forOwner(owner) ?? Promise.resolve(undefined), 6000)
      : undefined,
    settings.idleAfter && settings.showMeeting
      ? within(
          deps.calendar(
            owner,
            new Date(nowMs).toISOString(),
            new Date(nowMs + 24 * 3_600_000).toISOString(),
          ),
          8000,
        )
      : undefined,
  ]);
  if (forecast && "weather" in forecast) {
    const w = forecast.weather;
    const card = weatherDeviceCard({
      place: w.place,
      temp: w.now.temp,
      sky: w.now.sky,
      icon: weatherIconFor(w.now.emoji),
      high: w.today.high,
      low: w.today.low,
      rain: w.today.rain,
    });
    if (card) {
      info.wt = card.temp;
      info.ws = card.sky;
      info.wi = card.icon;
      if (card.high !== undefined) info.wh = card.high;
      if (card.low !== undefined) info.wl = card.low;
    }
  }
  if (calendar && calendar.checked.length) {
    // The first timed event that hasn't ended, soonest first (one in progress counts).
    const next = calendar.events
      .filter((event) => !event.allDay && Date.parse(event.end) > nowMs)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    info.mc = 1;
    if (next) {
      info.mt = plainForDevice(next.title, 28) || "Meeting";
      info.ms = Math.floor(Date.parse(next.start) / 1000);
      info.me = Math.floor(Date.parse(next.end) / 1000);
    }
  }
  return info;
}
