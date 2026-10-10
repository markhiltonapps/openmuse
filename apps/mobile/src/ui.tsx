import { ArrowUpRight, Check, ChevronRight, Info, type LucideIcon, X } from "lucide-react-native";
import { createContext, type ReactNode, useContext, useEffect, useId } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { plainText, readableResult } from "../../../packages/domain/src/plain-text";
import { glass, palette } from "./theme";
import { tipProps, toggleTip } from "./tips";
export const colors = palette;
/**
 * Over a moving backdrop, a card is frosted glass: a fine light edge and a blur of the scene
 * behind it (the mockup's "smoke"). Nothing in the plain look.
 */
export const glassSurface: ViewStyle =
  glass && Platform.OS === "web"
    ? ({
        borderWidth: 1,
        borderColor: "rgba(255, 255, 255, 0.16)",
        backdropFilter: "blur(22px) saturate(150%)",
      } as ViewStyle)
    : {};
export const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  text: { color: colors.text, fontSize: 15, lineHeight: 23 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  small: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: { color: colors.text, fontSize: 23, fontWeight: "600", letterSpacing: -0.7 },
  heading: { color: colors.text, fontSize: 16, fontWeight: "600", letterSpacing: -0.25 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 23,
    borderWidth: 0,
    borderColor: colors.line,
    padding: 20,
  },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 18 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 19,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.surface,
    minHeight: 45,
  },
  field: { gap: 7, marginBottom: 16 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    // A long label wraps inside the button instead of running off the screen.
    maxWidth: "100%",
    gap: 8,
    paddingHorizontal: 17,
    // 44px: big enough to tap reliably.
    minHeight: 44,
    paddingVertical: 10,
    borderRadius: 24,
  },
  primary: { backgroundColor: colors.blue },
  secondary: { backgroundColor: colors.subtle },
  buttonText: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: "flex-start",
    backgroundColor: colors.canvas,
  },
  chipText: { fontSize: 10, fontWeight: "600", color: colors.mutedStrong },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.sky,
  },
  error: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.errorBg,
    marginVertical: 10,
    gap: 4,
  },
  modalShade: {
    flex: 1,
    backgroundColor: colors.shade,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: {
    backgroundColor: colors.canvas,
    borderRadius: 26,
    width: "100%",
    maxWidth: 790,
    maxHeight: "94%",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
});
export function Button({
  children,
  onPress,
  icon: Icon,
  primary,
  disabled,
  busy,
  small,
  danger,
  style,
  accessibilityLabel,
  selected,
  strong,
  nativeID,
}: {
  children: ReactNode;
  onPress: () => void;
  /** An id to move focus back to it (on the web). */
  nativeID?: string;
  icon?: LucideIcon;
  primary?: boolean;
  /** The one thing to do on a card: dark, like the send button. */
  strong?: boolean;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  danger?: boolean;
  style?: ViewStyle;
  /** When the words alone don't say what it acts on, such as a row's "Edit". */
  accessibilityLabel?: string;
  /** For a choice among buttons: announced as pressed (react-native-web reads aria-*). */
  selected?: boolean;
}) {
  const color = strong ? colors.onInverse : danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      nativeID={nativeID}
      aria-pressed={selected}
      disabled={disabled || busy}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        primary ? s.primary : s.secondary,
        strong && { backgroundColor: colors.inverse },
        small && { minHeight: 38, paddingVertical: 7, paddingHorizontal: 13 },
        (disabled || busy) && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} size="small" />
      ) : Icon ? (
        <Icon size={15} color={color} />
      ) : null}
      <Text style={[s.buttonText, { color }]}>{children}</Text>
    </Pressable>
  );
}
/** A round button that's only an icon; its label shows as a tip on hover or press and hold. */
export function IconButton({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      {...tipProps(label)}
      style={({ pressed }) => [
        {
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 22,
          backgroundColor: pressed ? colors.line : colors.surface,
        },
      ]}
    >
      <Icon size={20} strokeWidth={1.8} color={colors.text} />
    </Pressable>
  );
}
/**
 * A small ⓘ beside a term that needs explaining. Its explanation shows on hover, keyboard focus or
 * a tap, and a screen reader reads it with the button's name.
 */
