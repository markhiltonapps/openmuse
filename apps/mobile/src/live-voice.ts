import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import type { CallDetail } from "../../../packages/domain/src/voice";
import type { MuseApi } from "./api";
import { setLiveSpeaking, voiceSettings } from "./voice";

/**
 * Live voice in the browser: the microphone goes straight to OpenAI over WebRTC and the agent's
 * voice comes straight back. Our server only makes the session (it holds the key) and listens in
 * to count minutes and keep what was said.
 */
export type LiveState = "connecting" | "listening" | "speaking" | "ended";
export interface LiveHandlers {
  onState: (state: LiveState) => void;
  /** Words as they're heard and said, a little at a time. */
  onWords: (role: "user" | "assistant", words: string) => void;
  /** It ended on its own: the other side hung up, the time limit, a lost connection. */
  onEnded: (reason?: string) => void;
  /** The agent is looking something up ("hold on, let me check"), and when it's done. */
  onChecking?: (checking: boolean) => void;
  /** What the agent put on screen instead of reading it out, so far (newest last). */
  onDetails?: (details: CallDetail[]) => void;
}
export interface LiveCall {
  setMuted: (muted: boolean) => void;
  /** Tells the server the call is shrunk to its bar, so the voice says where to look. */
  setShrunk: (shrunk: boolean) => void;
  end: () => Promise<void>;
}

