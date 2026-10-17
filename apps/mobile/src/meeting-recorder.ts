import { Platform } from "react-native";
import type { MuseApi } from "./api";

/**
 * Records a meeting in the room in the browser: the microphone goes to a MediaRecorder that hands
 * over a piece every 30 seconds, and each piece is sent to the server straight away (again, with
 * waits, if the connection drops), so closing the tab loses only the last few seconds.
 *
 * A phone that locks or switches apps stops the microphone. That part ends there; when the app is
 * back, a new part starts by itself (the server writes each part up and puts them in order).
 */

export type RecorderPhase =
  | "idle"
  | "starting"
  | "recording"
  /** The microphone stopped (a locked phone); it starts again when the app is back. */
  | "paused"
  | "saving"
  | "error";
export interface RecorderState {
  phase: RecorderPhase;
  meetingId?: string;
  /** Seconds recorded so far (pauses aren't counted). */
  seconds: number;
  /** When it stops by itself (the month's hours, or four hours). */
  maxSeconds?: number;
  /** The microphone's loudness, 0 to 1, for the level bars. */
  level: number;
  /** Pieces not yet on the server. */
  waiting: number;
  /** In plain words, when something went wrong. */
  error?: string;
  /** Set when it stopped by itself at the limit. */
  stoppedAtLimit?: boolean;
  /**
   * The server closed this recording while the app was away (no sound for a long while) and is
   * writing up what it had; what's recorded now can't join it.
   */
  closed?: boolean;
  /** Stop couldn't reach the server: the recording is kept, and Finish again can try once more. */
  unfinished?: boolean;
  /**
   * Throw away didn't work: "written" when the server had already closed the recording and is
   * writing it up (it can be deleted from its page), "offline" when it couldn't be reached.
   */
  notThrownAway?: "written" | "offline";
  /**
   * Seconds just missed while the app was away (the phone locked or another app was in front),
   * for the recorder to say so when it carries on; cleared once read.
   */
  away?: number;
  /** All the seconds missed in this recording so far. */
  missedSeconds?: number;
}
export interface MeetingStarted {
  meeting: { id: string; title: string };
  maxSeconds: number;
}

const PIECE_MS = 30_000;
/** A pause shorter than this (a blip in the microphone) isn't worth a mention. */
const AWAY_SECONDS = 5;
/** iPhones and iPads: a web app's microphone never records while it's in the background. */
function backgroundStopsRecording() {
  const agent = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)
  );
}
/** Meetings that stopped by themselves at the month's hours, for their page to say so. */
export const stoppedAtLimit = new Set<string>();
const IDLE: RecorderState = { phase: "idle", seconds: 0, level: 0, waiting: 0 };

/** The format this browser records in that Soniox can read: Opus in WebM, else MP4 (Safari). */
export function recordingType(
  supported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
) {
  return (
    ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"].find(
      supported,
    ) ?? ""
  );
}
/** Whether this device can record a meeting in the app. */
export function canRecord() {
  return (
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined" &&
    !!recordingType()
  );
}
/** "12:05", or "1:02:05" past an hour. */
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
/** "12 minutes" / "1 hour 5 minutes", for screen readers and the bar's name. */
export function spokenLength(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (!minutes) return part(Math.floor(seconds), "second");
  return h ? `${part(h, "hour")}${m ? ` ${part(m, "minute")}` : ""}` : part(m, "minute");
}

interface Piece {
  part: number;
  n: number;
  blob: Blob;
  tries: number;
}

