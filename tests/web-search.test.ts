import assert from "node:assert/strict";
import { test } from "node:test";
import { AnthropicWebSearch, webSearchToolSpecs } from "../apps/server/src/web-search.ts";

function fakeAnthropic(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Response.json(body, { status });
  }) as typeof fetch;
  return { calls, fetcher };
}

test("web search asks Anthropic's search tool and returns a sourced summary", async () => {
  const { calls, fetcher } = fakeAnthropic(200, {
    content: [
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "s1",
        content: [
          {
            type: "web_search_result",
            url: "https://example.com/menu",
            title: "Menu",
            page_age: "2 days ago",
          },
          { type: "web_search_result", url: "https://example.com/hours", title: "Hours" },
          { type: "web_search_result", url: "javascript:alert(1)", title: "Bad" },
        ],
      },
      {
        type: "text",
        text: "Luigi's is open until 10 pm.",
        citations: [
          { type: "web_search_result_location", url: "https://example.com/hours", title: "Hours" },
        ],
      },
      { type: "text", text: " Pizzas start at $14." },
    ],
  });
  const search = new AnthropicWebSearch("sk-test", {
    fetcher,
    baseUrl: "https://proxy.test/v1",
    now: () => new Date("2026-09-26T12:00:00Z"),
  });
  const [tool] = webSearchToolSpecs(search);
  const result = await tool?.execute({ query: "Luigi's pizza hours" });
  assert.equal(result?.answer, "Luigi's is open until 10 pm. Pizzas start at $14.");
  // Cited sources come first, and only web links are kept.
  assert.deepEqual(result?.sources, [
    { url: "https://example.com/hours", title: "Hours" },
    { url: "https://example.com/menu", title: "Menu", age: "2 days ago" },
  ]);
  assert.equal(calls[0]?.url, "https://proxy.test/v1/messages");
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], "sk-test");
  const body = JSON.parse(String(calls[0]?.init.body));
  assert.deepEqual(body.tools, [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]);
  assert.match(body.messages[0].content, /^Today is 2026-09-26\. Search the web for: Luigi's/);
  assert.match(body.messages[0].content, /untrusted/);
});

test("web search reports provider errors", async () => {
  const denied = fakeAnthropic(400, { error: { message: "Web search is disabled" } });
  await assert.rejects(
    new AnthropicWebSearch("k", { fetcher: denied.fetcher }).search("news"),
    /Web search failed: Web search is disabled/,
  );
  const failed = fakeAnthropic(200, {
    content: [
      {
        type: "web_search_tool_result",
        content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
      },
    ],
  });
  await assert.rejects(
    new AnthropicWebSearch("k", { fetcher: failed.fetcher }).search("news"),
    /max_uses_exceeded/,
  );
});
