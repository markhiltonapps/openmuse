import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock,
  Coffee,
  type LucideIcon,
  MessageCircle,
  PenLine,
  Video,
} from "lucide-react-native";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  type HeadsUp,
  type HeadsUpKind,
  type HeadsUpSettings,
  saysKind,
  TRAVEL_BUFFERS,
} from "../../../packages/domain/src/heads-up";
import { useAgentWorkspace } from "./agent-workspace";
import { showAppsTab } from "./apps-tabs";
import { HIDDEN } from "./job-working-ui";
import { liveCallOn } from "./live-voice";
import { dark, glass } from "./theme";
import { Button, Card, CheckRow, colors, ErrorNotice, s } from "./ui";
import { CHECK_IN_OPENED } from "./web-app";
import { useWorkspace } from "./workspace";

/**
 * Heads-ups (owner, 2026-10-22): Neddy watches the calendar and speaks first. The cards sit just
 * above the chat box like the meal check-in; the settings are the first card under Apps › Alerts.
 * Everything here can also be said or asked in the chat (my_heads_ups, set_heads_ups).
 */

/** Sent after a heads-up or a setting changes, so the other copy of the cards catches up. */
const HEADS_UPS_CHANGED = "muse-headsups-changed";
const changed = () => {
  if (typeof window !== "undefined" && window.dispatchEvent)
    window.dispatchEvent(new Event(HEADS_UPS_CHANGED));
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const FINE = { fontSize: 13, lineHeight: 18, color: colors.mutedStrong } as const;
const POLL = 2 * 60_000;
/** How long "Turned off …" stays, with its Undo. */
const UNDO_FOR = 15_000;
/** The stack never takes more than this share of the window's height (one item, or several). */
const STACK_ONE = 0.4;
const STACK_MANY = 0.5;
/** The "N more heads-ups" button under a clipped stack. */
const PILL_HEIGHT = 44;
/** A little of the next item shows below the last whole one, so it's clear there's more. */
const PEEK = 16;
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export interface HeadsUpsState {
  settings: HeadsUpSettings;
  /** The one-time explanation hasn't been seen. */
  intro: boolean;
  open: HeadsUp[];
  more: number;
  kinds: { kind: HeadsUpKind; label: string; on: boolean }[];
  /** False: the last look found no calendar connected. Missing means unknown. */
  calendar?: boolean;
  /** False: this server can't send email. Missing means unknown. */
  email?: boolean;
  /** How the last look at the calendar went. */
  look?: "ok" | "none" | "failed" | "no-zone" | "unknown";
}
type Patch = Partial<Pick<HeadsUpSettings, "on" | "chatty" | "travelBuffer" | "introSeen">> & {
  /** `null` clears a kind's own setting, so the chattiness decides again. */
  kinds?: Partial<Record<HeadsUpKind, boolean | null>>;
  channels?: Partial<HeadsUpSettings["channels"]>;
};

const withSettings = (state: HeadsUpsState, settings: HeadsUpSettings): HeadsUpsState => ({
  ...state,
  settings,
  intro: !settings.introSeen,
  kinds: state.kinds.map((k) => ({ ...k, on: saysKind(settings, k.kind) })),
});
/** What the screen shows at once, before the server has answered. */
const patched = (state: HeadsUpsState, patch: Patch): HeadsUpsState => {
  const kinds: HeadsUpSettings["kinds"] = { ...state.settings.kinds };
  for (const [kind, value] of Object.entries(patch.kinds ?? {}) as [HeadsUpKind, boolean | null][])
    if (value === null) delete kinds[kind];
    else kinds[kind] = value;
  const { kinds: _kinds, channels, ...rest } = patch;
  return withSettings(state, {
    ...state.settings,
    ...rest,
    kinds,
    channels: { ...state.settings.channels, ...channels },
  });
};

/**
 * The server's heads-ups and settings. A change shows at once and is saved one at a time, in order;
 * what the server says back replaces it only when no other change is waiting.
 */
export function useHeadsUps() {
  const { api } = useWorkspace();
  const [state, setState] = useState<HeadsUpsState>();
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const load = useCallback(
    () =>
      api.request<HeadsUpsState>("/api/heads-ups").then(
        (answer) => {
          if (pending.current === 0) setState(answer);
        },
        () => undefined,
      ),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (typeof window === "undefined" || !window.addEventListener) return;
    const reload = () => void load();
    window.addEventListener(CHECK_IN_OPENED, reload);
    window.addEventListener(HEADS_UPS_CHANGED, reload);
    return () => {
      window.removeEventListener(CHECK_IN_OPENED, reload);
      window.removeEventListener(HEADS_UPS_CHANGED, reload);
    };
  }, [load]);
  /** Throws the server's reason if it refuses; the screen is put back to what the server has. */
  const save = useCallback(
    (patch: Patch) => {
      setState((current) => current && patched(current, patch));
      pending.current += 1;
      const run = queue.current.then(() =>
        api.request<HeadsUpSettings>("/api/heads-ups/settings", patch),
      );
      queue.current = run.catch(() => undefined);
      return run.then(
        (settings) => {
          pending.current -= 1;
          if (pending.current === 0) {
            setState((current) => current && withSettings(current, settings));
            changed();
          }
        },
        (e) => {
          pending.current -= 1;
          void load();
          throw e;
        },
      );
    },
    [api, load],
  );
  return { state, load, save };
}

