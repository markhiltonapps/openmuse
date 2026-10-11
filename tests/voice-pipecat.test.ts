import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import { UsageMeter } from "../apps/server/src/usage.ts";
import { LiveVoice, type SocketLike } from "../apps/server/src/voice-live.ts";
import {
  findPerson,
  limitReached,
  PIPECAT_MODEL,
  setVoiceProvider,
  turnServers,
  VoiceComparison,
  voiceAllowance,
  voiceProviderFor,
  voiceReference,
} from "../apps/server/src/voice-pipecat.ts";
import { isLiveLimit } from "../packages/domain/src/voice.ts";

/** A stand-in for a voice sideband: records what the server sends. */
class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = [];
  private listeners: Record<string, ((event: { data: unknown }) => void)[]> = {};
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    for (const listener of this.listeners.close ?? []) listener({ data: undefined });
  }
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }
}

const now = () => new Date("2026-10-11T12:00:00Z");

async function voiceWith(options: {
  extras?: (owner: string) => Promise<Record<string, unknown>>;
  provider?: { name: string; keyVariable: string };
  status?: number;
}) {
  const db = await createStore();
  const usage = new UsageMeter(db, undefined, now);
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const voice = new LiveVoice(
    db,
    async () => ({ instructions: "You are Neddy." }),
    async () => true,
    usage,
    {
      apiKey: "secret",
      ...(options.extras ? { extras: options.extras } : {}),
      ...(options.provider ? { provider: options.provider } : {}),
      fetcher: (async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) });
        if (options.status)
          return new Response(JSON.stringify({ error: { message: "no" } }), {
            status: options.status,
          });
        return Response.json({
          session: { id: "pc_w0_abc" },
          transport: { type: "webrtc", sdp: "v=0 answer" },
        });
      }) as typeof fetch,
      socket: () => new FakeSocket(),
    },
  );
  return { db, usage, voice, requests };
}

test("OpenAI's request is unchanged: only the session and the transport", async () => {
  const { voice, requests, db } = await voiceWith({});
  await voice.start("owner", "v=0 offer");
  assert.deepEqual(Object.keys(requests[0]?.body ?? {}).sort(), ["session", "transport"]);
  await voice.end("owner", "pc_w0_abc");
  await db.close();
});

test("our own voice sends the relay and the minutes left, and names itself in errors", async () => {
  const { voice, requests, db } = await voiceWith({
    extras: async () => ({
      openmuse: { iceServers: [{ urls: "turn:x" }], maxSeconds: 600, limitMinutes: 200 },
    }),
    provider: { name: "the voice service", keyVariable: "VOICE_INTERNAL_TOKEN" },
  });
  await voice.start("owner", "v=0 offer");
  assert.deepEqual(requests[0]?.body.openmuse, {
    iceServers: [{ urls: "turn:x" }],
    maxSeconds: 600,
    limitMinutes: 200,
  });
  await voice.end("owner", "pc_w0_abc");
  await db.close();
  const refused = await voiceWith({
    provider: { name: "the voice service", keyVariable: "VOICE_INTERNAL_TOKEN" },
    status: 401,
  });
  await assert.rejects(refused.voice.start("owner", "v=0 offer"), (error: Error) => {
    assert.match(error.message, /^The voice service turned down the api’s token \(401\)/);
    assert.match(error.message, /VOICE_INTERNAL_TOKEN is the same on the api and voice services/);
    assert.doesNotMatch(error.message, /OpenAI/);
    return true;
  });
  await refused.db.close();
});

test("a person past their month's minutes can't start a call on our own voice", async () => {
  const { voice, db } = await voiceWith({
    extras: async () => {
      throw limitReached(200, "America/Los_Angeles", new Date("2026-11-01T06:30:00Z"));
    },
  });
  await assert.rejects(voice.start("owner", "v=0 offer"), (error: Error & { status?: number }) => {
    assert.equal(error.status, 429);
    assert.ok(isLiveLimit(error.message));
    assert.match(error.message, /this month’s 200 minutes of live talk/);
    // Still October 31 in Los Angeles, though it's November in UTC.
    assert.match(error.message, /You’ll get more on November 1\./);
    return true;
  });
  await db.close();
  const utc = limitReached(1, "UTC", new Date("2026-11-01T06:30:00Z"));
  assert.match(utc.message, /this month’s 1 minute of live talk\. You’ll get more on December 1\./);
  assert.match(
    limitReached(5, "Nowhere/Strange", new Date("2026-12-15T12:00:00Z")).message,
    /January 1/,
  );
});

