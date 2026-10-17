import {
  AudioLines,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Mic,
  MicOff,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react-native";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from "react-native";
import { PlaceAnchor } from "./app-places-ui";
import { useCallControls } from "./live-call";
import MeetingAudio from "./MeetingAudio";
import {
  canRecord,
  clock,
  MeetingRecorder,
  type RecorderState,
  spokenLength,
  stoppedAtLimit,
} from "./meeting-recorder";
import { dark } from "./theme";
import { tipProps } from "./tips";
import { Button, Card, Chip, colors, ErrorNotice, glassSurface, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/** The record colour for dots and words: a clear red that reads on light, dark and glass. */
export const RECORD_RED = dark ? "#FF6369" : "#D93036";
/** Filled red behind white words (Stop, Record), and the bar's dot: reads in every look. */
export const RECORD_FILL = "#C7272D";

export type MeetingStatus = "recording" | "transcribing" | "summarizing" | "done" | "failed";
export interface MeetingView {
  id: string;
  title: string;
  status: MeetingStatus;
  startedAt: string;
  endedAt?: string;
  seconds: number;
  summary?: string;
  decisions: string[];
  actionItems: { text: string; who?: string; due?: string }[];
  speakers: Record<string, string>;
  words?: number;
  audio: boolean;
  audioUntil?: string;
  error?: string;
  /** Seconds nothing was recorded (the phone locked or the app was away). */
  missedSeconds?: number;
}
interface MeetingRead extends MeetingView {
  segments: { speaker: string; start: number; end: number; text: string }[];
  /** Where the recording paused, in ms from the start, and for how long. */
  gaps?: { at: number; seconds: number }[];
  audioParts: { index: number; url: string }[];
}
interface MeetingsList {
  available: boolean;
  allowance: { usedMinutes: number; limitHours?: number; leftSeconds?: number };
  meetings: MeetingView[];
}

const working = (status: MeetingStatus) => status === "transcribing" || status === "summarizing";
/** "Writing it up", "Ready" and the rest, for a meeting's chip. */
export function statusLabel(status: MeetingStatus) {
  return status === "recording"
    ? "Recording"
    : status === "transcribing"
      ? "Writing it down"
      : status === "summarizing"
        ? "Writing notes"
        : status === "failed"
          ? "Needs another try"
          : "Ready";
}
/** "Tue, Oct 17 · 2:05 PM · 48 min". */
export function meetingLine(meeting: Pick<MeetingView, "startedAt" | "seconds">) {
  const at = new Date(meeting.startedAt);
  const day = at.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const minutes = Math.max(1, Math.round(meeting.seconds / 60));
  return `${day} · ${time} · ${minutes} min`;
}
/** "40 seconds", "about 3 minutes": how long nothing was recorded. */
export function missedLength(seconds: number) {
  return seconds < 90
    ? spokenLength(Math.round(seconds))
    : `about ${spokenLength(Math.round(seconds / 60) * 60)}`;
}
/** "Speaker 2", or the name they were given. */
export function speakerName(speakers: Record<string, string>, label: string) {
  const named = speakers[label]?.trim();
  if (named) return named;
  // "2:1" is a speaker heard after the first pause: maybe someone else, so it says so.
  const later = label.match(/^(\d+):(.+)$/);
  if (!later) return `Speaker ${label}`;
  const pause = Number(later[1]) - 1;
  return `Speaker ${later[2]} (after pause${pause > 1 ? ` ${pause}` : ""})`;
}

/**
 * A line for screen readers, mounted all the time with its words changing (one that appears
 * with its words often isn't read). Out of the layout, and it never catches a tap.
 */
function StatusLine({ text }: { text: string }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
    >
      <Text role="status" aria-live="polite">
        {text}
      </Text>
    </View>
  );
}
/** What the recorder is doing, in a few words, for the status line. */
function recorderNews(state: RecorderState) {
  const left =
    state.maxSeconds !== undefined ? Math.max(0, state.maxSeconds - state.seconds) : undefined;
  switch (state.phase) {
    case "starting":
      return "Getting the microphone";
    case "recording":
      if (state.away !== undefined)
        return `Recording again. Nothing was recorded for ${missedLength(state.away)} while you were away.`;
      return left !== undefined && left < 5 * 60 ? "5 minutes or less left" : "Recording";
    case "paused":
      return "Recording paused. It carries on when you’re back";
    case "saving":
      return "Saving the recording";
    case "error":
      return state.error ?? "";
    default:
      return "";
  }
}
/** Moves focus to a button (by its nativeID) once the focus trap has finished with the sheet. */
function focusLater(id: string) {
  if (Platform.OS !== "web") return;
  setTimeout(() => document.getElementById(id)?.focus(), 0);
}

// ── The recorder: one for the app, carried across screens like a call ─────────────────────────

interface RecorderValue {
  state: RecorderState;
  /** Whether this device can record here (a browser with a microphone). */
  supported: boolean;
  /** Starts recording, after `wait` ms (for a call to let go of the microphone). */
  start: (wait?: number) => void;
  stop: () => void;
  discard: () => void;
  resume: () => void;
  /** After a Stop that couldn't reach the server: tries once more. */
  finishAgain: () => void;
  /** The meeting this recording made, in its own sheet (the recorder closes). */
  openMeeting: () => void;
  /** The "paused while you were away" note has been read. */
  seenAway: () => void;
  /** The recorder's screen, over whatever is open; or shrunk to the red bar. */
  shown: boolean;
  expand: () => void;
  shrink: () => void;
}
const RecorderContext = createContext<RecorderValue | null>(null);
export function useRecorder() {
  const value = useContext(RecorderContext);
  if (!value) throw new Error("The recorder is unavailable");
  return value;
}
/** Start, ending a live call first: the phone can't record and be on a call at once. */
export function useStartRecording() {
  const rec = useRecorder();
  const call = useCallControls();
  return useCallback(() => {
    if (call.phase === "on") {
      call.end();
      // A moment for the call to let go of the microphone.
      rec.start(500);
      return;
    }
    if (call.phase === "over") call.dismiss();
    rec.start();
  }, [call, rec]);
}
/** Whether a recording is going on (the call button's other use of the microphone checks this). */
export function useRecording() {
  const value = useContext(RecorderContext);
  const phase = value?.state.phase ?? "idle";
  return phase === "recording" || phase === "paused" || phase === "saving";
}

export function MeetingRecorderProvider({ children }: { children: ReactNode }) {
  const { api, open } = useWorkspace();
  const recorder = useMemo(() => new MeetingRecorder(api), [api]);
  const state = useSyncExternalStore(
    recorder.subscribe,
    recorder.getSnapshot,
    recorder.getSnapshot,
  );
  const [shown, setShown] = useState(false);
  const supported = useMemo(() => canRecord(), []);
  // Closed by the server while the app was away, or minutes missed while it was: the recorder
  // comes up to say so, so nobody thinks those minutes are in the notes.
  useEffect(() => {
    if (state.closed || state.away !== undefined) setShown(true);
    if (state.away !== undefined) focusLater("seen-away");
  }, [state.closed, state.away]);
  const start = useCallback(
    (wait = 0) => {
      setShown(true);
      setTimeout(() => void recorder.start(), wait);
    },
    [recorder],
  );
  const stop = useCallback(() => {
    void recorder.stop().then((id) => {
      if (id && recorder.snapshot.phase === "idle") {
        setShown(false);
        open({ type: "meeting", id });
      }
    });
  }, [recorder, open]);
  const discard = useCallback(() => {
    void recorder.discard().then((gone) => {
      if (gone) setShown(false);
    });
  }, [recorder]);
  const openMeeting = useCallback(() => {
    const id = recorder.snapshot.meetingId;
    setShown(false);
    recorder.clear();
    if (id) open({ type: "meeting", id });
  }, [recorder, open]);
  const finishAgain = useCallback(() => {
    void recorder.finishAgain().then((id) => {
      if (id && recorder.snapshot.phase === "idle") {
        setShown(false);
        open({ type: "meeting", id });
      }
    });
  }, [recorder, open]);
  const value = useMemo<RecorderValue>(
    () => ({
      state,
      supported,
      start,
      stop,
      discard,
      resume: () => void recorder.resume(),
      seenAway: () => recorder.seenAway(),
      finishAgain,
      openMeeting,
      shown,
      expand: () => setShown(true),
      shrink: () => {
        setShown(false);
        recorder.clear();
        recorder.seenAway();
      },
    }),
    [state, supported, start, stop, discard, finishAgain, openMeeting, recorder, shown],
  );
  return (
    <RecorderContext.Provider value={value}>
      {children}
      {shown && <RecorderSheet />}
    </RecorderContext.Provider>
  );
}

/** Five bars that rise with the room's sound, so it's plain the microphone hears. */
function LevelBars({ level, color, size = 1 }: { level: number; color: string; size?: number }) {
  const shape = [0.45, 0.75, 1, 0.75, 0.45];
  return (
    <View
      aria-hidden
      style={{ flexDirection: "row", alignItems: "center", gap: 3 * size, height: 28 * size }}
    >
      {shape.map((weight, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of bars
          key={i}
          style={{
            width: 4 * size,
            borderRadius: 2 * size,
            backgroundColor: color,
            height: Math.max(4, Math.round(28 * size * Math.min(1, 0.15 + level * weight))),
          }}
        />
      ))}
    </View>
  );
}

/** The recorder's screen: the time, the level, Stop; or why it can't record. */
function RecorderSheet() {
  const rec = useRecorder();
  const { state } = rec;
  const [confirm, setConfirm] = useState(false);
  const recording = state.phase === "recording";
  const paused = state.phase === "paused";
  const saving = state.phase === "saving";
  const left =
    state.maxSeconds !== undefined ? Math.max(0, state.maxSeconds - state.seconds) : undefined;
  const title =
    state.phase === "starting"
      ? "Getting the microphone"
      : recording
        ? "Recording"
        : paused
          ? "Recording paused"
          : saving
            ? "Saving the recording"
            : state.closed
              ? "Recording ended"
              : state.notThrownAway
                ? "Not thrown away"
                : state.unfinished
                  ? "Saved, not written up yet"
                  : state.phase === "error"
                    ? "Couldn’t record"
                    : "Record a meeting";
  const askThrowAway = () => {
    setConfirm(true);
    focusLater("keep-recording");
  };
  const keep = () => {
    setConfirm(false);
    focusLater("throw-away");
  };
  return (
    <Sheet
      title={title}
      narrow
      onClose={rec.shrink}
      closeIcon={recording || paused ? ChevronDown : undefined}
      closeLabel={recording || paused ? "Keep recording and go back" : "Close"}
      footer={
        recording || paused ? (
          <View style={{ gap: 14, padding: 16, paddingTop: 4 }}>
            <Pressable
              role="button"
              nativeID="stop-recording"
              aria-label={`Stop recording. ${spokenLength(state.seconds)} so far`}
              onPress={rec.stop}
              style={({ pressed }) => ({
                minHeight: 56,
                borderRadius: 28,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                backgroundColor: RECORD_FILL,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <CircleStop size={22} color="#FFFFFF" />
              <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "700" }}>
                Stop and write it up
              </Text>
            </Pressable>
            {confirm ? (
              <View style={{ gap: 8, alignItems: "center" }}>
                <Text style={s.muted}>Throw this recording away?</Text>
                <View style={[s.row, { gap: 8 }]}>
                  <Button danger onPress={rec.discard}>
                    Throw away
                  </Button>
                  <Button nativeID="keep-recording" onPress={keep}>
                    Keep recording
                  </Button>
                </View>
              </View>
            ) : (
              <Button
                nativeID="throw-away"
                icon={Trash2}
                style={{ alignSelf: "center" }}
                onPress={askThrowAway}
              >
                Throw away
              </Button>
            )}
          </View>
        ) : undefined
      }
    >
      <StatusLine text={recorderNews(state)} />
      <View style={{ alignItems: "center", gap: 14, paddingVertical: 12 }}>
        {(recording || paused || saving) && (
          <>
            <View style={[s.row, { gap: 14 }]}>
              <View
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: paused ? "transparent" : RECORD_RED,
                  borderWidth: paused ? 2 : 0,
                  borderColor: colors.muted,
                }}
              />
              <Text
                role="timer"
                aria-label={`${spokenLength(state.seconds)} recorded`}
                style={{
                  color: colors.text,
                  fontSize: 48,
                  fontWeight: "300",
                  fontVariant: ["tabular-nums"],
                  letterSpacing: -1,
                }}
              >
                {clock(state.seconds)}
              </Text>
            </View>
            {recording && <LevelBars level={state.level} color={RECORD_RED} size={1.4} />}
          </>
        )}
        {recording && state.away !== undefined && (
          <Card style={{ gap: 10, alignSelf: "stretch", backgroundColor: colors.orange }}>
            <View style={[s.row, { gap: 8, alignItems: "flex-start" }]}>
              <View style={{ marginTop: 3 }}>
                <MicOff size={18} color={colors.text} />
              </View>
              <Text style={[s.text, { fontWeight: "700", flex: 1 }]}>
                Recording paused while you were away
              </Text>
            </View>
            <Text style={s.text}>
              Nothing was recorded for {missedLength(state.away)}. It’s recording again now.
            </Text>
            <Text style={[s.muted, { color: colors.mutedStrong }]}>
              To catch every word, keep this screen open until the meeting ends.
            </Text>
            <Button
              primary
              nativeID="seen-away"
              style={{ alignSelf: "flex-start" }}
              onPress={() => {
                rec.seenAway();
                focusLater("stop-recording");
              }}
            >
              Got it
            </Button>
          </Card>
        )}
        {recording && state.away === undefined && (
          <Text style={[s.muted, { textAlign: "center", maxWidth: 420 }]}>
            Let everyone know they’re being recorded.
            {Platform.OS === "web"
              ? " Keep this screen open: if you switch apps or lock the phone, nothing is recorded until you’re back."
              : ""}
          </Text>
        )}
        {paused && (
          <View style={{ gap: 10, alignItems: "center" }}>
            <Text style={[s.text, { textAlign: "center", maxWidth: 420 }]}>
              The microphone stopped when the app was in the background. What was recorded is safe.
            </Text>
            <Button primary icon={Mic} onPress={rec.resume}>
              Carry on recording
            </Button>
          </View>
        )}
        {saving && (
          <View style={[s.row, { gap: 10 }]}>
            <ActivityIndicator color={colors.muted} />
            <Text style={s.muted}>
              {state.waiting ? "Sending the last few seconds…" : "Sending it off to be written up…"}
            </Text>
          </View>
        )}
        {state.phase === "starting" && <ActivityIndicator color={colors.muted} />}
        {(recording || paused) && state.waiting > 2 && (
          <Text style={[s.small, { textAlign: "center" }]}>
            The connection is slow, so some of the recording hasn’t sent yet. Keep recording; it’ll
            send when the connection’s back.
          </Text>
        )}
        {recording && left !== undefined && left < 5 * 60 && (
          <Text style={[s.text, { color: RECORD_RED, textAlign: "center" }]}>
            {Math.max(1, Math.ceil(left / 60))} {Math.ceil(left / 60) === 1 ? "minute" : "minutes"}{" "}
            left. Recording stops by itself then.
          </Text>
        )}
        {state.phase === "error" && (
          <View style={{ gap: 12, alignSelf: "stretch" }}>
            <ErrorNotice error={state.error} />
            {state.closed ? (
              <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                <Button primary icon={Mic} onPress={() => rec.start()}>
                  Record the rest
                </Button>
                <Button onPress={rec.openMeeting}>Open the meeting</Button>
              </View>
            ) : state.notThrownAway === "written" ? (
              <Button primary onPress={rec.openMeeting} style={{ alignSelf: "flex-start" }}>
                Open the meeting
              </Button>
            ) : state.notThrownAway === "offline" ? (
              <Button
                primary
                icon={RotateCcw}
                onPress={rec.discard}
                style={{ alignSelf: "flex-start" }}
              >
                Try again
              </Button>
            ) : state.unfinished ? (
              <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                <Button primary icon={RotateCcw} onPress={rec.finishAgain}>
                  Try again
                </Button>
                <Button onPress={rec.openMeeting}>Open the meeting</Button>
              </View>
            ) : (
              !state.meetingId &&
              rec.supported && (
                <Button primary icon={Mic} onPress={() => rec.start()}>
                  Try again
                </Button>
              )
            )}
          </View>
        )}
        {paused && state.error && <ErrorNotice error={state.error} />}
      </View>
    </Sheet>
  );
}

