import { useSyncExternalStore } from "react";

/**
 * Room on the chat screen (owner, 2026-11-24: on a phone the answer got about a third of the
 * screen). The chat's header is one slim row, the "needs you" notice sits in the page instead of
 * floating over the header and the messages, and the bar of four doors steps aside while the
 * keyboard is up. These few numbers are shared by the pieces that do that.
 */
export const CHAT_HEADER_PHONE = 64;
export const CHAT_HEADER_DESKTOP = 76;

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const tell = () => {
  for (const listener of listeners) listener();
};

/** How tall the notice under the header is right now (0 when there isn't one). */
let toastRoom = 0;
export function setToastRoom(height: number) {
  const next = Math.max(0, Math.round(height));
  if (next === toastRoom) return;
  toastRoom = next;
  tell();
}
export const useToastRoom = () =>
  useSyncExternalStore(
    subscribe,
    () => toastRoom,
    () => 0,
  );

/** The message box has focus. */
let boxFocused = false;
/**
 * The keyboard is up: the page's visible height fell well below what it was when the box got
 * focus (a phone may shrink the page itself or only what you see of it). Where the browser can't
 * say, the bar simply stays.
 */
let keyboardUp = false;
let baseline = 0;
const visible = () => {
  const viewport = typeof window === "undefined" ? undefined : window.visualViewport;
  return viewport ? Math.max(window.innerHeight, viewport.height) : 0;
};
const check = () => {
  const viewport = typeof window === "undefined" ? undefined : window.visualViewport;
  if (!viewport || !baseline) return;
  const up = viewport.height < baseline * 0.8;
  if (up !== keyboardUp) {
    keyboardUp = up;
    tell();
  }
};
export function setBoxFocused(focused: boolean) {
  if (focused !== boxFocused) boxFocused = focused;
  // A fresh baseline each time the box gains or loses focus, so a split screen or a rotation
  // can never leave the last tallest height behind.
  baseline = visible();
  keyboardUp = false;
  tell();
}
let watching = false;
/** True while the person is typing with the keyboard up, so the bar at the bottom can step aside. */
export function useTyping() {
  if (!watching && typeof window !== "undefined") {
    watching = true;
    window.visualViewport?.addEventListener("resize", check);
    window.addEventListener("orientationchange", () => {
      baseline = visible();
      keyboardUp = false;
      tell();
    });
  }
  return useSyncExternalStore(
    subscribe,
    () => boxFocused && keyboardUp,
    () => false,
  );
}
