import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDollars, parseTime } from "../src/space-input.ts";

test("a digest time can be typed the way people say it", () => {
  assert.equal(parseTime("8:45"), "08:45");
  assert.equal(parseTime("845"), "08:45");
  assert.equal(parseTime("9am"), "09:00");
  assert.equal(parseTime("9:30 pm"), "21:30");
  assert.equal(parseTime("12 a.m."), "00:00");
  assert.equal(parseTime("12pm"), "12:00");
  assert.equal(parseTime("18:00"), "18:00");
  assert.equal(parseTime("25:00"), null);
  assert.equal(parseTime("13pm"), null);
  assert.equal(parseTime("9:75"), null);
  assert.equal(parseTime("soon"), null);
});

test("a daily ad limit reads a decimal comma as cents, never as thousands", () => {
  assert.equal(parseDollars(""), null);
  assert.equal(parseDollars("20"), 20);
  assert.equal(parseDollars("$12.50"), 12.5);
  assert.equal(parseDollars("12,50"), 12.5);
  assert.equal(parseDollars("12,5"), 12.5);
  assert.equal(parseDollars("$1,250"), 1250);
  assert.ok(Number.isNaN(parseDollars("twenty") as number));
  assert.ok(Number.isNaN(parseDollars("-5") as number));
  assert.ok(Number.isNaN(parseDollars("1.2.3") as number));
});