export function InfoTip({ term, text }: { term: string; text: string }) {
  return (
    <Pressable
      role="button"
      aria-label={`${term}: ${text}`}
      {...tipProps(text, {}, { hold: false })}
      // A tap opens it to stay while it's read; the next tap, a scroll or Escape closes it.
      onPress={(event) => toggleTip(text, event)}
      // A 44px target around the small icon, without making the row taller.
      style={{
        width: 44,
        height: 44,
        margin: -14,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Info size={15} strokeWidth={2} color={colors.mutedStrong} />
    </Pressable>
  );
}
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, glassSurface, style]}>{children}</View>;
}
export function Chip({ children, tint }: { children: ReactNode; tint?: string }) {
  return (
    <View style={[s.chip, tint ? { backgroundColor: tint } : null]}>
      <Text style={s.chipText}>{children}</Text>
    </View>
  );
}
export function Field({
  label,
  hideLabel,
  ...props
}: TextInputProps & { label: string; hideLabel?: boolean }) {
  return (
    <View style={s.field}>
      {!hideLabel && (
        <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>{label}</Text>
      )}
      <TextInput
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 120, textAlignVertical: "top" },
          props.style,
        ]}
      />
    </View>
  );
}
export function Empty({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", padding: 40, gap: 13 }}>
      <View style={[s.iconBox, { width: 55, height: 55, borderRadius: 18 }]}>
        <Icon size={24} color={colors.blueDark} />
      </View>
      <Text style={s.heading}>{title}</Text>
      <Text style={[s.muted, { textAlign: "center", maxWidth: 360 }]}>{detail}</Text>
      {children}
    </View>
  );
}
export function ErrorNotice({ error }: { error?: string }) {
  return error ? (
    <View accessibilityRole="alert" style={s.error}>
      <Text style={[s.text, { color: colors.danger }]}>{error}</Text>
    </View>
  ) : null;
}
/**
 * Shown at the top of every sheet: the live call's bar while a call is on, so a sheet opened during
 * a call doesn't hide it (sheets are a layer above the app).
 */
