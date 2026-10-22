import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import type { RunAgentInput } from "@ag-ui/core";
import { lastValueFrom, toArray } from "rxjs";
import { createApp } from "../apps/server/src/app.ts";
import { bounded } from "../apps/server/src/apps.ts";
import { ConversationAgent } from "../apps/server/src/engine/conversation.ts";
import { guardInput, guardResult } from "../apps/server/src/redaction.ts";
import { browserFixture } from "./helpers/browser.ts";
import { modelFixture } from "./helpers/model.ts";

const CARD = "4111 1111 1111 1111";
const KEY = `sk-ant-${"a1B2c3D4".repeat(5)}`;

function input(messages: RunAgentInput["messages"]): RunAgentInput {
  return {
    threadId: "redaction-chat",
    runId: randomUUID(),
    messages,
    tools: [],
    context: [],
    state: {},
  };
}

async function chatFixture(t: TestContext, page: { text: string }) {
  const fixture = await browserFixture(t, (path, body) => ({
    data: path.endsWith("/read")
      ? { url: "https://bank.example/billing", title: "Billing", text: page.text, truncated: false }
      : {
          id: body.id,
          title: "Opened",
          url: body.url,
          status: "active",
          updatedAt: new Date().toISOString(),
        },
  }));
  const config = { ...fixture.config, agentBackend: "model", model: "openai/fixture" } as const;
  const server = await createApp(fixture.db, config, {});
  t.after(() => server.agent.stop());
  return new ConversationAgent(config, server.agent, "local-user");
}

test("what the person typed never reaches the model, and the model is told to say so once", async (t) => {
  const { requests } = await modelFixture(t, () => ({ text: "I hid that so I never see it." }));
  const conversation = await chatFixture(t, { text: "" });
  await lastValueFrom(
    conversation
      .run(
        input([
          {
            id: "a",
            role: "user",
            content: `Pay the deposit with my card ${CARD}, password: swordfish7`,
          },
        ]),
      )
      .pipe(toArray()),
  );
  const sent = requests.map((r) => r.body).join("\n");
  assert.ok(!sent.includes("4111"), "no card digits sent to the model");
  assert.ok(!sent.includes("swordfish7"), "no password sent to the model");
  assert.match(sent, /card ending 1111/);
  assert.match(sent, /Hidden from you: a card number and a password/);
  assert.match(sent, /don't ask for it again/);
});

test("earlier messages in the history are hidden again on every turn", async (t) => {
  const { requests } = await modelFixture(t, () => ({ text: "Okay." }));
  const conversation = await chatFixture(t, { text: "" });
  await lastValueFrom(
    conversation
      .run(
        input([
          { id: "a", role: "user", content: `My SSN is 078-05-1120` },
          { id: "b", role: "assistant", content: "Noted." },
          { id: "c", role: "user", content: "What's the weather?" },
        ]),
      )
      .pipe(toArray()),
  );
  const sent = requests.map((r) => r.body).join("\n");
  assert.ok(!sent.includes("078-05-1120"));
  assert.match(sent, /Social Security number ending 1120/);
  // Only the latest message carries the note: this turn had nothing new to hide.
  assert.ok(!/Hidden from you/.test(sent));
});

test("a page the agent reads is hidden before the model sees it", async (t) => {
  const { requests } = await modelFixture(t, (index) =>
    index % 2 === 0
      ? { name: "browse_web", arguments: { url: "https://bank.example/billing" } }
      : { text: "I hid the card on that page." },
  );
  const conversation = await chatFixture(t, {
    text: `Billing. Card on file ${CARD}. API key ${KEY}. Next invoice Nov 1.`,
  });
  await lastValueFrom(
    conversation
      .run(
        input([
          {
            id: "a",
            role: "user",
            content: "What's on my billing page? https://bank.example/billing",
          },
        ]),
      )
      .pipe(toArray()),
  );
  const sent = requests.map((r) => r.body).join("\n");
  assert.ok(!sent.includes("4111 1111"), "no card from the page");
  assert.ok(!sent.includes(KEY), "no key from the page");
  assert.match(sent, /card ending 1111/);
  assert.match(sent, /Something sensitive was hidden in this result/);
  assert.match(sent, /Next invoice Nov 1/);
});

test("connector results and tool results are cleaned, with a note, and ordinary results are untouched", () => {
  const out = bounded({ messages: [{ id: "m1", body: `use ${CARD}` }] });
  assert.deepEqual(out, {
    data: { messages: [{ id: "m1", body: "use [card ending 1111]" }] },
    hidden: "a card number",
  });
  const plain = { ok: true, items: ["a", "b"] };
  assert.equal(guardResult(plain), plain, "nothing hidden: the same object comes back");
  const noted = guardResult({ text: `pin: 4829` }) as {
    text: string;
    hidden: string;
    next: string;
  };
  assert.equal(noted.text, "pin: [hidden]");
  assert.equal(noted.hidden, "a PIN or security code");
  assert.match(noted.next, /Say so in one short line/);
  // Long id-like values aren't mistaken for cards.
  const ids = guardResult({
    threadId: "4111111111111111",
    url: "https://x.example/?key=4111111111111111",
  });
  assert.deepEqual(ids, {
    threadId: "4111111111111111",
    url: "https://x.example/?key=4111111111111111",
  });
});

test("input with nothing sensitive is returned as it came", () => {
  const original = input([{ id: "a", role: "user", content: "Book dinner for 4 at 7:30" }]);
  const { input: guarded, note } = guardInput(original);
  assert.equal(note, "");
  assert.deepEqual(guarded.messages, original.messages);
});
