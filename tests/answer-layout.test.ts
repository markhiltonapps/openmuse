import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { answerLayoutInstructions } from "../apps/server/src/engine/answer-layout.ts";
import { inboxCheckInstructions } from "../apps/server/src/engine/mailboxes.ts";

test("answers that cover several things lead with the short answer, grouped, one line each", () => {
  assert.match(answerLayoutInstructions, /start with one sentence that gives the short answer/);
  assert.match(answerLayoutInstructions, /three or more things/);
  assert.match(answerLayoutInstructions, /\*\*Needs action:\*\* first, then \*\*FYI only:\*\*/);
  assert.match(answerLayoutInstructions, /never # headings/);
  // A chat ends with an offer; a job's result doesn't (its page has no reply box, and a closing
  // question would read as the job asking something).
  assert.match(answerLayoutInstructions, /In a chat, end with one short offer/);
  assert.match(answerLayoutInstructions, /in a job's result, leave the offer out/);
  // On a call it goes on their screen; the voice says only the gist.
  assert.match(answerLayoutInstructions, /show_on_screen/);
});

test("an inbox check reads every mailbox and their sent mail, and counts things to do", () => {
  assert.match(inboxCheckInstructions, /check every mailbox they have/);
  assert.match(inboxCheckInstructions, /both Gmail and Outlook/);
  assert.match(inboxCheckInstructions, /sent mail for a reply they've already sent/);
  assert.match(inboxCheckInstructions, /security alerts/);
  assert.match(inboxCheckInstructions, /failed or declined payments/);
  // Alerts are what phishing looks like: check in the app itself, never through the email's link.
  assert.match(inboxCheckInstructions, /never a link in that email/);
  assert.match(inboxCheckInstructions, /it may be a scam/);
  // A mailbox it couldn't read is named first, never hidden behind "nothing needs you".
  assert.match(inboxCheckInstructions, /If a mailbox couldn't be read, say which one and why/);
  // People waiting on them come first.
  assert.match(inboxCheckInstructions, /most important first: a message from a person/);
  assert.match(inboxCheckInstructions, /last 7 days/);
});

test("the chat (and so a call's hand-overs) gets both rules; jobs are checked in task-web.test", () => {
  const chat = readFileSync(
    new URL("../apps/server/src/engine/conversation.ts", import.meta.url),
    "utf8",
  );
  assert.match(chat, /\+\s*inboxCheckInstructions\s*\+/);
  assert.match(chat, /\+\s*answerLayoutInstructions,/);
  // The app's own emails lead to the card itself, in the chat only (jobs have no cards).
  assert.match(chat, /If an email is from this app itself/);
});
