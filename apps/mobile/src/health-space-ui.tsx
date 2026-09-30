import {
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  MessageCircle,
  Mic,
  Play,
  Utensils,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { HealthPlaybookPatch, HealthSpace, Space } from "../../../packages/domain/src/spaces";
import { type Bar, BarChart, DataTable, Segmented, StatTile } from "./charts";
import { useHealth, type Workout, WorkoutPlayer } from "./health-ui";
import { MEAL_NAMES, MealCheckIns, type MealEntry, MealRow } from "./meal-checkins-ui";
import { showSpace, spacesView } from "./space-view";
import {
  AddLine,
  Digest,
  heading,
  Removable,
  RemoveSpace,
  Section,
  type SectionState,
  TightField,
  useOpenChat,
  useOpenSpace,
  usePlaybookSave,
  useSpaces,
} from "./spaces";
import { tipProps } from "./tips";
import { Button, Card, colors, Empty, ErrorNotice, InfoTip, s } from "./ui";
import { primeSpeech } from "./voice";
import { useWorkspace } from "./workspace";

/**
 * The health space: what the person has eaten and their workouts, today and week by week, against
 * the targets in its playbook, and the family board's dinners beside what was actually eaten.
 */

interface HealthDay {
  date: string;
  meals: MealEntry[];
  workouts: { id: string; title: string; minutes?: number; at: string }[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  workoutMinutes: number;
}
interface HealthWeek {
  today: string;
  weekStart: string;
  days: HealthDay[];
  weeks: {
    weekStart: string;
    daysLogged: number;
    averageCalories: number;
    averageProtein: number;
    workoutMinutes: number;
  }[];
  targets: { calories?: number; protein?: number; workoutMinutes?: number };
  planned: {
    date: string;
    dish: string;
    emoji?: string;
    cook: boolean;
    recipe?: { name: string; minutes: number };
  }[];
  familySpaceId?: string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const whole = (value: number) => Math.round(value).toLocaleString();
/** A calendar date in the person's own calendar; never read as UTC. */
const dateOf = (day: string) => {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
};
const shortDay = (day: string) => dateOf(day).toLocaleDateString(undefined, { weekday: "short" });
const longDay = (day: string) =>
  dateOf(day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
const monthDay = (day: string) =>
  dateOf(day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
/** A local calendar date moved by whole days. */
const shift = (day: string, days: number) => {
  const date = dateOf(day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
/** Whether a week shown is the one today is in. */
const isThisWeek = (data: { today: string; weekStart: string }) =>
  data.weekStart === shift(data.today, -((dateOf(data.today).getDay() + 6) % 7));
const clock = (at: string) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The week shown, with a way back and forward; `week` is its Monday, or this week when unset. */
function useHealthWeek(space: Space, week?: string, skip = false) {
  const { api } = useWorkspace();
  const [data, setData] = useState<HealthWeek>();
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api
        .request<HealthWeek>(
          `/api/spaces/${space.id}/health${week ? `?week=${encodeURIComponent(week)}` : ""}`,
        )
        .then(
          (next) => {
            setData(next);
            setError("");
          },
          (e) => setError(message(e)),
        ),
    [api, space.id, week],
  );
  useEffect(() => {
    if (skip) return;
    void load();
    // A meal logged in chat shows up here without a refresh.
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
    }, 20_000);
    return () => clearInterval(timer);
  }, [load, skip]);
  return { data, error, load };
}

/** While a tab's data loads, or what went wrong with a way to try again. */
function LoadProblem({ error, retry }: { error?: string; retry: () => void }) {
  if (!error) return <ActivityIndicator color={colors.blueDark} />;
  return (
    <View style={{ gap: 10 }}>
      <ErrorNotice error={error} />
      <Button small style={{ alignSelf: "flex-start" }} onPress={retry}>
        Try again
      </Button>
    </View>
  );
}

/** "Sep 28 – Oct 4", with the weeks before and after it. */
function WeekPicker({
  data,
  onWeek,
}: {
  data: HealthWeek;
  onWeek: (monday: string | undefined) => void;
}) {
  const thisWeek = isThisWeek(data);
  const previous = useRef<{ focus?: () => void } | null>(null);
  const arrow = (
    label: string,
    Icon: typeof ChevronLeft,
    onPress: () => void,
    off: boolean,
    ref?: typeof previous,
  ) => (
    <Pressable
      ref={
        ref
          ? (node) => {
              ref.current = node as unknown as { focus?: () => void } | null;
            }
          : undefined
      }
      role="button"
      aria-label={label}
      aria-disabled={off}
      disabled={off}
      onPress={onPress}
      {...tipProps(label)}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        opacity: off ? 0.35 : 1,
      }}
    >
      <Icon size={20} color={colors.text} />
    </Pressable>
  );
  return (
    <View style={[s.row, { gap: 4 }]}>
      {arrow(
        "Previous week",
        ChevronLeft,
        () => onWeek(shift(data.weekStart, -7)),
        false,
        previous,
      )}
      <Text style={[s.text, { fontWeight: "600", flexShrink: 1 }]} numberOfLines={1}>
        {thisWeek
          ? "This week"
          : `${monthDay(data.weekStart)} – ${monthDay(shift(data.weekStart, 6))}`}
      </Text>
      {arrow(
        "Next week",
        ChevronRight,
        () => {
          const next = shift(data.weekStart, 7);
          const reached = next > data.today || isThisWeek({ today: data.today, weekStart: next });
          onWeek(reached ? undefined : next);
          // "Next week" turns off on this week, so focus moves back rather than to the page.
          if (reached) setTimeout(() => previous.current?.focus?.(), 0);
        },
        thisWeek,
      )}
    </View>
  );
}

type Measure = "calories" | "protein" | "workouts";

export function HealthOverview({
  space,
  agentName,
  onTab,
}: {
  space: HealthSpace;
  agentName: string;
  onTab: (tab: "food" | "playbook") => void;
}) {
  const { open } = useWorkspace();
  const openChat = useOpenChat();
  const [week, setWeek] = useState<string>();
  const [measure, setMeasure] = useState<Measure>("calories");
  // Today's tiles always come from this week; the arrows move only the chart.
  const now = useHealthWeek(space);
  const picked = useHealthWeek(space, week, !week);
  const data = week ? (picked.data ?? now.data) : now.data;
  const { summary, reload } = useHealth();
  const [playing, setPlaying] = useState<Workout>();
  if (!now.data || !data)
    return (
      <LoadProblem
        error={now.error}
        retry={() => {
          void now.load();
        }}
      />
    );
  const today = now.data.days.find((day) => day.date === now.data?.today);
  const { targets } = now.data;
  const thisWeekMinutes = now.data.days.reduce((total, day) => total + day.workoutMinutes, 0);
  const weekMinutes = data.days.reduce((total, day) => total + day.workoutMinutes, 0);
  const logged = data.days.filter((day) => day.meals.length);
  const aims =
    !!targets.calories ||
    !!targets.protein ||
    !!targets.workoutMinutes ||
    space.playbook.goals.length > 0;
  const unit =
    measure === "calories" ? "calories" : measure === "protein" ? "g protein" : "min of exercise";
  const current = isThisWeek(data);
  const value = (day: HealthDay) =>
    measure === "calories"
      ? day.calories
      : measure === "protein"
        ? day.protein
        : day.workoutMinutes;
  const bars: Bar[] = data.days.map((day) => ({
    key: day.date,
    label: shortDay(day.date),
    value: value(day),
    strong: day.date === data.today,
    name: longDay(day.date),
    missing: day.date > data.today || (measure !== "workouts" && !day.meals.length),
    tip:
      day.date > data.today
        ? `${longDay(day.date)}: still to come`
        : measure !== "workouts" && !day.meals.length
          ? `${longDay(day.date)}: nothing logged`
          : `${longDay(day.date)}: ${whole(value(day))} ${unit}`,
  }));
  const target =
    measure === "calories"
      ? targets.calories
      : measure === "protein"
        ? targets.protein
        : targets.workoutMinutes
          ? Math.round(targets.workoutMinutes / 7)
          : undefined;
  const average = (key: "calories" | "protein") =>
    logged.length ? logged.reduce((total, day) => total + day[key], 0) / logged.length : 0;
  return (
    <View style={{ gap: 18 }}>
      {!space.setupDone && !aims && (
        <Card style={{ gap: 10, backgroundColor: colors.green }}>
          <Text style={s.text}>
            Tell {agentName} your goals, and set daily targets for calories and protein if you’d
            like them. Everything you log shows here either way.
          </Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button small primary icon={MessageCircle} onPress={() => openChat(space)}>
              {space.threadStarted ? "Continue in chat" : `Set up with ${agentName}`}
            </Button>
            <Button small onPress={() => onTab("playbook")}>
              Set targets yourself
            </Button>
          </View>
        </Card>
      )}

      <View style={{ gap: 10 }}>
        <Text {...heading(3)} style={s.heading}>
          Today and this week
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <StatTile
            label="Calories"
            value={whole(today?.calories ?? 0)}
            detail={targets.calories ? `of ${whole(targets.calories)} a day` : "No daily target"}
            info="Estimates from what you logged, unless you changed them. Change any meal in the Food log."
          />
          <StatTile
            label="Protein"
            value={`${whole(today?.protein ?? 0)} g`}
            detail={targets.protein ? `of ${whole(targets.protein)} g a day` : "No daily target"}
          />
          <StatTile
            label="Exercise this week"
            value={`${whole(thisWeekMinutes)} min`}
            detail={
              targets.workoutMinutes
                ? `of ${whole(targets.workoutMinutes)} a week`
                : "No weekly target"
            }
          />
        </View>
        <Text style={[s.muted, { color: colors.mutedStrong }]}>
          {today?.meals.length
            ? `Logged today: ${today.meals.map((meal) => meal.title).join(" · ")}`
            : "Nothing logged today yet."}
        </Text>
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button small primary icon={Mic} onPress={() => open({ type: "food", log: true })}>
            Log a meal
          </Button>
          <Button small onPress={() => onTab("food")}>
            View food log
          </Button>
        </View>
      </View>

      <Card style={{ gap: 14 }}>
        <View style={[s.between, { gap: 8, flexWrap: "wrap" }]}>
          <Text {...heading(3)} style={s.heading}>
            By day
          </Text>
          <WeekPicker data={data} onWeek={setWeek} />
        </View>
        {/* The chart stays on this week while the chosen one can't load; say so. */}
        {week && !picked.data && picked.error && (
          <LoadProblem
            error={picked.error}
            retry={() => {
              void picked.load();
            }}
          />
        )}
        <Segmented
          label="What to show"
          value={measure}
          onChange={setMeasure}
          options={[
            { id: "calories", label: "Calories" },
            { id: "protein", label: "Protein" },
            { id: "workouts", label: "Exercise" },
          ]}
        />
        <BarChart
          bars={bars}
          label={`${measure === "calories" ? "Calories" : measure === "protein" ? "Grams of protein" : "Minutes of exercise"} by day`}
          target={target}
          valueTitle={
            measure === "calories"
              ? "Calories"
              : measure === "protein"
                ? "Protein (g)"
                : "Exercise (min)"
          }
          targetLabel={
            target
              ? measure === "workouts"
                ? `About ${target} min a day`
                : `Target ${whole(target)}`
              : undefined
          }
        />
        <Text role="status" aria-live="polite" style={[s.muted, { color: colors.mutedStrong }]}>
          {measure === "workouts"
            ? `${whole(weekMinutes)}${targets.workoutMinutes ? ` of ${whole(targets.workoutMinutes)}` : ""} minutes of exercise ${current ? "this" : "that"} week.`
            : logged.length
              ? `${current ? `Logged ${logged.length} ${logged.length === 1 ? "day" : "days"} so far this week` : `Logged ${logged.length} of 7 days`}. On those days, ${whole(average(measure))} ${unit} on average.`
              : `Nothing logged ${current ? "this" : "that"} week.`}
        </Text>
      </Card>

      <Card style={{ gap: 12 }}>
        <View style={[s.row, { gap: 6 }]}>
          <Text {...heading(3)} style={s.heading}>
            Week by week
          </Text>
          <InfoTip
            term="Week by week"
            text="A day with nothing logged doesn’t pull the averages down."
          />
        </View>
        <Text style={[s.muted, { color: colors.mutedStrong, marginTop: -6 }]}>
          Calories and protein are daily averages on the days you logged. Exercise is the week’s
          total.
        </Text>
        <DataTable
          label="Week by week"
          rows={[...data.weeks].reverse().filter((row) => row.daysLogged || row.workoutMinutes)}
          rowKey={(row) => row.weekStart}
          empty="Weeks show here once you’ve logged a meal or a workout."
          columns={[
            { title: "Week of", flex: 1.2, render: (row) => monthDay(row.weekStart) },
            {
              title: "Days logged",
              align: "right",
              minWidth: 76,
              render: (row) => row.daysLogged,
              // On a phone, under the week: "3 days logged".
              fold: (row) => `${row.daysLogged} ${row.daysLogged === 1 ? "day" : "days"} logged`,
            },
            {
              title: "Calories",
              align: "right",
              minWidth: 52,
              render: (row) => (row.daysLogged ? whole(row.averageCalories) : "–"),
            },
            {
              title: "Protein",
              align: "right",
              minWidth: 48,
              render: (row) => (row.daysLogged ? `${whole(row.averageProtein)} g` : "–"),
            },
            {
              title: "Exercise",
              align: "right",
              minWidth: 56,
              render: (row) => `${whole(row.workoutMinutes)} min`,
            },
          ]}
        />
      </Card>

      <Card style={{ gap: 12 }}>
        <Text {...heading(3)} style={s.heading}>
          Workouts
        </Text>
        {summary?.workouts.length ? (
          summary.workouts.slice(0, 6).map((workout) => (
            <View key={workout.id} style={[s.row, { gap: 10 }]}>
              <Dumbbell size={16} color={colors.mutedStrong} />
              <Text style={[s.text, { flex: 1 }]} numberOfLines={2}>
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
          ))
        ) : (
          <Text style={[s.muted, { color: colors.mutedStrong }]}>
            Ask {agentName} for a workout, like “20 minutes, no equipment.” It’s timed and read
            aloud, and it’s logged here when you finish.
          </Text>
        )}
        <Button
          small
          icon={MessageCircle}
          style={{ alignSelf: "flex-start" }}
          onPress={() => openChat(space, "A 20-minute workout with no equipment")}
        >
          Ask for a workout
        </Button>
      </Card>
      {playing && (
        <WorkoutPlayer
          workout={playing}
          onClose={() => {
            setPlaying(undefined);
            void reload();
          }}
        />
      )}
    </View>
  );
}

type Range = "today" | "week" | "month";
interface FoodDay {
  day: string;
  meals: MealEntry[];
  calories: number;
  protein: number;
}

/** Every meal logged, as a table per day; a day's Change switches it to rows that can be fixed. */
export function HealthFoodLog({ agentName }: { agentName: string }) {
  const { api, open } = useWorkspace();
  // "This week" unless a button asked for another range.
  const [range, setRange] = useState<Range>(() => {
    const asked = spacesView.range ?? "week";
    spacesView.range = undefined;
    return asked;
  });
  const [history, setHistory] = useState<{ today: string; days: FoodDay[] }>();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string>();
  const load = useCallback(
    () =>
      api.request<{ today: string; days: FoodDay[] }>("/api/food-log?days=31").then(
        (next) => {
          setHistory(next);
          setError("");
        },
        (e) => setError(message(e)),
      ),
    [api],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
    }, 20_000);
    return () => clearInterval(timer);
  }, [load]);
  if (!history) return <LoadProblem error={error} retry={() => void load()} />;
  const monday = shift(history.today, -((dateOf(history.today).getDay() + 6) % 7));
  const days = history.days.filter((day) =>
    range === "today"
      ? day.day === history.today
      : range === "week"
        ? day.day >= monday
        : day.day > shift(history.today, -30),
  );
  const total = (key: "calories" | "protein") => days.reduce((sum, day) => sum + day[key], 0);
  return (
    <View style={{ gap: 16 }}>
      <View style={[s.between, { gap: 10, flexWrap: "wrap" }]}>
        {/* Grows into the line's room, so the choices measure that, not just themselves. */}
        <View style={{ flexGrow: 1, flexBasis: 260 }}>
          <Segmented
            label="Time range"
            value={range}
            onChange={setRange}
            options={[
              { id: "today", label: "Today" },
              { id: "week", label: "This week" },
              { id: "month", label: "30 days" },
            ]}
          />
        </View>
        <Button small primary icon={Mic} onPress={() => open({ type: "food", log: true })}>
          Log a meal
        </Button>
      </View>
      {days.length > 1 && (
        <Text style={[s.muted, { color: colors.mutedStrong }]}>
          {days.length} days logged · {whole(total("calories"))} calories and{" "}
          {whole(total("protein"))} g protein in all
        </Text>
      )}
      <ErrorNotice error={error} />
      {days.length === 0 ? (
        <Empty
          icon={Mic}
          title={
            range === "today"
              ? "Nothing logged today yet"
              : range === "week"
                ? "Nothing logged this week yet"
                : "Nothing logged in the last 30 days"
          }
          detail={`Tap Log a meal, answer when ${agentName} asks what you ate, or send a photo of your plate in chat.`}
        />
      ) : (
        days.map((day) => (
          <Card key={day.day} style={{ gap: 10 }}>
            <View style={[s.between, { gap: 8 }]}>
              <Text {...heading(3)} style={s.heading}>
                {day.day === history.today ? "Today" : longDay(day.day)}
              </Text>
              <Button
                small
                accessibilityLabel={
                  editing === day.day
                    ? "Done changing meals"
                    : `Change ${day.day === history.today ? "today" : longDay(day.day)}’s meals`
                }
                onPress={() => setEditing(editing === day.day ? undefined : day.day)}
              >
                {editing === day.day ? "Done" : "Change"}
              </Button>
            </View>
            {editing === day.day ? (
              [...day.meals]
                .sort((a, b) => a.at.localeCompare(b.at))
                .map((meal) => <MealRow key={meal.id} entry={meal} onChanged={load} />)
            ) : (
              <DataTable
                label={`Meals ${day.day === history.today ? "today" : `on ${longDay(day.day)}`}`}
                rows={[...day.meals].sort((a, b) => a.at.localeCompare(b.at))}
                rowKey={(meal) => meal.id}
                footer={["Total", whole(day.calories), `${whole(day.protein)} g`]}
                columns={[
                  {
                    title: "Meal",
                    flex: 2.2,
                    render: (meal) => (
                      <View>
                        <Text style={[s.text, { fontSize: 14, lineHeight: 20 }]}>{meal.title}</Text>
                        <Text style={[s.small, { color: colors.mutedStrong, fontSize: 12 }]}>
                          {clock(meal.at)} · {MEAL_NAMES[meal.meal ?? ""] ?? "Meal"}
                        </Text>
                      </View>
                    ),
                  },
                  {
                    title: "Calories",
                    align: "right",
                    render: (meal) => (meal.calories === undefined ? "–" : whole(meal.calories)),
                  },
                  {
                    title: "Protein",
                    align: "right",
                    render: (meal) =>
                      meal.protein === undefined ? "–" : `${whole(meal.protein)} g`,
                  },
                ]}
              />
            )}
          </Card>
        ))
      )}
    </View>
  );
}