/**
 * What a screen reader hears. The text is cleared first and set a moment later, so the same
 * sentence twice in a row is read out twice.
 */
function useAnnouncer() {
  const [said, setSaid] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = useCallback((text: string) => {
    clearTimeout(timer.current);
    setSaid("");
    timer.current = setTimeout(() => setSaid(text), 50);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [said, say] as const;
}
/** Always mounted, out of the layout (1×1, absolute) and out of the way of taps. */
const StatusLine = ({ text }: { text: string }) => (
  <Text role="status" style={[HIDDEN, { opacity: 0, pointerEvents: "none" } as object]}>
    {text}
  </Text>
);

/** Puts keyboard focus in the message box (on the web), once whatever had it is gone. */
function focusComposer() {
  if (Platform.OS !== "web") return;
  setTimeout(() => {
    const boxes = Array.from(
      document.querySelectorAll<HTMLElement>('textarea[aria-label^="Message "]'),
    );
    boxes.find((box) => box.offsetParent)?.focus();
  }, 60);
}

/** A small round switch, a real `switch` for screen readers; Space and Enter both flip it. */
function SwitchRow({
  label,
  detail,
  checked,
  onPress,
  leading,
  strong,
  disabled,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onPress: () => void;
  leading?: ReactNode;
  /** The card's main switch, in the heading's size. */
  strong?: boolean;
  disabled?: boolean;
}) {
  const press = () => !disabled && onPress();
  return (
    <Pressable
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      aria-label={detail ? `${label}. ${detail}` : label}
      accessibilityState={{ checked, disabled: !!disabled }}
      onPress={press}
      {...({
        onKeyDown: (event: { key?: string; preventDefault?: () => void }) => {
          if (event.key !== " ") return;
          event.preventDefault?.();
          press();
        },
      } as object)}
      style={[
        s.row,
        {
          gap: 14,
          minHeight: 44,
          paddingVertical: 6,
          // With fine print, the switch sits beside the first line, not the middle of them all.
          alignItems: detail ? "flex-start" : "center",
        },
      ]}
    >
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[strong ? s.heading : s.text, disabled && { opacity: 0.6 }]}>{label}</Text>
        {detail ? <Text style={FINE}>{detail}</Text> : null}
      </View>
      <View
        style={{
          width: 48,
          height: 28,
          marginTop: detail ? (strong ? -4 : -2) : 0,
          borderRadius: 14,
          paddingHorizontal: 3,
          justifyContent: "center",
          backgroundColor: checked ? colors.greenDark : colors.subtle,
          borderWidth: 1.5,
          borderColor: checked ? colors.greenDark : colors.edge,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            alignSelf: checked ? "flex-end" : "flex-start",
            // On: the page's own colour (white in the light look, black in the dark one, against
            // the green). Off: the control's edge colour, so the knob never vanishes on the grey track.
            backgroundColor: checked ? colors.canvas : colors.edge,
            shadowColor: "#000",
            shadowOpacity: 0.18,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 1 },
          }}
        />
      </View>
    </Pressable>
  );
}

const cardStyle = {
  gap: 10,
  paddingVertical: 14,
  paddingHorizontal: 16,
  borderRadius: 23,
  backgroundColor: colors.sky,
  borderWidth: 1,
  borderColor: colors.blue,
} as const;
/** A white pill on the sky card: an edge so it shows, and a dark-mode fill like the Say lines. */
const pill = {
  backgroundColor: dark ? colors.subtle : colors.card,
  borderWidth: 1,
  borderColor: colors.edge,
} as const;
const KIND_ICONS: Record<HeadsUpKind, LucideIcon> = {
  starting_soon: Video,
  leave_for: CalendarClock,
  leave_by: CalendarClock,
  tight_gap: AlertTriangle,
  overlap: AlertTriangle,
  no_break: Coffee,
};

/** Where Settings and Connect lead: a tab of the Apps screen. */
function useGoTo() {
  const { navigate } = useWorkspace();
  return (tab: "alerts" | "apps") => {
    showAppsTab(tab);
    navigate("apps");
  };
}

/** Hidden for this session only ("Not now" on the intro). */
let introNotNow = false;

interface Note {
  id: string;
  /** Where the card it replaces was in the stack. */
  index: number;
  kind: "mute" | "off";
  text: string;
  undo: string;
  heard: string;
}

/**
 * "Turned off …" or "Heads-ups are off.", in place of the card, with Undo for a while. The clock
 * waits while its button has keyboard focus or is being pressed.
 */
