import assert from "node:assert/strict";
import { test } from "node:test";
import { plainText } from "../src/copy-text.ts";

test("a copied reply keeps its words and shape, without formatting marks", () => {
  assert.equal(
    plainText(
      [
        "## Your day",
        "",
        "You have **two meetings** and a _dentist_ visit:",
        "- 9:00 · [Budget review](https://teams.example/abc)",
        "- 2:30 · `Dentist`",
        "",
        "| Meal | kcal |",
        "| --- | --- |",
        "| Lunch | 540 |",
        "",
        "See https://example.com for more.",
      ].join("\n"),
    ),
    [
      "Your day",
      "",
      "You have two meetings and a dentist visit:",
      "• 9:00 · Budget review (https://teams.example/abc)",
      "• 2:30 · Dentist",
      "",
      "Meal  kcal",
      "",
      "Lunch  540",
      "",
      "See https://example.com for more.",
    ].join("\n"),
  );
  assert.equal(plainText("snake_case_name stays"), "snake_case_name stays");
  assert.equal(plainText("```\nprint(1)\n```"), "print(1)");
  // Code is copied exactly as written.
  assert.equal(
    plainText(
      [
        "Run this:",
        "```bash",
        "ps aux | grep node",
        "# start again",
        "- item: yes",
        "```",
        "Then call `__init__` and `a | b`.",
      ].join("\n"),
    ),
    [
      "Run this:",
      "ps aux | grep node",
      "# start again",
      "- item: yes",
      "Then call __init__ and a | b.",
    ].join("\n"),
  );
});
