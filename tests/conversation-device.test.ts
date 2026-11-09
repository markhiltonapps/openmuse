import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { RunAgentInput } from "@ag-ui/core";
import { lastValueFrom, toArray } from "rxjs";
import { createApp } from "../apps/server/src/app.ts";
import { ConversationAgent } from "../apps/server/src/engine/conversation.ts";
import { browserFixture } from "./helpers/browser.ts";
import { modelFixture } from "./helpers/model.ts";

function lookup(forwardedProps: Record<string, unknown>): RunAgentInput {
  return {
    threadId: "voice-call-1",
    runId: randomUUID(),
    messages: [{ id: randomUUID(), role: "user", content: "What's the Lakers score?" }],
    tools: [],
    context: [],
    state: {},
    forwardedProps,
  };
}

async function toolsOffered(
  t: import("node:test").TestContext,
  forwardedProps: Record<string, unknown>,
) {
  const { requests } = await modelFixture(t, () => ({ text: "ok" }));
  const fixture = await browserFixture(t, () => ({ data: {} }));
  const config = { ...fixture.config, agentBackend: "model", model: "openai/fixture" } as const;
  const server = await createApp(fixture.db, config, {});
  t.after(() => server.agent.stop());
  const conversation = new ConversationAgent(config, server.agent, "local-user");
  await lastValueFrom(conversation.run(lookup(forwardedProps)).pipe(toArray()));
  const body = requests[0]?.body ?? "";
  return { has: (name: string) => body.includes(`"name":"${name}"`), body };
}

test("on a watch's call the agent gets the card tool and the weather by place, and no call screen; on an app call it's the reverse", async (t) => {
  const device = await toolsOffered(t, { voiceLookup: true, deviceCall: true });
  assert.ok(device.has("show_on_watch"));
  assert.ok(!device.has("show_on_screen"));
  const app = await toolsOffered(t, { voiceLookup: true });
  assert.ok(app.has("show_on_screen"));
  assert.ok(!app.has("show_on_watch"));
});
