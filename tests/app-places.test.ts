import assert from "node:assert/strict";
import { test } from "node:test";
import { showInAppInstructions, showInAppToolSpec } from "../apps/server/src/app-guide.ts";
import {
  APP_PLACES,
  appPlaceIds,
  placeWhere,
  showInAppSchema,
} from "../packages/domain/src/app-places.ts";

test("take-me-there: the tool keeps only known places and the details each one uses", async () => {
  const spec = showInAppToolSpec();
  const input = spec.parameters.parse({
    places: [
      { place: "health-food-log", range: "week", tab: "past", id: "x" },
      { place: "reminders", range: "today" },
    ],
    go: true,
  });
  assert.deepEqual(await spec.execute(input), {
    places: [{ place: "health-food-log", range: "week" }, { place: "reminders" }],
    go: true,
  });
  // A saved result keeps its id; plans keep their tab.
  assert.deepEqual(
    await spec.execute(
      spec.parameters.parse({
        places: [
          { place: "saved", id: "report-1" },
          { place: "plans", tab: "past" },
        ],
      }),
    ),
    {
      places: [
        { place: "saved", id: "report-1" },
        { place: "plans", tab: "past" },
      ],
    },
  );
});

test("take-me-there: a place that isn't in the app, or more than two, is refused", () => {
  assert.equal(showInAppSchema.safeParse({ places: [{ place: "settings" }] }).success, false);
  assert.equal(showInAppSchema.safeParse({ places: [] }).success, false);
  assert.equal(
    showInAppSchema.safeParse({
      places: [{ place: "feed" }, { place: "goals" }, { place: "files" }],
    }).success,
    false,
  );
});

test("take-me-there: the way there reads as the app names it", () => {
  assert.equal(
    placeWhere({ place: "health-food-log", range: "week" }),
    "Spaces › Health · This week",
  );
  assert.equal(
    placeWhere({ place: "health-food-log", range: "month" }),
    "Spaces › Health · 30 days",
  );
  assert.equal(placeWhere({ place: "plans", tab: "past" }), "Feed · Past");
  assert.equal(placeWhere({ place: "money" }), "Apps");
});

test("take-me-there: the agent is told every place and when to use a button", () => {
  const { description } = showInAppToolSpec();
  for (const id of appPlaceIds) assert.ok(description.includes(`${id} (`), id);
  assert.equal(Object.keys(APP_PLACES).length, appPlaceIds.length);
  assert.match(showInAppInstructions, /go: true/);
  assert.match(showInAppInstructions, /At most two places/);
});
