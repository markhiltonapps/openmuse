import {
  ArrowUp,
  BellRing,
  Check,
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
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { Button, Card, CheckRow, colors, Empty, ErrorNotice, Field, Sheet, s } from "./ui";
import { voiceSettings } from "./voice";
import { CHECK_IN_OPENED, dictate, dictationAvailable } from "./web-app";

/** Sent after a check-in is answered, skipped or put off, so every chat's card catches up. */
const CHECK_INS_CHANGED = "muse-checkins-changed";
const changed = () => {
  if (typeof window !== "undefined" && window.dispatchEvent)
    window.dispatchEvent(new Event(CHECK_INS_CHANGED));
};

import { useWorkspace } from "./workspace";

type Meal = "breakfast" | "lunch" | "dinner";
const MEALS: Meal[] = ["breakfast", "lunch", "dinner"];
const MEAL_NAMES: Record<string, string> = {
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
interface MealEntry {
  id: string;
  title: string;
  at: string;
  meal?: string;
  items?: string[];
  calories?: number;
  protein?: number;
  estimated?: boolean;
}
interface FoodDay {
  day: string;
  meals: MealEntry[];
  calories: number;
  protein: number;
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
  value === undefined ? "" : `${Math.round(value).toLocaleString()} kcal`;

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
  action,
  busy,
  listenNow,
  inline,
  onSubmit,
}: {
  placeholder: string;
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
              ? "Type it, or tap the mic"
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
  const micLabel = listening ? "Stop listening" : "Say what you had";
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
 * "What did you have for lunch?" just above the chat box, ready to answer by voice or text, until
 * it's answered, skipped or put off.
 */
export function MealCheckInCard({ replying, active }: { replying?: boolean; active?: boolean }) {
  const { api, ask, notify } = useWorkspace();
  const { state, load } = useCheckIns();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
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
  if (!checkIn) return null;
  const others = state.open.slice(1).map((c) => MEAL_NAMES[c.meal]?.toLowerCase());
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
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(undefined);
    }
  }
  async function answer(text: string) {
    if (!checkIn) return;
    setError("");
    // The words go to the agent first, so nothing said is lost; logging the meal also closes it.
    ask(`Log my ${meal}: ${text}`);
    await api
      .request(`/api/meal-checkins/${checkIn.id}/answer`, {})
      .catch(() => undefined)
      .then(changed);
  }
  const yesterday = checkIn.yesterday;
  return (
    <View
      accessibilityRole="summary"
      style={{
        gap: 12,
        marginBottom: 12,
        padding: 16,
        borderRadius: 23,
        backgroundColor: colors.sky,
        borderWidth: 1,
        borderColor: colors.blue,
      }}
    >
      <View style={[s.row, { gap: 10 }]}>
        <Utensils size={18} color={colors.blueDark} />
        <Text accessibilityRole="header" style={[s.heading, { flex: 1, fontSize: 17 }]}>
          {checkIn.question}
        </Text>
      </View>
      <SayOrType
        inline
        placeholder={`What you had for ${meal}`}
        action={`Log ${meal}`}
        onSubmit={(text) => void answer(text)}
      />
      {yesterday && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Same as yesterday: ${yesterday.title}`}
          disabled={!!busy}
          onPress={() =>
            void run("same", "same", () => `Logged ${yesterday.title} for ${meal} again.`)
          }
          style={({ pressed }) => [
            s.row,
            {
              gap: 10,
              minHeight: 44,
              paddingHorizontal: 14,
              borderRadius: 22,
              backgroundColor: pressed ? colors.blue : colors.card,
              opacity: busy && busy !== "same" ? 0.5 : 1,
            },
          ]}
        >
          {busy === "same" ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <Repeat size={15} color={colors.text} />
          )}
          <View style={{ flex: 1, paddingVertical: 6 }}>
            <Text style={[s.buttonText, { color: colors.text }]}>Same as yesterday</Text>
            <View style={s.row}>
              <Text
                numberOfLines={1}
                style={[s.small, { flexShrink: 1, color: colors.mutedStrong }]}
              >
                {yesterday.title}
              </Text>
              {yesterday.calories !== undefined && (
                <Text style={[s.small, { flexShrink: 0, color: colors.mutedStrong }]}>
                  {` · ${kcal(yesterday.calories)}`}
                </Text>
              )}
            </View>
          </View>
        </Pressable>
      )}
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          icon={SkipForward}
          busy={busy === "skip"}
          disabled={!!busy}
          style={{ backgroundColor: colors.card }}
          onPress={() => void run("skip", "skip", () => `Okay, no ${meal} logged today.`)}
        >
          Skipped it
        </Button>
        <Button
          small
          icon={Clock}
          busy={busy === "snooze"}
          disabled={!!busy}
          style={{ backgroundColor: colors.card }}
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
          Ask in an hour
        </Button>
      </View>
      {others.length > 0 && (
        <Text style={[s.small, { color: colors.mutedStrong }]}>
          Then {others.join(" and ")}, which you haven’t logged yet.
        </Text>
      )}
      <ErrorNotice error={error} />
    </View>
  );
}

/** Feed → Today: which meals are logged, today's totals, and a way in. */
export function MealsToday({
  logged,
  line,
}: {
  logged: string[];
  /** Today's totals, such as "1,450 kcal · 62 g protein". */
  line: string;
}) {
  const { open } = useWorkspace();
  return (
    <View style={{ gap: 8, flex: 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Food log. ${MEALS.map(
          (m) => `${MEAL_NAMES[m]} ${logged.includes(m) ? "logged" : "not logged yet"}`,
        ).join(", ")}`}
        onPress={() => open({ type: "food" })}
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
          onPress={() => open({ type: "food" })}
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

const dayName = (day: string, today: string) => {
  if (day === today) return "Today";
  const date = new Date(`${day}T12:00:00`);
  const yesterday = new Date(`${today}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
};

function MealRow({ entry, onChanged }: { entry: MealEntry; onChanged: () => Promise<unknown> }) {
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

/** Everything eaten, by day, with check-in times and a way to log by voice. */
export function FoodLogSheet({ log }: { log?: boolean }) {
  const { api, ask, close } = useWorkspace();
  const { state, load } = useCheckIns();
  const [history, setHistory] = useState<{ today: string; days: FoodDay[] }>();
  const [error, setError] = useState("");
  const [logging, setLogging] = useState(!!log);
  const loadHistory = useCallback(
    () =>
      api
        .request<{ today: string; days: FoodDay[] }>("/api/food-log?days=60")
        .then(setHistory, (e) => setError(message(e))),
    [api],
  );
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);
  return (
    <Sheet
      title="Food log"
      subtitle="What you’ve eaten, by day. Calories are estimates unless you changed them."
      onClose={close}
    >
      <View style={{ gap: 16 }}>
        {logging ? (
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
        ) : (
          <Button
            primary
            icon={Mic}
            style={{ alignSelf: "flex-start" }}
            onPress={() => setLogging(true)}
          >
            Log a meal
          </Button>
        )}
        {state && <CheckInSettings state={state} reload={load} />}
        <ErrorNotice error={error} />
        {!history ? (
          <ActivityIndicator color={colors.blueDark} style={{ padding: 30 }} />
        ) : history.days.length === 0 ? (
          <Empty
            icon={Utensils}
            title="Nothing logged yet"
            detail="Answer when I ask what you ate, tap Log a meal, or send a photo of your plate in chat and tap Log this meal."
          />
        ) : (
          history.days.map((day) => (
            <Card key={day.day} style={{ gap: 0, paddingBottom: 8 }}>
              <View style={[s.between, { marginBottom: 6, gap: 10 }]}>
                <Text accessibilityRole="header" style={s.heading}>
                  {dayName(day.day, history.today)}
                </Text>
                <Text
                  style={[s.small, { color: colors.mutedStrong, fontVariant: ["tabular-nums"] }]}
                >
                  {[kcal(day.calories), day.protein ? `${day.protein} g protein` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              {[...day.meals]
                .sort((a, b) => a.at.localeCompare(b.at))
                .map((entry) => (
                  <MealRow key={entry.id} entry={entry} onChanged={loadHistory} />
                ))}
            </Card>
          ))
        )}
      </View>
    </Sheet>
  );
}
