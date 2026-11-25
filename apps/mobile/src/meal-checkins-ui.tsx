import {
  ArrowUp,
  BellRing,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Mic,
  Minus,
  Pencil,
  Plus,
  Repeat,
  SkipForward,
  Trash2,
  Utensils,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { Button, Card, CheckRow, colors, ErrorNotice, Field, Sheet, s } from "./ui";
import { voiceSettings } from "./voice";
import { CHECK_IN_OPENED, dictate, dictationAvailable } from "./web-app";

/** Sent after a check-in is answered, skipped or put off, so every chat's card catches up. */
const CHECK_INS_CHANGED = "muse-checkins-changed";
const changed = () => {
  if (typeof window !== "undefined" && window.dispatchEvent)
    window.dispatchEvent(new Event(CHECK_INS_CHANGED));
};

import { showSpace } from "./space-view";
import { tipProps } from "./tips";
import { foldNotice } from "./update-toasts";
import { useWorkspace } from "./workspace";

type Meal = "breakfast" | "lunch" | "dinner";
const MEALS: Meal[] = ["breakfast", "lunch", "dinner"];
export const MEAL_NAMES: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};
interface CheckIn {
  id: string;
  day: string;
  meal: Meal;
  askedAt: string;
  question: string;
  yesterday?: { title: string; calories?: number };
}
interface Settings {
  enabled: boolean;
  times: Record<Meal, string>;
  meals: Meal[];
  days: number[];
}
interface CheckIns {
  settings: Settings;
  replaced: { id: string; title: string; time: string; enabled: boolean }[];
  open: CheckIn[];
}
export interface MealEntry {
  id: string;
  title: string;
  at: string;
  meal?: string;
  items?: string[];
  calories?: number;
  protein?: number;
  estimated?: boolean;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** "12:30" → "12:30 PM", in the person's own clock style. */
export function clockTime(time: string) {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
const shiftTime = (time: string, minutes: number) => {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const total = (((hour * 60 + minute + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const kcal = (value?: number) =>
  value === undefined ? "" : `${Math.round(value).toLocaleString()} calories`;

export function useCheckIns() {
  const { api } = useWorkspace();
  const { data } = useAgentWorkspace();
  const [state, setState] = useState<CheckIns>();
  const load = useCallback(
    () => api.request<CheckIns>("/api/meal-checkins").then(setState, () => undefined),
    [api],
  );
  // A new notification may be a new check-in; a tapped one certainly is.
  const latest = data?.notifications[0]?.id;
  useEffect(() => {
    void latest;
    void load();
  }, [load, latest]);
  useEffect(() => {
    if (typeof window === "undefined" || !window.addEventListener) return;
    const reload = () => void load();
    window.addEventListener(CHECK_IN_OPENED, reload);
    window.addEventListener(CHECK_INS_CHANGED, reload);
    return () => {
      window.removeEventListener(CHECK_IN_OPENED, reload);
      window.removeEventListener(CHECK_INS_CHANGED, reload);
    };
  }, [load]);
  return { state, load };
}

/**
 * Answer by talking or typing. The mic fills the box, so the person sees what was heard before it
 * goes to their agent.
 */
export function SayOrType({
  placeholder,
  prompt,
  micLabel: sayLabel = "Say what you had",
  action,
  busy,
  listenNow,
  inline,
  onSubmit,
}: {
  placeholder: string;
  /** What the inline box shows before anything is typed, instead of "Type it, or tap the mic". */
  prompt?: string;
  /** The mic's name for screen readers. */
  micLabel?: string;
  /** Mic beside the box, for tight spaces such as above the chat box. */
  inline?: boolean;
  /** What the send button does, such as "Log lunch". */
  action: string;
  busy?: boolean;
  /** Start listening as soon as it appears. */
  listenNow?: boolean;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [height, setHeight] = useState(40);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const stop = useRef<() => void>(undefined);
  const canListen = dictationAvailable();
  const listen = useCallback(() => {
    if (stop.current && listening) return stop.current();
    setError("");
    setListening(true);
    stop.current = dictate(
      (heard) => setText((current) => (current.trim() ? `${current.trimEnd()} ${heard}` : heard)),
      (problem) => {
        setListening(false);
        stop.current = undefined;
        if (problem) setError(problem);
      },
      voiceSettings().microphone,
    );
  }, [listening]);
  const started = useRef(false);
  useEffect(() => {
    if (listenNow && canListen && !started.current) {
      started.current = true;
      listen();
    }
  }, [listenNow, canListen, listen]);
  useEffect(() => () => stop.current?.(), []);
  const send = () => {
    const clean = text.trim();
    if (!clean || busy) return;
    stop.current?.();
    onSubmit(clean);
    setText("");
  };
  const mic = (size: number) => (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: listening ? colors.blueDark : colors.inverse,
        shadowColor: "#18384B",
        shadowOpacity: 0.16,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      }}
    >
      <Mic size={size * 0.43} color={listening ? colors.canvas : colors.onInverse} />
    </View>
  );
  const box = (
    <View
      style={[
        s.row,
        {
          flex: inline ? 1 : undefined,
          gap: 8,
          backgroundColor: colors.surface,
          borderRadius: 26,
          borderWidth: 1,
          borderColor: listening ? colors.blueDark : colors.line,
          paddingLeft: 16,
          paddingRight: 4,
          paddingVertical: 4,
        },
      ]}
    >
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={
          listening
            ? "Listening… tap the mic when you’re done"
            : inline && canListen
              ? (prompt ?? "Type it, or tap the mic")
              : canListen
                ? `Or type it: ${placeholder}`
                : placeholder
        }
        placeholderTextColor={listening ? colors.blueDark : colors.muted}
        accessibilityLabel={placeholder}
        returnKeyType="send"
        onSubmitEditing={send}
        multiline
        blurOnSubmit
        selectionColor={colors.blueDark}
        onContentSizeChange={(event) =>
          setHeight(Math.max(40, Math.min(110, event.nativeEvent.contentSize.height)))
        }
        style={{
          flex: 1,
          color: colors.text,
          fontSize: 16,
          lineHeight: 22,
          paddingVertical: 9,
          height,
          minHeight: 40,
          maxHeight: 110,
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action}
        {...tipProps(action)}
        disabled={!text.trim() || busy}
        onPress={send}
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: text.trim() ? colors.inverse : colors.subtle,
        }}
      >
        {busy ? (
          <ActivityIndicator color={colors.onInverse} />
        ) : (
          <ArrowUp size={20} color={text.trim() ? colors.onInverse : colors.muted} />
        )}
      </Pressable>
    </View>
  );
  const micLabel = listening ? "Stop listening" : sayLabel;
  return (
    <View style={{ gap: 12 }}>
      {inline ? (
        <View style={[s.row, { gap: 10 }]}>
          {canListen && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={micLabel}
              accessibilityState={{ selected: listening }}
              onPress={listen}
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
            >
              {mic(52)}
            </Pressable>
          )}
          {box}
        </View>
      ) : (
        <>
          {canListen && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={micLabel}
              accessibilityState={{ selected: listening }}
              onPress={listen}
              style={({ pressed }) => [
                s.row,
                {
                  gap: 14,
                  alignSelf: "flex-start",
                  paddingRight: 18,
                  borderRadius: 40,
                  backgroundColor: listening
                    ? colors.lavender
                    : pressed
                      ? colors.subtle
                      : "transparent",
                },
              ]}
            >
              {mic(60)}
              <View style={{ gap: 1 }}>
                <Text style={[s.text, { fontWeight: "600" }]}>
                  {listening ? "Listening…" : "Tap and say it"}
                </Text>
                <Text style={[s.small, { color: colors.mutedStrong }]}>
                  {listening ? "Tap again when you’re done" : "Like “a turkey sandwich and chips”"}
                </Text>
              </View>
            </Pressable>
          )}
          {box}
        </>
      )}
      {!canListen && (
        <Text style={[s.small, { color: colors.mutedStrong }]}>
          To talk instead, tap the mic on your phone’s keyboard.
        </Text>
      )}
      <ErrorNotice error={error} />
    </View>
  );
}

/**
 * "What did you have for lunch?" as one slim line just above the chat box, until it's answered,
 * skipped or put off. Answer starts listening in the message box with "Log my lunch: " already in
 * it (or puts the cursor there, without a microphone), so there's only one place to type or talk;
 * logging the meal in chat closes the check-in on the server. The quick answers (same as
 * yesterday, skipped, later) sit in the line on a wide screen and open above it on a phone, so the
 * line itself never moves under a thumb.
 */
export function MealCheckInCard({
  replying,
  active,
  hidden,
  quiet,
  onAnswer,
  onDone,
}: {
  replying?: boolean;
  active?: boolean;
  /** Being answered in the message box right now. */
  hidden?: boolean;
  /** A heads-up is showing above it: it keeps the colour, this steps back. */
  quiet?: boolean;
  onAnswer: (prefix: string) => void;
  /** After a quick answer the line goes: keyboard focus goes back to the message box. */
  onDone: () => void;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const { api, notify } = useWorkspace();
  const { state, load } = useCheckIns();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const [width, setWidth] = useState(0);
  // A meal logged in chat (a photo, "had soup for lunch") answers its check-in on the server.
  const wasReplying = useRef(false);
  // Chats stay open in the background; one coming back into view checks again.
  useEffect(() => {
    if (active) void load();
  }, [active, load]);
  useEffect(() => {
    if (wasReplying.current && !replying) void load();
    wasReplying.current = !!replying;
  }, [replying, load]);
  const checkIn = state?.open[0];
  // A different question starts folded.
  const id = checkIn?.id;
  useEffect(() => {
    void id;
    setMore(false);
    setError("");
  }, [id]);
  if (!checkIn || hidden) return null;
  const meal = MEAL_NAMES[checkIn.meal]?.toLowerCase() ?? "meal";
  async function run(kind: string, path: string, done: (result: never) => string) {
    if (!checkIn) return;
    setBusy(kind);
    setError("");
    try {
      const result = await api.request<never>(`/api/meal-checkins/${checkIn.id}/${path}`, {});
      notify(done(result));
      changed();
      await load();
      // The line goes away with the question: keyboard focus goes to the message box.
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(undefined);
    }
  }
  const yesterday = checkIn.yesterday;
  const yesterdayWords = yesterday
    ? `${yesterday.title}${yesterday.calories === undefined ? "" : ` · ${kcal(yesterday.calories)}`}`
    : "";
  // Spoken names contain the visible words ("tap Later" by voice control works) and no "·".
  const yesterdaySaid = yesterday
    ? `${yesterday.title}${yesterday.calories === undefined ? "" : `, ${kcal(yesterday.calories)}`}`
    : "";
  // Measured, not the window: the chat column is capped at 760px.
  const wide = width >= 600;
  const tiny = width > 0 && width < 420;
  const question =
    // The short form where room is tight: a phone, or the line with its choices beside it.
    (tiny || wide || quiet) && checkIn.question === `What did you have for ${meal}?`
      ? `What was ${meal}?`
      : checkIn.question;
  const canSay = dictationAvailable();
  const target = { minHeight: 44 } as const;
  const chip = {
    ...target,
    backgroundColor: colors.card,
    // An edge keeps each one a button, on the tint, on the card colour and in the dark alike.
    borderWidth: 1,
    borderColor: colors.edge,
    ...(wide ? {} : { flex: 1, flexBasis: 0, paddingHorizontal: 8 }),
  } as const;
  const choices = [
    yesterday && (
      <Button
        key="same"
        small
        icon={tiny ? undefined : Repeat}
        busy={busy === "same"}
        disabled={!!busy}
        style={chip}
        accessibilityLabel={`Same again: same as yesterday, ${yesterdaySaid}`}
        {...tipProps(`Same again: same as yesterday, ${yesterdaySaid}`)}
        onPress={() =>
          void run("same", "same", () => `Logged ${yesterday.title} for ${meal} again.`)
        }
      >
        Same again
      </Button>
    ),
    <Button
      key="skip"
      small
      icon={tiny ? undefined : SkipForward}
      busy={busy === "skip"}
      disabled={!!busy}
      style={chip}
      accessibilityLabel="Skipped"
      onPress={() => void run("skip", "skip", () => `Okay, no ${meal} logged today.`)}
    >
      Skipped
    </Button>,
    <Button
      key="later"
      small
      icon={tiny ? undefined : Clock}
      busy={busy === "snooze"}
      disabled={!!busy}
      style={chip}
      accessibilityLabel="Later: ask again in an hour"
      {...tipProps("Later: ask again in an hour")}
      onPress={() =>
        void run(
          "snooze",
          "snooze",
          (result: { remindAt: string }) =>
            `I’ll ask again at ${new Date(result.remindAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}.`,
        )
      }
    >
      Later
    </Button>,
  ].filter(Boolean);
  const choiceNames = [yesterday && "Same again", "Skipped", "Later"].filter(Boolean).join(", ");
  return (
    <View
      role="group"
      aria-label={`${MEAL_NAMES[checkIn.meal] ?? "Meal"} check-in`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{
        marginBottom: 10,
        borderRadius: 23,
        backgroundColor: quiet ? colors.card : colors.sky,
        borderWidth: 1,
        borderColor: colors.blue,
      }}
    >
      {/* Above the line, so opening them never moves the line's own buttons. */}
      {more && !wide && (
        <View style={{ gap: 8, paddingHorizontal: 16, paddingTop: 10 }}>
          {/* Only with room: the words are in Same again's own name and tip too. */}
          {!!yesterday && windowHeight >= 760 && (
            <Text style={{ color: colors.mutedStrong, fontSize: 12, lineHeight: 17 }}>
              {`Yesterday: ${yesterdayWords}`}
            </Text>
          )}
          <View style={[s.row, { gap: 6, flexWrap: "nowrap" }]}>{choices}</View>
        </View>
      )}
      <View style={[s.row, { gap: 10, minHeight: 52, paddingLeft: 16, paddingRight: 4 }]}>
        <Utensils size={17} color={colors.blueDark} />
        <Text numberOfLines={1} style={[s.heading, { flex: 1, fontSize: 15, lineHeight: 20 }]}>
          {question}
        </Text>
        {wide && <View style={[s.row, { gap: 6 }]}>{choices}</View>}
        <Button
          small
          icon={canSay ? Mic : undefined}
          style={{
            ...target,
            backgroundColor: colors.card,
            // The main thing to do: a firmer outline than the quick answers beside it.
            borderWidth: 1.5,
            borderColor: colors.blueDark,
          }}
          accessibilityLabel={`${canSay ? "Answer by voice" : "Answer"} in the message box: ${
            checkIn.question
          }`}
          onPress={() => {
            setMore(false);
            onAnswer(`Log my ${meal}: `);
          }}
        >
          Answer
        </Button>
        {wide ? (
          <View style={{ width: 6 }} />
        ) : (
          <Pressable
            role="button"
            aria-expanded={more}
            aria-label={`More choices: ${choiceNames}`}
            {...tipProps("More choices")}
            onPress={() => {
              foldNotice();
              setMore(!more);
            }}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? colors.blue : "transparent",
            })}
          >
            {more ? (
              <ChevronDown size={18} color={colors.mutedStrong} />
            ) : (
              <ChevronUp size={18} color={colors.mutedStrong} />
            )}
          </Pressable>
        )}
      </View>
      {!!error && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
          <ErrorNotice error={error} />
        </View>
      )}
    </View>
  );
}