test("each person's voice: the default, the admin's choice, and OpenAI when ours isn't set up", async () => {
  const db = await createStore();
  const ready = {
    voiceProvider: "openai" as const,
    voiceServiceUrl: "http://voice",
    voiceServiceToken: "t",
  };
  assert.equal(await voiceProviderFor(db, ready, "ann"), "openai");
  await setVoiceProvider(db, "ann", "pipecat");
  assert.equal(await voiceProviderFor(db, ready, "ann"), "pipecat");
  // Without the voice service, everyone stays on OpenAI whatever was chosen.
  assert.equal(await voiceProviderFor(db, { voiceProvider: "pipecat" }, "ann"), "openai");
  // Everyone on ours by default; one person kept on OpenAI.
  const ours = { ...ready, voiceProvider: "pipecat" as const };
  assert.equal(await voiceProviderFor(db, ours, "bob"), "pipecat");
  await setVoiceProvider(db, "bob", "openai");
  assert.equal(await voiceProviderFor(db, ours, "bob"), "openai");
  await setVoiceProvider(db, "bob", "default");
  assert.equal(await voiceProviderFor(db, ours, "bob"), "pipecat");
  await db.close();
});

test("the relay's credentials come from Cloudflare, without port 53, and none when it isn't set up", async () => {
  let asked = 0;
  const fetcher = (async (url: string, init: RequestInit) => {
    asked++;
    assert.equal(
      url,
      "https://rtc.live.cloudflare.com/v1/turn/keys/key1/credentials/generate-ice-servers",
    );
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer token1");
    return Response.json(
      {
        iceServers: [
          { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
          {
            urls: [
              "turn:turn.cloudflare.com:3478?transport=udp",
              "turn:turn.cloudflare.com:53?transport=udp",
              "turns:turn.cloudflare.com:443?transport=tcp",
            ],
            username: "u",
            credential: "c",
          },
        ],
      },
      { status: 201 },
    );
  }) as typeof fetch;
  const servers = await turnServers({ turnKeyId: "key1", turnKeyToken: "token1" }, fetcher);
  assert.deepEqual(servers, [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "u",
      credential: "c",
    },
  ]);
  assert.deepEqual(await turnServers({}, fetcher), []);
  assert.equal(asked, 1);
  const refused = (async () =>
    new Response(JSON.stringify({ errors: [{ message: "bad key" }] }), {
      status: 401,
    })) as typeof fetch;
  assert.deepEqual(await turnServers({ turnKeyId: "k", turnKeyToken: "t" }, refused), []);
});

test("the monthly allowance counts only our own voice's minutes", async () => {
  const db = await createStore();
  const usage = new UsageMeter(db, undefined, now);
  await usage.recordSeconds("ann", PIPECAT_MODEL, 600);
  await usage.recordSeconds("ann", "gpt-live-1", 900);
  const allowance = await voiceAllowance(usage, { voiceMonthlyMinutes: 200 }, "ann");
  assert.equal(allowance.usedMinutes, 10);
  assert.equal(allowance.leftSeconds, 200 * 60 - 600);
  const unlimited = await voiceAllowance(usage, { voiceMonthlyMinutes: 0 }, "ann");
  assert.equal(unlimited.leftSeconds, undefined);
  await db.close();
});

