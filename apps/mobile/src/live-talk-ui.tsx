import { Check, Copy, ExternalLink, Headset, Mic, MicOff, PhoneOff } from "lucide-react-native";
import { useEffect, useId, useRef, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { type CallDetail, SHOWN_HEADING } from "../../../packages/domain/src/voice";
import { useAgentWorkspace } from "./agent-workspace";
import type { MuseApi } from "./api";
import { AssistantResponse } from "./assistant-response";
import { AgentAvatar } from "./avatar";
import { CallDetails } from "./call-details";
import { Segmented } from "./charts";
import { HIDDEN } from "./job-working-ui";
import { type LiveCall, type LiveState, liveVoiceSupported, startLive } from "./live-voice";
import { Button, colors, ErrorNotice, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/** On; meant for this person but the server has no key yet (they're shown how to add it); off. */
export type LiveStatus = "on" | "setup" | "off";
// Per signed-in session (each has its own api), so the next person doesn't inherit it.
const cache = new WeakMap<object, LiveStatus>();
// Where the owner adds the key (this service's Variables page in Railway), while it's missing.
const setupLinks = new WeakMap<object, string>();
const listeners = new Set<() => void>();
/** Asks the server (again, after the key is added) and updates every headset. */
export async function checkLiveVoice(api: MuseApi): Promise<LiveStatus> {
  const result = await api.request<{ available: boolean; needsKey?: boolean; setupUrl?: string }>(
    "/api/voice/live",
  );
  const status: LiveStatus = result.available ? "on" : result.needsKey ? "setup" : "off";
  cache.set(api, status);
  if (result.setupUrl) setupLinks.set(api, result.setupUrl);
  for (const listener of listeners) listener();
  return status;
}
/** Whether live voice is on for this person (and this browser can do it). */
export function useLiveVoice(): LiveStatus {
  const { api } = useWorkspace();
  const [status, setStatus] = useState<LiveStatus>(cache.get(api) ?? "off");
  useEffect(() => {
    const update = () => setStatus(cache.get(api) ?? "off");
    update();
    listeners.add(update);
    if (liveVoiceSupported() && !cache.has(api)) void checkLiveVoice(api).catch(() => undefined);
    return () => {
      listeners.delete(update);
    };
  }, [api]);
  return liveVoiceSupported() ? status : "off";
}

const savedListeners = new Set<() => void>();
/** Hears when a call has been saved, so the chat can add it. */
export function onCallSaved(listener: () => void) {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}
/**
 * After a call: the server saves it within a moment of the end; anything asked at the very end
 * follows within two minutes, so it's checked again a few times.
 */
function callSaved(first = 0) {
  for (const after of [first, 15_000, 45_000, 125_000])
    setTimeout(() => {
      for (const listener of savedListeners) listener();
    }, after);
}

/** Why a conversation ended on its own, in plain words. */
const ENDED = (name: string): Record<string, string> => ({
  remote_hangup: "The call ended.",
  close_requested: "The call ended. Talk again to carry on.",
  connection_lost: "The connection dropped. Talk again when you’re ready.",
  expired: "That’s as long as one call can last. Talk again to carry on.",
  time_limit: "Calls stop after an hour. Talk again to carry on.",
  content: "A safety check stopped the call. Talk again to start a new one.",
  idle: `It went quiet, so ${name} hung up. Talk again when you’re ready.`,
  replaced: `You started talking with ${name} somewhere else, so this call ended.`,
  server_restart: `${name} had to restart, so the call ended. Talk again to carry on.`,
});
/** A browser's reason a call couldn't start, as what to do about it. */
function startFailure(error: unknown, name: string) {
  const kind = error instanceof Error ? error.name : "";
  if (kind === "NotAllowedError" || kind === "SecurityError")
    return `${name} can’t hear you. Select the icon beside the web address, allow the microphone, then choose “Talk again”.`;
  if (kind === "NotFoundError")
    return "No microphone was found. Plug one in, then choose “Talk again”.";
  if (kind === "OverconstrainedError")
    return "The microphone chosen in Apps › Voice isn’t connected. Plug it in or choose another there, then choose “Talk again”.";
  if (kind === "NotReadableError")
    return "Another app is using the microphone. Close it, then choose “Talk again”.";
  // No answer, or a page that isn't ours (a proxy's error page during an update).
  if (kind === "TypeError" || kind === "SyntaxError")
    return `Couldn’t reach ${name}. Check your internet connection, then choose “Talk again”.`;
  const message = error instanceof Error ? error.message.trim() : "";
  return message || "Something went wrong. Choose “Talk again” to try once more.";
}

interface Line {
  role: "user" | "assistant";
  text: string;
}

/**
 * Talking with the agent live: it listens while it talks, so the person can just speak, and cut
 * in. The words show as they're said; Mute and End are the only controls.
 */
export function LiveTalkSheet() {
  const { api, close } = useWorkspace();
  const { data } = useAgentWorkspace();
  const { width, height } = useWindowDimensions();
  const name = data?.identity.name || "Neddy";
  const [state, setState] = useState<LiveState>("connecting");
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState("");
  // "Let me check": the agent is looking something up.
  const [lookingUp, setLookingUp] = useState(false);
  // What the agent put on screen instead of reading it out, and whether it's what's showing.
  const [details, setDetails] = useState<CallDetail[]>([]);
  const [view, setView] = useState<"talk" | "details">("talk");
  const detailCount = useRef(0);
  const detailsScroller = useRef<ScrollView>(null);
  // A new answer goes on top: show it, wherever they'd scrolled to.
  useEffect(() => {
    if (details.length) detailsScroller.current?.scrollTo({ y: 0, animated: false });
  }, [details.length]);
  const call = useRef<LiveCall | undefined>(undefined);
  const scroller = useRef<ScrollView>(null);
  const [attempt, setAttempt] = useState(0);
  // The owner, before the server has its key: say what to add instead of asking for the mic.
  const [needsKey, setNeedsKey] = useState(() => cache.get(api) === "setup");
  const [checking, setChecking] = useState(false);
  const checkingNow = useRef(false);
  const [checkNote, setCheckNote] = useState("");
  // Something said in the setup view (a copy) that stays until the next check replaces it.
  const [said, setSaid] = useState("");
  // Said once as the call starts, so a screen reader hears that the check worked.
  const [switchedOn, setSwitchedOn] = useState(false);
  useEffect(() => {
    if (state !== "connecting") setSwitchedOn(false);
  }, [state]);
  const checkAgain = async (quietly = false) => {
    if (checkingNow.current) return;
    checkingNow.current = true;
    if (!quietly) {
      setChecking(true);
      setSaid("");
    }
    // The last note stays (faded) until the answer replaces it, so the sheet doesn't jump.
    try {
      // Once the key is there, this starts the call.
      if ((await checkLiveVoice(api)) === "on") {
        setSwitchedOn(true);
        setNeedsKey(false);
      } else if (!quietly)
        setCheckNote(
          "Still not switched on. Make sure the variable is on the “api” card and named exactly OPENAI_VOICE_API_KEY, and that you chose “Deploy”. If it’s still deploying, wait a minute, then choose “Check\u00a0again”.",
        );
    } catch {
      if (!quietly)
        setCheckNote(
          `Couldn’t reach ${name}. Check your internet connection, or wait a minute if Railway is still deploying. Then choose “Check\u00a0again”.`,
        );
    } finally {
      checkingNow.current = false;
      setChecking(false);
    }
  };
  // The key may have been added since the app last asked: look once when the sheet opens.
  useEffect(() => {
    if (needsKey) void checkAgain(true);
  }, []);
  useEffect(() => {
    if (needsKey) return;
    let cancelled = false;
    setState("connecting");
    setError("");
    setEnded("");
    setLines([]);
    setMuted(false);
    setLookingUp(false);
    setDetails([]);
    setView("talk");
    detailCount.current = 0;
    // Words arrive a few at a time, many times a second: they're gathered and shown about five
    // times a second, so the screen isn't redrawn for each one (slow phones stutter).
    let pending: Line[] = [];
    let flush: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      flush = undefined;
      const arrived = pending;
      pending = [];
      if (cancelled || !arrived.length) return;
      setLines((current) => {
        const next = [...current];
        for (const line of arrived) {
          const last = next.at(-1);
          if (last?.role === line.role)
            next[next.length - 1] = { role: line.role, text: last.text + line.text };
          else next.push(line);
        }
        return next.slice(-8);
      });
    };
    startLive(api, {
      onState: (next) => !cancelled && setState(next),
      onChecking: (on) => !cancelled && setLookingUp(on),
      onDetails: (next) => {
        // A late reply to an earlier look can't take anything away.
        if (cancelled || next.length < detailCount.current) return;
        // Something new: the voice is saying it's on the screen, so that's what shows.
        if (next.length > detailCount.current) setView("details");
        detailCount.current = next.length;
        setDetails(next);
      },
      onWords: (role, words) => {
        if (cancelled) return;
        const last = pending.at(-1);
        if (last?.role === role) last.text += words;
        else pending.push({ role, text: words });
        flush ??= setTimeout(show, 200);
      },
      onEnded: (reason) => {
        // OpenAI ended it; the server saves the call as soon as it hears.
        callSaved(2500);
        if (cancelled) return;
        const endings = ENDED(name);
        setEnded(endings[reason ?? ""] ?? "The call ended.");
        // When the server ended it (quiet, the hour, another call), ask it why once it has
        // saved this call.
        if (reason === "close_requested")
          setTimeout(() => {
            void api
              .request<{ sessions: { reason?: string; endedAt: string }[] }>(
                "/api/voice/live/recent",
              )
              .then(({ sessions }) => {
                const last = sessions[0];
                const fresh = last && Date.now() - Date.parse(last.endedAt) < 10_000;
                if (!cancelled && fresh && last.reason && endings[last.reason])
                  setEnded(endings[last.reason] as string);
              })
              .catch(() => undefined);
          }, 1500);
      },
    })
      .then((started) => {
        if (cancelled) void started.end();
        else call.current = started;
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState("ended");
        setError(startFailure(e, name));
      });
    return () => {
      cancelled = true;
      clearTimeout(flush);
      void call.current?.end().then(() => callSaved());
      call.current = undefined;
    };
  }, [api, attempt, name, needsKey]);
  const finish = () => {
    // The server has saved the call once it answers.
    void call.current?.end().then(() => callSaved());
    call.current = undefined;
    close();
  };
  const toggleMute = () => {
    const next = !muted;
    call.current?.setMuted(next);
    setMuted(next);
  };
  const over = state === "ended";
  // When the buttons swap (the call ends, or starts again), keep focus on the new ones.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const timer = setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      // The first control that can be used (Mute waits while the call connects).
      document
        .querySelector<HTMLElement>('#live-controls [role=button]:not([aria-disabled="true"])')
        ?.focus();
    }, 60);
    return () => clearTimeout(timer);
  }, [over, needsKey]);
  const status = over
    ? ended || (error ? "Couldn’t start." : "The call ended.")
    : state === "connecting"
      ? "Connecting…"
      : muted
        ? `Muted. ${name} can’t hear you.`
        : state === "speaking"
          ? `${name} is talking. Just speak to cut in.`
          : lookingUp
            ? `${name} is checking…`
            : "Listening…";
  // Short screens (a phone on its side in a car mount) get a smaller avatar and caption box.
  const tall = height >= 700;
  // On a very short screen the avatar gives its room to the words.
  const short = height < 450;
  const avatar = tall ? 132 : height >= 520 ? 88 : 56;
  const captionHeight = tall ? (width >= 900 ? 220 : 200) : height >= 520 ? 140 : short ? 72 : 96;
  const showingDetails = view === "details" && details.length > 0;
  // The details take the avatar's room as well as the words'.
  const detailsHeight = captionHeight + (short ? 0 : avatar + 12);
  const note = (
    <Text
      style={[
        s.small,
        { fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 380, alignSelf: "center" },
      ]}
    >
      {`Ask about your day, your plans or anything on the web. Anything ${name} sends, books or buys waits for your OK in the app.`}
    </Text>
  );
  const controls = (
    <View
      nativeID="live-controls"
      style={[s.row, { gap: 10, flexWrap: "wrap", justifyContent: "center" }]}
    >
      {over ? (
        <>
          <Button strong style={{ minWidth: 112 }} onPress={() => setAttempt((n) => n + 1)}>
            Talk again
          </Button>
          <Button style={{ minWidth: 112 }} onPress={close}>
            Close
          </Button>
        </>
      ) : (
        <>
          <Button
            icon={muted ? MicOff : Mic}
            strong={muted}
            disabled={state === "connecting"}
            style={{ minWidth: 112 }}
            onPress={toggleMute}
          >
            {muted ? "Unmute" : "Mute"}
          </Button>
          <Button danger icon={PhoneOff} style={{ minWidth: 112 }} onPress={finish}>
            End
          </Button>
        </>
      )}
    </View>
  );
  const setupControls = (
    <View style={{ gap: 12, alignSelf: "center", width: "100%", maxWidth: 480 }}>
      {/* The answer to a check sits by the button that asked, so it's always in view. It fades
          while checking again and is replaced by the answer, so nothing jumps. */}
      {checkNote ? (
        <View style={[s.error, { marginVertical: 0, padding: 12, opacity: checking ? 0.5 : 1 }]}>
          <Text style={[s.text, { color: colors.danger, fontSize: 14, lineHeight: 20 }]}>
            {checkNote}
          </Text>
        </View>
      ) : null}
      {/* Mounted all the time; the note above isn't a live region, so it's read once. */}
      <Text role="status" style={HIDDEN}>
        {checking ? "Checking…" : said || checkNote || SETUP_HEADING}
      </Text>
      <View
        nativeID="live-controls"
        style={[s.row, { gap: 10, flexWrap: "wrap", justifyContent: "center" }]}
      >
        {/* Not disabled while checking: a disabled button would lose keyboard focus. */}
        <Button strong style={{ minWidth: 112 }} onPress={() => void checkAgain()}>
          {checking ? "Checking…" : "Check again"}
        </Button>
        <Button style={{ minWidth: 112 }} onPress={close}>
          Close
        </Button>
      </View>
    </View>
  );
  return (
    <Sheet
      title={needsKey ? `Talk live with ${name}` : `Talking with ${name}`}
      subtitle={needsKey || over ? undefined : "Live · just talk"}
      onClose={finish}
      footer={needsKey ? setupControls : controls}
    >
      {needsKey ? (
        <LiveSetup name={name} link={setupLinks.get(api)} height={height} onSay={setSaid} />
      ) : (
        <View style={{ alignItems: "center", gap: 12 }}>
          {/* First, so it stays put when the view below it changes. */}
          {details.length > 0 && (
            <View style={{ alignSelf: "center", width: "100%", maxWidth: 560 }}>
              <Segmented
                label="What to show"
                align="center"
                value={view}
                onChange={setView}
                options={[
                  { id: "talk", label: "Conversation" },
                  {
                    id: "details",
                    label: details.length > 1 ? `Details · ${details.length}` : "Details",
                  },
                ]}
              />
            </View>
          )}
          {!short && !showingDetails && (
            <AgentAvatar
              onCall
              size={avatar}
              mood={
                state === "connecting" || (lookingUp && state !== "speaking")
                  ? "working"
                  : over
                    ? "idle"
                    : undefined
              }
            />
          )}
          {/* Room for two lines during a call, so a longer status never moves what's below it. */}
          <View style={{ minHeight: over ? 0 : short ? 26 : 52, justifyContent: "center" }}>
            <Text style={[s.heading, { fontSize: 18, textAlign: "center" }]}>{status}</Text>
          </View>
          {/* Read out when the call starts, mutes or ends; not at every pause, over the voice. */}
          <Text role="status" style={HIDDEN}>
            {error
              ? `${status} ${error}`
              : state === "connecting" && switchedOn
                ? `Live talk is on. ${status}`
                : over || state === "connecting" || muted
                  ? status
                  : `Live. ${name} can hear you. Just speak, and cut in any time.`}
          </Text>
          <ErrorNotice error={error} />
          {showingDetails ? (
            // The sheet's whole width, so three product cards fit on a computer.
            <View style={{ alignSelf: "stretch", height: detailsHeight }}>
              <ScrollView
                ref={detailsScroller}
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 4, paddingBottom: 24 }}
              >
                <CallDetails details={details} onCall />
              </ScrollView>
              {/* A fade at the bottom says there's more below. */}
              <View
                pointerEvents="none"
                style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 24 }}
              >
                <Svg width="100%" height={24}>
                  <Defs>
                    <LinearGradient id="details-fade" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor={colors.canvas} stopOpacity={0} />
                      <Stop offset="1" stopColor={colors.canvas} stopOpacity={1} />
                    </LinearGradient>
                  </Defs>
                  <Rect width="100%" height={24} fill="url(#details-fade)" />
                </Svg>
              </View>
            </View>
          ) : /* There from the start at a fixed height, so the sheet holds still as words arrive. The
            note about what live talk can do fills it until then, and closes it after the end. */
          !over || lines.length > 0 ? (
            <ScrollView
              ref={scroller}
              // Straight to the end: a smooth scroll for every few words is costly on a phone.
              onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
              style={{ alignSelf: "center", width: "100%", maxWidth: 560, height: captionHeight }}
              contentContainerStyle={{
                gap: 10,
                padding: 14,
                flexGrow: 1,
                justifyContent: lines.length ? "flex-start" : "center",
              }}
            >
              {lines.map((line, index) => (
                <Text
                  // Lines only grow at the end, so their place is a stable key.
                  // biome-ignore lint/suspicious/noArrayIndexKey: see above
                  key={index}
                  style={[
                    s.text,
                    line.role === "user"
                      ? { color: colors.mutedStrong, alignSelf: "flex-end", textAlign: "right" }
                      : { color: colors.text },
                  ]}
                >
                  {line.text.trim()}
                </Text>
              ))}
              {(lines.length === 0 || over) && note}
            </ScrollView>
          ) : (
            note
          )}
        </View>
      )}
    </Sheet>
  );
}

