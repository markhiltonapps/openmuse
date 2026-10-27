import assert from "node:assert/strict";
import { test } from "node:test";
import { argumentShape } from "../apps/server/src/actions.ts";
import { declinedInside } from "../apps/server/src/apps.ts";
import { mailMoveInstructions } from "../apps/server/src/engine/mailboxes.ts";

test("an app's own 'it didn't work' is not recorded as done", () => {
  assert.equal(declinedInside({ successful: false, error: "Label not found" }), "Label not found");
  assert.equal(
    declinedInside({ successful: false, message: "Invalid label id" }),
    "Invalid label id",
  );
  assert.equal(declinedInside({ successful: false }), "The app said it didn't work.");
  // Answers that worked, or that don't say, are left alone.
  assert.equal(declinedInside({ successful: true, data: {} }), undefined);
  assert.equal(declinedInside({ messages: [] }), undefined);
  assert.equal(declinedInside([{ successful: false }]), undefined);
  assert.equal(declinedInside(null), undefined);
  assert.equal(declinedInside("ok"), undefined);
});

test("the log shows which arguments a step carried and how many, never their values", () => {
  assert.equal(
    argumentShape({
      messageIds: ["a", "b", "c"],
      addLabelIds: ["Label_12"],
      removeLabelIds: ["INBOX"],
    }),
    "[messageIds×3, addLabelIds×1, removeLabelIds×1]",
  );
  assert.equal(argumentShape({ name: "Receipts" }), "[name]");
  assert.equal(argumentShape(undefined), "[]");
  assert.ok(!argumentShape({ messageIds: ["secret-id"] }).includes("secret-id"));
});

test("the move instructions cover what a mail move needs", () => {
  // Gmail: list the labels first, one create, ids not names, take INBOX off, check afterwards.
  assert.match(mailMoveInstructions, /list the labels/);
  assert.match(mailMoveInstructions, /one create call, never two/);
  assert.match(mailMoveInstructions, /the label's id[^.]*not its name/);
  assert.match(mailMoveInstructions, /“INBOX” to remove/);
  assert.match(mailMoveInstructions, /not thread ids/);
  // Outlook: the folder's id, in batches.
  assert.match(mailMoveInstructions, /Outlook, list the mail folders/);
  // It says what really happened.
  assert.match(mailMoveInstructions, /real counts/);
  assert.match(mailMoveInstructions, /never say it's done on a guess/);
});
