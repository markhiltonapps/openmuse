import assert from "node:assert/strict";
import { test } from "node:test";
import { plainText } from "../packages/domain/src/plain-text.ts";

test("plain text: a result reads as plain words in a preview or a phone notification", () => {
  // Headings are left out when there's more; every line but the last ends with a stop.
  assert.equal(
    plainText(
      "## Today\n\n**91°, mostly sunny**, storms after 3 PM\n\n## Your calendar\n- **9:30 AM** Dentist\n- *4:30 PM* School pickup",
    ),
    "91°, mostly sunny, storms after 3 PM.\n9:30 AM Dentist.\n4:30 PM School pickup",
  );
  // Quotes, rules, links, images, code and tables.
  assert.equal(
    plainText(
      "> Heads up: rain\n\n---\n\nSee [the list](https://example.com) ![map](https://x.example/m.png)\n\n| Day | Dinner |\n|---|---|\n| Mon | `tacos` |",
    ),
    "Heads up: rain.\nSee the list.\nDay · Dinner.\nMon · tacos",
  );
  // No stop after a comma or dash that ends a line.
  assert.equal(
    plainText("Hi Maria,\nSee you Saturday -\nBest,\nTodd"),
    "Hi Maria,\nSee you Saturday -\nBest,\nTodd",
  );
  // Only headings: they're the words there are.
  assert.equal(plainText("# Done"), "Done");
  // Arithmetic and snake_case are left alone; a one-line result gets no added stop.
  assert.equal(plainText("5 * 3 * 2 = 30 for my_file_name"), "5 * 3 * 2 = 30 for my_file_name");
  assert.equal(
    plainText("Saved to local sent mail · 1f2e"),
    "Reply saved in your local Sent mail.",
  );
});
