import { Platform } from "react-native";
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
}
export interface LiveCall {
  setMuted: (muted: boolean) => void;
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
    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(remote).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      // Starts quiet, so the screen says "Listening" until the agent first speaks.
      let quietSince = 1;
      meter = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        const loud = Math.sqrt(sum / samples.length) > 0.02;
        if (loud) quietSince = 0;
        else quietSince ||= Date.now();
        const quiet = quietSince > 0 ? Date.now() - quietSince : 0;
        // The mouth follows the sound closely; the words on screen wait out a pause between
        // sentences, so they don't flicker between talking and listening.
        setLiveSpeaking(loud || quiet < 400);
        if (!over) handlers.onState(loud || quiet < 1500 ? "speaking" : "listening");
      }, 100);
    } catch {
      // No Web Audio: the voice still plays, the avatar just doesn't move its mouth.
    }
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
  const answered = () => {
    answerEvents = true;
    if (open <= 1) checking(false);
    else open -= 1;
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
      if (!answerEvents && checkingSince && now - checkingSince > 1500 && now - lastSaid > 1200)
        checking(false);
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
    end: () => stop(),
  };
}
