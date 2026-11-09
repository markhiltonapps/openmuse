import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createStore } from "../apps/server/src/db.ts";
import { DeviceBridge, type DeviceVoice } from "../apps/server/src/device-socket.ts";
import {
  Devices,
  deviceToolSpecs,
  MAX_DEVICES,
  pairClaimSchema,
} from "../apps/server/src/devices.ts";
import { AppError } from "../apps/server/src/errors.ts";
import type { SocketLike } from "../apps/server/src/voice-live.ts";
import type { DeviceCard } from "../packages/domain/src/device-card.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, what: string, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) assert.fail(`Timed out waiting for ${what}`);
    await wait(5);
  }
}

async function pair(devices: Devices, owner: string, name = "Desk") {
  const started = await devices.start("Waveshare ESP32-S3 AMOLED 2.06", "1.2.3.4");
  await devices.claim(owner, pairClaimSchema.parse({ code: started.code, name }));
  const polled = await devices.poll(started.pollToken);
  assert.equal(polled.status, "paired");
  return (polled as { token: string }).token;
}

test("a device pairs with a code typed in the app, and collects its token once", async () => {
  const db = await createStore();
  const devices = new Devices(db);
  const started = await devices.start("Waveshare ESP32-S3 AMOLED 2.06", "1.2.3.4");
  assert.match(started.code, /^\d{6}$/);
  assert.equal((await devices.poll(started.pollToken)).status, "waiting");

  // A wrong code is turned away and doesn't use up the right one.
  await assert.rejects(
    devices.claim("local-us", pairClaimSchema.parse({ code: "000000" })),
    (error: unknown) => error instanceof AppError && error.status === 404,
  );
  const device = await devices.claim(
    "local-us",
    pairClaimSchema.parse({
      code: `${started.code.slice(0, 3)} ${started.code.slice(3)}`,
      name: "Desk",
    }),
  );
  assert.equal(device.name, "Desk");
  // The same code can't be claimed twice, by anyone.
  await assert.rejects(
    devices.claim("someone-else", pairClaimSchema.parse({ code: started.code })),
    (error: unknown) => error instanceof AppError && error.status === 404,
  );

  const first = await devices.poll(started.pollToken);
  assert.equal(first.status, "paired");
  const token = (first as { token: string }).token;
  assert.match(token, /^dev_[\w-]{40,}$/);
  // The token is handed out once; asking again gets nothing.
  assert.equal((await devices.poll(started.pollToken)).status, "expired");

  const found = await devices.authenticate(token);
  assert.equal(found?.owner, "local-us");
  assert.equal(found?.device.id, device.id);
  assert.equal(await devices.authenticate(`${token}x`), null);
  assert.equal(await devices.authenticate(undefined), null);
  assert.equal(await devices.authenticate("dev_short"), null);

  // Only a hash is kept: no stored record contains the token.
  for (const kind of ["device-tokens", "device-pairs", "devices"])
    assert.ok(!JSON.stringify(await db.scan(kind)).includes(token), `${kind} holds the token`);

  // Turning it off ends its token at once.
  await devices.remove("local-us", device.id);
  assert.equal(await devices.authenticate(token), null);
  assert.deepEqual(await devices.list("local-us"), []);
  await db.close();
});