/** Feed → Today: which meals are logged, today's totals, and a way in. */
export function MealsToday({
  logged,
  line,
}: {
  logged: string[];
  /** Today's totals, such as "1,450 calories · 62 g protein". */
  line: string;
}) {
  const { open, navigate } = useWorkspace();
  // The food log lives in the Health space, with the week's charts.
  const viewLog = () => {
    showSpace("health", "food");
    navigate("spaces");
  };
  return (
    <View style={{ gap: 8, flex: 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Food log. ${MEALS.map(
          (m) => `${MEAL_NAMES[m]} ${logged.includes(m) ? "logged" : "not logged yet"}`,
        ).join(", ")}`}
        onPress={viewLog}
        style={{ gap: 3 }}
      >
        <View style={[s.row, { gap: 12, flexWrap: "wrap" }]}>
          {MEALS.map((meal) => {
            const done = logged.includes(meal);
            return (
              <View key={meal} style={[s.row, { gap: 4 }]}>
                {done ? (
                  <Check size={15} color={colors.greenDark} strokeWidth={2.6} />
                ) : (
                  <Minus size={15} color={colors.muted} />
                )}
                <Text style={[s.text, !done && { color: colors.mutedStrong }]}>
                  {MEAL_NAMES[meal]}
                </Text>
              </View>
            );
          })}
        </View>
        <Text style={[s.small, { color: colors.mutedStrong }]}>
          {line || "Nothing logged today yet"}
        </Text>
      </Pressable>
      <View style={[s.row, { gap: 12, flexWrap: "wrap" }]}>
        <Button small icon={Mic} onPress={() => open({ type: "food", log: true })}>
          Log a meal
        </Button>
        <Pressable
          accessibilityRole="button"
          onPress={viewLog}
          hitSlop={6}
          style={({ pressed }) => ({
            minHeight: 38,
            justifyContent: "center",
            paddingHorizontal: 4,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={[s.text, { textDecorationLine: "underline" }]}>View food log</Text>
        </Pressable>
      </View>
    </View>
  );
}

function TimeStepper({
  meal,
  time,
  disabled,
  onChange,
}: {
  meal: string;
  time: string;
  disabled?: boolean;
  onChange: (time: string) => void;
}) {
  const step = (minutes: number, Icon: typeof Plus, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${meal} 15 minutes ${label}`}
      disabled={disabled}
      onPress={() => onChange(shiftTime(time, minutes))}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.blue : colors.subtle,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Icon size={16} color={colors.text} />
    </Pressable>
  );
  return (
    <View style={[s.row, { gap: 6 }]}>
      {step(-15, Minus, "earlier")}
      <Text
        accessibilityLiveRegion="polite"
        style={[
          s.text,
          { minWidth: 76, textAlign: "center", fontVariant: ["tabular-nums"], fontWeight: "600" },
          disabled && { color: colors.muted },
        ]}
      >
        {clockTime(time)}
      </Text>
      {step(15, Plus, "later")}
    </View>
  );
}

function CheckInSettings({ state, reload }: { state: CheckIns; reload: () => Promise<unknown> }) {
  const { api } = useWorkspace();
  const { mutate } = useAgentWorkspace();
  const [settings, setSettings] = useState(state.settings);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const saving = useRef(Promise.resolve());
  const save = (next: Settings) => {
    setSettings(next);
    setError("");
    // One save at a time, in order, so quick taps on the time end where the person left them.
    saving.current = saving.current.then(() =>
      api.request("/api/meal-checkins/settings", next).then(
        () => undefined,
        (e) => setError(message(e)),
      ),
    );
  };
  const switchedOff = state.replaced
    .filter((r) => !r.enabled)
    .sort((a, b) => a.time.localeCompare(b.time));
  async function restore() {
    setRestoring(true);
    setError("");
    try {
      for (const routine of switchedOff) await mutate(`/routines/${routine.id}`, { enabled: true });
      await reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setRestoring(false);
    }
  }
  return (
    <Card style={{ gap: 6 }}>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: settings.enabled }}
        aria-checked={settings.enabled}
        onPress={() => save({ ...settings, enabled: !settings.enabled })}
        style={[s.row, { gap: 14, paddingVertical: 4 }]}
      >
        <View style={[s.iconBox, { backgroundColor: colors.sky }]}>
          <BellRing size={20} color={colors.blueDark} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.heading}>Ask me what I ate</Text>
          <Text style={[s.small, { color: colors.mutedStrong }]}>
            A notification at each meal. Answer by voice or text.
          </Text>
        </View>
        <View
          style={{
            width: 48,
            height: 28,
            borderRadius: 14,
            padding: 3,
            backgroundColor: settings.enabled ? colors.greenDark : colors.subtle,
            alignItems: settings.enabled ? "flex-end" : "flex-start",
          }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: "#FFFFFF",
              shadowColor: "#000",
              shadowOpacity: 0.18,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
            }}
          />
        </View>
      </Pressable>
      {settings.enabled && (
        <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
          {MEALS.map((meal) => {
            const on = settings.meals.includes(meal);
            return (
              <View
                key={meal}
                style={[
                  s.between,
                  { gap: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <CheckRow
                    label={MEAL_NAMES[meal] ?? meal}
                    checked={on}
                    onPress={() =>
                      save({
                        ...settings,
                        meals: on
                          ? settings.meals.filter((m) => m !== meal)
                          : MEALS.filter((m) => m === meal || settings.meals.includes(m)),
                      })
                    }
                  />
                </View>
                <TimeStepper
                  meal={MEAL_NAMES[meal] ?? meal}
                  time={settings.times[meal]}
                  disabled={!on}
                  onChange={(time) =>
                    save({ ...settings, times: { ...settings.times, [meal]: time } })
                  }
                />
              </View>
            );
          })}
          <Text style={[s.small, { color: colors.mutedStrong, marginTop: 10 }]}>
            If you’ve already logged a meal, you won’t be asked about it.
          </Text>
        </View>
      )}
      {switchedOff.length > 0 && (
        <View style={{ gap: 8, marginTop: 12 }}>
          <Text style={[s.small, { color: colors.mutedStrong }]}>
            {switchedOff.length === 1
              ? `To avoid asking twice, I paused a routine that asked what you ate: ${switchedOff[0]?.title}. It’s not deleted.`
              : `To avoid asking twice, I paused ${switchedOff.length} routines that asked what you ate: ${switchedOff.map((r) => r.title).join(", ")}. They’re not deleted.`}
          </Text>
          <Button
            small
            busy={restoring}
            style={{ alignSelf: "flex-start" }}
            onPress={() => void restore()}
          >
            Turn {switchedOff.length === 1 ? "it" : "them"} back on
          </Button>
        </View>
      )}
      <ErrorNotice error={error} />
    </Card>
  );
}

export function MealRow({
  entry,
  onChanged,
}: {
  entry: MealEntry;
  onChanged: () => Promise<unknown>;
}) {
  const { api, notify } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [meal, setMeal] = useState(entry.meal ?? "");
  const [calories, setCalories] = useState(
    entry.calories === undefined ? "" : String(Math.round(entry.calories)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const time = new Date(entry.at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  async function save() {
    const number = calories.trim() === "" ? null : Number(calories);
    if (number !== null && (!Number.isFinite(number) || number < 0 || number > 10000))
      return setError("Calories should be a number from 0 to 10,000.");
    setBusy(true);
    setError("");
    try {
      await api.request(`/api/health-log/${entry.id}`, {
        title: title.trim() || entry.title,
        ...(meal ? { meal } : {}),
        // Empty clears the estimate; an unchanged number stays an estimate.
        ...(number === null
          ? entry.calories === undefined
            ? {}
            : { calories: null }
          : number !== Math.round(entry.calories ?? -1)
            ? { calories: number }
            : {}),
      });
      setEditing(false);
      changed();
      await onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api.request(`/api/health-log/${entry.id}/delete`, {});
      notify(`Removed ${entry.title} from your food log.`);
      changed();
      await onChanged();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  return (
    <View style={{ paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.line, gap: 10 }}>
      <View style={[s.row, { gap: 12, alignItems: "flex-start" }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.text}>{entry.title}</Text>
          <Text style={[s.small, { color: colors.mutedStrong }]} numberOfLines={2}>
            {[MEAL_NAMES[entry.meal ?? ""] ?? "Meal", time, entry.items?.join(", ")]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text style={[s.text, { fontVariant: ["tabular-nums"] }]}>{kcal(entry.calories)}</Text>
          {entry.calories !== undefined && (
            <Text style={s.small}>{entry.estimated === false ? "yours" : "estimate"}</Text>
          )}
        </View>
        {editing ? (
          <View style={{ width: 36 }} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Change ${entry.title}`}
            {...tipProps("Change")}
            hitSlop={8}
            onPress={() => setEditing(true)}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? colors.subtle : "transparent",
            })}
          >
            <Pencil size={16} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {editing && (
        <View
          style={{
            gap: 4,
            marginTop: 4,
            padding: 14,
            borderRadius: 19,
            backgroundColor: colors.subtle,
          }}
        >
          <Field label="What you had" value={title} onChangeText={setTitle} />
          <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>Which meal</Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap", marginTop: 7, marginBottom: 16 }]}>
            {["breakfast", "lunch", "dinner", "snack"].map((option) => (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ checked: meal === option }}
                aria-checked={meal === option}
                onPress={() => setMeal(option)}
                style={{
                  minHeight: 38,
                  paddingHorizontal: 14,
                  borderRadius: 19,
                  justifyContent: "center",
                  backgroundColor: meal === option ? colors.inverse : colors.surface,
                }}
              >
                <Text
                  style={[
                    s.buttonText,
                    { color: meal === option ? colors.onInverse : colors.text },
                  ]}
                >
                  {MEAL_NAMES[option]}
                </Text>
              </Pressable>
            ))}
          </View>
          <Field
            label="Calories"
            value={calories}
            onChangeText={(value) => setCalories(value.replace(/[^\d.]/g, ""))}
            keyboardType="numeric"
            inputMode="numeric"
            placeholder="Leave empty if you’re not sure"
            accessibilityHint="Delete the number to remove it."
          />
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button small primary busy={busy} onPress={() => void save()}>
              Save
            </Button>
            <Button
              small
              disabled={busy}
              style={{ backgroundColor: colors.card }}
              onPress={() => {
                setEditing(false);
                setConfirming(false);
                setError("");
              }}
            >
              Cancel
            </Button>
            {!confirming && (
              <Button
                small
                danger
                icon={Trash2}
                disabled={busy}
                style={{ marginLeft: "auto" }}
                onPress={() => setConfirming(true)}
              >
                Remove
              </Button>
            )}
          </View>
          {confirming && (
            <View
              style={{
                gap: 10,
                marginTop: 12,
                padding: 14,
                borderRadius: 16,
                backgroundColor: colors.errorBg,
              }}
            >
              <Text role="alert" style={s.text}>
                Remove {entry.title} from your food log? This can’t be undone.
              </Text>
              <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                <Button small disabled={busy} onPress={() => setConfirming(false)}>
                  Keep it
                </Button>
                <Button small danger icon={Trash2} busy={busy} onPress={() => void remove()}>
                  Remove meal
                </Button>
              </View>
            </View>
          )}
        </View>
      )}
      <ErrorNotice error={error} />
    </View>
  );
}

/**
 * Log a meal by voice or typing; the agent logs it in chat. Everything logged is in the Health
 * space's Food log, with the check-in settings in its Playbook.
 */
export function FoodLogSheet({ log }: { log?: boolean }) {
  const { ask, close, navigate } = useWorkspace();
  return (
    <Sheet
      title="Log a meal"
      subtitle="Say or type what you ate. Calories are estimates unless you change them."
      onClose={close}
    >
      <View style={{ gap: 16 }}>
        <Card style={{ gap: 14 }}>
          <Text accessibilityRole="header" style={s.heading}>
            What did you eat?
          </Text>
          <SayOrType
            placeholder="what you ate"
            action="Log this meal"
            listenNow={!!log}
            onSubmit={(text) => {
              close();
              ask(`Log a meal I just had: ${text}`);
            }}
          />
        </Card>
        <Button
          style={{ alignSelf: "flex-start" }}
          onPress={() => {
            close();
            showSpace("health", "food");
            navigate("spaces");
          }}
        >
          View food log
        </Button>
      </View>
    </Sheet>
  );
}

/** Meal check-ins in the Health space's Playbook: which meals the agent asks about, and when. */
export function MealCheckIns() {
  const { state, load } = useCheckIns();
  if (!state) return null;
  return <CheckInSettings state={state} reload={load} />;
}
