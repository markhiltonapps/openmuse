import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import { UsageMeter } from "../apps/server/src/usage.ts";
import {
  type LiveAnswer,
  LiveVoice,
  liveInstructions,
  type SocketLike,
  type VoiceSession,
} from "../apps/server/src/voice-live.ts";

/** A stand-in for OpenAI's sideband: records what the server sends, plays events back. */
class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = [];
  private listeners: Record<string, ((event: { data: unknown }) => void)[]> = {};
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {}
  send(data: string) {
    const event = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(event);
    // OpenAI answers a close with session.closed.
    if (event.type === "session.close")
      setTimeout(() => this.emit({ type: "session.closed", reason: "close_requested" }), 5);
  }
  close() {
    for (const listener of this.listeners.close ?? []) listener({ data: undefined });
  }
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }
  emit(event: Record<string, unknown>) {
    for (const listener of this.listeners.message ?? []) listener({ data: JSON.stringify(event) });
  }
}

async function setup(
  options: {
    admin?: boolean;
    key?: string;
    status?: number;
    setupUrl?: string;
    answer?: LiveAnswer;
    answerSeconds?: number;
    tell?: (owner: string, title: string, body: string, key: string) => Promise<unknown>;
  } = {},
) {
  const db = await createStore();
  const usage = new UsageMeter(db, undefined, () => new Date("2026-10-01T12:00:00Z"));
  const requests: { url: string; init: RequestInit }[] = [];
  const sockets: FakeSocket[] = [];
  const voice = new LiveVoice(
    db,
    async () => ({
      instructions: liveInstructions({ name: "Neddy", tone: "warm", now: "Thursday" }),
    }),
    async () => options.admin ?? true,
    usage,
    {
      apiKey: options.key ?? "sk-test-secret",
      setupUrl: options.setupUrl,
      answer: options.answer,
      answerSeconds: options.answerSeconds,
      tell: options.tell,
      fetcher: (async (url: string, init: RequestInit) => {
        requests.push({ url, init });
        if (options.status)
          return new Response(JSON.stringify({ error: { message: "no access" } }), {
            status: options.status,
          });
        return Response.json({
          session: { id: "live_123" },
          transport: { type: "webrtc", sdp: "v=0 answer" },
        });
      }) as typeof fetch,
      socket: (url, headers) => {
        const socket = new FakeSocket(url, headers);
        sockets.push(socket);
        return socket;
      },
    },
  );
  return { db, usage, voice, requests, sockets };
}

test("live voice starts a gpt-live-1 session with the agent's instructions and keeps the key server-side", async () => {
  const { voice, requests, sockets, db } = await setup();
  const started = await voice.start("owner", "v=0 offer");
  assert.deepEqual(started, { sdp: "v=0 answer", sessionId: "live_123" });
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.url, "https://api.openai.com/v1/live/sessions");
  assert.equal(
    (request.init.headers as Record<string, string>).Authorization,
    "Bearer sk-test-secret",
  );
  const body = JSON.parse(String(request.init.body));
  assert.equal(body.session.model, "gpt-live-1");
  assert.deepEqual(body.session.delegation, { type: "client" });
  assert.equal(body.transport.sdp, "v=0 offer");
  assert.match(body.session.instructions, /You are Neddy/);
  // The browser can't send instructions or commentary, only mute and hang up.
  assert.ok(
    !body.session.client.data_channel.allowed_client_events.includes("session.commentary.append"),
  );
  // OpenAI wants each server event as a selector object, not a bare name.
  assert.ok(
    body.session.client.data_channel.allowed_server_events.every(
      (selector: unknown) =>
        typeof selector === "object" && typeof (selector as { type?: unknown }).type === "string",
    ),
  );
  assert.ok(
    body.session.client.data_channel.allowed_server_events.some(
      (selector: { type: string }) => selector.type === "session.output_transcript.delta",
    ),
  );
  // The sideband attaches to the same session with the key in a header.
  assert.equal(sockets[0]?.url, "wss://api.openai.com/v1/live/sessions/live_123/attach");
  assert.equal(sockets[0]?.headers.Authorization, "Bearer sk-test-secret");
  await voice.end("owner", "live_123");
  await db.close();
});

