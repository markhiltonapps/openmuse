import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Auth } from "../apps/server/src/auth.ts";
import { CodeSandbox } from "../apps/server/src/code-sandbox.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { Files } from "../apps/server/src/files.ts";

// The smallest valid PNG: a chart the sandbox "made".
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);

async function setUp() {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-sandbox-"));
  const db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  const files = new Files(db, config, new Auth(db, config, "test-signing-key"));
  return {
    db,
    files,
    done: async () => {
      await db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  form?: FormData;
}
/** A stand-in for the Anthropic API: files, messages and downloads. */
function fakeApi(replies: ((call: Call) => { status?: number; body: unknown })[]) {
  const calls: Call[] = [];
  let reply = 0;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const call: Call = { method: init?.method ?? "GET", path };
    if (init?.body instanceof FormData) call.form = init.body;
    else if (typeof init?.body === "string") call.body = JSON.parse(init.body);
    calls.push(call);
    if (path === "/v1/files" && call.method === "POST")
      return Response.json({ id: `file_up_${calls.length}` });
    if (call.method === "DELETE") return Response.json({ id: path.split("/").at(-1) });
    if (path.endsWith("/content")) return new Response(PNG);
    if (path.startsWith("/v1/files/")) return Response.json({ filename: "../spend chart.png" });
    const next = replies[reply++];
    assert(next, `unexpected call ${path}`);
    const { status = 200, body } = next(call);
    return Response.json(body, { status });
  }) as typeof fetch;
  return { calls, fetcher };
}
const ran = (container: string, text: string, extra: object = {}) => ({
  container: { id: container },
  stop_reason: "end_turn",
  usage: { input_tokens: 100, output_tokens: 20 },
  content: [
    {
      type: "server_tool_use",
      id: "s1",
      name: "bash_code_execution",
      input: { command: "python" },
    },
    {
      type: "bash_code_execution_tool_result",
      tool_use_id: "s1",
      content: {
        type: "bash_code_execution_result",
        stdout: "Total: $1,234.50\nspend chart.png",
        stderr: "",
        return_code: 0,
        content: [{ type: "bash_code_execution_output", file_id: "file_made_1" }],
      },
    },
    { type: "text", text },
  ],
  ...extra,
});

test("a job runs in the person's own sandbox, with their file in and the chart it made saved to Files", async () => {
  const { db, files, done } = await setUp();
  const csv = await files.import(
    "me",
    "september.csv",
    new TextEncoder().encode("date,amount\n2026-09-01,1234.50\n"),
    "Uploaded",
  );
  const { calls, fetcher } = fakeApi([
    () => ({ body: ran("cntr_1", "You spent $1,234.50 in September; the chart is in Files.") }),
    () => ({ body: ran("cntr_1", "Done again.") }),
  ]);
  const used: string[] = [];
  const sandbox = new CodeSandbox(db, files, "k", {
    fetcher,
    model: "claude-sonnet-5",
    now: () => Date.parse("2026-09-28T12:00:00Z"),
  });
  const result = await sandbox.run(
    "me",
    { task: "Total my September spending and chart it by week.", files: [csv.id] },
    (model) => used.push(model),
  );
  assert.equal(result.summary, "You spent $1,234.50 in September; the chart is in Files.");
  assert.deepEqual(
    result.files.map((f) => f.name),
    ["spend chart.png"],
    "saved under a safe name",
  );
  assert.equal((await files.get("me", result.files[0]?.id ?? "")).name, "spend chart.png");
  assert.match(result.output[0]?.text ?? "", /Total: \$1,234\.50/);
  assert.equal(result.copiedIn, 1, "the card can say a copy stays in the sandbox");
  assert.deepEqual(used, ["claude-sonnet-5"], "usage is recorded");
  const message = calls.find((c) => c.path === "/v1/messages");
  assert.deepEqual(((message?.body?.tools ?? []) as unknown[])[0], {
    type: "code_execution_20260120",
    name: "code_execution",
  });
  assert.equal(message?.body?.container, undefined, "the first job starts a container");
  const content = (
    (message?.body?.messages ?? []) as { content: { type: string; file_id?: string }[] }[]
  )[0]?.content;
  assert.equal(content?.[1]?.type, "container_upload");
  assert.equal(content?.[1]?.file_id, "file_up_1");
  assert.equal(calls[0]?.form?.get("expires_in_seconds"), "86400");
  // Uploaded and generated files are deleted from Anthropic afterwards.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const deleted = calls.filter((c) => c.method === "DELETE").map((c) => c.path);
  assert.ok(deleted.includes("/v1/files/file_up_1"));
  assert.ok(deleted.includes("/v1/files/file_made_1"));
  // The next job reuses the person's container.
  await sandbox.run("me", { task: "Now do August the same way." });
  const second = calls.filter((c) => c.path === "/v1/messages")[1];
  assert.equal(second?.body?.container, "cntr_1");
  // Someone else's file never goes in.
  await assert.rejects(
    sandbox.run("other", { task: "Read their file please.", files: [csv.id] }),
    /not found/,
  );
  await done();
});

