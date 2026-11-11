import { Check, type LucideIcon, Receipt as ReceiptIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from "react-native";
import { GlossFill, OnGloss } from "./gloss";
import { categoryColor } from "./receipt-box-logic";
import { dark } from "./theme";
import { colors, s } from "./ui";

/**
 * Amber for what needs the person, dark enough to read: small text on the amber tint is about 6:1
 * (the theme's amberText is 4.35:1 there), and a filled pill is white on a deep amber (light) or
 * dark on a bright amber (dark), both over 4.5:1.
 */
export const amberInk = dark ? colors.amberText : "#8A5600";
export const amberFill = dark ? "#F6B55A" : "#A35C00";
export const amberFillInk = dark ? "#1B1200" : "#FFFFFF";

/** Neddy's teal, as a gradient: the one primary button of a card (the same as Home's Talk bar). */
export const TEAL: [string, string] = ["#3A8A82", "#1F5B55"];

/**
 * The card's one main button: teal and glossy. Disabled it is a stone fill with muted words, and
 * says why (the caller shows the reason next to it).
 */
export function TealButton({
  label,
  icon: Icon,
  onPress,
  disabled,
  busy,
  id,
  height = 52,
  accessibilityLabel,
  style,
}: {
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  id: string;
  height?: number;
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  const off = !!(disabled || busy);
  return (
    <Pressable
      role="button"
      aria-label={accessibilityLabel ?? label}
      aria-disabled={off}
      aria-busy={busy}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: height,
          borderRadius: height / 2,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 22,
          backgroundColor: disabled ? colors.subtle : undefined,
          opacity: busy ? 0.7 : 1,
          transform: [{ scale: pressed && !off ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {!disabled && <GlossFill id={`rb-${id}`} from={TEAL[0]} to={TEAL[1]} radius={height / 2} />}
      <OnGloss>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {busy ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : Icon ? (
            <Icon size={20} color={disabled ? colors.mutedStrong : "#FFFFFF"} strokeWidth={2.2} />
          ) : null}
          <Text
            style={{
              color: disabled ? colors.mutedStrong : "#FFFFFF",
              fontSize: 17,
              fontWeight: "700",
              flexShrink: 1,
              textAlign: "center",
            }}
          >
            {label}
          </Text>
        </View>
      </OnGloss>
    </Pressable>
  );
}

/** A plain text action (Check later, Not a receipt): 44px tall, underlined like a link. */
export function TextAction({
  label,
  onPress,
  danger,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      role="button"
      aria-label={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: 10,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        style={{
          color: danger ? colors.danger : colors.text,
          fontSize: 16,
          fontWeight: "600",
          textDecorationLine: "underline",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A small label pill: amber only for what needs the person, teal for the box's own marks. */
export function Pill({
  children,
  tone = "neutral",
  icon: Icon,
}: {
  children: ReactNode;
  tone?: "amber" | "teal" | "neutral";
  icon?: LucideIcon;
}) {
  const bg = tone === "amber" ? colors.orange : tone === "teal" ? colors.sky : colors.subtle;
  const fg = tone === "amber" ? amberInk : tone === "teal" ? colors.blueText : colors.mutedStrong;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 14,
        backgroundColor: bg,
      }}
    >
      {Icon ? <Icon size={13} color={fg} strokeWidth={2.2} /> : null}
      <Text style={{ color: fg, fontSize: 13, fontWeight: "700" }}>{children}</Text>
    </View>
  );
}

/** A teal dot and a category's name. */
export function CategoryDot({ category, size = 9 }: { category: string; size?: number }) {
  return (
    <View
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: categoryColor(category, dark),
      }}
    />
  );
}

/** A receipt's little tile: a paper icon on a soft square (its photo shows in the detail). */
export function ReceiptTile({ size = 40, tint }: { size?: number; tint?: boolean }) {
  return (
    <View
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tint ? colors.orange : colors.subtle,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <ReceiptIcon size={size * 0.5} color={tint ? amberInk : colors.mutedStrong} />
    </View>
  );
}

/** An amber callout: what needs the person on a card. */
export function Callout({
  children,
  tone = "amber",
  style,
}: {
  children: ReactNode;
  tone?: "amber" | "teal";
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          padding: 14,
          borderRadius: 18,
          gap: 10,
          backgroundColor: tone === "amber" ? colors.orange : colors.sky,
          borderWidth: 1,
          borderColor: tone === "amber" ? colors.amber : colors.line,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * One choice among several, or a tag that can be on with others: a pill with a tick when chosen.
 * 44px tall; Space toggles it (react-native-web presses only role="button" on Space).
 */
export function ChoiceChip({
  label,
  selected,
  onPress,
  radio,
  dot,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** One of several (role radio), not a tag that can be on with others. */
  radio?: boolean;
  /** A category's dot before the label. */
  dot?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      role={radio ? "radio" : "checkbox"}
      aria-checked={selected}
      aria-label={label}
      disabled={disabled}
      onPress={onPress}
      {...({
        onKeyDown: (event: { key?: string; preventDefault?: () => void }) => {
          if (event.key !== " ") return;
          event.preventDefault?.();
          onPress();
        },
      } as object)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        minHeight: 44,
        paddingHorizontal: 16,
        borderRadius: 22,
        borderWidth: 1.5,
        borderColor: selected ? colors.blueDark : colors.line,
        backgroundColor: selected ? colors.blue : colors.card,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {selected ? <Check size={16} color={colors.blueText} strokeWidth={2.6} /> : null}
      {dot ? <CategoryDot category={dot} /> : null}
      <Text
        style={{ color: selected ? colors.blueText : colors.text, fontSize: 15, fontWeight: "600" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A heading and text with an icon tile: the edge cards ("I couldn't read that one."). */
export function InfoCard({
  icon: Icon,
  title,
  children,
  tint = "amber",
  actions,
  style,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  tint?: "amber" | "teal" | "neutral";
  actions?: ReactNode;
  style?: ViewStyle;
}) {
  const bg = tint === "amber" ? colors.orange : tint === "teal" ? colors.sky : colors.subtle;
  const fg = tint === "amber" ? amberInk : tint === "teal" ? colors.blueText : colors.mutedStrong;
  return (
    <View
      style={[
        s.card,
        {
          borderWidth: 1,
          borderColor: colors.line,
          gap: 12,
          padding: 18,
          borderRadius: 24,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
        <View
          aria-hidden
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: bg,
          }}
        >
          <Icon size={22} color={fg} />
        </View>
        <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
          <Text role="heading" aria-level={3} style={[s.heading, { fontSize: 18, lineHeight: 24 }]}>
            {title}
          </Text>
          {children}
        </View>
      </View>
      {actions ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {actions}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Every secondary button in the box: outlined, 48px tall, 16px words. One look everywhere (the
 * shared Button's 14px words were too small to read at a glance). `primary` is the teal-tinted one
 * for a choice that does the main thing; `danger` is for what can't be undone.
 */
export function OutlineButton({
  children,
  onPress,
  icon: Icon,
  primary,
  danger,
  disabled,
  busy,
  accessibilityLabel,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  icon?: LucideIcon;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  const ink = danger ? colors.danger : primary ? colors.blueText : colors.text;
  const off = !!(disabled || busy);
  return (
    <Pressable
      role="button"
      aria-label={accessibilityLabel}
      aria-disabled={off}
      aria-busy={busy}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          minHeight: 48,
          paddingHorizontal: 20,
          borderRadius: 24,
          borderWidth: 1.5,
          borderColor: primary ? colors.blueDark : danger ? colors.danger : colors.edge,
          backgroundColor: primary ? colors.blue : colors.card,
          opacity: off ? 0.55 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ink} size="small" />
      ) : Icon ? (
        <Icon size={18} color={ink} />
      ) : null}
      <Text
        style={{ color: ink, fontSize: 16, fontWeight: "700", flexShrink: 1, textAlign: "center" }}
      >
        {children}
      </Text>
    </Pressable>
  );
}

/**
 * File it with the reason it can't be tapped yet (or what happens when it is). Pinned under the
 * scrolling card in the box, so it's always in view; in the chat it ends the card (`inline`).
 */
export function FileFooter({
  disabled,
  busy,
  hint,
  error,
  onPress,
  inline,
}: {
  disabled: boolean;
  busy: boolean;
  hint: string;
  error?: string;
  onPress: () => void;
  inline?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      {!!error && (
        <Text role="alert" style={{ color: colors.danger, fontSize: 15, textAlign: "center" }}>
          {error}
        </Text>
      )}
      <TealButton
        id={inline ? "file-it-inline" : "file-it"}
        label="File it"
        disabled={disabled}
        busy={busy}
        onPress={onPress}
      />
      <Text style={[s.muted, { textAlign: "center" }]}>{hint}</Text>
    </View>
  );
}
