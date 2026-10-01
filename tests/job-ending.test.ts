import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { createStore } from "../apps/server/src/db.ts";
import { nowDoing, readLastWords } from "../apps/server/src/engine/job-words.ts";
import { type ModelCall, modelFixture } from "./helpers/model.ts";

test("a job's last words are its answer, a question, or a stop part-way", () => {
  const answer = readLastWords(
    "Let me compile the final answer:\n\n## Cheapest with a waveguide\n\nThe AIAF Clear A6 at $599.",
  );
  assert.equal(answer.kind, "answer");
  assert.match(answer.text, /^## Cheapest/);
  assert.equal(readLastWords("Which city should I search in?").kind, "question");
  assert.equal(readLastWords("Should I use Amazon or Best Buy?**").kind, "question");
  assert.equal(readLastWords("Now let me check the price:").kind, "stopped");
  assert.equal(readLastWords("I'll look at the next page.").kind, "stopped");
  assert.equal(readLastWords("").kind, "stopped");
  assert.equal(readLastWords("The cheapest is the RayNeo Air 4 Pro at $299.").kind, "answer");
  // A question in the middle of the last paragraph still asks.
  assert.equal(
    readLastWords("Which bank do you use? Tell me its name and I'll get the statement.").kind,
    "question",
  );
  // A link's address isn't a question.
  assert.equal(readLastWords("It's at https://www.amazon.com/s?k=glasses today.").kind, "answer");
  // An offer after a full answer is dropped; the answer stands.
  const offered = readLastWords(
    `${"The AIAF Clear A6 costs $599. ".repeat(12)}\n\nWould you like a PDF?`,
  );
  assert.equal(offered.kind, "answer");
  assert.doesNotMatch(offered.text, /PDF/);
});

test("the job page's line says what the agent is doing in plain words", () => {
  assert.deepEqual(nowDoing("web_search", { query: "ai glasses" }), {
    label: "Searching the web",
    kind: "search",
  });
  assert.equal(nowDoing("open_page", {}, "amazon.com")?.label, "Looking at amazon.com");
  assert.equal(nowDoing("use_page", {})?.label, "Using a website");
  assert.equal(
    nowDoing("read_workspace", { section: "calendar" })?.label,
    "Checking your calendar",
  );
  assert.equal(nowDoing("create_document", { format: "pdf" })?.label, "Making your PDF");
  assert.equal(nowDoing("create_document", { format: "docx" })?.label, "Writing your document");
  assert.equal(nowDoing("suggest_memory", {}), undefined);
});

test("a run that ends without finish_task keeps only its last words", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-job-ending-"));
  const db = await createStore();
  const replies: ModelCall[] = [];
  await modelFixture(t, () => replies.shift());
  const server = await createApp(db, {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "model",
    intelligenceApiKey: "test-project-key-never-sent",
    model: "openai/fixture",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  });
  try {
    // It narrates, looks something up, then gives its answer without calling finish_task.
    replies.push(
      {
        text: "I'll help you find the cheapest glasses. Let me open Amazon.",
        name: "read_web",
        arguments: { url: "http://127.0.0.1:9/s?k=glasses" },
      },
      {
        text: "Let me compile the final answer:\n\n## Cheapest with a waveguide\n\nThe AIAF Clear A6 at $599.",
      },
    );
    const job = await server.agent.delegate("owner", { prompt: "Find the cheapest AI glasses" });
    await server.agent.worker.tick();
    const done = await server.agent.detail("owner", job.id);
    assert.equal(done.task.status, "succeeded", done.task.error ?? done.task.question);
    assert.equal(done.task.result, "## Cheapest with a waveguide\n\nThe AIAF Clear A6 at $599.");
    assert.equal(done.task.state.now, "Looking at 127.0.0.1");
    assert.equal(done.task.state.nowKind, "browse");
    assert.ok(done.artifacts.some((artifact) => artifact.final));

    // A question is asked on its own, without the commentary before it.
    replies.push(
      { text: "Let me search.", name: "set_plan", arguments: { steps: ["Search"] } },
      { text: "Which city should I search in?" },
    );
    const asks = await server.agent.delegate("owner", { prompt: "Find a plumber" });
    await server.agent.worker.tick();
    const waiting = await server.agent.getTask("owner", asks.id);
    assert.equal(waiting.status, "waiting_input");
    assert.equal(waiting.question, "Which city should I search in?");

    // Stopping part-way asks what to do next rather than showing half a sentence.
    replies.push({ text: "Now let me check the price:" });
    const stops = await server.agent.delegate("owner", { prompt: "Check a price" });
    await server.agent.worker.tick();
    const stopped = await server.agent.getTask("owner", stops.id);
    assert.equal(stopped.status, "waiting_input");
    assert.match(stopped.question ?? "", /I stopped before finishing/);
  } finally {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
