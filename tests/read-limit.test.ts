import assert from "node:assert/strict";
import { test } from "node:test";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import {
  READ_BUDGET,
  shrinkToolResults,
  tanstackAgent,
} from "../apps/server/src/engine/tanstack-agent.ts";
import { modelFixture } from "./helpers/model.ts";

const tool = (id: string, text: string) => ({ role: "tool", toolCallId: id, content: text });

test("older tool results are shortened, oldest first, until a call fits", () => {
  const big = "x".repeat(100_000);
  const messages = [
    { role: "user", content: "Clean my inbox." },
    ...["a", "b", "c", "d", "e", "f"].map((id) => tool(id, big)),
  ];
  const fitted = shrinkToolResults(messages, 26_000);
  const sizes = fitted.map((m) => String(m.content).length);
  assert.ok(sizes[1] < 2_000, "the oldest result is cut");
  assert.equal(sizes[6], big.length, "the newest results stay whole");
  assert.equal(sizes[5], big.length);
  assert.equal(sizes[4], big.length);
  const tokens = fitted.reduce((sum, m) => sum + JSON.stringify(m).length / 3, 26_000);
  assert.ok(tokens <= READ_BUDGET, "and the call now fits");
  assert.match(String(fitted[1]?.content), /left out/);
  assert.equal(messages[1]?.content, big, "the saved conversation itself isn't changed");
});

test("when even the newest results are too much, they give up some too", () => {
  const huge = "x".repeat(300_000);
  const fitted = shrinkToolResults([tool("a", huge), tool("b", huge), tool("c", huge)], 26_000);
  const tokens = fitted.reduce((sum, m) => sum + JSON.stringify(m).length / 3, 26_000);
  assert.ok(tokens <= READ_BUDGET);
});

test("a call that already fits is sent as it is", () => {
  const messages = [{ role: "user", content: "Hi" }, tool("a", "short")];
  assert.equal(shrinkToolResults(messages, 26_000), messages);
});

test("a long run of big look-ups is shortened before it reaches the model", async (t) => {
  const { requests } = await modelFixture(t, (index) =>
    index < 8 ? { name: "look_up", arguments: { page: index } } : { text: "Done." },
  );
  const agent = tanstackAgent({
    model: "openai/fixture",
    maxSteps: 12,
    prompt: "Clean the inbox.",
    tools: [
      defineTool({
        name: "look_up",
        description: "A page of mail",
        parameters: z.object({ page: z.number() }),
        execute: async ({ page }) => ({ page, mail: "m".repeat(120_000) }),
      }),
    ],
  });
  const input: RunAgentInput = {
    threadId: "read-limit",
    runId: "read-limit-run",
    messages: [{ id: "m1", role: "user", content: "Clean my inbox." }],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  };
  const finished = await new Promise<boolean>((resolve) => {
    let done = false;
    agent.run(input).subscribe({
      next: (event) => {
        if (event.type === EventType.RUN_FINISHED) done = true;
      },
      error: () => resolve(false),
      complete: () => resolve(done),
    });
  });
  assert.equal(finished, true);
  assert.equal(requests.length, 9);
  const last = requests.at(-1)?.body.length ?? 0;
  assert.ok(last < READ_BUDGET * 3.5, `the last call is ${last} characters, kept under the limit`);
  // Without the guard eight 120,000-character results would be about a million characters.
  assert.ok(last < 700_000);
});
