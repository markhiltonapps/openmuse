import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import { UsageMeter } from "../apps/server/src/usage.ts";
import { LiveVoice, type SocketLike } from "../apps/server/src/voice-live.ts";
import { CallVoices } from "../apps/server/src/voice-pipecat.ts";

const OFFER = {
  voices: [
    { id: "Ashley", description: "Warm and natural" },
    { id: "Dennis", description: "Calm and friendly" },
    { id: "Theodore", description: "Deep and unhurried" },
  ],
  default: "Ashley",
};

function voiceService(options: { down?: boolean } = {}) {
  const asked: string[] = [];
  const fetcher = (async (url: string) => {
    asked.push(url.replace("http://voice", ""));
    if (options.down) throw new Error("connection refused");
    if (url.endsWith("/v1/voices")) return Response.json(OFFER);
    const voice = /\/v1\/voices\/([^/]+)\/sample$/.exec(url)?.[1];
    if (voice)
      return new Response(`mp3 of ${voice}`, { headers: { "content-type": "audio/mpeg" } });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { asked, fetcher };
}

test("people choose a voice by its name; anything else is turned down with the choices", async () => {
  const db = await createStore();
  const service = voiceService();
  const voices = new CallVoices(db, "http://voice", "token", service.fetcher);
  assert.equal(await voices.chosen("p1"), "Ashley", "the usual voice until they choose");
  assert.deepEqual(await voices.choose("p1", "dennis’s"), { voice: OFFER.voices[1] });
  assert.equal(await voices.chosen("p1"), "Dennis");
  assert.equal(await voices.chosen("p2"), "Ashley", "one person's choice is theirs alone");
  const wrong = await voices.choose("p1", "Gandalf");
  assert.ok("error" in wrong && wrong.error.includes("Ashley, Dennis, Theodore"));
  assert.equal(await voices.chosen("p1"), "Dennis", "a wrong name changes nothing");
  assert.deepEqual(
    await voices.choose("p1", null),
    { voice: OFFER.voices[0] },
    "back to the usual",
  );
  assert.equal(
    service.asked.filter((url) => url === "/v1/voices").length,
    1,
    "the list is asked for once and kept",
  );
  await db.close();
});

test("a chosen voice that's no longer offered falls back to the usual one", async () => {
  const db = await createStore();
  await db.put("p1", "agent-settings", { id: "call-voice", value: "Olivia" });
  const voices = new CallVoices(db, "http://voice", "token", voiceService().fetcher);
  assert.equal(await voices.chosen("p1"), "Ashley");
  await db.close();
});

test("samples are made once and kept; unknown voices have none", async () => {
  const db = await createStore();
  const service = voiceService();
  const voices = new CallVoices(db, "http://voice", "token", service.fetcher);
  const first = await voices.sample("theodore");
  const again = await voices.sample("Theodore");
  assert.equal(new TextDecoder().decode(first?.body), "mp3 of Theodore");
  assert.equal(first?.type, "audio/mpeg");
  assert.equal(again, first);
  assert.equal(service.asked.filter((url) => url.endsWith("/sample")).length, 1);
  assert.equal(await voices.sample("Gandalf"), undefined);
  await db.close();
});

test("with the voice service down, there's nothing to choose and saying so is clear", async () => {
  const db = await createStore();
  const voices = new CallVoices(db, "http://voice", "token", voiceService({ down: true }).fetcher);
  assert.deepEqual((await voices.offered()).voices, []);
  assert.deepEqual(await voices.choose("p1", "Dennis"), {
    error: "Voices can’t be chosen just now.",
  });
  await db.close();
});

test("a voice chosen during a call is sent to that call straight away", async () => {
  const db = await createStore();
  const sockets: { sent: Record<string, unknown>[] }[] = [];
  const voice = new LiveVoice(
    db,
    async () => ({ instructions: "You are Neddy." }),
    async () => true,
    new UsageMeter(db),
    {
      apiKey: "secret",
      fetcher: (async () =>
        Response.json({
          session: { id: "pc_w0_abc" },
          transport: { type: "webrtc", sdp: "v=0 answer" },
        })) as unknown as typeof fetch,
      socket: () => {
        const socket = {
          sent: [] as Record<string, unknown>[],
          send(data: string) {
            socket.sent.push(JSON.parse(data));
          },
          close() {},
          addEventListener() {},
        } satisfies SocketLike & { sent: Record<string, unknown>[] };
        sockets.push(socket);
        return socket;
      },
    },
  );
  assert.equal(voice.update("owner", { audio: { output: { voice: "Dennis" } } }), false);
  await voice.start("owner", "v=0 offer");
  assert.equal(voice.update("someone else", { audio: { output: { voice: "Dennis" } } }), false);
  assert.equal(voice.update("owner", { audio: { output: { voice: "Dennis" } } }), true);
  assert.deepEqual(sockets[0]?.sent.at(-1), {
    type: "session.update",
    session: { audio: { output: { voice: "Dennis" } } },
  });
  await voice.end("owner", "pc_w0_abc");
  await db.close();
});
