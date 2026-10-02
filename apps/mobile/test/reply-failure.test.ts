import assert from "node:assert/strict";
import { test } from "node:test";
import { replyFailure, runConversationTurn } from "../src/conversation-run.ts";

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

test("a failed reply keeps its real reason, not the bookkeeping error after it", async () => {
  let listener: (event: { error: unknown }) => void = () => undefined;
  const turn = runConversationTurn(
    "default",
    async () => {
      listener({
        error: new Error(
          '400 {"error":{"message":"tool_use ids were found without tool_result blocks"}}',
        ),
      });
      listener({
        error: new Error("Cannot send event type 'RUN_STARTED': The run has already errored"),
      });
    },
    (next) => {
      listener = next;
      return { unsubscribe: () => undefined };
    },
  );
  await assert.rejects(turn, (error: Error) => {
    assert.equal(replyFailure(error), "tool_use ids were found without tool_result blocks");
    return true;
  });
});
