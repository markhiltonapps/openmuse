import { useEffect, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from "react-native-svg";
import type { ActivityKind } from "./activity";

/** A frame counter for small looping drawings. */
function useFrame(interval: number) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((n) => n + 1), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return frame;
}

/** Laptop with lines being typed: apps and the computer. */
function Laptop({ terminal }: { terminal: boolean }) {
  const frame = useFrame(140);
  const typed = frame % 30;
  // Three lines, typed one after another, 10 frames each.
  const full = [19, 15, 17];
  const widths = full.map((w, i) => (Math.max(0, Math.min(typed - i * 10, 10)) / 10) * w);
  const line = Math.min(2, Math.floor(typed / 10));
  const ink = terminal ? "#7CF0A8" : "#6C8FD8";
  return (
    <>
      <Rect x="5" y="6" width="30" height="20" rx="2.5" fill="#3A4150" />
      <Rect x="7" y="8" width="26" height="16" rx="1.5" fill={terminal ? "#1B2230" : "#EEF4FF"} />
      {widths.map((width, i) => (
        <Rect
          key={full[i]}
          x="9.5"
          y={10.5 + i * 4.3}
          width={Math.max(0.1, width)}
          height="2"
          rx="1"
          fill={ink}
        />
      ))}
      {frame % 4 < 2 && (
        <Rect
          x={10 + (widths[line] ?? 0)}
          y={10.2 + line * 4.3}
          width="1.4"
          height="2.6"
          fill={ink}
        />
      )}
      <Path d="M2 27 H38 L35 33 H5 Z" fill="#9AA3B2" />
      <Rect x="16" y="28.2" width="8" height="1.6" rx="0.8" fill="#6E7788" />
    </>
  );
}

function Magnifier() {
  const frame = useFrame(90);
  const t = (frame % 40) / 40;
  // Sweeps across the page without leaving the drawing.
  const dx = Math.cos(t * Math.PI * 2) * 4 - 2.5;
  const dy = Math.sin(t * Math.PI * 2) * 3 - 1.5;
  return (
    <>
      <Rect
        x="4"
        y="6"
        width="26"
        height="30"
        rx="3"
        fill="#FFFFFF"
        stroke="#D5DAE1"
        strokeWidth="1.2"
      />
      {[12, 17, 22, 27].map((y) => (
        <Rect key={y} x="8" y={y} width={y === 27 ? 11 : 18} height="2" rx="1" fill="#C9D0DA" />
      ))}
      <G transform={`translate(${dx} ${dy})`}>
        <Line
          x1="27"
          y1="27"
          x2="35"
          y2="35"
          stroke="#5B4636"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <Circle
          cx="21"
          cy="21"
          r="8"
          fill="#DDF1FF"
          fillOpacity="0.75"
          stroke="#3E6FB0"
          strokeWidth="2.6"
        />
        <Path
          d="M16.5 18.5 Q18 15.5 21 15"
          stroke="#FFFFFF"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
      </G>
    </>
  );
}

function Globe() {
  const frame = useFrame(80);
  const t = (frame % 48) / 48;
  const meridians = [0, 1 / 3, 2 / 3].map((offset) => ({
    offset,
    rx: Math.cos(((t + offset) % 1) * Math.PI) * 13,
  }));
  return (
    <>
      <Circle cx="20" cy="20" r="14" fill="#7EC3F0" />
      <Path
        d="M11 13 Q15 10 18 14 Q16 18 12 18 Z M22 22 Q27 19 30 24 Q27 30 23 28 Z M20 8 Q24 9 25 12 Q22 13 20 11 Z"
        fill="#7DCB8F"
      />
      {meridians.map(({ offset, rx }) => (
        <Ellipse
          key={offset}
          cx="20"
          cy="20"
          rx={Math.abs(rx)}
          ry="14"
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity="0.7"
          strokeWidth="1"
        />
      ))}
      <Line x1="6" y1="20" x2="34" y2="20" stroke="#FFFFFF" strokeOpacity="0.7" strokeWidth="1" />
      <Circle cx="20" cy="20" r="14" fill="none" stroke="#3E86C4" strokeWidth="1.6" />
    </>
  );
}