test("codes run out, can't be guessed, and a person has a few devices at most", async () => {
  const db = await createStore();
  let clock = Date.parse("2026-11-08T12:00:00Z");
  const devices = new Devices(db, () => clock);

  // A code that waits more than ten minutes is no good, and the device is told so.
  const old = await devices.start("x", "a");
  clock += 11 * 60_000;
  await assert.rejects(devices.claim("o", pairClaimSchema.parse({ code: old.code })));
  assert.equal((await devices.poll(old.pollToken)).status, "expired");

  // Guessing: eight wrong codes and the person is asked to wait.
  await devices.start("x", "b");
  for (let i = 0; i < 8; i++)
    await assert.rejects(devices.claim("guesser", pairClaimSchema.parse({ code: "123456" })));
  await assert.rejects(
    devices.claim("guesser", pairClaimSchema.parse({ code: "123456" })),
    (error: unknown) => error instanceof AppError && error.status === 429,
  );
  // …which doesn't lock anyone else out.
  const fresh = await devices.start("x", "c");
  await devices.claim("someone", pairClaimSchema.parse({ code: fresh.code }));

  // Asking for codes is limited per address.
  for (let i = 0; i < 12; i++) await devices.start("x", "busy");
  await assert.rejects(
    devices.start("x", "busy"),
    (error: unknown) => error instanceof AppError && error.status === 429,
  );

  // Five devices at most.
  const many = new Devices(db, () => clock);
  for (let i = 0; i < MAX_DEVICES; i++) {
    const started = await many.start("x", `addr${i}`);
    await many.claim("collector", pairClaimSchema.parse({ code: started.code }));
  }
  const extra = await many.start("x", "addr-extra");
  await assert.rejects(
    many.claim("collector", pairClaimSchema.parse({ code: extra.code })),
    (error: unknown) => error instanceof AppError && error.status === 409,
  );
  assert.throws(() => pairClaimSchema.parse({ code: "12ab56" }));
  assert.throws(() => pairClaimSchema.parse({ code: "12345" }));
  await db.close();
});

/** The voice service's audio socket, as the bridge sees it. */
class FakeVoiceSocket implements SocketLike {
  sent: (string | Uint8Array)[] = [];
  closed = false;
  binaryType?: string;
  readyState = 0;
  private listeners: Record<string, ((event: { data: unknown }) => void)[]> = {};
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }
  send(data: string | Uint8Array) {
    if (this.readyState !== 1) throw new Error("not open");
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.emit("close", undefined);
  }
  open() {
    this.readyState = 1;
    this.emit("open", undefined);
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners[type] ?? []) listener({ data });
  }
}

class FakeVoice implements DeviceVoice {
  starts = 0;
  sockets: FakeVoiceSocket[] = [];
  ended: string[] = [];
  failWith?: Error;
  startDelay = 0;
  async available() {
    return true;
  }
  async start(_owner: string, _offer: undefined, _rehearsal: undefined, options: { device: true }) {
    assert.equal(options.device, true);
    this.starts++;
    if (this.startDelay) await wait(this.startDelay);
    if (this.failWith) throw this.failWith;
    return { sessionId: `pc_w0_${this.starts}` };
  }
  audioSocket() {
    const socket = new FakeVoiceSocket();
    this.sockets.push(socket);
    return socket;
  }
  /** Who wants cards, by conversation; `stopped` counts the ones who stopped. */
  watchers = new Map<string, (card: DeviceCard) => void>();
  stopped = 0;
  watchCards(_owner: string, id: string, send: (card: DeviceCard) => void) {
    this.watchers.set(id, send);
    return () => {
      this.stopped++;
      this.watchers.delete(id);
    };
  }
  async end(_owner: string, id: string) {
    this.ended.push(id);
  }
}

async function bridge() {
  const db = await createStore();
  const devices = new Devices(db);
  const voice = new FakeVoice();
  const logs: string[] = [];
  const server = createServer();
  const deviceBridge = new DeviceBridge(
    devices,
    () => voice,
    (line) => logs.push(line),
  );
  deviceBridge.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/device/audio`;
  const token = await pair(devices, "local-us");
  const connect = async (bearer = token) => {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${bearer}` } });
    const text: Record<string, unknown>[] = [];
    const audio: Buffer[] = [];
    let closeCode: number | undefined;
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) audio.push(data);
      else text.push(JSON.parse(data.toString()));
    });
    ws.on("close", (code) => {
      closeCode = code;
    });
    await once(ws, "open");
    return { ws, text, audio, closeCode: () => closeCode };
  };
  const stop = async () => {
    deviceBridge.stop();
    server.close();
    await db.close();
  };
  return { devices, voice, logs, url, token, connect, stop, deviceBridge };
}

