import { Mic, MicOff, PhoneOff } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { AgentAvatar } from "./avatar";
import { HIDDEN } from "./job-working-ui";
import { type LiveCall, type LiveState, liveVoiceSupported, startLive } from "./live-voice";
import { Button, colors, ErrorNotice, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

// Per signed-in session (each has its own api), so the next person doesn't inherit it.
const cache = new WeakMap<object, boolean>();
/** Whether live voice is on for this person (and this browser can do it). */
export function useLiveVoice() {
  const { api } = useWorkspace();
  const [available, setAvailable] = useState(cache.get(api) ?? false);
  useEffect(() => {
    setAvailable(cache.get(api) ?? false);
    if (!liveVoiceSupported() || cache.has(api)) return;
    let active = true;
    void api
      .request<{ available: boolean }>("/api/voice/live")
      .then((result) => {
        cache.set(api, result.available);
        if (active) setAvailable(result.available);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);
  return available && liveVoiceSupported();
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
  useEffect(() => {
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
  }, [api, attempt, name]);
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
  }, [over]);
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
  return (
    <Sheet
      title={`Talking with ${name}`}
      subtitle={over ? undefined : "Live · just talk"}
      onClose={finish}
      footer={controls}
    >
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
    </Sheet>
  );
}