/** The red bar at the top of every screen and sheet while recording; tap it for the recorder. */
export function RecordingBar() {
  const rec = useRecorder();
  const { state } = rec;
  if (state.phase !== "recording" && state.phase !== "paused" && state.phase !== "saving")
    return null;
  const paused = state.phase === "paused";
  const left =
    state.maxSeconds !== undefined ? Math.max(0, state.maxSeconds - state.seconds) : undefined;
  const ending = state.phase === "recording" && left !== undefined && left < 5 * 60;
  return (
    <View
      role="region"
      aria-label="Recording a meeting"
      aria-hidden={rec.shown || undefined}
      pointerEvents={rec.shown ? "none" : "auto"}
      // Shaped like the call bar, so the two read as one family when both are there.
      style={{
        opacity: rec.shown ? 0 : 1,
        marginHorizontal: 12,
        marginTop: 8,
        marginBottom: 4,
        paddingVertical: 8,
        paddingLeft: 10,
        paddingRight: 8,
        borderRadius: 30,
        backgroundColor: colors.inverse,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        shadowColor: "#132631",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 14,
        elevation: 6,
      }}
    >
      {!rec.shown && <StatusLine text={recorderNews(state)} />}
      <Pressable
        role="button"
        aria-label={`${paused ? "Recording paused" : "Recording"}, ${spokenLength(state.seconds)}. Open the recorder`}
        onPress={rec.expand}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 44,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 6,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: paused ? "transparent" : RECORD_FILL,
            borderWidth: paused ? 2 : 0,
            borderColor: colors.onInverse,
          }}
        />
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            color: colors.onInverse,
            fontSize: 15,
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {paused ? "Paused" : state.phase === "saving" ? "Saving" : "Recording"} ·{" "}
          {clock(state.seconds)}
          {ending ? ` · ${Math.max(1, Math.ceil((left ?? 0) / 60))} min left` : ""}
        </Text>
        {state.phase === "recording" && !ending && (
          <LevelBars level={state.level} color={colors.onInverse} size={0.6} />
        )}
      </Pressable>
      {state.phase !== "saving" && (
        <Pressable
          role="button"
          aria-label={paused ? "Carry on recording" : "Stop recording and write it up"}
          {...tipProps(paused ? "Carry on recording" : "Stop and write it up")}
          onPress={paused ? rec.resume : rec.stop}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: 16,
            borderRadius: 22,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: RECORD_FILL,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          {paused ? <Mic size={18} color="#FFFFFF" /> : <CircleStop size={18} color="#FFFFFF" />}
          <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>
            {paused ? "Carry on" : "Stop"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ── Meetings: the list (Files & media › Meetings) and one meeting's notes ──────────────────────

function useMeetings() {
  const { api } = useWorkspace();
  const rec = useRecorder();
  const [data, setData] = useState<MeetingsList | null>();
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api.request<MeetingsList>("/api/meetings").then(
        (value) => {
          setData(value);
          setError("");
        },
        (problem: Error) => {
          setData((now) => now ?? null);
          setError(problem.message);
        },
      ),
    [api],
  );
  // Again when a recording ends, and every few seconds while one is being written up.
  useEffect(() => {
    void load();
  }, [load, rec.state.phase]);
  const busy = data?.meetings.some((m) => working(m.status));
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [busy, load]);
  return { data, error, load };
}

/** "3.5 of 10 hours used this month", or "12 min of 10 hours…" in the first hour. */
function allowanceLine(allowance: MeetingsList["allowance"]) {
  if (!allowance.limitHours) return "";
  const minutes = Math.round(allowance.usedMinutes);
  // Minutes until there's an hour to speak of, so a short meeting doesn't read as "0".
  const used = minutes < 60 ? `${minutes} min` : `${Math.round((minutes / 60) * 10) / 10}`;
  return `${used} of ${allowance.limitHours} hours used this month`;
}

/** The Record button, as a card's first action; it says why when it can't. */
export function RecordMeetingButton({ label = "Record a meeting" }: { label?: string }) {
  const rec = useRecorder();
  const startRecording = useStartRecording();
  const busy = rec.state.phase !== "idle" && rec.state.phase !== "error";
  if (!rec.supported)
    return (
      <Text style={s.muted}>
        Recording works in the web app on a phone or computer (Chrome, Edge or Safari).
      </Text>
    );
  return (
    <Pressable
      role="button"
      aria-label={busy ? "Recording now. Open the recorder" : label}
      onPress={busy ? rec.expand : startRecording}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        minHeight: 48,
        paddingHorizontal: 20,
        borderRadius: 24,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: RECORD_FILL,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: "#FFFFFF" }} />
      <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>
        {busy ? "Recording now" : label}
      </Text>
    </Pressable>
  );
}

