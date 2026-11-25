import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { Commitments, mentionsPlan, parseCommitments } from "../apps/server/src/commitments.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { EmailViews } from "../apps/server/src/email-views.ts";
import { coachNote, needsOf } from "../apps/server/src/turn-coach.ts";

/** A date this many days from now, as YYYY-MM-DD (UTC is fine: the tests only need "later"). */
const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function server() {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-capture-"));
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
  const app = await createApp(db, config);
  const agent = app.agent;
  // Capture needs a model; the sample agent has none.
  Object.assign(agent.config, { agentBackend: "model", model: "anthropic/claude-test" });
  const prompts: { system: string; prompt: string }[] = [];
  let reply = '{"commitment":null}';
  agent.complete = async ({ system, prompt }) => {
    prompts.push({ system: system ?? "", prompt });
    return reply;
  };
  return { db, agent, prompts, answer: (text: string) => (reply = text) };
}

test("plain code spots a plan with a time, and leaves questions and plain chat alone", () => {
  for (const said of [
    "I fly to Tokyo on the 3rd",
    "We're flying out Friday at 7am",
    "I'll call the dentist Friday",
    "My haircut is tomorrow at 3pm",
    "The part should arrive next Tuesday",
    "Booked dinner at Nobu for Dec 12",
    "I promised Dana the deck by Monday",
  ])
    assert.ok(mentionsPlan(said), said);
  for (const said of [
    "When is my flight?",
    "what's the weather tomorrow?",
    "I love flying",
    "Thanks!",
    "Tell me a joke about Tuesday",
    "Is my dentist appointment on Friday?",
    "Schedule a meeting with Dana tomorrow",
    "Can you book dinner for Friday at 7?",
    "Remind me to call mom tomorrow",
  ])
    assert.ok(!mentionsPlan(said), said);
});

test("the turn coach asks for track_commitment only when tracking exists", () => {
  const needs = needsOf("I fly to Tokyo on the 3rd");
  assert.ok(needs.includes("plan"));
  const tools = { search: true, directions: true, nearby: true };
  assert.match(coachNote(needs, { ...tools, track: true }), /call track_commitment/);
  assert.doesNotMatch(coachNote(needs, tools), /track_commitment/);
  assert.ok(!needsOf("When is my flight?").includes("plan"));
});

test("the model's list of plans is read defensively: dated ones only, at most three", () => {
  const found = parseCommitments(
    `Sure: {"commitments":[{"kind":"trip","title":"Flight to Tokyo","at":"2026-12-03T07:00","where":null},{"kind":"promise","title":"Call the dentist","at":"2026-11-27"},{"kind":"trip","title":"Someday Italy","at":null},{"kind":"nonsense","title":"x"},{"kind":"event","title":"Book club","at":"2026-12-01"},{"kind":"event","title":"Choir","at":"2026-12-02"}]}`,
  );
  assert.deepEqual(
    found.map((item) => item.title),
    ["Flight to Tokyo", "Call the dentist", "Book club"],
  );
  assert.deepEqual(parseCommitments("no json here"), []);
});

test("the same plan caught twice (said, then read in its email) is one plan", async () => {
  const db = await createStore();
  const commitments = new Commitments(
    db,
    async () => "America/Chicago",
    async () => undefined,
  );
  const day = ahead(9);
  await commitments.track("o", { kind: "trip", title: "Flight to Tokyo", at: day });
  await commitments.track(
    "o",
    {
      kind: "trip",
      title: "Flight to Tokyo (JAL 61)",
      at: `${day}T07:05`,
      details: "Terminal 1, gate 42",
    },
    "email",
    "email-key",
  );
  const list = await commitments.list("o");
  assert.equal(list.length, 1);
  assert.equal(list[0]?.details, "Terminal 1, gate 42");
  assert.ok(!list[0]?.dateOnly, "the email's time replaces the date alone");
  // A different day is a different plan.
  await commitments.track("o", { kind: "trip", title: "Flight to Tokyo", at: ahead(20) });
  assert.equal((await commitments.list("o")).length, 2);
});