function NoteRow({
  note,
  onUndo,
  onGone,
}: {
  note: Note;
  onUndo: () => Promise<void>;
  onGone: () => void;
}) {
  const goTo = useGoTo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const id = `headsup-undo-${note.id}`;
  const gone = useRef(onGone);
  gone.current = onGone;
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => gone.current(), UNDO_FOR);
    return () => clearTimeout(timer);
  }, [paused]);
  // The button they pressed is gone: keyboard focus goes to Undo.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const timer = setTimeout(() => document.getElementById(id)?.focus(), 30);
    return () => clearTimeout(timer);
  }, [id]);
  return (
    <View
      accessibilityRole="summary"
      style={[cardStyle, { gap: 8, paddingVertical: 12 }]}
      {...({
        // Keyboard focus (not the focus we moved here after a tap) or a press holds the clock.
        onFocus: (event: { target?: { matches?: (selector: string) => boolean } }) => {
          try {
            if (event.target?.matches?.(":focus-visible")) setPaused(true);
          } catch {
            // Older browsers: the clock just keeps going.
          }
        },
        onBlur: () => setPaused(false),
        onPointerDown: () => setPaused(true),
        onPointerUp: () => setPaused(false),
        onPointerCancel: () => setPaused(false),
      } as object)}
    >
      <Text style={s.text}>{note.text}</Text>
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          nativeID={id}
          busy={busy}
          disabled={busy}
          style={pill}
          onPress={() => {
            setBusy(true);
            setError("");
            onUndo().catch((e) => {
              setError(message(e));
              setBusy(false);
            });
          }}
        >
          {note.undo}
        </Button>
        <Button style={pill} onPress={() => goTo("alerts")}>
          Settings
        </Button>
      </View>
      <ErrorNotice error={error} />
    </View>
  );
}

