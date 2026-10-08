import assert from "node:assert/strict";
import { test } from "node:test";
import {
  confirmFirst,
  emailRuleWords,
  routineWords,
  spokenDays,
} from "../apps/server/src/rule-words.ts";

test("rules are said back in plain words before they're saved on a call", () => {
  assert.equal(spokenDays([1, 2, 3, 4, 5]), "every weekday");
  assert.equal(spokenDays([1, 5]), "every Monday and Friday");
  assert.equal(
    routineWords({ prompt: "Give me a brief for today", time: "07:30", days: [1, 2, 3, 4, 5] }),
    "Every weekday at 7:30 AM, I’ll run this request: “Give me a brief for today”.",
  );
  assert.equal(
    emailRuleWords({
      from: "Dana at Acme",
      subjectContains: "invoice",
      instruction: "Save the PDF to Files and tell me the total",
      app: "gmail",
    }),
    "When an email from Dana at Acme about “invoice” arrives in Gmail, I’ll do this: “Save the PDF to Files and tell me the total”.",
  );
  const asked = confirmFirst("When an email from Dana arrives, I'll tell you.");
  assert.equal(asked.saved, false);
  assert.match(asked.say, /Want me to set that up\?$/);
});
