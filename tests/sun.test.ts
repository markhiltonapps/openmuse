import assert from "node:assert/strict";
import { test } from "node:test";
import { sunTimes } from "../packages/domain/src/sun.ts";

const minutes = (ms: number | undefined, iso: string) =>
  Math.abs((ms ?? 0) - Date.parse(iso)) / 60_000;

test("sunrise and sunset match the published times to within a few minutes", () => {
  // London's longest day: 04:43 and 21:21 summer time, so 03:43 and 20:21 UTC.
  const london = sunTimes(51.4779, -0.0015, "2026-06-21");
  assert.ok(minutes(london.sunrise, "2026-06-21T03:43:00Z") < 5, "London sunrise");
  assert.ok(minutes(london.sunset, "2026-06-21T20:21:00Z") < 5, "London sunset");
  // The equator at the equinox: close to 12 hours of daylight, centred on local noon.
  const equator = sunTimes(0, 0, "2026-03-20");
  const hours = ((equator.sunset ?? 0) - (equator.sunrise ?? 0)) / 3_600_000;
  assert.ok(hours > 12 && hours < 12.2, `equator day length ${hours}`);
  // West of Greenwich the sun sets on the next UTC date, but it is still that local day's sunset.
  const houston = sunTimes(29.76, -95.37, "2026-11-07");
  assert.ok((houston.sunset ?? 0) > (houston.sunrise ?? 0));
  assert.ok(new Date(houston.sunset ?? 0).getUTCHours() >= 22);
});

test("near the poles the sun can stay up or down all day", () => {
  assert.deepEqual(sunTimes(69.65, 18.96, "2026-06-21"), { always: "up" });
  assert.deepEqual(sunTimes(69.65, 18.96, "2026-12-21"), { always: "down" });
  assert.deepEqual(sunTimes(95, 0, "2026-06-21"), {});
  assert.deepEqual(sunTimes(10, 10, "not a date"), {});
});
