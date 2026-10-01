import type { LucideIcon } from "lucide-react-native";
import { AlarmClock, ArrowRight, Bell, Check, CircleAlert, Hand, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, useWindowDimensions, View } from "react-native";
import type {
  AgentIdentity,
  AgentNotification,
  AgentTask,
} from "../../../packages/domain/src/agent";
import { useAgentWorkspace } from "./agent-workspace";
import { dark } from "./theme";
import { tipProps } from "./tips";
import { Button, colors, ErrorNotice, plainPreview, s } from "./ui";
import { useWorkspace } from "./workspace";

/** Where background updates show: a pop-up by the bell, only in the bell, or as a card in chat. */
export type UpdatesDisplay = "popup" | "bell" | "chat";
export function updatesDisplay(
  identity?: Pick<AgentIdentity, "updatesDisplay" | "showChatUpdates">,
): UpdatesDisplay {
  return identity?.updatesDisplay ?? (identity?.showChatUpdates === false ? "bell" : "popup");
}

/** When the person last typed in chat: a pop-up waits until they pause. */
let lastTyped = 0;
export function noteTyping() {
  lastTyped = Date.now();
}
const QUIET_MS = 4000;
const SHOW_MS = 8000;

/** A reminder going off, a task waiting on the person, or anything else. */
export type UpdateKind = "reminder" | "decision" | "update";
export function updateKind(item: AgentNotification, tasks?: AgentTask[]): UpdateKind {
  if (item.reminderId && !item.taskId) return "reminder";
  // Something saved for approval outside a job (from a live call) waits on the person.
  if (item.actionId && !item.taskId) return "decision";
  const task = tasks?.find((t) => t.id === item.taskId);
  return task && ["waiting_input", "waiting_approval"].includes(task.status)
    ? "decision"
    : "update";
}

/** A routine's title without the day it ran: the pop-up is always about just now. */
const withoutDay = (title: string) => title.replace(/ · [A-Z][a-z]{2,3} \d{1,2}$/, "");
/** A reminder's title is only "Reminder"; what it's about is its body. */
const nameOf = (item: AgentNotification) =>
  item.reminderId && !item.taskId ? item.body : withoutDay(item.title);
/** "Morning brief, Book the table and 3 more": each name without its own closing mark. */
function namesOf(items: AgentNotification[]) {
  const names = items.map((item) => nameOf(item).replace(/[?.!]+$/, ""));
  const rest = names.length - 2;
  return `${names.slice(0, 2).join(", ")}${rest > 0 ? ` and ${rest} more` : ""}`;
}
/** A reminder's title is "Reminder", or "Reminder (from 3:00 PM)" when it went off late. */
export function lateNote(title: string) {
  const from = /^Reminder \(from (.+)\)$/.exec(title)?.[1];
  return from ? `From ${from}` : "";
}