function MeetingRow({ meeting }: { meeting: MeetingView }) {
  const { open } = useWorkspace();
  const rec = useRecorder();
  // The one being recorded right now opens the recorder, not an empty page.
  const live = meeting.status === "recording" && rec.state.meetingId === meeting.id;
  return (
    <Pressable
      role="button"
      aria-label={
        live
          ? `${meeting.title}, recording now. Open the recorder`
          : `Open ${meeting.title}, ${meetingLine(meeting)}, ${statusLabel(meeting.status)}`
      }
      onPress={live ? rec.expand : () => open({ type: "meeting", id: meeting.id })}
      style={({ pressed }) => ({
        minHeight: 64,
        paddingVertical: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderTopWidth: 1,
        borderTopColor: colors.line,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.subtle,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <AudioLines size={20} color={colors.mutedStrong} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.text, { fontWeight: "600" }]} numberOfLines={2}>
          {meeting.title}
        </Text>
        <Text style={s.muted} numberOfLines={1}>
          {meetingLine(meeting)}
        </Text>
      </View>
      {meeting.status === "recording" ? (
        <View style={[s.row, { gap: 6 }]}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: RECORD_RED }} />
          <Text style={[s.small, { color: colors.mutedStrong, fontWeight: "600" }]}>Recording</Text>
        </View>
      ) : meeting.status !== "done" ? (
        <Chip tint={meeting.status === "failed" ? colors.errorBg : colors.lavender}>
          {statusLabel(meeting.status)}
        </Chip>
      ) : null}
      <ChevronRight size={18} color={colors.muted} />
    </Pressable>
  );
}

