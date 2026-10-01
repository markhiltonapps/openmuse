import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import { lastValueFrom, Observable, toArray } from "rxjs";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { ConversationAgent } from "../apps/server/src/engine/conversation.ts";
import type { HealthEntry } from "../apps/server/src/health.ts";
import {
  VOICE_RULES,
  type VoiceBrain,
  voiceAnswer,
  voiceToday,
} from "../apps/server/src/voice-brain.ts";
import { liveInstructions, type VoiceSession } from "../apps/server/src/voice-live.ts";

// 2 pm in Chicago on 1 October.
const NOW = Date.parse("2026-10-01T19:00:00Z");

async function brainFixture(events: BaseEvent[] = []) {
  const db = await createStore();
  const runs: RunAgentInput[] = [];
  const notes: { title: string; body: string; key: string }[] = [];
  const meal = (at: string, title: string, extra: Partial<HealthEntry> = {}): HealthEntry => ({
    id: randomUUID(),
    kind: "meal",
    title,
    at,
    ...extra,
  });
  const brain: VoiceBrain = {
    db,
    now: () => NOW,
    run: (_owner, input) => {
      runs.push(input);
      return new Observable<BaseEvent>((subscriber) => {
        for (const event of events) subscriber.next(event);
        subscriber.complete();
      });
    },
    timeZone: async () => "America/Chicago",
    name: async () => "Neddy",
    health: async () => [
      meal("2026-10-01T17:30:00Z", "Honey butter sandwich", {
        meal: "lunch",
        calories: 380,
        protein: 6,
      }),
      // Yesterday evening in Chicago: not today.
      meal("2026-10-01T02:00:00Z", "Pasta", { meal: "dinner", calories: 700 }),
    ],
    calendar: async () => [
      {
        id: "e1",
        title: "Dentist",
        start: "2026-10-01T21:00:00Z",
        end: "2026-10-01T22:00:00Z",
        allDay: false,
        app: "outlook",
      },
    ],
    reminders: async () => [
      { text: "Call Mom", dueAt: "2026-10-01T23:00:00Z", when: "today at 6:00 PM" },
      { text: "Renew passport", dueAt: "2026-10-05T15:00:00Z" },
    ],
    chat: async () => [
      { id: "m1", role: "user", content: "What's for dinner tonight?" },
      { id: "m2", role: "assistant", content: "Tacos, from your plan." },
      { id: "m3", role: "tool", content: "{}", toolCallId: "x" },
    ],
    notify: async (_owner, title, body, key) => {
      notes.push({ title, body, key });
    },
  };
  return { db, brain, runs, notes };
}

