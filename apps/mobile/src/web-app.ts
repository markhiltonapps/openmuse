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
/**
 * Starts dictation and hands over the whole phrase once, when the person stops talking.
 * Returns a function that stops listening.
 */
export function dictate(
  onText: (text: string) => void,
  onEnd: (error?: string) => void,
  microphone?: string,
): () => void {
  const Recognizer = recognizer();
  if (!Recognizer) {
    onEnd("Voice input isn't available in this browser.");
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
  const finish = () => {
    if (finished) return;
    finished = true;
    track?.stop();
    if (transcript) onText(transcript);
    onEnd(error);
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
            ? "Voice isn’t working in this browser. Tap the mic on your keyboard to talk instead."
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
