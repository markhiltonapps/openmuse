import { Appearance, Platform } from "react-native";
import { DEFAULT_BACKDROP, NO_BACKDROP } from "../../../packages/domain/src/backdrops";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "openmuse.theme";

export function themeChoice(): ThemeChoice {
  try {
    const saved = globalThis.localStorage?.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}
/** Saves the choice and reloads, since the app's styles are made once when it opens. */
export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") globalThis.localStorage?.removeItem(KEY);
    else globalThis.localStorage?.setItem(KEY, choice);
  } catch {
    // Private browsing: nothing to save.
  }
  if (Platform.OS === "web" && typeof window !== "undefined") window.location.reload();
}
const BACKDROP_KEY = "openmuse.backdrop";
/**
 * The backdrop scene this device last knew (the server's choice, kept so the app opens straight
 * into it). A new device starts on the beach, like a new account.
 */
export function savedBackdrop(): string {
  try {
    return globalThis.localStorage?.getItem(BACKDROP_KEY) || DEFAULT_BACKDROP;
  } catch {
    return DEFAULT_BACKDROP;
  }
}
export function rememberBackdrop(scene: string) {
  try {
    globalThis.localStorage?.setItem(BACKDROP_KEY, scene);
  } catch {
    // Private browsing: the server still knows.
  }
}
/** The scene the app opened with. Turning the backdrop on or off takes a reload (styles are made once). */
export const openedWithBackdrop = savedBackdrop();
/**
 * A backdrop is on (web only, where the video plays): the see-through glass look, always dark,
 * whatever the theme (owner, 2026-10-09: "backdrop wins").
 */
export const glass = Platform.OS === "web" && openedWithBackdrop !== NO_BACKDROP;

const choice = themeChoice();
/** Dark when the person chose it, or when their device is set to dark and they left it on automatic. */
export const dark =
  glass || choice === "dark" || (choice === "system" && Appearance.getColorScheme() === "dark");

const light = {
  canvas: "#FCFCFC",
  card: "#FFFFFF",
  text: "#11191C",
  muted: "#697176",
  /** Small grey text on tinted surfaces, where muted falls short of AA. */
  mutedStrong: "#565E63",
  line: "#EEEEF0",
  /** The edge of a small control that must stand out from the card, such as a colour swatch. */
  edge: "#8A9196",
  blue: "#C8E7FF",
  blueDark: "#1473C8",
  /** Small blue text on grey or sky tiles: blueDark is a touch light for it in light mode. */
  blueText: "#1269B8",
  sky: "#EDF7FD",
  green: "#E3F3E8",
  greenDark: "#189A58",
  /** Green text on the page or a card: greenDark is too light for text in light mode. */
  greenText: "#147A45",
  lavender: "#F0EEFA",
  orange: "#FDF0DF",
  danger: "#AA4A45",
  /** Inputs, the tab bar and round buttons. */
  surface: "#FFFFFF",
  /** Secondary buttons, pressed rows and the selected tab. */
  subtle: "#F1F2F3",
  /** The agent's chat bubbles and tool cards. */
  bubble: "#EEEEF0",
  /** A dividing line inside a chat bubble (line is the bubble's own colour in light mode). */
  bubbleLine: "#D6D8DB",
  errorBg: "#FBEFED",
  /** Toasts and checked boxes: the opposite of the page. */
  inverse: "#11191C",
  onInverse: "#FFFFFF",
  /** "Live" on the inverse (a call's ring on its bar): the other theme's green. */
  liveOnInverse: "#2BD46E",
  /** A quiet fill on the inverse (the call bar's Mute and its See it row). */
  onInverseSubtle: "rgba(128,128,128,0.27)",
  shade: "rgba(35,48,44,0.25)",
};
const night: typeof light = {
  canvas: "#000000",
  card: "#151517",
  text: "#F3F3F5",
  muted: "#9C9CA3",
  mutedStrong: "#ADADB4",
  line: "#26262A",
  edge: "#77777F",
  blue: "#1C4E7D",
  blueDark: "#55AAFF",
  blueText: "#55AAFF",
  sky: "#0E2130",
  green: "#0F2619",
  greenDark: "#2BD46E",
  greenText: "#2BD46E",
  lavender: "#1C1930",
  orange: "#2B2012",
  danger: "#FF8F85",
  surface: "#1C1C1F",
  subtle: "#2A2A2E",
  bubble: "#1C1C1F",
  bubbleLine: "#2E2E33",
  errorBg: "#3A1D1B",
  inverse: "#F3F3F5",
  onInverse: "#000000",
  liveOnInverse: "#189A58",
  onInverseSubtle: "rgba(128,128,128,0.27)",
  shade: "rgba(0,0,0,0.6)",
};
/**
 * Night, see-through: cards and bars let the moving backdrop show around their text. Dense enough
 * (about 80%) that text keeps its contrast over the brightest scene, after the backdrop's own shade.
 */
const glassNight: typeof light = {
  ...night,
  card: "rgba(22,19,30,0.8)",
  surface: "rgba(30,27,40,0.82)",
  bubble: "rgba(30,27,40,0.82)",
  // Light text stands on these fills, so they're a dark tint, not a white haze.
  subtle: "rgba(40,36,52,0.72)",
  line: "rgba(255,255,255,0.14)",
  // Small grey text often sits right on the scene: lighter than night's, for contrast.
  muted: "#B4B4BC",
  mutedStrong: "#C4C4CB",
  bubbleLine: "rgba(255,255,255,0.18)",
  sky: "rgba(22,60,96,0.72)",
  green: "rgba(15,40,26,0.78)",
  lavender: "rgba(30,26,52,0.78)",
  orange: "rgba(46,33,17,0.78)",
  errorBg: "rgba(62,29,27,0.86)",
};
export const palette = glass ? glassNight : dark ? night : light;
/** Behind the screens: the page colour, or nothing when the backdrop shows through. */
export const page = glass ? "transparent" : palette.canvas;

// The page behind the app, so there's no white flash or white edges on dark.
if (Platform.OS === "web" && typeof document !== "undefined") {
  document.documentElement.style.backgroundColor = palette.canvas;
  document.body.style.backgroundColor = palette.canvas;
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", palette.canvas);
}
