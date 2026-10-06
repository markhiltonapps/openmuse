import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { after, before, test } from "node:test";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { executeModelTask } from "../apps/server/src/engine/model.ts";
import type { AgentService } from "../apps/server/src/engine/service.ts";
import {
  complete,
  fitContext,
  lastCalls,
  tanstackAgent,
} from "../apps/server/src/engine/tanstack-agent.ts";
import type { TaskContext } from "../apps/server/src/engine/worker.ts";
import {
  CONTEXT_LIMIT,
  MODEL_JOBS,
  ModelChoices,
  OUTPUT_LIMITS,
  outputLimit,
  RECOMMENDED,
  SERVER_MODEL,
} from "../apps/server/src/model-choices.ts";
import {
  costOf,
  type fromTanstack,
  modelName,
  PRICES,
  UsageMeter,
} from "../apps/server/src/usage.ts";
import type { AgentTask } from "../packages/domain/src/agent.ts";

/** OpenRouter's public model list, as the fake serves it. */
const LISTED = [
  {
    id: "openai/gpt-6.1-sol",
    supported_parameters: ["tools", "reasoning"],
    pricing: { prompt: "0.000002", completion: "0.00001", input_cache_read: "0.0000001" },
  },
  {
    id: "deepseek/deepseek-v4-flash",
    supported_parameters: ["tools", "reasoning"],
    pricing: { prompt: "0.00000005", completion: "0.0000015" },
  },
  { id: "acme/chatty-1", supported_parameters: ["temperature"], pricing: {} },
];