test("a device with no valid token can't connect", async () => {
  const { url, stop } = await bridge();
  for (const header of [undefined, "Bearer nope", `Bearer dev_${"a".repeat(44)}`]) {
    const ws = new WebSocket(url, header ? { headers: { Authorization: header } } : {});
    const [error] = (await once(ws, "error")) as [Error];
    assert.match(error.message, /401/);
  }
  await stop();
});

test("holding the button starts a conversation and carries audio both ways, in order", async () => {
  const { voice, connect, stop, logs } = await bridge();
  const device = await connect();
  await until(() => device.text.some((event) => event.type === "hello"), "hello");
  assert.equal(device.text[0]?.name, "Desk");

  // Audio with no button held is stray and goes nowhere; nothing starts.
  device.ws.send(Buffer.alloc(640), { binary: true });
  await wait(30);
  assert.equal(voice.starts, 0);

  // Press: the conversation starts, and audio sent while it's being set up is kept, in order.
  voice.startDelay = 40;
  device.ws.send(JSON.stringify({ type: "ptt.start" }));
  device.ws.send(Buffer.from([1, 0, 2, 0]), { binary: true });
  device.ws.send(Buffer.from([3, 0, 4, 0]), { binary: true });
  device.ws.send(JSON.stringify({ type: "ptt.end" }));
  await until(() => voice.sockets.length === 1, "the audio socket");
  voice.sockets[0]?.open();
  await until(() => (voice.sockets[0]?.sent.length ?? 0) === 4, "the held messages");
  const sent = voice.sockets[0]?.sent ?? [];
  assert.equal(sent[0], JSON.stringify({ type: "ptt.start" }));
  assert.deepEqual([...(sent[1] as Uint8Array)], [1, 0, 2, 0]);
  assert.deepEqual([...(sent[2] as Uint8Array)], [3, 0, 4, 0]);
  assert.equal(sent[3], JSON.stringify({ type: "ptt.end" }));
  assert.ok(logs.some((line) => /ready in \d+ ms/.test(line)));

  // The voice answers: events as text, audio as binary.
  voice.sockets[0]?.emit("message", JSON.stringify({ type: "state", value: "speaking" }));
  voice.sockets[0]?.emit("message", new Uint8Array([9, 0, 8, 0]).buffer);
  await until(
    () => device.audio.length === 1 && device.text.some((e) => e.type === "state"),
    "reply",
  );
  assert.deepEqual([...device.audio[0]!], [9, 0, 8, 0]);

  // A second press in the same conversation doesn't start another.
  device.ws.send(JSON.stringify({ type: "ptt.start" }));
  await until(() => (voice.sockets[0]?.sent.length ?? 0) === 5, "the second press");
  assert.equal(voice.starts, 1);

  // Things a device may not say are ignored, never passed on.
  device.ws.send(JSON.stringify({ type: "session.update", session: { voice: "x" } }));
  device.ws.send("not json");
  device.ws.send(JSON.stringify({ type: "ping" }));
  await until(() => device.text.some((event) => event.type === "pong"), "pong");
  assert.equal(voice.sockets[0]?.sent.length, 5);
  device.ws.close();
  await stop();
});

test("a call that ends by itself starts again at the next press; losing the voice says so", async () => {
  const { voice, connect, stop } = await bridge();
  const device = await connect();
  device.ws.send(JSON.stringify({ type: "ptt.start" }));
  await until(() => voice.sockets.length === 1, "first call");
  voice.sockets[0]?.open();

  // The voice ends the call (quiet, the month's minutes): the device hears it, the next press restarts.
  voice.sockets[0]?.emit("message", JSON.stringify({ type: "session.closed", reason: "idle" }));
  voice.sockets[0]?.emit("close", undefined);
  await until(() => device.text.some((event) => event.type === "session.closed"), "closed");
  assert.equal(device.text.filter((event) => event.type === "session.closed").length, 1);
  device.ws.send(JSON.stringify({ type: "ptt.start" }));
  await until(() => voice.sockets.length === 2, "second call");
  assert.equal(voice.starts, 2);

  // The audio socket dropping mid-call is told to the device as a lost connection.
  voice.sockets[1]?.open();
  voice.sockets[1]?.emit("close", undefined);
  await until(
    () =>
      device.text.some(
        (event) => event.type === "session.closed" && event.reason === "connection_lost",
      ),
    "lost",
  );
  device.ws.close();
  await stop();
});

