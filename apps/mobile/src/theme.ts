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
 * into it). A new device starts with no backdrop, on the cream look, like a new account.
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

/**
 * Neddy's own colours (owner, 2026-11-07): the cream of his shell for the page, the teal of his
 * band for the one accent, the amber of his eyes only for what needs the person, and the night
 * blue of his visor for dark mode. The token names stay ("blue" is the accent).
 */
const light = {
  canvas: "#F8F3EA",
  card: "#FFFDF9",
  text: "#1B2430",
  muted: "#6B7480",
  /** Small grey text on tinted surfaces, where muted falls short of AA. */
  mutedStrong: "#525B66",
  line: "#E6E0D4",
  /** The edge of a small control that must stand out from the card, such as a colour swatch. */
  edge: "#8B9492",
  /** The accent's tint (a selected chip, a pill): Neddy's teal, light. */
  blue: "#D4ECE8",
  /** The accent: Neddy's teal. */
  blueDark: "#2A6C66",
  /** Small accent text on grey or cream tiles. */
  blueText: "#24605A",
  sky: "#EDF6F3",
  green: "#E3F3E8",
  greenDark: "#189A58",
  /** Green text on the page or a card: greenDark is too light for text in light mode. */
  greenText: "#147A45",
  lavender: "#F2ECE0",
  orange: "#FBEFD8",
  /** Neddy's amber: the count on his picture, and nothing else that isn't his. */
  amber: "#C7760F",
  amberText: "#9A6200",
  danger: "#AA4A45",
  /** Inputs, the tab bar and round buttons. */
  surface: "#FFFDF9",
  /** Secondary buttons, pressed rows and the selected tab. */
  subtle: "#F0EAE0",
  /** The agent's chat bubbles and tool cards. */
  bubble: "#F1ECE2",
  /** A dividing line inside a chat bubble (line is the bubble's own colour in light mode). */
  bubbleLine: "#DCD4C6",
  errorBg: "#FBEFED",
  /** Toasts and checked boxes: the opposite of the page. */
  inverse: "#1B2430",
  onInverse: "#FFFDF9",
  /** "Live" on the inverse (a call's ring on its bar): the other theme's green. */
  liveOnInverse: "#2BD46E",
  /** A quiet fill on the inverse (the call bar's Mute and its See it row). */
  onInverseSubtle: "rgba(128,128,128,0.27)",
  shade: "rgba(27,36,48,0.25)",
};
const night: typeof light = {
  canvas: "#0E131B",
  card: "#17202B",
  text: "#F3EFE6",
  muted: "#98A2AD",
  mutedStrong: "#B3BCC6",
  line: "#273240",
  edge: "#7A8591",
  blue: "#1F4A47",
  blueDark: "#5FC6BB",
  blueText: "#72D2C7",
  sky: "#13282A",
  green: "#0F2619",
  greenDark: "#2BD46E",
  greenText: "#2BD46E",
  lavender: "#232E3A",
  orange: "#3A2A14",
  amber: "#E89A2E",
  amberText: "#F6B55A",
  danger: "#FF8F85",
  surface: "#1B2430",
  subtle: "#263241",
  bubble: "#1B2430",
  bubbleLine: "#33404F",
  errorBg: "#3A1D1B",
  inverse: "#F3EFE6",
  onInverse: "#0E131B",
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
  sky: "rgba(20,56,54,0.72)",
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