test("a long job carries on after a pause, and a lost container is replaced", async () => {
  const { db, files, done } = await setUp();
  await db.put("me", "agent-settings", {
    id: "sandbox",
    container: "cntr_old",
    startedAt: "2026-09-20T12:00:00Z",
  });
  const { calls, fetcher } = fakeApi([
    () => ({ status: 400, body: { error: { message: "container cntr_old not found" } } }),
    () => ({ body: { ...ran("cntr_new", "Halfway."), stop_reason: "pause_turn" } }),
    () => ({ body: ran("cntr_new", "Finished.") }),
  ]);
  const sandbox = new CodeSandbox(db, files, "k", {
    fetcher,
    now: () => Date.parse("2026-09-28T12:00:00Z"),
  });
  const result = await sandbox.run("me", { task: "Convert these numbers to a spreadsheet." });
  assert.equal(result.summary, "Halfway.Finished.");
  const messages = calls.filter((c) => c.path === "/v1/messages");
  assert.equal(messages[0]?.body?.container, "cntr_old");
  assert.equal(
    messages[1]?.body?.container,
    undefined,
    "a new container after the old one was lost",
  );
  assert.equal(messages[2]?.body?.container, "cntr_new");
  assert.equal(
    ((messages[2]?.body?.messages ?? []) as unknown[]).length,
    2,
    "the paused work is sent back to carry on",
  );
  assert.equal(
    (await db.get<{ container: string }>("me", "agent-settings", "sandbox"))?.container,
    "cntr_new",
  );
  await done();
});

test("one job at a time per person", async () => {
  const { db, files, done } = await setUp();
  let release: () => void = () => undefined;
  const { fetcher } = fakeApi([() => ({ body: ran("c", "ok") })]);
  let held = false;
  // Only the first call waits, so the first job is still running when the second arrives.
  const slow = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!held) {
      held = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return fetcher(url, init);
  }) as typeof fetch;
  const sandbox = new CodeSandbox(db, files, "k", { fetcher: slow });
  const first = sandbox.run("me", { task: "A long calculation to run." });
  await assert.rejects(sandbox.run("me", { task: "Another job at the same time." }), /busy/);
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  await first;
  await done();
});

test("clearing the sandbox empties and forgets it, even if the sandbox can't be reached", async () => {
  const { db, files, done } = await setUp();
  await db.put("me", "agent-settings", {
    id: "sandbox",
    container: "cntr_1",
    startedAt: "2026-09-27T12:00:00Z",
  });
  const { calls, fetcher } = fakeApi([
    () => ({ body: { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" } }),
    () => ({ status: 500, body: { error: { message: "overloaded" } } }),
  ]);
  const sandbox = new CodeSandbox(db, files, "k", { fetcher });
  assert.deepEqual(await sandbox.clear("me"), { cleared: true });
  const message = calls.find((c) => c.path === "/v1/messages");
  assert.equal(message?.body?.container, "cntr_1");
  assert.match(JSON.stringify(message?.body?.messages), /rm -rf/);
  assert.equal(await db.get("me", "agent-settings", "sandbox"), null);
  // Nothing saved: nothing to clear.
  assert.deepEqual(await sandbox.clear("me"), { cleared: true });
  await db.put("me", "agent-settings", {
    id: "sandbox",
    container: "cntr_2",
    startedAt: "2026-09-27T12:00:00Z",
  });
  assert.deepEqual(await sandbox.clear("me"), { cleared: false });
  assert.equal(await db.get("me", "agent-settings", "sandbox"), null, "forgotten anyway");
  await done();
});