const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
const KEY_NAME = "OPENAI_VOICE_API_KEY";
const SETUP_HEADING = "Live talk isn’t switched on yet";
const SETUP_STEPS = [
  "In Railway, open the “api” card (not “web”), then its Variables tab.",
  `Choose “New Variable”. Name it ${KEY_NAME}, paste your OpenAI key as the value, then choose “Add”.`,
  "Choose “Deploy” to apply the change. Wait a few minutes for it to finish, then choose “Check\u00a0again”.",
];

/** For the owner while the server has no OpenAI key: what to add (Check again is in the footer). */
function LiveSetup({
  name,
  link,
  height,
  onSay,
}: {
  name: string;
  /** This service's Variables page in Railway. */
  link?: string;
  height: number;
  /** For the sheet's status line, which keeps it until the next check. */
  onSay: (words: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const canCopy =
    Platform.OS === "web" && typeof navigator !== "undefined" && !!navigator.clipboard;
  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(KEY_NAME);
      setCopyFailed(false);
      setCopied(true);
      // Cleared first, so copying again is read out again.
      onSay("");
      setTimeout(() => onSay("Name copied."), 50);
      // Only the button goes back; the status line isn't read again.
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyFailed(true);
      onSay("Couldn’t copy it. Select the name instead.");
    }
  };
  // A phone on its side: the steps matter more than the avatar.
  const avatar = height < 450 ? 0 : height < 520 ? 56 : 88;
  return (
    <View style={{ gap: 14, alignSelf: "center", width: "100%", maxWidth: 480 }}>
      <View style={{ alignItems: "center", gap: 12 }}>
        {avatar > 0 && <AgentAvatar size={avatar} mood="idle" />}
        <Text style={[s.heading, { fontSize: 18, textAlign: "center" }]}>{SETUP_HEADING}</Text>
        <Text style={[s.text, { textAlign: "center", color: colors.mutedStrong }]}>
          {`It needs your OpenAI key, added in Railway. Then you can talk with ${name} here. Only you see this.`}
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        {SETUP_STEPS.map((step, index) => (
          <View key={step} style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
            <Text style={[s.text, { width: 18, fontWeight: "700", color: colors.blueText }]}>
              {index + 1}
            </Text>
            <View style={{ flex: 1, gap: 8, alignItems: "flex-start" }}>
              <Text style={s.text}>
                {step.split(KEY_NAME).map((part, at) =>
                  at === 0 ? (
                    part
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the parts never move
                    <Text key={at}>
                      <Text
                        selectable
                        style={{
                          fontFamily: mono,
                          fontSize: 14,
                          backgroundColor: colors.subtle,
                          borderRadius: 6,
                          paddingHorizontal: 4,
                        }}
                      >
                        {KEY_NAME}
                      </Text>
                      {part}
                    </Text>
                  ),
                )}
              </Text>
              {index === 0 && link && (
                <Button icon={ExternalLink} onPress={() => void Linking.openURL(link)}>
                  Open in Railway
                </Button>
              )}
              {index === 1 && canCopy && (
                <Button icon={copied ? Check : Copy} onPress={() => void copyName()}>
                  {copied ? "Copied" : "Copy name"}
                </Button>
              )}
              {index === 1 && copyFailed && (
                <Text style={s.small}>Couldn’t copy it. Select the name instead.</Text>
              )}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * A live voice call saved in the chat: its heading ("Spoken conversation · 6 min · …"), the first
 * lines, and the rest on request; then what it showed on screen, as it showed it.
 */
export function SpokenCall({ text, id }: { text: string; id: string }) {
  const [open, setOpen] = useState(false);
  const linesId = `call-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const split = text.indexOf(`\n\n${SHOWN_HEADING}`);
  const said = split >= 0 ? text.slice(0, split) : text;
  // The words are there for the chat agent; the screen shows the real thing when it can.
  const shownWords = split >= 0 ? text.slice(split).replace(SHOWN_HEADING, "").trim() : "";
  const onScreen = useShownDuringCall(shownWords ? id : undefined);
  const [heading = "", ...rest] = said.split("\n");
  const [title = "Spoken conversation", ...meta] = heading.split(" · ");
  const turns = rest
    .filter((line) => line.trim())
    .map((line) => {
      const at = line.indexOf(": ");
      return at > 0
        ? { who: line.slice(0, at), said: line.slice(at + 2) }
        : { who: "", said: line };
    });
  const shown = open ? turns : turns.slice(0, 2);
  return (
    <View style={{ gap: 10 }}>
      <View style={[s.row, { gap: 10, alignItems: "center" }]}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.canvas,
          }}
        >
          <Headset size={17} color={colors.blueText} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.text, { fontWeight: "700" }]}>{title}</Text>
          {meta.length > 0 && (
            <Text style={[s.small, { color: colors.mutedStrong, fontSize: 12 }]}>
              {meta.join(" · ")}
            </Text>
          )}
        </View>
      </View>
      <View nativeID={linesId} style={{ gap: 6 }}>
        {shown.map((turn, index) => (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines never move
            key={index}
            selectable
            style={[
              s.text,
              { fontSize: 15, lineHeight: 22 },
              // The person's lines in grey, as on the call screen.
              turn.who === "You" && { color: colors.mutedStrong },
            ]}
          >
            {turn.who ? <Text style={{ fontWeight: "700" }}>{`${turn.who}: `}</Text> : null}
            {turn.said}
          </Text>
        ))}
      </View>
      {turns.length > 2 && (
        <Pressable
          role="button"
          aria-expanded={open}
          aria-controls={linesId}
          onPress={() => setOpen((value) => !value)}
          style={{
            alignSelf: "flex-start",
            minHeight: 44,
            justifyContent: "center",
            marginBottom: -8,
          }}
        >
          <Text style={[s.text, { color: colors.blueText, fontWeight: "600" }]}>
            {open ? "Show less" : `Show all ${turns.length} lines`}
          </Text>
        </Pressable>
      )}
      {shownWords ? (
        <View
          style={{
            gap: 12,
            marginTop: 6,
            paddingTop: 14,
            borderTopWidth: 1,
            borderTopColor: colors.bubbleLine,
          }}
        >
          <Text style={[s.label, { color: colors.mutedStrong }]}>Details from the call</Text>
          {/* The words until the real thing arrives (or if it can't be had). */}
          {onScreen && onScreen !== "failed" ? (
            <CallDetails details={onScreen} lineColor={colors.bubbleLine} />
          ) : (
            <AssistantResponse content={shownWords} />
          )}
        </View>
      ) : null}
    </View>
  );
}

/** What a saved call showed on screen, from the server; "failed" when it can't be had. */
function useShownDuringCall(id: string | undefined) {
  const { api } = useWorkspace();
  const [shown, setShown] = useState<CallDetail[] | "failed">();
  useEffect(() => {
    if (!id) return;
    let active = true;
    api
      .request<{ details: CallDetail[] }>(`/api/voice/live/${encodeURIComponent(id)}/details`)
      .then(({ details }) => active && setShown(details.length ? details : "failed"))
      .catch(() => active && setShown("failed"));
    return () => {
      active = false;
    };
  }, [api, id]);
  return shown;
}
