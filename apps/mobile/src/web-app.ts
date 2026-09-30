import { Platform } from "react-native";
import type { MuseApi } from "./api";
import { mergeTranscripts } from "./transcript";

// Browser-only features of the installed web app: service worker, push, dictation and sharing.
const web = () => Platform.OS === "web" && typeof window !== "undefined";

export function registerServiceWorker() {
  if (!web() || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

/** Heard when a tapped notification asks for a meal check-in; the chat card reloads on it. */
export const CHECK_IN_OPENED = "muse-checkin-opened";
/**
 * A tapped check-in notification opens the app at /?checkin=… (or, when it's already open, the
 * service worker says so). Calls `onOpen` for either, and tidies the address bar.
 */
export function listenForCheckIns(onOpen: () => void) {
  if (!web()) return () => undefined;
  const opened = () => {
    onOpen();
    window.dispatchEvent(new Event(CHECK_IN_OPENED));
  };
  const url = new URL(window.location.href);
  if (url.searchParams.has("checkin")) {
    url.searchParams.delete("checkin");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    opened();
  }
  const message = (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | undefined;
    if (data?.type === "notification-open" && data.url?.includes("checkin=")) opened();
  };
  navigator.serviceWorker?.addEventListener("message", message);
  return () => navigator.serviceWorker?.removeEventListener("message", message);
}

export const locationAvailable = () => web() && "geolocation" in navigator;
/** The device's rough location, once, after the person allows it. */
export function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!locationAvailable())
      return reject(new Error("Location isn’t available here. Type your city instead."));
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? "Location is blocked for this site. Type your city instead."
              : "Couldn’t get your location. Type your city instead.",
          ),
        ),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60 * 60 * 1000 },
    );
  });
}

export function isInstalled() {
  if (!web()) return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
export function isIos() {
  return web() && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export type PushState = "unsupported" | "install-first" | "blocked" | "off" | "on";
export async function pushState(): Promise<PushState> {
  if (!web()) return "unsupported";
  if (isIos() && !isInstalled()) return "install-first";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ? "on" : "off";
}
function keyBytes(base64url: string) {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
export async function enablePush(api: MuseApi) {
  if ((await Notification.requestPermission()) !== "granted")
    throw new Error("Notifications are turned off for this site in your browser settings.");
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api.request<{ publicKey: string }>("/api/push/key");
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  await api.request("/api/push/subscribe", subscription.toJSON());
}
export async function disablePush(api: MuseApi) {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await api.request("/api/push/unsubscribe", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: (event: { error: string }) => void;
  /** Recent Chrome accepts a microphone track; other browsers ignore it and use the default. */
  start(source?: MediaStreamTrack): void;
  stop(): void;
};
function recognizer(): (new () => Recognition) | undefined {
  if (!web()) return undefined;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | undefined;
}
export const dictationAvailable = () => Boolean(recognizer());
/** How loud a microphone has to get (RMS of its samples) to count as hearing someone talk. */
export const SPEAKING_LEVEL = 0.02;
/** Reads how loud a stream is right now, from 0 to about 1. */
export function openMeter(stream: MediaStream) {
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return { read: () => 0, close: () => undefined };
  const context = new Context();
  void context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  // About 43 ms of sound per read, so reads every 40 ms miss nothing.
  analyser.fftSize = 2048;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  return {
    read() {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      return Math.sqrt(sum / samples.length);
    },
    close() {
      source.disconnect();
      void context.close().catch(() => undefined);
    },
  };
}
/**
 * Every microphone at once, with how loud each is about ten times a second, so the person can
 * see which one hears them. "" is whatever the computer is set to use. Stop it when done.
 */
export async function watchMicrophones(onLevels: (levels: Record<string, number>) => void) {
  const mics = await microphones(true);
  const open: { id: string; stream: MediaStream; meter: ReturnType<typeof openMeter> }[] = [];
  let stopped = false;
  await Promise.all(
    [{ id: "" }, ...mics].map(async ({ id }) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: id ? { deviceId: { exact: id } } : true,
        });
        if (stopped) for (const track of stream.getTracks()) track.stop();
        else open.push({ id, stream, meter: openMeter(stream) });
      } catch {
        // A microphone that can't be opened (in use, unplugged) just shows no sound.
      }
    }),
  );
  const timer = setInterval(() => {
    onLevels(Object.fromEntries(open.map(({ id, meter }) => [id, meter.read()])));
  }, 100);
  return {
    mics,
    stop() {
      stopped = true;
      clearInterval(timer);
      for (const { stream, meter } of open.splice(0)) {
        meter.close();
        for (const track of stream.getTracks()) track.stop();
      }
    },
  };
}
/** The name the computer gives a microphone; for "" the one it uses by default. */
export async function microphoneName(id?: string) {
  if (!web() || !navigator.mediaDevices?.enumerateDevices) return undefined;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === "audioinput",
  );
  const found = devices.find((device) => device.deviceId === (id || "default")) ?? devices[0];
  return found?.label.replace(/^Default - /, "").trim() || undefined;
}