export function liveVoiceSupported() {
  return (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    "RTCPeerConnection" in window &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Once answer events have been seen in this tab, the "speaking again" fallback isn't needed. */
let answerEvents = false;

// Whether a call is on, so the rest of the app can stay quiet (no polling or looping animation)
// and leave the phone's attention to the voice.
let calls = 0;
const callListeners = new Set<() => void>();
function countCall(change: 1 | -1) {
  calls = Math.max(0, calls + change);
  for (const listener of callListeners) listener();
}
export const liveCallOn = () => calls > 0;
export function useLiveCallOn() {
  return useSyncExternalStore(
    (listener) => {
      callListeners.add(listener);
      return () => {
        callListeners.delete(listener);
      };
    },
    () => calls > 0,
    () => false,
  );
}
export async function startLive(api: MuseApi, handlers: LiveHandlers): Promise<LiveCall> {
  const micId = voiceSettings().microphone;
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  const stream = await navigator.mediaDevices
    .getUserMedia({ audio: micId ? { ...audio, deviceId: { exact: micId } } : audio })
    .catch((error: unknown) => {
      // The microphone chosen in Apps › Voice is unplugged: use the usual one, as dictation does.
      if (
        micId &&
        error instanceof Error &&
        ["OverconstrainedError", "NotFoundError"].includes(error.name)
      )
        return navigator.mediaDevices.getUserMedia({ audio });
      throw error;
    });
  countCall(1);
  const peer = new RTCPeerConnection();
  const player = new Audio();
  player.autoplay = true;
  let context: AudioContext | undefined;
  let meter: ReturnType<typeof setInterval> | undefined;
  let sessionId = "";
  let over = false;
  let wakeLock: { release: () => Promise<void> } | undefined;
  // The browser drops the screen lock whenever the page is hidden; ask again on the way back.
  const keepAwake = async () => {
    try {
      const lock = await (
        navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
        }
      ).wakeLock?.request("screen");
      // The call may have ended while the browser was deciding.
      if (over) void lock?.release().catch(() => undefined);
      else wakeLock = lock;
    } catch {
      // Not allowed here; carry on.
    }
  };
  const onVisible = () => {
    if (document.visibilityState === "visible" && !over) void keepAwake();
  };
  let stopChecking = () => {};
  const stop = (reason?: string, tellServer = true) => {
    if (over) return Promise.resolve();
    over = true;
    countCall(-1);
    clearInterval(meter);
    stopChecking();
    setLiveSpeaking(false);
    try {
      if (channel.readyState === "open") channel.send(JSON.stringify({ type: "session.close" }));
    } catch {
      // Already closed.
    }
    for (const track of stream.getTracks()) track.stop();
    peer.close();
    player.srcObject = null;
    void context?.close().catch(() => undefined);
    void wakeLock?.release().catch(() => undefined);
    document.removeEventListener("visibilitychange", onVisible);
    handlers.onState("ended");
    if (reason !== undefined) handlers.onEnded(reason);
    return tellServer && sessionId
      ? api
          .request(`/api/voice/live/${encodeURIComponent(sessionId)}/end`, {})
          .then(() => undefined)
          .catch(() => undefined)
      : Promise.resolve();
  };
  // The agent's voice: played, and measured so the avatar talks while it does.
  peer.ontrack = (event) => {
    const [remote] = event.streams;
    if (!remote) return;
    player.srcObject = remote;
    // How loud the agent is: read from the connection itself where the browser can, since
    // running the voice through Web Audio as well can make it stutter on some phones.
    const measureSound = (): (() => number) | undefined => {
      try {
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(remote).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        return () => {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
          return Math.sqrt(sum / samples.length);
        };
      } catch {
        // No way to measure: the voice still plays, the avatar just doesn't move its mouth.
        return undefined;
      }
    };
    const receiver = event.receiver as RTCRtpReceiver & {
      getSynchronizationSources?: () => { audioLevel?: number; rtpTimestamp: number }[];
    };
    let lastPacket = -1;
    let level =
      typeof receiver.getSynchronizationSources === "function"
        ? () => {
            const [latest] = receiver.getSynchronizationSources?.() ?? [];
            if (!latest) return 0;
            if (latest.audioLevel === undefined) {
              // The connection doesn't carry how loud it is: measure the sound itself.
              level = measureSound();
              return 0;
            }
            // No new sound since last time (the voice may send nothing in silence): quiet.
            const fresh = latest.rtpTimestamp !== lastPacket;
            lastPacket = latest.rtpTimestamp;
            return fresh ? latest.audioLevel : 0;
          }
        : measureSound();
    if (!level) return;
    // Starts quiet, so the screen says "Listening" until the agent first speaks.
    let quietSince = 1;
    let said: LiveState | undefined;
    meter = setInterval(() => {
      const loud = (level?.() ?? 0) > 0.02;
      if (loud) quietSince = 0;
      else quietSince ||= Date.now();
      const quiet = quietSince > 0 ? Date.now() - quietSince : 0;
      // The mouth follows the sound closely; the words on screen wait out a pause between
      // sentences, so they don't flicker between talking and listening.
      setLiveSpeaking(loud || quiet < 400);
      const now: LiveState = loud || quiet < 1500 ? "speaking" : "listening";
      // Only changes are passed on, so the screen isn't redrawn ten times a second.
      if (!over && now !== said) {
        said = now;
        handlers.onState(now);
      }
    }, 120);
  };
  for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
  const channel = peer.createDataChannel("oai-events");
  // "Let me check": while any hand-over is waiting for its answer. Each answer the server adds
  // closes one; if those events never arrive, the voice speaking again after a pause does, and
  // a cap ends it regardless.
  let open = 0;
  let checkingSince = 0;
  let lastSaid = 0;
  let checkingCap: ReturnType<typeof setTimeout> | undefined;
  const checking = (on: boolean) => {
    open = on ? open + 1 : 0;
    const now = open > 0;
    if (now === checkingSince > 0) return;
    checkingSince = now ? Date.now() : 0;
    clearTimeout(checkingCap);
    if (now) checkingCap = setTimeout(() => checking(false), 130_000);
    handlers.onChecking?.(now);
  };
  // An answer is in: anything too long to say is on the server by now. A failed look is tried
  // again twice.
  const showDetails = (retry = 0) => {
    if (!sessionId || !handlers.onDetails || over) return;
    void api
      .request<{ details: CallDetail[] }>(
        `/api/voice/live/${encodeURIComponent(sessionId)}/details`,
      )
      .then(({ details }) => {
        if (details.length && !over) handlers.onDetails?.(details);
      })
      .catch(() => {
        if (retry < 2) setTimeout(() => showDetails(retry + 1), retry ? 3000 : 1000);
      });
  };
  const answered = () => {
    answerEvents = true;
    if (open <= 1) checking(false);
    else open -= 1;
    showDetails();
  };
  stopChecking = () => checking(false);
  channel.onmessage = (message) => {
    let event: { type?: string; delta?: string; reason?: string };
    try {
      event = JSON.parse(String(message.data));
    } catch {
      return;
    }
    if (event.type === "session.started") handlers.onState("listening");
    else if (event.type === "session.input_transcript.delta" && event.delta)
      handlers.onWords("user", event.delta);
    else if (event.type === "session.output_transcript.delta" && event.delta) {
      const now = Date.now();
      // Without answer events: after "one sec, let me check" and a pause, the voice speaking
      // again is the answer.
      if (!answerEvents && checkingSince && now - checkingSince > 1500 && now - lastSaid > 1200) {
        checking(false);
        showDetails();
      }
      lastSaid = now;
      handlers.onWords("assistant", event.delta);
    } else if (event.type === "session.delegation.created") checking(true);
    else if (event.type === "session.commentary.appended") answered();
    else if (event.type === "session.closed") void stop(event.reason ?? "ended", false);
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "failed") void stop("connection_lost");
  };
  handlers.onState("connecting");
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const answer = await api.request<{ sdp: string; sessionId: string }>("/api/voice/live", {
      sdp: offer.sdp,
    });
    sessionId = answer.sessionId;
    await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
  } catch (error) {
    await stop(undefined, false);
    throw error;
  }
  // Keep the screen on while talking; a locked phone stops the microphone.
  await keepAwake();
  document.addEventListener("visibilitychange", onVisible);
  return {
    setMuted: (muted) => {
      for (const track of stream.getAudioTracks()) track.enabled = !muted;
    },
    setShrunk: (shrunk) => {
      if (over || !sessionId) return;
      void api
        .request(`/api/voice/live/${encodeURIComponent(sessionId)}/view`, { shrunk })
        .catch(() => undefined);
    },
    end: () => stop(),
  };
}
