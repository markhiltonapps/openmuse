/**
 * When the sun rises and sets at a spot, worked out from its coordinates alone (the standard
 * "sunrise equation": no service, no key, good to a minute or two). The day is the spot's own
 * calendar date, "2026-11-07", so the answer is for the local day however far east or west it is.
 */
export interface SunTimes {
  /** Milliseconds since 1970, or undefined when the sun doesn't rise or set that day. */
  sunrise?: number;
  sunset?: number;
  /** The sun stays up or down all day (near the poles). */
  always?: "up" | "down";
}

const RAD = Math.PI / 180;
const DAY = 86_400_000;
/** Julian date of 1970-01-01T00:00Z. */
const UNIX_EPOCH_JD = 2440587.5;

export function sunTimes(lat: number, lng: number, localDate: string): SunTimes {
  // Noon UTC on that date: the day count the equation wants.
  const noon = Date.parse(`${localDate}T12:00:00Z`);
  if (Number.isNaN(noon) || lat < -90 || lat > 90) return {};
  const jd = noon / DAY + UNIX_EPOCH_JD;
  // Whole days since the year 2000 began at noon UTC; our date is already at noon UTC.
  const n = Math.round(jd - 2451545.0);
  // Mean solar time at this longitude (east is positive).
  const meanSolarTime = n - lng / 360;
  const anomaly = (357.5291 + 0.98560028 * meanSolarTime) % 360;
  const center =
    1.9148 * Math.sin(anomaly * RAD) +
    0.02 * Math.sin(2 * anomaly * RAD) +
    0.0003 * Math.sin(3 * anomaly * RAD);
  const eclipticLongitude = (anomaly + center + 180 + 102.9372) % 360;
  const transit =
    2451545.0 +
    meanSolarTime +
    0.0053 * Math.sin(anomaly * RAD) -
    0.0069 * Math.sin(2 * eclipticLongitude * RAD);
  const sinDeclination = Math.sin(eclipticLongitude * RAD) * Math.sin(23.4397 * RAD);
  const declination = Math.asin(sinDeclination);
  // The sun's centre at 0.833° below the horizon: its edge on the horizon, with refraction.
  const cosHourAngle =
    (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDeclination) /
    (Math.cos(lat * RAD) * Math.cos(declination));
  if (cosHourAngle > 1) return { always: "down" };
  if (cosHourAngle < -1) return { always: "up" };
  const hourAngle = Math.acos(cosHourAngle) / RAD;
  const toMs = (julian: number) => Math.round((julian - UNIX_EPOCH_JD) * DAY);
  return {
    sunrise: toMs(transit - hourAngle / 360),
    sunset: toMs(transit + hourAngle / 360),
  };
}
