import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeTranscripts } from "../src/transcript.ts";

test("repeated partial phrases become one sentence", () => {
  assert.equal(
    mergeTranscripts(["This", "This is", "This is a", "This is a", "This is a test"]),
    "This is a test",
  );
  assert.equal(
    mergeTranscripts(["this is a test", "This is a test.", " this is a "]),
    "This is a test.",
  );
});

test("separate phrases are kept in order", () => {
  assert.equal(
    mergeTranscripts(["Book a table", "for two at seven"]),
    "Book a table for two at seven",
  );
  assert.equal(mergeTranscripts(["", "  "]), "");
});