/** Reminders and decisions put off on this device, so a reload doesn't bring them back. */
const PUT_OFF = "openmuse.popup-later";
function putOff(): string[] {
  try {
    const ids: unknown = JSON.parse(globalThis.localStorage?.getItem(PUT_OFF) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
function rememberPutOff(ids: string[]) {
  try {
    const kept = [...new Set([...putOff(), ...ids])].slice(-100);
    globalThis.localStorage?.setItem(PUT_OFF, JSON.stringify(kept));
  } catch {
    // Private browsing: it may pop up again after a reload, and that's all.
  }
}

interface Toast {
  kind: UpdateKind;
  items: AgentNotification[];
}
const hidden = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  opacity: 0,
} as const;

/**
 * Background updates (a routine's result, a reminder going off) pop up briefly under the bell
 * instead of landing in the conversation. Things that need the person stay until they act; the
 * rest slide away and wait in the bell. Nothing pops up while they're typing, a reply is being
 * written or a sheet is open (`hold`).
 */
export function UpdateToasts({ hold }: { hold: boolean }) {
  const { data, mutate, refresh } = useAgentWorkspace();
  const { open, api, section } = useWorkspace();
  const { width } = useWindowDimensions();
  const narrow = width < 760;
  const display = updatesDisplay(data?.identity);
  /** Updates already shown, put off, or waiting in the bell from before the app opened. */
  const seen = useRef<Set<string>>(undefined);
  const [queue, setQueue] = useState<AgentNotification[]>([]);
  const [toast, setToast] = useState<Toast>();
  // The pop-up stays while the pointer rests on it, a finger touched it, or focus is inside it.
  const [hovering, setHovering] = useState(false);
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  /** One sentence for screen readers; the card itself arrives too suddenly to be announced. */
  const [said, setSaid] = useState<{ text: string; urgent: boolean }>();
  /** Bumped each second while a pop-up waits for a pause, to look again. */
  const [tick, setTick] = useState(0);
  const fade = useRef(new Animated.Value(0)).current;
  const card = useRef<View>(null);
  /** Where focus was before it moved into the pop-up, to put it back when the pop-up goes. */
  const returnTo = useRef<HTMLElement | null>(null);

  const tasks = data?.tasks;
  const kindOf = (item: AgentNotification) => updateKind(item, tasks);
  const handedOff = (item: AgentNotification) =>
    tasks?.find((t) => t.id === item.taskId && t.input.handedOff === true);
  /** A job the person handed off is finished: its pop-up stays until they open or close it. */
  const jobDone = (item: AgentNotification) => handedOff(item)?.status === "succeeded";
  /** A job the person handed off couldn't be finished: it stays too. */
  const jobFailed = (item: AgentNotification) => handedOff(item)?.status === "failed";
  const jobEnded = (item: AgentNotification) => jobDone(item) || jobFailed(item);

  // New unread updates join the queue. At first load, only what needs the person pops up (and
  // wasn't put off here before); the rest is already waiting in the bell.
  const notifications = data?.notifications;
  useEffect(() => {
    if (!notifications) return;
    const candidates = notifications.filter(
      (n) => !n.read && !n.checkInId && (n.taskId || n.reminderId),
    );
    if (!seen.current) {
      // Jobs that finished while the app was closed still pop up; other updates wait in the bell.
      seen.current = new Set([
        ...putOff(),
        ...candidates.filter((n) => kindOf(n) === "update" && !jobEnded(n)).map((n) => n.id),
      ]);
    }
    const unread = new Set(candidates.map((n) => n.id));
    const known = seen.current;
    setQueue((current) => {
      const kept = current.filter((n) => unread.has(n.id));
      const fresh = candidates.filter((n) => !known.has(n.id) && !kept.some((k) => k.id === n.id));
      return fresh.length || kept.length !== current.length ? [...kept, ...fresh] : current;
    });
  }, [notifications]);

  /** Fades the pop-up out, then clears it; the update waits in the bell. */
  const dismiss = useCallback(() => {
    // Focus inside the card goes back where it came from instead of falling to the page.
    const node = card.current as unknown as HTMLElement | null;
    if (typeof document !== "undefined" && node?.contains?.(document.activeElement)) {
      if (returnTo.current?.isConnected) returnTo.current.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
    }
    returnTo.current = null;
    setSaid(undefined);
    Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: false }).start(() =>
      setToast(undefined),
    );
  }, [fade]);

  // Escape closes it while focus is inside, and its keyup is held back so nothing else closes too.
  useEffect(() => {
    if (!toast || typeof document === "undefined") return;
    let closing = false;
    const inside = () => {
      const node = card.current as unknown as HTMLElement | null;
      return !!node?.contains(document.activeElement);
    };
    const down = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !inside()) return;
      closing = true;
      event.stopPropagation();
      event.preventDefault();
      laterRef.current?.();
    };
    const up = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !closing) return;
      closing = false;
      event.stopPropagation();
    };
    document.addEventListener("keydown", down, true);
    document.addEventListener("keyup", up, true);
    return () => {
      document.removeEventListener("keydown", down, true);
      document.removeEventListener("keyup", up, true);
    };
  }, [toast]);
  const laterRef = useRef<() => void>(undefined);

  // Read elsewhere (in the bell, on another device): it goes away here too.
  useEffect(() => {
    if (!toast || !notifications) return;
    const unread = new Set(notifications.filter((n) => !n.read).map((n) => n.id));
    if (toast.items.every((n) => !unread.has(n.id))) dismiss();
  }, [notifications, toast, dismiss]);

  // Shows the next pop-up once the person pauses.
  useEffect(() => {
    if (toast || !queue.length) return;
    if (display !== "popup") {
      for (const n of queue) seen.current?.add(n.id);
      setQueue([]);
      return;
    }
    const quiet = !hold && Date.now() - lastTyped > QUIET_MS;
    if (!quiet) {
      const timer = setTimeout(() => setTick((n) => n + 1), 1000);
      return () => clearTimeout(timer);
    }
    // Everything that needs the person comes first, as one card when there's more than one.
    const urgent = queue.filter((n) => kindOf(n) !== "update");
    const next: Toast =
      urgent.length === 1 && urgent[0]
        ? { kind: kindOf(urgent[0]), items: urgent }
        : urgent.length
          ? { kind: "decision", items: urgent }
          : { kind: "update", items: queue };
    for (const n of next.items) seen.current?.add(n.id);
    setQueue((current) => current.filter((n) => !next.items.includes(n)));
    setError("");
    setHovering(false);
    setTouched(false);
    setFocused(false);
    setToast(next);
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: false }).start();
  }, [toast, queue, hold, display, fade, tick]);

  // Updates that don't need the person slide away, unless someone is looking at or using them.
  const paused = hovering || touched || focused || working || !!error;
  const done = !!toast?.items.some(jobEnded);
  const failed = !!toast && toast.items.length === 1 && toast.items.every(jobFailed);
  const allDone = !!toast && toast.items.length > 1 && toast.items.every(jobDone);
  /** One finished job, or several all finished: the green tick, tile and label. */
  const doneLook = allDone || (done && !failed && toast?.items.length === 1);
  useEffect(() => {
    if (toast?.kind !== "update" || paused || done) return;
    const timer = setTimeout(dismiss, SHOW_MS);
    return () => clearTimeout(timer);
  }, [toast, paused, dismiss, done]);

  const first = display === "popup" ? toast?.items[0] : undefined;
  const count = toast?.items.length ?? 0;
  const many = count > 1;
  const kind = toast?.kind ?? "update";
  const label =
    kind === "update"
      ? many
        ? allDone
          ? "Done"
          : "Updates"
        : failed
          ? "Couldn’t finish"
          : done
            ? "Done"
            : "Update"
      : kind === "reminder"
        ? "Reminder"
        : "Needs you";
  const heading = !first
    ? ""
    : many
      ? kind === "update"
        ? allDone
          ? `${count} jobs done`
          : `${count} new updates`
        : `${count} things need you`
      : (handedOff(first)?.title ?? nameOf(first));

  // Said once when the card appears: reminders interrupt, everything else waits its turn.
  useEffect(() => {
    if (!toast || !heading) return;
    const end = (text: string) => (/[?.!]$/.test(text) ? text : `${text}.`);
    const text = many
      ? kind === "update"
        ? `${heading}: ${namesOf(toast.items)}. They're in the bell.`
        : `${heading}: ${namesOf(toast.items)}.`
      : kind === "update"
        ? toast.items.some(jobEnded)
          ? `${label}: ${end(heading)}`
          : `Update: ${end(heading)} It's in the bell.`
        : `${label}: ${end(heading)}`;
    setSaid({ text, urgent: kind === "reminder" && !many });
  }, [toast]);

  const announcer = (
    <>
      <Text role="status" aria-live="polite" style={hidden}>
        {said && !said.urgent ? said.text : ""}
      </Text>
      <Text role="alert" style={hidden}>
        {said?.urgent ? said.text : ""}
      </Text>
    </>
  );
  // The same shape either way, so the hidden regions stay mounted and are heard when they change.
  if (!toast || !first) return <>{announcer}</>;

  const later = () => {
    if (kind !== "update" || done) rememberPutOff(toast.items.map((n) => n.id));
    dismiss();
  };
  laterRef.current = later;
  async function act(work: () => Promise<unknown>) {
    setWorking(true);
    try {
      await work();
      dismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }
  const openTask = (taskId: string) =>
    act(async () => {
      await mutate("/notifications/read", { taskId });
      open({ type: "task", taskId });
    });
  const reminderDone = () => act(() => mutate(`/notifications/${first.id}/read`, {}));
  const snooze = () =>
    act(async () => {
      await api.request(`/api/reminders/${first.reminderId}/snooze`, { minutes: 10 });
      await mutate(`/notifications/${first.id}/read`, {});
      await refresh();
    });
  const seeAll = () => {
    later();
    open({ type: "notifications" });
  };

  const Icon: LucideIcon =
    kind === "reminder"
      ? AlarmClock
      : kind === "decision"
        ? Hand
        : failed
          ? CircleAlert
          : doneLook
            ? Check
            : Bell;
  const detail = many
    ? namesOf(toast.items)
    : kind === "reminder"
      ? lateNote(first.title)
      : plainPreview(first.body);
  return (
    <>
      {announcer}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          zIndex: 50,
          opacity: fade,
          transform: [
            { translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) },
          ],
          // On phones, a banner below the menu and bell (and the agent's name in chat).
          ...(narrow
            ? { top: section === "chat" ? 86 : 64, left: 12, right: 12 }
            : { top: 68, right: 20, width: 300 }),
        }}
      >
        <View
          ref={card}
          role="group"
          aria-label={many ? heading : `${label}: ${heading}`}
          onPointerEnter={(e) => e.nativeEvent.pointerType === "mouse" && setHovering(true)}
          onPointerLeave={() => setHovering(false)}
          onTouchStart={() => setTouched(true)}
          onFocus={(e) => {
            if (focused) return;
            const from = (e.nativeEvent as unknown as { relatedTarget?: unknown }).relatedTarget;
            const node = card.current as unknown as HTMLElement | null;
            if (from instanceof HTMLElement && !node?.contains(from)) returnTo.current = from;
            setFocused(true);
          }}
          onBlur={(e) => {
            const to = (e.nativeEvent as unknown as { relatedTarget?: unknown }).relatedTarget;
            const node = card.current as unknown as HTMLElement | null;
            if (!(to instanceof Node && node?.contains(to))) setFocused(false);
          }}
          style={{
            // In the dark, the card is lighter than what it floats over and casts a deeper shadow.
            backgroundColor: dark ? colors.surface : colors.card,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: dark ? colors.subtle : colors.line,
            padding: 14,
            gap: 10,
            shadowColor: dark ? "#000" : "#11191C",
            shadowOpacity: dark ? 0.5 : 0.16,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 10 },
            elevation: 8,
          }}
        >
          <View style={[s.row, { gap: 10, alignItems: "flex-start", paddingRight: 18 }]}>
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 10,
                backgroundColor: failed
                  ? colors.errorBg
                  : doneLook
                    ? colors.green
                    : kind === "update"
                      ? colors.sky
                      : colors.lavender,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon
                size={15}
                color={failed ? colors.danger : doneLook ? colors.greenText : colors.blueDark}
              />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={[
                  s.small,
                  failed
                    ? { color: colors.danger, fontWeight: "600" }
                    : doneLook
                      ? { color: colors.greenText, fontWeight: "600" }
                      : null,
                ]}
              >
                {label}
              </Text>
              <Text numberOfLines={2} style={[s.text, { fontWeight: "600" }]}>
                {heading}
              </Text>
              {!!detail && (
                <Text
                  numberOfLines={narrow ? 1 : 2}
                  style={[s.muted, { fontSize: 13, lineHeight: 19 }]}
                >
                  {detail}
                </Text>
              )}
            </View>
          </View>
          <View style={[s.row, { gap: 8, flexWrap: "wrap", marginLeft: 40 }]}>
            {many ? (
              <Button small primary icon={ArrowRight} onPress={seeAll}>
                {kind === "update" && !allDone ? "See updates" : "See them"}
              </Button>
            ) : kind === "reminder" ? (
              <>
                <Button
                  small
                  primary
                  icon={Check}
                  busy={working}
                  onPress={() => void reminderDone()}
                >
                  Done
                </Button>
                <Button small disabled={working} onPress={() => void snooze()}>
                  In 10 minutes
                </Button>
              </>
            ) : (
              <>
                <Button
                  small
                  primary
                  icon={ArrowRight}
                  busy={working}
                  onPress={() => first.taskId && void openTask(first.taskId)}
                >
                  Open
                </Button>
                {kind === "decision" && (
                  <Button small disabled={working} onPress={later}>
                    Later
                  </Button>
                )}
              </>
            )}
          </View>
          {!!error && (
            <View style={{ marginLeft: 40 }}>
              <ErrorNotice error={error} />
            </View>
          )}
          {/* Last in the tab order, after the card's own actions; shown in the top corner. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close. It stays under Updates."
            {...tipProps("Close. It stays under Updates.")}
            onPress={later}
            style={{ position: "absolute", top: 8, right: 8, padding: 14, margin: -10 }}
          >
            <X size={16} color={colors.muted} />
          </Pressable>
        </View>
      </Animated.View>
    </>
  );
}
