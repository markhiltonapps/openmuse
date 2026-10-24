import {
  AudioLines,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  CloudOff,
  Download,
  ListChecks,
  Mic,
  MicOff,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
  TriangleAlert,
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
import { PERSONA_FACTS, type PersonaKey } from "../../../packages/domain/src/persona";
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
import { indexedStore } from "./meeting-store";
import { MeetingUploader, type Unsent } from "./meeting-uploader";
import { dark } from "./theme";
import { tipProps } from "./tips";
import { Button, Card, CheckRow, Chip, colors, ErrorNotice, glassSurface, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/** The record colour for dots and words: a clear red that reads on light, dark and glass. */
export const RECORD_RED = dark ? "#FF6369" : "#D93036";
/** Filled red behind white words (Stop, Record), and the bar's dot: reads in every look. */
export const RECORD_FILL = "#C7272D";

export type MeetingStatus = "recording" | "transcribing" | "summarizing" | "done" | "failed";
/** One thing a brain dump was sorted into, to be added or left. */
export interface DumpItemView {
  id: string;
  kind: "reminder" | "note" | "task" | "fact";
  text: string;
  at?: string;
  key?: string;
  value?: string;
  state?: "added" | "failed";
  detail?: string;
}
export interface MeetingView {
  id: string;
  title: string;
  /** A brain dump is sorted into things to add, not minuted. */
  kind?: "meeting" | "dump";
  dump?: DumpItemView[];
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
  /** A model is set up to sort brain dumps. */
  dumpAvailable?: boolean;
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
      if (state.trouble) return "Not reaching the server. The recording is safe on this device";
      if (state.caughtUp) return "Reached the server again. Everything has been sent";
      if (state.away !== undefined)
        return `Recording again. Nothing was recorded for ${missedLength(state.away)} while you were away.`;
      return left !== undefined && left < 5 * 60 ? "5 minutes or less left" : "Recording";
    case "paused":
      return "Recording paused. It carries on when you’re back";
    case "saving":
      return state.trouble
        ? "Not reaching the server. You can keep the recording on this device and carry on"
        : "Saving the recording";
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
  start: (wait?: number, kind?: "meeting" | "dump") => void;
  stop: () => void;
  discard: () => void;
  resume: () => void;
  /** After a Stop that couldn't reach the server: tries once more. */
  finishAgain: () => void;
  /** The meeting this recording made, in its own sheet (the recorder closes). */
  openMeeting: () => void;
  /** The "paused while you were away" note has been read. */
  seenAway: () => void;
  /** Stop is waiting on pieces the server isn't taking: keep them on this device and go on. */
  keepOnDevice: () => void;
  keepInstead: () => void;
  /** Sends a recording's pieces; also what a stopped recording's page asks about what's unsent. */
  uploader: MeetingUploader;
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
const never = () => () => undefined;
const noVersion = () => 0;
/** What of this recording is still on this device, not yet on the server (undefined: all sent). */
export function useUnsent(meetingId: string): Unsent | undefined {
  const uploader = useContext(RecorderContext)?.uploader;
  useSyncExternalStore(
    uploader?.subscribe ?? never,
    uploader?.getVersion ?? noVersion,
    uploader?.getVersion ?? noVersion,
  );
  return uploader?.snapshot(meetingId);
}
/** Start, ending a live call first: the phone can't record and be on a call at once. */
export function useStartRecording() {
  const rec = useRecorder();
  const call = useCallControls();
  // A press passes its event: only the word "dump" asks for a brain dump.
  return useCallback(
    (what?: unknown) => {
      const kind = what === "dump" ? "dump" : "meeting";
      if (call.phase === "on") {
        call.end();
        // A moment for the call to let go of the microphone.
        rec.start(500, kind);
        return;
      }
      if (call.phase === "over") call.dismiss();
      rec.start(0, kind);
    },
    [call, rec],
  );
}
/** Whether a recording is going on (the call button's other use of the microphone checks this). */
export function useRecording() {
  const value = useContext(RecorderContext);
  const phase = value?.state.phase ?? "idle";
  return phase === "recording" || phase === "paused" || phase === "saving";
}

export function MeetingRecorderProvider({ children }: { children: ReactNode }) {
  const { api, open } = useWorkspace();
  const uploader = useMemo(() => new MeetingUploader(api, indexedStore()), [api]);
  const recorder = useMemo(() => new MeetingRecorder(api, uploader), [api, uploader]);
  // Audio left on this device (a reload, a closed tab, a server that wasn't taking files) is sent
  // when the app opens, and again whenever the phone is back online or the app comes to the front.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    void uploader.resume(true);
    const back = () => {
      uploader.poke();
      void uploader.resume();
    };
    const visible = () => {
      if (document.visibilityState === "visible") back();
    };
    window.addEventListener("online", back);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", back);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [uploader]);
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
    (wait = 0, kind: "meeting" | "dump" = "meeting") => {
      setShown(true);
      setTimeout(() => void recorder.start(kind), wait);
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
  const keepInstead = useCallback(() => {
    void recorder.keepInstead().then((id) => {
      if (id) {
        setShown(false);
        open({ type: "meeting", id });
      }
    });
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
      keepOnDevice: () => recorder.keepOnDevice(),
      keepInstead,
      finishAgain,
      openMeeting,
      uploader,
      shown,
      expand: () => setShown(true),
      shrink: () => {
        setShown(false);
        recorder.clear();
        recorder.seenAway();
      },
    }),
    [
      state,
      supported,
      start,
      stop,
      discard,
      keepInstead,
      finishAgain,
      openMeeting,
      uploader,
      recorder,
      shown,
    ],
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

/** Why the server isn't getting the audio, in plain words (never the raw error). */
function whyNotSending(error?: string) {
  // Matches the server's own words for a refused piece (STORAGE_DOWN_PIECE in apps/server/src/meetings.ts).
  return error && /can’t save/i.test(error)
    ? "The server can’t save recordings right now."
    : "The server isn’t answering right now, or the connection dropped.";
}
/** A small icon in a fixed box, so a spinner and a symbol line up with the title beside them. */
function CardIcon({ children }: { children: ReactNode }) {
  return (
    <View aria-hidden style={{ width: 20, height: 20, marginTop: 1, alignItems: "center" }}>
      {children}
    </View>
  );
}
/**
 * Shown within seconds of the first failed sends: the audio is kept, and what to do. While
 * recording it says to keep going; once Stop was pressed it says the person can wait or move on.
 */
function NotSaving({ state, stopped }: { state: RecorderState; stopped?: boolean }) {
  const hold = state.onlyHere
    ? "This device wouldn’t keep a copy, so the recording is held in this tab only. Don’t close or reload it until it has sent."
    : undefined;
  return (
    <Card style={{ gap: 10, alignSelf: "stretch", marginTop: 8, backgroundColor: colors.orange }}>
      <View style={[s.row, { gap: 8, alignItems: "flex-start" }]}>
        <CardIcon>
          <CloudOff size={18} color={colors.text} />
        </CardIcon>
        <Text style={[s.text, { fontWeight: "700", flex: 1 }]}>Not reaching the server</Text>
      </View>
      <Text style={s.text}>{whyNotSending(state.troubleText)}</Text>
      <Text style={[s.muted, { color: colors.mutedStrong }]}>
        {hold ??
          (stopped
            ? "Your recording is safe on this device. You can wait here, or tap “Keep it on this device and carry on” below. It sends by itself once the server is back, as long as the app is open."
            : "Your recording is safe on this device. Keep this screen open and keep recording. It sends by itself as soon as the server is back.")}
      </Text>
    </Card>
  );
}
/** Saves what's still kept on this device as audio files (one per part), so nothing is lost. */
async function saveCopies(uploader: MeetingUploader, id: string, title: string) {
  const copies = await uploader.copies(id);
  if (!copies.length) return 0;
  const base =
    title
      .replace(/[^\w -]+/g, "")
      .trim()
      .replace(/\s+/g, "-") || "meeting";
  for (const copy of copies) {
    const url = URL.createObjectURL(copy.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${base}${copies.length > 1 ? `-part-${copy.part + 1}` : ""}.${/mp4/.test(copy.type) ? "m4a" : "webm"}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    // Browsers refuse several automatic downloads in a row, so each waits a moment.
    if (copies.length > 1) await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return copies.length;
}
/** What's left to send, in a few words ("less than a minute", "about 3 minutes"). */
function leftToSend(seconds: number) {
  if (seconds < 60) return "Less than a minute";
  const minutes = Math.round(seconds / 60);
  return `About ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
/** A recording whose audio is still on this device: sending, or couldn't be sent. */
export function UnsentCard({ unsent, title }: { unsent: Unsent; title: string }) {
  const { uploader } = useRecorder();
  const [saved, setSaved] = useState<string>();
  const [confirmClear, setConfirmClear] = useState(false);
  const left = unsent.pieces
    ? `${leftToSend(unsent.seconds)} of the recording hasn’t reached the server yet.`
    : "Everything has reached the server. Finishing up…";
  return (
    <Card style={{ gap: 10, backgroundColor: colors.orange }}>
      <View style={[s.row, { gap: 8, alignItems: "flex-start" }]}>
        <CardIcon>
          {unsent.stuck ? (
            <TriangleAlert size={18} color={colors.danger} />
          ) : unsent.trouble ? (
            <CloudOff size={18} color={colors.text} />
          ) : (
            <ActivityIndicator size="small" color={colors.mutedStrong} />
          )}
        </CardIcon>
        <Text style={[s.text, { fontWeight: "700", flex: 1 }]}>
          {unsent.stuck
            ? "Part of this recording couldn’t be sent"
            : "Still sending from this device"}
        </Text>
      </View>
      {unsent.stuck ? (
        <Text style={s.text}>
          This recording was already closed, so the rest can’t be added to it. The rest is still on
          this device for 2 weeks. Save a copy of the audio to keep it. The file may only play from
          part-way through, and it can’t be added back to the notes.
        </Text>
      ) : (
        <>
          <Text style={s.text}>{left}</Text>
          <Text style={[s.muted, { color: colors.mutedStrong }]}>
            {unsent.trouble ? `${whyNotSending(unsent.error)} ` : ""}
            {unsent.onlyHere
              ? "This device wouldn’t keep a copy, so the recording is held in this tab only. Don’t close or reload it until it has sent. "
              : "Your recording is kept on this device and sends by itself when the server can be reached. "}
            Keep the app open and the screen on until it’s sent. If the app is closed or locked for
            45 minutes, the rest can’t be added. The notes are written once everything has arrived.
          </Text>
        </>
      )}
      {unsent.pieces > 0 && (
        <Button
          icon={Download}
          style={{ alignSelf: "flex-start" }}
          onPress={() => {
            void saveCopies(uploader, unsent.meetingId, title).then((count) =>
              setSaved(
                count
                  ? "Asked your browser to save the audio. Check your downloads."
                  : "Nothing is left on this device to save.",
              ),
            );
          }}
        >
          Save a copy of the audio
        </Button>
      )}
      <StatusLine text={saved ?? ""} />
      {saved && <Text style={s.small}>{saved}</Text>}
      {unsent.stuck &&
        (confirmClear ? (
          <View style={{ gap: 8 }}>
            <Text style={s.text}>
              Clear the audio from this device? The notes stay. The audio can’t be brought back.
            </Text>
            <View style={[s.row, { gap: 8 }]}>
              <Button danger onPress={() => void uploader.discard(unsent.meetingId)}>
                Clear it
              </Button>
              <Button onPress={() => setConfirmClear(false)}>Keep it</Button>
            </View>
          </View>
        ) : (
          <Button style={{ alignSelf: "flex-start" }} onPress={() => setConfirmClear(true)}>
            I’ve saved it. Clear it from this device
          </Button>
        ))}
    </Card>
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
        ? state.kind === "dump"
          ? "Brain dump"
          : "Recording"
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
                    : state.kind === "dump"
                      ? "Brain dump"
                      : "Record a meeting";
  // Stop's footer goes away, so keyboard focus moves to the one choice left on the saving screen.
  const keepOffered = saving && Boolean(state.trouble);
  useEffect(() => {
    if (keepOffered) focusLater("keep-on-device");
  }, [keepOffered]);
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
                {state.kind === "dump" ? "Stop and sort it" : "Stop and write it up"}
              </Text>
            </Pressable>
            {confirm ? (
              <View style={{ gap: 8, alignItems: "center" }}>
                <Text style={[s.muted, { textAlign: "center", maxWidth: 360 }]}>
                  {state.trouble || state.waiting > 0
                    ? "Throw this recording away for good? Part of it hasn’t reached the server, so it can’t be brought back."
                    : "Throw this recording away for good?"}
                </Text>
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
                  backgroundColor: paused || saving ? "transparent" : RECORD_RED,
                  borderWidth: paused || saving ? 2 : 0,
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
              <CardIcon>
                <MicOff size={18} color={colors.text} />
              </CardIcon>
              <Text style={[s.text, { fontWeight: "700", flex: 1 }]}>
                Recording paused while you were away
              </Text>
            </View>
            <Text style={s.text}>
              Nothing was recorded for {missedLength(state.away)}. It’s recording again now.
            </Text>
            <Text style={[s.muted, { color: colors.mutedStrong }]}>
              To catch every word, keep this screen open until{" "}
              {state.kind === "dump" ? "you’re done" : "the meeting ends"}.
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
            {state.kind === "dump"
              ? "Just talk. When you stop, I sort it into things for you to add."
              : "Let everyone know they’re being recorded."}
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
        {saving && !state.trouble && (
          <View style={[s.row, { gap: 10 }]}>
            <ActivityIndicator color={colors.muted} />
            <Text style={s.muted}>
              {state.waiting
                ? "Sending the last of the recording…"
                : state.kind === "dump"
                  ? "Sending it off to be sorted…"
                  : "Sending it off to be written up…"}
            </Text>
          </View>
        )}
        {saving && state.trouble && (
          <View style={{ gap: 12, alignSelf: "stretch" }}>
            <NotSaving state={state} stopped />
            <Button
              primary
              nativeID="keep-on-device"
              onPress={rec.keepOnDevice}
              style={{ alignSelf: "stretch" }}
            >
              Keep it on this device and carry on
            </Button>
          </View>
        )}
        {state.phase === "starting" && <ActivityIndicator color={colors.muted} />}
        {(recording || paused) && state.trouble && <NotSaving state={state} />}
        {(recording || paused) && !state.trouble && state.waiting > 2 && (
          <Text style={[s.small, { textAlign: "center" }]}>
            The connection is slow, so some of the recording hasn’t sent yet. Keep recording. It
            will send when the connection is back.
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
                <Button primary icon={Mic} onPress={() => rec.start(0, state.kind)}>
                  Record the rest
                </Button>
                <Button onPress={rec.openMeeting}>Open the meeting</Button>
              </View>
            ) : state.notThrownAway === "written" ? (
              <Button primary onPress={rec.openMeeting} style={{ alignSelf: "flex-start" }}>
                Open the meeting
              </Button>
            ) : state.notThrownAway === "offline" ? (
              <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                <Button primary icon={RotateCcw} onPress={rec.discard}>
                  Try again
                </Button>
                <Button onPress={rec.keepInstead}>Keep it instead</Button>
              </View>
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
                <Button primary icon={Mic} onPress={() => rec.start(0, state.kind)}>
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

/**
 * Audio still on this device after the recorder is closed (a recording stopped while the server
 * wasn't taking it, or left after a reload): a bar at the top of every screen, so it's never
 * forgotten, that opens the meeting's page.
 */
function UnsentBar() {
  const { uploader } = useRecorder();
  const { open } = useWorkspace();
  useSyncExternalStore(uploader.subscribe, uploader.getVersion, uploader.getVersion);
  const first = uploader.all()[0];
  if (!first) return null;
  const stuck = Boolean(first.stuck);
  const audio = `${first.seconds < 60 ? "under 1" : Math.round(first.seconds / 60)} min of audio`;
  const words = stuck
    ? "Part of a recording couldn’t be sent"
    : first.trouble
      ? `Not sending · ${audio}`
      : `Sending · ${audio} left`;
  return (
    <View
      role="region"
      aria-label="A recording is still on this device"
      style={{
        marginHorizontal: 12,
        marginTop: 8,
        marginBottom: 4,
        borderRadius: 30,
        backgroundColor: colors.inverse,
      }}
    >
      <Pressable
        role="button"
        aria-label={`${words}. Open the meeting`}
        onPress={() => open({ type: "meeting", id: first.meetingId })}
        style={({ pressed }) => ({
          minHeight: 48,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        {stuck ? (
          <TriangleAlert size={18} color={colors.onInverse} />
        ) : first.trouble ? (
          <CloudOff size={18} color={colors.onInverse} />
        ) : (
          <ActivityIndicator size="small" color={colors.onInverse} />
        )}
        <Text
          numberOfLines={1}
          style={{ flex: 1, color: colors.onInverse, fontSize: 15, fontWeight: "600" }}
        >
          {words}
        </Text>
        <ChevronRight size={18} color={colors.onInverse} />
      </Pressable>
    </View>
  );
}

/** The red bar at the top of every screen and sheet while recording; tap it for the recorder. */
export function RecordingBar() {
  const rec = useRecorder();
  const { state } = rec;
  if (state.phase !== "recording" && state.phase !== "paused" && state.phase !== "saving")
    return <UnsentBar />;
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
        aria-label={`${paused ? "Recording paused" : "Recording"}, ${spokenLength(state.seconds)}${state.trouble ? ", not sending to the server" : ""}. Open the recorder`}
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
          {state.trouble
            ? "Not sending"
            : paused
              ? "Paused"
              : state.phase === "saving"
                ? "Saving"
                : "Recording"}{" "}
          · {clock(state.seconds)}
          {ending && !state.trouble
            ? ` · ${Math.max(1, Math.ceil((left ?? 0) / 60))} min left`
            : ""}
        </Text>
        {state.phase === "recording" && !ending && !state.trouble && (
          <LevelBars level={state.level} color={colors.onInverse} size={0.6} />
        )}
      </Pressable>
      {state.phase !== "saving" && (
        <Pressable
          role="button"
          aria-label={paused ? "Carry on recording" : "Stop recording and write it up"}
          {...tipProps(
            paused
              ? "Carry on recording"
              : state.kind === "dump"
                ? "Stop and sort it"
                : "Stop and write it up",
          )}
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

/** A brain dump: talk on your own, and it comes back sorted into things to add. */
export function BrainDumpButton({ small }: { small?: boolean }) {
  const rec = useRecorder();
  const startRecording = useStartRecording();
  const busy = rec.state.phase !== "idle" && rec.state.phase !== "error";
  if (!rec.supported || busy) return null;
  return (
    <Button
      small={small}
      icon={AudioLines}
      onPress={() => startRecording("dump")}
      style={{ alignSelf: "flex-start", minHeight: 48 }}
    >
      Brain dump
    </Button>
  );
}

/** The Record button, as a card's first action; it says why when it can't. */
export function RecordMeetingButton({
  label = "Record a meeting",
  kind = "meeting",
}: {
  label?: string;
  kind?: "meeting" | "dump";
}) {
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
      onPress={busy ? rec.expand : () => startRecording(kind)}
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
  const toAdd = (meeting.dump ?? []).filter((item) => item.state !== "added").length;
  const { open } = useWorkspace();
  const rec = useRecorder();
  const unsent = useUnsent(meeting.id);
  // The one being recorded right now opens the recorder, not an empty page.
  const live = meeting.status === "recording" && rec.state.meetingId === meeting.id;
  return (
    <Pressable
      role="button"
      aria-label={
        live
          ? `${meeting.title}, recording now. Open the recorder`
          : `Open ${meeting.title}${meeting.kind === "dump" ? ", brain dump" : ""}, ${meetingLine(meeting)}, ${unsent ? "still sending from this device" : statusLabel(meeting.status)}`
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
        {meeting.kind === "dump" ? (
          <ListChecks size={20} color={colors.mutedStrong} />
        ) : (
          <AudioLines size={20} color={colors.mutedStrong} />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.text, { fontWeight: "600" }]} numberOfLines={2}>
          {meeting.title}
        </Text>
        <Text style={s.muted} numberOfLines={2}>
          {meetingLine(meeting)}
        </Text>
      </View>
      {unsent && meeting.status === "recording" && !live ? (
        <Chip tint={colors.orange}>Still sending</Chip>
      ) : meeting.status === "recording" ? (
        <View style={[s.row, { gap: 6 }]}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: RECORD_RED }} />
          <Text style={[s.small, { color: colors.mutedStrong, fontWeight: "600" }]}>Recording</Text>
        </View>
      ) : meeting.status !== "done" ? (
        <Chip tint={meeting.status === "failed" ? colors.errorBg : colors.lavender}>
          {statusLabel(meeting.status)}
        </Chip>
      ) : meeting.kind === "dump" && toAdd > 0 ? (
        <View style={{ alignSelf: "center" }}>
          <Chip tint={colors.lavender}>{`${toAdd} to add`}</Chip>
        </View>
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
          <Text style={s.muted}>
            Or do a brain dump: think out loud on your own, up to half an hour, and I sort it into
            reminders, notes, jobs for me and things about you. You choose what to add.
          </Text>
        </View>
        {data.available ? (
          <View style={{ gap: 6 }}>
            <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
              <RecordMeetingButton />
              {data.dumpAvailable !== false && <BrainDumpButton />}
            </View>
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
  const dump = meeting.kind === "dump";
  if (meeting.status === "done") return dump ? "Your list is ready" : "The notes are ready";
  if (meeting.status === "failed")
    return dump ? "It couldn’t be sorted" : "It couldn’t be written up";
  if (meeting.status === "transcribing") return "Writing down every word";
  if (meeting.status === "summarizing") return "Writing the notes";
  return "";
}

const DUMP_KIND: Record<DumpItemView["kind"], string> = {
  reminder: "Reminder",
  note: "Note to keep",
  task: "A job for me",
  fact: "About you",
};
/** A reminder's time as it was said: "Tue, Oct 27, 9:00 AM". */
function dumpWhen(at?: string) {
  const when = at ? new Date(at) : undefined;
  return when && !Number.isNaN(when.getTime())
    ? when.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
}
/** What a sorted thing will be, in a few words, for the line under it. */
export function dumpDetail(item: DumpItemView) {
  if (item.kind === "task") return "A job for me · starts when you add it";
  if (item.kind === "reminder") {
    const when = dumpWhen(item.at);
    return when ? `Reminder · ${when}` : "Reminder";
  }
  if (item.kind === "fact") {
    const label =
      item.key && item.key in PERSONA_FACTS ? PERSONA_FACTS[item.key as PersonaKey].label : "";
    return label ? `About you · ${label}: ${item.value ?? ""}` : "About you";
  }
  return DUMP_KIND[item.kind];
}

/**
 * A brain dump's sorted things: each ticked to be added, nothing added until the person taps. Added
 * ones stay in place, marked, and one that couldn't be added says why and can be tried again.
 */
function DumpSection({
  meeting,
  onChange,
}: {
  meeting: MeetingRead;
  onChange: (view: Partial<MeetingRead>) => void;
}) {
  const { api } = useWorkspace();
  const items = meeting.dump ?? [];
  const waiting = items.filter((item) => item.state !== "added");
  const [chosen, setChosen] = useState<string[]>(() => waiting.map((item) => item.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");
  if (!meeting.dump) return null;
  if (!items.length)
    return (
      <Text style={s.muted}>
        Nothing to add came out of this one. The words are below, if you want to look.
      </Text>
    );
  const picked = chosen.filter((id) => waiting.some((item) => item.id === id));
  async function add() {
    setBusy(true);
    setError("");
    setSaid("");
    try {
      const view = await api.request<MeetingRead>(
        `/api/meetings/${encodeURIComponent(meeting.id)}/dump`,
        { which: picked },
      );
      onChange({ dump: view.dump });
      const after = view.dump ?? [];
      const worked = picked.filter((id) => after.find((item) => item.id === id)?.state === "added");
      const failed = picked.length - worked.length;
      setChosen((now) => now.filter((id) => !worked.includes(id)));
      setSaid(
        `${worked.length} added${failed ? `. ${failed} couldn’t be added: tap Add again to retry` : ""}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t add these. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const added = items.length - waiting.length;
  const failedNow = items.filter((item) => item.state === "failed").length;
  return (
    <View style={{ gap: 10 }}>
      <Text role="heading" aria-level={3} style={s.heading}>
        {waiting.length === 0
          ? "Added from your brain dump"
          : added
            ? "Sorted from your brain dump"
            : "Ready to add"}
      </Text>
      {waiting.length > 0 && (
        <Text style={s.muted}>
          I can miss or misread things, so look before you add. Nothing is added until you tap the
          button below. Or tell me “add them all”.
        </Text>
      )}
      <Card style={{ gap: 0, paddingVertical: 4, backgroundColor: colors.subtle }}>
        {items.map((item) =>
          item.state === "added" ? (
            <CheckRow
              key={item.id}
              done
              checked
              label={item.text}
              detail={`Added · ${item.detail ?? dumpDetail(item)}`}
              onPress={() => undefined}
            />
          ) : (
            <CheckRow
              key={item.id}
              label={item.text}
              problem={item.state === "failed"}
              detail={item.state === "failed" ? failText(item.detail) : dumpDetail(item)}
              checked={picked.includes(item.id)}
              onPress={() =>
                setChosen((now) =>
                  now.includes(item.id) ? now.filter((id) => id !== item.id) : [...now, item.id],
                )
              }
            />
          ),
        )}
      </Card>
      {waiting.length > 0 && (
        <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
          <Button
            primary
            busy={busy}
            disabled={!picked.length}
            onPress={() => void add()}
            style={{ minHeight: 48 }}
          >
            {!picked.length
              ? "Add"
              : picked.length === 1
                ? "Add 1"
                : picked.length === waiting.length
                  ? `Add all ${waiting.length}`
                  : `Add ${picked.length} chosen`}
          </Button>
          {waiting.length > 1 && (
            <Button onPress={() => setChosen(picked.length ? [] : waiting.map((item) => item.id))}>
              {picked.length ? "Choose none" : "Choose all"}
            </Button>
          )}
        </View>
      )}
      {/* Kept mounted so what happened is read out; out of the layout while it says nothing. */}
      <Text
        role="status"
        style={[
          s.muted,
          { color: failedNow ? colors.danger : colors.greenText },
          !said && {
            position: "absolute",
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: "none",
          },
        ]}
      >
        {said}
      </Text>
      {!!error && <ErrorNotice error={error} />}
    </View>
  );
}

/** Why one thing couldn't be added, without saying "couldn't" twice. */
function failText(detail?: string) {
  if (!detail) return "Couldn’t add this one. Try again.";
  return /^couldn/i.test(detail) ? `${detail} Try again.` : `Couldn’t add: ${detail}`;
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
  const unsent = useUnsent(id);
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
      // Only now is the device's own copy let go.
      await rec.uploader.discard(id);
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
        <View style={{ gap: 14 }}>
          <ErrorNotice error={error || "This meeting couldn’t be found."} />
          {/* Offline is when the audio on this device matters most: it must still be reachable. */}
          {unsent && <UnsentCard unsent={unsent} title="meeting" />}
        </View>
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
  // Recording right now on this screen's recorder (not just a recording left on the device).
  const liveHere = ours && ["recording", "paused", "saving"].includes(rec.state.phase);
  return (
    <Sheet title={meeting.title} subtitle={meetingLine(meeting)} onClose={close} narrow fill>
      <StatusLine text={news} />
      <View style={{ gap: 18 }}>
        <ErrorNotice error={error} />
        {unsent && <UnsentCard unsent={unsent} title={meeting.title} />}
        {recordingNow && !unsent && (
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
          <Text style={s.muted}>
            {meeting.kind === "dump"
              ? "Recording stopped by itself after half an hour."
              : "Recording stopped by itself at this month’s limit."}
          </Text>
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
                  : meeting.kind === "dump"
                    ? "Sorting what you said…"
                    : "Writing the summary and action items…"}
              </Text>
            </View>
            <Text style={s.muted}>
              It usually takes a minute or two. You’ll get a notification when it’s ready; you can
              close this.
            </Text>
          </Card>
        )}
        {meeting.status === "failed" && !unsent?.stuck && (
          <Card style={{ gap: 10, backgroundColor: colors.errorBg }}>
            <Text style={[s.text, { color: colors.danger }]}>
              {meeting.error ||
                (meeting.kind === "dump" ? "It couldn’t be sorted." : "It couldn’t be written up.")}
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
            {meeting.kind === "dump" && (
              <DumpSection
                meeting={meeting}
                onChange={(view) => setMeeting((now) => (now ? { ...now, ...view } : now))}
              />
            )}
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
                  draft(
                    `About the ${meeting.kind === "dump" ? "brain dump" : "meeting"} “${meeting.title}”: `,
                  );
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
        {(!recordingNow || (unsent && !liveHere)) && (
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
                  {unsent
                    ? "Delete this meeting for good? The audio still on this device goes too, and that may be the only copy."
                    : meeting.kind === "dump"
                      ? "Delete this brain dump for good? Its words and audio go too. Anything you haven’t added is lost; what you’ve added stays."
                      : "Delete this meeting for good? Its notes, words and audio go too."}
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
                {meeting.kind === "dump" ? "Delete brain dump" : "Delete meeting"}
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
            {busy
              ? "Recording now"
              : value.dump === true
                ? "Ready for your brain dump"
                : "Ready to record your meeting"}
          </Text>
        </View>
        <Text style={s.muted}>
          {value.dump === true
            ? onCall
              ? "This ends our call and starts the brain dump. Talk as long as you like, up to half an hour."
              : "Talk as long as you like, up to half an hour. When you stop, I sort it into things for you to add."
            : onCall
              ? "This ends our call and starts recording. Let everyone know they’re being recorded."
              : "Let everyone know they’re being recorded. You’ll get a summary, decisions, action items and every word."}
        </Text>
        <RecordMeetingButton
          kind={value.dump === true ? "dump" : "meeting"}
          label={
            value.dump === true
              ? onCall
                ? "End call and start brain dump"
                : "Start brain dump"
              : onCall
                ? "End call and record"
                : "Start recording"
          }
        />
      </Card>
    );
  }
  const one = value.meeting as
    | (Partial<MeetingView> & { minutes?: number; brainDump?: boolean })
    | undefined;
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
          {one.brainDump ? "Open the list" : "Open the notes"}
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
  const uploader = value?.uploader;
  useSyncExternalStore(
    uploader?.subscribe ?? never,
    uploader?.getVersion ?? noVersion,
    uploader?.getVersion ?? noVersion,
  );
  const waiting = (uploader?.all().length ?? 0) > 0;
  const phase = value?.state.phase ?? "idle";
  const on = phase === "recording" || phase === "paused" || phase === "saving" || waiting;
  // The same element while it records, so sheets aren't redrawn every second.
  return useMemo(() => (on ? <RecordingBar /> : null), [on]);
}
