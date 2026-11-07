import assert from "node:assert/strict";
import { test } from "node:test";
import { AnswerTags } from "../src/unchanged.ts";

test("a tagged answer is sent back as the same object on 304", () => {
  const tags = new AnswerTags();
  const answer = { tasks: [1, 2] };
  tags.keep("/api/agent", '"abc"', answer);
  assert.equal(tags.tag("/api/agent"), '"abc"');
  assert.equal(
    tags.unchanged("/api/agent"),
    answer,
    "the very same object, so React sees no change",
  );
  // An answer without a tag forgets the address: the next ask carries no tag.
  tags.keep("/api/agent", null, { tasks: [] });
  assert.equal(tags.tag("/api/agent"), undefined);
  assert.equal(tags.unchanged("/api/agent"), undefined);
});

test("only the newest addresses are kept", () => {
  const tags = new AnswerTags(2);
  tags.keep("/a", '"1"', 1);
  tags.keep("/b", '"2"', 2);
  tags.keep("/c", '"3"', 3);
  assert.equal(tags.tag("/a"), undefined, "the oldest is forgotten");
  assert.equal(tags.tag("/c"), '"3"');
  // Asking again for a kept address makes it the newest.
  tags.keep("/b", '"2b"', 2);
  tags.keep("/d", '"4"', 4);
  assert.equal(tags.tag("/c"), undefined);
  assert.equal(tags.tag("/b"), '"2b"');
});