/** Files & media › Meetings: Record, then each meeting recorded, newest first. */
export function MeetingsCard() {
  const { data, error } = useMeetings();
  const [all, setAll] = useState(false);
  if (!data) return null;
  if (!data.available && !data.meetings.length) return null;
  const shown = all ? data.meetings : data.meetings.slice(0, 6);
  const line = allowanceLine(data.allowance);
  return (
    <PlaceAnchor id="meetings" label="Meetings" radius={23}>
      <Card style={{ gap: 14 }}>
        <View style={{ gap: 4 }}>
          <Text role="heading" aria-level={2} style={s.heading}>
            Meetings
          </Text>
          <Text style={s.muted}>
            Record a meeting in the room; you get a summary, decisions, action items and every word,
            with who said it.
          </Text>
        </View>
        {data.available ? (
          <View style={{ gap: 6 }}>
            <RecordMeetingButton />
            {!!line && <Text style={s.small}>{line}</Text>}
          </View>
        ) : (
          <Text style={s.muted}>Recording meetings isn’t set up on this server yet.</Text>
        )}
        <ErrorNotice error={error} />
        {data.meetings.length > 0 && (
          <View>
            {shown.map((meeting) => (
              <MeetingRow key={meeting.id} meeting={meeting} />
            ))}
          </View>
        )}
        {data.meetings.length > 6 && (
          <Button small style={{ alignSelf: "flex-start" }} onPress={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${data.meetings.length}`}
          </Button>
        )}
      </Card>
    </PlaceAnchor>
  );
}

/** Where the recording paused, between two turns in the words. */
function GapLine({ seconds }: { seconds: number }) {
  return (
    <View style={[s.row, { gap: 10, marginVertical: 4 }]}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
      <Text style={[s.small, { textAlign: "center" }]}>
        Paused · {missedLength(seconds)} not recorded
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
    </View>
  );
}

/** "12:05" from the meeting's start, before each turn in the words. */
const at = (ms: number) => clock(ms / 1000);
/** A list item with its wrapped lines kept clear of the bullet. */
function Bullet({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Text style={s.text}>•</Text>
      <Text style={[s.text, { flex: 1 }]}>{children}</Text>
    </View>
  );
}
/** What the meeting page says has just happened, for the status line. */
function meetingNews(meeting: MeetingRead | null | undefined) {
  if (!meeting) return "";
  if (meeting.status === "done") return "The notes are ready";
  if (meeting.status === "failed") return "It couldn’t be written up";
  if (meeting.status === "transcribing") return "Writing down every word";
  if (meeting.status === "summarizing") return "Writing the notes";
  return "";
}

/** One meeting: its notes, the audio while it's kept, and every word with who said it. */
export function MeetingSheet({ id }: { id: string }) {
  const { api, close, draft } = useWorkspace();
  const rec = useRecorder();
  const [meeting, setMeeting] = useState<MeetingRead | null>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  // The one turn whose name is being changed (a name is on many turns; one editor at a time).
  const [naming, setNaming] = useState<{ speaker: string; start: number }>();
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const seen = useRef<MeetingStatus>(undefined);
  const [news, setNews] = useState("");
  const load = useCallback(
    () =>
      api.request<MeetingRead>(`/api/meetings/${encodeURIComponent(id)}`).then(
        (value) => {
          setMeeting(value);
          setError("");
        },
        (problem: Error) => {
          setMeeting((now) => now ?? null);
          setError(problem.message);
        },
      ),
    [api, id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const writing = meeting ? working(meeting.status) : false;
  const recordingNow = meeting?.status === "recording";
  useEffect(() => {
    if (!writing && !recordingNow) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [writing, recordingNow, load]);
  // Said out loud when it changes while open (not when it first opens).
  useEffect(() => {
    if (!meeting) return;
    if (seen.current && seen.current !== meeting.status) setNews(meetingNews(meeting));
    seen.current = meeting.status;
  }, [meeting]);
  const change = async (body: { title?: string; speakers?: Record<string, string> }) => {
    setBusy("save");
    try {
      await api.request(`/api/meetings/${encodeURIComponent(id)}`, body, "PATCH");
      await load();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Couldn’t save that.");
    } finally {
      setBusy("");
    }
  };
  const retry = async () => {
    setBusy("retry");
    try {
      await api.request(`/api/meetings/${encodeURIComponent(id)}/retry`, {});
      await load();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Couldn’t start it again.");
    } finally {
      setBusy("");
    }
  };
  const remove = async () => {
    setBusy("delete");
    try {
      await api.request(`/api/meetings/${encodeURIComponent(id)}`, undefined, "DELETE");
      close();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Couldn’t delete it.");
      setBusy("");
    }
  };
  if (meeting === undefined)
    return (
      <Sheet title="Meeting" onClose={close} narrow>
        <ActivityIndicator color={colors.muted} style={{ marginVertical: 30 }} />
      </Sheet>
    );
  if (!meeting)
    return (
      <Sheet title="Meeting" onClose={close} narrow>
        <ErrorNotice error={error || "This meeting couldn’t be found."} />
      </Sheet>
    );
  const items = meeting.actionItems;
  const kept = meeting.audioUntil
    ? new Date(meeting.audioUntil).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "";
  const day = new Date(meeting.startedAt).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const ours = rec.state.meetingId === meeting.id;
  return (
    <Sheet title={meeting.title} subtitle={meetingLine(meeting)} onClose={close} narrow fill>
      <StatusLine text={news} />
      <View style={{ gap: 18 }}>
        <ErrorNotice error={error} />
        {recordingNow && (
          <Card style={{ gap: 10, backgroundColor: colors.lavender }}>
            <View style={[s.row, { gap: 10 }]}>
              <View
                style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: RECORD_RED }}
              />
              <Text style={[s.text, { fontWeight: "600", flex: 1 }]}>Still recording</Text>
            </View>
            {ours ? (
              <Button
                small
                style={{ alignSelf: "flex-start" }}
                onPress={() => {
                  close();
                  rec.expand();
                }}
              >
                Open the recorder
              </Button>
            ) : (
              <Text style={s.muted}>
                It’s being recorded on another device. The notes come here once it stops.
              </Text>
            )}
          </Card>
        )}
        {stoppedAtLimit.has(meeting.id) && (
          <Text style={s.muted}>Recording stopped by itself at this month’s limit.</Text>
        )}
        {!!meeting.missedSeconds && meeting.missedSeconds >= 5 && (
          <Card style={{ gap: 6, backgroundColor: colors.orange }}>
            <View style={[s.row, { gap: 8 }]}>
              <MicOff size={18} color={colors.text} />
              <Text style={[s.text, { fontWeight: "600", flex: 1 }]}>
                Nothing was recorded for {missedLength(meeting.missedSeconds)}
              </Text>
            </View>
            <Text style={[s.muted, { color: colors.mutedStrong }]}>
              The screen was locked or the app was in the background. Each gap is marked in the
              words below.
            </Text>
          </Card>
        )}
        {writing && (
          <Card style={{ gap: 8, backgroundColor: colors.lavender }}>
            <View style={[s.row, { gap: 10 }]}>
              <ActivityIndicator color={colors.mutedStrong} />
              <Text style={[s.text, { fontWeight: "600", flex: 1 }]}>
                {meeting.status === "transcribing"
                  ? "Writing down every word…"
                  : "Writing the summary and action items…"}
              </Text>
            </View>
            <Text style={s.muted}>
              It usually takes a minute or two. You’ll get a notification when it’s ready; you can
              close this.
            </Text>
          </Card>
        )}
        {meeting.status === "failed" && (
          <Card style={{ gap: 10, backgroundColor: colors.errorBg }}>
            <Text style={[s.text, { color: colors.danger }]}>
              {meeting.error || "It couldn’t be written up."}
            </Text>
            <Button
              small
              icon={RotateCcw}
              busy={busy === "retry"}
              style={{ alignSelf: "flex-start" }}
              onPress={() => void retry()}
            >
              Try again
            </Button>
          </Card>
        )}
        {meeting.status === "done" && (
          <>
            {!!meeting.summary && <Text style={s.text}>{meeting.summary}</Text>}
            {meeting.decisions.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text role="heading" aria-level={3} style={s.heading}>
                  Decisions
                </Text>
                {meeting.decisions.map((decision) => (
                  <Bullet key={decision}>{decision}</Bullet>
                ))}
              </View>
            )}
            {items.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text role="heading" aria-level={3} style={s.heading}>
                  Action items
                </Text>
                {items.map((item) => (
                  <Bullet key={`${item.text}-${item.who ?? ""}`}>
                    {item.text}
                    {item.who || item.due ? (
                      <Text style={s.muted}>
                        {"  "}
                        {[item.who, item.due].filter(Boolean).join(" · ")}
                      </Text>
                    ) : null}
                  </Bullet>
                ))}
                <Button
                  primary
                  icon={Bell}
                  style={{ alignSelf: "flex-start", marginTop: 4 }}
                  onPress={() => {
                    close();
                    // Their whens are the meeting's ("Friday"), so the day it was goes too.
                    draft(
                      `Set reminders for the action items from “${meeting.title}” (${day}): ${items
                        .map((item) => {
                          const more = [item.who, item.due && `by ${item.due}`].filter(Boolean);
                          return more.length ? `${item.text} (${more.join(", ")})` : item.text;
                        })
                        .join("; ")}`,
                    );
                  }}
                >
                  Make reminders
                </Button>
              </View>
            )}
          </>
        )}
        {renaming ? (
          <View style={{ gap: 8 }}>
            <TextInput
              aria-label="Meeting title"
              value={title}
              onChangeText={setTitle}
              autoFocus
              maxLength={120}
              style={s.input}
              onSubmitEditing={() => {
                if (title.trim())
                  void change({ title: title.trim() }).then(() => setRenaming(false));
              }}
            />
            <View style={[s.row, { gap: 8 }]}>
              <Button
                small
                primary
                busy={busy === "save"}
                disabled={!title.trim()}
                onPress={() => void change({ title: title.trim() }).then(() => setRenaming(false))}
              >
                Save title
              </Button>
              <Button small onPress={() => setRenaming(false)}>
                Cancel
              </Button>
            </View>
          </View>
        ) : (
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {meeting.status === "done" && (
              <Button
                small
                icon={Sparkles}
                onPress={() => {
                  close();
                  draft(`About the meeting “${meeting.title}”: `);
                }}
              >
                Ask about it
              </Button>
            )}
            <Button
              small
              icon={Pencil}
              onPress={() => {
                setTitle(meeting.title);
                setRenaming(true);
              }}
            >
              Rename
            </Button>
          </View>
        )}
        {meeting.audio && meeting.audioParts.length > 0 && Platform.OS === "web" && (
          <View style={{ gap: 8 }}>
            <Text role="heading" aria-level={3} style={s.heading}>
              Recording
            </Text>
            {meeting.audioParts.map((part) => (
              <MeetingAudio
                key={part.index}
                url={part.url}
                label={
                  meeting.audioParts.length > 1
                    ? `Part ${part.index + 1} of the recording`
                    : "The recording"
                }
              />
            ))}
            {!!kept && <Text style={s.small}>The audio is kept until {kept}; the words stay.</Text>}
          </View>
        )}
        {meeting.segments.length > 0 && (
          <View style={{ gap: 14 }}>
            <View style={{ gap: 2 }}>
              <Text role="heading" aria-level={3} style={s.heading}>
                Every word
              </Text>
              <Text style={s.small}>Tap a name to say who it is.</Text>
            </View>
            {meeting.segments.map((segment, index) => {
              const who = speakerName(meeting.speakers, segment.speaker);
              // Pauses that fall between the turn before this one and this one.
              const before = index ? (meeting.segments[index - 1]?.start ?? 0) : -1;
              const pauses = (meeting.gaps ?? []).filter(
                (gap) => gap.at > before && gap.at <= segment.start,
              );
              const editing = naming?.speaker === segment.speaker && naming.start === segment.start;
              return (
                <View key={`${segment.start}-${segment.speaker}`} style={{ gap: 2 }}>
                  {pauses.map((gap) => (
                    <GapLine key={`gap-${gap.at}`} seconds={gap.seconds} />
                  ))}
                  <View style={[s.row, { gap: 4 }]}>
                    <Pressable
                      role="button"
                      aria-label={`${who}. Change this name`}
                      onPress={() => {
                        setNaming({ speaker: segment.speaker, start: segment.start });
                        setName(meeting.speakers[segment.speaker] ?? "");
                      }}
                      style={({ pressed }) => ({
                        minHeight: 44,
                        marginVertical: -6,
                        paddingRight: 8,
                        justifyContent: "center",
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Text style={{ color: colors.blueText, fontWeight: "700", fontSize: 14 }}>
                        {who}
                      </Text>
                    </Pressable>
                    <Text style={[s.small, { fontVariant: ["tabular-nums"] }]}>
                      {at(segment.start)}
                    </Text>
                  </View>
                  {editing && (
                    <View style={[s.row, { gap: 8, flexWrap: "wrap", marginVertical: 6 }]}>
                      <TextInput
                        aria-label={`Name for ${who}`}
                        value={name}
                        onChangeText={setName}
                        autoFocus
                        maxLength={60}
                        placeholder="Their name"
                        placeholderTextColor={colors.muted}
                        style={[s.input, { flex: 1, minWidth: 160 }]}
                      />
                      <Button
                        small
                        primary
                        busy={busy === "save"}
                        onPress={() =>
                          void change({ speakers: { [segment.speaker]: name.trim() } }).then(() =>
                            setNaming(undefined),
                          )
                        }
                      >
                        Save
                      </Button>
                      <Button small onPress={() => setNaming(undefined)}>
                        Cancel
                      </Button>
                    </View>
                  )}
                  <Text style={s.text}>{segment.text}</Text>
                </View>
              );
            })}
          </View>
        )}
        {!recordingNow && (
          <View
            style={{
              gap: 8,
              marginTop: 6,
              paddingTop: 18,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
          >
            {confirmDelete ? (
              <View style={{ gap: 8 }}>
                <Text style={s.text}>
                  Delete this meeting for good? Its notes, words and audio go too.
                </Text>
                <View style={[s.row, { gap: 8 }]}>
                  <Button danger busy={busy === "delete"} onPress={() => void remove()}>
                    Delete
                  </Button>
                  <Button
                    nativeID="keep-meeting"
                    onPress={() => {
                      setConfirmDelete(false);
                      focusLater("delete-meeting");
                    }}
                  >
                    Keep it
                  </Button>
                </View>
              </View>
            ) : (
              <Button
                small
                danger
                icon={Trash2}
                nativeID="delete-meeting"
                style={{ alignSelf: "flex-start" }}
                onPress={() => {
                  setConfirmDelete(true);
                  focusLater("keep-meeting");
                }}
              >
                Delete meeting
              </Button>
            )}
          </View>
        )}
      </View>
    </Sheet>
  );
}

// ── In the chat and on a call: what the meetings tool found or offers ─────────────────────────

function parsed(result: unknown): Record<string, unknown> | undefined {
  if (typeof result === "string")
    try {
      return JSON.parse(result) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  return result && typeof result === "object" ? (result as Record<string, unknown>) : undefined;
}

/** The recorder's Start (on a call: end the call and start), a meeting's notes, or a list. */
export function MeetingsToolCard({
  result,
  loading,
  onCall,
}: {
  result: unknown;
  loading?: boolean;
  onCall?: boolean;
}) {
  const { open } = useWorkspace();
  const rec = useRecorder();
  const value = parsed(result);
  if (loading || !value || "error" in value) return null;
  if (value.recorder === true) {
    const busy = rec.state.phase !== "idle" && rec.state.phase !== "error";
    return (
      <Card style={{ gap: 12 }}>
        <View style={[s.row, { gap: 10 }]}>
          <Mic size={20} color={RECORD_RED} />
          <Text style={[s.heading, { flex: 1 }]}>
            {busy ? "Recording now" : "Ready to record your meeting"}
          </Text>
        </View>
        <Text style={s.muted}>
          {onCall
            ? "This ends our call and starts recording. Let everyone know they’re being recorded."
            : "Let everyone know they’re being recorded. You’ll get a summary, decisions, action items and every word."}
        </Text>
        <RecordMeetingButton label={onCall ? "End call and record" : "Start recording"} />
      </Card>
    );
  }
  const one = value.meeting as (Partial<MeetingView> & { minutes?: number }) | undefined;
  if (one && typeof one.id === "string") {
    const id = one.id;
    return (
      <Card style={{ gap: 10 }}>
        <Text style={s.heading}>{one.title}</Text>
        {!!one.startedAt && (
          <Text style={s.muted}>
            {meetingLine({ startedAt: one.startedAt, seconds: (one.minutes ?? 1) * 60 })}
          </Text>
        )}
        {!!one.summary && (
          <Text style={s.text} numberOfLines={4}>
            {one.summary}
          </Text>
        )}
        <Button
          small
          icon={AudioLines}
          style={{ alignSelf: "flex-start" }}
          onPress={() => open({ type: "meeting", id })}
        >
          Open the notes
        </Button>
      </Card>
    );
  }
  const list = Array.isArray(value.meetings)
    ? (value.meetings as (Partial<MeetingView> & { minutes?: number; found?: string[] })[])
    : [];
  if (!list.length) return null;
  return (
    <Card style={{ gap: 4 }}>
      <Text style={[s.heading, { marginBottom: 6 }]}>Meetings</Text>
      {list.slice(0, 8).map((m) =>
        typeof m.id === "string" ? (
          <Pressable
            key={m.id}
            role="button"
            aria-label={`Open ${m.title}`}
            onPress={() => open({ type: "meeting", id: m.id as string })}
            style={({ pressed }) => ({
              minHeight: 48,
              paddingVertical: 8,
              borderTopWidth: 1,
              borderTopColor: colors.line,
              opacity: pressed ? 0.6 : 1,
              gap: 2,
            })}
          >
            <Text style={[s.text, { fontWeight: "600", color: colors.blueText }]}>{m.title}</Text>
            {!!m.startedAt && (
              <Text style={s.muted}>
                {meetingLine({ startedAt: m.startedAt, seconds: (m.minutes ?? 1) * 60 })}
              </Text>
            )}
            {m.found?.[0] ? (
              <Text style={s.muted} numberOfLines={2}>
                “{m.found[0]}”
              </Text>
            ) : null}
          </Pressable>
        ) : null,
      )}
    </Card>
  );
}

/** Home's round Record button, next to Talk and Type, styled like Type. */
export function HomeRecordButton({
  glass,
  ink,
  size = 62,
}: {
  glass: boolean;
  ink: string;
  size?: number;
}) {
  const rec = useRecorder();
  const startRecording = useStartRecording();
  if (!rec.supported) return null;
  const busy = rec.state.phase !== "idle" && rec.state.phase !== "error";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy ? "Recording now. Open the recorder" : "Record a meeting"}
      {...tipProps(busy ? "Recording now" : "Record a meeting")}
      onPress={busy ? rec.expand : startRecording}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
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
      {busy ? (
        // A live sign while it records; tapping opens the recorder.
        <LevelBars level={rec.state.level} color={RECORD_RED} size={0.8} />
      ) : (
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: RECORD_FILL,
            borderWidth: 3,
            borderColor: glass || ink === "#FFFFFF" ? "#FFFFFF" : colors.card,
            ...(glass ? {} : { outlineWidth: 1, outlineColor: colors.line, outlineStyle: "solid" }),
          }}
        />
      )}
    </Pressable>
  );
}

/** The recorder's bar under the call's, for every sheet's top (App.tsx's SheetTop). */
export function useRecordingBar() {
  const value = useContext(RecorderContext);
  const phase = value?.state.phase ?? "idle";
  const on = phase === "recording" || phase === "paused" || phase === "saving";
  // The same element while it records, so sheets aren't redrawn every second.
  return useMemo(() => (on ? <RecordingBar /> : null), [on]);
}
