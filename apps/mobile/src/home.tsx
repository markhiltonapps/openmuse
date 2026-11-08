import {
  Bell,
  Bot,
  CalendarClock,
  CalendarDays,
  CarFront,
  Check,
  ChevronRight,
  CloudSun,
  Copy,
  Globe,
  Headset,
  Keyboard,
  type LucideIcon,
  Mail,
  Mic,
  UserPlus,
  X,
} from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import type { ActionProposal } from "../../../packages/domain/src";
import type { AgentTask } from "../../../packages/domain/src/agent";
import type { Weather } from "../../../packages/domain/src/weather";
import { taskActivity } from "./activity";
import { contactCard, contactFileName } from "./agent-contact";
import { updateOpens, useOpenUpdate } from "./agent-ui";
import { useAgentWorkspace } from "./agent-workspace";
import { PlaceAnchor, usePlace } from "./app-places-ui";
import { ApprovalCard } from "./approval-card";
import { Mascot, useReducedMotion } from "./avatar";
import { type AppDay, todaysEvents } from "./calendar-apps";
import { useDriving } from "./driving";
import { Emoji } from "./emoji";
import { GlossFill, OnGloss } from "./gloss";
import { comingUp, countWords as count, recentFew, scheduleWords, whenWords } from "./home-lists";
import { useCallControls } from "./live-call";
import { useLiveVoice } from "./live-talk-ui";
import { useLiveCallOn } from "./live-voice";
import { HomeRecordButton, useRecording } from "./meetings-ui";
import { glass } from "./theme";
import { tipProps } from "./tips";
import { Button, colors, glassSurface, s } from "./ui";
import { dayName, lastShown, todayIn, useWeather } from "./weather-ui";
import { isInstalled } from "./web-app";
import { useWorkspace } from "./workspace";