/** The family board's dinners for a week, beside what was eaten at dinner each night. */
export function HealthFoodPlan({ space, agentName }: { space: HealthSpace; agentName: string }) {
  const [week, setWeek] = useState<string>();
  const { data, error, load: reload } = useHealthWeek(space, week);
  const openSpace = useOpenSpace();
  const { api, navigate } = useWorkspace();
  const { load } = useSpaces();
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState("");
  /** Starts a family planner and opens it, where its chat sets it up. */
  const startFamily = async () => {
    setStarting(true);
    setProblem("");
    try {
      await api.request("/api/spaces", { kind: "family" });
      showSpace("family");
      await load();
      navigate("spaces");
    } catch (e) {
      setProblem(message(e));
    } finally {
      setStarting(false);
    }
  };
  if (!data) return <LoadProblem error={error} retry={() => void reload()} />;
  if (!data.familySpaceId)
    return (
      <Empty
        icon={Utensils}
        title="Your dinner plan shows here"
        detail={`Plan the week’s dinners in a family planner, and each night shows here next to what you ate. ${agentName} can plan the week for you.`}
      >
        <Button busy={starting} onPress={() => void startFamily()}>
          Start a family planner
        </Button>
        <ErrorNotice error={problem} />
      </Empty>
    );
  const rows = data.days.map((day) => ({
    day,
    planned: data.planned.find((dinner) => dinner.date === day.date),
    dinners: day.meals.filter((meal) => meal.meal === "dinner"),
  }));
  const cooked = rows.filter((row) => row.planned).length;
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 10 }}>
        <View style={[s.between, { gap: 8, flexWrap: "wrap" }]}>
          <Text {...heading(3)} style={s.heading}>
            Dinners
          </Text>
          <WeekPicker data={data} onWeek={setWeek} />
        </View>
        <Text role="status" aria-live="polite" style={[s.muted, { color: colors.mutedStrong }]}>
          {cooked
            ? `${cooked} ${cooked === 1 ? "dinner" : "dinners"} planned in your Family space.`
            : isThisWeek(data)
              ? "No dinners planned for this week yet."
              : "No dinners were planned that week."}
        </Text>
        <DataTable
          label="Planned dinners and what was eaten"
          rows={rows}
          rowKey={(row) => row.day.date}
          columns={[
            {
              title: "Day",
              flex: 0.7,
              render: (row) => (
                <Text
                  style={[
                    s.text,
                    { fontSize: 14, lineHeight: 20 },
                    row.day.date === data.today && { fontWeight: "700" },
                  ]}
                >
                  {shortDay(row.day.date)}
                </Text>
              ),
            },
            {
              title: "Planned",
              flex: 2,
              render: (row) =>
                row.planned ? (
                  <View>
                    <Text style={[s.text, { fontSize: 14, lineHeight: 20 }]}>
                      {row.planned.emoji ? `${row.planned.emoji} ` : ""}
                      {row.planned.dish}
                    </Text>
                    {!!row.planned.recipe && (
                      <Text
                        style={[s.small, { color: colors.mutedStrong, fontSize: 12 }]}
                        numberOfLines={2}
                      >
                        {row.planned.recipe.name}
                        {row.planned.recipe.minutes ? ` · ${row.planned.recipe.minutes} min` : ""}
                      </Text>
                    )}
                  </View>
                ) : (
                  "–"
                ),
            },
            {
              title: "Eaten",
              flex: 2,
              render: (row) =>
                row.dinners.length ? (
                  <View>
                    <Text style={[s.text, { fontSize: 14, lineHeight: 20 }]}>
                      {row.dinners.map((meal) => meal.title).join(", ")}
                    </Text>
                    {row.dinners.some((meal) => meal.calories !== undefined) && (
                      <Text style={[s.small, { color: colors.mutedStrong, fontSize: 12 }]}>
                        {whole(row.dinners.reduce((sum, meal) => sum + (meal.calories ?? 0), 0))}{" "}
                        calories
                      </Text>
                    )}
                  </View>
                ) : row.day.date < data.today ? (
                  "Not logged"
                ) : (
                  ""
                ),
            },
          ]}
        />
      </Card>
      <Button style={{ alignSelf: "flex-start" }} onPress={() => openSpace("family")}>
        Open the Family space
      </Button>
    </View>
  );
}

