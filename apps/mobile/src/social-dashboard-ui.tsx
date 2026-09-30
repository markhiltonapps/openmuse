import type { LucideIcon } from "lucide-react-native";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock,
  Hourglass,
  Image as ImageIcon,
  Lightbulb,
  MessageCircle,
  Minus,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { aimProgress, type SocialWeek, weekReach } from "../../../packages/domain/src/social-week";
import type { ScheduledPost, SocialSpace } from "../../../packages/domain/src/spaces";
import { useAgentWorkspace } from "./agent-workspace";
import { type Column, DataTable, Segmented } from "./charts";
import { monthDay, weekRange } from "./family-week-ui";
import { clockTime } from "./meal-checkins-ui";
import {
  appBadge,
  DAY_NAMES,
  heading,
  PLAN_REQUEST,
  replace,
  useOpenChat,
  useSpaces,
} from "./spaces";
import { dark } from "./theme";
import { Button, Card, colors, ErrorNotice, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * A social media space's dashboard: this week's posts as a calendar and the 90-day plan on the
 * Overview, and the Results tab, with the weekly numbers the digest saves.
 */

const DAY = 86_400_000;
/** The chart's labels in the app's own type (react-native-web's), not the default for drawings. */
const CHART_FONT =
  Platform.OS === "web"
    ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    : undefined;
const PURPLE = dark ? "#B69CFF" : "#6B46C1";
const GREEN = dark ? "#2BD46E" : "#147A45";
/** Blue small text on the light blue tint, dark enough to read. */
const BLUE_TEXT = dark ? colors.blueDark : "#0F5A9E";
const NO_REASON = "the app didn’t say why";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
/** "Wednesday, Sep 30, 8:00 AM" */
export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const shortDate = (date: Date) =>
  date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
/** "2026-09-28" from the device's own calendar, not UTC's. */
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
/** An app's error without its closing full stop, to sit inside a sentence. */
export const reason = (post: ScheduledPost) => post.error?.trim().replace(/\.+$/, "") || NO_REASON;

/** What an approve or cancel did, for the note that pops up after it. */
export const decidedNote = (post: ScheduledPost, choice: "approve" | "cancel") =>
  choice === "cancel"
    ? post.status === "failed"
      ? "Dismissed."
      : "Cancelled. It won’t go out."
    : Date.parse(post.postAt) <= Date.now()
      ? "Approved. It’s going out now."
      : `Approved. It goes out ${when(post.postAt)}.`;
/** A post that failed because its app needs signing in again: trying again alone won't help. */
export const needsReconnect = (post: ScheduledPost) =>
  /reconnect|sign(ed)?[ -]?in|log(ged)?[ -]?in|expired|authori[sz]/i.test(post.error ?? "");

/** The chat message that asks the agent to look into a post that didn't go out. */
export const tryAgainMessage = (post: ScheduledPost) =>
  `The ${platformName(post.app)} post “${post.summary.replace(PLATFORM_PREFIX, "").replace(/\.+$/, "")}” for ${when(post.postAt)} didn’t go out (${reason(post)}). Please find out what went wrong and set it up to go out again.`;

/** A week's days, Monday first, in the device's time zone; 0 is this week, -1 last week. */
function weekDays(offset = 0) {
  const monday = new Date();
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return day;
  });
}
const inWeek = (post: ScheduledPost, offset: number) => {
  const at = new Date(post.postAt);
  return weekDays(offset).some((day) => sameDay(day, at));
};
/** Whether a post falls on this week's calendar. */
export const inThisWeek = (post: ScheduledPost) => inWeek(post, 0);
/** Whether a post fell in last week, Monday to Sunday. */
export const inLastWeek = (post: ScheduledPost) => inWeek(post, -1);
/** Whether a post falls after this Sunday. */
export const afterThisWeek = (post: ScheduledPost) => {
  const sunday = weekDays().at(-1) as Date;
  sunday.setHours(23, 59, 59, 999);
  return Date.parse(post.postAt) > sunday.getTime();
};

/** How a post's state looks: its word, icon and colours. A cleared failure still didn't go out. */
function statusOf(post: ScheduledPost) {
  if (post.status === "failed" || (post.status === "cancelled" && post.error))
    return {
      label: "Didn’t go out",
      icon: AlertTriangle,
      color: colors.danger,
      background: colors.errorBg,
    };
  const looks: Record<
    Exclude<ScheduledPost["status"], "failed">,
    { label: string; icon: LucideIcon; color: string; background: string }
  > = {
    awaiting_review: {
      label: "Waiting for you",
      icon: Hourglass,
      color: PURPLE,
      background: colors.lavender,
    },
    scheduled: { label: "Scheduled", icon: Clock, color: BLUE_TEXT, background: colors.sky },
    posting: { label: "Posting now", icon: Clock, color: BLUE_TEXT, background: colors.sky },
    posted: { label: "Posted", icon: Check, color: GREEN, background: colors.green },
    cancelled: {
      label: "Cancelled",
      icon: X,
      color: colors.mutedStrong,
      background: colors.subtle,
    },
  };
  return looks[post.status];
}

/** Each platform's badge colours: a light one behind, a strong one for its letters and bars. */
const TONES: [RegExp, [string, string], [string, string]][] = [
  [/insta/i, ["#FBE7EF", "#9C2E5C"], ["#35162A", "#FF8FC0"]],
  [/face|meta/i, ["#E6EEFB", "#1E4E9C"], ["#14233D", "#8DB6FF"]],
  [/linked/i, ["#E3EEF6", "#0B5687"], ["#10263A", "#7CC4F5"]],
  [/you ?tube/i, ["#FBEAEA", "#A3231F"], ["#3A1716", "#FF8F85"]],
  [/pinterest/i, ["#FBE9EA", "#A01B2A"], ["#3A1519", "#FF8F9A"]],
  [/tik ?tok/i, ["#E0F4F3", "#0E6B68"], ["#0F2A29", "#5FD6D0"]],
  [/twitter|threads|^x$/i, ["#ECEEF0", "#3F4A52"], ["#26292D", "#C3CAD0"]],
];
/** A platform's colours; any other app gets the app's light blue. */
export function tone(platform: string) {
  const found = TONES.find(([pattern]) => pattern.test(platform));
  const [background, color] = found ? (dark ? found[2] : found[1]) : [colors.sky, BLUE_TEXT];
  return { background, color };
}
const NAMES: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
  twitter: "X",
  pinterest: "Pinterest",
  threads: "Threads",
};
export const platformName = (app: string) => {
  const key = Object.keys(NAMES).find((name) => app.toLowerCase().includes(name));
  return key ? (NAMES[key] ?? app) : app.charAt(0).toUpperCase() + app.slice(1);
};
/** "Instagram photo: Out of the oven…" → "Out of the oven…", for a chip that has the badge. */
const PLATFORM_PREFIX =
  /^\s*(instagram|facebook|linkedin|tiktok|youtube|x|twitter|threads|pinterest)(\s+\w+)?\s*:\s*/i;