const NAME_KEY = "openmuse.you-name";
/** Neddy's teal, as a gradient for the glossy buttons and card icons. */
const TEAL: [string, string] = ["#3A8A82", "#1F5B55"];
const ADDRESS_KEY = "openmuse.agent-email";
function rememberedAddress() {
  try {
    return globalThis.localStorage?.getItem(ADDRESS_KEY) ?? "";
  } catch {
    return "";
  }
}
function rememberedName() {
  try {
    return globalThis.localStorage?.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
/** A title's date ("Social media digest · Sep 29") stays on one line with the dot before it. */
const keepDate = (title: string) =>
  title.replace(/ · (.+)$/, (_, date: string) => ` · ${date.replace(/ /g, " ")}`);
/** What a waiting job needs, in the words Activity uses. */
const waitingWords = (status: string) =>
  status === "waiting_input" ? "Needs your answer" : "Waiting for your OK";

/**
 * What needs the person: approvals, and jobs with a question. A job waiting for an approval it
 * made is that approval, so it's counted once (as the approval).
 */
export function waitingOnYou(
  actions: ActionProposal[],
  tasks: { id: string; status: string; title: string }[] | undefined,
) {
  // One that waited too long isn't waiting on anyone; Activity still shows it as expired.
  const approvals = actions.filter(
    (a) => a.status === "awaiting_review" && !(Date.parse(a.expiresAt) < Date.now()),
  );
  const ofJobs = new Set(approvals.map((a) => a.taskId).filter(Boolean));
  const jobs = (tasks ?? []).filter(
    (t) => t.status === "waiting_input" || (t.status === "waiting_approval" && !ofJobs.has(t.id)),
  );
  return { approvals, jobs, count: approvals.length + jobs.length };
}

const ink = () => (glass ? "#FFFFFF" : colors.text);
const soft = () => (glass ? "rgba(255, 255, 255, 0.82)" : colors.mutedStrong);

/** The greeting home: what needs you, today, and what the agent is doing, then talk or type. */
export function HomeScreen({ desktop }: { desktop: boolean }) {
  const { workspace: w, api, open, navigate } = useWorkspace();
  const { data, error: jobsError, mutate } = useAgentWorkspace();
  const agent = data?.identity.name || "Neddy";
  const { result: weather } = useWeather();
  // A stopped job (the ✕ on a Needs you row): what happened, in the card where its row was, with
  // Undo for a while. The card stays while this shows, even when it was the last row.
  const [gone, setGone] = useState<{
    title: string;
    text: string;
    undo: boolean;
    failed?: boolean;
  }>();
  const goneTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // No second ✕ for a moment after one: the next row slides into the tapped spot.
  const [stopping, setStopping] = useState(false);
  useEffect(() => () => clearTimeout(goneTimer.current), []);
  const sayGone = (title: string, text: string, undo: boolean, seconds: number, failed = false) => {
    clearTimeout(goneTimer.current);
    setGone({ title, text, undo, failed });
    goneTimer.current = setTimeout(() => setGone(undefined), seconds * 1000);
  };
  const stopJob = async (task: Pick<AgentTask, "id" | "title">) => {
    setStopping(true);
    try {
      // One tidy (stop + archive), so Undo here, in Activity or by voice brings back exactly this.
      await mutate("/tasks/archive", { ids: [task.id], stop: true });
      sayGone(task.title, `Stopped “${task.title}”. It’s under Archived in Activity.`, true, 20);
      // The ✕ that had focus is gone: keyboard and screen-reader focus go to Undo.
      if (Platform.OS === "web")
        setTimeout(() => document.getElementById("needs-you-undo")?.focus(), 50);
    } catch (e) {
      sayGone(
        task.title,
        e instanceof Error ? e.message : "Couldn’t stop it. Try again.",
        false,
        8,
        true,
      );
    } finally {
      setTimeout(() => setStopping(false), 1000);
    }
  };
  const undoStop = async () => {
    const title = gone?.title ?? "it";
    try {
      // Undo brings back the last tidy, wherever it was done; say what really came back.
      const result = await mutate<{ jobs: string[] }>("/tasks/undo", {});
      const n = result.jobs.length;
      sayGone(
        title,
        n === 1
          ? `Brought back “${title}”.`
          : n
            ? `Brought back ${n} jobs.`
            : "Nothing to bring back.",
        false,
        6,
      );
    } catch (e) {
      sayGone(
        title,
        e instanceof Error ? e.message : "Couldn’t bring it back. Try again.",
        true,
        8,
        true,
      );
    }
  };
  const [appDay, setAppDay] = useState<AppDay | null>();
  useEffect(() => {
    api.request<AppDay>("/api/calendar/today").then(setAppDay, () => setAppDay(null));
  }, [api]);
  // Where the rows at the bottom go: the same places the Apps tabs open.
  const tracking = usePlace({ place: "tracking" });
  const agentSettings = usePlace({ place: "agent-settings" });
  const aboutYou = usePlace({ place: "memory" });
  const alerts = usePlace({ place: "alerts" });
  const account = usePlace({ place: "account" });
  const help = usePlace({ place: "help" });
  // Their name, remembered so the greeting doesn't change under them as the app opens.
  const [name, setName] = useState(rememberedName);
  useEffect(() => {
    void api
      .request<{ facts: { key: string; value: string }[] }>("/api/persona")
      .then((persona) => {
        const said = persona.facts.find((fact) => fact.key === "you.name")?.value?.trim() ?? "";
        setName(said);
        try {
          globalThis.localStorage?.setItem(NAME_KEY, said);
        } catch {
          // Private browsing: it's looked up each time.
        }
      })
      .catch(() => undefined);
  }, [api]);

  // A short computer window (a laptop) gets the phone's spacing, so the cards clear the Talk bar.
  const { height } = useWindowDimensions();
  const tall = desktop && height >= 820;
  // Shorter still (1280×720): the phone's sizes.
  const roomy = desktop && height >= 760;
  const now = new Date();
  const hour = now.getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  // Jobs come a moment after the rest: until then nothing about them is said or drawn.
  // If jobs can't be loaded, the cards still come (without job rows) rather than never.
  const known = !!data || !!jobsError;
  const { approvals, jobs, count: needs } = waitingOnYou(w.actions, data?.tasks);
  const busy = (data?.tasks ?? []).filter((t) => t.status === "running" || t.status === "queued");
  const current = busy[0];
  const upcoming = comingUp(data?.routines ?? []);
  const recent = recentFew(data?.notifications ?? []);
  const unread = (data?.notifications ?? []).filter((item) => !item.read).length;
  const suggestions = data?.memorySuggestions.length ?? 0;
  // An update is marked read and opens what it's about, exactly as the Updates list does.
  const openUpdate = useOpenUpdate();
  const sub = !known
    ? " "
    : needs
      ? `${count(needs)} ${needs === 1 ? "thing needs" : "things need"} ${
          jobs.length ? "you" : "your OK"
        }.${busy.length ? ` ${agent} is on the rest.` : ""}`
      : !data
        ? " "
        : busy.length
          ? `Nothing needs you right now. ${agent} is on ${busy.length === 1 ? "a job" : `${count(busy.length).toLowerCase()} jobs`}.`
          : "Nothing needs you right now.";
  const events = todaysEvents([...w.events, ...(appDay?.events ?? [])], now);
  const calendarConnected =
    !!appDay?.checked.length ||
    w.connections.some(
      (c) => c.id === "google" && (c.status === "connected" || c.status === "sample"),
    );
  const shown = events.slice(0, 3);
  const more = events.length - shown.length;
  // Full time for the screen reader; the card drops AM/PM to fit.
  const spoken = (e: (typeof events)[number]) =>
    e.allDay
      ? "All day"
      : new Date(e.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const time = (e: (typeof events)[number]) => spoken(e).replace(/\s?[AP]M$/i, "");
  // Never says the day is clear when a calendar couldn't be read.
  const dayNote =
    appDay === undefined || events.length
      ? ""
      : appDay === null || appDay.failed.length
        ? "Couldn’t load your calendar."
        : calendarConnected
          ? "Nothing left on your calendar today."
          : "No calendar connected yet.";
  const jobLine = current
    ? current.status === "queued"
      ? "Getting started…"
      : taskActivity(current).label
    : "";
  const shadow = glass
    ? { textShadowColor: "rgba(30, 10, 40, 0.55)", textShadowRadius: 18 }
    : undefined;

  return (
    <View
      style={{
        gap: tall ? 26 : roomy ? 16 : desktop ? 12 : 18,
        paddingTop: tall ? 12 : desktop ? 8 : 0,
      }}
    >
      <View style={{ alignItems: "center", gap: 6 }}>
        <Text
          role="heading"
          aria-level={1}
          nativeID="page-title"
          style={[
            {
              color: ink(),
              fontSize: tall ? 52 : roomy ? 40 : 32,
              lineHeight: tall ? 58 : roomy ? 46 : 36,
              fontWeight: "800",
              letterSpacing: tall ? -1.6 : roomy ? -1.1 : -0.8,
              textAlign: "center",
            },
            shadow,
          ]}
        >
          {name ? `${hello}, ${name}.` : `${hello}.`}
        </Text>
        <Text
          style={[
            {
              color: glass ? "rgba(255, 255, 255, 0.92)" : colors.mutedStrong,
              fontSize: roomy ? 18 : 15,
              fontWeight: "500",
              textAlign: "center",
              maxWidth: 380,
            },
            shadow,
          ]}
        >
          {sub}
        </Text>
      </View>
      {/* Nothing below the greeting until the jobs are in, so no card moves under a thumb. */}
      {known && (
        <View style={{ gap: desktop ? 16 : 12 }}>
          {(approvals.length > 0 || jobs.length > 0 || gone) && (
            <HomeCard
              title="Needs you"
              icon={Check}
              badge={needs || undefined}
              badgeWords={`${count(needs).toLowerCase()} ${needs === 1 ? "thing" : "things"}`}
            >
              {/* The real card: Approve (named for what it does) and See details, right here. */}
              {approvals.slice(0, 3).map((action) => (
                <ApprovalCard
                  key={action.id}
                  actionId={action.id}
                  wide
                  eyebrow={false}
                  radius={14}
                />
              ))}
              {jobs.slice(0, Math.max(0, 3 - approvals.length)).map((task, index) => (
                <Waiting
                  key={task.id}
                  first={!approvals.length && index === 0}
                  title={task.title}
                  line={waitingWords(task.status)}
                  button={task.status === "waiting_input" ? "Answer" : "Review"}
                  onPress={() => open({ type: "task", taskId: task.id })}
                  onDismiss={stopping ? undefined : () => void stopJob(task)}
                />
              ))}
              {/* Always mounted, so a change is read out (a line that appears with its text often
                  isn't); out of the flow and untouchable. */}
              <Text
                role="status"
                aria-live="polite"
                pointerEvents="none"
                style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
              >
                {gone?.text ?? ""}
              </Text>
              {gone && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingTop: approvals.length || jobs.length ? 10 : 0,
                    borderTopWidth: approvals.length || jobs.length ? 1 : 0,
                    borderTopColor: glass ? "rgba(255,255,255,0.12)" : colors.line,
                  }}
                >
                  <Text
                    style={{ color: gone.failed ? colors.danger : soft(), fontSize: 13, flex: 1 }}
                    numberOfLines={3}
                  >
                    {gone.text}
                  </Text>
                  {gone.undo && (
                    <Pressable
                      nativeID="needs-you-undo"
                      accessibilityRole="button"
                      accessibilityLabel={`Undo: bring back ${gone.title}`}
                      onPress={() => void undoStop()}
                      style={({ pressed }) => ({
                        height: 36,
                        paddingHorizontal: 14,
                        borderRadius: 18,
                        borderWidth: 1.5,
                        borderColor: glass ? "rgba(255,255,255,0.35)" : colors.edge,
                        justifyContent: "center",
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Text style={{ color: ink(), fontSize: 14, fontWeight: "700" }}>Undo</Text>
                    </Pressable>
                  )}
                </View>
              )}
              {needs > 3 && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigate("activity")}
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <Text style={[s.small, { color: ink(), fontWeight: "600" }]}>
                    {count(needs - 3)} more in Activity
                  </Text>
                </Pressable>
              )}
            </HomeCard>
          )}
          <View style={{ flexDirection: "row", gap: desktop ? 16 : 12, alignItems: "stretch" }}>
            <HomeCard
              title="Today"
              icon={CalendarDays}
              onPress={() => navigate("feed")}
              // A button's name replaces what's in it, so it carries what the card says.
              label={`Today: ${shown
                .map((e) => `${spoken(e)} ${e.title}`)
                .join(", ")}${shown.length ? ". " : ""}${more ? `And ${more} more. ` : ""}${
                dayNote ? `${dayNote} ` : ""
              }Opens your day in Feed`}
              style={{ flex: 1 }}
            >
              {shown.map((e) => (
                <View key={`${e.id}-${e.start}`} style={{ flexDirection: "row", gap: 10 }}>
                  <Text
                    style={{
                      color: ink(),
                      fontWeight: "700",
                      fontSize: 14,
                      minWidth: 44,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {time(e)}
                  </Text>
                  <Text style={{ color: ink(), fontSize: 14, flex: 1 }} numberOfLines={2}>
                    {e.title}
                  </Text>
                </View>
              ))}
              {more > 0 && (
                <Text style={[s.small, { color: soft() }]}>
                  And {count(more).toLowerCase()} more
                </Text>
              )}
              {!!dayNote && <Text style={[s.small, { color: soft() }]}>{dayNote}</Text>}
            </HomeCard>
            <HomeCard
              title="Working on"
              icon={Globe}
              onPress={() =>
                current ? open({ type: "task", taskId: current.id }) : open({ type: "delegate" })
              }
              label={
                current
                  ? `Working on: ${current.title}. ${jobLine}. Opens this job`
                  : !data
                    ? `Working on: couldn’t load your jobs. Give ${agent} a job`
                    : `Working on: nothing right now. Give ${agent} a job`
              }
              style={{ flex: 1 }}
            >
              {current ? (
                <>
                  <Text
                    style={{ color: ink(), fontSize: 14, fontWeight: "600", lineHeight: 19 }}
                    numberOfLines={3}
                  >
                    {keepDate(current.title)}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 7, alignItems: "center" }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: colors.greenDark,
                      }}
                    />
                    <Text style={{ color: soft(), fontSize: 13, flex: 1 }} numberOfLines={2}>
                      {jobLine}
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={[s.small, { color: soft() }]}>
                  {data
                    ? `Nothing right now. Tap to give ${agent} a job.`
                    : `Couldn’t load your jobs. Tap to give ${agent} a job.`}
                </Text>
              )}
            </HomeCard>
          </View>
          {weather && "weather" in weather ? (
            <WeatherCard weather={weather.weather} onPress={() => navigate("feed")} />
          ) : (
            // Holds the card's room while the forecast loads, so the cards below don't jump.
            !weather && lastShown() && <WeatherRoom />
          )}
          <AddressCard agent={agent} />
          {upcoming.length > 0 && (
            <HomeCard title="Coming up" icon={CalendarClock}>
              {upcoming.map((routine, index) => (
                <Row
                  key={routine.id}
                  first={index === 0}
                  title={routine.title}
                  line={scheduleWords(routine)}
                  label={`${routine.title}, ${scheduleWords(routine)}. Opens Goals › Tracking`}
                  onPress={() => tracking.go()}
                />
              ))}
            </HomeCard>
          )}
          {/* Always here, so "Home › Recent › See all" is true even before the first update. */}
          <HomeCard
            title="Recent"
            icon={Bell}
            badge={unread || undefined}
            badgeWords={`${count(unread).toLowerCase()} new`}
            more="See all"
            moreLabel="See all updates. Opens Updates"
            onMore={() => open({ type: "notifications" })}
          >
            {recent.length === 0 && (
              <Text style={{ color: soft(), fontSize: 13, lineHeight: 18 }}>
                Nothing yet. What {agent} does and notices shows up here.
              </Text>
            )}
            {recent.map((item, index) => (
              <Row
                key={item.id}
                first={index === 0}
                title={item.title}
                line={whenWords(item.createdAt)}
                strong={!item.read}
                label={`${item.title}, ${whenWords(item.createdAt)}${item.read ? "" : ", new"}. ${updateOpens(item)}`}
                onPress={() =>
                  void openUpdate(item, () => open({ type: "notifications" })).catch(() =>
                    // Couldn't be marked read (offline?): still show it.
                    open({ type: "notifications" }),
                  )
                }
              />
            ))}
          </HomeCard>
          <PlaceAnchor id="about-neddy" label={`About ${agent}`} radius={24}>
            <HomeCard title={`About ${agent}`} icon={Bot}>
              <Row
                first
                title="Name, look and voice"
                line={agent}
                label={`Name, look and voice: ${agent}. Opens Agent in Apps`}
                onPress={() => agentSettings.go()}
              />
              <Row
                title="About you"
                line={
                  suggestions
                    ? `${count(suggestions)} ${suggestions === 1 ? "suggestion" : "suggestions"} waiting for you`
                    : `What ${agent} knows about you`
                }
                strong={suggestions > 0}
                label={`About you${suggestions ? `, ${suggestions} ${suggestions === 1 ? "suggestion" : "suggestions"} waiting` : ""}. Opens About you`}
                onPress={() => aboutYou.go()}
              />
              <Row
                title={`When ${agent} speaks up`}
                line="Heads-ups, notifications and email alerts"
                label={`When ${agent} speaks up. Opens Alerts`}
                onPress={() => alerts.go()}
              />
              <Row
                title="Your plan"
                line="Minutes, messages and what’s included"
                label="Your plan. Opens Account"
                onPress={() => account.go()}
              />
              <Row
                title="Help & how-to"
                line={`Pictures of every screen, and what to say to ${agent}`}
                label="Help and how-to. Opens Help"
                onPress={() => help.go()}
              />
            </HomeCard>
          </PlaceAnchor>
        </View>
      )}
    </View>
  );
}