type Save = (section: string, patch: HealthPlaybookPatch, removed?: string) => Promise<boolean>;

/** A daily or weekly target: a number typed in, saved on its own. */
function Target({
  title,
  field,
  value,
  unit,
  hint,
  info,
  min,
  max,
  range,
  save,
  ...state
}: SectionState & {
  title: string;
  field: "calorieTarget" | "proteinTarget" | "workoutMinutes";
  value?: number;
  unit: string;
  hint: string;
  info?: string;
  /** What the server accepts, and what to say when a number falls outside it. */
  min: number;
  max: number;
  range: string;
  save: Save;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [problem, setProblem] = useState("");
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  const number = text.trim() === "" ? null : Number(text.replace(/,/g, ""));
  const changed = number !== (value ?? null);
  return (
    <Section title={title} {...state}>
      <View style={[s.row, { gap: 4 }]}>
        <Text style={[s.muted, { flexShrink: 1 }]}>{hint}</Text>
        {!!info && <InfoTip term={title} text={info} />}
      </View>
      <View style={[s.row, { gap: 10, alignItems: "flex-end" }]}>
        <View style={{ flex: 1 }}>
          <TightField
            label={unit}
            value={text}
            keyboardType="number-pad"
            placeholder="No target"
            onChangeText={(next) => {
              setText(next);
              setProblem("");
            }}
          />
        </View>
        <Button
          small
          primary={changed}
          disabled={!changed}
          onPress={() => {
            if (number !== null && (!Number.isInteger(number) || number < min || number > max))
              return setProblem(range);
            void save(field, { [field]: number }).then((ok) => {
              if (!ok) setProblem("");
            });
          }}
        >
          {number === null && value !== undefined ? "Clear" : "Save"}
        </Button>
      </View>
      {!!problem && <Text style={[s.small, { color: colors.danger }]}>{problem}</Text>}
    </Section>
  );
}

function List({
  title,
  field,
  hint,
  add,
  placeholder,
  items,
  save,
  ...state
}: SectionState & {
  title: string;
  field: "goals" | "foodRules";
  hint: string;
  add: string;
  placeholder: string;
  items: string[];
  save: Save;
}) {
  return (
    <Section title={title} {...state}>
      <Text style={s.muted}>{hint}</Text>
      {items.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {items.map((item) => (
            <Removable
              key={item}
              label={item}
              onRemove={() => void save(field, { [field]: items.filter((i) => i !== item) }, item)}
            />
          ))}
        </View>
      )}
      <AddLine
        label={add}
        placeholder={placeholder}
        taken={items}
        onAdd={(item) => void save(field, { [field]: [...items, item] })}
      />
    </Section>
  );
}

