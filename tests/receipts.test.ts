import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import type { RunAgentInput } from "@ag-ui/core";
import { lastValueFrom, toArray } from "rxjs";
import { createApp } from "../apps/server/src/app.ts";
import { ConversationAgent } from "../apps/server/src/engine/conversation.ts";
import { browserFixture } from "./helpers/browser.ts";
import { modelFixture } from "./helpers/model.ts";

async function fixture(t: TestContext) {
  const base = await browserFixture(t, () => ({ data: {} }));
  const config = { ...base.config, agentBackend: "model", model: "openai/fixture" } as const;
  const server = await createApp(base.db, config, {});
  t.after(() => server.agent.stop());
  return { server, conversation: new ConversationAgent(config, server.agent, "local-user") };
}
const input = (threadId: string, id: string, content: string): RunAgentInput => ({
  threadId,
  runId: randomUUID(),
  messages: [{ id, role: "user", content }],
  tools: [],
  context: [],
  state: {},
});

test("an answer's receipt says what was hidden from the model, never the values", async (t) => {
  await modelFixture(t, () => ({ text: "Done." }));
  const { server, conversation } = await fixture(t);
  await lastValueFrom(
    conversation
      .run(input("receipt-thread", "q1", "Pay with card 4111 1111 1111 1111, password: swordfish7"))
      .pipe(toArray()),
  );
  await lastValueFrom(conversation.run(input("receipt-thread", "q2", "Thanks")).pipe(toArray()));
  // The record is written as each answer ends.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const turns = await server.agent.receipts.forThread("local-user", "receipt-thread");
  assert.equal(turns.q1?.hidden, "a card number and a password");
  assert.equal(turns.q1?.hiddenCount, 2);
  assert.equal(turns.q2?.hiddenCount, 0);
  assert.ok(!JSON.stringify(turns).includes("4111"), "no values are kept");
  assert.deepEqual(await server.agent.receipts.forThread("someone-else", "receipt-thread"), {});
});

test("a retried question keeps what was hidden the first time", async (t) => {
  const { server } = await fixture(t);
  const { receipts } = server.agent;
  await receipts.record("local-user", "t", "q", [{ kind: "card", length: 16 }]);
  await receipts.record("local-user", "t", "q", []);
  const turns = await receipts.forThread("local-user", "t");
  assert.equal(turns.q?.hiddenCount, 1);
});

test("a chat with no record for a question says nothing about it", async (t) => {
  const { server } = await fixture(t);
  await server.agent.receipts.record("local-user", "other", "q1", []);
  const turns = await server.agent.receipts.forThread("local-user", "other");
  assert.equal(turns.q2, undefined, "the app then shows “not available”, never “nothing hidden”");
  assert.equal(turns.q1?.hiddenCount, 0);
});
