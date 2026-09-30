import { Appearance, Platform } from "react-native";

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
const choice = themeChoice();
/** Dark when the person chose it, or when their device is set to dark and they left it on automatic. */
export const dark =
  choice === "dark" || (choice === "system" && Appearance.getColorScheme() === "dark");

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
  errorBg: "#FBEFED",
  /** Toasts and checked boxes: the opposite of the page. */
  inverse: "#11191C",
  onInverse: "#FFFFFF",
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
  errorBg: "#3A1D1B",
  inverse: "#F3F3F5",
  onInverse: "#000000",
  shade: "rgba(0,0,0,0.6)",
};
export const palette = dark ? night : light;

// The page behind the app, so there's no white flash or white edges on dark.
if (Platform.OS === "web" && typeof document !== "undefined") {
  document.documentElement.style.backgroundColor = palette.canvas;
  document.body.style.backgroundColor = palette.canvas;
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", palette.canvas);
}