function Badge({ app, size = 24 }: { app: string; size?: number }) {
  const { background, color } = tone(app);
  return (
    <View
      aria-hidden
      style={{
        height: size,
        width: size + 6,
        borderRadius: size / 2,
        backgroundColor: background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: size <= 20 ? 10 : 11, fontWeight: "700", color }}>
        {appBadge(app)}
      </Text>
    </View>
  );
}

/** What a post will really publish: its words and any pictures, from the approved arguments. */
function postContent(post: ScheduledPost) {
  const words = Object.entries(post.arguments).find(
    ([key, value]) =>
      /caption|text|message|content|body|description/i.test(key) && typeof value === "string",
  )?.[1] as string | undefined;
  const values = Object.entries(post.arguments).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value]).map((item) => [key, item] as const),
  );
  const isVideo = (key: string, value: string) =>
    /video|reel/i.test(key) || /\.(mp4|mov)(\?|$)/i.test(value);
  // Pictures by link or by the app's own media id: all counted, the https ones shown.
  const pictures = values.filter(
    (entry): entry is readonly [string, string] =>
      typeof entry[1] === "string" &&
      !!entry[1].trim() &&
      !isVideo(entry[0], entry[1]) &&
      (/image|photo|picture|thumbnail|media/i.test(entry[0]) ||
        /\.(jpe?g|png|gif|webp)(\?|$)/i.test(entry[1])),
  );
  const images = pictures
    .map(([, value]) => value)
    .filter((value) => /^https:\/\/\S+$/.test(value))
    .slice(0, 4);
  const video = values.some(
    ([key, value]) => typeof value === "string" && !!value.trim() && isVideo(key, value),
  );
  const plain = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  const shown = words && !plain(post.summary).includes(plain(words)) ? words : undefined;
  return { words: shown, images, pictures: pictures.length, video };
}

/** The space's weekly results, oldest first, fetched again when the app comes back or a digest ends. */
export function useSocialResults(space: SocialSpace) {
  const { api } = useWorkspace();
  const { data } = useAgentWorkspace();
  const [weeks, setWeeks] = useState<SocialWeek[]>();
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api.request<{ weeks: SocialWeek[] }>(`/api/spaces/${space.id}/results`).then(
        (value) => {
          setWeeks(value.weeks);
          setError("");
        },
        (e) => setError(e instanceof Error ? e.message : String(e)),
      ),
    [api, space.id],
  );
  const routine = data?.routines.find((item) => item.id === space.digestRoutineId);
  const digest = data?.tasks.find((task) => task.id === routine?.lastTaskId);
  const finished = digest?.status === "succeeded" ? digest.id : "";
  useEffect(() => {
    void finished;
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => listener.remove();
  }, [load, finished]);
  return { weeks, error, load, routine, digest };
}

