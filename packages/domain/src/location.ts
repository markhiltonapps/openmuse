/** Where things are, in plain words: shared by the server's tools and the app's cards. */

/** Straight-line meters between two spots (the haversine formula). */
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** "about 300 ft" or "about 0.4 mi". */
export function distanceWords(meters: number) {
  const feet = meters * 3.281;
  return feet < 1000
    ? `about ${Math.max(50, Math.round(feet / 50) * 50)} ft`
    : `about ${(meters / 1609.34).toFixed(1)} mi`;
}

/** The distance with a rough walking time (a straight line at 3 mph, not a route). */
export function walkingWords(meters: number) {
  const minutes = Math.round(meters / 80);
  return minutes < 2
    ? `${distanceWords(meters)}, a minute’s walk`
    : `${distanceWords(meters)}, a ${minutes}-minute walk`;
}

/** "just now", "35 minutes ago", "2 hours ago", "3 days ago". */
export function agoWords(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 90) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Maps links that work on any phone or computer: the spot itself, and walking directions to it. */
export const mapLink = (spot: { lat: number; lng: number }) =>
  `https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lng}`;
export const directionsLink = (spot: { lat: number; lng: number }) =>
  `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}&travelmode=walking`;

/**
 * A rough time to drive between two spots from the straight-line distance: the road is about a third
 * longer than the line, at a speed that grows with the trip. No live traffic, so it is always said
 * as "about" and as an estimate. Rounded to the minute, then to five minutes from ten up.
 */
export function driveMinutes(meters: number) {
  const road = meters * 1.3;
  const speed = road < 8_000 ? 11.2 : road < 40_000 ? 15.6 : 22.4;
  const minutes = Math.max(1, Math.round(road / speed / 60));
  return minutes >= 10 ? Math.round(minutes / 5) * 5 : minutes;
}

/** "12.4 mi" (one decimal; "0.8 mi" for short drives). */
export const milesWords = (meters: number) => `${(meters / 1609.34).toFixed(1)} mi`;

/** The year, month, day and clock of a moment in a time zone. */
function zoned(ms: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return parts;
}

/** The moment a local day began, in the person's time zone (never from UTC's day). */
export function localDayStart(ms: number, timeZone: string) {
  const p = zoned(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = asUtc - Math.floor(ms / 1000) * 1000;
  return Date.UTC(p.year, p.month - 1, p.day) - offset;
}

export type MileagePeriod = "today" | "week" | "month" | "year" | "all";
/** Where a period begins in their calendar: today, the last 7 days, this month, this year. */
export function periodStart(period: MileagePeriod, now: number, timeZone: string) {
  if (period === "all") return 0;
  const dayMs = 86_400_000;
  const today = localDayStart(now, timeZone);
  if (period === "today") return today;
  if (period === "week") return localDayStart(today - 6 * dayMs + 12 * 3_600_000, timeZone);
  const p = zoned(now, timeZone);
  const back =
    period === "month"
      ? p.day - 1
      : Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 1)) / dayMs);
  return localDayStart(today - back * dayMs + 12 * 3_600_000, timeZone);
}

/** A date in the person's calendar: "2026-11-08". */
export function localDate(ms: number, timeZone: string) {
  const p = zoned(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