/** What the health space follows: goals, food rules and targets, all the person's to change. */
export function HealthPlaybook({
  space,
  agentName,
  onRemoved,
}: {
  space: HealthSpace;
  agentName: string;
  onRemoved: () => void;
}) {
  const { notify } = useWorkspace();
  const book = space.playbook;
  const { save, section } = usePlaybookSave<HealthPlaybookPatch>(space);
  const saved: Save = async (id, patch, removed) => {
    const ok = await save(id, patch, removed);
    if (ok && !removed) notify("Saved");
    return ok;
  };
  return (
    <View style={{ gap: 16 }}>
      <Text style={s.muted}>
        What {agentName} keeps in mind about your eating and exercise. Every target is yours to set,
        change or leave empty.
      </Text>
      <List
        title="Goals"
        field="goals"
        hint="In your own words."
        add="Add a goal"
        placeholder="e.g. More protein at breakfast"
        items={book.goals}
        save={save}
        {...section("goals")}
      />
      <List
        title="Food rules"
        field="foodRules"
        hint={`Diets, allergies and foods you avoid. ${agentName} plans around them.`}
        add="Add a food rule"
        placeholder="e.g. No shellfish"
        items={book.foodRules}
        save={save}
        {...section("foodRules")}
      />
      <Target
        title="Calories a day"
        field="calorieTarget"
        value={book.calorieTarget}
        unit="Calories"
        min={800}
        max={6000}
        range="Calories a day can be from 800 to 6,000. Leave it empty for no target."
        hint="The line on your calories chart."
        info={`${agentName} can suggest a target in chat. If you have a health condition, check with a doctor first.`}
        save={saved}
        {...section("calorieTarget")}
      />
      <Target
        title="Protein a day"
        field="proteinTarget"
        value={book.proteinTarget}
        unit="Grams"
        min={10}
        max={400}
        range="Protein a day can be from 10 to 400 grams. Leave it empty for no target."
        hint="The line on your protein chart."
        save={saved}
        {...section("proteinTarget")}
      />
      <Target
        title="Exercise a week"
        field="workoutMinutes"
        value={book.workoutMinutes}
        unit="Minutes"
        min={0}
        max={3000}
        range="Exercise a week can be up to 3,000 minutes. Leave it empty for no target."
        hint="Workouts you finish in the app count toward it."
        save={saved}
        {...section("workoutMinutes")}
      />
      <MealCheckIns />
      <Digest
        space={space}
        title="Weekly check-in"
        about={`Once a week, ${agentName} looks back at what you ate and your exercise against your targets, and suggests one small change.`}
      />
      <RemoveSpace space={space} onRemoved={onRemoved} />
    </View>
  );
}
