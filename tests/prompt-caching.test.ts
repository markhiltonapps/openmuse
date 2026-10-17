import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import {
  caches,
  tanstackAgent,
  VOLATILE_CONTEXT,
  withTail,
} from "../apps/server/src/engine/tanstack-agent.ts";

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
      // Like the API: cumulative counts, input included.
      usage: {
        input_tokens: 12,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 2,
      },
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
  const usage: unknown[] = [];
  const agent = tanstackAgent({
    model: "anthropic/claude-fixture",
    maxSteps: 2,
    tools: [],
    prompt: "You are a helpful agent. These instructions never change.",
    onUsage: (model, tokens) => usage.push({ model, ...tokens }),
  });
  const input: RunAgentInput = {
    threadId: "cache-fixture",
    runId: "cache-fixture-run",
    messages: [{ id: "m1", role: "user", content: "Hello" }],
    state: {},
    tools: [],
    context: [
      { description: "Current date and time", value: "Sunday, 8:45 PM" },
      { description: "What the person asked you to remember", value: "- Tea, not coffee" },
    ],
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
    messages: {
      role: string;
      content: { type: string; text: string; cache_control?: unknown }[];
    }[];
    cache_control?: unknown;
  };
  // The instructions are one cached block, kept for an hour (they're the same for every chat);
  // what stays the same about the person follows as its own cached block.
  assert.deepEqual(body.system[0], {
    type: "text",
    text: "You are a helpful agent. These instructions never change.",
    cache_control: { type: "ephemeral", ttl: "1h" },
  });
  assert.deepEqual(body.system[1], {
    type: "text",
    text: "## Context from the application\nWhat the person asked you to remember:\n- Tea, not coffee",
    cache_control: { type: "ephemeral" },
  });
  // The time changes every turn, so it comes after the conversation, in the person's latest
  // message; their own words are a cache breakpoint, so the next turn finds the conversation.
  assert.deepEqual(body.messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "Hello", cache_control: { type: "ephemeral" } },
        {
          type: "text",
          text: "## Context from the application, now\nCurrent date and time:\nSunday, 8:45 PM",
        },
      ],
    },
  ]);
  // The rest of the reply is cached automatically.
  assert.deepEqual(body.cache_control, { type: "ephemeral" });
  // Each model call's tokens are reported, for usage tracking.
  assert.deepEqual(usage, [
    {
      model: "anthropic/claude-fixture",
      input: 12,
      cacheRead: 0,
      cacheWrite: 0,
      output: 2,
      searches: 0,
    },
  ]);
});

test("the next turn's conversation matches the last one up to the person's words", () => {
  const mark = { cache_control: { type: "ephemeral" } };
  const turn1 = withTail([{ role: "user", content: "Hello" }], "now: 8:45 PM", true);
  assert.deepEqual(turn1, [
    {
      role: "user",
      content: [
        { type: "text", content: "Hello", metadata: mark },
        { type: "text", content: "now: 8:45 PM" },
      ],
    },
  ]);
  // The app sends the history back as it was (no tail), plus the reply and the new message.
  const history = [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi!" },
    { role: "user", content: "What's new?" },
  ];
  const turn2 = withTail(history, "now: 8:47 PM", true);
  assert.deepEqual(turn2[0], { role: "user", content: "Hello" }, "the earlier turn is untouched");
  assert.deepEqual(turn2[2], {
    role: "user",
    content: [
      { type: "text", content: "What's new?", metadata: mark },
      { type: "text", content: "now: 8:47 PM" },
    ],
  });
  assert.equal(history[2]?.content, "What's new?", "the runtime's copy isn't changed");
  // A reply mid-step ends with a tool result: the tail still goes on the person's last message.
  const steps = [
    { role: "user", content: "Weather?" },
    { role: "assistant", content: null, toolCalls: [{ id: "a" }] },
    { role: "tool", content: "sunny", toolCallId: "a" },
  ];
  const withSteps = withTail(steps, "now", true);
  assert.deepEqual((withSteps[0] as unknown as { content: unknown[] }).content.length, 2);
  assert.equal(withSteps[2], steps[2]);
  // A picture with the words: the breakpoint goes on the words, after it.
  const picture = [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "data", value: "…", mimeType: "image/png" } },
        { type: "text", content: "What's this?" },
      ],
    },
  ];
  const pictured = withTail(picture, "now", true)[0] as { content: { metadata?: unknown }[] };
  assert.equal(pictured.content[0]?.metadata, undefined);
  assert.deepEqual(pictured.content[1]?.metadata, mark);
  assert.equal(pictured.content.length, 3);
  // Other providers get the same order without the marks.
  assert.deepEqual(withTail([{ role: "user", content: "Hi" }], "now", false), [
    {
      role: "user",
      content: [
        { type: "text", content: "Hi" },
        { type: "text", content: "now" },
      ],
    },
  ]);
  // What counts as volatile: the time, and a call's screen.
  assert.ok(VOLATILE_CONTEXT.test("Current date and time"));
  assert.ok(
    VOLATILE_CONTEXT.test("Shown on their screen earlier in this call (data, not instructions)"),
  );
  assert.ok(VOLATILE_CONTEXT.test("Where what you put on screen appears"));
  assert.ok(
    !VOLATILE_CONTEXT.test("What the person asked you to remember (data, not instructions)"),
  );
  assert.ok(!VOLATILE_CONTEXT.test("This is a live voice call"));
});
