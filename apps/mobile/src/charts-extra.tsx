import { useState } from "react";
import { type LayoutChangeEvent, Platform, Pressable, View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import { TargetKey } from "./charts";
import { measure, showTip, tipProps } from "./tips";
import { colors } from "./ui";

/**
 * Chart kinds charts.tsx doesn't have, in the same look: one blue for the data, numbers in text
 * colours, quiet solid grid lines, and a tip for every point (hover, or tap on a phone). A chart
 * is one image to a screen reader, named with its numbers; a table sits beside it.
 */

/** The app's own type for SVG text: on the web, SVG text falls back to a serif font otherwise. */
const CHART_FONT =
  Platform.OS === "web"
    ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    : undefined;

/** A rounded axis step: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(raw: number) {
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((n) => n * power >= raw) ?? 10) * power;
}

export interface Point {
  key: string;
  /** When, in milliseconds: points sit along the line by time. */
  at: number;
  value: number;
  /** The tip: "Sep 29, 3:15 PM: $45.50". */
  tip: string;
}

/**
 * A line through values over time, such as a price at each check, with an optional target line.
 * The axis fits the values rather than starting at zero, so small moves show.
 */
export function LineChart({
  points,
  label,
  format = (value) => value.toLocaleString(),
  when,
  target,
  targetLabel,
  height = 170,
}: {
  /** Oldest first. */
  points: Point[];
  /** What a screen reader hears first: "Price at each check". */
  label: string;
  format?: (value: number) => string;
  /** The date under the line's ends: "Sep 29". */
  when: (at: number) => string;
  target?: number;
  /** Beside the target line: "Your price $50.00". */
  targetLabel?: string;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number>();
  if (!points.length) return null;
  const values = points.map((p) => p.value);
  const low = Math.min(...values, target ?? Number.POSITIVE_INFINITY);
  const high = Math.max(...values, target ?? 0);
  const step = niceStep((high - low || Math.max(high, 1) * 0.1) / 4);
  const min = Math.max(0, Math.floor(low / step) * step);
  const max = Math.max(Math.ceil(high / step) * step, min + step);
  const ticks = Array.from(
    { length: Math.round((max - min) / step) + 1 },
    (_, i) => min + i * step,
  );
  // Whole steps need no cents on the axis ("$260", not "$260.00"), which leaves the line more room.
  const tickText = (value: number) =>
    step >= 1 ? format(value).replace(/\.00(?=\D*$)/, "") : format(value);
  // Room on the left for the longest number on the axis.
  const left = Math.max(...ticks.map((t) => tickText(t).length)) * 6.6 + 10;
  const right = 10;
  const top = 12;
  const bottom = 24;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = height - top - bottom;
  const first = points[0] as Point;
  const last = points.at(-1) as Point;
  const span = last.at - first.at;
  const x = (at: number) =>
    left + (span > 0 ? ((at - first.at) / span) * plotWidth : plotWidth / 2);
  const y = (value: number) => top + plotHeight - ((value - min) / (max - min)) * plotHeight;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.at)},${y(p.value)}`).join(" ");
  // Every point marked while there's room; with many, only the latest and the one pointed at.
  const dots = points.length <= 24;
  const lowest = points.reduce((a, b) => (b.value < a.value ? b : a));
  const highest = points.reduce((a, b) => (b.value > a.value ? b : a));
  const spoken = `${label}, ${when(first.at)} to ${when(last.at)}: latest ${format(last.value)}, lowest ${format(lowest.value)} on ${when(lowest.at)}, highest ${format(highest.value)} on ${when(highest.at)}.${target !== undefined && targetLabel ? ` ${targetLabel}.` : ""}`;
  const shown = active === undefined ? undefined : points[active];
  const chart = (
    <View
      role="img"
      aria-label={spoken}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      style={{ height }}
    >
      {width > 0 && (
        <Svg width={width} height={height}>
          {ticks.map((tick) => (
            <Line
              key={`grid-${tick}`}
              x1={left}
              x2={width - right}
              y1={y(tick)}
              y2={y(tick)}
              stroke={colors.line}
              strokeWidth={1}
            />
          ))}
          {ticks.map((tick) => (
            <SvgText
              key={`tick-${tick}`}
              x={left - 8}
              y={y(tick) + 4}
              fontSize={11}
              fontFamily={CHART_FONT}
              fill={colors.mutedStrong}
              textAnchor="end"
            >
              {tickText(tick)}
            </SvgText>
          ))}
          {target !== undefined && (
            <Line
              x1={left}
              x2={width - right}
              y1={y(target)}
              y2={y(target)}
              stroke={colors.edge}
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
          )}
          <SvgText
            x={span > 0 ? left : x(first.at)}
            y={height - 6}
            fontSize={11}
            fontFamily={CHART_FONT}
            fill={colors.mutedStrong}
            textAnchor={span > 0 ? "start" : "middle"}
          >
            {when(first.at)}
          </SvgText>
          {span > 0 && when(last.at) !== when(first.at) && (
            <SvgText
              x={width - right}
              y={height - 6}
              fontSize={11}
              fontFamily={CHART_FONT}
              fill={colors.mutedStrong}
              textAnchor="end"
            >
              {when(last.at)}
            </SvgText>
          )}
          {shown && (
            <Line
              x1={x(shown.at)}
              x2={x(shown.at)}
              y1={top}
              y2={top + plotHeight}
              stroke={colors.edge}
              strokeWidth={1}
            />
          )}
          <Path
            d={line}
            stroke={colors.blueDark}
            strokeWidth={2}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.map((p, i) =>
            dots || i === points.length - 1 || i === active ? (
              <Circle
                key={p.key}
                cx={x(p.at)}
                cy={y(p.value)}
                r={i === active || i === points.length - 1 ? 5 : 4}
                fill={colors.blueDark}
                stroke={colors.card}
                strokeWidth={2}
              />
            ) : null,
          )}
        </Svg>
      )}
      {/* The nearest point answers wherever the pointer is: each point owns the stretch around it. */}
      {width > 0 &&
        points.map((p, i) => {
          const before = points[i - 1];
          const after = points[i + 1];
          const from = before ? (x(before.at) + x(p.at)) / 2 : 0;
          const to = after ? (x(p.at) + x(after.at)) / 2 : width;
          const tip = tipProps(p.tip, { onHoverOut: () => setActive(undefined) });
          // The tip points at the point itself, like a bar's, not the top of its stretch.
          const show = (target: unknown, hideAfter?: number) =>
            measure(target, (rect) =>
              showTip(
                {
                  text: p.tip,
                  rect: {
                    x: rect.x + x(p.at) - from - 5,
                    y: rect.y + y(p.value) - 5,
                    width: 10,
                    height: 10,
                  },
                },
                { hideAfter },
              ),
            );
          return (
            <Pressable
              key={p.key}
              // Not a keyboard stop: the chart is one image, and Recent checks lists every point.
              focusable={false}
              tabIndex={-1}
              {...tip}
              onHoverIn={(event) => {
                setActive(i);
                show(event.currentTarget);
              }}
              onLongPress={(event) => show(event.currentTarget, 2500)}
              // A tap shows the tip on a phone, where there's no mouse to rest on the line.
              onPress={(event) => {
                setActive(i);
                show(event.currentTarget, 2500);
              }}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: from,
                width: Math.max(1, to - from),
              }}
            />
          );
        })}
    </View>
  );
  if (target === undefined || !targetLabel) return chart;
  // The target line's name sits under the chart, where the line can never run through it.
  return (
    <View style={{ gap: 6 }}>
      {chart}
      <TargetKey label={targetLabel} indent={left} />
    </View>
  );
}
