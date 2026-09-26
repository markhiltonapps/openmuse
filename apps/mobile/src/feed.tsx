import { CalendarDays, CircleCheck, Clock, Plus, RefreshCw, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { AssistantResponse } from "./assistant-response";
import { Button, Card, colors, ErrorNotice, Field, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

interface FeedItem {
  id: string;
  topic: string;
  summary: string;
  sources: { title: string; url: string }[];
  day: string;
  createdAt: string;
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
  const [feed, setFeed] = useState<FeedState>();
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
  function follow(value: string) {
    const next = value.trim();
    if (!next || !feed || feed.topics.includes(next)) return;
    setTopic("");
    void saveTopics([...feed.topics, next]);
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

  return (
    <View style={{ gap: 20 }}>
      <Card style={{ gap: 12 }}>
        <SectionHeading
          title={now.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        />
        <View style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
          <CalendarDays size={18} color={colors.blueDark} />
          <View style={{ flex: 1, gap: 4 }}>
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
          </View>
        </View>
        {approvals > 0 && (
          <Pressable style={[s.row, { gap: 10 }]} onPress={() => navigate("activity")}>
            <CircleCheck size={18} color={colors.blueDark} />
            <Text style={[s.text, { textDecorationLine: "underline" }]}>
              {approvals} waiting for your approval
            </Text>
          </Pressable>
        )}
        {working > 0 && (
          <Pressable style={[s.row, { gap: 10 }]} onPress={() => navigate("activity")}>
            <Clock size={18} color={colors.blueDark} />
            <Text style={[s.text, { textDecorationLine: "underline" }]}>
              {working} {working === 1 ? "task" : "tasks"} in progress
            </Text>
          </Pressable>
        )}
      </Card>

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
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 16,
                  backgroundColor: colors.sky,
                },
              ]}
            >
              <Text style={s.text}>{item}</Text>
              <X size={13} color={colors.muted} />
            </Pressable>
          ))}
        </View>
        {(feed?.topics.length ?? 0) < 8 && (
          <View style={[s.row, { gap: 8, alignItems: "flex-end" }]}>
            <View style={{ flex: 1 }}>
              <Field
                label="Follow a topic"
                value={topic}
                onChangeText={setTopic}
                placeholder="Houston Astros, AI agents, mortgage rates…"
                maxLength={80}
                onSubmitEditing={() => follow(topic)}
              />
            </View>
            <Button
              style={{ marginBottom: 16 }}
              icon={Plus}
              busy={busy}
              disabled={topic.trim().length < 2}
              onPress={() => follow(topic)}
            >
              Follow
            </Button>
          </View>
        )}
        {feed && !feed.topics.length && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {SUGGESTIONS.map((item) => (
              <Button key={item} small icon={Plus} onPress={() => setTopic(item)}>
                {item}
              </Button>
            ))}
          </View>
        )}
        <Text style={s.small}>
          Your agent looks up what's new on each topic every morning, about 1–3¢ per topic.
          {feed?.refreshedAt
            ? ` Last updated ${new Date(feed.refreshedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
            : ""}
        </Text>
        <ErrorNotice error={error} />
      </Card>

      {days.map((day) => (
        <View key={day} style={{ gap: 12 }}>
          <Text style={s.heading}>{dayHeading(day)}</Text>
          {(feed?.items ?? [])
            .filter((item) => item.day === day)
            .map((item) => (
              <Card key={item.id} style={{ gap: 10 }}>
                <Text
                  style={[
                    s.small,
                    { fontWeight: "700", letterSpacing: 0.4, color: colors.blueDark },
                  ]}
                >
                  {item.topic.toUpperCase()}
                </Text>
                <AssistantResponse content={item.summary} />
                {item.sources.length > 0 && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                    {item.sources.slice(0, 3).map((source) => (
                      <Pressable
                        key={source.url}
                        accessibilityRole="link"
                        onPress={() => void Linking.openURL(source.url).catch(() => undefined)}
                      >
                        <Text style={[s.small, { textDecorationLine: "underline" }]}>
                          {site(source.url)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                <Button
                  small
                  style={{ alignSelf: "flex-start" }}
                  onPress={() => ask(`Tell me more about the latest on ${item.topic}.`)}
                >
                  Ask about this
                </Button>
              </Card>
            ))}
        </View>
      ))}
      {feed?.refreshing && !feed.items.length && (
        <Card>
          <View style={[s.row, { gap: 10 }]}>
            <RefreshCw size={16} color={colors.muted} />
            <Text style={s.muted}>Looking up what's new…</Text>
          </View>
        </Card>
      )}
    </View>
  );
}
