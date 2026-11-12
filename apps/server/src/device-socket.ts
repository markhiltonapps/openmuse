import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { type DeviceCard, deviceWire } from "../../../packages/domain/src/device-card.ts";
import type { Device, Devices } from "./devices.ts";
import { AppError } from "./errors.ts";
import type { SocketLike } from "./voice-live.ts";

/** What the bridge needs of the voice (our own voice service's LiveVoice). */
export interface DeviceVoice {
  available(owner: string): Promise<boolean>;
  start(
    owner: string,
    offer: undefined,
    rehearsal: undefined,
    options: { device: true },
  ): Promise<{ sessionId: string }>;
  audioSocket(owner: string, id: string): SocketLike;
  /** Cards (the weather) the conversation wants on the device's screen; returns how to stop. */
  watchCards?(owner: string, id: string, send: (card: DeviceCard) => void): () => void;
  end(owner: string, id: string, reason?: string): Promise<void>;
}

/** Where a device connects: one websocket, kept open, with its own token in a header. */
export const DEVICE_AUDIO_PATH = "/api/device/audio";
/** Control messages a device may send; anything else is ignored. */
const FROM_DEVICE = new Set([
  "ptt.start",
  "ptt.end",
  "session.close",
  "ping",
  "device.info",
  "device.setting",
  "device.status",
]);
const ANIMATION_LEVELS = ["saver", "normal", "smooth"] as const;
const FACES = ["info", "analog", "neon"] as const;
/** The most audio held while a conversation is being set up (10 s of 16 kHz 16-bit mono). */
const MAX_WAITING_BYTES = 320_000;
/** One chunk of audio is at most this much (a few hundred milliseconds). */
const MAX_CHUNK_BYTES = 16_384;
const PING_MS = 20_000;
/** Checks without any sign of life before a device is let go. */
const MISSED_LIMIT = 3;
const SLOW_START_MS = 1500;
/** How often a device gets fresh idle-screen facts (the time zone offset, weather, next meeting). */
const IDLE_EVERY_MS = 5 * 60_000;

interface Waiting {
  text?: string;
  audio?: Uint8Array;
}
interface Call {
  id: string;
  socket: SocketLike;
  open: boolean;
  ended: boolean;
  /** Stops sending this conversation's cards to the device. */
  unwatch?: () => void;
}
interface Connection {
  owner: string;
  device: Device;
  ws: WebSocket;
  call?: Call;
  starting?: Promise<void>;
  waiting: Waiting[];
  waitingBytes: number;
  alive: boolean;
  /** Checks in a row that found no sign of life. */
  missed: number;
  /** When the idle screen's facts (time, weather, next meeting) were last sent. */
  idleAt: number;
}

function frameBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}

/**
 * Carries a device's voice: its websocket on one side, a conversation on the voice service on
 * the other, with nothing in between but a copy. The conversation starts when the button is first
 * held (the device stays connected all day for almost nothing), the words go on being the
 * person's own agent's through the same hand-overs, minutes and limits as any call, and a call
 * that ends on its own (quiet, the month's minutes, another call) just starts again at the next
 * press.
 */
