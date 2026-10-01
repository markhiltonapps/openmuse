import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { AgentTask } from "../../../packages/domain/src/agent";
import { taskActivity } from "./activity";
import { AgentAvatar, useReducedMotion } from "./avatar";
import { Button, Card, colors, s } from "./ui";

/** The heading of whichever card a job page shows; focus goes here when the job moves on. */
export const JOB_HEADING = "job-heading";
export const jobHeading = {
  nativeID: JOB_HEADING,
  role: "heading",
  "aria-level": 3,
  tabIndex: -1,
} as object;
/** Read out when a job's state changes while its page is open. */
export const STATUS_NEWS: Record<string, string> = {
  queued: "Getting started.",
  running: "Working on it.",
  waiting_input: "I need your answer to carry on.",
  waiting_approval: "Ready for your review.",
  paused: "Paused.",
  succeeded: "Done. The answer is below.",
  failed: "Couldn’t finish.",
  cancelled: "Stopped.",
};
/** Heard by screen readers, not seen. */
export const HIDDEN = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  overflow: "hidden",
} as const;

/** On the web, focus the element in `ref` that matches `selector`, once it's drawn. */
function focusSoon(ref: React.RefObject<View | null>, selector: string) {
  if (Platform.OS !== "web") return;
  setTimeout(() => {
    (ref.current as unknown as HTMLElement | null)?.querySelector<HTMLElement>(selector)?.focus();
  }, 60);
}