/** A post on the calendar: badge, time, its words and its state. */
function PostChip({
  post,
  day,
  onPress,
  roomy,
}: {
  post: ScheduledPost;
  day: string;
  onPress: () => void;
  /** Full-width, in the day sheet: bigger type. */
  roomy?: boolean;
}) {
  const status = statusOf(post);
  const Icon = status.icon;
  const cancelled = post.status === "cancelled";
  const words = post.summary.replace(PLATFORM_PREFIX, "");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${day} ${time(post.postAt)}, ${platformName(post.app)}, ${status.label}: ${post.summary}`}
      onPress={onPress}
      style={({ pressed }) => ({
        padding: roomy ? 12 : 8,
        gap: roomy ? 6 : 5,
        borderRadius: roomy ? 14 : 12,
        backgroundColor: status.background,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={[s.row, { gap: 6 }]}>
        <Badge app={post.app} size={roomy ? 24 : 20} />
        <Text style={{ fontSize: roomy ? 14 : 12, fontWeight: "600", color: colors.text }}>
          {time(post.postAt)}
        </Text>
      </View>
      <Text
        numberOfLines={roomy ? undefined : 3}
        style={[
          roomy ? s.text : { fontSize: 13, lineHeight: 17 },
          {
            color: cancelled ? colors.mutedStrong : colors.text,
            textDecorationLine: cancelled && !post.error ? "line-through" : "none",
          },
        ]}
      >
        {words.charAt(0).toUpperCase() + words.slice(1)}
      </Text>
      <View style={[s.row, { gap: 4 }]}>
        <Icon size={roomy ? 14 : 12} color={status.color} />
        <Text style={{ fontSize: roomy ? 13 : 11, fontWeight: "600", color: status.color }}>
          {status.label}
        </Text>
      </View>
    </Pressable>
  );
}

/** A picture in a post, with a picture sign while it loads and a way to open it if it can't show. */
function Picture({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const frame = {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: dark ? "rgba(255,255,255,0.14)" : "rgba(17,25,28,0.12)",
    backgroundColor: dark ? "rgba(255,255,255,0.08)" : "rgba(17,25,28,0.06)",
  };
  if (failed)
    return (
      <View style={[frame, s.row, { gap: 8, paddingLeft: 12, flexShrink: 1 }]}>
        <ImageIcon size={18} color={colors.muted} />
        <Text style={[s.small, { color: colors.mutedStrong, flexShrink: 1 }]}>
          Can’t show this picture here.
        </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open the picture"
          onPress={() => void Linking.openURL(url)}
          style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12 }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: BLUE_TEXT }}>Open it</Text>
        </Pressable>
      </View>
    );
  return (
    <View
      style={[
        frame,
        {
          width: 96,
          height: 96,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        },
      ]}
    >
      <ImageIcon size={24} color={colors.muted} />
      <Image
        source={{ uri: url }}
        accessibilityLabel="A picture in the post"
        onError={() => setFailed(true)}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
    </View>
  );
}

/** Posts a day shows before "+N more". */
const PER_DAY = 3;

/** This week's posts, a column a day: what went out, what's scheduled, what waits for an OK. */
export function WeekPosts({
  space,
  agentName,
  posts,
  onChanged,
}: {
  space: SocialSpace;
  agentName: string;
  posts: ScheduledPost[];
  onChanged: () => Promise<unknown>;
}) {
  const { api, notify, navigate } = useWorkspace();
  const openChat = useOpenChat();
  const strip = useRef<ScrollView>(null);
  const scrolled = useRef(false);
  // With room, the week is a grid of four columns a row; on a phone, a strip that opens at today.
  const [room, setRoom] = useState(0);
  const grid = room >= 560;
  const [shownId, setShownId] = useState<string>();
  const [dayShown, setDayShown] = useState<number>();
  // A post opened from a day's list goes back to that list when it closes.
  const [backToDay, setBackToDay] = useState<number>();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const days = weekDays();
  const now = new Date();
  const today = days.findIndex((day) => sameDay(day, now));
  const byDay = days.map((day) =>
    posts
      .filter((post) => sameDay(new Date(post.postAt), day))
      // Cancelled posts go last, so they never push a live one behind "+N more".
      .sort(
        (a, b) =>
          Number(a.status === "cancelled" && !a.error) -
            Number(b.status === "cancelled" && !b.error) || a.postAt.localeCompare(b.postAt),
      ),
  );
  const count = byDay.reduce((n, list) => n + list.length, 0);
  const shown = posts.find((post) => post.id === shownId);
  const dayName = (i: number) =>
    i === today ? "Today" : (days[i]?.toLocaleDateString(undefined, { weekday: "long" }) ?? "");
  const range = weekRange(isoDay(days[0] ?? now));
  const close = (back = true) => {
    setShownId(undefined);
    setProblem("");
    if (back && backToDay !== undefined) setDayShown(backToDay);
    setBackToDay(undefined);
  };
  async function act(name: string, work: () => Promise<unknown>) {
    setBusy(name);
    setProblem("");
    try {
      await work();
      await onChanged();
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy("");
    }
  }
  const decide = async (post: ScheduledPost, choice: "approve" | "cancel") => {
    const done = await act(choice, () =>
      api.request(`/api/spaces/posts/${post.id}/${choice}`, { hash: post.hash }),
    );
    if (!done) return;
    close();
    notify(decidedNote(post, choice));
  };
  const tryAgain = async (post: ScheduledPost) => {
    if (!(await act("again", () => api.request(`/api/spaces/posts/${post.id}/cancel`, {})))) return;
    close(false);
    openChat(space, tryAgainMessage(post));
  };
  const columns = days.map((day, i) => {
    const isToday = i === today;
    const list = byDay[i] ?? [];
    // A full day shows its first posts and "+N more" in the last place.
    const visible = list.length > PER_DAY ? list.slice(0, PER_DAY - 1) : list;
    const more = list.length - visible.length;
    return (
      <View
        key={day.toISOString()}
        style={{
          width: grid ? Math.floor((room - 30) / 4) : 136,
          minHeight: 160,
          padding: 8,
          gap: 8,
          borderRadius: 18,
          borderWidth: isToday ? 2 : 1,
          borderColor: isToday ? colors.blueDark : colors.line,
          backgroundColor: colors.surface,
        }}
      >
        <View style={{ paddingHorizontal: 8, paddingTop: 2 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "700",
              color: isToday ? colors.blueDark : colors.mutedStrong,
            }}
          >
            {isToday ? "Today" : day.toLocaleDateString(undefined, { weekday: "short" })}
          </Text>
          <Text
            style={{
              fontSize: 18,
              fontWeight: "600",
              color: isToday ? colors.blueDark : colors.text,
            }}
          >
            {day.getDate()}
          </Text>
        </View>
        {visible.map((post) => (
          <PostChip
            key={post.id}
            post={post}
            day={dayName(i)}
            onPress={() => setShownId(post.id)}
          />
        ))}
        {more > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`All ${list.length} posts on ${dayName(i)}`}
            onPress={() => setDayShown(i)}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: 8,
              borderRadius: 12,
              backgroundColor: pressed ? colors.subtle : "transparent",
            })}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: BLUE_TEXT }}>+{more} more</Text>
          </Pressable>
        )}
        {!list.length && (
          <Text style={{ fontSize: 12, color: colors.mutedStrong, paddingHorizontal: 8 }}>
            No posts
          </Text>
        )}
      </View>
    );
  });
  const content = shown ? postContent(shown) : undefined;
  const status = shown ? statusOf(shown) : undefined;
  const StatusIcon = status?.icon;
  const scheduler = space.playbook.scheduler
    ? space.playbook.scheduler.charAt(0).toUpperCase() + space.playbook.scheduler.slice(1)
    : undefined;
  return (
    <View style={{ gap: 10 }} onLayout={(event) => setRoom(event.nativeEvent.layout.width)}>
      <View style={{ gap: 2 }}>
        <Text {...heading(3)} style={s.heading}>
          This week’s posts
        </Text>
        <Text style={s.muted}>{range}</Text>
      </View>
      {count === 0 ? (
        <Card style={{ gap: 12 }}>
          <Text style={[s.text, { color: colors.mutedStrong }]}>
            {scheduler
              ? `Posts waiting in ${scheduler} don’t show on this calendar. Ask ${agentName} to check what’s scheduled this week.`
              : `No posts this week yet. When ${agentName} drafts posts, they show up here on their day, waiting for your OK.`}
          </Text>
          {space.setupDone && (
            <Button
              icon={MessageCircle}
              style={{ alignSelf: "flex-start" }}
              onPress={() =>
                openChat(
                  space,
                  scheduler
                    ? "What’s scheduled for this week?"
                    : "Please draft posts for the rest of this week.",
                )
              }
            >
              {scheduler
                ? `Ask ${agentName} what’s scheduled`
                : `Ask ${agentName} to draft this week’s posts`}
            </Button>
          )}
        </Card>
      ) : grid ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{columns}</View>
      ) : (
        <ScrollView
          ref={strip}
          horizontal
          showsHorizontalScrollIndicator={Platform.OS === "web"}
          onContentSizeChange={() => {
            if (scrolled.current) return;
            scrolled.current = true;
            strip.current?.scrollTo({ x: Math.max(0, today - 1) * 146, animated: false });
          }}
          contentContainerStyle={{ gap: 10, paddingVertical: 4, paddingRight: 4 }}
        >
          {columns}
        </ScrollView>
      )}
      {dayShown !== undefined && (
        <Sheet
          title={`${dayName(dayShown)}, ${days[dayShown] ? shortDate(days[dayShown]) : ""}`}
          onClose={() => setDayShown(undefined)}
        >
          <View style={{ gap: 8 }}>
            {(byDay[dayShown] ?? []).map((post) => (
              <PostChip
                key={post.id}
                post={post}
                day={dayName(dayShown)}
                roomy
                onPress={() => {
                  setBackToDay(dayShown);
                  setDayShown(undefined);
                  setShownId(post.id);
                }}
              />
            ))}
          </View>
        </Sheet>
      )}
      {shown && status && StatusIcon && content && (
        <Sheet title={when(shown.postAt)} onClose={() => close()}>
          <View style={{ gap: 16 }}>
            <View
              style={{ padding: 14, gap: 10, borderRadius: 16, backgroundColor: status.background }}
            >
              <View style={[s.between, { gap: 10, flexWrap: "wrap" }]}>
                <View style={[s.row, { gap: 8 }]}>
                  <Badge app={shown.app} />
                  <Text style={[s.text, { fontWeight: "600" }]}>{platformName(shown.app)}</Text>
                </View>
                <View style={[s.row, { gap: 5 }]}>
                  <StatusIcon size={14} color={status.color} />
                  <Text style={{ fontSize: 13, fontWeight: "600", color: status.color }}>
                    {status.label}
                  </Text>
                </View>
              </View>
              <Text style={s.text}>{shown.summary}</Text>
              {!!content.words && (
                <View style={{ gap: 4 }}>
                  <Text style={[s.label, { color: colors.mutedStrong }]}>What it says</Text>
                  <Text style={s.text}>{content.words}</Text>
                </View>
              )}
              {content.images.length > 0 && (
                <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                  {content.images.map((url) => (
                    <Picture key={url} url={url} />
                  ))}
                </View>
              )}
              {/* Said only when the pictures above don't show it already. */}
              {(content.pictures > content.images.length || content.video) && (
                <Text style={[s.text, { color: colors.mutedStrong }]}>
                  With{" "}
                  {[
                    content.pictures
                      ? `${content.pictures} ${content.pictures === 1 ? "picture" : "pictures"}`
                      : "",
                    content.video ? "a video" : "",
                  ]
                    .filter(Boolean)
                    .join(" and ")}
                  .
                </Text>
              )}
            </View>
            {(shown.status === "failed" || (shown.status === "cancelled" && !!shown.error)) && (
              <Text style={[s.text, { color: colors.danger }]}>
                It didn’t go out: {reason(shown)}.
              </Text>
            )}
            {shown.status === "cancelled" && !!shown.error && (
              <Text style={s.muted}>Nothing more to do here.</Text>
            )}
            {shown.status === "posted" && (
              <Text style={s.muted}>Posted {when(shown.postedAt ?? shown.postAt)}.</Text>
            )}
            {shown.status === "cancelled" && !shown.error && (
              <Text style={s.muted}>Cancelled. It won’t go out.</Text>
            )}
            <ErrorNotice error={problem} />
            <View style={{ gap: 8 }}>
              {shown.status === "awaiting_review" && (
                <>
                  <Button
                    primary
                    icon={Check}
                    busy={busy === "approve"}
                    disabled={!!busy}
                    onPress={() => void decide(shown, "approve")}
                  >
                    {Date.parse(shown.postAt) <= Date.now() ? "Approve and post now" : "Approve"}
                  </Button>
                  <Button
                    busy={busy === "cancel"}
                    disabled={!!busy}
                    onPress={() => void decide(shown, "cancel")}
                  >
                    Don’t post this
                  </Button>
                </>
              )}
              {shown.status === "scheduled" && (
                <Button
                  busy={busy === "cancel"}
                  disabled={!!busy}
                  onPress={() => void decide(shown, "cancel")}
                >
                  Cancel this post
                </Button>
              )}
              {shown.status === "failed" && (
                <>
                  {needsReconnect(shown) && (
                    <Button
                      primary
                      disabled={!!busy}
                      onPress={() => {
                        close(false);
                        navigate("apps");
                      }}
                    >
                      Reconnect {platformName(shown.app)} in Apps
                    </Button>
                  )}
                  <Button
                    primary={!needsReconnect(shown)}
                    icon={MessageCircle}
                    busy={busy === "again"}
                    disabled={!!busy}
                    onPress={() => void tryAgain(shown)}
                  >
                    Ask {agentName} to try again
                  </Button>
                  <Button
                    busy={busy === "cancel"}
                    disabled={!!busy}
                    onPress={() => void decide(shown, "cancel")}
                  >
                    Dismiss
                  </Button>
                </>
              )}
              {(shown.status === "awaiting_review" || shown.status === "scheduled") && (
                <Button
                  icon={MessageCircle}
                  disabled={!!busy}
                  onPress={() => {
                    close(false);
                    openChat(
                      space,
                      `I’d like to change the ${platformName(shown.app)} post for ${when(shown.postAt)}: “${shown.summary}”`,
                    );
                  }}
                >
                  Ask {agentName} to change it
                </Button>
              )}
            </View>
          </View>
        </Sheet>
      )}
    </View>
  );
}

/** Where the 90-day plan is: its week, and how each aim is going from the latest digest. */
export function PlanProgress({
  space,
  agentName,
  onPlaybook,
}: {
  space: SocialSpace;
  agentName: string;
  onPlaybook?: () => void;
}) {
  const openChat = useOpenChat();
  const { weeks, error } = useSocialResults(space);
  const { plan, planAt } = space.playbook;
  if (!plan || (!weeks && !error)) return null;
  // Only numbers from this plan's digests: a fresh plan starts without the old plan's aims.
  const measured = [...(weeks ?? [])]
    .reverse()
    .find((week) => week.aims.length && (!planAt || week.savedAt >= planAt));
  const start = planAt ? new Date(planAt) : undefined;
  const week = start
    ? Math.max(1, Math.floor((Date.now() - start.getTime()) / (7 * DAY)) + 1)
    : undefined;
  const over = week !== undefined && week > 13;
  const end = start ? new Date(start.getTime() + 90 * DAY) : undefined;
  const future = dark ? "#3A3450" : "#DCD5F2";
  return (
    <View style={{ gap: 10 }}>
      <Text {...heading(3)} style={s.heading}>
        The 90-day plan
      </Text>
      <Card style={{ gap: 18 }}>
        {start && end && week !== undefined && (
          <View style={{ gap: 8 }}>
            <Text style={[s.text, { fontWeight: "600" }]}>
              {over ? `The 90 days ended ${shortDate(end)}` : `Week ${week} of 13`}
            </Text>
            <View
              role="progressbar"
              aria-label="The plan’s 13 weeks"
              aria-valuemin={1}
              aria-valuemax={13}
              aria-valuenow={Math.min(week, 13)}
              aria-valuetext={over ? "The 90 days are over" : `Week ${week} of 13`}
              style={{ flexDirection: "row", gap: 4 }}
            >
              {Array.from({ length: 13 }, (_, i) => (
                <View
                  // biome-ignore lint/suspicious/noArrayIndexKey: the plan's 13 weeks never move.
                  key={i}
                  style={{
                    flex: 1,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: i < week - 1 || over ? PURPLE : future,
                    ...(i === week - 1 && !over
                      ? { borderWidth: 2, borderColor: PURPLE, backgroundColor: colors.lavender }
                      : {}),
                  }}
                />
              ))}
            </View>
            <View style={s.between}>
              <Text style={[s.small, { color: colors.mutedStrong }]}>{shortDate(start)}</Text>
              <Text style={[s.small, { color: colors.mutedStrong }]}>{shortDate(end)}</Text>
            </View>
          </View>
        )}
        {measured ? (
          <View style={{ gap: 18 }}>
            {measured.aims.map((aim) => {
              const percent = Math.round(aimProgress(aim) * 100);
              return (
                <View key={aim.aim} style={{ gap: 6 }}>
                  <View style={[s.between, { gap: 10, alignItems: "flex-start" }]}>
                    <Text style={[s.text, { fontWeight: "600", flex: 1 }]}>{aim.aim}</Text>
                    <Text
                      style={{
                        fontSize: 14,
                        lineHeight: 23,
                        fontWeight: "700",
                        color: PURPLE,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {percent}%
                    </Text>
                  </View>
                  <View
                    role="progressbar"
                    aria-label={aim.aim}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-valuetext={`${aim.current.toLocaleString()} of ${aim.target.toLocaleString()}`}
                    style={{
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: future,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        width: `${percent}%`,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: PURPLE,
                      }}
                    />
                  </View>
                  <Text style={[s.muted, { color: colors.mutedStrong }]}>{aim.status}</Text>
                </View>
              );
            })}
            <Text style={[s.small, { color: colors.mutedStrong }]}>
              From the digest on {shortDate(new Date(measured.savedAt))}
            </Text>
          </View>
        ) : (
          <Text style={[s.muted, { color: colors.mutedStrong }]}>
            Once {agentName} has real numbers to measure your aims by, you’ll see how each one is
            going here.
          </Text>
        )}
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          {over && (
            <Button primary icon={MessageCircle} onPress={() => openChat(space, PLAN_REQUEST)}>
              Ask {agentName} for a fresh plan
            </Button>
          )}
          {onPlaybook && <Button onPress={onPlaybook}>Read the plan</Button>}
        </View>
      </Card>
    </View>
  );
}

/** A rounded axis step: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(raw: number) {
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const step = [1, 2, 2.5, 5, 10].find((n) => n * power >= raw) ?? 10;
  return step * power;
}
const axis = (value: number) =>
  value >= 10_000 ? `${Math.round(value / 100) / 10}k` : value.toLocaleString();
const weeksApart = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / (7 * DAY));

/** People who saw the posts each week, as a line; a week with no numbers leaves a gap in time. */
function ReachChart({ weeks }: { weeks: SocialWeek[] }) {
  const [width, setWidth] = useState(0);
  const shown = weeks.slice(-12);
  const first = shown[0]?.weekStart ?? "";
  const points = shown.map((week) => ({
    label: monthDay(week.weekStart),
    value: weekReach(week),
    at: weeksApart(first, week.weekStart),
  }));
  const span = Math.max(1, points.at(-1)?.at ?? 1);
  const height = 200;
  const left = 46;
  const right = 18;
  const top = 26;
  const bottom = 28;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = height - top - bottom;
  const step = niceStep(Math.max(...points.map((p) => p.value), 4) / 4);
  const max = step * 4;
  const x = (at: number) => left + (points.length === 1 ? plotWidth / 2 : (at * plotWidth) / span);
  const y = (value: number) => top + plotHeight - (value / max) * plotHeight;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.at)},${y(p.value)}`).join(" ");
  const last = points.at(-1);
  const area = `${line} L${x(last?.at ?? 0)},${top + plotHeight} L${x(0)},${top + plotHeight} Z`;
  // Room for about one date every 64 pixels, always ending on the latest week.
  const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotWidth / 64))));
  return (
    <View
      role="img"
      aria-label={`People who saw your posts each week: ${points.map((p) => `week of ${p.label}, ${p.value.toLocaleString()} people`).join("; ")}`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ height }}
    >
      {width > 0 && (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="reach" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.blueDark} stopOpacity={0.22} />
              <Stop offset="1" stopColor={colors.blueDark} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {[0, 1, 2, 3, 4].map((n) => (
            <Line
              key={n}
              x1={left}
              x2={width - right}
              y1={y(n * step)}
              y2={y(n * step)}
              stroke={colors.line}
              strokeWidth={1}
            />
          ))}
          {[0, 1, 2, 3, 4].map((n) => (
            <SvgText
              key={n}
              x={left - 8}
              y={y(n * step) + 4}
              fontSize={11}
              fontFamily={CHART_FONT}
              fill={colors.mutedStrong}
              textAnchor="end"
            >
              {axis(n * step)}
            </SvgText>
          ))}
          {points.map((p, i) =>
            (points.length - 1 - i) % every === 0 ? (
              <SvgText
                key={p.label}
                x={x(p.at)}
                y={height - 8}
                fontSize={11}
                fontFamily={CHART_FONT}
                fill={colors.mutedStrong}
                textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              >
                {p.label}
              </SvgText>
            ) : null,
          )}
          {points.length > 1 && <Path d={area} fill="url(#reach)" />}
          <Path
            d={line}
            stroke={colors.blueDark}
            strokeWidth={2.5}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.map((p, i) => (
            <Circle
              key={p.label}
              cx={x(p.at)}
              cy={y(p.value)}
              r={i === points.length - 1 ? 5 : 3.5}
              fill={i === points.length - 1 ? colors.blueDark : colors.card}
              stroke={colors.blueDark}
              strokeWidth={2}
            />
          ))}
          {last && (
            <SvgText
              x={x(last.at)}
              y={y(last.value) - 12}
              fontSize={12}
              fontFamily={CHART_FONT}
              fontWeight="700"
              fill={colors.text}
              textAnchor={points.length === 1 ? "middle" : "end"}
            >
              {last.value.toLocaleString()}
            </SvgText>
          )}
        </Svg>
      )}
    </View>
  );
}