export class DeviceBridge {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CHUNK_BYTES });
  private readonly connections = new Map<string, Connection>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly devices: Devices,
    private readonly voice: () => DeviceVoice | undefined,
    private readonly log: (line: string) => void = (line) => console.log(`[OpenMuse] ${line}`),
    private readonly now: () => number = Date.now,
    /** What the device's idle screen shows; best effort, the bridge works without it. */
    private readonly idle?: (
      owner: string,
      device: Device,
    ) => Promise<Record<string, unknown> | undefined>,
  ) {
    devices.onSettingsChanged((deviceId) => {
      const connection = this.connections.get(deviceId);
      if (connection) void this.pushIdle(connection);
    });
    devices.onRemoved((deviceId) => {
      const connection = this.connections.get(deviceId);
      if (connection) this.drop(connection, 4403, "removed");
    });
    // A device that vanished without saying goodbye (battery, Wi-Fi) is noticed and let go.
    this.timer = setInterval(() => {
      for (const connection of this.connections.values()) {
        // One missed check isn't enough (a busy device or a slow moment on Wi-Fi answers late, and each
        // reconnect costs the person several seconds); three in a row, about a minute, is.
        if (connection.alive) connection.missed = 0;
        else if (++connection.missed >= MISSED_LIMIT) {
          this.drop(connection, 4408, "no answer");
          continue;
        }
        if (this.now() - connection.idleAt >= IDLE_EVERY_MS) void this.pushIdle(connection);
        connection.alive = false;
        try {
          connection.ws.ping();
        } catch {
          this.drop(connection, 4408, "no answer");
        }
      }
    }, PING_MS);
    this.timer.unref?.();
  }

  /** Wires the upgrade for the device path onto the api's http server. */
  attach(server: Server) {
    server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = (request.url ?? "").split("?")[0];
      if (path !== DEVICE_AUDIO_PATH) return;
      void this.upgrade(request, socket, head);
    });
  }

  private refuse(socket: Duplex, status: number, message: string) {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    socket.on("error", () => undefined);
    const header = request.headers.authorization ?? "";
    const token = /^Bearer (\S+)$/.exec(header)?.[1];
    const found = await this.devices.authenticate(token).catch(() => null);
    if (!found) return this.refuse(socket, 401, "Unauthorized");
    this.wss.handleUpgrade(request, socket, head, (ws) => this.connected(ws, found));
  }

  private connected(ws: WebSocket, found: { owner: string; device: Device }) {
    const { owner, device } = found;
    // One connection per device: a new one replaces the old (the device came back).
    const previous = this.connections.get(device.id);
    if (previous) this.drop(previous, 4000, "replaced");
    const connection: Connection = {
      owner,
      device,
      ws,
      waiting: [],
      waitingBytes: 0,
      alive: true,
      missed: 0,
      idleAt: 0,
    };
    this.connections.set(device.id, connection);
    this.sendText(connection, {
      type: "hello",
      name: device.name,
      time: new Date(this.now()).toISOString(),
    });
    void this.devices.touch(owner, device).catch(() => undefined);
    void this.pushIdle(connection);
    ws.on("pong", () => {
      connection.alive = true;
    });
    // The device's own keep-alive pings count too.
    ws.on("ping", () => {
      connection.alive = true;
    });
    ws.on("message", (data, isBinary) => {
      connection.alive = true;
      if (isBinary) this.fromAudio(connection, frameBytes(data));
      else this.fromText(connection, frameBytes(data));
    });
    this.log(`Device ${device.name} connected`);
    ws.on("close", (code, reason) => {
      // Says who ended it: the device itself (1000-1006, 1009...) or this server (4000 replaced, 4403 removed, 4408 no answer).
      const why = reason?.length ? ` ${reason.toString("utf8").slice(0, 40)}` : "";
      this.log(`Device ${device.name} disconnected (code ${code}${why})`);
      this.gone(connection);
    });
    ws.on("error", () => this.gone(connection));
  }

  /** Sends the idle screen's facts (and settings), fresh. Never throws: a device without them just shows less. */
  private async pushIdle(connection: Connection) {
    if (!this.idle) return;
    connection.idleAt = this.now();
    try {
      const fresh =
        (await this.devices.get(connection.owner, connection.device.id)) ?? connection.device;
      const info = await this.idle(connection.owner, fresh);
      if (info && this.connections.get(connection.device.id) === connection)
        this.sendText(connection, info);
    } catch {
      // Best effort.
    }
  }

  private sendText(connection: Connection, event: Record<string, unknown>) {
    if (connection.ws.readyState === 1) connection.ws.send(JSON.stringify(event));
  }

  private fromText(connection: Connection, bytes: Uint8Array) {
    let event: {
      type?: unknown;
      firmware?: unknown;
      key?: unknown;
      value?: unknown;
      battery?: unknown;
      mv?: unknown;
      charging?: unknown;
      usb?: unknown;
      rssi?: unknown;
      up?: unknown;
      connects?: unknown;
      saver?: unknown;
    };
    try {
      event = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      return;
    }
    const type = typeof event.type === "string" ? event.type : "";
    if (!FROM_DEVICE.has(type)) return;
    if (type === "ping") return this.sendText(connection, { type: "pong" });
    if (type === "device.info") {
      if (typeof event.firmware === "string")
        void this.devices
          .touch(connection.owner, connection.device, event.firmware)
          .catch(() => undefined);
      return;
    }
    if (type === "device.status") {
      // The watch's own report (every few minutes): kept in memory and written to the log, so its battery can be followed from here.
      const num = (value: unknown, low: number, high: number) =>
        typeof value === "number" && Number.isFinite(value) && value >= low && value <= high
          ? Math.round(value)
          : null;
      const status = {
        battery: num(event.battery, 0, 100),
        millivolts: num(event.mv, 0, 6000),
        charging: event.charging === 1,
        usb: event.usb === 1,
        wifiDbm: num(event.rssi, -120, 0),
        upSeconds: num(event.up, 0, 10_000_000) ?? 0,
        connects: num(event.connects, 0, 100_000) ?? 0,
        saver: event.saver === 1,
      };
      this.devices.setStatus(connection.device.id, status);
      this.log(
        `Device ${connection.device.name} status: battery ${status.battery ?? "none"}%${status.millivolts ? ` ${status.millivolts} mV` : ""} ${status.charging ? "charging" : status.usb ? "plugged in" : "on battery"}, Wi-Fi ${status.wifiDbm ?? "?"} dBm, up ${Math.round(status.upSeconds / 60)} min, connects ${status.connects}, saver ${status.saver ? "on" : "off"}`,
      );
      return;
    }
    if (type === "device.setting") {
      // The person changed something on the watch itself (its menu): keep it, so voice and the watch agree.
      if (event.key === "animation" && typeof event.value === "number") {
        const level = ANIMATION_LEVELS[Math.max(0, Math.min(2, Math.round(event.value)))];
        if (level)
          void this.devices
            .setSettings(connection.owner, connection.device.id, { animation: level })
            .catch(() => undefined);
      }
      if (event.key === "volume" && typeof event.value === "number") {
        void this.devices
          .setSettings(connection.owner, connection.device.id, {
            volume: Math.max(0, Math.min(100, Math.round(event.value))),
          })
          .catch(() => undefined);
      }
      if (event.key === "face" && typeof event.value === "number") {
        const face = FACES[Math.max(0, Math.min(2, Math.round(event.value)))];
        if (face)
          void this.devices
            .setSettings(connection.owner, connection.device.id, { face })
            .catch(() => undefined);
      }
      return;
    }
    if (type === "ptt.start" && !connection.call && !connection.starting)
      connection.starting = this.startCall(connection).finally(() => {
        connection.starting = undefined;
      });
    // The press that ended while no conversation exists has nothing to end.
    if (!connection.call && !connection.starting) return;
    this.toVoice(connection, { text: JSON.stringify({ type }) });
  }

  private fromAudio(connection: Connection, bytes: Uint8Array) {
    // Audio belongs to a press; with no conversation and none starting, it's stray.
    if (!connection.call && !connection.starting) return;
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_CHUNK_BYTES) return;
    this.toVoice(connection, { audio: bytes });
  }

  /** Straight through when the voice socket is open; held (briefly) until it is. */
  private toVoice(connection: Connection, item: Waiting) {
    const call = connection.call;
    if (call?.open && !call.ended) {
      try {
        call.socket.send(item.text ?? (item.audio as Uint8Array));
      } catch {
        // The voice socket just closed; the close handler tells the device.
      }
      return;
    }
    connection.waiting.push(item);
    connection.waitingBytes += item.audio?.byteLength ?? 0;
    while (connection.waitingBytes > MAX_WAITING_BYTES) {
      const dropped = connection.waiting.findIndex((entry) => entry.audio);
      if (dropped < 0) break;
      connection.waitingBytes -= connection.waiting[dropped]?.audio?.byteLength ?? 0;
      connection.waiting.splice(dropped, 1);
    }
  }

  private async startCall(connection: Connection) {
    const voice = this.voice();
    const began = this.now();
    try {
      if (!voice || !(await voice.available(connection.owner)))
        throw new AppError(
          "Talking isn’t switched on yet. Ask whoever looks after your Neddy to turn it on.",
          503,
        );
      const { sessionId } = await voice.start(connection.owner, undefined, undefined, {
        device: true,
      });
      // The device went away while the voice was being set up.
      if (connection.ws.readyState !== 1) {
        void voice.end(connection.owner, sessionId, "ended").catch(() => undefined);
        return;
      }
      const socket = voice.audioSocket(connection.owner, sessionId);
      const call: Call = { id: sessionId, socket, open: false, ended: false };
      connection.call = call;
      // The weather (and any other card) the agent looks up while they talk: drawn on the device's screen.
      call.unwatch = voice.watchCards?.(connection.owner, sessionId, (card) =>
        this.sendText(connection, { type: "card", ...deviceWire(card) }),
      );
      const opened = () => {
        if (call.open) return;
        call.open = true;
        const took = this.now() - began;
        this.log(
          `Device call for ${connection.device.name} ready in ${took} ms${took > SLOW_START_MS ? " (slow)" : ""}`,
        );
        const waiting = connection.waiting;
        connection.waiting = [];
        connection.waitingBytes = 0;
        for (const item of waiting) this.toVoice(connection, item);
      };
      socket.addEventListener("open", opened);
      if (socket.readyState === 1) opened();
      socket.addEventListener("message", (event) => {
        const data = event.data;
        if (typeof data === "string") {
          try {
            if ((JSON.parse(data) as { type?: string }).type === "session.closed")
              call.ended = true;
          } catch {
            // Not an event; the device ignores it as well.
          }
          if (connection.ws.readyState === 1) connection.ws.send(data);
        } else if (connection.ws.readyState === 1) {
          const audio = data instanceof ArrayBuffer ? new Uint8Array(data) : (data as Uint8Array);
          connection.ws.send(audio, { binary: true });
        }
      });
      const lost = () => {
        call.unwatch?.();
        if (connection.call !== call) return;
        connection.call = undefined;
        if (!call.ended) {
          call.ended = true;
          this.sendText(connection, { type: "session.closed", reason: "connection_lost" });
        }
      };
      socket.addEventListener("close", lost);
      socket.addEventListener("error", lost);
    } catch (error) {
      connection.waiting = [];
      connection.waitingBytes = 0;
      const message =
        error instanceof AppError
          ? error.message
          : "Couldn’t start talking just now. Try again in a moment.";
      this.log(`Device call for ${connection.device.name} didn’t start: ${message}`);
      this.sendText(connection, {
        type: "error",
        code: error instanceof AppError ? error.status : 500,
        message,
      });
    }
  }

  /** The device's connection ended: its conversation does too. */
  private gone(connection: Connection) {
    if (this.connections.get(connection.device.id) === connection)
      this.connections.delete(connection.device.id);
    const call = connection.call;
    connection.call = undefined;
    call?.unwatch?.();
    if (call && !call.ended) {
      call.ended = true;
      try {
        call.socket.send(JSON.stringify({ type: "session.close" }));
      } catch {
        // Already closed.
      }
      try {
        call.socket.close();
      } catch {
        // Already closed.
      }
      void this.voice()
        ?.end(connection.owner, call.id, "ended")
        .catch(() => undefined);
    }
  }

  private drop(connection: Connection, code: number, reason: string) {
    this.log(`Device ${connection.device.name} ended by this server (${code} ${reason})`);
    try {
      connection.ws.close(code, reason);
    } catch {
      // Closing anyway.
    }
    this.gone(connection);
    // A stuck socket is cut rather than waited for.
    setTimeout(() => connection.ws.terminate(), 2000).unref?.();
  }

  /** Whether a device is connected now (for the app's list). */
  isConnected(deviceId: string) {
    return this.connections.has(deviceId);
  }

  stop() {
    clearInterval(this.timer);
    for (const connection of [...this.connections.values()])
      this.drop(connection, 1001, "shutdown");
    this.wss.close();
  }
}
