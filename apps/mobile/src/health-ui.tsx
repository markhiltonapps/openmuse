import { Dumbbell, Pause, Play, SkipForward, Trash2, Utensils } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Button, Card, colors, ErrorNotice, SectionHeading, Sheet, s } from "./ui";
import { primeSpeech, speak, stopSpeaking } from "./voice";
import { useWorkspace } from "./workspace";

interface Step {
  name: string;
  seconds: number;
  cue: string;
}
export interface Workout {
  id: string;
  title: string;
  minutes: number;
  steps: Step[];
}
interface Entry {
  id: string;
  kind: "meal" | "workout";
  title: string;
  at: string;
  items?: string[];
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  minutes?: number;
  estimated?: boolean;
}
export interface HealthSummary {
  today: {
    meals: number;
    /** Meals logged today: breakfast, lunch, dinner, snack. */
    logged?: string[];
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    workoutMinutes: number;
  };
  entries: Entry[];
  workouts: Workout[];
}

function parse<T>(result: unknown): T | undefined {
  if (typeof result !== "string") return (result as T) ?? undefined;
  try {
    return JSON.parse(result) as T;
  } catch {
    return undefined;
  }
}
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;
/** "1,450 kcal · 62 g protein · 20 min workout" */
export function todayLine(today: HealthSummary["today"]) {
  const parts = [
    today.meals ? `${today.calories.toLocaleString()} kcal` : "",
    today.protein ? `${today.protein} g protein` : "",
    today.workoutMinutes ? `${today.workoutMinutes} min workout` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

export function useHealth() {
  const { api } = useWorkspace();
  const [summary, setSummary] = useState<HealthSummary>();
  const reload = useCallback(
    () => api.request<HealthSummary>("/api/health-log").then(setSummary, () => undefined),
    [api],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { summary, reload };
}

/** Times each step, reads its cue aloud, and logs the workout when it's finished. */
export function WorkoutPlayer({ workout, onClose }: { workout: Workout; onClose: () => void }) {
  const { api, notify } = useWorkspace();
  const [index, setIndex] = useState(0);
  const [left, setLeft] = useState(workout.steps[0]?.seconds ?? 0);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState("");
  const elapsed = useRef(0);
  const finished = useRef(false);
  const step = workout.steps[index];
  const finish = useCallback(async () => {
    if (finished.current) return;
    finished.current = true;
    stopSpeaking();
    void speak("Great work. Workout complete.");
    try {
      await api.request(`/api/workouts/${workout.id}/complete`, {
        seconds: Math.round(elapsed.current),
      });
      notify(`${workout.title} logged.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, notify, workout]);
  // Announce each step as it starts.
  useEffect(() => {
    if (!step) return;
    void speak(`${step.name}. ${Math.round(step.seconds)} seconds. ${step.cue}`);
  }, [step]);
  useEffect(() => {
    if (!running || !step) return;
    const timer = setInterval(() => {
      elapsed.current += 1;
      setLeft((value) => value - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [running, step]);
  useEffect(() => {
    if (left > 0 || !step) return;
    const next = workout.steps[index + 1];
    if (next) {
      setIndex(index + 1);
      setLeft(next.seconds);
    } else {
      setRunning(false);
      setIndex(workout.steps.length);
      void finish();
    }
  }, [left, index, step, workout.steps, finish]);
  useEffect(() => () => stopSpeaking(), []);
  const done = index >= workout.steps.length;
  const upNext = workout.steps[index + 1];
  return (
    <Sheet
      title={workout.title}
      subtitle={`${workout.minutes} min guided workout`}
      onClose={onClose}
    >
      <View style={{ alignItems: "center", gap: 14, paddingVertical: 10 }}>
        {done ? (
          <>
            <Text style={[s.title, { fontSize: 26 }]}>Done! 🎉</Text>
            <Text style={s.muted}>Logged to your health log.</Text>
          </>
        ) : (
          <>
            <Text style={s.small}>
              Step {index + 1} of {workout.steps.length}
            </Text>
            <Text style={[s.title, { fontSize: 28, textAlign: "center" }]}>{step?.name}</Text>
            <Text style={{ fontSize: 56, fontWeight: "300", color: colors.text }}>
              {clock(left)}
            </Text>
            {!!step?.cue && <Text style={[s.muted, { textAlign: "center" }]}>{step.cue}</Text>}
            {upNext && <Text style={s.small}>Up next: {upNext.name}</Text>}
            <View style={[s.row, { gap: 10, marginTop: 8 }]}>
              <Button
                primary
                icon={running ? Pause : Play}
                onPress={() => {
                  if (running) stopSpeaking();
                  setRunning(!running);
                }}
              >
                {running ? "Pause" : "Resume"}
              </Button>
              <Button icon={SkipForward} onPress={() => setLeft(0)}>
                Skip
              </Button>
            </View>
          </>
        )}
        <Button
          onPress={() => {
            stopSpeaking();
            if (!done && elapsed.current >= 60) void finish();
            onClose();
          }}
        >
          {done ? "Close" : "End workout"}
        </Button>
        <ErrorNotice error={error} />
      </View>
    </Sheet>
  );
}

/** The workout the agent designed, with a Start button. */
export function WorkoutToolCard({ result, loading }: { result: unknown; loading: boolean }) {
  const value = parse<{
    workoutId?: string;
    title?: string;
    minutes?: number;
    steps?: Step[];
    error?: string;
  }>(result);
  const [playing, setPlaying] = useState(false);
  if (loading)
    return <ActivityIndicator color={colors.blueDark} style={{ alignSelf: "flex-start" }} />;
  if (!value?.workoutId || !value.steps) return null;
  const workout: Workout = {
    id: value.workoutId,
    title: value.title ?? "Workout",
    minutes: value.minutes ?? 0,
    steps: value.steps,
  };
  return (
    <Card style={{ gap: 10 }}>
      <View style={[s.row, { gap: 10 }]}>
        <Dumbbell size={18} color={colors.blueDark} />
        <Text style={[s.heading, { flex: 1 }]}>{workout.title}</Text>
        <Text style={s.small}>{workout.minutes} min</Text>
      </View>
      {workout.steps
        .slice(0, 6)
        .map((step, i, shown) => ({
          step,
          // Each step's start time in the workout: unique even when names repeat ("Rest").
          start: shown.slice(0, i).reduce((sum, earlier) => sum + earlier.seconds, 0),
        }))
        .map(({ step, start }) => (
          <Text key={`${start}-${step.name}`} style={s.small}>
            {clock(step.seconds)} · {step.name}
          </Text>
        ))}
      {workout.steps.length > 6 && <Text style={s.small}>+ {workout.steps.length - 6} more</Text>}
      <Button
        primary
        icon={Play}
        style={{ alignSelf: "flex-start" }}
        onPress={() => {
          primeSpeech();
          setPlaying(true);
        }}
      >
        Start
      </Button>
      {playing && <WorkoutPlayer workout={workout} onClose={() => setPlaying(false)} />}
    </Card>
  );
}

/** A logged meal and the day's totals so far. */
export function MealToolCard({ result, loading }: { result: unknown; loading: boolean }) {
  const value = parse<{ entry?: Entry; today?: HealthSummary["today"] }>(result);
  if (loading)
    return <ActivityIndicator color={colors.blueDark} style={{ alignSelf: "flex-start" }} />;
  if (!value?.entry) return null;
  const { entry } = value;
  return (
    <Card style={{ gap: 6 }}>
      <View style={[s.row, { gap: 10 }]}>
        <Utensils size={17} color={colors.blueDark} />
        <Text style={[s.heading, { flex: 1 }]}>{entry.title}</Text>
        {entry.calories !== undefined && (
          <Text style={s.text}>{Math.round(entry.calories)} kcal</Text>
        )}
      </View>
      <Text style={s.small}>
        {[
          entry.protein !== undefined ? `${Math.round(entry.protein)} g protein` : "",
          entry.carbs !== undefined ? `${Math.round(entry.carbs)} g carbs` : "",
          entry.fat !== undefined ? `${Math.round(entry.fat)} g fat` : "",
          entry.estimated ? "estimated" : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {value.today && <Text style={s.small}>Today so far: {todayLine(value.today)}</Text>}
    </Card>
  );
}

/** Goals → Health: today's totals, the week's log, and workouts to start again. */
export function HealthSection() {
  const { api, open } = useWorkspace();
  const { summary, reload } = useHealth();
  const [playing, setPlaying] = useState<Workout>();
  const [error, setError] = useState("");
  if (!summary) return null;
  const line = todayLine(summary.today);
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading
        title="Health"
        action="View food log"
        onPress={() => open({ type: "food" })}
      />
      <Text style={s.text}>{line ? `Today: ${line}` : "Nothing logged today yet."}</Text>
      <Text style={s.small}>
        Snap a meal in chat and tap "Log this meal", or ask for a workout like "a 15-minute workout
        with no equipment".
      </Text>
      {summary.entries.slice(0, 8).map((entry) => (
        <View key={entry.id} style={[s.row, { gap: 10 }]}>
          {entry.kind === "meal" ? (
            <Utensils size={15} color={colors.muted} />
          ) : (
            <Dumbbell size={15} color={colors.muted} />
          )}
          <Text style={[s.text, { flex: 1 }]} numberOfLines={1}>
            {entry.title}
          </Text>
          <Text style={s.small}>
            {entry.kind === "meal"
              ? entry.calories !== undefined
                ? `${Math.round(entry.calories)} kcal`
                : ""
              : `${entry.minutes} min`}
            {" · "}
            {new Date(entry.at).toLocaleDateString(undefined, { weekday: "short" })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${entry.title}`}
            hitSlop={8}
            onPress={() =>
              void api
                .request(`/api/health-log/${entry.id}/delete`, {})
                .then(reload, (e) => setError(e instanceof Error ? e.message : String(e)))
            }
          >
            <Trash2 size={15} color={colors.muted} />
          </Pressable>
        </View>
      ))}
      {summary.workouts.length > 0 && (
        <>
          <Text style={[s.small, { fontWeight: "600", color: colors.text, marginTop: 6 }]}>
            Workouts
          </Text>
          {summary.workouts.slice(0, 5).map((workout) => (
            <View key={workout.id} style={[s.row, { gap: 10 }]}>
              <Text style={[s.text, { flex: 1 }]} numberOfLines={1}>
                {workout.title} · {workout.minutes} min
              </Text>
              <Button
                small
                icon={Play}
                onPress={() => {
                  primeSpeech();
                  setPlaying(workout);
                }}
              >
                Start
              </Button>
            </View>
          ))}
        </>
      )}
      <ErrorNotice error={error} />
      {playing && (
        <WorkoutPlayer
          workout={playing}
          onClose={() => {
            setPlaying(undefined);
            void reload();
          }}
        />
      )}
    </Card>
  );
}