test("a call that can't start tells the device why, and the plan's limit is passed on kindly", async () => {
  const { voice, connect, stop } = await bridge();
  const device = await connect();
  voice.failWith = new AppError("You’ve used this month’s call minutes.", 429);
  device.ws.send(JSON.stringify({ type: "ptt.start" }));
  device.ws.send(Buffer.alloc(640), { binary: true });
  await until(() => device.text.some((event) => event.type === "error"), "error");
  const error = device.text.find((event) => event.type === "error");
  assert.equal(error?.code, 429);
  assert.match(String(error?.message), /used this month’s/);

  // The press after that tries again (and works once the voice is back).
  voice.failWith = undefined;
  device.ws.send(JSON.stringify({ type: "ptt.start" }));
  await until(() => voice.sockets.length === 1, "retry");
  device.ws.close();
  await stop();
});

test("hanging up the device, or removing it in the app, ends its conversation", async () => {
  const { voice, connect, stop, devices } = await bridge();
  const first = await connect();
  first.ws.send(JSON.stringify({ type: "ptt.start" }));
  await until(() => voice.sockets.length === 1, "call");
  voice.sockets[0]?.open();
  first.ws.close();
  await until(() => voice.ended.includes("pc_w0_1"), "the call ended with the device");
  assert.ok(voice.sockets[0]?.closed);
  assert.ok(
    voice.sockets[0]?.sent.includes(JSON.stringify({ type: "session.close" })),
    "the voice is told to close",
  );

  // Removing the device in the app closes its connection from our side.
  const second = await connect();
  await until(() => second.text.some((event) => event.type === "hello"), "hello");
  const [listed] = await devices.list("local-us");
  await devices.remove("local-us", listed?.id as string);
  await until(() => second.closeCode() !== undefined, "closed");
  assert.equal(second.closeCode(), 4403);
  await stop();
});

test("a device that comes back replaces its old connection, and a stale one can't hold the slot", async () => {
  const { connect, stop } = await bridge();
  const old = await connect();
  const fresh = await connect();
  await until(() => old.closeCode() !== undefined, "old closed");
  assert.equal(old.closeCode(), 4000);
  assert.equal(fresh.closeCode(), undefined);
  fresh.ws.close();
  await stop();
});

test("audio held while a call is set up is capped, dropping the oldest first", async () => {
  const { voice, connect, stop } = await bridge();
  const device = await connect();
  voice.startDelay = 80;
  device.ws.send(JSON.stringify({ type: "ptt.start" }));
  // 25 chunks of 16 KB is 400 KB: more than the 320 KB kept.
  for (let i = 0; i < 25; i++) device.ws.send(Buffer.alloc(16_000, i + 1), { binary: true });
  await until(() => voice.sockets.length === 1, "socket");
  voice.sockets[0]?.open();
  await until(() => (voice.sockets[0]?.sent.length ?? 0) > 1, "flush");
  const audio = (voice.sockets[0]?.sent ?? []).filter(
    (item) => typeof item !== "string",
  ) as Uint8Array[];
  const total = audio.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  assert.ok(total <= 320_000, `kept ${total} bytes`);
  // The newest is there, the oldest is gone.
  assert.equal(audio.at(-1)?.[0], 25);
  assert.notEqual(audio[0]?.[0], 1);
  device.ws.close();
  await stop();
});

