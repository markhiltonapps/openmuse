import {
  AlarmClock,
  ArrowUp,
  CalendarDays,
  CircleCheck,
  Clock,
  type LucideIcon,
  Plus,
  RefreshCw,
  Utensils,
  X,
} from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Image, Linking, Pressable, Text, TextInput, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useAgentWorkspace } from "./agent-workspace";
import { AssistantResponse } from "./assistant-response";
import { todayLine, useHealth } from "./health-ui";
import { dark } from "./theme";
import { Button, Card, colors, ErrorNotice, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

interface FeedStory {
  emoji: string;
  headline: string;
  summary: string;
  url?: string;
  image?: string;
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
interface Reminder {
  id: string;
  text: string;
  when: string;
}
interface FeedState {
  topics: string[];
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

/** Your day at a glance, then what's new on the topics you follow. */
export function FeedScreen() {
  const { workspace: w, api, navigate, ask } = useWorkspace();
  const { data } = useAgentWorkspace();
  const health = useHealth();
  const [feed, setFeed] = useState<FeedState>();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const loadReminders = useCallback(
    () =>
      api.request<{ upcoming: Reminder[] }>("/api/reminders").then(
        (list) => setReminders(list.upcoming),
        () => undefined,
      ),
    [api],
  );
  useEffect(() => {
    void loadReminders();
  }, [loadReminders]);
  const [topic, setTopic] = useState("");
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

  const now = new Date();
  const today = localDay(now);
  const events = w.events
    .filter((e) =>
      e.allDay ? e.start.slice(0, 10) === today : localDay(new Date(e.start)) === today,
    )
    .filter((e) => e.allDay || new Date(e.end) > now)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 3);
  const approvals = w.actions.filter((a) => a.status === "awaiting_review").length;
  const working = (data?.tasks ?? []).filter((t) =>
    ["queued", "running", "waiting_input", "waiting_approval"].includes(t.status),
  ).length;
  const days = [...new Set((feed?.items ?? []).map((item) => item.day))];
  const healthLine = health.summary ? todayLine(health.summary.today) : "";
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <View style={{ gap: 22 }}>
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

      <View style={{ borderRadius: 26, overflow: "hidden", padding: 22, gap: 14 }}>
        <View style={{ position: "absolute", inset: 0 }} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="day" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={dark ? "#12263A" : "#DDF0FF"} />
                <Stop offset="0.55" stopColor={dark ? "#1B1A38" : "#EEE9FF"} />
                <Stop offset="1" stopColor={dark ? "#2A1830" : "#FFEFE6"} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#day)" />
          </Svg>
        </View>
        <View style={{ gap: 2 }}>
          <Text
            style={{ color: colors.text, fontSize: 26, fontWeight: "700", letterSpacing: -0.8 }}
          >
            {greeting}
          </Text>
          <Text style={[s.muted, { fontSize: 15 }]}>
            {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </Text>
        </View>
        <DayRow icon={CalendarDays} tint="#4AA3FF">
          {events.length ? (
            events.map((e) => (
              <Text key={e.id} style={s.text}>
                {e.allDay
                  ? "All day"
                  : new Date(e.start).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                · {e.title}
              </Text>
            ))
          ) : (
            <Text style={s.muted}>Nothing else on your calendar today.</Text>
          )}
        </DayRow>
        {reminders.slice(0, 3).map((reminder) => (
          <DayRow key={reminder.id} icon={AlarmClock} tint="#F5A524">
            <View style={[s.row, { gap: 8 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.text} numberOfLines={2}>
                  {reminder.text}
                </Text>
                <Text style={s.small}>{reminder.when}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Cancel reminder: ${reminder.text}`}
                hitSlop={8}
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
          <Text style={[s.small, { marginLeft: 46 }]}>+ {reminders.length - 3} more reminders</Text>
        )}
        {!!healthLine && (
          <Pressable onPress={() => navigate("goals")}>
            <DayRow icon={Utensils} tint="#2BD46E">
              <Text style={s.text}>{healthLine}</Text>
            </DayRow>
          </Pressable>
        )}
        {approvals > 0 && (
          <Pressable onPress={() => navigate("activity")}>
            <DayRow icon={CircleCheck} tint="#B58CFF">
              <Text style={[s.text, { textDecorationLine: "underline" }]}>
                {approvals} waiting for your approval
              </Text>
            </DayRow>
          </Pressable>
        )}
        {working > 0 && (
          <Pressable onPress={() => navigate("activity")}>
            <DayRow icon={Clock} tint="#4AA3FF">
              <Text style={[s.text, { textDecorationLine: "underline" }]}>
                {working} {working === 1 ? "task" : "tasks"} in progress
              </Text>
            </DayRow>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => ask("I'd like to set a reminder.")}
          style={{ alignSelf: "flex-start", marginLeft: 46 }}
        >
          <Text style={[s.small, { color: colors.blueDark, fontWeight: "600" }]}>
            + Add a reminder
          </Text>
        </Pressable>
      </View>

      {days.map((day) => (
        <View key={day}>
          <Text
            style={{ color: colors.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.5 }}
          >
            {dayHeading(day)}
          </Text>
          {(feed?.items ?? [])
            .filter((item) => item.day === day)
            .flatMap((item) =>
              (
                item.stories ?? [
                  {
                    emoji: "📰",
                    headline: item.topic,
                    summary: item.summary,
                    url: item.sources[0]?.url,
                  },
                ]
              ).map((story) => (
                <StoryRow
                  key={`${item.id}-${story.headline}`}
                  story={story}
                  topic={item.topic}
                  onAsk={() => ask(`Tell me more about this: ${story.headline} (${item.topic}).`)}
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
          <Text style={s.muted}>The Feed needs web search, which isn't set up on this server.</Text>
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
          topic to stop following it.
          {feed?.refreshedAt
            ? ` Last updated ${new Date(feed.refreshedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
            : ""}
        </Text>
        <ErrorNotice error={error} />
      </Card>
    </View>
  );
}

function DayRow({
  icon: Icon,
  tint,
  children,
}: {
  icon: LucideIcon;
  tint: string;
  children: ReactNode;
}) {
  return (
    <View style={[s.row, { gap: 12, alignItems: "flex-start" }]}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: `${tint}26`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={17} color={tint} />
      </View>
      <View style={{ flex: 1, gap: 3, paddingTop: 5 }}>{children}</View>
    </View>
  );
}

/** One news story: an emoji, a headline, what happened, and the article's picture. */
function StoryRow({ story, topic, onAsk }: { story: FeedStory; topic: string; onAsk: () => void }) {
  const [broken, setBroken] = useState(false);
  const open = () => story.url && void Linking.openURL(story.url).catch(() => undefined);
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 14,
        paddingVertical: 20,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
      }}
    >
      <Text style={{ fontSize: 30, lineHeight: 38, width: 40, textAlign: "center" }}>
        {story.emoji}
      </Text>
      <View style={{ flex: 1, gap: 8 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 19,
            lineHeight: 25,
            fontWeight: "700",
            letterSpacing: -0.3,
          }}
        >
          {story.headline}
        </Text>
        <AssistantResponse content={story.summary} />
        {!!story.image && !broken && (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open the article: ${story.headline}`}
            onPress={open}
          >
            <Image
              source={{ uri: story.image }}
              onError={() => setBroken(true)}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
              style={{
                width: "100%",
                aspectRatio: 16 / 10,
                borderRadius: 18,
                backgroundColor: colors.subtle,
              }}
            />
          </Pressable>
        )}
        <View style={[s.row, { gap: 14, flexWrap: "wrap" }]}>
          {!!story.url && (
            <Pressable accessibilityRole="link" onPress={open}>
              <Text style={[s.small, { textDecorationLine: "underline" }]}>{site(story.url)}</Text>
            </Pressable>
          )}
          <Text style={s.small}>{topic}</Text>
          <Pressable accessibilityRole="button" onPress={onAsk}>
            <Text style={[s.small, { color: colors.blueDark, fontWeight: "600" }]}>
              Ask about this
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