test("our voice's tokens and characters are metered, and the report sets both voices side by side", async () => {
  const db = await createStore();
  const usage = new UsageMeter(db, undefined, now);
  const comparison = new VoiceComparison(db, usage);
  // Numbers can arrive before the call's person is known; they wait.
  comparison.metrics("pc_w0_1", { turn: { latencyMs: 640 } });
  await comparison.started("ann", "pc_w0_1", "pipecat");
  comparison.metrics("pc_w0_1", {
    llm: { model: "claude-haiku-4-5", input: 100, cacheRead: 4000, cacheWrite: 0, output: 60 },
  });
  comparison.metrics("pc_w0_1", { tts: { model: "inworld-tts-2-flash", characters: 1200 } });
  comparison.metrics("pc_w0_1", { turn: { latencyMs: 820 } });
  await comparison.clientTurns("ann", "pc_w0_1", [700, 900, 99999]);
  await comparison.started("ann", "live_1", "openai");
  await comparison.clientTurns("ann", "live_1", [1100, 1300]);
  await usage.recordSeconds("ann", PIPECAT_MODEL, 120);
  // Both calls were saved as calls (what the api keeps for every call).
  for (const [id, seconds] of [
    ["pc_w0_1", 120],
    ["live_1", 60],
  ] as const)
    await db.put("ann", "voice-sessions", {
      id,
      startedAt: now().toISOString(),
      endedAt: now().toISOString(),
      seconds,
      turns: [],
    });
  // Let the queued writes settle.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const month = await usage.month("ann");
  const tts = month.lines.find((line) => line.model === "inworld-tts-2-flash");
  assert.equal(tts?.characters, 1200);
  assert.ok(Math.abs((tts?.cost ?? 0) - 0.018) < 1e-9);
  assert.ok(month.lines.some((line) => line.model.startsWith("claude-haiku-4-5")));
  const report = await comparison.report(["ann"], "2026-10-01T00:00:00.000Z");
  assert.equal(report.pipecat.calls, 1);
  assert.equal(report.openai.calls, 1);
  // The app's turn times; the far-off one is dropped.
  assert.deepEqual(report.recent.find((row) => row.id === "pc_w0_1")?.turnsMs, [700, 900]);
  assert.equal(report.pipecat.latencyMs.median, 800);
  assert.equal(report.pipecat.latencyMs.serverMedian, 730);
  assert.equal(report.openai.latencyMs.median, 1200);
  // OpenAI: $0.05 a minute. Ours: listening $0.002/min, Claude's tokens, Inworld's characters.
  assert.equal(report.openai.costPerMinute.total, 0.05);
  const ours = report.pipecat.costPerMinute as Record<string, number>;
  assert.equal(ours.listening, 0.002);
  assert.equal(ours.speaking, 0.009);
  assert.ok((ours.thinking ?? 0) > 0 && (ours.thinking ?? 0) < 0.001);
  assert.ok((ours.total ?? 1) < 0.05);
  await db.close();
});

test("the admin names a person for the voice: by full name, email, or a first name that's theirs alone", () => {
  const people = [
    { id: "a", name: "Ann Lee", email: "ann@example.com" },
    { id: "b", name: "Bob Lee", email: "bob@example.com" },
  ];
  assert.deepEqual(findPerson(people, "Ann Lee"), { person: people[0] });
  assert.deepEqual(findPerson(people, "BOB@example.com"), { person: people[1] });
  assert.deepEqual(findPerson(people, "ann"), { person: people[0] });
  const both = findPerson(people, "Lee");
  assert.ok("error" in both && /Ann Lee, Bob Lee/.test(both.error));
  const none = findPerson(people, "Cat");
  assert.ok("error" in none && /No one called “Cat”/.test(none.error));
});

test("our voice is told how the app works, enough to pass Claude Haiku's caching minimum", () => {
  const reference = voiceReference("Sam");
  assert.match(reference, /^How this app works/);
  assert.match(reference, /Talk live with Sam/);
  assert.doesNotMatch(reference, /\{agent\}|\*\*/);
  // Admin setup isn't for everyone's calls.
  assert.doesNotMatch(reference, /Try the new, cheaper voice for live talk/);
  // Haiku caches only prompts of 4,096 tokens or more; this is most of the way there by itself.
  assert.ok(reference.length > 12_000);
});
