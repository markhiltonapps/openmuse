import assert from "node:assert/strict";
import { test } from "node:test";
import { judgmentDay, parseVerdict, steadyText } from "../apps/server/src/watch-judge.ts";

test("a clear yes or no is read, even with words around it", () => {
  assert.deepEqual(parseVerdict('{"met": true, "why": "The page says Medium: in stock."}'), {
    met: true,
    readable: true,
    why: "The page says Medium: in stock.",
  });
  assert.equal(
    parseVerdict('Sure! {"met": false, "why": "Sold out."} Hope that helps.')?.met,
    false,
  );
});

test("a reply that isn't an answer is nothing at all, so the page is looked at again", () => {
  assert.equal(parseVerdict("yes"), undefined);
  assert.equal(parseVerdict('{"met": "true"}'), undefined);
  assert.equal(parseVerdict(""), undefined);
  assert.equal(parseVerdict('{"met": true}')?.why, "");
});

test("a page that can't be read says so", () => {
  const blocked = parseVerdict(
    '{"readable": false, "met": false, "why": "It asks you to sign in."}',
  );
  assert.equal(blocked?.readable, false);
  assert.equal(parseVerdict('{"met": true}')?.readable, true);
});

test("the reason is kept short and on one line", () => {
  const long = parseVerdict(`{"met": true, "why": "${"line one\\n".repeat(100)}"}`);
  assert.ok((long?.why.length ?? 0) <= 240);
  assert.ok(!long?.why.includes("\n"));
});

test("clocks and dates don't make a page look changed, but stock words do", () => {
  const before = steadyText("Updated 10:42 AM on Oct 23, 2026 · 2026-10-23 · Medium: sold out");
  const later = steadyText("Updated 11:07 AM on Oct 24, 2026 · 2026-10-24 · Medium: sold out");
  assert.equal(before, later);
  assert.notEqual(before, steadyText("Updated 11:07 AM on Oct 24, 2026 · Medium: 3 left"));
});

test("the daily limit resets at midnight UTC", () => {
  assert.equal(judgmentDay(new Date("2026-10-23T23:59:59Z")), "2026-10-23");
  assert.equal(judgmentDay(new Date("2026-10-24T00:00:01Z")), "2026-10-24");
});
