import { useEffect, useState } from "react";
import { type GestureResponderEvent, Platform } from "react-native";

/**
 * Tips: a short line that explains a control. It shows when a mouse rests on the control, when the
 * keyboard moves to it, and, on a touch screen, when a finger presses and holds it. One tip shows
 * at a time; the tip layer (TipLayer) draws it above everything, sheets included. A mouse can move
 * onto a tip without it going away, and a tip opened by a tap (an ⓘ) stays until the next tap, a
 * scroll or Escape.
 */
export interface Tip {
  text: string;
  /** Where the control is on the screen. */
  rect: { x: number; y: number; width: number; height: number };
  /** Opened by a tap: stays until the next tap anywhere, a scroll or Escape. */
  sticky?: boolean;
}

let current: Tip | undefined;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * The tip a tap just closed, so the same press (however long it's held) doesn't open it again when
 * it ends on the ⓘ. The next press or key starts afresh.
 */
let closed: string | undefined;
const listeners = new Set<(tip: Tip | undefined) => void>();
const publish = (tip: Tip | undefined) => {
  current = tip;
  for (const listener of listeners) listener(tip);
};
const clearTimers = () => {
  if (showTimer) clearTimeout(showTimer);
  if (hideTimer) clearTimeout(hideTimer);
  showTimer = hideTimer = undefined;
};

/** Shows a tip, after `delay` ms; `hideAfter` ms later it goes away on its own. */
export function showTip(
  tip: Tip,
  { delay = 0, hideAfter }: { delay?: number; hideAfter?: number },
) {
  clearTimers();
  const show = () => {
    publish(tip);
    if (hideAfter) hideTimer = setTimeout(hideTip, hideAfter);
  };
  if (delay) showTimer = setTimeout(show, delay);
  else show();
}
export function hideTip() {
  clearTimers();
  if (current) publish(undefined);
}
/** A tap somewhere else closes a tip that was tapped open. */
export function tapAway() {
  if (!current?.sticky) return;
  closed = current.text;
  hideTip();
}
/** When the mouse leaves a control: a moment to reach the tip itself, unless it was tapped open. */
export function leaveTip() {
  if (current?.sticky) return;
  if (showTimer) clearTimeout(showTimer);
  showTimer = undefined;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(hideTip, 150);
}
/** The mouse is on the tip: it stays. */
export function holdTip() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = undefined;
}
export function useTip() {
  const [tip, setTip] = useState(current);
  useEffect(() => {
    listeners.add(setTip);
    return () => {
      listeners.delete(setTip);
    };
  }, []);
  return tip;
}

type Measurable = {
  getBoundingClientRect?: () => { x: number; y: number; width: number; height: number };
  measureInWindow?: (done: (x: number, y: number, width: number, height: number) => void) => void;
  matches?: (selector: string) => boolean;
};
/** Where an event's control is on the screen: the page on the web, the window on a phone. */
export function measure(target: unknown, done: (rect: Tip["rect"]) => void) {
  const node = target as Measurable | null;
  if (node?.getBoundingClientRect) {
    const { x, y, width, height } = node.getBoundingClientRect();
    done({ x, y, width, height });
  } else node?.measureInWindow?.((x, y, width, height) => done({ x, y, width, height }));
}
const targetOf = (event: unknown) => (event as { currentTarget?: unknown })?.currentTarget;

// On the web, whether the last thing the person did was a key or a pointer: a tip on focus is for
// keyboard users, not for the focus a tap or a sheet opening moves around.
let lastInput: "key" | "pointer" = "pointer";
if (Platform.OS === "web" && typeof window !== "undefined") {
  // These run before the tip layer's own listeners, which are added later.
  window.addEventListener(
    "keydown",
    () => {
      lastInput = "key";
      closed = undefined;
    },
    true,
  );
  window.addEventListener(
    "pointerdown",
    () => {
      lastInput = "pointer";
      closed = undefined;
    },
    true,
  );
}
/** Press and hold is for touch screens; a mouse has hover, and a slow click still clicks. */
const touchScreen =
  Platform.OS !== "web" ||
  (typeof window !== "undefined" && !!window.matchMedia?.("(hover: none)").matches);

/** How long a tip from press and hold stays, and how long a mouse rests before one shows. */
const HOLD_SHOWS = 2500;
const HOVER_WAIT = 350;

/**
 * Props for a `Pressable` that give it a tip. Pass the Pressable's own handlers of the same names
 * as `own`, so both run. On a touch screen, press and hold shows the tip instead of pressing the
 * control; `hold: false` leaves that out, for controls where a slow press must still press (Send).
 */
export function tipProps(
  text: string,
  own: {
    onHoverIn?: (event: never) => void;
    onHoverOut?: (event: never) => void;
    onFocus?: (event: never) => void;
    onBlur?: (event: never) => void;
    onPressIn?: (event: GestureResponderEvent) => void;
  } = {},
  { hold = true }: { hold?: boolean } = {},
) {
  const holdTip = (event: GestureResponderEvent) =>
    measure(targetOf(event), (rect) => showTip({ text, rect }, { hideAfter: HOLD_SHOWS }));
  return {
    onHoverIn: (event: unknown) => {
      own.onHoverIn?.(event as never);
      measure(targetOf(event), (rect) => showTip({ text, rect }, { delay: HOVER_WAIT }));
    },
    onHoverOut: (event: unknown) => {
      own.onHoverOut?.(event as never);
      leaveTip();
    },
    onFocus: (event: unknown) => {
      own.onFocus?.(event as never);
      const target = targetOf(event) as Measurable | undefined;
      if (Platform.OS === "web" && lastInput === "key" && target?.matches?.(":focus-visible"))
        measure(target, (rect) => showTip({ text, rect }, {}));
    },
    onBlur: (event: unknown) => {
      own.onBlur?.(event as never);
      if (!current?.sticky) hideTip();
    },
    onPressIn: (event: GestureResponderEvent) => {
      own.onPressIn?.(event);
      if (!current?.sticky) hideTip();
    },
    ...(hold && touchScreen ? { onLongPress: holdTip, delayLongPress: 700 } : {}),
  };
}

/** For a control whose press is the tip itself (an ⓘ): opens the tip to stay, or closes it. */
export function toggleTip(text: string, event: GestureResponderEvent) {
  if (closed === text) return;
  if (current?.text === text && current.sticky) return hideTip();
  measure(targetOf(event), (rect) => showTip({ text, rect, sticky: true }, {}));
}
