import {
  ArrowUp,
  Check,
  ExternalLink,
  MessageCircle,
  Plus,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Image, Linking, Pressable, Text, TextInput, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useAgentWorkspace } from "./agent-workspace";
import { AreaPrompt, AreaRow, areaPromptDismissed, homeCountry, LOCAL_TOPIC } from "./area-ui";
import { AssistantResponse } from "./assistant-response";
import { type AppDay, calendarName } from "./calendar-apps";
import { Emoji } from "./emoji";
import { todayLine, useHealth } from "./health-ui";
import { MealsToday } from "./meal-checkins-ui";
import { COMMITMENT_EMOJI, type Commitment, onPlansChanged, type Reminder } from "./plans";
import { dark } from "./theme";
import { tipProps } from "./tips";
import { Button, Card, colors, ErrorNotice, SectionHeading, s } from "./ui";
import { useWeather, WeatherToday } from "./weather-ui";
import { useWorkspace } from "./workspace";

type Feedback = "up" | "down";
interface FeedStory {
  emoji: string;
  headline: string;
  summary: string;
  url?: string;
  image?: string;
  feedback?: Feedback;
}
interface FeedItem {
  id: string;
  topic: string;
  summary: string;
  sources: { title: string; url: string }[];
  stories?: FeedStory[];
  day: string;
  createdAt: string;
}
interface FeedState {
  topics: string[];
  /** Where local news is for, such as "Houston, Texas". */
  area?: string;
  refreshedAt?: string;
  searchAvailable: boolean;
  refreshing: boolean;
  items: FeedItem[];
}
const SUGGESTIONS = [
  "Local news",
  "AI agents",
  "My favorite team",
  "Mortgage rates",
  "Tech stocks",
];
/** Covers for stories without a picture, picked by topic so each topic keeps its colors. */
const COVERS: [string, string][] = dark
  ? [
      ["#1F5AA6", "#0B1A33"],
      ["#6A35A8", "#1A0E2E"],
      ["#10805A", "#07261B"],
      ["#B4521A", "#2A1206"],
      ["#A8285E", "#2A0A18"],
      ["#3552C4", "#0E1633"],
    ]
  : [
      ["#CFE8FF", "#EAF4FF"],
      ["#E9DDFF", "#F6F0FF"],
      ["#D2F2E0", "#EDFAF2"],
      ["#FFE2C7", "#FFF3E6"],
      ["#FFD9E6", "#FFF0F5"],
      ["#DCE4FF", "#F0F3FF"],
    ];