test("what was said is kept, minutes are counted, and look-ups get a polite not-yet", async () => {
  const { voice, sockets, db, usage } = await setup();
  await voice.start("owner", "offer");
  const socket = sockets[0] as FakeSocket;
  socket.emit({ type: "session.input_transcript.delta", delta: "What's on " });
  socket.emit({ type: "session.input_transcript.delta", delta: "my calendar?" });
  socket.emit({
    type: "session.delegation.created",
    delegation: { id: "del_1", target: "client" },
  });
  assert.equal(socket.sent[0]?.type, "session.commentary.append");
  assert.equal(socket.sent[0]?.delegation_id, "del_1");
  assert.match(String(socket.sent[0]?.content), /can't look things up/);
  socket.emit({ type: "session.output_transcript.delta", delta: "I can't check that yet." });
  socket.emit({ type: "session.usage.updated", usage: { seconds: 60 } });
  socket.emit({ type: "session.usage.updated", usage: { seconds: 90 } });
  socket.emit({ type: "session.closed", reason: "remote_hangup", usage: { seconds: 120 } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const [saved] = await db.list<VoiceSession>("owner", "voice-sessions");
  assert.deepEqual(saved?.turns, [
    { role: "user", text: "What's on my calendar?" },
    { role: "assistant", text: "I can't check that yet." },
  ]);
  assert.equal(saved?.seconds, 120);
  assert.equal(saved?.reason, "remote_hangup");
  const month = await usage.month("owner");
  assert.equal(month.voiceMinutes, 2);
  // One conversation, priced by the minute: 2 minutes at 5¢.
  const line = month.lines.find((l) => l.kind === "voice");
  assert.equal(line?.calls, 1);
  assert.ok(Math.abs((line?.cost ?? 0) - 0.1) < 1e-9);
  await db.close();
});

test("live voice is only for people it's turned on for, and says plainly when the key is refused", async () => {
  const notAllowed = await setup({ admin: false });
  await assert.rejects(notAllowed.voice.start("member", "offer"), /isn’t turned on for you/);
  assert.equal(await notAllowed.voice.available("member"), false);
  await notAllowed.db.close();
  const noKey = await setup({ key: "" });
  await assert.rejects(noKey.voice.start("owner", "offer"), /isn’t set up/);
  await noKey.db.close();
  const refused = await setup({ status: 401 });
  await assert.rejects(refused.voice.start("owner", "offer"), (error: Error) => {
    assert.match(error.message, /OPENAI_VOICE_API_KEY/);
    assert.doesNotMatch(error.message, /sk-test-secret/);
    return true;
  });
  await refused.db.close();
});

test("the owner is told the key is missing, others don't see live voice, and the log never shows the key", async () => {
  const url = "https://railway.com/project/p/service/s/variables?environmentId=e";
  const noKey = await setup({ key: "", setupUrl: url });
  // The owner gets a link straight to where the key goes.
  assert.deepEqual(await noKey.voice.status("owner"), {
    available: false,
    needsKey: true,
    setupUrl: url,
  });
  assert.equal(
    noKey.voice.describe(),
    "Live voice off: OPENAI_VOICE_API_KEY isn't set on this service (add it under Variables, then Deploy)",
  );
  await noKey.db.close();
  const member = await setup({ key: "", admin: false, setupUrl: url });
  assert.deepEqual(await member.voice.status("member"), { available: false, needsKey: false });
  await member.db.close();
  const on = await setup({ setupUrl: url });
  assert.deepEqual(await on.voice.status("owner"), { available: true, needsKey: false });
  assert.equal(on.voice.describe(), "Live voice on (gpt-live-1, voice marin)");
  await on.db.close();
  // Open to everyone, as the app runs it: only the owner hears that the key is missing.
  const open = async (key: string) => {
    const db = await createStore();
    const voice = new LiveVoice(
      db,
      async () => ({ instructions: "hi" }),
      async () => true,
      undefined,
      {
        apiKey: key,
        setupUrl: url,
        canSetUp: async (owner) => owner === "owner",
      },
    );
    return { db, voice };
  };
  const everyone = await open("key");
  assert.deepEqual(await everyone.voice.status("member"), { available: true, needsKey: false });
  await everyone.db.close();
  const missing = await open("");
  assert.deepEqual(await missing.voice.status("member"), { available: false, needsKey: false });
  assert.deepEqual(await missing.voice.status("owner"), {
    available: false,
    needsKey: true,
    setupUrl: url,
  });
  await missing.db.close();
});

test("a conversation whose minutes never arrive is counted by the clock", async () => {
  const db = await createStore();
  const usage = new UsageMeter(db);
  let now = Date.parse("2026-10-01T12:00:00Z");
  const sockets: FakeSocket[] = [];
  const voice = new LiveVoice(
    db,
    async () => ({ instructions: "hi" }),
    async () => true,
    usage,
    {
      apiKey: "key",
      now: () => now,
      fetcher: (async () =>
        Response.json({ session: { id: "live_9" }, transport: { sdp: "answer" } })) as typeof fetch,
      socket: (url, headers) => {
        const socket = new FakeSocket(url, headers);
        sockets.push(socket);
        return socket;
      },
    },
  );
  await voice.start("owner", "offer");
  now += 45_000;
  // The sideband drops without a word from OpenAI; it reconnects once, then drops again.
  sockets[0]?.close();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(sockets.length, 2);
  sockets[1]?.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const [saved] = await db.list<VoiceSession>("owner", "voice-sessions");
  assert.equal(saved?.seconds, 45);
  assert.equal((await usage.month("owner")).voiceMinutes, 0.8);
  await db.close();
});

test("a quiet call is hung up, and fractional seconds are counted exactly", async () => {
  const db = await createStore();
  const usage = new UsageMeter(db);
  let now = Date.parse("2026-10-01T12:00:00Z");
  const sockets: FakeSocket[] = [];
  const voice = new LiveVoice(
    db,
    async () => ({ instructions: "hi" }),
    async () => true,
    usage,
    {
      apiKey: "key",
      now: () => now,
      idleSeconds: 0.09,
      fetcher: (async () =>
        Response.json({ session: { id: "live_q" }, transport: { sdp: "answer" } })) as typeof fetch,
      socket: (url, headers) => {
        const socket = new FakeSocket(url, headers);
        sockets.push(socket);
        return socket;
      },
    },
  );
  await voice.start("owner", "offer");
  const socket = sockets[0] as FakeSocket;
  // OpenAI's running total, in fractions of a second, every 1.5 s.
  for (const total of [1.5, 3, 4.5, 6])
    socket.emit({ type: "session.usage.updated", usage: { seconds: total } });
  // Nobody says anything for longer than the quiet limit.
  now += 1000;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(socket.sent.at(-1)?.type, "session.close");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const [saved] = await db.list<VoiceSession>("owner", "voice-sessions");
  assert.equal(saved?.reason, "idle");
  assert.equal(saved?.seconds, 6);
  const line = (await usage.month("owner")).lines.find((l) => l.kind === "voice");
  assert.equal(line?.seconds, 6);
  await voice.stop();
  await db.close();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sentOf = (socket: FakeSocket, type: string) =>
  socket.sent.filter((event) => event.type === type) as {
    delegation_id?: string;
    content?: string;
  }[];

test("“let me check”: a hand-over is answered by the agent, with a progress note first", async () => {
  const asked: { turns: { role: string; text: string }[]; delegationId: string }[] = [];
  const { voice, sockets, db } = await setup({
    answer: async (question) => {
      asked.push(question);
      question.progress("Checking your food log");
      question.progress("Checking your food log");
      return "You had a honey butter sandwich at 12:30.";
    },
  });
  await voice.start("owner", "offer");
  const socket = sockets[0] as FakeSocket;
  socket.emit({ type: "session.output_transcript.delta", delta: "Hi, what's up?" });
  socket.emit({ type: "session.input_transcript.delta", delta: "What did I have " });
  socket.emit({ type: "session.delegation.created", delegation: { id: "del_1" } });
  // The rest of the question arrives just after the hand-over; it's waited for.
  socket.emit({ type: "session.input_transcript.delta", delta: "for lunch?" });
  await wait(800);
  assert.deepEqual(asked[0]?.turns.at(-1), { role: "user", text: "What did I have for lunch?" });
  assert.equal(asked[0]?.delegationId, "del_1");
  const notes = sentOf(socket, "session.thinking.append");
  assert.equal(notes.length, 1, "the same note isn't sent twice");
  assert.equal(notes[0]?.delegation_id, "del_1");
  assert.match(String(notes[0]?.content), /Checking your food log/);
  const [said] = sentOf(socket, "session.commentary.append");
  assert.equal(said?.delegation_id, "del_1");
  assert.match(String(said?.content), /honey butter sandwich at 12:30/);
  await voice.end("owner", "live_123");
  await db.close();
});

test("a hand-over that takes too long, or fails, gets a plain spoken apology instead", async () => {
  const slow = await setup({ answer: () => new Promise(() => {}), answerSeconds: 0.2 });
  await slow.voice.start("owner", "offer");
  const socket = slow.sockets[0] as FakeSocket;
  socket.emit({ type: "session.input_transcript.delta", delta: "Compare every vacuum" });
  await wait(450);
  socket.emit({ type: "session.delegation.created", delegation: { id: "del_slow" } });
  await wait(500);
  assert.match(String(sentOf(socket, "session.commentary.append")[0]?.content), /too long/);
  await slow.voice.end("owner", "live_123");
  await slow.db.close();
  const broken = await setup({
    answer: async () => {
      throw new Error("model down");
    },
  });
  await broken.voice.start("owner", "offer");
  const other = broken.sockets[0] as FakeSocket;
  other.emit({ type: "session.input_transcript.delta", delta: "What's on today?" });
  await wait(450);
  other.emit({ type: "session.delegation.created", delegation: { id: "del_x" } });
  await wait(100);
  assert.match(String(sentOf(other, "session.commentary.append")[0]?.content), /couldn't get that/);
  await broken.voice.end("owner", "live_123");
  await broken.db.close();
});

test("something asked just before hanging up is still done, and added to the saved call", async () => {
  const told: { title: string; body: string }[] = [];
  const { voice, sockets, db } = await setup({
    answer: () =>
      new Promise((resolve) => setTimeout(() => resolve("Done, I'll remind you at 7 PM."), 300)),
    tell: async (_owner, title, body) => {
      told.push({ title, body });
    },
  });
  await voice.start("owner", "offer");
  const socket = sockets[0] as FakeSocket;
  socket.emit({ type: "session.input_transcript.delta", delta: "Remind me to call Mom at seven" });
  await wait(450);
  socket.emit({ type: "session.delegation.created", delegation: { id: "del_m" } });
  await wait(50);
  await voice.end("owner", "live_123");
  // Saved straight away, but not added to the chat until the answer is in.
  assert.equal((await db.get<VoiceSession>("owner", "voice-sessions", "live_123"))?.pending, true);
  await wait(400);
  const saved = await db.get<VoiceSession>("owner", "voice-sessions", "live_123");
  assert.equal(saved?.pending, undefined);
  assert.deepEqual(saved?.turns.at(-1), {
    role: "assistant",
    text: "After the call: Done, I'll remind you at 7 PM.",
  });
  assert.deepEqual(told, [{ title: "After your call", body: "Done, I'll remind you at 7 PM." }]);
  // Nothing is said into a call that's over.
  assert.equal(sentOf(socket, "session.commentary.append").length, 0);
  await db.close();
});

test("what a hand-over puts on screen is there before the voice says so, and is kept with the call", async () => {
  const { voice, sockets, db } = await setup({
    answer: async (question) => {
      question.show?.(
        [{ tool: "show_on_screen", result: { title: "Robot vacuums", text: "- Roomba j7: $299" } }],
        "Robot vacuums",
      );
      return "I found three under $300; they're on your screen.";
    },
  });
  await voice.start("owner", "offer");
  const socket = sockets[0] as FakeSocket;
  socket.emit({
    type: "session.input_transcript.delta",
    delta: "Find me a robot vacuum under 300",
  });
  await wait(450);
  socket.emit({ type: "session.delegation.created", delegation: { id: "del_v" } });
  await wait(100);
  // When the voice is told the answer, the details can already be fetched.
  assert.equal(sentOf(socket, "session.commentary.append").length, 1);
  const during = await voice.details("owner", "live_123");
  assert.equal(during.length, 1);
  assert.equal(during[0]?.id, "del_v");
  assert.equal(during[0]?.title, "Robot vacuums");
  assert.equal(during[0]?.question, "Find me a robot vacuum under 300");
  // Nobody else can see them.
  assert.deepEqual(await voice.details("someone-else", "live_123"), []);
  await voice.end("owner", "live_123");
  // Saved with the call, and still there afterwards; the recent list leaves them out.
  assert.equal((await voice.details("owner", "live_123"))[0]?.title, "Robot vacuums");
  assert.ok(!("details" in ((await voice.recent("owner"))[0] ?? {})));
  await db.close();
});

test("details found after a hang-up are with the call in the chat, and the bell says so", async () => {
  const told: string[] = [];
  const { voice, sockets, db } = await setup({
    answer: (question) =>
      new Promise((resolve) =>
        setTimeout(() => {
          question.show?.(
            [{ tool: "show_on_screen", result: { title: "Vacuums", text: "- j7" } }],
            "Vacuums",
          );
          resolve("The Roomba j7 is the best pick.");
        }, 300),
      ),
    tell: async (_owner, _title, body) => {
      told.push(body);
    },
  });
  await voice.start("owner", "offer");
  const socket = sockets[0] as FakeSocket;
  socket.emit({ type: "session.input_transcript.delta", delta: "Find me a robot vacuum" });
  await wait(450);
  socket.emit({ type: "session.delegation.created", delegation: { id: "del_late" } });
  await wait(50);
  await voice.end("owner", "live_123");
  await wait(400);
  assert.deepEqual(told, [
    "The Roomba j7 is the best pick. The details are with the call in the chat.",
  ]);
  const saved = await db.get<VoiceSession>("owner", "voice-sessions", "live_123");
  assert.equal(saved?.details?.[0]?.title, "Vacuums");
  await db.close();
});

test("a server restart says what it couldn't finish, in the saved call", async () => {
  const { voice, sockets, db } = await setup({ answer: () => new Promise(() => {}) });
  await voice.start("owner", "offer");
  const socket = sockets[0] as FakeSocket;
  socket.emit({ type: "session.input_transcript.delta", delta: "Find me a flight" });
  await wait(450);
  socket.emit({ type: "session.delegation.created", delegation: { id: "del_f" } });
  await wait(50);
  await voice.stop();
  const saved = await db.get<VoiceSession>("owner", "voice-sessions", "live_123");
  assert.equal(saved?.reason, "server_restart");
  assert.equal(saved?.pending, undefined);
  assert.deepEqual(saved?.turns.at(-1), {
    role: "assistant",
    text: "The call ended before I could finish this. Ask me again here: “Find me a flight”",
  });
  await db.close();
});

test("a call isn't hung up for quiet while they sign in to an app from its Connect card", async () => {
  const db = await createStore();
  let now = Date.parse("2026-10-01T12:00:00Z");
  const sockets: FakeSocket[] = [];
  const voice = new LiveVoice(
    db,
    async () => ({ instructions: "hi" }),
    async () => true,
    undefined,
    {
      apiKey: "key",
      now: () => now,
      idleSeconds: 0.09,
      answer: async (question) => {
        question.show?.([{ tool: "connect", result: { app: "gmail", url: "https://c.io/x" } }]);
        return "The Connect button is on your screen.";
      },
      fetcher: (async () =>
        Response.json({ session: { id: "live_c" }, transport: { sdp: "answer" } })) as typeof fetch,
      socket: (url, headers) => {
        const socket = new FakeSocket(url, headers);
        sockets.push(socket);
        return socket;
      },
    },
  );
  await voice.start("owner", "offer");
  const socket = sockets[0] as FakeSocket;
  socket.emit({ type: "session.input_transcript.delta", delta: "Connect my Gmail" });
  await wait(450);
  socket.emit({ type: "session.delegation.created", delegation: { id: "del_c" } });
  await wait(100);
  // Two quiet minutes later (signing in), the call is still on.
  now += 2 * 60_000;
  await wait(100);
  assert.equal(sentOf(socket, "session.close").length, 0);
  // Past five minutes of quiet, it's hung up as usual.
  now += 4 * 60_000;
  await wait(100);
  assert.equal(sentOf(socket, "session.close").length, 1);
  await db.close();
});
