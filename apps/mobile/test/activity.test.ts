import assert from "node:assert/strict";
import { test } from "node:test";
import { chatActivity, taskActivity, toolActivity } from "../src/activity.ts";

test("tool calls become activities with a readable status", () => {
  assert.deepEqual(toolActivity("search_web", { query: "best Thai food in Houston" }), {
    kind: "search",
    label: "Searching the web for “best Thai food in Houston”…",
  });
  assert.equal(
    toolActivity("browse_web", { url: "https://www.example.com/a" }).label,
    "Reading example.com…",
  );
  assert.equal(
    toolActivity("use_app", { tool: "OUTLOOK_SEND_EMAIL" }).label,
    "Working in Outlook…",
  );
  assert.equal(
    toolActivity("connect_app", { app: "google_sheets" }).label,
    "Connecting Google Sheets…",
  );
  assert.equal(toolActivity("run_computer_command").kind, "computer");
  assert.equal(toolActivity("something_new").kind, "thinking");
  assert.match(toolActivity("search_web", { query: "x".repeat(200) }).label, /…”…$/);
});

test("the chat shows the tool still running, then the reply being written", () => {
  const call = (id: string, name: string, args: object) => ({
    id,
    function: { name, arguments: JSON.stringify(args) },
  });
  const base = [
    { id: "u0", role: "user", content: "old" },
    { id: "a0", role: "assistant", toolCalls: [call("old", "read_file", {})] },
    { id: "u1", role: "user", content: "Find Thai food" },
  ];
  assert.equal(chatActivity(base, false), undefined);
  assert.equal(chatActivity(base, true)?.kind, "thinking");
  const searching = [
    ...base,
    { id: "a1", role: "assistant", toolCalls: [call("t1", "search_web", { query: "Thai food" })] },
  ];
  assert.equal(chatActivity(searching, true)?.kind, "search");
  // Arguments that are still streaming in don't break the status.
  const partial = [
    ...base,
    {
      id: "a1",
      role: "assistant",
      toolCalls: [{ id: "t1", function: { name: "browse_web", arguments: '{"url":"htt' } }],
    },
  ];
  assert.equal(chatActivity(partial, true)?.label, "Reading a web page…");
  const writing = [
    ...searching,
    { id: "r1", role: "tool", toolCallId: "t1", content: "{}" },
    { id: "a2", role: "assistant", content: "Here are three" },
  ];
  assert.deepEqual(chatActivity(writing, true), { kind: "writing", label: "Writing a reply…" });
});

test("background tasks show their current step", () => {
  assert.deepEqual(
    taskActivity({
      kind: "agent",
      title: "Plan a trip",
      plan: [
        { title: "Understand the outcome", status: "succeeded" },
        { title: "Research flights to Austin", status: "running" },
      ],
    }),
    { kind: "search", label: "Research flights to Austin…" },
  );
  assert.equal(taskActivity({ kind: "monitor", title: "Watch prices", plan: [] }).kind, "browse");
});
