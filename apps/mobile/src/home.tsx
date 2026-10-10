import {
  CalendarDays,
  Check,
  Globe,
  Headset,
  Keyboard,
  type LucideIcon,
  Mic,
} from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { Image, Pressable, Text, useWindowDimensions, View } from "react-native";
import type { ActionProposal } from "../../../packages/domain/src";
import { taskActivity } from "./activity";
import { useAgentWorkspace } from "./agent-workspace";
import { type AppDay, todaysEvents } from "./calendar-apps";
import { appLabel } from "./details";
import { GlossFill, OnGloss } from "./gloss";
import { useCallControls } from "./live-call";
import { useLiveVoice } from "./live-talk-ui";
import { dark, glass } from "./theme";
import { tipProps } from "./tips";
import { colors, glassSurface, s } from "./ui";
import { useWeather } from "./weather-ui";
import { useWorkspace } from "./workspace";

const NAME_KEY = "openmuse.you-name";
function rememberedName() {
  try {
    return globalThis.localStorage?.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const count = (n: number) => WORDS[n] ?? String(n);
/** A title's date ("Social media digest · Sep 29") stays on one line with the dot before it. */
const keepDate = (title: string) =>
  title.replace(/ · (.+)$/, (_, date: string) => ` · ${date.replace(/ /g, " ")}`);
/** What a waiting job needs, in the words Activity uses. */
const waitingWords = (status: string) =>
  status === "waiting_input" ? "Needs your answer" : "Waiting for your OK";

/** What an approval is, in a few words under its title. */
function approvalLine(action: ActionProposal) {
  const d = action.data;
  if (action.kind === "email.send" || action.kind === "agent_email.send")
    return "Email, ready to send";
  if (action.kind === "app.action") {
    const app = d.app ? appLabel(String(d.app)) : "";
    if (typeof d.amountUsd === "number")
      return app ? `$${d.amountUsd.toFixed(2)} · ${app}` : `$${d.amountUsd.toFixed(2)}`;
    return app ? `In ${app}` : "In a connected app";
  }
  if (action.kind.startsWith("calendar.")) return "In your calendar";
  return "On a website";
}

/**
 * What needs the person: approvals, and jobs with a question. A job waiting for an approval it
 * made is that approval, so it's counted once (as the approval).
 */
export function waitingOnYou(
  actions: ActionProposal[],
  tasks: { id: string; status: string; title: string }[] | undefined,
) {
  const approvals = actions.filter((a) => a.status === "awaiting_review");
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
  const { data, error: jobsError } = useAgentWorkspace();
  const agent = data?.identity.name || "Neddy";
  const { result: weather } = useWeather();
  const [appDay, setAppDay] = useState<AppDay | null>();
  useEffect(() => {
    api.request<AppDay>("/api/calendar/today").then(setAppDay, () => setAppDay(null));
  }, [api]);
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
  const sub = !known
    ? " "
    : needs
      ? `${count(needs)} ${needs === 1 ? "thing needs" : "things need"} ${
          jobs.length ? "you" : "your OK"
        }.${busy.length ? ` ${agent} has the rest.` : ""}`
      : !data
        ? " "
        : busy.length
          ? `Nothing needs you right now. ${agent} is on ${busy.length === 1 ? "a job" : `${count(busy.length).toLowerCase()} jobs`}.`
          : "Nothing needs you right now.";
  const events = todaysEvents([...w.events, ...(appDay?.events ?? [])], now);
  const forecast = weather && "weather" in weather ? weather.weather.now : undefined;
  const calendarConnected =
    !!appDay?.checked.length ||
    w.connections.some((c) => c.id === "google" && c.status !== "disconnected");
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
          {(approvals.length > 0 || jobs.length > 0) && (
            <HomeCard title="Needs you" icon={Check} tint={["#3fd0a3", "#0b8a6c"]} badge={needs}>
              {approvals.slice(0, 3).map((action, index) => (
                <Waiting
                  key={action.id}
                  first={index === 0}
                  title={action.title}
                  line={approvalLine(action)}
                  button="Review"
                  onPress={() => open({ type: "review", action })}
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
                />
              ))}
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
              tint={["#ffbe6e", "#e8591a"]}
              onPress={() => navigate("feed")}
              // A button's name replaces what's in it, so it carries what the card says.
              label={`Today: ${forecast ? `${forecast.temp}°, ${forecast.sky}. ` : ""}${shown
                .map((e) => `${spoken(e)} ${e.title}`)
                .join(", ")}${shown.length ? ". " : ""}${more ? `And ${more} more. ` : ""}${
                dayNote ? `${dayNote} ` : ""
              }Opens your day in Feed`}
              style={{ flex: 1 }}
            >
              {forecast && (
                <Text style={{ color: soft(), fontSize: 13 }}>
                  <Text
                    style={{ color: ink(), fontSize: 22, fontWeight: "700", letterSpacing: -0.4 }}
                  >
                    {forecast.temp}°
                  </Text>
                  {"  "}
                  {forecast.sky}
                </Text>
              )}
              {shown.map((e) => (
                <View key={`${e.id}-${e.start}`} style={{ flexDirection: "row", gap: 10 }}>
                  <Text
                    style={{
                      color: glass ? "#FFD9A8" : dark ? "#FFC58A" : "#B4530F",
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
              tint={["#b49cff", "#6a3fd6"]}
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
                      style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#7DD8FF" }}
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
        </View>
      )}
    </View>
  );
}

function HomeCard({
  title,
  icon: Icon,
  tint,
  badge,
  onPress,
  label,
  style,
  children,
}: {
  title: string;
  icon: LucideIcon;
  tint: [string, string];
  badge?: number;
  onPress?: () => void;
  label?: string;
  style?: object;
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
          <GlossFill
            id={`home-${title}`}
            from={tint[0]}
            to={tint[1]}
            angle="tilted"
            shine={0.5}
            radius={9}
          />
          <OnGloss>
            <Icon size={16} color="#FFFFFF" strokeWidth={2.2} />
          </OnGloss>
        </View>
        <Text
          role="heading"
          aria-level={2}
          style={{ flex: 1, color: ink(), fontSize: 15, fontWeight: "700" }}
        >
          {title}
        </Text>
        {!!badge && (
          <View
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
}: {
  first: boolean;
  title: string;
  line: string;
  button: string;
  onPress: () => void;
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
        <GlossFill id={`review-${title}`} from="#279a52" to="#0a5f2d" radius={22} />
        <OnGloss>
          <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "700" }}>{button}</Text>
        </OnGloss>
      </Pressable>
    </View>
  );
}

/** Talk to the agent (a live call where it's on, otherwise the chat), or type in the chat. */
export function HomeTalkRow({ desktop }: { desktop: boolean }) {
  const { navigate, draft } = useWorkspace();
  const { data } = useAgentWorkspace();
  const agent = data?.identity.name || "Neddy";
  const live = useLiveVoice();
  const call = useCallControls();
  const calling = live === "on";
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
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 10,
        alignItems: "center",
        alignSelf: "center",
        width: "100%",
        maxWidth: desktop ? 460 : undefined,
        paddingHorizontal: 16,
        paddingTop: 22,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={talk}
        style={({ pressed }) => ({
          flex: 1,
          height: 62,
          borderRadius: 31,
          justifyContent: "center",
          paddingLeft: 78,
          paddingRight: 20,
          transform: [{ scale: pressed ? 0.98 : 1 }],
          shadowColor: "#1E46BE",
          shadowOpacity: 0.45,
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
            borderRadius: 31,
            overflow: "hidden",
          }}
        >
          <GlossFill id="talk" from="#3d86f0" to="#1a47b8" radius={31} />
        </View>
        {/* He stands in the bar, his head rising above it. */}
        <Image
          source={require("../assets/neddy-full.webp")}
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          style={{ position: "absolute", left: 10, bottom: 4, width: 58, height: 78 }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, position: "relative" }}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: "#FFFFFF",
              fontSize: 18,
              fontWeight: "700",
              letterSpacing: -0.2,
            }}
          >
            Talk to {agent}
          </Text>
          {/* A headset for a call; a microphone where talking happens in the chat. */}
          {calling || call.phase === "on" ? (
            <Headset size={26} color="#FFFFFF" />
          ) : (
            <Mic size={26} color="#FFFFFF" />
          )}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Type a message to ${agent}`}
        {...tipProps(`Type to ${agent}`)}
        onPress={() => draft("")}
        style={({ pressed }) => [
          {
            width: 62,
            height: 62,
            borderRadius: 31,
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
    </View>
  );
}
