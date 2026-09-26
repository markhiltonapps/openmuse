import { svgDataUrl } from "./avatar-art";

/** Shown as an image so the SVG's own blink animation runs and nothing in it can script. */
export default function SvgArt({ svg, size }: { svg: string; size: number }) {
  return (
    <img
      src={svgDataUrl(svg)}
      width={size}
      height={size}
      alt=""
      draggable={false}
      style={{ display: "block", width: size, height: size, userSelect: "none" }}
    />
  );
}
