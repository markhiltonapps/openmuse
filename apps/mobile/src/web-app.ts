import { Platform } from "react-native";
import type { MuseApi } from "./api";

// Browser-only features of the installed web app: service worker, push, dictation and sharing.
const web = () => Platform.OS === "web" && typeof window !== "undefined";

export function registerServiceWorker() {
  if (!web() || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
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
  start(): void;
  stop(): void;
};
function recognizer(): (new () => Recognition) | undefined {
  if (!web()) return undefined;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | undefined;
}
export const dictationAvailable = () => Boolean(recognizer());
/** Starts dictation; returns a function that stops it. */
export function dictate(
  onText: (text: string) => void,
  onEnd: (error?: string) => void,
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
  recognition.onresult = (event) => {
    const text = Array.from(event.results)
      .map((result) => result[0]?.transcript ?? "")
      .join(" ")
      .trim();
    if (text) onText(text);
  };
  recognition.onerror = (event) =>
    onEnd(
      event.error === "not-allowed"
        ? "Allow microphone access to use voice input."
        : event.error === "no-speech"
          ? undefined
          : "Voice input stopped.",
    );
  recognition.onend = () => onEnd();
  recognition.start();
  return () => recognition.stop();
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
