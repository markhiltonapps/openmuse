import { type ReactNode, useRef, useState } from "react";
import { type LayoutChangeEvent, Pressable, Text, View } from "react-native";
import { measure, showTip, tipProps } from "./tips";
import { colors, InfoTip, s } from "./ui";

/**
 * Charts and tables for the app's data views, with one look everywhere: a single blue for the data
 * (blueDark passes 3:1 on light and dark cards), numbers in text colours, a quiet scale, and a tip
 * on every bar (hover, or tap on a phone). A chart is one image to a screen reader, named with its
 * numbers; a table sits beside it for anyone who'd rather read them.
 */

const numbers = { fontVariant: ["tabular-nums" as const] };

/** A rounded axis step: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(raw: number) {
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((n) => n * power >= raw) ?? 10) * power;
}

/** Under a chart: the dashed line's name, so the line never runs through its own label. */
export function TargetKey({ label, indent = 0 }: { label: string; indent?: number }) {
  return (
    <View aria-hidden style={[s.row, { gap: 8, paddingLeft: indent }]}>
      <View
        style={{ width: 20, borderTopWidth: 1.5, borderStyle: "dashed", borderColor: colors.edge }}
      />
      <Text style={[s.small, numbers, { fontSize: 12, color: colors.mutedStrong }]}>{label}</Text>
    </View>
  );
}

export interface Bar {
  key: string;
  /** Under the bar: "Mon". */
  label: string;
  /** Its row in the numbers table: "Monday, Sep 28"; the label when left out. */
  name?: string;
  value: number;
  /** The tip: "Monday, Sep 29: 1,850 calories". */
  tip: string;
  /** Today, or the one to point out: its label is bold and its number shows. */
  strong?: boolean;
  /** Nothing to count yet (a day still to come, or nothing logged): the numbers table shows "–". */
  missing?: boolean;
}

/** The scale's width on the left, and the room above the tallest bar for its number. */
const GUTTER = 38;
const HEADROOM = 18;

