import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import { UsageMeter } from "../apps/server/src/usage.ts";
import {
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
  options: { admin?: boolean; key?: string; status?: number; setupUrl?: string } = {},
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
