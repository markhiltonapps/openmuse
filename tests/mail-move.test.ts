import assert from "node:assert/strict";
import { test } from "node:test";
import { argumentShape } from "../apps/server/src/actions.ts";
import { declinedInside } from "../apps/server/src/apps.ts";
import { unwrapCardIds } from "../apps/server/src/email-views.ts";
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
  // Gmail: one tool that adds the label and takes INBOX off; ids from a read, never a card's.
  assert.match(mailMoveInstructions, /always use move_gmail_to_folder/);
  assert.match(mailMoveInstructions, /never build the move yourself with use_app/);
  assert.match(mailMoveInstructions, /not thread ids/);
  assert.match(mailMoveInstructions, /never an email card's `id`/);
  assert.match(mailMoveInstructions, /one create call, never two/);
  // Outlook: the folder's id, in batches.
  assert.match(mailMoveInstructions, /Outlook: list the mail folders/);
  // It says what really happened.
  assert.match(mailMoveInstructions, /real counts/);
  assert.match(mailMoveInstructions, /never say it's done on a guess/);
  // Mail that arrives later needs a lasting rule, not another move.
  assert.match(mailMoveInstructions, /offer a Gmail filter/);
  assert.match(mailMoveInstructions, /won't catch mail that arrives later/);
});

test("a card's own id given as an email id is swapped for the mailbox's real id", async () => {
  const card = "a".repeat(32);
  const asked: string[] = [];
  const find = async (id: string) => {
    asked.push(id);
    return id === card ? { messageId: "18f3a2b4c5d6e7f8" } : undefined;
  };
  const fixed = await unwrapCardIds(
    { ids: [card, "18f3a2b4c5d6e7f9"], addLabelIds: ["Label_12"], removeLabelIds: ["INBOX"] },
    find,
  );
  assert.deepEqual(fixed, {
    ids: ["18f3a2b4c5d6e7f8", "18f3a2b4c5d6e7f9"],
    addLabelIds: ["Label_12"],
    removeLabelIds: ["INBOX"],
  });
  // Only 32-character codes are looked up; real ids and label names are never touched.
  assert.deepEqual(asked, [card]);
  // An unknown card id is left as it was.
  assert.equal(await unwrapCardIds("b".repeat(32), find), "b".repeat(32));
});
