import { useEffect, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { NO_BACKDROP } from "../../../packages/domain/src/backdrops";
import type { MuseApi } from "./api";
import { liveCallOn } from "./live-voice";
import { glass, rememberBackdrop, savedBackdrop } from "./theme";

/**
 * The moving backdrop's setting, shared by the video layer, the picker and the chat's card. The
 * server keeps it per account; this device remembers it so the app opens straight into it.
 */
export interface BackdropView {
  scene: string;
  still: boolean;
}
const STILL_KEY = "openmuse.backdrop-still";
function savedStill() {
  try {
    return globalThis.localStorage?.getItem(STILL_KEY) === "1";
  } catch {
    return false;
  }
}
let current: BackdropView = { scene: savedBackdrop(), still: savedStill() };
const listeners = new Set<() => void>();

/** Takes a setting from the server, the picker or the chat, and shows it. */
export function applyBackdrop(view: BackdropView) {
  if (view.scene === current.scene && view.still === current.still) return;
  current = { scene: view.scene, still: view.still };
  rememberBackdrop(view.scene);
  try {
    globalThis.localStorage?.setItem(STILL_KEY, view.still ? "1" : "0");
  } catch {
    // Private browsing: the server still knows.
  }
  for (const listener of listeners) listener();
}
export function useBackdrop() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => current,
  );
}

/**
 * Turning the backdrop on or off changes every colour in the app, which are made once when it
 * opens: it reopens to switch, but never during a call (that would end it).
 */
export function needsReopen(scene: string) {
  return glass !== (scene !== NO_BACKDROP);
}
export function reopenIfNeeded(scene: string): "reopening" | "after-call" | "no" {
  if (!needsReopen(scene) || Platform.OS !== "web" || typeof window === "undefined") return "no";
  if (liveCallOn()) return "after-call";
  reopenApp();
  return "reopening";
}
/** A switch on or off made elsewhere (by voice, or on another device) that this tab hasn't shown yet. */
export const reopenPending = () => needsReopen(savedBackdrop());
const pendingListeners = new Set<() => void>();
/** Remembers the account's scene for the next open, and tells anything showing "Reopen". */
export function markSaved(scene: string) {
  rememberBackdrop(scene);
  for (const listener of pendingListeners) listener();
}
export function useReopenPending() {
  return useSyncExternalStore(
    (listener) => {
      pendingListeners.add(listener);
      return () => {
        pendingListeners.delete(listener);
      };
    },
    reopenPending,
    () => false,
  );
}
// "Not now" on the reopen pill, until the app reopens.
let pillLater = false;
export function reopenLater() {
  pillLater = true;
  for (const listener of pendingListeners) listener();
}
/** Whether the reopen pill wants to show (a switch is waiting and nobody said "Not now"). */
export function useReopenPill() {
  return useSyncExternalStore(
    (listener) => {
      pendingListeners.add(listener);
      return () => {
        pendingListeners.delete(listener);
      };
    },
    () => reopenPending() && !pillLater,
    () => false,
  );
}
const BACK_TO_PICKER = "openmuse.reopen-to-backdrop";
/** Reopens the app, back at the Backdrop picker so the person sees the result. */
export function reopenApp() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    sessionStorage.setItem(BACK_TO_PICKER, "1");
  } catch {
    // Private browsing: it opens on the chat instead.
  }
  window.location.reload();
}
/** True once, right after the app reopened from the picker. */
export function takeReopenedToPicker() {
  try {
    if (sessionStorage.getItem(BACK_TO_PICKER) !== "1") return false;
    sessionStorage.removeItem(BACK_TO_PICKER);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps this device in step with the server: on open, when the app comes back into view, and
 * every minute while it's on screen (it may have been changed by voice or on another device).
 */
export function useBackdropSync(api: MuseApi) {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    let stopped = false;
    const check = () => {
      if (stopped || document.visibilityState !== "visible" || liveCallOn()) return;
      void api.request<BackdropView>("/api/backdrop").then(
        (view) => {
          if (stopped) return;
          // A switch on or off waits for the next open; a new scene or still shows now.
          if (needsReopen(view.scene)) markSaved(view.scene);
          else applyBackdrop(view);
        },
        () => undefined,
      );
    };
    check();
    const every = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(every);
      document.removeEventListener("visibilitychange", check);
    };
  }, [api]);
}

/** Where a scene's files are, next to the web app. */
export const backdropFile = (id: string, kind: "video" | "still" | "thumb") =>
  `/backdrops/${id}${kind === "video" ? ".mp4" : kind === "still" ? ".jpg" : "-thumb.jpg"}`;