/** Bars from a baseline, one per day or month, with a faint scale and an optional target line. */
export function BarChart({
  bars,
  label,
  target,
  targetLabel,
  format = (value) => Math.round(value).toLocaleString(),
  short,
  valueTitle = "Amount",
  height = 132,
}: {
  bars: Bar[];
  /** What a screen reader hears before the numbers: "Calories by day this week". */
  label: string;
  target?: number;
  /** In the key under the chart: "Target 2,000". */
  targetLabel?: string;
  format?: (value: number) => string;
  /** A shorter form where there's little room, for the scale and narrow bars: "$171". */
  short?: (value: number) => string;
  /** The numbers table's value column, with its unit: "Protein (g)". */
  valueTitle?: string;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<string>();
  const compact = short ?? format;
  const highest = Math.max(...bars.map((bar) => bar.value), target ?? 0);
  const step = niceStep(highest / 3);
  const top = Math.max(step * Math.ceil((highest * 1.05) / step), step);
  const y = (value: number) => (value / top) * height;
  const plot = Math.max(width - GUTTER, 0);
  const column = bars.length ? plot / bars.length : 0;
  const barWidth = Math.max(6, Math.min(28, column * 0.56));
  const grid = Array.from({ length: Math.round(top / step) }, (_, index) => (index + 1) * step);
  // Crowded day or month names show every other one, always keeping the one to point out.
  const longest = Math.max(...bars.map((bar) => bar.label.length), 1);
  const thin = column > 0 && column < longest * 6.6 + 6;
  // Every other name, counted from the bold one (or the last), so its neighbours make room.
  const strongAt = bars.findIndex((bar) => bar.strong);
  const anchor = strongAt >= 0 ? strongAt : bars.length - 1;
  const spoken = `${label}. ${bars.map((bar) => bar.tip).join(". ")}.${target && targetLabel ? ` ${targetLabel}.` : ""}`;
  const chart = (
    <View
      role="img"
      aria-label={spoken}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
    >
      <View style={{ height: height + HEADROOM }}>
        {/* The scale, and the target under the bars. */}
        {grid.map((value) => (
          <View
            key={value}
            pointerEvents="none"
            style={{ position: "absolute", left: 0, right: 0, bottom: y(value) }}
          >
            <View style={{ marginLeft: GUTTER, height: 1, backgroundColor: colors.line }} />
            <Text
              numberOfLines={1}
              style={[
                s.small,
                numbers,
                {
                  position: "absolute",
                  left: 0,
                  width: GUTTER - 6,
                  bottom: -8,
                  textAlign: "right",
                  color: colors.mutedStrong,
                },
              ]}
            >
              {compact(value)}
            </Text>
          </View>
        ))}
        {target !== undefined && target > 0 && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: GUTTER,
              right: 0,
              bottom: y(target),
              borderTopWidth: 1.5,
              borderStyle: "dashed",
              borderColor: colors.edge,
            }}
          />
        )}
        <View
          style={{
            position: "absolute",
            left: GUTTER,
            right: 0,
            bottom: 0,
            top: 0,
            flexDirection: "row",
            alignItems: "flex-end",
          }}
        >
          {bars.map((bar) => {
            const tall = bar.value > 0 ? Math.max(y(bar.value), 3) : 0;
            // The tip sits at the bar's top (above its number, when it shows one), not the top
            // of its column.
            const reach = tall + (bar.strong && bar.value > 0 ? HEADROOM : 0);
            const show = (target: unknown, hideAfter?: number) =>
              measure(target, (rect) =>
                showTip(
                  {
                    text: bar.tip,
                    rect: { ...rect, y: rect.y + rect.height - reach, height: reach },
                  },
                  { hideAfter },
                ),
              );
            const tip = tipProps(bar.tip, { onHoverOut: () => setActive(undefined) });
            return (
              <Pressable
                key={bar.key}
                // Not a keyboard stop: the chart is one image, with its numbers in its name.
                focusable={false}
                tabIndex={-1}
                {...tip}
                onHoverIn={(event) => {
                  setActive(bar.key);
                  show(event.currentTarget);
                }}
                onLongPress={(event) => show(event.currentTarget, 2500)}
                // A tap shows the tip on a phone, where there's no mouse to rest on the bar.
                onPress={(event) => {
                  setActive(bar.key);
                  show(event.currentTarget, 2500);
                  setTimeout(() => setActive(undefined), 2500);
                }}
                style={{
                  flex: 1,
                  height: "100%",
                  alignItems: "center",
                  justifyContent: "flex-end",
                }}
              >
                {bar.strong && bar.value > 0 && (
                  <Text
                    style={[
                      s.small,
                      numbers,
                      {
                        position: "absolute",
                        bottom: tall + 2,
                        left: -40,
                        right: -40,
                        textAlign: "center",
                        color: colors.text,
                        fontWeight: "700",
                      },
                    ]}
                  >
                    <Text style={{ backgroundColor: colors.card }}>
                      {" "}
                      {column < 48 ? compact(bar.value) : format(bar.value)}{" "}
                    </Text>
                  </Text>
                )}
                <View
                  style={{
                    width: barWidth,
                    height: tall,
                    backgroundColor: colors.blueDark,
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    opacity: active && active !== bar.key ? 0.45 : 1,
                  }}
                />
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={{ marginLeft: GUTTER, height: 1, backgroundColor: colors.edge, opacity: 0.6 }} />
      <View style={{ flexDirection: "row", marginTop: 5, marginLeft: GUTTER }}>
        {bars.map((bar, index) => {
          // Thinned, each name that shows takes its hidden neighbours' room, centred on its bar.
          const shown = !thin || Math.abs(anchor - index) % 2 === 0;
          return (
            <View key={bar.key} style={{ flex: 1, alignItems: "center" }}>
              {/* The wider box is what the name can fill: react-native-web keeps one-line text
                  inside its parent. */}
              {shown && (
                <View style={{ width: thin ? column * 2 : column }}>
                  <Text
                    numberOfLines={1}
                    style={[
                      s.small,
                      {
                        textAlign: "center",
                        color: bar.strong ? colors.text : colors.mutedStrong,
                        fontWeight: bar.strong ? "700" : "400",
                      },
                    ]}
                  >
                    {bar.label}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
  return (
    <View style={{ gap: 8 }}>
      {chart}
      {!!target && !!targetLabel && <TargetKey label={targetLabel} indent={GUTTER} />}
      <NumbersTable bars={bars} label={label} format={format} valueTitle={valueTitle} />
    </View>
  );
}

/** The chart's numbers as a table, for anyone who'd rather read them than look. */
function NumbersTable({
  bars,
  label,
  format,
  valueTitle,
}: {
  bars: Bar[];
  label: string;
  format: (value: number) => string;
  valueTitle: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Pressable
        role="button"
        aria-expanded={open}
        // Two charts on one screen each have one, so the name says which.
        aria-label={`${open ? "Hide" : "Show"} the numbers: ${label}`}
        onPress={() => setOpen(!open)}
        style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}
      >
        <Text style={[s.small, { fontSize: 13, color: colors.blueText, fontWeight: "600" }]}>
          {open ? "Hide the numbers" : "Show the numbers"}
        </Text>
      </Pressable>
      {open && (
        <DataTable
          label={label}
          rows={bars}
          rowKey={(bar) => bar.key}
          columns={[
            { title: "When", flex: 2, render: (bar) => bar.name ?? bar.label },
            {
              title: valueTitle,
              align: "right",
              minWidth: 72,
              render: (bar) => (bar.missing ? "–" : format(bar.value)),
            },
          ]}
        />
      )}
    </View>
  );
}

export interface Column<T> {
  title: string;
  /** Numbers line up on the right, on one line. */
  align?: "left" | "right";
  /** Its share of the row's width; 1 when left out. */
  flex?: number;
  /** The narrowest it gets, in pixels: a number column keeps room for "1,250" or "Sep 28". */
  minWidth?: number;
  render: (row: T) => ReactNode;
  /**
   * On a narrow screen this column folds into a line under the first column's cell, as this text
   * ("Report · Sep 29"), instead of taking a column of its own.
   */
  fold?: (row: T) => string;
}

/** Below this width (the table's own, not the window's), columns with `fold` fold away. */
const NARROW = 360;
const GAP = 10;

/**
 * A plain table: a header row and one row per item, read as a table by a screen reader. It
 * measures itself, so each column gets a steady width in every row.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  footer,
  label,
}: {
  /** The table's name for a screen reader: "This month’s purchases". */
  label?: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Shown instead of the rows when there are none. */
  empty?: string;
  /** A totals row, drawn bold under the others, one entry per column. */
  footer?: ReactNode[];
}) {
  const [width, setWidth] = useState(0);
  const narrow = width > 0 && width < NARROW;
  const shown = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !(narrow && column.fold));
  const folded = narrow ? columns.filter((column) => column.fold) : [];
  // Widths in pixels once measured: shares by flex, each at least its minWidth.
  const widths = (() => {
    if (!width) return undefined;
    const room = width - GAP * (shown.length - 1);
    const flex = (column: Column<T>) => column.flex ?? 1;
    let fixed = 0;
    let share = shown.reduce((sum, { column }) => sum + flex(column), 0);
    const pinned = new Set<number>();
    // Columns whose share would fall under their minimum take the minimum; the rest share.
    for (let pass = 0; pass < shown.length; pass++) {
      let changed = false;
      for (const { column, index } of shown) {
        if (pinned.has(index) || !column.minWidth) continue;
        if (((room - fixed) * flex(column)) / share < column.minWidth) {
          pinned.add(index);
          fixed += column.minWidth;
          share -= flex(column);
          changed = true;
        }
      }
      if (!changed) break;
    }
    return new Map(
      shown.map(({ column, index }) => [
        index,
        pinned.has(index)
          ? (column.minWidth ?? 0)
          : Math.max(0, ((room - fixed) * flex(column)) / Math.max(share, 0.0001)),
      ]),
    );
  })();
  const size = (column: Column<T>, index: number) =>
    widths ? { width: widths.get(index) ?? 0 } : { flex: column.flex ?? 1 };
  const cell = (
    column: Column<T>,
    index: number,
    child: ReactNode,
    key: string,
    bold = false,
    under?: string,
  ) => (
    <View
      key={key}
      role="cell"
      style={{
        ...size(column, index),
        minWidth: 0,
        alignItems: column.align === "right" ? "flex-end" : "stretch",
      }}
    >
      {typeof child === "string" || typeof child === "number" ? (
        <Text
          numberOfLines={column.align === "right" ? 1 : undefined}
          style={[
            s.text,
            numbers,
            { fontSize: 14, lineHeight: 20, textAlign: column.align ?? "left" },
            bold && { fontWeight: "700" },
          ]}
        >
          {child}
        </Text>
      ) : (
        child
      )}
      {!!under && (
        <Text
          style={[s.small, numbers, { fontSize: 12, lineHeight: 17, color: colors.mutedStrong }]}
        >
          {under}
        </Text>
      )}
    </View>
  );
  const foldLine = (row: T) =>
    folded
      .map((column) => column.fold?.(row))
      .filter(Boolean)
      .join(" · ");
  return (
    <View>
      <View
        role="table"
        aria-label={label}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        <View
          role="row"
          style={[
            s.row,
            { gap: GAP, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
          ]}
        >
          {shown.map(({ column, index }) => (
            <View
              key={column.title}
              role="columnheader"
              style={{
                ...size(column, index),
                minWidth: 0,
                alignItems: column.align === "right" ? "flex-end" : "flex-start",
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: colors.mutedStrong,
                  fontSize: 12,
                  lineHeight: 16,
                  fontWeight: "600",
                }}
              >
                {column.title}
              </Text>
            </View>
          ))}
        </View>
        {rows.map((row) => (
          <View
            key={rowKey(row)}
            role="row"
            style={[
              s.row,
              {
                gap: GAP,
                paddingVertical: 9,
                borderBottomWidth: 1,
                borderBottomColor: colors.line,
                alignItems: "flex-start",
              },
            ]}
          >
            {shown.map(({ column, index }, place) =>
              cell(
                column,
                index,
                column.render(row),
                column.title,
                false,
                place === 0 ? foldLine(row) : undefined,
              ),
            )}
          </View>
        ))}
        {footer && rows.length > 0 && (
          <View role="row" style={[s.row, { gap: GAP, paddingVertical: 9 }]}>
            {shown.map(({ column, index }) =>
              cell(column, index, footer[index] ?? "", column.title, true),
            )}
          </View>
        )}
      </View>
      {rows.length === 0 && !!empty && (
        <Text style={[s.muted, { color: colors.mutedStrong, paddingVertical: 12 }]}>{empty}</Text>
      )}
    </View>
  );
}

/** One number with its name: "Calories today · 1,420". */
export function StatTile({
  label,
  value,
  detail,
  info,
}: {
  label: string;
  value: string;
  /** Under the number: "of 2,000". */
  detail?: string;
  /** A ⓘ beside the name that explains it. */
  info?: string;
}) {
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: 130,
        gap: 2,
        padding: 14,
        borderRadius: 16,
        backgroundColor: colors.subtle,
      }}
    >
      <View style={[s.row, { gap: 6 }]}>
        <Text style={[s.small, { color: colors.mutedStrong, fontSize: 12 }]}>{label}</Text>
        {!!info && <InfoTip term={label} text={info} />}
      </View>
      <Text
        style={[{ color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: "700" }, numbers]}
      >
        {value}
      </Text>
      {!!detail && (
        <Text style={[s.small, numbers, { color: colors.mutedStrong, fontSize: 12 }]}>
          {detail}
        </Text>
      )}
    </View>
  );
}

/** How far along something is: "$40 of $100". */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const share = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <View
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      style={{ height: 8, borderRadius: 4, overflow: "hidden" }}
    >
      {/* The track: strong enough to show how much is left in both themes. */}
      <View
        style={{
          position: "absolute",
          inset: 0,
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: colors.edge,
          opacity: 0.3,
        }}
      />
      <View
        style={{
          width: `${Math.round(share * 100)}%`,
          height: 8,
          borderRadius: 4,
          backgroundColor: colors.blueDark,
        }}
      />
    </View>
  );
}

/**
 * A choice of one, such as a time range: "Today · This week · 30 days". Selected is the app's
 * dark pill, as on the space tabs. It fills the width where there isn't room to sit at its own.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  align = "start",
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  /** What the choice is, for a screen reader: "Time range". */
  label: string;
  /** Where it sits when it doesn't fill the width. */
  align?: "start" | "center";
}) {
  const [room, setRoom] = useState(0);
  const refs = useRef<Record<string, { focus?: () => void } | null>>({});
  const stretch = room > 0 && room < 420;
  return (
    <View
      onLayout={(event) => setRoom(event.nativeEvent.layout.width)}
      style={{ alignSelf: "stretch" }}
    >
      <View
        role="radiogroup"
        aria-label={label}
        style={{
          flexDirection: "row",
          alignSelf: stretch ? "stretch" : align === "center" ? "center" : "flex-start",
          paddingHorizontal: 3,
          borderRadius: 22,
          backgroundColor: colors.subtle,
        }}
      >
        {options.map((option, index) => {
          const on = option.id === value;
          // One Tab stop for the group; arrows move the choice, Space or Enter picks.
          const move = (by: number) => {
            const next = options[(index + by + options.length) % options.length];
            if (!next) return;
            onChange(next.id);
            setTimeout(() => refs.current[next.id]?.focus?.(), 0);
          };
          return (
            <Pressable
              key={option.id}
              ref={(node) => {
                refs.current[option.id] = node as unknown as { focus?: () => void } | null;
              }}
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onPress={() => onChange(option.id)}
              // react-native-web's onKeyDown; arrows and Space aren't presses for a radio there.
              {...({
                onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowDown") move(1);
                  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(-1);
                  else if (event.key === " ") onChange(option.id);
                  else return;
                  event.preventDefault();
                },
              } as object)}
              // A 44px target around the 38px pill, without making the control taller. Stretched,
              // each choice starts from its own label's width and they share what's left, so a
              // longer label ("Didn’t go out") keeps its room.
              style={{
                ...(stretch ? { flexGrow: 1, flexShrink: 1, flexBasis: "auto" } : {}),
                height: 44,
                justifyContent: "center",
              }}
            >
              <View
                style={{
                  height: 38,
                  paddingHorizontal: stretch ? 6 : 14,
                  justifyContent: "center",
                  alignItems: "center",
                  borderRadius: 19,
                  backgroundColor: on ? colors.inverse : "transparent",
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    color: on ? colors.onInverse : colors.mutedStrong,
                    fontSize: 14,
                    fontWeight: on ? "700" : "500",
                  }}
                >
                  {option.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
