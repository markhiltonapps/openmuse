import assert from "node:assert/strict";
import { test } from "node:test";
import { judgmentDay, parseVerdict } from "../apps/server/src/watch-judge.ts";

test("a clear yes or no is read, even with words around it", () => {
  assert.deepEqual(parseVerdict('{"met": true, "why": "The page says Medium: in stock."}'), {
    met: true,
    why: "The page says Medium: in stock.",
  });
  assert.equal(
    parseVerdict('Sure! {"met": false, "why": "Sold out."} Hope that helps.').met,
    false,
  );
});

test("anything unclear counts as not met", () => {
  assert.equal(parseVerdict("yes").met, false);
  assert.equal(parseVerdict('{"met": "true"}').met, false);
  assert.equal(parseVerdict("").met, false);
  assert.equal(parseVerdict('{"met": true}').why, "");
});

test("the reason is kept short and on one line", () => {
  const long = parseVerdict(`{"met": true, "why": "${"line one\n".repeat(100)}"}`);
  assert.ok(long.why.length <= 240);
  assert.ok(!long.why.includes("\n"));
});

test("the daily limit resets at midnight UTC", () => {
  assert.equal(judgmentDay(new Date("2026-10-23T23:59:59Z")), "2026-10-23");
  assert.equal(judgmentDay(new Date("2026-10-24T00:00:01Z")), "2026-10-24");
});
