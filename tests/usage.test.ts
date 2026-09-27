import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import {
  costOf,
  fromAnthropic,
  fromTanstack,
  PRICES,
  parsePrices,
  UsageMeter,
} from "../apps/server/src/usage.ts";

test("usage is added up per person and month and priced by model", async () => {
  const db = await createStore();
  let now = new Date("2026-09-27T12:00:00Z");
  const meter = new UsageMeter(db, PRICES, () => now);
  const sink = meter.sink("sam", "chat");
  sink("anthropic/claude-sonnet-5", {
    input: 1_000_000,
    cacheRead: 1_000_000,
    cacheWrite: 0,
    output: 100_000,
    searches: 0,
  });
  // Calls at the same moment are all kept.
  await Promise.all([
    meter.record("sam", "background", "anthropic/claude-haiku-4-5-20251001", {
      input: 1_000_000,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      searches: 0,
    }),
    meter.record("sam", "search", "claude-haiku-4-5-20251001", {
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      searches: 3,
    }),
    meter.record("sam", "chat", "anthropic/claude-sonnet-5", {
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      searches: 0,
    }),
  ]);
  const month = await meter.month("sam");
  assert.equal(month.month, "2026-09");
  assert.equal(month.calls, 4);
  const chat = month.lines.find((line) => line.kind === "chat");
  assert.equal(chat?.calls, 2);
  assert.equal(chat?.model, "claude-sonnet-5");
  // $2 input + $0.20 cache reads + $1 output.
  assert.ok(Math.abs((chat?.cost ?? 0) - 3.2) < 1e-9);
  assert.ok(Math.abs(month.cost - (3.2 + 1 + 0.03)) < 1e-9);
  assert.deepEqual(month.unpriced, []);
  // Someone else's usage is separate.
  assert.equal((await meter.month("alex")).calls, 0);
  now = new Date("2026-10-02T12:00:00Z");
  await meter.record("sam", "chat", "openai/some-new-model", {
    input: 10,
    cacheRead: 0,
    cacheWrite: 0,
    output: 10,
    searches: 0,
  });
  const october = await meter.month("sam");
  assert.deepEqual(october.unpriced, ["some-new-model"]);
  assert.equal(october.cost, 0);
  assert.deepEqual(
    (await meter.history("sam")).map((m) => m.month),
    ["2026-10", "2026-09"],
  );
});

test("token counts are read the same way from each provider", () => {
  // Claude's input count leaves out cache reads; other providers include them.
  assert.deepEqual(
    fromTanstack("anthropic/claude-sonnet-5", {
      promptTokens: 100,
      completionTokens: 20,
      promptTokensDetails: { cachedTokens: 900, cacheWriteTokens: 50 },
    }),
    { input: 100, cacheRead: 900, cacheWrite: 50, output: 20, searches: 0 },
  );
  assert.deepEqual(
    fromTanstack("openai/gpt-5.6-terra", {
      promptTokens: 1000,
      completionTokens: 20,
      promptTokensDetails: { cachedTokens: 900 },
    }),
    { input: 100, cacheRead: 900, cacheWrite: 0, output: 20, searches: 0 },
  );
  assert.deepEqual(
    fromAnthropic({
      input_tokens: 5,
      output_tokens: 7,
      cache_read_input_tokens: null,
      server_tool_use: { web_search_requests: 2 },
    }),
    { input: 5, cacheRead: 0, cacheWrite: 0, output: 7, searches: 2 },
  );
  // Written with a dot or a dash, and corrected or added with MODEL_PRICES.
  const tokens = { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0, searches: 0 };
  assert.equal(costOf("anthropic/claude-haiku-4.5", tokens, PRICES), 1);
  const prices = { ...PRICES, ...parsePrices("claude-opus-5=5/25, bad, gpt-x=oops") };
  assert.equal(costOf("anthropic/claude-opus-5", tokens, prices), 5);
  assert.equal(costOf("openai/gpt-x", tokens, prices), undefined);
});