export class MeetingRecorder {
  private state: RecorderState = IDLE;
  private readonly listeners = new Set<() => void>();
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private audio?: AudioContext;
  private meter?: ReturnType<typeof setInterval>;
  private ticker?: ReturnType<typeof setInterval>;
  private wakeLock?: { release: () => Promise<void> };
  private type = "";
  private part = 0;
  private piece = 0;
  /** Each finished part's seconds, by part. */
  private partSeconds: number[] = [];
  private partStarted = 0;
  /** When the last part stopped by itself, and the seconds missed before each part. */
  private pausedAt = 0;
  private missed: number[] = [];
  /** When the microphone went quiet (muted) or the app was hidden, to measure a pause on return. */
  private mutedAt = 0;
  private hiddenAt = 0;
  private resuming = false;
  private queue: Piece[] = [];
  private sending = false;
  private stopping = false;
  private readonly onVisible = () => {
    if (document.visibilityState !== "visible") {
      if (this.state.phase === "recording") this.hiddenAt = Date.now();
      return;
    }
    const hidden = this.hiddenAt;
    this.hiddenAt = 0;
    void this.keepAwake();
    // An iPhone never records in the background, even when it gives no sign: time away there
    // is a pause. (Android and computers often carry on, so they go by the microphone's events.)
    if (
      this.state.phase === "recording" &&
      hidden &&
      backgroundStopsRecording() &&
      Date.now() - hidden >= AWAY_SECONDS * 1000
    )
      this.interrupted(hidden);
    if (this.state.phase === "paused") void this.resume();
  };
  private readonly onLeave = (event: BeforeUnloadEvent) => {
    if (this.state.phase === "recording" || this.state.waiting) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  constructor(private readonly api: MuseApi) {}

  get snapshot() {
    return this.state;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private set(change: Partial<RecorderState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  private seconds() {
    const done = this.partSeconds.reduce((sum, s) => sum + s, 0);
    return this.state.phase === "recording" && this.partStarted
      ? done + (Date.now() - this.partStarted) / 1000
      : done;
  }

  /** Asks for the microphone, starts the meeting on the server, and starts recording. */
  async start() {
    if (this.state.phase !== "idle" && this.state.phase !== "error") return;
    if (!canRecord()) {
      this.set({
        ...IDLE,
        phase: "error",
        error: "This browser can’t record. Try Chrome, Edge or Safari.",
      });
      return;
    }
    this.set({ ...IDLE, phase: "starting" });
    this.type = recordingType();
    this.part = 0;
    this.piece = 0;
    this.partSeconds = [];
    this.missed = [];
    this.pausedAt = 0;
    this.mutedAt = 0;
    this.hiddenAt = 0;
    this.resuming = false;
    this.queue = [];
    this.stopping = false;
    try {
      // The microphone first, so a "no" leaves nothing behind on the server.
      await this.openMicrophone();
      const started = await this.api.request<MeetingStarted>("/api/meetings", {
        mime: this.type,
      });
      this.set({ meetingId: started.meeting.id, maxSeconds: started.maxSeconds });
      this.beginPart();
      document.addEventListener("visibilitychange", this.onVisible);
      window.addEventListener("beforeunload", this.onLeave);
      void this.keepAwake();
      this.ticker = setInterval(() => this.tick(), 1000);
    } catch (error) {
      this.closeMicrophone();
      this.set({ phase: "error", error: this.reason(error) });
    }
  }
  private reason(error: unknown) {
    const name = (error as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "SecurityError")
      return "The microphone is blocked. Allow it for this site in the browser’s settings, then try again.";
    if (name === "NotFoundError") return "No microphone was found on this device.";
    // A dropped connection: the browser's own words ("Failed to fetch") mean nothing to people.
    if (error instanceof TypeError)
      return "Couldn’t reach the server. Check your connection and try again.";
    return error instanceof Error ? error.message : "Recording couldn’t start.";
  }
  private async openMicrophone() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // The loudness, ten times a second, for the level bars.
    try {
      const Context =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Context) {
        this.audio = new Context();
        // Made after the microphone was allowed, it can start paused; the tap that started
        // recording lets it run.
        void this.audio.resume().catch(() => undefined);
        const source = this.audio.createMediaStreamSource(this.stream);
        const analyser = this.audio.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        this.meter = setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const value of samples) sum += ((value - 128) / 128) ** 2;
          const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
          // Only a change worth drawing is passed on.
          if (Math.abs(level - this.state.level) > 0.04) this.set({ level });
        }, 120);
      }
    } catch {
      // No level bars; the recording itself is unaffected.
    }
    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener("ended", () => this.interrupted(this.lostSince()));
    }
    // An iPhone mutes the microphone (rather than ending it) when it locks or another app takes
    // it; a mute that lasts a few seconds is a pause, a blip isn't. Timers don't run on a locked
    // phone, so the pause is measured from when the mute began, once the person is back; the
    // timer only covers a mute while the screen is still on.
    for (const track of this.stream.getAudioTracks()) {
      let muted: ReturnType<typeof setTimeout> | undefined;
      track.addEventListener("mute", () => {
        clearTimeout(muted);
        this.mutedAt = Date.now();
        muted = setTimeout(() => {
          if (track.muted && document.visibilityState === "visible")
            this.interrupted(this.mutedAt || undefined);
        }, 3000);
      });
      track.addEventListener("unmute", () => {
        clearTimeout(muted);
        const since = this.mutedAt;
        this.mutedAt = 0;
        if (since && Date.now() - since >= AWAY_SECONDS * 1000) this.interrupted(since);
      });
    }
  }
  private closeMicrophone() {
    clearInterval(this.meter);
    this.meter = undefined;
    void this.audio?.close().catch(() => undefined);
    this.audio = undefined;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = undefined;
  }
  private beginPart() {
    if (!this.stream) return;
    const recorder = new MediaRecorder(this.stream, {
      mimeType: this.type,
      audioBitsPerSecond: 32_000,
    });
    const part = this.part;
    this.piece = 0;
    recorder.ondataavailable = (event) => {
      if (event.data.size) {
        this.queue.push({ part, n: this.piece++, blob: event.data, tries: 0 });
        this.set({ waiting: this.queue.length });
        void this.send();
      }
    };
    recorder.onstop = () => {
      if (!this.stopping && this.recorder === recorder) this.interrupted(this.lostSince());
    };
    recorder.onerror = () => this.interrupted(this.lostSince());
    this.recorder = recorder;
    this.partStarted = Date.now();
    recorder.start(PIECE_MS);
    this.set({ phase: "recording", error: undefined });
  }
  /**
   * When sound was last surely coming in: a mute seen earlier, or (on an iPhone, which never
   * records in the background) when the app was hidden; else now.
   */
  private lostSince() {
    return this.mutedAt || (backgroundStopsRecording() ? this.hiddenAt : 0) || undefined;
  }
  /**
   * The microphone stopped without being asked (the phone locked): this part ends here, or at
   * `at` when the pause is only noticed later (a locked iPhone runs no timers).
   */
  private interrupted(at = Date.now()) {
    if (this.state.phase !== "recording" || this.stopping) return;
    const end = Math.max(this.partStarted, Math.min(at, Date.now()));
    this.partSeconds[this.part] = (end - this.partStarted) / 1000;
    this.partStarted = 0;
    this.pausedAt = end;
    // Both signs of this pause are used up: a late one mustn't count it again.
    this.mutedAt = 0;
    this.hiddenAt = 0;
    const recorder = this.recorder;
    this.recorder = undefined;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    this.closeMicrophone();
    this.set({ phase: "paused", seconds: this.seconds(), level: 0 });
    if (document.visibilityState === "visible") void this.resume();
  }
  /** A new part after a pause; a tap on Resume tries again if this one can't. */
  async resume() {
    // Coming back can ask twice (the microphone's event and the screen's); one new part only.
    if (this.state.phase !== "paused" || this.resuming) return;
    this.resuming = true;
    try {
      await this.openMicrophone();
      this.part++;
      const missed = this.pausedAt ? (Date.now() - this.pausedAt) / 1000 : 0;
      this.missed[this.part] = missed;
      this.pausedAt = 0;
      this.beginPart();
      // More than a blip: say so, so nobody thinks those minutes are in the notes.
      if (missed >= AWAY_SECONDS)
        this.set({
          away: missed,
          missedSeconds: this.missed.reduce((sum, s) => sum + (s >= AWAY_SECONDS ? s : 0), 0),
        });
    } catch (error) {
      this.closeMicrophone();
      this.set({ error: this.reason(error) });
    } finally {
      this.resuming = false;
    }
  }
  private tick() {
    const seconds = this.seconds();
    this.set({ seconds });
    const max = this.state.maxSeconds;
    if (max && seconds >= max && this.state.phase === "recording") {
      this.set({ stoppedAtLimit: true });
      if (this.state.meetingId) stoppedAtLimit.add(this.state.meetingId);
      void this.stop();
    }
  }
  private async keepAwake() {
    try {
      const lock = (
        navigator as unknown as {
          wakeLock?: { request: (kind: "screen") => Promise<{ release: () => Promise<void> }> };
        }
      ).wakeLock;
      if (lock && !this.wakeLock && this.state.phase !== "idle") {
        const sentinel = await lock.request("screen");
        this.wakeLock = sentinel;
        // The browser lets go of it whenever the app is hidden; it's asked for again on return.
        (sentinel as unknown as EventTarget).addEventListener?.("release", () => {
          if (this.wakeLock === sentinel) this.wakeLock = undefined;
        });
      }
    } catch {
      // Not offered (an older phone): the person keeps the screen on themselves.
    }
  }
  /** Sends the pieces in order, one at a time, waiting longer after each failure. */
  private async send() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length && this.state.meetingId) {
        const piece = this.queue[0];
        if (!piece) break;
        try {
          await this.api.upload(
            `/api/meetings/${this.state.meetingId}/chunks/${piece.part}/${piece.n}`,
            piece.blob,
          );
          this.queue.shift();
          this.set({ waiting: this.queue.length });
        } catch (error) {
          piece.tries++;
          const message = error instanceof Error ? error.message : "";
          // The server won't take it (closed while away, or past its time): no use trying again.
          if (/already finished|run past its time|not found|couldn’t be found/i.test(message)) {
            this.queue = [];
            this.set({ waiting: 0 });
            if (!this.stopping) this.closedByServer();
            break;
          }
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(30_000, 2000 * 2 ** Math.min(piece.tries, 4))),
          );
        }
      }
    } finally {
      this.sending = false;
    }
  }
  /** Stops, sends the last piece, and hands the meeting to the server to write up. */
  async stop(): Promise<string | undefined> {
    const id = this.state.meetingId;
    if (!id || (this.state.phase !== "recording" && this.state.phase !== "paused")) return id;
    this.stopping = true;
    if (this.state.phase === "recording")
      this.partSeconds[this.part] = (Date.now() - this.partStarted) / 1000;
    this.partStarted = 0;
    this.set({ phase: "saving", seconds: this.seconds(), level: 0 });
    // The last piece arrives with the recorder's stop.
    const recorder = this.recorder;
    this.recorder = undefined;
    if (recorder && recorder.state !== "inactive")
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    this.closeMicrophone();
    void this.send();
    // Up to a minute for what's left to reach the server; the server uses what it has after that.
    const until = Date.now() + 60_000;
    while ((this.queue.length || this.sending) && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      await this.api.request(`/api/meetings/${id}/finish`, {
        seconds: Math.round(this.seconds()),
        parts: this.parts(),
      });
      this.finish();
      return id;
    } catch {
      this.set({
        phase: "error",
        unfinished: true,
        error:
          "Couldn’t reach the server to finish. What was recorded is kept and will be written up.",
      });
      this.finish(true);
      return id;
    }
  }
  /** After a Stop that couldn't reach the server: tells it again that the recording is over. */
  async finishAgain(): Promise<string | undefined> {
    const id = this.state.meetingId;
    if (!id || !this.state.unfinished) return id;
    try {
      await this.api.request(`/api/meetings/${id}/finish`, {
        seconds: Math.round(this.seconds()),
        parts: this.parts(),
      });
      this.set({ ...IDLE });
      return id;
    } catch {
      this.set({
        error:
          "Still couldn’t reach the server. What was recorded is kept and will be written up on its own.",
      });
      return undefined;
    }
  }
  /** The server closed this recording while the app was away: this part stops here. */
  private closedByServer() {
    this.stopping = true;
    const recorder = this.recorder;
    this.recorder = undefined;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    this.closeMicrophone();
    this.set({
      phase: "error",
      closed: true,
      level: 0,
      error:
        "The app was away too long, so this recording ended. What was recorded is being written up.",
    });
    this.finish(true);
  }
  /**
   * Stopped by mistake: nothing is kept. True when it's gone; otherwise the recorder says why
   * (never quietly, or a meeting thrown away would still be written up).
   */
  async discard(): Promise<boolean> {
    const id = this.state.meetingId;
    this.stopping = true;
    const recorder = this.recorder;
    this.recorder = undefined;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    this.closeMicrophone();
    this.queue = [];
    if (!id) {
      this.finish();
      return true;
    }
    try {
      await this.api.request(`/api/meetings/${id}/discard`, {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // Already gone is what was wanted.
      if (!/not found|couldn’t be found/i.test(message)) {
        const written = /already finished/i.test(message);
        this.set({
          phase: "error",
          level: 0,
          closed: false,
          unfinished: false,
          notThrownAway: written ? "written" : "offline",
          error: written
            ? "This recording was already closed and is being written up. Delete it from its page if you don’t want it."
            : "Couldn’t reach the server to throw it away. Check your connection and try again.",
        });
        this.finish(true);
        return false;
      }
    }
    this.finish();
    return true;
  }
  private finish(keepError = false) {
    clearInterval(this.ticker);
    this.ticker = undefined;
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("beforeunload", this.onLeave);
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = undefined;
    if (!keepError) this.set({ ...IDLE });
  }
  /** How long each part ran and what was missed before it, for the server. */
  private parts() {
    // Array.from, not map: a missing part is sent as 0 seconds, never as a hole (null).
    return Array.from(this.partSeconds, (seconds, index) => ({
      index,
      seconds: seconds ?? 0,
      ...(this.missed[index] ? { missedBefore: Math.round(this.missed[index] as number) } : {}),
    }));
  }
  /** The "you were away" note has been read. */
  seenAway() {
    if (this.state.away !== undefined) this.set({ away: undefined });
  }
  /** Back to the start after an error has been read. */
  clear() {
    if (this.state.phase === "error") this.set({ ...IDLE });
  }
}
