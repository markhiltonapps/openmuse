// Built-in agent characters as small SVGs. Eyes carry class "eye" so they can blink; see blinkStyle.
export type CharacterId = "capybara" | "fox" | "cat" | "panda" | "owl" | "robot" | "spark";
export const CHARACTERS: { id: CharacterId; label: string }[] = [
  { id: "capybara", label: "Capybara" },
  { id: "fox", label: "Fox" },
  { id: "cat", label: "Cat" },
  { id: "panda", label: "Panda" },
  { id: "owl", label: "Owl" },
  { id: "robot", label: "Robot" },
  { id: "spark", label: "Spark" },
];

const eyes = (left: number, right: number, y: number, rx = 4.2, ry = 5.2, color = "#2B2B33") =>
  [left, right]
    .map(
      (x) =>
        `<g class="eye"><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${color}"/><circle cx="${x + rx * 0.35}" cy="${y - ry * 0.4}" r="${rx * 0.34}" fill="#fff"/></g>`,
    )
    .join("");
const blush = (left: number, right: number, y: number) =>
  `<ellipse cx="${left}" cy="${y}" rx="5.5" ry="3.2" fill="#FF8FA3" opacity=".4"/><ellipse cx="${right}" cy="${y}" rx="5.5" ry="3.2" fill="#FF8FA3" opacity=".4"/>`;