test("the chat can pair, list, rename and remove devices by what's said, and asks before removing", async () => {
  const db = await createStore();
  const devices = new Devices(db);
  const [tool] = deviceToolSpecs(devices, "local-us", { talkReady: true });
  assert.ok(tool);
  const run = (input: Parameters<typeof tool.execute>[0]) =>
    tool.execute(input) as Promise<Record<string, unknown>>;

  assert.match(String((await run({ do: "list" })).message), /no devices yet/);
  assert.match(String((await run({ do: "pair", code: "12" })).error), /six digits/);
  assert.match(String((await run({ do: "pair", code: "482913" })).error), /isn’t right/);

  const started = await devices.start("Waveshare", "9.9.9.9");
  // Said out loud, digits arrive one at a time.
  const paired = await run({ do: "pair", code: started.code.split("").join(" "), name: "Desk" });
  assert.equal(paired.paired, true);
  // Saying it twice (a repeated call) gives the same device back, and isn't a wrong code.
  const again = await run({ do: "pair", code: started.code });
  assert.equal(again.paired, true);
  assert.equal((await devices.list("local-us")).length, 1);

  assert.equal(
    (await run({ do: "rename", name: "my desk device", new_name: "Kitchen" })).renamed,
    true,
  );
  assert.equal((await devices.list("local-us"))[0]?.name, "Kitchen");

  // Two devices left unnamed get different names, so either can be asked for.
  const second = await devices.start("Waveshare", "9.9.9.8");
  const third = await devices.start("Waveshare", "9.9.9.7");
  await run({ do: "pair", code: second.code });
  await run({ do: "pair", code: third.code });
  assert.deepEqual((await devices.list("local-us")).map((device) => device.name).sort(), [
    "Kitchen",
    "My device",
    "My device 2",
  ]);
  assert.match(String((await run({ do: "remove" })).error), /Which device/);
  // "The second one" and names by their words work.
  assert.equal(
    (await run({ do: "rename", name: "kitchen", new_name: "My device" })).error !== undefined,
    true,
  );

  // Removing asks first, and only a yes removes it.
  const ask = await run({ do: "remove", name: "kitchen" });
  assert.equal(ask.needsConfirm, true);
  assert.equal((await devices.list("local-us")).length, 3);
  assert.equal((await run({ do: "remove", name: "kitchen", confirm: true })).removed, true);
  assert.equal((await devices.list("local-us")).length, 2);
  await db.close();

  // Pairing on a server that can't talk says so, honestly.
  const quiet = await createStore();
  const silent = new Devices(quiet);
  const [silentTool] = deviceToolSpecs(silent, "local-us", { talkReady: false });
  const code = (await silent.start("x", "1.1.1.1")).code;
  assert.ok(silentTool);
  const quietAnswer = (await silentTool.execute({ do: "pair", code })) as Record<string, unknown>;
  assert.match(String(quietAnswer.message), /isn’t switched on yet/);
  await quiet.close();
});

test("a card the agent makes during a call is drawn on the device, and stops when the call ends", async () => {
  const { voice, connect, stop } = await bridge();
  const device = await connect();
  device.ws.send(JSON.stringify({ type: "ptt.start" }));
  await until(() => voice.sockets.length === 1, "the call");
  voice.sockets[0]?.open();
  await until(() => voice.watchers.has("pc_w0_1"), "the card watch");

  const card: DeviceCard = {
    kind: "weather",
    place: "Houston",
    temp: 72,
    sky: "Partly cloudy",
    icon: "partly",
    high: 80,
    low: 65,
  };
  voice.watchers.get("pc_w0_1")?.(card);
  await until(() => device.text.some((event) => event.type === "card"), "the card");
  assert.deepEqual(
    device.text.find((event) => event.type === "card"),
    { type: "card", ...card },
  );

  // When the conversation ends, nobody keeps sending to this device.
  voice.sockets[0]?.emit("message", JSON.stringify({ type: "session.closed", reason: "idle" }));
  voice.sockets[0]?.emit("close", undefined);
  await until(() => voice.stopped === 1, "the watch to stop");
  assert.equal(voice.watchers.size, 0);
  device.ws.close();
  await stop();
});
