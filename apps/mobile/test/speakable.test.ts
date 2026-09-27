import assert from "node:assert/strict";
import { test } from "node:test";
import { replyText, SpokenReply, speakableChunks, speakableEnd } from "../src/speakable.ts";

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

/** Feeds a reply in a few characters at a time, collecting what's ready to say after each part. */
function stream(markdown: string, step = 3) {
  const reply = new SpokenReply();
  const said: { at: number; text: string }[] = [];
  const drain = (at: number) => {
    for (let piece = reply.next(); piece !== undefined; piece = reply.next())
      said.push({ at, text: piece });
  };
  for (let at = step; at < markdown.length; at += step) {
    reply.update(markdown.slice(0, at));
    drain(at);
  }
  reply.update(markdown, true);
  drain(markdown.length);
  return said;
}

test("a reply starts being read out as soon as its first sentence is written", () => {
  const markdown =
    "Sure, Dr. Patel is free at 3 pm. **Here's** what I found:\n\n1. The clinic opens at 9.\n2. Parking is free.\n\n```\nnot read\n```\nThat's all!";
  const said = stream(markdown);
  const first = said[0];
  assert.equal(first?.text, "Sure, Dr. Patel is free at 3 pm.");
  assert.ok((first?.at ?? Infinity) < markdown.indexOf("Here"), "before the rest is written");
  assert.ok(
    said.every(({ text }) => !/^\d+\.$/.test(text)),
    "list numbers aren't read alone",
  );
  assert.equal(
    said.map(({ text }) => text).join(" "),
    speakableChunks(markdown).join(" "),
    "the same words as reading the finished reply",
  );
  const code = said.find(({ text }) => text.includes("code shown on screen"));
  assert.ok((code?.at ?? 0) > markdown.lastIndexOf("```"), "code is skipped once it has closed");
});

test("the reply's text spans the messages written around tool calls", () => {
  const writing = [
    { role: "user", content: "What's on today?" },
    { role: "assistant", content: "Let me check your calendar.", toolCalls: [{ id: "1" }] },
    { role: "tool", content: "{}" },
    { role: "assistant", content: "You have two meetings" },
  ];
  assert.equal(replyText(writing), "Let me check your calendar.\n\nYou have two meetings");
  // The first message is read out before the tool runs, even with no text after it yet.
  assert.equal(
    speakableEnd(replyText(writing.slice(0, 2))),
    "Let me check your calendar.\n\n".length,
  );
  assert.equal(speakableEnd("Still writing this"), 0);
  assert.equal(speakableEnd("Still writing this", true), 18);
});

test("long replies read as they're written still stop at the limit", () => {
  const said = stream("This sentence is about forty characters. ".repeat(200), 50);
  const spoken = said.map(({ text }) => text).join(" ");
  assert.match(spoken, /The rest is on screen\.$/);
  assert.ok(spoken.length < 2600);
  assert.ok(said.every(({ text }) => text.length <= 220));
});