export const ART: Record<Exclude<CharacterId, "capybara">, string> = {
  fox: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="fx" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7A75E"/><stop offset="1" stop-color="#E4793A"/></linearGradient></defs><path d="M21 50 L24 13 Q27 9 47 31 Z" fill="url(#fx)"/><path d="M79 50 L76 13 Q73 9 53 31 Z" fill="url(#fx)"/><path d="M27 40 L28.5 20 L40 32 Z" fill="#FFE9D6"/><path d="M73 40 L71.5 20 L60 32 Z" fill="#FFE9D6"/><path d="M50 27 C75 27 87 43 85 60 C83 77 67 89 50 91 C33 89 17 77 15 60 C13 43 25 27 50 27 Z" fill="url(#fx)"/><path d="M15 60 C24 64 37 66 44 75 C47 80 48 85 50 91 C33 89 18 78 15 60 Z" fill="#FFF7EE"/><path d="M85 60 C76 64 63 66 56 75 C53 80 52 85 50 91 C67 89 82 78 85 60 Z" fill="#FFF7EE"/>${eyes(37, 63, 56)}${blush(27, 73, 67)}<ellipse cx="50" cy="73" rx="4.2" ry="3.1" fill="#2B2B33"/><path d="M46 78 Q50 81.5 54 78" stroke="#2B2B33" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`,
  cat: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="ct" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9CED6"/><stop offset="1" stop-color="#A7AEB9"/></linearGradient></defs><path d="M18 52 L20 16 Q22 12 44 30 Z" fill="url(#ct)"/><path d="M82 52 L80 16 Q78 12 56 30 Z" fill="url(#ct)"/><path d="M24 42 L25 22 L38 32 Z" fill="#F6B8C4"/><path d="M76 42 L75 22 L62 32 Z" fill="#F6B8C4"/><ellipse cx="50" cy="60" rx="36" ry="31" fill="url(#ct)"/><path d="M44 31 L46 40 M50 30 L50 40 M56 31 L54 40" stroke="#8E95A1" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="50" cy="74" rx="15" ry="11" fill="#EEF0F3"/>${eyes(36, 64, 58, 4.4, 5.6, "#3A4A3A")}${blush(26, 74, 69)}<path d="M47.5 69.5 L52.5 69.5 L50 72.5 Z" fill="#F08DA0"/><path d="M50 72.5 Q47 77 44 75 M50 72.5 Q53 77 56 75" stroke="#5B6270" stroke-width="1.4" fill="none" stroke-linecap="round"/><path d="M10 66 L28 69 M10 73 L28 72 M90 66 L72 69 M90 73 L72 72" stroke="#7C8390" stroke-width="1.1" stroke-linecap="round"/></svg>`,
  panda: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="23" cy="30" r="12" fill="#2E2E36"/><circle cx="77" cy="30" r="12" fill="#2E2E36"/><ellipse cx="50" cy="58" rx="37" ry="33" fill="#FBFBFD"/><ellipse cx="50" cy="58" rx="37" ry="33" fill="none" stroke="#E6E7EC" stroke-width="1.5"/><ellipse cx="35" cy="55" rx="9" ry="11.5" transform="rotate(-28 35 55)" fill="#2E2E36"/><ellipse cx="65" cy="55" rx="9" ry="11.5" transform="rotate(28 65 55)" fill="#2E2E36"/>${eyes(36, 64, 55, 3.2, 3.8, "#FFFFFF").replace(/fill="#fff"/g, 'fill="#2E2E36"')}${blush(27, 73, 72)}<ellipse cx="50" cy="69" rx="5" ry="3.6" fill="#2E2E36"/><path d="M45 75 Q50 79 55 75" stroke="#2E2E36" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`,
  owl: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="ow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B48462"/><stop offset="1" stop-color="#8E6446"/></linearGradient></defs><path d="M22 34 L20 12 L38 26 Z" fill="#8E6446"/><path d="M78 34 L80 12 L62 26 Z" fill="#8E6446"/><path d="M50 20 C76 20 86 40 86 60 C86 80 70 93 50 93 C30 93 14 80 14 60 C14 40 24 20 50 20 Z" fill="url(#ow)"/><path d="M50 58 C66 58 72 72 70 82 C66 90 58 93 50 93 C42 93 34 90 30 82 C28 72 34 58 50 58 Z" fill="#E9D3BC"/><path d="M40 72 q3 3 6 0 M54 72 q3 3 6 0 M47 80 q3 3 6 0" stroke="#C4A383" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="35" cy="47" r="13" fill="#FFF8EE"/><circle cx="65" cy="47" r="13" fill="#FFF8EE"/>${eyes(35, 65, 47, 5.6, 6.2)}<path d="M50 52 L55 58 L50 64 L45 58 Z" fill="#F2A541"/></svg>`,
  robot: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="rb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A9D4EA"/><stop offset="1" stop-color="#7DB4D3"/></linearGradient></defs><line x1="50" y1="12" x2="50" y2="26" stroke="#6C8FA6" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="11" r="5.5" fill="#FF8A65"/><rect x="8" y="46" width="9" height="20" rx="4" fill="#6C8FA6"/><rect x="83" y="46" width="9" height="20" rx="4" fill="#6C8FA6"/><rect x="15" y="25" width="70" height="62" rx="20" fill="url(#rb)"/><rect x="23" y="36" width="54" height="40" rx="13" fill="#1F2B45"/><g class="eye"><rect x="33" y="45" width="10" height="13" rx="5" fill="#7CF0E0"/></g><g class="eye"><rect x="57" y="45" width="10" height="13" rx="5" fill="#7CF0E0"/></g><path d="M41 65 Q50 71 59 65" stroke="#7CF0E0" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="29" cy="68" r="3" fill="#FF8FA3" opacity=".55"/><circle cx="71" cy="68" r="3" fill="#FF8FA3" opacity=".55"/></svg>`,
  spark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="sp" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#FFE3F1"/><stop offset=".55" stop-color="#C9B6FF"/><stop offset="1" stop-color="#8FA8FF"/></radialGradient></defs><path d="M50 10 C58 26 86 36 86 62 C86 80 70 92 50 92 C30 92 14 80 14 62 C14 36 42 26 50 10 Z" fill="url(#sp)"/><path d="M76 20 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5 Z" fill="#FFD66B"/><path d="M22 30 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5 Z" fill="#FFFFFF" opacity=".9"/>${eyes(39, 61, 60, 4, 5.4, "#35306B")}${blush(30, 70, 70)}<path d="M44 71 Q50 76 56 71" stroke="#35306B" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
};

/** Blinking for SVG avatars shown as images; each eye closes briefly every few seconds. */
export const blinkStyle = `<style>.eye{transform-box:fill-box;transform-origin:center;animation:blink 4.6s infinite}@keyframes blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.12)}}@media (prefers-reduced-motion:reduce){.eye{animation:none}}</style>`;

/** An SVG string with the blink style added, ready for an image data URL. */
export function animatedSvg(svg: string) {
  return svg.replace(/<svg([^>]*)>/, `<svg$1>${blinkStyle}`);
}
export function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(animatedSvg(svg))}`;
}