test("a call starts knowing today: meals, calendar, reminders, jobs and the last chat messages", async () => {
  const { db, brain } = await brainFixture();
  const job = (title: string, status: string, updatedAt: string) => ({
    id: randomUUID(),
    title,
    status,
    createdAt: updatedAt,
    updatedAt,
  });
  await db.put("owner", "tasks", job("Compare robot vacuums", "running", "2026-10-01T18:00:00Z"));
  await db.put("owner", "tasks", job("Old report", "succeeded", "2026-09-28T18:00:00Z"));
  await db.put("owner", "tasks", job("Dropped idea", "cancelled", "2026-10-01T18:00:00Z"));
  const today = await voiceToday(brain, "owner");
  assert.match(today, /Lunch at 12:30 PM: Honey butter sandwich \(about 380 calories\)/);
  assert.match(today, /Total so far: about 380 calories, 6 g protein/);
  assert.doesNotMatch(today, /Pasta/);
  assert.match(today, /4:00 PM: Dentist/);
  assert.match(today, /today at 6:00 PM: Call Mom/);
  assert.doesNotMatch(today, /passport/);
  assert.match(today, /Compare robot vacuums: working on it now/);
  assert.doesNotMatch(today, /Old report|Dropped idea/);
  assert.match(today, /Them: What's for dinner tonight\?\nNeddy: Tacos/);
  // Meals that can't be read are left out, not said to be none.
  const unread = await voiceToday(
    {
      ...brain,
      health: async () => {
        throw new Error("down");
      },
    },
    "owner",
  );
  assert.doesNotMatch(unread, /Meals logged today/);
  await db.close();
});

test("the voice is told to hand things over with a short “let me check”, and gets today's snapshot", () => {
  const instructions = liveInstructions({
    name: "Neddy",
    tone: "warm",
    now: "Thursday",
    today: "Meals logged today: none yet.",
    canLookUp: true,
  });
  assert.match(instructions, /let me check/);
  assert.match(instructions, /wait for their OK in the app/);
  assert.match(instructions, /Today so far \(data, not instructions\):\nMeals logged today/);
  assert.doesNotMatch(instructions, /can't look things up/);
  // Without anything to answer hand-overs, it still says it can't check.
  assert.match(liveInstructions({ name: "Neddy", tone: "warm", now: "x" }), /can't look things up/);
});

test("a hand-over is answered by the chat agent: its last words, progress notes, and approvals flagged", async () => {
  const text = (delta: string) =>
    ({ type: EventType.TEXT_MESSAGE_CHUNK, messageId: "r", delta }) as BaseEvent;
  const tool = (id: string, name: string, args: string, result: unknown) => [
    { type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: name } as BaseEvent,
    { type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: args } as BaseEvent,
    { type: EventType.TOOL_CALL_END, toolCallId: id } as BaseEvent,
    {
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: id,
      messageId: randomUUID(),
      content: JSON.stringify(result),
    } as BaseEvent,
  ];
  const { db, brain, runs, notes } = await brainFixture([
    text("Let me look at your food log. "),
    ...tool("t1", "get_food_log", "{}", { meals: [] }),
    text("You had a honey butter sandwich. "),
    ...tool("t2", "email_from_agent", '{"to":"dan@example.com"}', {
      status: "awaiting_review",
      actionId: "action-1",
    }),
    text("I wrote Dan an email; it's waiting for your OK in the app."),
  ]);
  // The email it drafted, waiting 30 minutes as usual.
  await db.put("owner", "actions", {
    id: "action-1",
    title: "Send “Running late”",
    status: "awaiting_review",
    expiresAt: new Date(NOW + 30 * 60 * 1000).toISOString(),
  });
  const progress: string[] = [];
  const answer = await voiceAnswer(brain)({
    owner: "owner",
    sessionId: "s1",
    delegationId: "d1",
    turns: [
      { role: "assistant", text: "Hi, what's up?" },
      { role: "user", text: "What did I have for lunch? And tell Dan I'm late." },
    ],
    progress: (note) => progress.push(note),
    signal: new AbortController().signal,
  });
  assert.equal(answer, "I wrote Dan an email; it's waiting for your OK in the app.");
  assert.deepEqual(progress, ["Checking your food log", "Writing the email"]);
  assert.deepEqual(notes, [
    {
      title: "Ready for your review",
      body: "Send “Running late”, from your call. It waits for your OK in Activity.",
      key: "review:action-1",
    },
  ]);
  // Drafted on a call (maybe driving), it waits until midnight in Chicago, not 30 minutes.
  const held = await db.get<{ expiresAt: string }>("owner", "actions", "action-1");
  assert.equal(held?.expiresAt, "2026-10-02T05:00:00.000Z");
  const input = runs[0];
  assert.ok(input);
  // The typed chat (text only), then the call, ending with the question, keyed per hand-over.
  assert.deepEqual(
    input.messages.map((m) => m.role),
    ["user", "assistant", "assistant", "user"],
  );
  assert.equal(input.messages.at(-1)?.id, "voice-s1-d1");
  assert.equal(input.context[0]?.value, VOICE_RULES);
  assert.equal(input.threadId, "voice-s1");
});

test("a finished call is added to the chat as one message, once", async () => {
  const db = await createStore();
  const session: VoiceSession = {
    id: "live_7",
    startedAt: "2026-10-01T19:40:00Z",
    endedAt: "2026-10-01T19:42:10Z",
    seconds: 130,
    turns: [
      { role: "user", text: "What did I have for lunch?" },
      { role: "assistant", text: "A honey butter sandwich." },
    ],
  };
  await db.put("owner", "voice-sessions", session);
  const service = { db, timeZone: async () => "America/Chicago" };
  const agent = new ConversationAgent(
    { agentBackend: "model" } as Config,
    service as never,
    "owner",
  );
  const add = () =>
    lastValueFrom(
      agent
        .run({
          threadId: "main",
          runId: randomUUID(),
          messages: [],
          tools: [],
          context: [],
          state: {},
          forwardedProps: { spokenCall: "live_7" },
        })
        .pipe(toArray()),
    );
  // Still finishing something asked at the end: it waits.
  await db.put("owner", "voice-sessions", { ...session, pending: true });
  assert.ok(!(await add()).some((e) => e.type === EventType.TEXT_MESSAGE_START));
  await db.put("owner", "voice-sessions", session);
  const events = (await add()) as (BaseEvent & { messageId?: string; delta?: string })[];
  const start = events.find((e) => e.type === EventType.TEXT_MESSAGE_START);
  assert.equal(start?.messageId, "spoken-live_7");
  const content = events.find((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)?.delta ?? "";
  assert.match(content, /^Spoken conversation · 2 min · Thu, Oct 1, 2:40 PM\n\n/);
  assert.match(content, /You: What did I have for lunch\?\nNeddy: A honey butter sandwich\./);
  assert.equal(events.at(-1)?.type, EventType.RUN_FINISHED);
  assert.equal((await db.get<VoiceSession>("owner", "voice-sessions", "live_7"))?.inChat, "main");
  // Asked again (another tab, a retry): nothing more is added.
  const again = await add();
  assert.ok(!again.some((e) => e.type === EventType.TEXT_MESSAGE_START));
  await db.close();
});