/** A tappable row in a Home card: a title, a line under it, a chevron. The whole row is the target. */
function Row({
  first = false,
  title,
  line,
  strong = false,
  label,
  onPress,
}: {
  first?: boolean;
  title: string;
  line: string;
  /** Unread: the title in the stronger ink. */
  strong?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 44,
        paddingTop: first ? 0 : 8,
        paddingBottom: 6,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: glass ? "rgba(255,255,255,0.12)" : colors.line,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{ color: ink(), fontSize: 15, fontWeight: strong ? "700" : "600" }}
          numberOfLines={2}
        >
          {keepDate(title)}
        </Text>
        <Text style={{ color: soft(), fontSize: 13, marginTop: 2 }} numberOfLines={2}>
          {line}
        </Text>
      </View>
      <ChevronRight size={18} color={soft()} />
    </Pressable>
  );
}

/** The Weather card's space, empty, while the forecast loads. */
function WeatherRoom() {
  return (
    <View aria-hidden>
      <HomeCard title="Weather" icon={CloudSun}>
        <View style={{ height: 121 }} />
      </HomeCard>
    </View>
  );
}

/** The week at a glance: now, then each day's high and low. Tap for the full forecast in Feed. */
function WeatherCard({ weather, onPress }: { weather: Weather; onPress: () => void }) {
  const today = todayIn(weather.timeZone);
  const days = weather.days.slice(0, 7);
  // Late in the evening today has no high left: its column shows the low and says "Tonight".
  const name = (day: Weather["days"][number]) =>
    day.date === today && day.high === undefined ? "Tonight" : dayName(day.date, today, "short");
  const spoken = days
    .map(
      (day) =>
        `${name(day)}: ${day.sky.toLowerCase()}${day.high !== undefined ? `, high ${day.high}` : ""}${day.low !== undefined ? `, low ${day.low}` : ""}`,
    )
    .join(". ");
  return (
    <HomeCard
      title="Weather"
      icon={CloudSun}
      onPress={onPress}
      label={`Weather in ${weather.place}: ${weather.now.temp} degrees, ${weather.now.sky.toLowerCase()}. ${spoken}. Opens the forecast in Feed`}
    >
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <Text style={{ color: ink(), fontSize: 30, fontWeight: "700", letterSpacing: -0.6 }}>
          {weather.now.temp}°
        </Text>
        <Text style={{ color: soft(), fontSize: 14, flexShrink: 1 }}>
          {weather.now.sky} · {weather.place}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 2 }}>
        {days.map((day) => (
          <View key={day.date} style={{ flex: 1, minWidth: 0, alignItems: "center", gap: 3 }}>
            <Text style={{ color: soft(), fontSize: 12, fontWeight: "600" }} numberOfLines={1}>
              {day.date === today && day.high === undefined ? "Night" : name(day)}
            </Text>
            <Emoji char={day.emoji} size={24} />
            <Text style={{ color: ink(), fontSize: 14, fontWeight: "700" }}>
              {day.high !== undefined ? `${day.high}°` : "–"}
            </Text>
            <Text style={{ color: soft(), fontSize: 12 }}>
              {day.low !== undefined ? `${day.low}°` : " "}
            </Text>
          </View>
        ))}
      </View>
    </HomeCard>
  );
}