/** A pretend OpenRouter: Chat Completions as a stream, with usage at the end. */
async function fakeOpenRouter(
  t: import("node:test").TestContext,
  failFor: string[] = [],
  reply = ["Hello ", "there."],
  options: { status?: number; emptyFor?: string[] } = {},
) {
  const seen: { path: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url?.endsWith("/models")) {
      seen.push({ path: request.url, headers: request.headers, body: {} });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: LISTED }));
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw) as Record<string, unknown>;
    seen.push({ path: request.url ?? "", headers: request.headers, body });
    if (failFor.includes(String(body.model))) {
      response.writeHead(options.status ?? 400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "This model is unavailable" } }));
      return;
    }
    const words = options.emptyFor?.includes(String(body.model)) ? [""] : reply;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (data: object) => response.write(`data: ${JSON.stringify(data)}\n\n`);
    const base = { id: "gen-1", object: "chat.completion.chunk", created: 1, model: body.model };
    for (const [index, content] of words.entries())
      send({
        ...base,
        choices: [{ index: 0, delta: index ? { content } : { role: "assistant", content } }],
      });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    send({
      ...base,
      choices: [],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 40,
        total_tokens: 1040,
        prompt_tokens_details: { cached_tokens: 800 },
        completion_tokens_details: { reasoning_tokens: 25 },
      },
    });
    response.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const previous = {
    key: process.env.OPENROUTER_API_KEY,
    url: process.env.OPENROUTER_BASE_URL,
  };
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${port}/api/v1`;
  t.after(() => {
    server.close();
    if (previous.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous.key;
    if (previous.url === undefined) delete process.env.OPENROUTER_BASE_URL;
    else process.env.OPENROUTER_BASE_URL = previous.url;
  });
  return seen;
}

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close?.();
});

test("an OpenRouter call uses its own key, Chat Completions, the effort and the output cap", async (t) => {
  const seen = await fakeOpenRouter(t);
  const used: { model: string; tokens: ReturnType<typeof fromTanstack> }[] = [];
  const text = await complete({
    model: "openrouter/openai/gpt-6.1-sol",
    effort: "high",
    maxTokens: 2000,
    system: "Be brief.",
    prompt: "Say hello.",
    onUsage: (model, tokens) => used.push({ model, tokens }),
  });
  assert.equal(text, "Hello there.");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.path, "/api/v1/chat/completions");
  assert.equal(seen[0]?.headers.authorization, "Bearer test-openrouter-key");
  assert.equal(seen[0]?.body.model, "openai/gpt-6.1-sol");
  assert.deepEqual(seen[0]?.body.reasoning, { effort: "high" });
  assert.equal(seen[0]?.body.max_tokens, 2000);
  // Cache reads come out of the prompt tokens, so each token is priced once.
  assert.deepEqual(used[0]?.tokens, {
    input: 200,
    cacheRead: 800,
    cacheWrite: 0,
    output: 40,
    searches: 0,
  });
  // 200 × $2 + 800 × $0.10 + 40 × $10, per million.
  assert.equal(
    Number(costOf(used[0]?.model ?? "", used[0]?.tokens as never, PRICES)?.toFixed(6)),
    0.00088,
  );
});

test("a simple job that fails goes to the server's model; an empty answer to the stronger one", async (t) => {
  const seen = await fakeOpenRouter(t, ["deepseek/deepseek-v4.1-flash"], undefined, {
    emptyFor: ["openai/gpt-6.1-cheap"],
  });
  // OpenRouter can't run it: the server's own model answers.
  const text = await complete({
    model: "openrouter/deepseek/deepseek-v4.1-flash",
    effort: "low",
    maxTokens: 4000,
    fallback: "openrouter/openai/gpt-6.1-sol",
    job: "test-simple",
    system: "Be brief.",
    prompt: "Say hello.",
  });
  assert.equal(text, "Hello there.");
  assert.deepEqual(
    seen.map((call) => call.body.model),
    ["deepseek/deepseek-v4.1-flash", "openai/gpt-6.1-sol"],
  );
  assert.equal(lastCalls.get("test-simple")?.ok, false);
  assert.equal(lastCalls.get("test-simple")?.usedInstead, "openrouter/openai/gpt-6.1-sol");
  // It answers with nothing: tried once on the stronger plan.
  seen.length = 0;
  const again = await complete({
    model: "openrouter/openai/gpt-6.1-cheap",
    stronger: { model: "openrouter/openai/gpt-6.1-sol", effort: "high" },
    system: "Be brief.",
    prompt: "Say hello.",
  });
  assert.equal(again, "Hello there.");
  assert.deepEqual(
    seen.map((call) => call.body.model),
    ["openai/gpt-6.1-cheap", "openai/gpt-6.1-sol"],
  );
  // Without a fallback, the failure is the caller's to handle.
  await assert.rejects(
    complete({
      model: "openrouter/deepseek/deepseek-v4.1-flash",
      system: "Be brief.",
      prompt: "Say hello.",
    }),
  );
});

test("a chat reply OpenRouter can't start (out of credit) is answered by the server's model", async (t) => {
  const seen = await fakeOpenRouter(t, ["openai/gpt-6.1-sol"], ["Still here."], { status: 402 });
  const used: string[] = [];
  const agent = tanstackAgent({
    model: "openrouter/openai/gpt-6.1-sol",
    effort: "high",
    maxTokens: 16000,
    fallback: "openrouter/deepseek/deepseek-v4.1-flash",
    job: "test-chat",
    maxSteps: 2,
    tools: [],
    prompt: "Be brief.",
    onUsage: (model) => used.push(model),
  });
  const input: RunAgentInput = {
    threadId: "fallback-chat",
    runId: "fallback-chat-run",
    messages: [{ id: "m1", role: "user", content: "Hello" }],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  };
  let text = "";
  const errors: string[] = [];
  await new Promise<void>((resolve, reject) =>
    agent.run(input).subscribe({
      next: (event) => {
        if (event.type === EventType.TEXT_MESSAGE_CHUNK && "delta" in event)
          text += String(event.delta);
        if (event.type === EventType.RUN_ERROR)
          errors.push(String((event as { message?: unknown }).message));
      },
      error: reject,
      complete: resolve,
    }),
  );
  assert.deepEqual(errors, []);
  assert.equal(text, "Still here.");
  assert.deepEqual(
    seen.map((call) => call.body.model),
    ["openai/gpt-6.1-sol", "deepseek/deepseek-v4.1-flash"],
  );
  // The server's model has its own defaults: no OpenRouter effort or cap is passed on.
  assert.equal(seen[1]?.body.reasoning, undefined);
  // Its tokens are priced as the model that answered, and the card can say what happened.
  assert.deepEqual(used, ["openrouter/deepseek/deepseek-v4.1-flash"]);
  assert.equal(lastCalls.get("test-chat")?.error, "Out of credit (402)");
});

test("each job uses the picks once OpenRouter is set up, and the admin's choice after that", async (t) => {
  await fakeOpenRouter(t);
  let key = false;
  const prices: [string, unknown][] = [];
  const choices = await new ModelChoices(
    db,
    { model: "anthropic/claude-sonnet-5", workerModel: "anthropic/claude-haiku-4-5-20251001" },
    { hasKey: () => key, onPrice: (model, price) => prices.push([model, price]) },
  ).load();
  // No key: everything stays on the server's Claude models, as before, and the card shows the
  // picks that start once the key is there.
  assert.deepEqual(choices.plan("chat"), { model: "anthropic/claude-sonnet-5" });
  assert.deepEqual(choices.plan("simple"), { model: "anthropic/claude-haiku-4-5-20251001" });
  assert.equal(choices.choice("chat").model, RECOMMENDED.chat.model);
  key = true;
  assert.deepEqual(choices.plan("chat"), {
    model: "openrouter/openai/gpt-6.1-sol",
    effort: "high",
    maxTokens: OUTPUT_LIMITS.chat,
    contextLimit: CONTEXT_LIMIT,
    fallback: "anthropic/claude-sonnet-5",
    job: "chat",
  });
  assert.equal(choices.plan("background").effort, "medium");
  assert.equal(choices.plan("background").fallback, "anthropic/claude-haiku-4-5-20251001");
  assert.equal(choices.plan("simple").model, RECOMMENDED.simple.model);
  // A simple job that thinks harder gets room for its thinking.
  assert.equal(outputLimit("simple", "high"), 16_000);
  // Back to Claude for one job, with one tap.
  await choices.save("background", { model: SERVER_MODEL });
  assert.equal(choices.plan("background").model, "anthropic/claude-haiku-4-5-20251001");
  // Another OpenRouter model, checked against OpenRouter's list and priced from it.
  await choices.save("simple", { model: "openrouter/deepseek/deepseek-v4-flash", effort: "low" });
  assert.equal(choices.plan("simple").model, "openrouter/deepseek/deepseek-v4-flash");
  assert.deepEqual(prices, [
    ["openrouter/deepseek/deepseek-v4-flash", { input: 0.05, output: 1.5 }],
  ]);
  // Refused: a typo, a model that can't use tools, a "-pro" one, and a malformed ID.
  await assert.rejects(
    choices.save("chat", { model: "openrouter/openai/gpt-6.1-sool" }),
    /doesn’t have a model called “openai\/gpt-6.1-sool”/,
  );
  await assert.rejects(
    choices.save("chat", { model: "openrouter/acme/chatty-1" }),
    /can’t use the app’s tools/,
  );
  await assert.rejects(
    choices.save("chat", { model: "openrouter/openai/gpt-6.1-sol-pro" }),
    /-pro/,
  );
  await assert.rejects(choices.save("chat", { model: "openrouter/gpt sol" }), /company, a slash/);
  assert.equal(choices.plan("chat").model, RECOMMENDED.chat.model);
  // Saved choices survive a restart (with their price); null goes back to the pick.
  prices.length = 0;
  const again = await new ModelChoices(
    db,
    { model: "anthropic/claude-sonnet-5" },
    { hasKey: () => true, onPrice: (model, price) => prices.push([model, price]) },
  ).load();
  assert.equal(again.choice("background").model, SERVER_MODEL);
  assert.equal(prices.length, 1);
  await again.save("background", null);
  assert.equal(again.plan("background").model, RECOMMENDED.background.model);
  // Everything back on Claude in one go, and back to the picks.
  await again.saveAll("claude");
  assert.ok(MODEL_JOBS.every((job) => again.choice(job).model === SERVER_MODEL));
  await again.saveAll("recommended");
  assert.ok(MODEL_JOBS.every((job) => again.choice(job).model === RECOMMENDED[job].model));
  // Without the key, a saved OpenRouter choice falls back to the server's model.
  key = false;
  assert.equal(choices.plan("simple").model, "anthropic/claude-haiku-4-5-20251001");
});

test("a model OpenRouter doesn't price is priced from its list, unless the meter knows it", () => {
  const meter = new UsageMeter(db, { ...PRICES });
  meter.addPrice("openrouter/acme/thinker-2", { input: 1, output: 4 });
  meter.addPrice("openrouter/openai/gpt-6.1-sol", { input: 99, output: 99 });
  const tokens = { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0, searches: 0 };
  assert.equal(meter.cost("openrouter/acme/thinker-2", tokens), 1);
  assert.equal(meter.cost("openrouter/openai/gpt-6.1-sol", tokens), 2);
});

test("a call over the context limit leaves out the oldest messages, never the latest turn", () => {
  const big = "x".repeat(40_000); // about 10,000 tokens
  const messages = [
    { role: "user", content: big },
    { role: "assistant", content: big },
    { role: "user", content: big },
    { role: "assistant", content: big },
    { role: "user", content: "And now?" },
  ];
  assert.equal(fitContext(messages, 0, undefined).length, 5);
  const fitted = fitContext(messages, 1_000, 25_000);
  assert.equal(fitted.at(-1)?.content, "And now?");
  assert.ok(fitted.length < messages.length);
  // The latest turn stays even when it alone is too big.
  assert.equal(fitContext([{ role: "user", content: big }], 0, 10).length, 1);
});

test("usage keeps today, the last 7 days and all time, in the person's own time zone", async () => {
  let now = new Date("2026-10-06T03:30:00Z"); // 10:30 pm on Oct 5 in Chicago
  const meter = new UsageMeter(db, PRICES, () => now);
  meter.zoneOf = async () => "America/Chicago";
  const tokens = { input: 1000, cacheRead: 0, cacheWrite: 0, output: 100, searches: 0 };
  await meter.record("days-owner", "chat", "openrouter/openai/gpt-6.1-sol", tokens);
  now = new Date("2026-10-06T15:00:00Z"); // Oct 6 in Chicago
  await meter.record(
    "days-owner",
    "simple" as never,
    "openrouter/deepseek/deepseek-v4.1-flash",
    tokens,
  );
  const periods = await meter.periods("days-owner");
  assert.equal(periods.today.calls, 1);
  assert.equal(periods.week.calls, 2);
  assert.equal(periods.all.calls, 2);
  assert.equal(periods.since, "2026-10-05");
  assert.equal(periods.all.tokens, 2200);
  assert.ok(periods.week.cost > periods.today.cost);
  // Model names drop the router and vendor, so prices match.
  assert.equal(modelName("openrouter/openai/gpt-6.1-sol"), "gpt-6.1-sol");
  // A week later, those two days have left the last 7 days but stay in all time.
  now = new Date("2026-10-14T15:00:00Z");
  const later = await meter.periods("days-owner");
  assert.equal(later.week.calls, 0);
  assert.equal(later.all.calls, 2);
});

test("a background job runs on OpenRouter with its tools, at medium effort, the time last", async (t) => {
  const seen = await fakeOpenRouter(t, [], ["Which bank do you use?"]);
  let task = {
    id: "or-job-1",
    title: "Get my statement",
    prompt: "Download my statement for August 2026.",
    kind: "agent",
    status: "running",
    plan: [],
    evidence: [],
    artifactIds: [],
    state: {},
    createdAt: "2026-10-06T12:00:00.000Z",
    updatedAt: "2026-10-06T12:00:00.000Z",
  } as unknown as AgentTask;
  const choices = await new ModelChoices(
    db,
    { model: "anthropic/claude-sonnet-5" },
    { hasKey: () => true },
  ).load();
  await choices.saveAll("recommended");
  const service = {
    config: { model: "anthropic/claude-sonnet-5" },
    modelFor: (job: "chat" | "background" | "simple") => choices.plan(job),
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
  const result = await executeModelTask(service, "or-owner", task, ctx);
  assert.equal(result.status, "waiting_input");
  const body = seen[0]?.body as {
    model: string;
    tools?: unknown[];
    reasoning?: unknown;
    max_tokens?: number;
    messages: { role: string; content: string }[];
  };
  assert.equal(body.model, "openai/gpt-6.1-sol");
  assert.ok((body.tools?.length ?? 0) > 5, "the job's tools are offered");
  assert.deepEqual(body.reasoning, { effort: "medium" });
  assert.equal(body.max_tokens, OUTPUT_LIMITS.background);
  // The long fixed instructions come before the time, so their beginning stays cacheable.
  const system = body.messages.find((m) => m.role === "system")?.content ?? "";
  assert.ok(system.indexOf("It's ") > system.indexOf("Email and calendar:"));
});
