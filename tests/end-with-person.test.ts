import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CUT_OFF,
  endWithPerson,
  repairToolSteps,
} from "../apps/server/src/engine/tanstack-agent.ts";

const user = (content: string) => ({ role: "user", content });
const agent = (content: string) => ({ role: "assistant", content });
const call = (id: string) => ({ role: "assistant", content: null, toolCalls: [{ id }] });
const result = (id: string) => ({ role: "tool", content: "ok", toolCallId: id });

test("a conversation that ends with the person is sent as it is", () => {
  const messages = [user("Ads report?"), agent("7 or 30 days?"), user("Yes, the last 60 days")];
  assert.equal(endWithPerson(messages), messages);
  const tools = [user("Ads report?"), call("a"), result("a")];
  assert.equal(endWithPerson(tools), tools);
});

test("a reply saved after the answer to it goes back before that answer", () => {
  const answer = user("Yes, the last 60 days");
  const question = agent("7 or 30 days?");
  assert.deepEqual(endWithPerson([user("Ads report?"), call("a"), result("a"), answer, question]), [
    user("Ads report?"),
    call("a"),
    result("a"),
    question,
    answer,
  ]);
});

test("a tool call after the person's turn that never got a result is left out", () => {
  const answer = user("Yes");
  assert.deepEqual(endWithPerson([user("Hi"), agent("Hello"), answer, call("x")]), [
    user("Hi"),
    agent("Hello"),
    answer,
  ]);
});

test("a finished reply after a tool step is left out, so the model writes it again", () => {
  assert.deepEqual(endWithPerson([user("Hi"), call("a"), result("a"), agent("Done.")]), [
    user("Hi"),
    call("a"),
    result("a"),
  ]);
});

test("a step cut off earlier in the chat gets a result, so later messages still go through", () => {
  // The stuck chat: a tool call with no result, then the person carried on.
  const messages = [
    user("Connect Facebook"),
    call("fb"),
    user("I have connected"),
    user("Check my email"),
  ];
  assert.deepEqual(repairToolSteps(messages), [
    user("Connect Facebook"),
    call("fb"),
    { role: "tool", toolCallId: "fb", content: CUT_OFF },
    user("I have connected"),
    user("Check my email"),
  ]);
});

test("tool results go right after their call; strays and repeated calls are left out", () => {
  const healthy = [user("Hi"), call("a"), result("a"), agent("Done"), user("Thanks")];
  assert.equal(repairToolSteps(healthy), healthy);
  // A result saved after the next message moves back to its call.
  assert.deepEqual(repairToolSteps([user("Hi"), call("a"), agent("…"), result("a"), user("Ok")]), [
    user("Hi"),
    call("a"),
    result("a"),
    agent("…"),
    user("Ok"),
  ]);
  // A result with no call, and a call id used twice.
  assert.deepEqual(
    repairToolSteps([user("Hi"), result("zz"), call("a"), result("a"), call("a"), user("Ok")]),
    [user("Hi"), call("a"), result("a"), user("Ok")],
  );
});