test("emails read in the chat are checked once each, and only the booking-like ones", async () => {
  const { agent, prompts, answer, db } = await server();
  const views = new EmailViews(db);
  views.onRead = (owner, emails) => agent.captureFromEmails(owner, emails);
  const day = ahead(10);
  answer(
    `{"commitment":{"kind":"trip","title":"Flight to Tokyo","at":"${day}T07:05","where":"SFO","reference":"JAL-77Q","details":"Terminal I, gate A12"}}`,
  );
  const read = [
    {
      app: "gmail" as const,
      messageId: "18c1a2b3c4d5e6f7",
      from: "JAL <noreply@jal.com>",
      subject: "Your booking is confirmed: SFO to NRT",
      body: "Thank you for booking. Departure 7:05 AM, Terminal I, gate A12. Confirmation JAL-77Q.",
    },
    {
      app: "gmail" as const,
      messageId: "18c1a2b3c4d5e6f8",
      from: "Mom",
      subject: "Dinner photos",
      body: "Look at these!",
    },
  ];
  await views.save("o", read);
  await agent.captureFromEmails("o", []); // wait for the queue
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(prompts.length, 1, "only the booking reached the model");
  assert.match(prompts[0]?.prompt ?? "", /gate A12/, "the full email, not just a preview");
  const tracked = await agent.commitments?.list("o");
  assert.equal(tracked?.[0]?.title, "Flight to Tokyo");
  assert.equal(tracked?.[0]?.source, "email");
  // Read again: nothing new is asked.
  await agent.captureFromEmails("o", read);
  assert.equal(prompts.length, 1);
});

test("an old booking read again isn't added", async () => {
  const { agent, answer } = await server();
  answer(
    `{"commitment":{"kind":"reservation","title":"Dinner at Nobu","at":"2020-01-05T19:00","reference":"OT-1"}}`,
  );
  const found = await agent.captureFromEmails("o", [
    {
      app: "gmail",
      messageId: "aaaa1111bbbb2222",
      from: "OpenTable",
      subject: "Your reservation is confirmed",
      body: "Nobu, Jan 5 2020 at 7 PM",
    },
  ]);
  assert.equal(found, 0);
  assert.deepEqual(await agent.commitments?.list("o"), []);
});

test("a plan said in chat or on a call is caught when the model didn't track it", async () => {
  const { agent, prompts, answer } = await server();
  const day = ahead(8);
  answer(
    `{"commitments":[{"kind":"trip","title":"Flight to Tokyo","at":"${day}T07:00"},{"kind":"promise","title":"Call the dentist","at":"${ahead(2)}"}]}`,
  );
  // Small talk never reaches the model.
  await agent.commitmentsFromWords("o", "thanks, that's great");
  assert.equal(prompts.length, 0);
  await agent.commitmentsFromWords(
    "o",
    "We fly to Tokyo on the 3rd at 7am, and I'll call the dentist Friday",
  );
  assert.equal(prompts.length, 1);
  assert.match(prompts[0]?.prompt ?? "", /Today is \d{4}-\d{2}-\d{2} \(\w+day\)/);
  const tracked = await agent.commitments?.list("o");
  assert.deepEqual(
    tracked?.map((c) => [c.kind, c.title]),
    [
      ["promise", "Call the dentist"],
      ["trip", "Flight to Tokyo"],
    ],
  );
  // Said again on a call: still two plans.
  await agent.commitmentsFromWords("o", "Remember we fly to Tokyo on the 3rd at 7am");
  assert.equal((await agent.commitments?.list("o"))?.length, 2);
});

test("the 60-day look back runs once, only with Gmail connected", async () => {
  const { agent, db, answer } = await server();
  const calls: { slug: string; args: Record<string, unknown> }[] = [];
  let gmail = false;
  Object.assign(agent, {
    apps: {
      connections: async () => [{ app: "gmail", name: "Gmail", connected: gmail }],
      execute: async (_owner: string, slug: string, args: Record<string, unknown>) => {
        calls.push({ slug, args });
        return {
          messages: [
            {
              messageId: "c0ffee00c0ffee00",
              sender: "United <no-reply@united.com>",
              subject: "Your trip confirmation: Chicago to Denver",
              messageText: "Flight UA 123 departs 8:15 AM, gate B7. Confirmation ABC123.",
            },
          ],
        };
      },
    },
  });
  answer(
    `{"commitment":{"kind":"trip","title":"Flight to Denver","at":"${ahead(12)}T08:15","reference":"ABC123","details":"gate B7"}}`,
  );
  await agent.lookBack("o");
  assert.equal(calls.length, 0, "no Gmail: nothing to read");
  gmail = true;
  await agent.lookBack("o");
  assert.equal(calls.length, 0, "tried a moment ago: waits six hours");
  await db.put("o", "agent-settings", { id: "mail-lookback", tried: "2020-01-01T00:00:00Z" });
  await agent.lookBack("o");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.slug, "GMAIL_FETCH_EMAILS");
  assert.match(String(calls[0]?.args.query), /newer_than:60d/);
  assert.equal((await agent.commitments?.list("o"))?.[0]?.title, "Flight to Denver");
  await agent.lookBack("o");
  assert.equal(calls.length, 1, "once per person");
});
