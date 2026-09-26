import assert from "node:assert/strict";
import { test } from "node:test";
import { speakableChunks } from "../src/speakable.ts";

test("replies are read aloud without Markdown, links or code", () => {
  const chunks = speakableChunks(
    "## Short answer\n\n**Luigi's** is open until *10 pm*. See [their site](https://luigis.example/hours) or https://maps.example/x.\n\n- Pizzas from $14\n- Pasta from $12\n\n```js\nconsole.log(1)\n```",
  );
  const spoken = chunks.join(" ");
  assert.doesNotMatch(spoken, /[*#`[\]]|https?:/);
  assert.match(
    spoken,
    /^Short answer\. Luigi's is open until 10 pm\. See their site or the link\./,
  );
  assert.match(spoken, /Pizzas from \$14\. Pasta from \$12\./);
  assert.match(spoken, /code shown on screen/);
});

test("long replies are split into short pieces and capped", () => {
  const sentence = "This sentence is about forty characters. ";
  const chunks = speakableChunks(sentence.repeat(200));
  assert.ok(chunks.every((chunk) => chunk.length <= 220));
  assert.match(chunks.at(-1) ?? "", /The rest is on screen\.$/);
  assert.ok(chunks.join(" ").length < 2600);
  const word = "x".repeat(500);
  assert.ok(speakableChunks(word).every((chunk) => chunk.length <= 220));
  assert.deepEqual(speakableChunks("   "), []);
});
