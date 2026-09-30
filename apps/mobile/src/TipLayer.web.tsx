import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hideTip, holdTip, leaveTip, tapAway, useTip } from "./tips";
import { colors } from "./ui";

/** The app's own type (react-native-web's), since the page's body has none of its own. */
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const GAP = 8;
const EDGE = 8;

/**
 * Draws the tip in the page itself, above everything: sheets are a separate top layer on the web,
 * so a tip drawn inside the app would be hidden under them.
 */
export default function TipLayer() {
  const tip = useTip();
  const bubble = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number }>();
  // The Escape that closed a tip: a sheet closes on the key's release, so that's held back too.
  const swallow = useRef(false);
  useEffect(() => {
    const up = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !swallow.current) return;
      swallow.current = false;
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener("keyup", up, true);
    return () => window.removeEventListener("keyup", up, true);
  }, []);
  useEffect(() => {
    if (!tip) return;
    // Escape closes the tip only, not the sheet under it; this runs before the sheet sees the key.
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      hideTip();
      swallow.current = true;
      event.stopPropagation();
      event.preventDefault();
    };
    // A tip opened by a tap closes at the next tap anywhere (the ⓘ itself turns it off too).
    const tap = (event: PointerEvent) => {
      if (!bubble.current?.contains(event.target as Node)) tapAway();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", tap, true);
    window.addEventListener("scroll", hideTip, true);
    window.addEventListener("resize", hideTip);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", tap, true);
      window.removeEventListener("scroll", hideTip, true);
      window.removeEventListener("resize", hideTip);
    };
  }, [tip]);
  // Centred on the control and kept inside the window; above it, or below when there's no room.
  useLayoutEffect(() => {
    if (!tip || !bubble.current) return setPlace(undefined);
    const { offsetWidth: width, offsetHeight: height } = bubble.current;
    const centre = tip.rect.x + tip.rect.width / 2;
    const above = tip.rect.y - GAP - height >= EDGE;
    setPlace({
      left: Math.min(Math.max(centre - width / 2, EDGE), window.innerWidth - width - EDGE),
      top: above ? tip.rect.y - GAP - height : tip.rect.y + tip.rect.height + GAP,
    });
  }, [tip]);
  if (!tip || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={bubble}
      role="tooltip"
      // A mouse can move onto the tip to read it; it goes when the mouse leaves.
      onMouseEnter={holdTip}
      onMouseLeave={leaveTip}
      // A press on a hover tip is meant for what's under it (the message box under the voice
      // button's tip): the tip goes, and the press reaches that control.
      // It acts on release, like every other control: sliding off before letting go cancels.
      onPointerDown={(event) => {
        if (tip.sticky) return;
        event.preventDefault();
        const bubbleNode = bubble.current;
        if (bubbleNode) bubbleNode.style.display = "none";
        const control = (x: number, y: number) => {
          const node = document.elementFromPoint(x, y) as HTMLElement | null;
          return (
            node?.closest<HTMLElement>("input, textarea, [contenteditable=true]") ??
            node?.closest<HTMLElement>('button, a, [role="button"], [role="tab"], [role="radio"]')
          );
        };
        const pressed = control(event.clientX, event.clientY);
        hideTip();
        window.addEventListener(
          "pointerup",
          (up) => {
            if (!pressed || control(up.clientX, up.clientY) !== pressed) return;
            if (pressed.matches("input, textarea, [contenteditable=true]")) pressed.focus();
            else pressed.click();
          },
          { once: true },
        );
      }}
      style={{
        position: "fixed",
        zIndex: 2147483000,
        top: place?.top ?? -9999,
        left: place?.left ?? -9999,
        maxWidth: 260,
        padding: "6px 10px",
        borderRadius: 8,
        background: colors.inverse,
        color: colors.onInverse,
        font: `500 13px/18px ${FONT}`,
        boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        whiteSpace: "pre-line",
      }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
