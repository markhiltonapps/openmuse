import assert from "node:assert/strict";
import test from "node:test";
import { lookedAt } from "../src/receipt-text.ts";

test("each place is listed once, in the order it was looked at", () => {
  assert.deepEqual(lookedAt(["search_mail", "look_at_calendar", "read_mail_thread"]), [
    "Your email",
    "Your calendar",
  ]);
});

test("cards and saves look nothing up, so they add nothing", () => {
  assert.deepEqual(lookedAt(["show_in_app", "save_about_person", "set_reminder", "log_meal"]), []);
});

test("a tool the list doesn't know is never hidden: it says other tools were used", () => {
  assert.deepEqual(lookedAt(["get_weather", "some_new_reader"]), [
    "The weather",
    "Other tools I used",
  ]);
});