/** "Started just now", "Started 4 min ago", "Started 1 hr 5 min ago". */
function sinceLabel(from: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - new Date(from).getTime()) / 60000));
  if (minutes < 1) return "Started just now";
  if (minutes < 60) return `Started ${minutes} min ago`;
  if (minutes >= 24 * 60)
    return `Started ${new Date(from).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `Started ${hours} hr${rest ? ` ${rest} min` : ""} ago`;
}

/** The avatar at work inside a ring that keeps turning while the job runs. */
function WorkingAvatar({ size, task }: { size: number; task: AgentTask }) {
  const reduce = useReducedMotion();
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: 2400,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, turn]);
  const ring = size + 28;
  const radius = ring / 2 - 3;
  const around = 2 * Math.PI * radius;
  // Before it starts there's nothing to hold yet.
  const activity =
    task.status === "running" ? taskActivity(task) : ({ kind: "thinking", label: "" } as const);
  return (
    <View
      style={{ width: ring, height: ring, alignItems: "center", justifyContent: "center" }}
      aria-hidden
    >
      <Animated.View
        style={{
          position: "absolute",
          width: ring,
          height: ring,
          transform: [
            { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
          ],
        }}
      >
        <Svg width={ring} height={ring}>
          <Circle
            cx={ring / 2}
            cy={ring / 2}
            r={radius}
            stroke={colors.line}
            strokeWidth={3}
            fill="none"
          />
          {/* A third of the ring in blue, going round (not drawn when it can't move). */}
          {!reduce && (
            <Circle
              cx={ring / 2}
              cy={ring / 2}
              r={radius}
              stroke={colors.blueDark}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={`${around / 3} ${around}`}
              fill="none"
            />
          )}
        </Svg>
      </Animated.View>
      {/* A still gap in the ring behind the prop, so the turning arc doesn't run into it. */}
      {!reduce && activity.kind !== "thinking" && (
        <Svg width={ring} height={ring} style={{ position: "absolute" }}>
          <Circle cx={14 + size * 0.94} cy={14 + size * 0.8} r={size * 0.26} fill={colors.card} />
        </Svg>
      )}
      <AgentAvatar
        size={size}
        mood="working"
        activity={activity.kind === "thinking" ? undefined : activity.kind}
      />
    </View>
  );
}

/**
 * A job that's under way: the agent at work, one plain line of what it's doing now, how long
 * it's been going, and a way to stop it. Nothing else until it's done.
 */
export function WorkingCard({
  task,
  handedOff,
  busy,
  onStop,
}: {
  task: AgentTask;
  handedOff: boolean;
  busy: boolean;
  onStop: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const started = task.status === "running";
  const doing = typeof task.state.now === "string" && started ? `${task.state.now}…` : "";
  return (
    <Card style={{ alignItems: "center", gap: 6, paddingVertical: 26 }}>
      <WorkingAvatar size={88} task={task} />
      <Text
        {...jobHeading}
        style={[s.heading, { fontSize: 20, marginTop: 12, textAlign: "center" }]}
      >
        {started ? "Working on it" : "Getting started"}
      </Text>
      {/* Always mounted, so a screen reader hears each new step. */}
      <Text
        role="status"
        numberOfLines={2}
        style={[
          s.text,
          {
            color: colors.blueText,
            fontWeight: "600",
            textAlign: "center",
            minHeight: started ? 23 : 0,
          },
        ]}
      >
        {doing}
      </Text>
      {started && (
        <Text style={[s.small, { fontSize: 13, color: colors.mutedStrong, textAlign: "center" }]}>
          {sinceLabel(task.createdAt, now)}
        </Text>
      )}
      <Text style={[s.muted, { textAlign: "center", marginTop: 8, maxWidth: 360 }]}>
        {handedOff
          ? "You can leave this page. I’ll let you know when it’s done."
          : "The result will show here when it’s done."}
      </Text>
      <View style={{ marginTop: 10, alignItems: "center" }}>
        <ConfirmStop label="Stop" busy={busy} onConfirm={onStop} center />
      </View>
    </Card>
  );
}

/**
 * A button that stops a job, after asking: "Stop this job? [Stop it] [Keep going]". Focus moves
 * to the safe answer, and back to the button if they keep going.
 */
export function ConfirmStop({
  label,
  busy,
  onConfirm,
  center = false,
}: {
  label: string;
  busy: boolean;
  onConfirm: () => void;
  center?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  // The spoken name matches the words on the button, so voice control finds it.
  const name = label === "Stop" ? "Stop this job" : label;
  // A running job keeps going; a paused or waiting one just isn't stopped.
  const keep = label === "Stop" ? "Keep going" : "Don’t stop";
  const box = useRef<View>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (asking) focusSoon(box, `[aria-label="${keep}"]`);
    else if (asked.current) focusSoon(box, `[aria-label="${name}"]`);
    asked.current = asking;
  }, [asking, name, keep]);
  return (
    <View
      ref={box}
      {...(asking ? { role: "group", "aria-label": "Stop this job?" } : {})}
      style={[
        s.row,
        {
          gap: 8,
          flexWrap: "wrap",
          flexShrink: 1,
          maxWidth: "100%",
          justifyContent: center ? "center" : "flex-start",
        },
      ]}
    >
      {asking ? (
        <>
          <Text
            style={[s.text, center ? { alignSelf: "center" } : { width: "100%", marginBottom: 2 }]}
          >
            Stop this job?
          </Text>
          <Button danger busy={busy} onPress={onConfirm}>
            Stop it
          </Button>
          <Button accessibilityLabel={keep} onPress={() => setAsking(false)}>
            {keep}
          </Button>
        </>
      ) : (
        <Button
          small={label === "Stop"}
          danger={label !== "Stop"}
          accessibilityLabel={name}
          onPress={() => setAsking(true)}
        >
          {label}
        </Button>
      )}
    </View>
  );
}

/** The default steps every general job starts with; they never change, so they say nothing. */
const PLACEHOLDER_PLAN = [
  "Understand the outcome",
  "Plan the work",
  "Use connected tools",
  "Return a result",
];
export function realPlan(task: AgentTask) {
  return (
    task.plan.length > 0 &&
    task.plan.map((step) => step.title).join("|") !== PLACEHOLDER_PLAN.join("|")
  );
}