/**
 * Starts dictation and hands over the whole phrase once, when the person stops talking.
 * With `nothingHeard`, it reports when listening ended with no words: whether the microphone
 * picked up any sound at all tells a silent microphone from a browser listening to another one.
 * Returns a function that stops listening.
 */
export function dictate(
  onText: (text: string) => void,
  onEnd: (error?: string) => void,
  microphone?: string,
  nothingHeard?: (sound: boolean) => void,
): () => void {
  const Recognizer = recognizer();
  if (!Recognizer) {
    onEnd("Voice input isn’t available in this browser.");
    return () => undefined;
  }
  const recognition = new Recognizer();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;
  let transcript = "";
  let error: string | undefined;
  let track: MediaStreamTrack | undefined;
  let finished = false;
  let stopped = false;
  // How loud the microphone got while listening, when asked to report silence.
  let peak = 0;
  let metering:
    | { stream: MediaStream; meter: ReturnType<typeof openMeter>; timer: number }
    | undefined;
  const stopMetering = () => {
    if (!metering) return;
    clearInterval(metering.timer);
    metering.meter.close();
    for (const t of metering.stream.getTracks()) t.stop();
    metering = undefined;
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    stopMetering();
    track?.stop();
    if (transcript) onText(transcript);
    onEnd(error);
    if (nothingHeard && !transcript && !stopped && !error) nothingHeard(peak >= SPEAKING_LEVEL);
  };
  recognition.onresult = (event) => {
    transcript = mergeTranscripts(
      Array.from(event.results, (result) => result[0]?.transcript ?? ""),
    );
  };
  recognition.onerror = (event) => {
    error =
      event.error === "not-allowed"
        ? "Allow microphone access to use voice input."
        : event.error === "no-speech" || event.error === "aborted"
          ? undefined
          : event.error === "network" ||
              event.error === "service-not-allowed" ||
              event.error === "audio-capture"
            ? "Voice input isn’t working in this browser. Type instead, or tap the mic on your phone’s keyboard."
            : "Voice input stopped.";
    finish();
  };
  recognition.onend = finish;
  void (async () => {
    if (microphone && navigator.mediaDevices?.getUserMedia)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: microphone } },
        });
        track = stream.getAudioTracks()[0];
      } catch {
        track = undefined;
      }
    if (nothingHeard && navigator.mediaDevices?.getUserMedia)
      try {
        const stream = track
          ? new MediaStream([track.clone()])
          : await navigator.mediaDevices.getUserMedia({ audio: true });
        const meter = openMeter(stream);
        metering = {
          stream,
          meter,
          timer: window.setInterval(() => {
            peak = Math.max(peak, meter.read());
          }, 40),
        };
      } catch {
        metering = undefined;
      }
    if (finished) return stopMetering();
    if (stopped) return finish();
    try {
      if (track) recognition.start(track);
      else recognition.start();
    } catch {
      track?.stop();
      track = undefined;
      try {
        recognition.start();
      } catch {
        error = "Voice input stopped.";
        finish();
      }
    }
  })();
  return () => {
    stopped = true;
    try {
      recognition.stop();
    } catch {
      finish();
    }
  };
}

