import { Check, Copy, ExternalLink, Mic, MicOff, PhoneOff } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Linking, Platform, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import type { MuseApi } from "./api";
import { AgentAvatar } from "./avatar";
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
    startLive(api, {
      onState: (next) => !cancelled && setState(next),
      onWords: (role, words) =>
        !cancelled &&
        setLines((current) => {
          const last = current.at(-1);
          if (last?.role === role)
            return [...current.slice(0, -1), { role, text: last.text + words }];
          return [...current.slice(-7), { role, text: words }];
        }),
      onEnded: (reason) => {
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
      void call.current?.end();
      call.current = undefined;
    };
  }, [api, attempt, name, needsKey]);
  const finish = () => {
    void call.current?.end();
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
          : "Listening…";
  // Short screens (a phone on its side in a car mount) get a smaller avatar and caption box.
  const tall = height >= 700;
  // On a very short screen the avatar gives its room to the words.
  const short = height < 450;
  const avatar = tall ? 132 : height >= 520 ? 88 : 56;
  const captionHeight = tall ? (width >= 900 ? 220 : 200) : height >= 520 ? 140 : short ? 72 : 96;
  const note = (
    <Text
      style={[
        s.small,
        { fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 380, alignSelf: "center" },
      ]}
    >
      {`${name} can talk with you here but can’t look things up or do things yet. For that, type in the chat.`}
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
          {!short && (
            <AgentAvatar
              size={avatar}
              mood={state === "connecting" ? "working" : over ? "idle" : undefined}
            />
          )}
          {/* Room for two lines during a call, so a longer status never moves what's below it. */}
          <Text
            style={[
              s.heading,
              { fontSize: 18, textAlign: "center", minHeight: over ? 0 : short ? 26 : 52 },
            ]}
          >
            {status}
          </Text>
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
          {/* There from the start at a fixed height, so the sheet holds still as words arrive. The
            note about what live talk can do fills it until then, and closes it after the end. */}
          {!over || lines.length > 0 ? (
            <ScrollView
              ref={scroller}
              onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
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
