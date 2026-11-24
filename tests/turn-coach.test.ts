import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { lastValueFrom, toArray } from "rxjs";
import { createApp } from "../apps/server/src/app.ts";
import { ConversationAgent } from "../apps/server/src/engine/conversation.ts";
import { VOLATILE_CONTEXT } from "../apps/server/src/engine/tanstack-agent.ts";
import { coachNote, latestWords, needsOf } from "../apps/server/src/turn-coach.ts";
import { browserFixture } from "./helpers/browser.ts";
import { modelFixture } from "./helpers/model.ts";

test("the coach reads what a message needs, from real phrasings (and leaves ordinary ones alone)", () => {
  const cases: [string, string[]][] = [
    // From the owner's day in Singapore.
    [
      "Is there anything within walking distance to the Hilton Orchard that might have it?",
      ["places"],
    ],
    ["Where can I buy a travel pillow near here?", ["shopping", "places"]],
    [
      "I'm at Uni-Glow in Paragon between Pandora and Estée Lauder. How do I get to Hilton Orchard?",
      ["directions"],
    ],
    ["I'm on level 4 and still can't find it", ["correction"]],
    ["That's not helpful. Another AI gave me landmarks.", ["correction"]],
    // Other everyday questions about the world.
    ["Is the MRT still running?", ["live"]],
    ["What's the best laksa around here?", ["places", "recommendation"]],
    ["How much is a taxi to Changi?", ["live"]],
    ["Is the pharmacy open now?", ["live"]],
    // Their own things, writing and general knowledge: no coach.
    ["What's on my calendar today?", []],
    ["How much did I spend on food this month?", []],
    ["Remind me to call mom at 3", []],
    ["Schedule a meeting with Dana tomorrow", []],
    ["What went wrong with my order?", []],
    ["Explain how compound interest works", []],
    ["Write an email to Dana about the budget", []],
    ["We're near the end of the month, any bills left?", []],
  ];
  for (const [text, expected] of cases)
    assert.deepEqual(needsOf(text).sort(), [...expected].sort(), text);
});

test("the note points only at tools the server has, and says what to do without one", () => {
  const all = { search: true, directions: true, nearby: true };
  const none = { search: false, directions: false, nearby: false };
  assert.equal(coachNote([], all), "");
  assert.match(coachNote(["directions"], all), /call get_directions before answering/);
  assert.doesNotMatch(coachNote(["directions"], none), /get_directions|search_web/);
  assert.match(coachNote(["directions"], none), /Google Maps link/);
  const shop = coachNote(["shopping", "places"], all);
  assert.match(shop, /search_web for shops that sell it/);
  assert.match(shop, /Never answer with a list of malls/);
  assert.doesNotMatch(shop, /find_nearby/, "shopping isn't a pharmacy-or-ATM question");
  assert.match(coachNote(["correction"], all), /say what was missing/);
  assert.match(coachNote(["live"], all), /If no tool can check it/);
  assert.match(coachNote(["correction"], all), /^They're saying/, "a correction comes first");
});

test("the note changes every message, so it sits after the conversation and doesn't break the cache", () => {
  assert.ok(VOLATILE_CONTEXT.test("Coach for this message"));
  assert.equal(
    latestWords([
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: [{ type: "text", text: "Where can I buy" }, { type: "image" }] },
    ]).trim(),
    "Where can I buy",
  );
});

test("in a real chat turn the model reads the note after the person's words, and a turn that skipped every tool is logged", async (t) => {
  const { requests } = await modelFixture(t, () => ({ text: "Try 313@Somerset." }));
  const fixture = await browserFixture(t, () => ({ data: {} }));
  const config = { ...fixture.config, agentBackend: "model", model: "openai/fixture" } as const;
  const server = await createApp(fixture.db, config, {});
  t.after(() => server.agent.stop());
  const logged: string[] = [];
  const info = console.info;
  console.info = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  t.after(() => {
    console.info = info;
  });
  const run = (content: string) =>
    lastValueFrom(
      new ConversationAgent(config, server.agent, "local-user")
        .run({
          threadId: `coach-${randomUUID()}`,
          runId: randomUUID(),
          messages: [{ id: randomUUID(), role: "user", content }],
          tools: [],
          context: [],
          state: {},
          forwardedProps: {},
        })
        .pipe(toArray()),
    );
  await run("Where can I buy a travel pillow near here?");
  const body = requests[0]?.body ?? "";
  const note = body.indexOf("Coach for this message:");
  assert.ok(note > 0, "the note is in the turn");
  assert.ok(
    note > body.indexOf("travel pillow"),
    "the note comes after their words, not in the cached instructions",
  );
  assert.ok(body.includes("Real-world specifics"), "the grounding rule is in the instructions");
  assert.ok(
    logged.some((line) =>
      /Answered without checking: places, shopping|Answered without checking: shopping, places/.test(
        line,
      ),
    ),
    logged.join("\n"),
  );
  logged.length = 0;
  await run("Write a thank-you note to Dana");
  const plain = requests.at(-1)?.body ?? "";
  assert.ok(!plain.includes("Coach for this message:"), "nothing special: no note");
  assert.ok(!logged.some((line) => line.includes("Answered without checking")));
});