/**
 * The address people forward mail to, where they can't miss it: copy it, or save it as a contact so
 * their mail app can fill it in when they type the agent's name. Only shown when mail can really
 * arrive (the server has agent email set up).
 */
function AddressCard({ agent }: { agent: string }) {
  const { api } = useWorkspace();
  // Remembered, so the card doesn't pop in under a thumb on the next open.
  const [address, setAddress] = useState(rememberedAddress);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<"copied" | "saved">();
  useEffect(() => {
    void api.request<{ configured?: boolean; address?: string }>("/api/agent-email").then(
      (settings) => {
        const found = settings.configured ? (settings.address ?? "") : "";
        setAddress(found);
        try {
          if (found) globalThis.localStorage?.setItem(ADDRESS_KEY, found);
          else globalThis.localStorage?.removeItem(ADDRESS_KEY);
        } catch {
          // Private browsing: it's looked up each time.
        }
      },
      () => undefined,
    );
  }, [api]);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => {
      setNote("");
      setDone(undefined);
    }, 4500);
    return () => clearTimeout(timer);
  }, [note]);
  if (!address) return null;
  const web = Platform.OS === "web";
  const copy = async () => {
    try {
      await globalThis.navigator.clipboard.writeText(address);
      setDone("copied");
      setNote("Copied.");
    } catch {
      setNote("Couldn’t copy. Select the address and copy it by hand.");
    }
  };
  const save = () => {
    const url = URL.createObjectURL(
      new Blob([contactCard(agent, address)], { type: "text/vcard;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = contactFileName(agent);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setDone("saved");
    setNote(`Contact card downloaded. Open it to add ${agent} to your contacts.`);
  };
  return (
    <HomeCard title={`Email ${agent}`} icon={Mail}>
      {/* The note replaces this line, high in the card, so it can't end up under the Talk bar and the
          card never changes size. Mounted all the time so a change is read out. */}
      <Text role="status" aria-live="polite" style={{ color: soft(), fontSize: 13 }}>
        {note ||
          `Forward mail here and ${agent} gets to work on it. Mail from addresses you haven’t approved is held.`}
      </Text>
      <Text
        selectable
        style={
          {
            color: ink(),
            fontSize: 14,
            fontWeight: "700",
            wordBreak: "break-all",
          } as object
        }
      >
        {address}
      </Text>
      {web && (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Button
            small
            icon={done === "copied" ? Check : Copy}
            onPress={() => void copy()}
            style={{ flex: 1, minWidth: 100 }}
          >
            Copy
          </Button>
          {/* An installed web app on an iPhone ignores downloads and would lose its page. */}
          {!isInstalled() && (
            <Button
              small
              icon={done === "saved" ? Check : UserPlus}
              onPress={save}
              style={{ flex: 1, minWidth: 100 }}
            >
              Save contact
            </Button>
          )}
        </View>
      )}
    </HomeCard>
  );
}

function HomeCard({
  title,
  icon: Icon,
  badge,
  badgeWords,
  onPress,
  label,
  style,
  more,
  moreLabel,
  onMore,
  children,
}: {
  title: string;
  icon: LucideIcon;
  badge?: number;
  /** The count in words for the heading's screen-reader name: "two things", "three new". */
  badgeWords?: string;
  onPress?: () => void;
  label?: string;
  style?: object;
  /** A link in the heading row ("See all"), and what it opens. */
  more?: string;
  moreLabel?: string;
  onMore?: () => void;
  children: ReactNode;
}) {
  const body = (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* One accent (owner, 2026-11-07): Neddy's teal on its tint, no colour tiles. */}
          <GlossFill
            id={`home-${title}`}
            from={TEAL[0]}
            to={TEAL[1]}
            angle="tilted"
            shine={0.4}
            radius={9}
          />
          <OnGloss>
            <Icon size={16} color="#FFFFFF" strokeWidth={2.2} />
          </OnGloss>
        </View>
        <Text
          role="heading"
          aria-level={2}
          // The count pill is a bare number to a screen reader, so the heading says it in words.
          aria-label={badge ? `${title}, ${badgeWords ?? String(badge)}` : undefined}
          style={{ flex: 1, color: ink(), fontSize: 15, fontWeight: "700" }}
        >
          {title}
        </Text>
        {!!badge && (
          <View
            aria-hidden
            style={{
              minWidth: 24,
              height: 24,
              paddingHorizontal: 8,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: glass ? "rgba(255,255,255,0.16)" : colors.subtle,
            }}
          >
            <Text style={{ color: ink(), fontSize: 13, fontWeight: "800" }}>{badge}</Text>
          </View>
        )}
        {!!more && !!onMore && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={moreLabel ?? `${more}: ${title}`}
            onPress={onMore}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: 6,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text
              style={{
                color: glass ? "#FFFFFF" : colors.blueText,
                fontSize: 14,
                fontWeight: "700",
              }}
            >
              {more}
            </Text>
          </Pressable>
        )}
      </View>
      {children}
    </>
  );
  const surface = [
    {
      borderRadius: 24,
      padding: 14,
      paddingBottom: 12,
      gap: 10,
      backgroundColor: colors.card,
      minWidth: 0,
    },
    // On the plain light page a white card needs an edge and a soft shadow to be seen.
    !glass && {
      borderWidth: 1,
      borderColor: colors.line,
      shadowColor: "#132631",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.07,
      shadowRadius: 18,
    },
    glassSurface,
    style,
  ];
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      onPress={onPress}
      style={({ pressed }) => [surface, pressed && { opacity: 0.85 }]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={surface}>{body}</View>
  );
}

function Waiting({
  first,
  title,
  line,
  button,
  onPress,
  onDismiss,
}: {
  first: boolean;
  title: string;
  line: string;
  button: string;
  onPress: () => void;
  /** Stops the job (owner, 2026-11-07: a way to delete a Needs you row): archived, with Undo. */
  onDismiss?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingTop: first ? 0 : 10,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: glass ? "rgba(255,255,255,0.12)" : colors.line,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: ink(), fontSize: 15, fontWeight: "600" }} numberOfLines={2}>
          {keepDate(title)}
        </Text>
        <Text style={{ color: soft(), fontSize: 13, marginTop: 2 }}>{line}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${button}: ${title}`}
        onPress={onPress}
        style={({ pressed }) => ({
          height: 44,
          paddingHorizontal: 18,
          borderRadius: 22,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          transform: [{ scale: pressed ? 0.97 : 1 }],
        })}
      >
        <GlossFill id={`review-${title}`} from={TEAL[0]} to={TEAL[1]} radius={22} />
        <OnGloss>
          <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "700" }}>{button}</Text>
        </OnGloss>
      </Pressable>
      {onDismiss && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Stop: ${title}`}
          {...tipProps("Stop")}
          onPress={onDismiss}
          // react-native-web passes `hovered`; the native types don't know it.
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
            width: 44,
            height: 44,
            marginRight: -8,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              pressed || hovered
                ? glass
                  ? "rgba(255,255,255,0.12)"
                  : colors.subtle
                : "transparent",
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <X size={18} color={soft()} strokeWidth={2.2} />
        </Pressable>
      )}
    </View>
  );
}