/** Each platform's share of a week, as bars. */
function PlatformBars({ week }: { week: SocialWeek }) {
  const reach = [...week.reach].sort((a, b) => b.people - a.people);
  const most = Math.max(...reach.map((r) => r.people), 1);
  return (
    <View style={{ gap: 14 }}>
      {reach.map((r) => (
        <View key={r.platform} style={{ gap: 6 }}>
          <View style={[s.row, { gap: 8 }]}>
            <Badge app={r.platform} size={22} />
            <Text style={[s.text, { flex: 1, fontWeight: "500" }]}>{platformName(r.platform)}</Text>
            <Text style={[s.text, { color: colors.mutedStrong, fontVariant: ["tabular-nums"] }]}>
              {r.people.toLocaleString()} people
            </Text>
          </View>
          <View
            aria-hidden
            style={{
              height: 8,
              borderRadius: 4,
              backgroundColor: colors.subtle,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${Math.max(2, Math.round((r.people / most) * 100))}%`,
                height: 8,
                borderRadius: 4,
                backgroundColor: tone(r.platform).color,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function Competitors({ week }: { week: SocialWeek }) {
  return (
    <View>
      {week.competitors.map((c, i) => (
        <View
          key={c.name}
          style={{
            gap: 4,
            paddingVertical: 12,
            borderTopWidth: i ? 1 : 0,
            borderColor: colors.line,
          }}
        >
          <Text style={[s.text, { fontWeight: "600" }]}>{c.name}</Text>
          <Text style={s.text}>{c.what}</Text>
          {!!c.opening && (
            <View style={[s.row, { gap: 8, alignItems: "flex-start" }]}>
              <View style={{ paddingTop: 4 }}>
                <Lightbulb size={14} color={GREEN} />
              </View>
              <Text style={[s.text, { flex: 1 }]}>
                <Text style={{ color: GREEN, fontWeight: "600" }}>Your chance: </Text>
                {c.opening}
              </Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/** A titled part of the week sheet, set off by a rule. */
function SheetPart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 18 }}>
      <Text {...heading(3)} style={s.heading}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Posts that are done: they went out, didn't, or were cancelled. */
const FINISHED: ScheduledPost["status"][] = ["posted", "failed", "cancelled"];
type PastFilter = "posted" | "missed" | "all";
const PAST_FILTERS: { id: PastFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "posted", label: "Posted" },
  { id: "missed", label: "Didn’t go out" },
];
const PAST_EMPTY: Record<PastFilter, string> = {
  posted: "None have gone out yet. Posts show up here once they do.",
  missed: "Every post went out. Any that don’t go out show up here.",
  all: "",
};
const PAST_SHOWN = 10;
/** When a finished post went out, or was meant to. */
const pastAt = (post: ScheduledPost) => post.postedAt ?? post.postAt;

/**
 * A past post's cell: its badge and words (tap for all of them), then its day and platform. Where
 * room is tight the badge gives way, since the platform's name is right under the words.
 */
function PastPostCell({ post, tight }: { post: ScheduledPost; tight: boolean }) {
  const [whole, setWhole] = useState(false);
  const words = post.summary.replace(PLATFORM_PREFIX, "");
  const failed = statusOf(post).label === "Didn’t go out";
  return (
    <View style={[s.row, { gap: 8, alignItems: "flex-start" }]}>
      {!tight && (
        <View style={{ paddingTop: 1 }}>
          <Badge app={post.app} size={20} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Pressable
          role="button"
          aria-expanded={whole}
          onPress={() => setWhole(!whole)}
          style={({ pressed }) => ({ minHeight: 44, opacity: pressed ? 0.7 : 1 })}
        >
          <Text
            numberOfLines={whole ? undefined : 2}
            style={[s.text, { fontSize: 14, lineHeight: 20 }]}
          >
            {words.charAt(0).toUpperCase() + words.slice(1)}
          </Text>
          <Text style={[s.small, { fontSize: 12, lineHeight: 17, color: colors.mutedStrong }]}>
            {shortDate(new Date(pastAt(post)))} · {platformName(post.app)}
          </Text>
        </Pressable>
        {failed && !!post.error?.trim() && (
          <Text style={[s.small, { fontSize: 12, lineHeight: 17, color: colors.danger }]}>
            {reason(post).charAt(0).toUpperCase() + reason(post).slice(1)}.
          </Text>
        )}
      </View>
    </View>
  );
}

/** Every post that's done, newest first: what it said, where and when, and how it went. */
function PastPosts({ space, agentName }: { space: SocialSpace; agentName: string }) {
  const { posts } = useSpaces();
  const [filter, setFilter] = useState<PastFilter>("all");
  const [shown, setShown] = useState(PAST_SHOWN);
  const [width, setWidth] = useState(0);
  const tight = width > 0 && width < 300;
  const past = posts
    .filter((post) => post.spaceId === space.id && FINISHED.includes(post.status))
    .sort((a, b) => pastAt(b).localeCompare(pastAt(a)));
  const rows = past.filter(
    (post) => filter === "all" || (filter === "posted") === (post.status === "posted"),
  );
  const columns: Column<ScheduledPost>[] = [
    { title: "Post", flex: 3, render: (post) => <PastPostCell post={post} tight={tight} /> },
    {
      title: "How it went",
      flex: 1,
      minWidth: 100,
      render: (post) => {
        const status = statusOf(post);
        return (
          <Text
            numberOfLines={1}
            style={{ fontSize: 14, lineHeight: 20, fontWeight: "600", color: status.color }}
          >
            {status.label}
          </Text>
        );
      },
    },
  ];
  return (
    <Card>
      <View style={{ gap: 14 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <View style={{ gap: 2 }}>
          <Text {...heading(3)} style={s.heading}>
            Past posts
          </Text>
          <Text style={s.muted}>What went out, and what didn’t</Text>
        </View>
        {past.length === 0 ? (
          <Text style={[s.text, { color: colors.mutedStrong }]}>
            Posts show up here after they go out, with how each one went. To get started, ask{" "}
            {agentName} to plan this week’s posts.
          </Text>
        ) : (
          <>
            <Segmented
              label="Which past posts"
              options={PAST_FILTERS}
              value={filter}
              onChange={(id) => {
                setFilter(id);
                setShown(PAST_SHOWN);
              }}
            />
            <DataTable
              label="Past posts"
              columns={columns}
              rows={rows.slice(0, shown)}
              rowKey={(post) => post.id}
              empty={PAST_EMPTY[filter]}
            />
            {rows.length > shown && (
              <Button
                small
                style={{ alignSelf: "flex-start" }}
                onPress={() => setShown(shown + PAST_SHOWN)}
              >
                Show more
              </Button>
            )}
          </>
        )}
      </View>
    </Card>
  );
}

/** The Results tab: how the posts did each week, and every post that's done. */
export function SocialResults({ space, agentName }: { space: SocialSpace; agentName: string }) {
  return (
    <View style={{ gap: 26 }}>
      <WeeklyResults space={space} agentName={agentName} />
      <PastPosts space={space} agentName={agentName} />
    </View>
  );
}

/** How the posts did each week, from the numbers the weekly digest saves. */
function WeeklyResults({ space, agentName }: { space: SocialSpace; agentName: string }) {
  const { api, open, navigate } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const openChat = useOpenChat();
  const { weeks, error, load, routine, digest } = useSocialResults(space);
  const [opened, setOpened] = useState<SocialWeek>();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  async function run(name: string, work: () => Promise<unknown>) {
    setBusy(name);
    setProblem("");
    try {
      await work();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  // Turning a paused digest back on keeps its day and time.
  const digestOn = () =>
    run("digest", async () =>
      replace(
        await api.request<SocialSpace>(
          `/api/spaces/${space.id}/digest`,
          routine ? { on: true, days: routine.days, time: routine.time } : { on: true },
        ),
      ),
    );
  const connect = (
    <Button primary style={{ alignSelf: "flex-start" }} onPress={() => navigate("apps")}>
      Connect them in Apps
    </Button>
  );
  const makeNow = routine?.enabled && (
    <Button
      busy={busy === "now"}
      style={{ alignSelf: "flex-start" }}
      onPress={() => void run("now", () => mutate(`/routines/${routine.id}/run`, {}))}
    >
      Make a digest now
    </Button>
  );
  const noNumbers = `The last digest didn’t save any numbers here. If the places you post aren’t connected in Apps yet, connect them${makeNow ? ", then make a digest now" : ""}.`;
  if (!weeks && !error) return <Text style={s.muted}>Loading your results…</Text>;
  if (!weeks)
    return (
      <View style={{ gap: 10 }}>
        <ErrorNotice error={error} />
        <Button onPress={() => void load()} style={{ alignSelf: "flex-start" }}>
          Try again
        </Button>
      </View>
    );
  if (!weeks.length) {
    const working = digest?.status === "queued" || digest?.status === "running";
    return (
      <Card style={{ gap: 12 }}>
        <ErrorNotice error={problem} />
        <Text {...heading(3)} style={s.heading}>
          Your results show up here
        </Text>
        <Text style={[s.text, { color: colors.mutedStrong }]}>
          Once a week, the weekly digest saves how your posts did here: how many people saw them,
          your best post and what competitors posted. {agentName} reads the numbers from your
          connected apps and never guesses.
        </Text>
        {!routine ? (
          <Button
            primary
            busy={busy === "digest"}
            style={{ alignSelf: "flex-start" }}
            onPress={() => void digestOn()}
          >
            Turn on for Mondays at 8:45 AM
          </Button>
        ) : !routine.enabled ? (
          <>
            <Text style={[s.text, { color: colors.mutedStrong }]}>
              The weekly digest is paused.
            </Text>
            <Button
              primary
              busy={busy === "digest"}
              style={{ alignSelf: "flex-start" }}
              onPress={() => void digestOn()}
            >
              Turn it back on
            </Button>
          </>
        ) : working ? (
          <Text style={[s.text, { color: colors.mutedStrong }]} accessibilityLiveRegion="polite">
            {agentName} is working on a digest now. Your results show up here when it’s done.
          </Text>
        ) : digest?.status === "succeeded" ? (
          <>
            <Text style={[s.text, { color: colors.mutedStrong }]}>{noNumbers}</Text>
            <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
              {connect}
              {makeNow}
            </View>
          </>
        ) : (
          <>
            <Text style={[s.text, { color: colors.mutedStrong }]}>
              Your first results come with the next digest, on {DAY_NAMES[routine.days[0] ?? 1]}
              {routine.time ? ` at ${clockTime(routine.time)}` : ""}.
            </Text>
            {makeNow}
          </>
        )}
      </Card>
    );
  }
  const counted = weeks.filter((week) => week.reach.length);
  const latest = counted.at(-1);
  const before = counted.at(-2);
  const rivals = [...weeks].reverse().find((week) => week.competitors.length);
  const digestFor = (week: SocialWeek) =>
    routine
      ? data?.tasks
          .filter(
            (task) =>
              task.title.startsWith(`${routine.title} · `) && task.createdAt <= week.savedAt,
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;
  const trend = (() => {
    if (!latest || !before) return undefined;
    const now = weekReach(latest);
    const then = weekReach(before);
    const change = (now - then) / Math.max(then, 1);
    const whenBefore =
      weeksApart(before.weekStart, latest.weekStart) === 1
        ? "the week before"
        : `the week of ${monthDay(before.weekStart)}`;
    if (Math.abs(change) < 0.05)
      return { icon: Minus, color: colors.mutedStrong, text: `About the same as ${whenBefore}` };
    return change > 0
      ? { icon: TrendingUp, color: GREEN, text: `Up from ${then.toLocaleString()} ${whenBefore}` }
      : {
          icon: TrendingDown,
          color: colors.mutedStrong,
          text: `Down from ${then.toLocaleString()} ${whenBefore}`,
        };
  })();
  const TrendIcon = trend?.icon;
  const pastWeeks = [...weeks].reverse();
  const openedDigest = opened ? digestFor(opened) : undefined;
  return (
    <View style={{ gap: 26 }}>
      <ErrorNotice error={error || problem} />
      {latest ? (
        <>
          <Card style={{ gap: 14 }}>
            <View style={{ gap: 2 }}>
              <Text {...heading(3)} style={s.heading}>
                People who saw your posts
              </Text>
              <Text style={s.muted}>Each week, everywhere you post</Text>
            </View>
            <View style={{ gap: 4 }}>
              <Text style={[s.text, { color: colors.mutedStrong }]}>
                Week of {monthDay(latest.weekStart)}
              </Text>
              <Text
                style={{ fontSize: 34, fontWeight: "700", letterSpacing: -1, color: colors.text }}
              >
                {weekReach(latest).toLocaleString()}
              </Text>
              {trend && TrendIcon && (
                <View style={[s.row, { gap: 6 }]}>
                  <TrendIcon size={16} color={trend.color} />
                  <Text style={[s.text, { color: trend.color, fontWeight: "500" }]}>
                    {trend.text}
                  </Text>
                </View>
              )}
            </View>
            {counted.length > 1 && <ReachChart weeks={counted} />}
            {(!!latest.headline || !!latest.best) && (
              <View style={{ gap: 4 }}>
                {!!latest.headline && (
                  <Text style={[s.text, { fontWeight: "600" }]}>{latest.headline}</Text>
                )}
                {!!latest.best && (
                  <Text style={[s.text, { color: colors.mutedStrong }]}>
                    Best post: {latest.best}
                  </Text>
                )}
              </View>
            )}
          </Card>
          <Card style={{ gap: 14 }}>
            <View style={{ gap: 2 }}>
              <Text {...heading(3)} style={s.heading}>
                Where people saw them
              </Text>
              <Text style={s.muted}>Week of {monthDay(latest.weekStart)}</Text>
            </View>
            <PlatformBars week={latest} />
          </Card>
        </>
      ) : (
        <Card style={{ gap: 12 }}>
          <Text {...heading(3)} style={s.heading}>
            People who saw your posts
          </Text>
          <Text style={[s.text, { color: colors.mutedStrong }]}>{noNumbers}</Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {connect}
            {makeNow}
          </View>
        </Card>
      )}
      {rivals && (
        <View style={{ gap: 10 }}>
          <View style={{ gap: 2 }}>
            <Text {...heading(3)} style={s.heading}>
              What competitors posted
            </Text>
            <Text style={s.muted}>Week of {monthDay(rivals.weekStart)}</Text>
          </View>
          <Card style={{ paddingVertical: 8 }}>
            <Competitors week={rivals} />
          </Card>
        </View>
      )}
      <View style={{ gap: 12 }}>
        <Text {...heading(3)} style={s.heading}>
          Past weeks
        </Text>
        {pastWeeks.map((week) => {
          const line =
            week.headline ||
            (week.reach.length ? "How the week went" : "No numbers from your apps this week");
          return (
            <Pressable
              key={week.id}
              accessibilityRole="button"
              accessibilityLabel={`Open the week of ${weekRange(week.weekStart)}: ${line}${week.reach.length ? `, ${weekReach(week).toLocaleString()} people saw your posts` : ""}`}
              onPress={() => setOpened(week)}
              style={({ pressed }) => [
                s.row,
                {
                  gap: 14,
                  padding: 16,
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: pressed ? colors.subtle : colors.surface,
                },
              ]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[s.text, { fontWeight: "700" }]}>{weekRange(week.weekStart)}</Text>
                <Text numberOfLines={2} style={[s.text, { color: colors.mutedStrong }]}>
                  {line}
                </Text>
              </View>
              {week.reach.length > 0 && (
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[s.text, { fontWeight: "700", fontVariant: ["tabular-nums"] }]}>
                    {weekReach(week).toLocaleString()}
                  </Text>
                  <Text style={[s.small, { color: colors.mutedStrong }]}>people</Text>
                </View>
              )}
              <ChevronRight size={18} color={colors.muted} />
            </Pressable>
          );
        })}
      </View>
      {opened && (
        <Sheet
          title={`Week of ${monthDay(opened.weekStart)}`}
          subtitle={opened.headline}
          onClose={() => setOpened(undefined)}
        >
          <View style={{ gap: 18 }}>
            {opened.reach.length > 0 && (
              <View style={{ gap: 12 }}>
                <Text style={[s.text, { fontWeight: "600" }]}>
                  {weekReach(opened).toLocaleString()} people saw your posts
                </Text>
                <PlatformBars week={opened} />
              </View>
            )}
            {!!opened.best && <Text style={s.text}>Best post: {opened.best}</Text>}
            {opened.aims.length > 0 && (
              <SheetPart title="The plan’s aims">
                {opened.aims.map((aim) => (
                  <Text key={aim.aim} style={[s.text, { color: colors.mutedStrong }]}>
                    <Text style={{ color: colors.text, fontWeight: "600" }}>{aim.aim}: </Text>
                    {aim.status}
                  </Text>
                ))}
              </SheetPart>
            )}
            {opened.competitors.length > 0 && (
              <SheetPart title="What competitors posted">
                <View style={{ marginTop: -12 }}>
                  <Competitors week={opened} />
                </View>
              </SheetPart>
            )}
            <View style={{ gap: 8 }}>
              {openedDigest && (
                <Button
                  primary
                  onPress={() => {
                    setOpened(undefined);
                    open({ type: "task", taskId: openedDigest.id });
                  }}
                >
                  Open that week’s digest
                </Button>
              )}
              <Button
                icon={MessageCircle}
                onPress={() => {
                  setOpened(undefined);
                  openChat(
                    space,
                    `Let’s talk about the week of ${monthDay(opened.weekStart)}. What worked, and what should we try next?`,
                  );
                }}
              >
                Talk it over with {agentName}
              </Button>
            </View>
          </View>
        </Sheet>
      )}
    </View>
  );
}
