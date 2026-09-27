import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { caches, tanstackAgent } from "../apps/server/src/engine/tanstack-agent.ts";

/** A minimal Anthropic Messages endpoint that records each request and streams a short reply. */
async function anthropicFixture(t: import("node:test").TestContext) {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    bodies.push(JSON.parse(body));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (event: string, data: object) =>
      response.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
    send("message_start", {
      message: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: "claude-fixture",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 0 },
      },
    });
    send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    send("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hi!" } });
    send("content_block_stop", { index: 0 });
    send("message_delta", {
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 2 },
    });
    send("message_stop", {});
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const previous = { url: process.env.ANTHROPIC_BASE_URL, key: process.env.ANTHROPIC_API_KEY };
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.ANTHROPIC_API_KEY = "test-key-never-sent-anywhere-else";
  t.after(() => {
    server.close();
    for (const [name, value] of [
      ["ANTHROPIC_BASE_URL", previous.url],
      ["ANTHROPIC_API_KEY", previous.key],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });
  return bodies;
}

test("Claude reuses the fixed instructions and the conversation from its cache", async (t) => {
  assert.equal(caches("anthropic/claude-sonnet-5"), true);
  assert.equal(caches("openai/gpt-5"), false);
  const bodies = await anthropicFixture(t);
  const agent = tanstackAgent({
    model: "anthropic/claude-fixture",
    maxSteps: 2,
    tools: [],
    prompt: "You are a helpful agent. These instructions never change.",
  });
  const input: RunAgentInput = {
    threadId: "cache-fixture",
    runId: "cache-fixture-run",
    messages: [{ id: "m1", role: "user", content: "Hello" }],
    state: {},
    tools: [],
    context: [{ description: "Current date and time", value: "Sunday, 8:45 PM" }],
    forwardedProps: {},
  };
  let text = "";
  await new Promise<void>((resolve, reject) =>
    agent.run(input).subscribe({
      next: (event) => {
        if (
          (event.type === EventType.TEXT_MESSAGE_CONTENT ||
            event.type === EventType.TEXT_MESSAGE_CHUNK) &&
          "delta" in event
        )
          text += String(event.delta);
      },
      error: reject,
      complete: resolve,
    }),
  );
  assert.equal(text, "Hi!");
  const body = bodies[0] as {
    system: { text: string; cache_control?: unknown }[];
    cache_control?: unknown;
  };
  // The instructions are one cached block; the changing context comes after it, uncached.
  assert.deepEqual(body.system[0], {
    type: "text",
    text: "You are a helpful agent. These instructions never change.",
    cache_control: { type: "ephemeral" },
  });
  assert.match(body.system[1]?.text ?? "", /Current date and time:\nSunday, 8:45 PM/);
  assert.equal(body.system[1]?.cache_control, undefined);
  // The growing conversation is cached automatically.
  assert.deepEqual(body.cache_control, { type: "ephemeral" });
});