const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function dayHeading(day: string) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (day === localDay(today)) return "Today";
  if (day === localDay(yesterday)) return "Yesterday";
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
const site = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
function ago(value: string) {
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} hr` : `${Math.round(hours / 24)} d`;
}
/** A story saved before the Feed told news as stories: its first real paragraph, never a wall. */
function legacyStory(item: FeedItem): FeedStory {
  return {
    emoji: "📰",
    headline: item.topic,
    summary: shortSummary(item.summary),
    url: item.sources[0]?.url,
  };
}
export function shortSummary(text: string) {
  const paragraph =
    text
      .replace(/\*\*[^*\n]+:\*\*/g, "\n")
      .split(/\n+/)
      .map((line) => line.replace(/[#*]/g, "").trim())
      .find((line) => line.length >= 60 && !/:$/.test(line) && !/^I'll search/i.test(line)) ??
    text.slice(0, 280);
  if (paragraph.length <= 280) return paragraph;
  return `${paragraph.slice(0, 280).replace(/\s+\S*$/, "")}…`;
}
const hash = (text: string) => [...text].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Your day at a glance, then what's new on the topics you follow. */
export function FeedScreen() {
  const { workspace: w, api, navigate, ask, open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const health = useHealth();
  const { result: weather, load: loadWeather } = useWeather();
  const [feed, setFeed] = useState<FeedState>();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [sentReminders, setSentReminders] = useState(0);
  const loadReminders = useCallback(
    () =>
      api.request<{ upcoming: Reminder[]; sent?: Reminder[] }>("/api/reminders").then(
        (list) => {
          setReminders(list.upcoming);
          setSentReminders(list.sent?.length ?? 0);
        },
        () => undefined,
      ),
    [api],
  );
  useEffect(() => {
    void loadReminders();
  }, [loadReminders]);
  // Finished ones too, so Plans & bookings can be opened while nothing is coming up.
  const [allCommitments, setAllCommitments] = useState<Commitment[]>([]);
  const commitments = allCommitments.filter((item) => item.status === "upcoming");
  const loadCommitments = useCallback(
    () =>
      api.request<{ commitments: Commitment[] }>("/api/commitments?all=1").then(
        (list) => setAllCommitments(list.commitments),
        () => undefined,
      ),
    [api],
  );
  useEffect(() => {
    void loadCommitments();
  }, [loadCommitments]);
  // Something marked done or cancelled in Plans & bookings or Reminders shows here too.
  useEffect(
    () =>
      onPlansChanged(() => {
        void loadCommitments();
        void loadReminders();
      }),
    [loadCommitments, loadReminders],
  );
  // Events from connected calendar apps (Outlook, Google Calendar), which chat reads too.
  const [appDay, setAppDay] = useState<AppDay>();
  useEffect(() => {
    api
      .request<AppDay>("/api/calendar/today")
      .then(setAppDay, () => setAppDay({ events: [], checked: [], failed: ["calendar"] }));
  }, [api]);
  const [topic, setTopic] = useState("");
  const [areaLater, setAreaLater] = useState(areaPromptDismissed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api
        .request<FeedState>("/api/feed")
        .then(setFeed, (e) => setError(e instanceof Error ? e.message : String(e))),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // While topics are being searched, check back until the new items arrive.
  useEffect(() => {
    if (!feed?.refreshing) return;
    const timer = setTimeout(() => void load(), 4000);
    return () => clearTimeout(timer);
  }, [feed, load]);
  async function run(work: () => Promise<FeedState>) {
    setBusy(true);
    setError("");
    try {
      setFeed(await work());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const saveTopics = (topics: string[]) =>
    run(() => api.request<FeedState>("/api/feed/topics", { topics }));
  function addTopics(text: string) {
    if (!feed) return;
    const wanted = text
      .split(/,|;|\n|\band\b|&/i)
      .map((part) => part.trim().replace(/^(about|on)\s+/i, ""))
      .filter((part) => part.length >= 2 && part.length <= 80);
    const next = [...new Set([...feed.topics, ...wanted])].slice(0, 8);
    if (next.length === feed.topics.length) return;
    setTopic("");
    void saveTopics(next);
  }
  function rate(item: FeedItem, story: FeedStory, value: Feedback) {
    const feedback = story.feedback === value ? null : value;
    // Shown at once; the server remembers it for the next stories.
    setFeed(
      (current) =>
        current && {
          ...current,
          items: current.items.map((i) =>
            i.id !== item.id
              ? i
              : {
                  ...i,
                  stories: i.stories?.map((st) =>
                    st.headline === story.headline
                      ? { ...st, feedback: feedback ?? undefined }
                      : st,
                  ),
                },
          ),
        },
    );
    void api
      .request<FeedState>("/api/feed/feedback", {
        itemId: item.id,
        headline: story.headline,
        feedback,
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  const now = new Date();
  const today = localDay(now);
  const seen = new Set<string>();
  const events = [...w.events, ...(appDay?.events ?? [])]
    // The same meeting from two connections shows once.
    .filter((e) => {
      const key = `${e.title.trim().toLowerCase()}|${e.allDay ? e.start.slice(0, 10) : new Date(e.start).getTime()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter((e) =>
      e.allDay ? e.start.slice(0, 10) === today : localDay(new Date(e.start)) === today,
    )
    .filter((e) => e.allDay || new Date(e.end) > now)
    // By time, whatever each calendar's way of writing it; all-day ones first.
    .sort(
      (a, b) =>
        (a.allDay ? 0 : Date.parse(a.start)) - (b.allDay ? 0 : Date.parse(b.start)) ||
        a.title.localeCompare(b.title),
    );
  const unread = (appDay?.failed ?? []).map(calendarName);
  const approvals = w.actions.filter((a) => a.status === "awaiting_review").length;
  const working = (data?.tasks ?? []).filter((t) =>
    ["queued", "running", "waiting_input", "waiting_approval"].includes(t.status),
  ).length;
  const days = [...new Set((feed?.items ?? []).map((item) => item.day))];
  // Local news with no area saved: ask where local is, unless they said not now.
  const askArea =
    !!feed?.searchAvailable &&
    !feed.area &&
    !areaLater &&
    feed.topics.some((t) => LOCAL_TOPIC.test(t));
  const healthLine = health.summary ? todayLine(health.summary.today) : "";
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  // The sky as it is at home when the forecast is in; otherwise the time of day.
  const sky =
    weather && "weather" in weather
      ? weather.weather.now.emoji
      : hour < 6 || hour >= 20
        ? "🌙"
        : hour < 10
          ? "🌅"
          : hour < 17
            ? "☀️"
            : "🌇";
  // A new home city means new weather and new local news.
  const citySaved = () => {
    void load();
    void loadWeather(true);
  };

  return (
    <View style={{ gap: 24 }}>
      {(feed?.topics.length ?? 0) < 8 && (
        <View
          style={[
            s.row,
            {
              backgroundColor: colors.subtle,
              borderRadius: 30,
              paddingLeft: 20,
              paddingRight: 6,
              minHeight: 56,
              gap: 8,
            },
          ]}
        >
          <TextInput
            value={topic}
            onChangeText={setTopic}
            onSubmitEditing={() => addTopics(topic)}
            returnKeyType="done"
            placeholder="Make me a feed about…"
            placeholderTextColor={colors.muted}
            accessibilityLabel="Topics for your feed"
            style={{ flex: 1, color: colors.text, fontSize: 17, paddingVertical: 14 }}
          />
          {topic.trim().length >= 2 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add to my feed"
              {...tipProps("Add to my feed")}
              onPress={() => addTopics(topic)}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: colors.inverse,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ArrowUp size={20} color={colors.onInverse} />
            </Pressable>
          )}
        </View>
      )}

      <View style={{ borderRadius: 28, overflow: "hidden", padding: 22, gap: 14 }}>
        <View style={{ position: "absolute", inset: 0 }} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="day" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={dark ? "#12263A" : "#D6EDFF"} />
                <Stop offset="0.55" stopColor={dark ? "#1B1A38" : "#ECE5FF"} />
                <Stop offset="1" stopColor={dark ? "#2A1830" : "#FFE9DD"} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#day)" />
          </Svg>
        </View>
        <View style={[s.row, { gap: 12 }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={{ color: colors.text, fontSize: 27, fontWeight: "700", letterSpacing: -0.8 }}
            >
              {greeting}
            </Text>
            <Text style={[s.muted, { fontSize: 15, color: colors.mutedStrong }]}>
              {now.toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </Text>
          </View>
          <Emoji char={sky} size={64} />
        </View>
        <WeatherToday
          result={weather}
          reload={(fresh) => (fresh ? citySaved() : void loadWeather())}
          askingForArea={!feed || askArea}
          city={feed?.area}
        />
        <DayRow emoji="📅">
          {events.slice(0, 3).map((e) => (
            <Text key={`${e.id}-${e.start}`} style={s.text}>
              {e.allDay
                ? "All day"
                : new Date(e.start).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
              · {e.title}
            </Text>
          ))}
          {events.length > 3 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${events.length - 3} more today. Ask what's on your calendar`}
              hitSlop={8}
              onPress={() => ask("What's on my calendar today?")}
              style={{ alignSelf: "flex-start" }}
            >
              <Text style={[s.small, { color: colors.text, textDecorationLine: "underline" }]}>
                + {events.length - 3} more today
              </Text>
            </Pressable>
          )}
          {!appDay ? (
            !events.length && (
              <Text style={[s.muted, { color: colors.mutedStrong }]}>Checking your calendar…</Text>
            )
          ) : unread.length ? (
            <Text
              style={
                events.length
                  ? [s.small, { color: colors.mutedStrong }]
                  : [s.muted, { color: colors.mutedStrong }]
              }
            >
              Couldn’t read {unread.join(" or ")} just now. Ask in chat what’s on it today.
            </Text>
          ) : events.length ? null : !appDay.checked.length &&
            !w.connections.some((c) => c.id === "google" && c.status !== "disconnected") ? (
            <Pressable accessibilityRole="button" onPress={() => navigate("apps")}>
              <Text style={[s.text, { textDecorationLine: "underline" }]}>
                Connect your calendar to see your day here
              </Text>
            </Pressable>
          ) : (
            <Text style={[s.muted, { color: colors.mutedStrong }]}>
              Nothing else on your calendar today.
            </Text>
          )}
        </DayRow>
        {commitments.slice(0, 3).map((item) => (
          <DayRow key={item.id} emoji={COMMITMENT_EMOJI[item.kind] ?? "📌"}>
            <View style={[s.row, { gap: 8 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.text} numberOfLines={2}>
                  {item.title}
                </Text>
                {!!(item.when || item.where) && (
                  <Text style={[s.small, { color: colors.mutedStrong }]}>
                    {[item.when, item.where].filter(Boolean).join(" · ")}
                  </Text>
                )}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Mark done: ${item.title}`}
                {...tipProps("Mark done")}
                style={smallTarget}
                onPress={() =>
                  void api
                    .request(`/api/commitments/${item.id}`, { status: "done" })
                    .then(loadCommitments, (e) =>
                      setError(e instanceof Error ? e.message : String(e)),
                    )
                }
              >
                <Check size={16} color={colors.muted} />
              </Pressable>
            </View>
          </DayRow>
        ))}
        {allCommitments.length > 0 && (
          <View style={[s.row, { marginLeft: 48, gap: 18, flexWrap: "wrap" }]}>
            {commitments.length > 3 && (
              <SmallLink
                label={`${commitments.length - 3} more coming up. Open Plans & bookings`}
                onPress={() => open({ type: "commitments" })}
              >
                + {commitments.length - 3} more coming up
              </SmallLink>
            )}
            <SmallLink strong onPress={() => open({ type: "commitments" })}>
              See all plans & bookings
            </SmallLink>
          </View>
        )}
        {reminders.slice(0, 3).map((reminder) => (
          <DayRow key={reminder.id} emoji="⏰">
            <View style={[s.row, { gap: 8 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.text} numberOfLines={2}>
                  {reminder.text}
                </Text>
                <Text style={[s.small, { color: colors.mutedStrong }]}>{reminder.when}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Cancel reminder: ${reminder.text}`}
                {...tipProps("Cancel reminder")}
                style={smallTarget}
                onPress={() =>
                  void api
                    .request(`/api/reminders/${reminder.id}/cancel`, {})
                    .then(loadReminders, (e) =>
                      setError(e instanceof Error ? e.message : String(e)),
                    )
                }
              >
                <X size={15} color={colors.muted} />
              </Pressable>
            </View>
          </DayRow>
        ))}
        {reminders.length > 3 && (
          <View style={{ marginLeft: 48, alignSelf: "flex-start" }}>
            <SmallLink
              label={`${reminders.length - 3} more ${reminders.length === 4 ? "reminder" : "reminders"}. Open Reminders`}
              onPress={() => open({ type: "reminders" })}
            >
              + {reminders.length - 3} more {reminders.length === 4 ? "reminder" : "reminders"}
            </SmallLink>
          </View>
        )}
        {health.summary && (
          <DayRow emoji="🥗">
            <MealsToday logged={health.summary.today.logged ?? []} line={healthLine} />
          </DayRow>
        )}
        {approvals > 0 && (
          <Pressable onPress={() => navigate("activity")}>
            <DayRow emoji="✅">
              <Text style={[s.text, { textDecorationLine: "underline" }]}>
                {approvals} waiting for your approval
              </Text>
            </DayRow>
          </Pressable>
        )}
        {working > 0 && (
          <Pressable onPress={() => navigate("activity")}>
            <DayRow emoji="⏳">
              <Text style={[s.text, { textDecorationLine: "underline" }]}>
                {working} {working === 1 ? "job" : "jobs"} in progress
              </Text>
            </DayRow>
          </Pressable>
        )}
        <View style={[s.row, { marginLeft: 48, gap: 18, flexWrap: "wrap" }]}>
          <SmallLink strong onPress={() => ask("I’d like to set a reminder.")}>
            + Add a reminder
          </SmallLink>
          {reminders.length + sentReminders > 0 && (
            <SmallLink strong onPress={() => open({ type: "reminders" })}>
              See all reminders
            </SmallLink>
          )}
        </View>
      </View>

      {askArea && <AreaPrompt onSaved={citySaved} onDismiss={() => setAreaLater(true)} />}

      {days.map((day) => (
        <View key={day}>
          <Text
            style={{ color: colors.text, fontSize: 24, fontWeight: "700", letterSpacing: -0.6 }}
          >
            {dayHeading(day)}
          </Text>
          {(feed?.items ?? [])
            .filter((item) => item.day === day)
            .flatMap((item) =>
              (item.stories ?? [legacyStory(item)]).map((story) => (
                <StoryRow
                  key={`${item.id}-${story.headline}`}
                  story={story}
                  topic={item.topic}
                  when={ago(item.createdAt)}
                  onRate={item.stories ? (value) => rate(item, story, value) : undefined}
                  onAsk={() =>
                    ask(`Let's talk about this story: ${story.headline} (${item.topic}).`)
                  }
                />
              )),
            )}
        </View>
      ))}
      {feed?.refreshing && (
        <View style={[s.row, { gap: 10, justifyContent: "center", paddingVertical: 8 }]}>
          <RefreshCw size={16} color={colors.muted} />
          <Text style={s.muted}>Looking up what's new…</Text>
        </View>
      )}

      <Card style={{ gap: 12 }}>
        <SectionHeading
          title="Topics you follow"
          action={feed?.topics.length ? (feed.refreshing ? "Updating…" : "Refresh") : undefined}
          onPress={
            feed?.refreshing || busy
              ? undefined
              : () => void run(() => api.request<FeedState>("/api/feed/refresh", {}))
          }
        />
        {feed && !feed.searchAvailable && (
          <Text style={s.muted}>The Feed needs web search, which isn’t set up on this server.</Text>
        )}
        {feed?.searchAvailable && !askArea && (
          <AreaRow
            area={feed.area}
            // Outside the US (or, with no city, a device outside it), or with weather not set up
            // on this server, there's no weather to promise.
            weather={
              !(
                weather &&
                "unavailable" in weather &&
                (weather.unavailable === "outside-us" || weather.unavailable === "off")
              ) && (feed.area ? true : !homeCountry() || homeCountry() === "US")
            }
            onSaved={citySaved}
          />
        )}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {feed?.topics.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityLabel={`Stop following ${item}`}
              onPress={() => void saveTopics(feed.topics.filter((t) => t !== item))}
              style={[
                s.row,
                {
                  gap: 6,
                  paddingHorizontal: 13,
                  paddingVertical: 8,
                  borderRadius: 18,
                  backgroundColor: colors.subtle,
                },
              ]}
            >
              <Text style={s.text}>{item}</Text>
              <X size={13} color={colors.muted} />
            </Pressable>
          ))}
        </View>
        {feed && !feed.topics.length && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {SUGGESTIONS.map((item) => (
              <Button key={item} small icon={Plus} onPress={() => addTopics(item)}>
                {item}
              </Button>
            ))}
          </View>
        )}
        <Text style={s.small}>
          Your agent looks up what's new on each topic every morning, about 1–3¢ per topic. Tap a
          topic to stop following it. Thumbs up or down on a story shapes the next ones.
          {feed?.refreshedAt
            ? ` Last updated ${new Date(feed.refreshedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
            : ""}
        </Text>
        <ErrorNotice error={error} />
      </Card>
    </View>
  );
}

/** A 44px target around a small icon, without making its row taller. */
const smallTarget = {
  width: 44,
  height: 44,
  margin: -12,
  alignItems: "center",
  justifyContent: "center",
} as const;

/** Small words on the day card that open something, 44px tall without spreading the card out. */
function SmallLink({
  children,
  label,
  strong,
  onPress,
}: {
  children: ReactNode;
  /** When the words alone don't say where it goes. */
  label?: string;
  /** Blue and bold, like "+ Add a reminder"; otherwise underlined. */
  strong?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        marginVertical: -12,
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        style={[
          s.small,
          strong
            ? { color: colors.blueDark, fontWeight: "600" }
            : { color: colors.text, textDecorationLine: "underline" },
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

function DayRow({ emoji, children }: { emoji: string; children: ReactNode }) {
  return (
    <View style={[s.row, { gap: 12, alignItems: "flex-start" }]}>
      <Emoji char={emoji} size={36} />
      <View style={{ flex: 1, gap: 3, paddingTop: 6 }}>{children}</View>
    </View>
  );
}

/** A story's picture, or a cover in the topic's colors with its emoji when there's none. */
function StoryPicture({ story, topic }: { story: FeedStory; topic: string }) {
  const [broken, setBroken] = useState(false);
  const shape = { width: "100%" as const, aspectRatio: 16 / 10, borderRadius: 20 };
  if (story.image && !broken)
    return (
      <Image
        source={{ uri: story.image }}
        onError={() => setBroken(true)}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
        style={[shape, { backgroundColor: colors.subtle }]}
      />
    );
  const [from, to] = COVERS[hash(topic) % COVERS.length] ?? COVERS[0] ?? ["#333", "#111"];
  const id = `cover-${hash(topic + story.headline)}`;
  return (
    <View style={[shape, { overflow: "hidden", justifyContent: "flex-end", padding: 18 }]}>
      <View style={{ position: "absolute", inset: 0 }} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={from} />
              <Stop offset="1" stopColor={to} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
      </View>
      <View style={{ position: "absolute", right: 18, top: 14 }}>
        <Emoji char={story.emoji} size={112} />
      </View>
      <Text
        style={{
          color: colors.text,
          opacity: 0.75,
          fontSize: 12,
          fontWeight: "700",
          letterSpacing: 1.2,
          textTransform: "uppercase",
        }}
      >
        {topic}
      </Text>
    </View>
  );
}

/** One news story, Meta style: emoji, headline, what happened, a picture and quick reactions. */
function StoryRow({
  story,
  topic,
  when,
  onRate,
  onAsk,
}: {
  story: FeedStory;
  topic: string;
  when: string;
  onRate?: (value: Feedback) => void;
  onAsk: () => void;
}) {
  const open = () => story.url && void Linking.openURL(story.url).catch(() => undefined);
  const reaction = (value: Feedback) => {
    const Icon = value === "up" ? ThumbsUp : ThumbsDown;
    const chosen = story.feedback === value;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={value === "up" ? "More like this" : "Less like this"}
        {...tipProps(value === "up" ? "More like this" : "Less like this")}
        accessibilityState={{ selected: chosen }}
        hitSlop={8}
        onPress={() => onRate?.(value)}
      >
        <Icon
          size={22}
          strokeWidth={1.8}
          color={chosen ? colors.blueDark : colors.text}
          fill={chosen ? colors.blueDark : "transparent"}
        />
      </Pressable>
    );
  };
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 14,
        paddingVertical: 22,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
      }}
    >
      <View style={{ width: 42, paddingTop: 2 }}>
        <Emoji char={story.emoji} size={42} />
      </View>
      <View style={{ flex: 1, gap: 10 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 20,
            lineHeight: 26,
            fontWeight: "700",
            letterSpacing: -0.4,
          }}
        >
          {story.headline}
        </Text>
        <AssistantResponse content={story.summary} />
        <Pressable
          accessibilityRole={story.url ? "link" : undefined}
          accessibilityLabel={story.url ? `Open the article: ${story.headline}` : undefined}
          disabled={!story.url}
          onPress={open}
        >
          <StoryPicture story={story} topic={topic} />
        </Pressable>
        <View style={[s.row, { gap: 22, marginTop: 4 }]}>
          {onRate && reaction("up")}
          {onRate && reaction("down")}
          <Pressable
            accessibilityRole="button"
            onPress={onAsk}
            style={[s.row, { gap: 7 }]}
            hitSlop={6}
          >
            <MessageCircle size={21} strokeWidth={1.8} color={colors.text} />
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "500" }}>Discuss</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Text style={[s.muted, { fontSize: 14 }]}>{when}</Text>
          {!!story.url && (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open ${site(story.url)}`}
              {...tipProps(`Open ${site(story.url)}`)}
              onPress={open}
              hitSlop={8}
            >
              <ExternalLink size={19} strokeWidth={1.8} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