export const SheetTop = createContext<ReactNode>(null);
/** What just happened to a call shrunk to its bar, read out from inside whatever sheet is open. */
export const SheetStatus = createContext("");
const unseen = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  overflow: "hidden",
} as const;
export function Sheet({
  title,
  subtitle,
  children,
  onClose,
  wide,
  titleLines,
  footer,
  closeIcon = X,
  closeLabel = "Close",
  fill,
  narrow,
  onBack,
  seeThrough,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** Clips a long title to this many lines (it's still read out whole). */
  titleLines?: number;
  /** Controls that stay in view below the scrolling content, such as a call's End. */
  footer?: ReactNode;
  /** When closing does something else, such as shrinking a call to its bar. */
  closeIcon?: LucideIcon;
  closeLabel?: string;
  /** Keeps one height whatever is inside (search results, pages), so nothing jumps. */
  fill?: boolean;
  /** About 560px wide on a computer, for a list whose rows read best close together. */
  narrow?: boolean;
  /** What Escape or Android's back does first (close an open ⋯, go back a page); closes otherwise. */
  onBack?: () => void;
  /** Lets the moving backdrop show through, lightly shaded (the Backdrop picker). */
  seeThrough?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 600;
  const top = useContext(SheetTop);
  const status = useContext(SheetStatus);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // A sheet opened during a call starts at its own close button, not on the call's bar above it.
  // The focus trap puts focus on the sheet's first button once it has slid in: if that's the
  // bar's, it moves on.
  const hasTop = !!top;
  useEffect(() => {
    if (!hasTop || Platform.OS !== "web") return;
    const inTop = (node: unknown) =>
      !!document.getElementById(`${id}-top`)?.contains(node as Node | null);
    const moveOn = () =>
      document.getElementById(`${id}-head`)?.querySelector<HTMLElement>('[role="button"]')?.focus();
    const first = (event: FocusEvent) => {
      stop();
      // After the trap has finished: it's still looking, and would carry on past a move now.
      if (inTop(event.target)) setTimeout(moveOn, 0);
    };
    const timer = setTimeout(() => stop(), 1500);
    function stop() {
      document.removeEventListener("focusin", first);
      clearTimeout(timer);
    }
    document.addEventListener("focusin", first);
    if (inTop(document.activeElement)) moveOn();
    return stop;
  }, []);
  return (
    <Modal
      transparent
      animationType={compact ? "slide" : "fade"}
      visible
      onRequestClose={onBack ?? onClose}
    >
      <View
        style={[
          s.modalShade,
          compact && { padding: 0, justifyContent: "flex-end" },
          seeThrough && { backgroundColor: "rgba(0,0,0,0.15)" },
        ]}
      >
        <View
          accessibilityViewIsModal
          style={[
            s.sheet,
            // Frosted: the scene shows as colour and movement, never as words behind its own.
            seeThrough && {
              backgroundColor: "rgba(14,12,22,0.86)",
              ...(Platform.OS === "web"
                ? ({ backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)" } as object)
                : {}),
            },
            wide && { maxWidth: 1050 },
            narrow && { maxWidth: 560 },
            fill && { height: compact ? "94%" : Math.min(height * 0.9, 860) },
            compact && {
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              paddingBottom: Math.max(insets.bottom, 12),
              maxHeight: "94%",
            },
          ]}
        >
          {top ? <View nativeID={`${id}-top`}>{top}</View> : null}
          {/* Mounted all the time, so it's read out when it changes. */}
          <Text role="status" style={unseen}>
            {status}
          </Text>
          {compact && !top && (
            <View
              style={{
                alignSelf: "center",
                width: 34,
                height: 4,
                borderRadius: 3,
                backgroundColor: colors.subtle,
                marginTop: 10,
              }}
            />
          )}
          <View
            nativeID={`${id}-head`}
            style={[
              s.between,
              { padding: compact ? 20 : 24, borderBottomWidth: 1, borderBottomColor: colors.line },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text role="heading" aria-level={2} numberOfLines={titleLines} style={s.title}>
                {title}
              </Text>
              {!!subtitle && <Text style={s.muted}>{subtitle}</Text>}
            </View>
            <IconButton icon={closeIcon} label={closeLabel} onPress={onClose} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: compact ? 20 : 24 }}
          >
            {children}
          </ScrollView>
          {footer && (
            <View
              style={{
                paddingHorizontal: compact ? 20 : 24,
                paddingVertical: 14,
                borderTopWidth: 1,
                borderTopColor: colors.line,
              }}
            >
              {footer}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
export function CheckRow({
  label,
  detail,
  checked,
  onPress,
  radio = false,
}: {
  label: string;
  /** The fine print under it, smaller. */
  detail?: string;
  checked: boolean;
  onPress: () => void;
  /** One choice of several (a round box), not a tick of its own. */
  radio?: boolean;
}) {
  return (
    <Pressable
      role={radio ? "radio" : "checkbox"}
      accessibilityState={{ checked }}
      aria-checked={checked}
      aria-label={detail ? `${label}. ${detail}` : undefined}
      onPress={onPress}
      // react-native-web presses only role="button" on Space; a checkbox takes it too.
      {...({
        onKeyDown: (event: { key?: string; preventDefault?: () => void }) => {
          if (event.key !== " ") return;
          event.preventDefault?.();
          onPress();
        },
      } as object)}
      // The box sits beside the first line, however many lines the label takes.
      style={[s.row, { gap: 10, paddingVertical: 11, alignItems: "flex-start" }]}
    >
      <View
        style={{
          width: 19,
          height: 19,
          marginTop: 2,
          borderRadius: radio ? 10 : 5,
          // An unticked box stands out from the card (edge, not line: line is near-invisible).
          borderWidth: 1.5,
          borderColor: checked ? colors.text : colors.edge,
          backgroundColor: checked ? colors.inverse : colors.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked &&
          (radio ? (
            <View
              style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.onInverse }}
            />
          ) : (
            <Check size={13} color={colors.onInverse} />
          ))}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.text}>{label}</Text>
        {detail ? (
          <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>{detail}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
export function SectionHeading({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={[s.between, { marginBottom: 19 }]}>
      <Text style={s.heading}>{title}</Text>
      {action && onPress && (
        <Pressable accessibilityRole="button" onPress={onPress} style={[s.row, { gap: 5 }]}>
          <Text style={[s.small, { color: colors.text }]}>{action}</Text>
          <ArrowUpRight size={13} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}
export function LinkRow({
  title,
  detail,
  onPress,
  icon: Icon,
  tint,
}: {
  title: string;
  detail?: string;
  onPress: () => void;
  icon: LucideIcon;
  tint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        { paddingVertical: 13, gap: 14, borderRadius: 10 },
        pressed && { backgroundColor: colors.canvas },
      ]}
    >
      <View style={[s.iconBox, { backgroundColor: tint || colors.sky }]}>
        <Icon size={19} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[s.text, { fontWeight: "500" }]}>{title}</Text>
        {!!detail && <Text style={s.small}>{detail}</Text>}
      </View>
      <ChevronRight size={15} color={colors.muted} />
    </Pressable>
  );
}
export function dateLabel(value: string, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", options || { month: "short", day: "numeric" });
}
export function timeLabel(value: string, timeZone?: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}
export function relativeDate(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  return diff < 60_000
    ? "Just now"
    : diff < 3600_000
      ? `${Math.floor(diff / 60_000)}m ago`
      : diff < 86400_000
        ? `${Math.floor(diff / 3600_000)}h ago`
        : dateLabel(value);
}

/** A result as plain words for a short preview (shared with phone notifications). */
export const plainPreview = plainText;
/** A result in the person's words. */
export const resultSummary = readableResult;
