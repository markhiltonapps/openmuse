import assert from "node:assert/strict";
import { test } from "node:test";
import { openTableLink, restaurantToolSpecs } from "../apps/server/src/restaurants.ts";

test("find_table opens OpenTable with the date, time and party size filled in", async () => {
  const request = {
    restaurant: "Uchi",
    area: "Austin",
    date: "2026-10-03",
    time: "19:30",
    partySize: 4,
  };
  assert.equal(
    openTableLink(request),
    "https://www.opentable.com/s?covers=4&dateTime=2026-10-03T19%3A30&term=Uchi+Austin",
  );
  // The restaurant's own page when it's known; anything that isn't OpenTable is ignored.
  assert.equal(
    openTableLink({ ...request, opentableUrl: "https://www.opentable.com/r/uchi-austin?ref=1" }),
    "https://www.opentable.com/r/uchi-austin?ref=1&covers=4&dateTime=2026-10-03T19%3A30",
  );
  assert.match(
    openTableLink({ ...request, opentableUrl: "https://evil.test/r/uchi" }),
    /^https:\/\/www\.opentable\.com\/s\?/,
  );
  const opened: string[] = [];
  const [tool] = restaurantToolSpecs(async (url) => {
    opened.push(url);
    return { url, title: "Uchi", text: "7:15 PM 7:30 PM 7:45 PM", sessionId: "s1" };
  });
  const result = await tool?.execute(request);
  assert.equal(opened.length, 1);
  assert.equal(result?.booked, false);
  assert.equal(result?.text, "7:15 PM 7:30 PM 7:45 PM");
});