/**
 * Shown while the phone looks to be in a car (owner, 2026-11-08): the app can't tell a driver from a
 * passenger, so it says what it saw and lets them say they aren't driving. Talk below it gets bigger.
 */
function DrivingBanner({ agent }: { agent: string }) {
  const { api } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const notDriving = async () => {
    setBusy(true);
    try {
      await api.request("/api/location/not-driving", {});
      // Home hears at once; the server holds it for half an hour.
      window.dispatchEvent(new Event("location-sharing"));
    } catch {
      // Still shown; the next tap tries again.
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      accessibilityRole="summary"
      style={[
        {
          marginHorizontal: 16,
          marginTop: 22,
          padding: 14,
          borderRadius: 22,
          gap: 8,
          backgroundColor: colors.card,
        },
        !glass && { borderWidth: 1, borderColor: colors.line },
        glassSurface,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <CarFront size={22} color={ink()} strokeWidth={2.2} />
        <Text style={{ flex: 1, color: ink(), fontSize: 16, fontWeight: "700" }}>
          Looks like you’re on the move
        </Text>
      </View>
      <Text style={{ color: soft(), fontSize: 14 }}>
        {`Talk is hands-free, and ${agent} keeps answers short. If you’re driving, please only use it when it’s safe.`}
      </Text>
      <View style={{ alignSelf: "flex-start" }}>
        <Button busy={busy} onPress={() => void notDriving()}>
          I’m not driving
        </Button>
      </View>
    </View>
  );
}

/** Talk to the agent (a live call where it's on, otherwise the chat), or type in the chat. */
export function HomeTalkRow({ desktop }: { desktop: boolean }) {
  const { navigate, draft } = useWorkspace();
  const movingNow = useDriving();
  const { data } = useAgentWorkspace();
  // During a live call the phone's attention goes to the voice: the hover pauses.
  const onCall = useLiveCallOn();
  const reduce = useReducedMotion();
  const agent = data?.identity.name || "Neddy";
  const live = useLiveVoice();
  const call = useCallControls();
  // While a meeting records, the microphone is the recorder's: Talk goes to the chat.
  const recording = useRecording();
  const calling = live === "on" && !recording;
  // Only where Talk really is a live call: a driver is never sent to a typing screen.
  const driving = movingNow && calling;
  const label =
    call.phase === "on"
      ? `Back to the call with ${agent}`
      : calling
        ? `Talk to ${agent}`
        : `Talk to ${agent} in the chat`;
  const talk = () => {
    if (calling || call.phase === "on") {
      // A call that just ended: talk again (the call screen starts one when idle).
      if (call.phase === "over") call.dismiss();
      call.expand();
    } else navigate("chat");
  };
  // Three buttons on a phone: the round ones get a little smaller and Talk drops its icon, so
  // "Talk to Neddy" still fits whole. The row's own width, not the window's (the column is capped).
  const [rowWidth, setRowWidth] = useState(0);
  const tight = rowWidth > 0 && rowWidth < 440;
  const round = tight ? 56 : 62;
  const tall = driving ? 92 : 62;
  return (
    <>
      {driving && (
        <View style={{ width: "100%", maxWidth: desktop ? 460 : undefined, alignSelf: "center" }}>
          <DrivingBanner agent={agent} />
        </View>
      )}
      <View
        onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
        style={{
          flexDirection: "row",
          gap: tight ? 8 : 10,
          alignItems: "center",
          alignSelf: "center",
          width: "100%",
          maxWidth: desktop ? 460 : undefined,
          paddingHorizontal: 16,
          paddingTop: driving ? 18 : 22,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={talk}
          style={({ pressed }) => ({
            flex: 1,
            height: tall,
            borderRadius: tall / 2,
            justifyContent: "center",
            paddingLeft: tight ? 70 : 78,
            paddingRight: tight ? 16 : 20,
            transform: [{ scale: pressed ? 0.98 : 1 }],
            shadowColor: TEAL[1],
            shadowOpacity: 0.3,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 8 },
          })}
        >
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: tall / 2,
              overflow: "hidden",
            }}
          >
            <GlossFill id="talk" from={TEAL[0]} to={TEAL[1]} radius={tall / 2} />
          </View>
          {/* He hovers in the bar on his jets, his head rising above it (owner, 2026-11-07: he
            moves like the one at the top of the screen, never a still picture). */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              bottom: driving ? 14 : 12,
              width: 78,
              height: 78,
            }}
          >
            <Mascot
              size={78}
              character="neddy"
              eyes={data?.identity.eyes}
              flying
              quiet={onCall}
              animated={!reduce}
            />
          </View>
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 10, position: "relative" }}
          >
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                color: "#FFFFFF",
                fontSize: driving ? 22 : 18,
                fontWeight: "700",
                letterSpacing: -0.2,
              }}
            >
              Talk to {agent}
            </Text>
            {/* A headset for a call; a microphone where talking happens in the chat. */}
            {tight ? null : calling || call.phase === "on" ? (
              <Headset size={26} color="#FFFFFF" />
            ) : (
              <Mic size={26} color="#FFFFFF" />
            )}
          </View>
        </Pressable>
        {/* Typing and recording aren't offered while driving. */}
        {driving ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Type a message to ${agent}`}
            {...tipProps(`Type to ${agent}`)}
            onPress={() => draft("")}
            style={({ pressed }) => [
              {
                width: round,
                height: round,
                borderRadius: round / 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: glass ? "rgba(30, 24, 44, 0.66)" : colors.card,
                borderWidth: 1,
                borderColor: glass ? "rgba(255,255,255,0.18)" : colors.line,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              },
              !glass && {
                shadowColor: "#132631",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.07,
                shadowRadius: 18,
              },
              glassSurface,
            ]}
          >
            <Keyboard size={26} color={ink()} />
          </Pressable>
        )}
        {driving ? null : <HomeRecordButton glass={glass} ink={ink()} size={round} />}
      </View>
    </>
  );
}