function Page() {
  const frame = useFrame(110);
  const row = frame % 6;
  return (
    <>
      <Path d="M8 4 H26 L33 11 V36 H8 Z" fill="#FFFFFF" stroke="#D5DAE1" strokeWidth="1.2" />
      <Path d="M26 4 V11 H33" fill="#EEF1F5" stroke="#D5DAE1" strokeWidth="1.2" />
      {[14, 18.5, 23, 27.5, 32].map((y, i) => (
        <Rect
          key={y}
          x="11.5"
          y={y}
          width={i === 4 ? 10 : 17}
          height="2"
          rx="1"
          fill={i === row ? "#F2B84B" : "#C9D0DA"}
        />
      ))}
      {row < 5 && (
        <Rect
          x="10"
          y={13 + row * 4.5}
          width="20.5"
          height="4"
          rx="1.5"
          fill="#FFE08A"
          fillOpacity="0.45"
        />
      )}
    </>
  );
}

function Envelope() {
  const frame = useFrame(120);
  const lift = Math.sin(((frame % 20) / 20) * Math.PI * 2) * 1.5;
  return (
    <G transform={`translate(0 ${lift})`}>
      <Rect
        x="4"
        y="11"
        width="32"
        height="21"
        rx="3"
        fill="#FFFFFF"
        stroke="#C8D0DC"
        strokeWidth="1.2"
      />
      <Path
        d="M5 12.5 L20 23 L35 12.5"
        fill="none"
        stroke="#9DB0C8"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <Circle cx="33" cy="11" r="4.2" fill="#FF7A6B" />
    </G>
  );
}

function Pencil() {
  const frame = useFrame(100);
  const t = frame % 24;
  const x = 9 + (t % 12) * 1.6;
  const y = t < 12 ? 16 : 23;
  return (
    <>
      <Rect
        x="5"
        y="7"
        width="26"
        height="29"
        rx="3"
        fill="#FFFDF5"
        stroke="#E4DCC4"
        strokeWidth="1.2"
      />
      <Rect x="9" y="15" width={t < 12 ? x - 9 : 19} height="1.8" rx="0.9" fill="#8A93A6" />
      {t >= 12 && <Rect x="9" y="22" width={x - 9} height="1.8" rx="0.9" fill="#8A93A6" />}
      <G transform={`translate(${x} ${y}) rotate(-40)`}>
        <Rect x="0" y="-2.2" width="14" height="4.4" rx="1" fill="#F6C343" />
        <Rect x="11.5" y="-2.2" width="3" height="4.4" rx="0.8" fill="#F29BA6" />
        <Path d="M0 -2.2 L-4 0 L0 2.2 Z" fill="#E9CDA0" />
        <Path d="M-2.6 -0.8 L-4 0 L-2.6 0.8 Z" fill="#3A3A3A" />
      </G>
    </>
  );
}

function Checklist() {
  const frame = useFrame(380);
  const done = frame % 5;
  return (
    <>
      <Rect
        x="6"
        y="5"
        width="28"
        height="31"
        rx="3"
        fill="#FFFFFF"
        stroke="#D5DAE1"
        strokeWidth="1.2"
      />
      {[11, 19, 27].map((y, i) => (
        <G key={y}>
          <Rect
            x="10"
            y={y - 2.5}
            width="5"
            height="5"
            rx="1.2"
            fill={i < done ? "#5CC08A" : "#FFFFFF"}
            stroke={i < done ? "#5CC08A" : "#AEB6C2"}
            strokeWidth="1.1"
          />
          {i < done && (
            <Path
              d={`M11 ${y} L12.5 ${y + 1.4} L14.3 ${y - 1.2}`}
              stroke="#FFFFFF"
              strokeWidth="1.3"
              fill="none"
              strokeLinecap="round"
            />
          )}
          <Rect x="18" y={y - 1} width={i === 2 ? 9 : 12} height="2" rx="1" fill="#C9D0DA" />
        </G>
      ))}
    </>
  );
}

/** A small animated prop next to the avatar that matches what the agent is doing. */
export function ActivityProp({ kind, size }: { kind: ActivityKind; size: number }) {
  const art =
    kind === "apps" || kind === "computer" ? (
      <Laptop terminal={kind === "computer"} />
    ) : kind === "search" ? (
      <Magnifier />
    ) : kind === "browse" ? (
      <Globe />
    ) : kind === "read" ? (
      <Page />
    ) : kind === "mail" ? (
      <Envelope />
    ) : kind === "writing" ? (
      <Pencil />
    ) : kind === "plan" ? (
      <Checklist />
    ) : null;
  if (!art) return null;
  const box = size * 0.52;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        right: -size * 0.2,
        bottom: -size * 0.06,
        width: box,
        height: box,
      }}
    >
      <Svg width={box} height={box} viewBox="0 0 40 40">
        {art}
      </Svg>
    </View>
  );
}
