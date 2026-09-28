import assert from "node:assert/strict";
import { test } from "node:test";
import { replyFailure } from "../src/conversation-run.ts";

test("the chat's bookkeeping errors read as a plain retry hint", () => {
  assert.equal(
    replyFailure(
      new Error(
        "Cannot send event type 'TEXT_MESSAGE_START': The run has already errored with 'RUN_ERROR'. No further events can be sent.",
      ),
    ),
    "That reply didn't go through. Tap Retry response to try again.",
  );
});

test("a model error keeps its own words without the JSON around them", () => {
  const error = new Error(
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
  );
  assert.equal(replyFailure(error), "Your credit balance is too low to access the Anthropic API.");
  assert.equal(
    replyFailure("The conversation is not ready yet."),
    "The conversation is not ready yet.",
  );
});