/** Microphones this browser can use; names appear once microphone access is allowed. */
export async function microphones(askPermission = false) {
  if (!web() || !navigator.mediaDevices?.enumerateDevices) return [];
  if (askPermission) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  }
  return (await navigator.mediaDevices.enumerateDevices())
    .filter(
      (device) =>
        device.kind === "audioinput" &&
        device.deviceId !== "default" &&
        device.deviceId !== "communications",
    )
    .map((device, index) => ({
      id: device.deviceId,
      name: device.label || `Microphone ${index + 1}`,
      named: Boolean(device.label),
    }));
}

/** Text shared to the installed app from another app (Android share sheet). */
export function takeSharedText() {
  if (!web()) return "";
  const params = new URLSearchParams(window.location.search);
  const text = ["share-title", "share-text", "share-url"]
    .map((key) => params.get(key)?.trim())
    .filter(Boolean)
    .join("\n");
  if (text) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  return text.slice(0, 4000);
}

/**
 * A job handed over by a link, /?delegate=…, such as the trial page's "Start in the app". It only
 * fills in Delegate task; nothing is sent until the person taps it. Tidies the address bar.
 */
export function takeDelegateDraft() {
  if (!web()) return "";
  const url = new URL(window.location.href);
  const text = url.searchParams.get("delegate")?.trim() ?? "";
  if (!url.searchParams.has("delegate")) return "";
  url.searchParams.delete("delegate");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return text.slice(0, 2000);
}

/**
 * A job to open, from a link in a job email or a tapped notification: /?task=… on arrival, or a
 * message from the service worker when the app is already open. Tidies the address bar.
 */
const PENDING_TASK = "openmuse.pending-task";
/** Kept for a day, so a job link opened while signed out still opens the job after signing in. */
if (typeof window !== "undefined" && typeof window.location !== "undefined") {
  const id = new URL(window.location.href).searchParams.get("task")?.trim();
  if (id)
    try {
      window.localStorage?.setItem(PENDING_TASK, JSON.stringify({ id, at: Date.now() }));
    } catch {
      // Private browsing: the link still works while signed in.
    }
}
function takePendingTask() {
  try {
    const saved = window.localStorage?.getItem(PENDING_TASK);
    window.localStorage?.removeItem(PENDING_TASK);
    const pending = saved ? (JSON.parse(saved) as { id?: string; at?: number }) : undefined;
    return pending?.id && Date.now() - (pending.at ?? 0) < 86_400_000 ? pending.id : "";
  } catch {
    return "";
  }
}
export function listenForTaskLinks(onOpen: (taskId: string) => void) {
  if (!web()) return () => undefined;
  const idOf = (href: string) => {
    try {
      return new URL(href, window.location.origin).searchParams.get("task")?.trim() || "";
    } catch {
      return "";
    }
  };
  const url = new URL(window.location.href);
  const pending = takePendingTask();
  const first = idOf(url.href) || pending;
  if (url.searchParams.has("task")) {
    url.searchParams.delete("task");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  if (first) onOpen(first.slice(0, 200));
  const message = (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | undefined;
    const id = data?.type === "notification-open" && data.url ? idOf(data.url) : "";
    if (id) onOpen(id.slice(0, 200));
  };
  navigator.serviceWorker?.addEventListener("message", message);
  return () => navigator.serviceWorker?.removeEventListener("message", message);
}

/** Lets the person choose a picture; returns it as a small square JPEG data URL. */
export function pickImage(size = 256): Promise<string | undefined> {
  if (!web()) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(undefined);
      try {
        const bitmap = await createImageBitmap(file);
        const side = Math.min(bitmap.width, bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no canvas");
        context.drawImage(
          bitmap,
          (bitmap.width - side) / 2,
          (bitmap.height - side) / 2,
          side,
          side,
          0,
          0,
          size,
          size,
        );
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      } catch {
        reject(new Error("That picture couldn't be opened. Try a JPEG or PNG."));
      }
    };
    input.click();
  });
}

/**
 * Makes a large photo small enough to upload and to show to the agent: at most 2048 pixels on
 * its longest side, as a JPEG. Smaller pictures are left as they are.
 */
export async function shrinkPicture(file: File): Promise<File> {
  if (!web() || !file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= 2048 && file.size <= 4 * 1024 * 1024) return file;
    const scale = Math.min(1, 2048 / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
