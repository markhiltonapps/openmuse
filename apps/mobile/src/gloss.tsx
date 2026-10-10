import type React from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

/**
 * The glossy look from the backdrop mockup: a colour gradient with a soft shine on its top half,
 * filling its parent (which rounds it with `borderRadius` and `overflow: "hidden"`).
 */
export function GlossFill({
  id,
  from,
  to,
  shine = 0.4,
  angle = "down",
  radius,
}: {
  /** Unique on the page: SVG gradients are looked up by id. */
  id: string;
  from: string;
  to: string;
  /** How bright the shine is at the top. */
  shine?: number;
  /** "down" is top to bottom; "tilted" leans a little, like the bar's tiles. */
  angle?: "down" | "tilted";
  /** The parent's corner radius: with it, a fine light edge runs along the top, like glass. */
  radius?: number;
}) {
  const tilted = angle === "tilted";
  // An SVG id can't hold spaces or punctuation (a gradient named with them paints black).
  const key = id.replace(/[^A-Za-z0-9_-]/g, "-");
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient
            id={`${key}-base`}
            x1={tilted ? "0.4" : "0"}
            y1="0"
            x2={tilted ? "0.6" : "0"}
            y2="1"
          >
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
          <LinearGradient id={`${key}-shade`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.8" stopColor="#000000" stopOpacity={0} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0.18} />
          </LinearGradient>
          <LinearGradient id={`${key}-shine`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={shine} />
            <Stop offset="0.45" stopColor="#FFFFFF" stopOpacity={shine * 0.28} />
            <Stop offset="0.52" stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.06} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${key}-base)`} />
        <Rect width="100%" height="100%" fill={`url(#${key}-shine)`} />
        <Rect width="100%" height="100%" fill={`url(#${key}-shade)`} />
      </Svg>
      {radius !== undefined && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: radius,
            borderTopWidth: 1,
            borderTopColor: "rgba(255, 255, 255, 0.7)",
          }}
        />
      )}
    </View>
  );
}

/**
 * Something drawn over a GlossFill. On the web an absolutely placed layer paints over a later
 * sibling that isn't placed (such as an icon's SVG), so whatever goes on top is placed too.
 */
export function OnGloss({ children }: { children: React.ReactNode }) {
  return <View style={{ position: "relative" }}>{children}</View>;
}

/** The bar's tile colours, from the mockup. Ideas is a light tile, so its icon is dark. */
export const TILE_COLOURS: Record<string, { from: string; to: string; ink?: string }> = {
  home: { from: "#9db8ff", to: "#3e5bd6" },
  chat: { from: "#7cbcff", to: "#1f5fe0" },
  feed: { from: "#ffbe6e", to: "#e8591a" },
  spaces: { from: "#ff9bd0", to: "#b8327f" },
  activity: { from: "#73e6d2", to: "#0b8a7c" },
  ideas: { from: "#ffe789", to: "#f0a20f", ink: "#5a3100" },
  goals: { from: "#a6f28f", to: "#23963f" },
  files: { from: "#c2adff", to: "#6a3fd6" },
  apps: { from: "#d9dde6", to: "#5f6779" },
};