/** The one-time "Heads-ups are on" card (or what's wrong with the calendar, if something is). */
function IntroCard({
  problem,
  save,
  onOff,
  onNotNow,
  say,
}: {
  /** No calendar to read, or one that couldn't be read last time. */
  problem?: "none" | "failed";
  save: (patch: Patch) => Promise<void>;
  onOff: () => Promise<void>;
  onNotNow: () => void;
  say: (text: string) => void;
}) {
  const goTo = useGoTo();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function choose(kind: string, run: () => Promise<void>, said?: string) {
    setBusy(kind);
    setError("");
    try {
      await run();
      if (said) say(said);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  const turnOff = (
    <Button
      busy={busy === "off"}
      disabled={!!busy}
      style={pill}
      onPress={() => void choose("off", onOff)}
    >
      Turn off
    </Button>
  );
  const OK = "I won’t send or change anything for you without your OK.";
  return (
    <View accessibilityRole="summary" style={cardStyle}>
      <View style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
        <View style={{ marginTop: 3 }}>
          <Clock size={18} color={colors.blueDark} />
        </View>
        <Text accessibilityRole="header" style={[s.heading, { flex: 1, fontSize: 17 }]}>
          {problem === "none"
            ? "Heads-ups are on, but I can’t see a calendar yet"
            : problem === "failed"
              ? "Heads-ups are on, but I couldn’t read your calendar"
              : "Heads-ups are on"}
        </Text>
      </View>
      <Text style={s.text}>
        {problem === "none"
          ? `Connect your calendar and I’ll tell you when to leave, or when two things clash. ${OK}`
          : problem === "failed"
            ? `I couldn’t read your calendar last time. Reconnect it under Apps. ${OK}`
            : `I’ll watch your calendar and tell you when something needs attention, like when to leave for an appointment, or two meetings that clash. ${OK}`}
      </Text>
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        {problem ? (
          <>
            <Button
              strong
              disabled={!!busy}
              style={{ flexBasis: "100%" }}
              onPress={() => goTo("apps")}
            >
              {problem === "failed" ? "Reconnect calendar" : "Connect calendar"}
            </Button>
            <Button disabled={!!busy} style={pill} onPress={onNotNow}>
              Not now
            </Button>
            {turnOff}
          </>
        ) : (
          <>
            <Button
              strong
              busy={busy === "seen"}
              disabled={!!busy}
              onPress={() =>
                void choose("seen", () => save({ introSeen: true }), "Okay, heads-ups stay on.")
              }
            >
              Got it
            </Button>
            {turnOff}
            <Button
              disabled={!!busy}
              style={pill}
              onPress={() => {
                // Seen is enough: they're going to look. Failing to save it only shows this again.
                void save({ introSeen: true }).catch(() => undefined);
                goTo("alerts");
              }}
            >
              Settings
            </Button>
          </>
        )}
      </View>
      <Text style={FINE}>You can also say “stop heads-ups” or “only the important ones”.</Text>
      <ErrorNotice error={error} />
    </View>
  );
}

/** A heads-up that isn't the one in front: one line, tapped to open it in place. */
function CompactRow({ item, onOpen }: { item: HeadsUp; onOpen: () => void }) {
  const Icon = KIND_ICONS[item.kind];
  return (
    <Pressable
      role="button"
      aria-expanded={false}
      aria-label={`${item.title}. Show details`}
      onPress={onOpen}
      style={({ pressed }) => [
        s.row,
        {
          gap: 10,
          minHeight: 44,
          paddingHorizontal: 14,
          borderRadius: 22,
          backgroundColor: colors.sky,
          borderWidth: 1,
          borderColor: colors.blue,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Icon size={18} color={colors.blueDark} />
      <Text numberOfLines={1} style={[s.text, { flex: 1, fontWeight: "600" }]}>
        {item.title}
      </Text>
      <ChevronDown size={18} color={colors.mutedStrong} />
    </Pressable>
  );
}

/** The heads-up in front: what it says, and what to do about it. */
function HeadsUpCard({
  item,
  onChanged,
  onSaid,
  onStopped,
}: {
  item: HeadsUp;
  onChanged: () => Promise<unknown>;
  onSaid: (text: string) => void;
  onStopped: (label: string) => void;
}) {
  const { api, draft, notify } = useWorkspace();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const Icon = KIND_ICONS[item.kind];
  const joinUrl = item.joinUrl && /^https?:\/\//i.test(item.joinUrl) ? item.joinUrl : undefined;
  const askLabel =
    item.moveTitle && item.kind === "tight_gap"
      ? "Ask for a later start"
      : item.moveTitle && item.kind === "overlap"
        ? "Ask to move one"
        : "";
  const askWords =
    item.kind === "tight_gap"
      ? `Help me with this: ${item.title}. Write a short, polite note to the organizer of “${item.moveTitle}” asking if it can start a little later.`
      : `Help me with this: ${item.title}. Write a short, polite note to the organizer of “${item.moveTitle}” asking if it can move to another time.`;
  // One reminder is all there is; after it, Done is the only way out.
  const canLater = (item.snoozes ?? 0) < 1;
  // Where focus goes when this card opens from a one-line row.
  const firstId = `headsup-first-${item.id}`;
  const snug = { paddingHorizontal: 12 } as const;
  async function run(kind: "done" | "snooze" | "mute") {
    setBusy(kind);
    setError("");
    try {
      const result = await api.request<{
        label?: string;
        remindAt?: string;
        reason?: "last" | "close";
      }>(`/api/heads-ups/${item.id}/${kind}`, {});
      if (kind === "mute") {
        // The card turns into "Turned off …" with Undo before the list reloads without it.
        onStopped(result.label ?? "that");
      } else if (kind === "snooze") {
        const said = result.remindAt
          ? `Okay, I’ll remind you around ${clock(result.remindAt)}.`
          : result.reason === "last"
            ? "Okay, that was the last reminder."
            : result.reason === "close"
              ? "Okay, cleared. It starts too soon to remind you again."
              : "Okay, cleared.";
        notify(said);
        onSaid(said);
      } else onSaid("Okay, cleared.");
      changed();
      await onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <View accessibilityRole="summary" aria-label={`Heads-up: ${item.title}`} style={cardStyle}>
      <View style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
        <View style={{ marginTop: 3 }}>
          <Icon size={18} color={colors.blueDark} />
        </View>
        <Text accessibilityRole="header" style={[s.heading, { flex: 1, fontSize: 17 }]}>
          {item.title}
        </Text>
      </View>
      <Text style={s.text}>{item.body}</Text>
      {askLabel !== "" && (
        <Button
          icon={PenLine}
          disabled={!!busy}
          nativeID={firstId}
          style={{ ...pill, alignSelf: "stretch" }}
          onPress={() => draft(askWords)}
        >
          {askLabel}
        </Button>
      )}
      <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
        {joinUrl && (
          <Button
            strong
            icon={Video}
            nativeID={askLabel === "" ? firstId : undefined}
            disabled={!!busy}
            style={snug}
            accessibilityLabel="Join the meeting"
            // Straight from the tap, so the browser opens the new tab.
            onPress={() => void Linking.openURL(joinUrl).catch((e) => setError(message(e)))}
          >
            Join
          </Button>
        )}
        <Button
          strong={!joinUrl}
          nativeID={askLabel === "" && !joinUrl ? firstId : undefined}
          style={joinUrl ? { ...pill, ...snug } : snug}
          busy={busy === "done"}
          disabled={!!busy}
          onPress={() => void run("done")}
        >
          Done
        </Button>
        {canLater && (
          <Button
            style={{ ...pill, ...snug }}
            busy={busy === "snooze"}
            disabled={!!busy}
            onPress={() => void run("snooze")}
          >
            Later
          </Button>
        )}
        <Pressable
          role="button"
          aria-label="Stop these heads-ups"
          aria-disabled={!!busy}
          disabled={!!busy}
          onPress={() => void run("mute")}
          style={({ pressed }) => ({
            marginLeft: "auto",
            minHeight: 44,
            minWidth: 44,
            justifyContent: "center",
            paddingHorizontal: 4,
            opacity: pressed || busy === "mute" ? 0.6 : 1,
          })}
        >
          <Text style={{ fontSize: 14, color: colors.blueText, textDecorationLine: "underline" }}>
            Stop these
          </Text>
        </Pressable>
      </View>
      <ErrorNotice error={error} />
    </View>
  );
}

/**
 * Just above the chat box: what needs attention on the calendar, the first one in full and the
 * rest one line each, until cleared, put off or expired. With none, the one-time explanation.
 * Draws nothing until the first answer is in.
 */
/** Whether a heads-up is showing above the chat box, so the dinner question can give way on a short window. */
let showingCount = 0;
const showingListeners = new Set<() => void>();
const setShowing = (count: number) => {
  if (count === showingCount) return;
  showingCount = count;
  for (const listener of showingListeners) listener();
};
export function useHeadsUpShowing() {
  return (
    useSyncExternalStore(
      (listener) => {
        showingListeners.add(listener);
        return () => {
          showingListeners.delete(listener);
        };
      },
      () => showingCount,
      () => 0,
    ) > 0
  );
}

export function HeadsUpCards({ replying, active }: { replying?: boolean; active?: boolean }) {
  const { state, load, save } = useHeadsUps();
  const { data } = useAgentWorkspace();
  const { height: windowHeight } = useWindowDimensions();
  const [said, say] = useAnnouncer();
  const [notes, setNotes] = useState<Note[]>([]);
  const [expanded, setExpanded] = useState("");
  /** After a "Turned off" row goes, the heads-ups it was beside stay one-liners until they change. */
  const [holdCompact, setHoldCompact] = useState("");
  const [notNow, setNotNow] = useState(introNotNow);
  const root = useRef<View>(null);
  const scroller = useRef<ScrollView>(null);
  /** What Undo does for each "Turned off" row. */
  const undoWhat = useRef<Record<string, () => Promise<void>>>({});
  // A new notification may be a heads-up; a chat reply may have changed the settings.
  const latest = data?.notifications[0]?.id;
  useEffect(() => {
    void latest;
    void load();
  }, [load, latest]);
  // Chats stay open in the background; one coming back into view checks again.
  useEffect(() => {
    if (active) void load();
  }, [active, load]);
  const wasReplying = useRef(false);
  useEffect(() => {
    if (wasReplying.current && !replying) void load();
    wasReplying.current = !!replying;
  }, [replying, load]);
  // Every two minutes while it can be seen, and not during a call.
  useEffect(() => {
    if (active === false) return;
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const check = () => {
      if (visible() && !liveCallOn()) void load();
    };
    const timer = setInterval(check, POLL);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", check);
    };
  }, [active, load]);
  const open = state?.settings.on ? state.open : [];
  // Told to the chat screen (and cleared when the cards go away).
  const showing = open.length;
  useEffect(() => {
    setShowing(showing);
    return () => setShowing(0);
  }, [showing]);
  // Say a new heads-up once, for screen readers; one that was already there isn't new again.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const fresh = open.filter((item) => !seen.current.has(item.id));
    for (const item of fresh) seen.current.add(item.id);
    if (fresh[0]) say(`Heads-up: ${fresh[0].title}`);
  }, [open, say]);
  /** What was pressed went away with its card: keep keyboard focus somewhere useful. */
  const refocus = useCallback(async () => {
    await load();
    if (Platform.OS !== "web") return;
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const node = root.current as unknown as HTMLElement | null;
      const button = node?.querySelector<HTMLElement>("[role=button]");
      if (button) button.focus();
      else focusComposer();
    }, 60);
  }, [load]);
  const openKey = open.map((item) => item.id).join(",");
  const openKeyRef = useRef(openKey);
  openKeyRef.current = openKey;
  const dropNote = useCallback((id: string) => {
    setNotes((current) => current.filter((n) => n.id !== id));
    // No card may jump to full size under a thumb because a row went away.
    setHoldCompact(openKeyRef.current);
  }, []);
  const addNote = (note: Note) => {
    setNotes((current) => [...current.filter((n) => n.id !== note.id), note]);
    say(note.heard);
  };

  // The one in full: the one they opened, else the first (unless a "Turned off" row is on top).
  const fullId = open.some((i) => i.id === expanded)
    ? expanded
    : notes.length || holdCompact === openKey
      ? undefined
      : open[0]?.id;
  // A different heads-up opened (or the stack changed): start from its top.
  const stackKey = `${fullId}|${open.length}|${notes.length}`;
  useEffect(() => {
    void stackKey;
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, [stackKey]);
  const items: { key: string; node: ReactNode }[] = open.map((item, index) => ({
    key: item.id,
    node:
      item.id === fullId ? (
        <HeadsUpCard
          item={item}
          onChanged={refocus}
          onSaid={say}
          onStopped={(label) => {
            addNote({
              id: item.id,
              index,
              kind: "mute",
              text: `Turned off “${label}”.`,
              undo: "Undo",
              heard: `Turned off “${label}”. Undo is the next button.`,
            });
            undoWhat.current[item.id] = async () => {
              // Clear its own setting, so the chattiness decides again.
              await save({ kinds: { [item.kind]: null } });
              say(`Okay, “${label}” is back on.`);
            };
          }}
        />
      ) : (
        <CompactRow
          item={item}
          onOpen={() => {
            setExpanded(item.id);
            // The row they pressed turns into the card: keyboard focus goes to its first button.
            if (Platform.OS === "web")
              setTimeout(() => document.getElementById(`headsup-first-${item.id}`)?.focus(), 60);
          }}
        />
      ),
  }));
  for (const note of notes) {
    items.splice(Math.min(note.index, items.length), 0, {
      key: `note-${note.id}`,
      node: (
        <NoteRow
          note={note}
          onGone={() => dropNote(note.id)}
          onUndo={async () => {
            await undoWhat.current[note.id]?.();
            dropNote(note.id);
          }}
        />
      ),
    });
  }
  // Never with open heads-ups: those matter more.
  if (state?.intro && open.length === 0 && !notNow)
    items.push({
      key: "intro",
      node: (
        <IntroCard
          problem={
            state.look === "none" || state.calendar === false
              ? "none"
              : state.look === "failed"
                ? "failed"
                : undefined
          }
          save={save}
          say={say}
          onNotNow={() => {
            introNotNow = true;
            setNotNow(true);
          }}
          onOff={async () => {
            await save({ on: false, introSeen: true });
            undoWhat.current.intro = async () => {
              await save({ on: true });
              say("Okay, heads-ups are back on.");
            };
            addNote({
              id: "intro",
              index: 0,
              kind: "off",
              text: "Heads-ups are off.",
              undo: "Turn back on",
              heard: "Heads-ups are off. Turn back on is the next button.",
            });
          }}
        />
      ),
    });

  // The stack takes at most a share of the window (with the button under it), and its cut lands
  // between items, with a little of the next one showing.
  const [edges, setEdges] = useState<Record<string, number>>({});
  const [viewHeight, setViewHeight] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  // The explanation alone may take a little more: it's one card and has nothing else to wait for.
  const onlyIntro = items.length === 1 && items[0]?.key === "intro";
  const share = onlyIntro ? 0.55 : items.length >= 2 ? STACK_MANY : STACK_ONE;
  const limit = Math.floor(windowHeight * share);
  const bottoms = items.map((item) => edges[item.key] ?? 0);
  const total = Math.max(0, ...bottoms);
  const tooTall = total > limit;
  const room = limit - PILL_HEIGHT;
  const fit = Math.max(0, ...bottoms.filter((b) => b <= room));
  const maxHeight = tooTall ? (fit || room) + PEEK : undefined;
  const clipped = tooTall && viewHeight > 0 && scrollY + viewHeight < total - 6;
  const firstHidden = bottoms.findIndex((b) => b > scrollY + viewHeight + 1);
  const hidden = (firstHidden < 0 ? 0 : bottoms.length - firstHidden) + (state?.more ?? 0);
  const fade = glass ? "rgba(10, 8, 16, 0.9)" : colors.canvas;

  return (
    <>
      <StatusLine text={said} />
      {state && items.length > 0 && (
        <View style={{ flexShrink: 1, minHeight: 0, marginBottom: 12 }}>
          <View style={{ flexShrink: 1, minHeight: 0 }}>
            <ScrollView
              ref={scroller}
              role="region"
              aria-label="Heads-ups"
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={64}
              style={{ flexGrow: 0, flexShrink: 1, minHeight: 0, maxHeight }}
              onLayout={(event) => setViewHeight(event.nativeEvent.layout.height)}
              onScroll={(event) => setScrollY(event.nativeEvent.contentOffset.y)}
            >
              <View ref={root}>
                {items.map((item) => (
                  <View
                    key={item.key}
                    // The gap below is part of the item, so a cut between two lands in the gap.
                    style={{ paddingBottom: 10 }}
                    onLayout={(event) => {
                      const { y, height } = event.nativeEvent.layout;
                      setEdges((current) =>
                        current[item.key] === y + height
                          ? current
                          : { ...current, [item.key]: y + height },
                      );
                    }}
                  >
                    {item.node}
                  </View>
                ))}
                {state.settings.on && state.more > 0 && (
                  <Text style={[FINE, { paddingHorizontal: 4, paddingBottom: 6 }]}>
                    {`${state.more} more will show when you clear one.`}
                  </Text>
                )}
              </View>
            </ScrollView>
            {clipped && Platform.OS === "web" && (
              // Over the top of the next item only, never the last whole one.
              <View
                pointerEvents="none"
                style={
                  {
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 12,
                    backgroundImage: `linear-gradient(to bottom, transparent, ${fade})`,
                  } as object
                }
              />
            )}
          </View>
          {clipped && (
            <Pressable
              role="button"
              aria-label={`${hidden} more heads-up${hidden === 1 ? "" : "s"}. Show the next one.`}
              onPress={() =>
                scroller.current?.scrollTo({
                  y: firstHidden > 0 ? (bottoms[firstHidden - 1] ?? 0) : 0,
                  animated: true,
                })
              }
              style={({ pressed }) => [
                s.row,
                {
                  alignSelf: "center",
                  gap: 6,
                  minHeight: PILL_HEIGHT,
                  paddingHorizontal: 16,
                  borderRadius: 22,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Text style={[s.text, { fontWeight: "600", color: colors.blueText }]}>
                {`${hidden} more heads-up${hidden === 1 ? "" : "s"}`}
              </Text>
              <ChevronDown size={16} color={colors.blueText} />
            </Pressable>
          )}
        </View>
      )}
    </>
  );
}

const LEVELS: { id: HeadsUpSettings["chatty"]; label: string; detail: string }[] = [
  {
    id: "important",
    label: "Only the important ones",
    detail: "Clashes, tight gaps and when to head back for a meeting.",
  },
  {
    id: "normal",
    label: "The usual",
    detail: "Also when to leave for appointments, and online meetings about to start.",
  },
  {
    id: "chatty",
    label: "Everything I notice",
    detail: "Also a nudge before every event, and when you have a long stretch with no break.",
  },
];
const LEVEL_SAID: Record<HeadsUpSettings["chatty"], string> = {
  important: "Okay, I’ll tell you only the important ones.",
  normal: "Okay, I’ll tell you the usual.",
  chatty: "Okay, I’ll tell you everything I notice.",
};

/** A line they can say, tapped to start it in the chat (nothing is sent unless it only asks). */
function SayLine({ text, send }: { text: string; send?: boolean }) {
  const { ask, draft } = useWorkspace();
  const Icon = send ? MessageCircle : PenLine;
  return (
    <Pressable
      role="button"
      aria-label={send ? `Ask: ${text}` : `Start a message: ${text}`}
      onPress={() => (send ? ask(text) : draft(text))}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 14,
        backgroundColor: pressed ? colors.blue : dark ? colors.subtle : colors.card,
      })}
    >
      <Icon size={16} color={colors.blueDark} />
      <Text style={[s.text, { flex: 1 }]}>{`“${text}”`}</Text>
    </Pressable>
  );
}

/** What's wrong with the calendar, in the settings card: what the server saw on its last look. */
function LookNotice({ state }: { state: HeadsUpsState }) {
  const goTo = useGoTo();
  const none = state.look === "none" || state.calendar === false;
  if (none || state.look === "failed")
    return (
      <View
        style={{
          gap: 8,
          padding: 12,
          borderRadius: 16,
          backgroundColor: colors.sky,
          marginBottom: 6,
        }}
      >
        <Text style={s.text}>
          {none
            ? "I can’t see a calendar yet. Connect one under Apps."
            : "I couldn’t read your calendar last time. Reconnect it under Apps."}
        </Text>
        <Button style={{ ...pill, alignSelf: "flex-start" }} onPress={() => goTo("apps")}>
          {none ? "Connect calendar" : "Reconnect calendar"}
        </Button>
      </View>
    );
  if (state.look === "no-zone")
    return (
      <Text style={[FINE, { marginBottom: 6 }]}>
        I’m still learning your time zone. This should sort itself out within a few minutes; if it
        doesn’t, reload the app.
      </Text>
    );
  return null;
}

/** Apps › Alerts: Heads-ups on or off and how much; more options and what to say are below. */
export function HeadsUpsCard() {
  const { state, save } = useHeadsUps();
  const { notify } = useWorkspace();
  const [error, setError] = useState("");
  const [said, say] = useAnnouncer();
  const [more, setMore] = useState(false);
  if (!state) return null;
  const { settings } = state;
  async function change(patch: Patch, text: string) {
    setError("");
    try {
      await save(patch);
      notify(text);
      say(text);
    } catch (e) {
      setError(message(e));
      say(message(e));
    }
  }
  const group = (title: string, id: string) => (
    <Text nativeID={id} accessibilityRole="header" style={[s.text, { fontWeight: "600" }]}>
      {title}
    </Text>
  );
  const emailOff = state.email === false;
  return (
    <Card style={{ gap: 6 }}>
      {settings.on && <LookNotice state={state} />}
      <SwitchRow
        strong
        label="Heads-ups"
        detail="I watch your calendar and tell you when something needs attention, like when to leave or two things at once."
        checked={settings.on}
        onPress={() =>
          void change(
            { on: !settings.on },
            settings.on ? "Okay, heads-ups are off." : "Okay, heads-ups are on.",
          )
        }
        leading={
          <View style={[s.iconBox, { backgroundColor: colors.sky }]}>
            <Clock size={20} color={colors.blueDark} />
          </View>
        }
      />
      {settings.on && (
        <Text style={[FINE, { marginLeft: 56 }]}>
          I stay quiet from 10 pm to 7 am, or the quiet hours you’ve told me. Say “quiet hours 9 pm
          to 8 am” to change it.
        </Text>
      )}
      {settings.on && (
        <View
          style={{
            gap: 14,
            marginTop: 10,
            paddingTop: 16,
            borderTopWidth: 1,
            borderTopColor: colors.line,
          }}
        >
          <View style={{ gap: 2 }}>
            {group("How much I tell you", "headsups-level")}
            <View role="radiogroup" aria-labelledby="headsups-level">
              {LEVELS.map((level) => (
                <CheckRow
                  key={level.id}
                  radio
                  label={level.label}
                  detail={level.detail}
                  checked={settings.chatty === level.id}
                  onPress={() => void change({ chatty: level.id }, LEVEL_SAID[level.id])}
                />
              ))}
            </View>
          </View>
          <Pressable
            role="button"
            aria-expanded={more}
            aria-label="More options"
            onPress={() => setMore(!more)}
            style={({ pressed }) => [
              s.between,
              {
                minHeight: 44,
                paddingHorizontal: 14,
                borderRadius: 22,
                backgroundColor: colors.subtle,
                borderWidth: 1,
                borderColor: colors.edge,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[s.text, { fontWeight: "600" }]}>More options</Text>
            {more ? (
              <ChevronUp size={18} color={colors.text} />
            ) : (
              <ChevronDown size={18} color={colors.text} />
            )}
          </Pressable>
          {more && (
            <View style={{ gap: 18 }}>
              <View style={{ gap: 8 }}>
                {group("Your usual travel time", "headsups-travel")}
                <View
                  role="radiogroup"
                  aria-labelledby="headsups-travel"
                  style={[s.row, { gap: 8 }]}
                >
                  {TRAVEL_BUFFERS.map((minutes) => {
                    const picked = settings.travelBuffer === minutes;
                    const pick = () =>
                      void change(
                        { travelBuffer: minutes },
                        `Okay, I’ll plan for ${minutes} minutes of travel.`,
                      );
                    return (
                      <Pressable
                        key={minutes}
                        role="radio"
                        aria-checked={picked}
                        aria-label={`${minutes} minutes`}
                        accessibilityState={{ checked: picked }}
                        onPress={pick}
                        {...({
                          onKeyDown: (event: { key?: string; preventDefault?: () => void }) => {
                            if (event.key !== " ") return;
                            event.preventDefault?.();
                            pick();
                          },
                        } as object)}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          minHeight: 44,
                          borderRadius: 22,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: picked ? colors.inverse : colors.subtle,
                          borderWidth: 1.5,
                          borderColor: picked ? colors.inverse : colors.edge,
                        }}
                      >
                        <Text
                          numberOfLines={1}
                          style={[s.buttonText, { color: picked ? colors.onInverse : colors.text }]}
                        >
                          {`${minutes} min`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={FINE}>
                  The time you usually need to get from one place to another. I use it to work out
                  when to leave. I don’t check traffic.
                </Text>
              </View>
              <View style={{ gap: 2 }}>
                {group("Also tell me by", "headsups-by")}
                <View role="group" aria-labelledby="headsups-by">
                  <SwitchRow
                    label="Phone notifications"
                    detail="Also needs notifications turned on for this device, under Phone app & notifications. I send at most 4, 8 or 15 a day, depending on how much you want to hear. Meetings about to start show in the app but don’t buzz your phone."
                    checked={settings.channels.push}
                    onPress={() =>
                      void change(
                        { channels: { push: !settings.channels.push } },
                        settings.channels.push
                          ? "Okay, no phone notifications for heads-ups."
                          : "Okay, I’ll send heads-ups to your phone.",
                      )
                    }
                  />
                  <SwitchRow
                    label="Email"
                    detail={
                      emailOff
                        ? "Email isn’t available yet."
                        : "Email is only for things that can wait, like two things overlapping or a long stretch with no break."
                    }
                    disabled={emailOff}
                    checked={settings.channels.email}
                    onPress={() =>
                      void change(
                        { channels: { email: !settings.channels.email } },
                        settings.channels.email
                          ? "Okay, no emails for heads-ups."
                          : "Okay, I’ll email you the ones that can wait.",
                      )
                    }
                  />
                </View>
                <Text style={[FINE, { marginTop: 6 }]}>
                  On a live call, “Urgent alerts on calls” speaks up about what’s coming. That’s
                  separate.
                </Text>
              </View>
              <View style={{ gap: 2 }}>
                {group("What I watch for", "headsups-kinds")}
                <View role="group" aria-labelledby="headsups-kinds">
                  {state.kinds.map((item) => (
                    <SwitchRow
                      key={item.kind}
                      label={item.label}
                      checked={item.on}
                      onPress={() =>
                        void change(
                          { kinds: { [item.kind]: !item.on } },
                          item.on
                            ? `Okay, “${item.label}” is off.`
                            : `Okay, “${item.label}” is on.`,
                        )
                      }
                    />
                  ))}
                </View>
              </View>
            </View>
          )}
          <View
            role="group"
            aria-label="You can also say"
            style={{ gap: 8, padding: 14, borderRadius: 18, backgroundColor: colors.sky }}
          >
            <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: "700", color: colors.text }}>
              You can also say
            </Text>
            <Text style={FINE}>Tap one to try it.</Text>
            <SayLine send text="What are my heads-ups?" />
            <SayLine text="Only tell me the important ones" />
            <SayLine text="It takes me 45 minutes to get anywhere" />
          </View>
        </View>
      )}
      <ErrorNotice error={error} />
      <StatusLine text={said} />
    </Card>
  );
}
