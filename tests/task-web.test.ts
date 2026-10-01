import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { executeModelTask } from "../apps/server/src/engine/model.ts";
import type { AgentService } from "../apps/server/src/engine/service.ts";
import type { TaskContext } from "../apps/server/src/engine/worker.ts";
import type { AgentTask } from "../packages/domain/src/agent.ts";

/**
 * A scripted Claude: each call answers with the next step of a statement job, as tool calls, and
 * records what it was sent.
 */
async function scriptedClaude(t: import("node:test").TestContext, steps: object[]) {
  const bodies: { tools?: { name: string }[]; messages: unknown[] }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    bodies.push(JSON.parse(body));
    const step = steps[bodies.length - 1] as
      | { tool: string; input: object }
      | { text: string }
      | undefined;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (event: string, data: object) =>
      response.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
    send("message_start", {
      message: {
        id: `msg_${bodies.length}`,
        type: "message",
        role: "assistant",
        model: "claude-haiku-4-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 1 },
      },
    });
    if (step && "tool" in step) {
      send("content_block_start", {
        index: 0,
        content_block: {
          type: "tool_use",
          id: `toolu_${bodies.length}`,
          name: step.tool,
          input: {},
        },
      });
      send("content_block_delta", {
        index: 0,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(step.input) },
      });
    } else {
      send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      send("content_block_delta", {
        index: 0,
        delta: { type: "text_delta", text: step && "text" in step ? step.text : "Done." },
      });
    }
    send("content_block_stop", { index: 0 });
    send("message_delta", {
      delta: { stop_reason: step && "tool" in step ? "tool_use" : "end_turn", stop_sequence: null },
      usage: { input_tokens: 1000, output_tokens: 100 },
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

const PAGE = {
  url: "https://bank.example/statements",
  title: "Statements",
  text: "September statement. Amount due $84.20.",
  truncated: false,
};

test("a background job works a website: reads it, downloads, and stops before paying", async (t) => {
  const bodies = await scriptedClaude(t, [
    { tool: "open_page", input: { url: "https://bank.example/statements" } },
    { tool: "look_at_page", input: {} },
    {
      tool: "use_page",
      input: { ref: "e1", action: "click", why: "Download the September statement" },
    },
    { tool: "save_downloads", input: {} },
    { tool: "use_page", input: { ref: "e2", action: "click", why: "Pay the September bill" } },
    { text: "The statement is in Files, and the payment is ready for your OK." },
  ]);
  const clicked: string[] = [];
  const proposed: { kind: string; data: { element?: string } }[] = [];
  const browser = {
    observeForThread: async (_owner: string, key: string) => {
      assert.equal(key, "task:task-web-1", "the job gets its own browser");
      return { sessionId: "s1", ...PAGE };
    },
    threadSession: async () => ({ id: "s1" }),
    elements: async () => ({
      url: PAGE.url,
      title: PAGE.title,
      elements: [
        { ref: "e1", role: "link", name: "Download statement" },
        { ref: "e2", role: "button", name: "Pay now" },
      ],
    }),
    read: async () => PAGE,
    act: async (_owner: string, _id: string, step: { ref: string }) => {
      clicked.push(step.ref);
      return PAGE;
    },
    imports: async () => ({ files: [{ id: "f1", name: "September statement.pdf" }], failures: [] }),
  };
  let task: AgentTask = {
    id: "task-web-1",
    title: "Get my September statement and pay the bill",
    prompt: "Download my September statement from my bank and get the bill ready to pay.",
    kind: "agent",
    status: "running",
    plan: [],
    evidence: [],
    artifactIds: [],
    state: {},
    createdAt: "2026-09-30T12:00:00.000Z",
    updatedAt: "2026-09-30T12:00:00.000Z",
  } as unknown as AgentTask;
  const service = {
    config: { model: "anthropic/claude-haiku-4-5-20251001" },
    computer: {},
    files: {},
    browser,
    workspace: { connected: async () => false },
    people: { index: async () => "" },
    timeZone: async () => "America/Chicago",
    db: { get: async () => null, list: async () => [] },
    usage: {
      sink: () => () => undefined,
      cost: (_model: string, tokens: { input: number; output: number }) =>
        (tokens.input * 1 + tokens.output * 5) / 1_000_000,
    },
    prepare: async (_owner: string, _task: AgentTask, input: (typeof proposed)[number]) => {
      proposed.push(input);
      return { id: "action-1", status: "awaiting_review" };
    },
  } as unknown as AgentService;
  const ctx = {
    signal: new AbortController().signal,
    guard: async () => undefined,
    event: async () => undefined,
    checkpoint: async (patch: Partial<AgentTask>) => {
      task = { ...task, ...patch, state: { ...task.state, ...(patch.state ?? {}) } };
      return task;
    },
  } as unknown as TaskContext;

  const result = await executeModelTask(service, "owner-1", task, ctx);

  // The job was offered hands on websites.
  const tools = (bodies[0]?.tools ?? []).map((tool) => tool.name);
  for (const name of ["open_page", "look_at_page", "use_page", "save_downloads"])
    assert.ok(tools.includes(name), `${name} is offered`);
  // It downloaded the statement (a plain click), and kept the file.
  assert.deepEqual(clicked, ["e1"], "only the download was clicked; paying was not");
  // Paying commits, so it waits for the person's approval, and the job pauses.
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0]?.kind, "browser.step");
  assert.equal(proposed[0]?.data.element, "Pay now");
  assert.equal(result.status, "waiting_approval");
  // Its AI cost is kept on the task: six calls of 1,000 tokens in and 100 out.
  const cost = task.state.cost as { calls: number; dollars: number };
  assert.equal(cost.calls, 6);
  assert.equal(cost.dollars, 0.009);
  assert.equal(task.evidence[0]?.url, PAGE.url);
});

test("a job that doesn't name the site asks which one, in the agent's own words", async (t) => {
  const bodies = await scriptedClaude(t, [
    { text: "Which bank do you use? Tell me its name or web address and I'll get the statement." },
  ]);
  let task: AgentTask = {
    id: "task-web-2",
    title: "Get my statement",
    prompt: "Go to my bank's website, sign in, and download my statement for August 2026.",
    kind: "agent",
    status: "running",
    plan: [],
    evidence: [],
    artifactIds: [],
    state: {},
    createdAt: "2026-09-30T12:00:00.000Z",
    updatedAt: "2026-09-30T12:00:00.000Z",
  } as unknown as AgentTask;
  const service = {
    config: { model: "anthropic/claude-haiku-4-5-20251001" },
    computer: {},
    files: {},
    browser: {},
    workspace: { connected: async () => false },
    people: { index: async () => "" },
    timeZone: async () => "America/Chicago",
    db: { get: async () => null, list: async () => [] },
    usage: { sink: () => () => undefined, cost: () => 0.001 },
  } as unknown as AgentService;
  const ctx = {
    signal: new AbortController().signal,
    guard: async () => undefined,
    event: async () => undefined,
    checkpoint: async (patch: Partial<AgentTask>) => {
      task = { ...task, ...patch, state: { ...task.state, ...(patch.state ?? {}) } };
      return task;
    },
  } as unknown as TaskContext;

  const result = await executeModelTask(service, "owner-1", task, ctx);

  const system = JSON.stringify((bodies[0] as { system?: unknown }).system ?? "");
  assert.match(system, /never guess a site/, "the job is told to ask which site");
  assert.equal(result.status, "waiting_input");
  assert.equal(
    (result as { question?: string }).question,
    "Which bank do you use? Tell me its name or web address and I'll get the statement.",
  );
});
