import assert from "node:assert/strict";
import { test } from "node:test";
import { directionsUrl, fitMap, project, tileUrl } from "../src/map-math.ts";

test("places land on the right tiles and inside the map", () => {
  // Null Island sits at the middle of the world.
  assert.deepEqual(project(0, 0, 0), { x: 128, y: 128 });
  const austin = [
    { lat: 30.2672, lng: -97.7431 },
    { lat: 30.2849, lng: -97.7341 },
    { lat: 30.25, lng: -97.75 },
  ];
  const map = fitMap(austin, 360, 200);
  assert.ok(map);
  assert.ok(map.zoom >= 12 && map.zoom <= 15, `zoom ${map.zoom}`);
  for (const pin of map.pins) {
    assert.ok(pin.x >= 36 - 0.5 && pin.x <= 360 - 36 + 0.5, `x ${pin.x}`);
    assert.ok(pin.y >= 36 - 0.5 && pin.y <= 200 - 36 + 0.5, `y ${pin.y}`);
  }
  // The tiles cover the whole map, with nothing missing.
  const covers = (x: number, y: number) =>
    map.tiles.some((t) => x >= t.left && x < t.left + 256 && y >= t.top && y < t.top + 256);
  for (const [x, y] of [
    [0, 0],
    [359, 0],
    [0, 199],
    [359, 199],
    [180, 100],
  ])
    assert.ok(covers(x as number, y as number), `${x},${y} uncovered`);
  // One place gets a street-level view.
  assert.equal(fitMap([austin[0] as { lat: number; lng: number }], 360, 200)?.zoom, 15);
  // Places far apart zoom right out.
  const far = fitMap(
    [
      { lat: 40.7, lng: -74 },
      { lat: 34, lng: -118.2 },
    ],
    360,
    200,
  );
  assert.ok(far && far.zoom <= 4);
  assert.equal(fitMap([], 360, 200), undefined);
  assert.match(tileUrl(3, 1, 2, false), /voyager\/3\/1\/2\.png$/);
  assert.match(directionsUrl({ lat: 1, lng: 2, name: "A & B" }, true), /daddr=1,2&q=A%20%26%20B/);
});
