/**
 * Setup with the agent: the first-run questions (name, home, work, family, email and calendar,
 * what to help with, old chats), each said aloud and shown, answered by voice or typed, and
 * saved to About you as it goes. Shown once; it can be run again from About you.
 */
import { Check, Mic, Pencil, Sparkles } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from "react-native";
import type { PersonaFact } from "../../../packages/domain/src/persona";
import type { WeatherResult } from "../../../packages/domain/src/weather";
import { useAgentWorkspace } from "./agent-workspace";
import { usePlace } from "./app-places-ui";
import { AgentAvatar } from "./avatar";
import { type AppDay, CALENDAR_NAMES, todaysEvents } from "./calendar-apps";
import { useCallControls } from "./live-call";
import {
  FOCUS_OPTIONS,
  focusFromSpeech,
  focusWords,
  knownLine,
  nameFrom,
  placeFrom,
  questionFor,
  readProgress,
  SETUP_KEY,
  type SetupAnswers,
  type SetupProgress,
  type SetupStep,
  SPOKEN_STEPS,
  spokenCommand,
  stepAfter,
  stepBefore,
  stepLabel,
  tidyAnswer,
} from "./onboarding-steps";
import { blankTab, openPage } from "./own-apps";
import { Button, colors, ErrorNotice, Sheet, s } from "./ui";
import { primeSpeech, speak, speechAvailable, stopSpeaking, voiceSettings } from "./voice";
import { currentPosition, dictate, dictationAvailable, locationAvailable } from "./web-app";
import { useWorkspace } from "./workspace";

const NAME_KEY = "openmuse.you-name";
const CONNECT_APPS = [
  { app: "gmail", name: "Gmail", mark: "M", tint: "#D93025" },
  { app: "outlook", name: "Outlook", mark: "O", tint: "#0F6CBD" },
  { app: "googlecalendar", name: "Google Calendar", mark: "31", tint: "#1A73E8" },
] as const;
const MORNING_BRIEF = {
  title: "Morning brief",
  prompt:
    "Give me a brief for today: the weather, my calendar, important unread email, anything waiting on me, and progress on my goals.",
  time: "07:30",
  days: [1, 2, 3, 4, 5],
};

function saved(progress: SetupProgress) {
  try {
    globalThis.localStorage?.setItem(SETUP_KEY, JSON.stringify(progress));
  } catch {
    // Private browsing: the answers still reach the server as they're given.
  }
}
/** Whether the setup should open by itself: never done, and not closed part-way twice already. */
export function setupWanted(identity?: { onboardedAt?: string }) {
  if (!identity || identity.onboardedAt) return false;
  try {
    return readProgress(globalThis.localStorage?.getItem(SETUP_KEY)).dismissed < 2;
  } catch {
    return true;
  }
}

export function OnboardingSheet() {
  const { close, navigate, api, workspace } = useWorkspace();
  const { data, mutate, refresh } = useAgentWorkspace();
  const call = useCallControls();
  const aboutYou = usePlace({ place: "memory" });
  const agent = data?.identity.name || "Neddy";
  const [progress, setProgress] = useState<SetupProgress>(() => {
    try {
      // Always opens on hello: a step that speaks or listens needs a tap first (browsers refuse
      // speech with no tap, and nobody wants a microphone starting by itself).
      return { ...readProgress(globalThis.localStorage?.getItem(SETUP_KEY)), step: "hello" };
    } catch {
      return readProgress(null);
    }
  });
  // Where they stopped last time, offered as "Carry on" on the hello screen.
  const [resumeFrom] = useState<SetupStep | undefined>(() => {
    try {
      const was = readProgress(globalThis.localStorage?.getItem(SETUP_KEY)).step;
      return was === "hello" || was === "done" ? undefined : was;
    } catch {
      return undefined;
    }
  });
  const { step, answers, quiet } = progress;
  const update = useCallback((patch: Partial<SetupProgress>) => {
    setProgress((current) => {
      const next = { ...current, ...patch };
      saved(next);
      return next;
    });
  }, []);
  const setAnswers = (patch: Partial<SetupAnswers>) =>
    update({ answers: { ...answers, ...patch } });
  const closedPartWay = () =>
    setProgress((current) => {
      const next = { ...current, dismissed: current.dismissed + 1 };
      saved(next);
      return next;
    });
  const go = (next: SetupStep) => update({ step: next });

  // What's typed, what was heard (shown back for a tap before it's kept), and the microphone.
  const [typed, setTyped] = useState("");
  const [heard, setHeard] = useState<string>();
  const [listening, setListening] = useState(false);
  const [mic, setMic] = useState<"unknown" | "denied">("unknown");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const stopListening = useRef<() => void>(undefined);
  const stepNow = useRef(step);
  stepNow.current = step;
  const heardNow = useRef(heard);
  heardNow.current = heard;
  const answersNow = useRef(answers);
  answersNow.current = answers;
  // What a screen reader is told as things change (one line, always mounted).
  const [status, setStatus] = useState("");
  const heading = useRef<Text>(null);
  const canListen = dictationAvailable() && mic !== "denied";
  const spoken = SPOKEN_STEPS.includes(step);

  const listen = useCallback(() => {
    if (!dictationAvailable()) return;
    stopListening.current?.();
    setNote("");
    setListening(true);
    stopListening.current = dictate(
      (text) => {
        const at = stepNow.current;
        const command = spokenCommand(text);
        // Some answers are really taps: "skip", "back", "that's it".
        if (command === "back") return go(stepBefore(at));
        if (command === "skip" && at !== "name") return go(stepAfter(at));
        if (command === "yes" && heardNow.current) return void keepNow.current(heardNow.current);
        if (at === "focus") {
          const { ids, other } = focusFromSpeech(text);
          const was = answersNow.current;
          update({
            answers: {
              ...was,
              focus: [...new Set([...(was.focus ?? []), ...ids])],
              other: other || was.other,
            },
          });
          setHeard(text);
          setStatus(`I heard: ${text}.`);
          return;
        }
        const words =
          at === "name" ? nameFrom(text) : at === "home" ? placeFrom(text) : tidyAnswer(text);
        setHeard(words);
        setStatus(`I heard: ${words || "nothing"}. That’s it, or Fix it?`);
      },
      (problem) => {
        setListening(false);
        stopListening.current = undefined;
        if (problem?.startsWith("Allow microphone")) setMic("denied");
        else if (problem) {
          setNote(problem);
          setStatus(problem);
        }
      },
      voiceSettings().microphone,
      (sound) => {
        const line = sound
          ? "I didn’t catch that. Try again, or type it."
          : "I couldn’t hear anything. Check the microphone, or type it.";
        setNote(line);
        setStatus(line);
      },
    );
  }, [update]);
  const quietDown = useCallback(() => {
    stopListening.current?.();
    stopListening.current = undefined;
    setListening(false);
    stopSpeaking();
  }, []);
  useEffect(() => quietDown, [quietDown]);

  // Each step: say the question (unless asked not to), then listen for the answer. Only a new
  // step starts this; the quiet switch just stops the voice, and never clears an answer in progress.
  useEffect(() => {
    quietDown();
    setHeard(undefined);
    setTyped("");
    setNote("");
    setError("");
    const words = questionFor(step, answers, agent);
    setStatus(words);
    // Keyboard and screen-reader focus land on the question, after the sheet's own focus moves.
    const focus = setTimeout(() => {
      const node = heading.current as unknown as HTMLElement | null;
      if (Platform.OS === "web" && node?.setAttribute) {
        node.setAttribute("tabindex", "-1");
        node.focus({ preventScroll: true });
      }
    }, 0);
    if (step === "hello" || step === "done") return () => clearTimeout(focus);
    let live = true;
    const then = () => {
      if (live && spoken && !quiet && canListen) listen();
    };
    if (!quiet && speechAvailable()) void speak(words).then(then);
    else then();
    return () => {
      live = false;
      clearTimeout(focus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const saveFacts = async (facts: { key: string; value: string }[]) => {
    await api.request<{ facts: PersonaFact[] }>("/api/onboarding/facts", { facts });
  };
  const markDone = useRef(false);
  const finish = async () => {
    if (markDone.current) return;
    markDone.current = true;
    try {
      await api.request("/api/onboarding/done", {});
      void refresh().catch(() => undefined);
    } catch {
      // Not recorded: it would open again next time, so count it like closing part-way.
      markDone.current = false;
      closedPartWay();
    }
  };
  const keepNow = useRef<(value: string) => Promise<void>>(async () => undefined);
  /** Keeps an answer for this step and moves on. An empty answer on a skippable step just moves on. */
  const keep = async (value: string) => {
    const clean = step === "name" ? nameFrom(value) : tidyAnswer(value);
    quietDown();
    setBusy(true);
    setError("");
    try {
      if (step === "name") {
        if (!clean) return setError("A name is the one thing I need.");
        await saveFacts([{ key: "you.name", value: clean }]);
        try {
          globalThis.localStorage?.setItem(NAME_KEY, clean);
        } catch {
          // Home will read it from About you.
        }
        setAnswers({ name: clean });
      } else if (step === "home") {
        if (clean) {
          const { area } = await api.request<{ area?: { label?: string } | null }>("/api/area", {
            place: clean,
          });
          setAnswers({ home: area?.label || clean });
        }
      } else if (step === "work") {
        if (clean) await saveFacts([{ key: "work.occupation", value: clean }]);
        setAnswers({ work: clean || undefined });
      } else if (step === "family") {
        if (clean) await saveFacts([{ key: "household.people", value: clean }]);
        setAnswers({ family: clean || undefined });
      }
      go(stepAfter(step));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save that. Try again.");
    } finally {
      setBusy(false);
    }
  };
  keepNow.current = keep;
  const pause = () => {
    quietDown();
    closedPartWay();
    close();
  };
  const skipAll = async () => {
    quietDown();
    await finish();
    close();
  };

  const question = questionFor(step, answers, agent);
  const header = (
    <View style={{ alignItems: "center", gap: 10 }}>
      {/* Room under his feet for the flames, which hang below the picture's box. */}
      <View style={{ marginBottom: 96 * 0.16 }}>
        <AgentAvatar size={96} mood="idle" flying />
      </View>
      <Text
        ref={heading}
        role="heading"
        aria-level={2}
        style={[s.heading, { fontSize: 22, lineHeight: 28, textAlign: "center" }]}
      >
        {question}
      </Text>
    </View>
  );
  const quietSwitch = (
    <Pressable
      role="switch"
      aria-checked={quiet}
      accessibilityLabel={`Read, don’t speak: ${agent} shows the questions instead of saying them`}
      onPress={() => {
        if (!quiet) quietDown();
        update({ quiet: !quiet });
      }}
      style={({ pressed }) => ({
        alignSelf: "center",
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: 12,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ fontSize: 14, color: colors.blueText, fontWeight: "600" }}>
        {quiet ? "Speak the questions" : "Read, don’t speak"}
      </Text>
    </Pressable>
  );

  // The box people type in, with what was heard shown back above it.
  const typing = (placeholder: string) => (
    <View style={{ gap: 12 }}>
      {heard !== undefined && (
        <View
          style={{
            gap: 8,
            padding: 14,
            borderRadius: 14,
            backgroundColor: colors.subtle,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <Text style={s.small}>I heard</Text>
          <Text style={[s.text, { fontSize: 17, fontWeight: "600" }]}>{heard || "…nothing"}</Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button
              primary
              small
              icon={Check}
              busy={busy}
              disabled={!heard}
              onPress={() => void keep(heard)}
            >
              That’s it
            </Button>
            <Button
              small
              icon={Pencil}
              onPress={() => {
                setTyped(heard);
                setHeard(undefined);
              }}
            >
              Fix it
            </Button>
          </View>
        </View>
      )}
      {mic === "denied" && (
        <Text style={s.muted}>
          I can’t hear you on this device, so type it. You can allow the microphone later in your
          browser’s settings.
        </Text>
      )}
      <View style={[s.row, { gap: 10, alignItems: "center" }]}>
        <TextInput
          value={typed}
          onChangeText={setTyped}
          placeholder={heard === undefined && canListen && !quiet ? "Or type it" : placeholder}
          placeholderTextColor={colors.muted}
          accessibilityLabel={question}
          autoFocus={!canListen || quiet}
          onSubmitEditing={() => void keep(typed)}
          returnKeyType="next"
          style={[s.input, { flex: 1 }]}
        />
        {canListen && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={listening ? "Stop listening" : "Say it"}
            onPress={() => (listening ? quietDown() : listen())}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: listening ? colors.lavender : colors.subtle,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Mic size={20} color={colors.text} />
          </Pressable>
        )}
      </View>
      {listening && (
        <Text style={[s.small, { color: colors.blueText }]} role="status">
          Listening…
        </Text>
      )}
      {!!note && <Text style={s.muted}>{note}</Text>}
      <ErrorNotice error={error} />
    </View>
  );
  // Next and Skip live in the footer, like every other sheet's main action.
  const typingFooter = (skippable: boolean) => (
    <View style={{ gap: 6 }}>
      <Button primary busy={busy} disabled={!typed.trim()} onPress={() => void keep(typed)}>
        Next
      </Button>
      {skippable && (
        <Button
          onPress={() => {
            quietDown();
            go(stepAfter(step));
          }}
        >
          Skip
        </Button>
      )}
    </View>
  );

  let body: ReactNode;
  let footer: ReactNode;
  if (step === "hello") {
    body = (
      <View style={{ gap: 14 }}>
        {header}
        <Text style={[s.text, { textAlign: "center" }]}>
          A couple of minutes, plus a sign-in if you connect your email.{" "}
          {dictationAvailable() ? "Say your answers, or type them." : "You’ll type your answers."}
        </Text>
        {dictationAvailable() && (
          <Text style={[s.muted, { textAlign: "center" }]}>
            Next, your browser may ask to use the microphone. “Don’t allow” is fine: you can type
            instead. “Read, don’t speak” keeps my voice off.
          </Text>
        )}
        {quietSwitch}
      </View>
    );
    footer = (
      <View style={{ gap: 6 }}>
        <Button
          primary
          onPress={() => {
            primeSpeech();
            go(resumeFrom ?? "name");
          }}
        >
          {resumeFrom ? "Carry on where I stopped" : "Let’s go"}
        </Button>
        {resumeFrom ? (
          <Button
            onPress={() => {
              primeSpeech();
              go("name");
            }}
          >
            Start again
          </Button>
        ) : (
          <Button onPress={() => void skipAll()}>Skip setup</Button>
        )}
      </View>
    );
  } else if (step === "name") {
    body = (
      <View style={{ gap: 18 }}>
        {header}
        {typing("Your name")}
      </View>
    );
    footer = typingFooter(false);
  } else if (step === "home") {
    body = (
      <View style={{ gap: 18 }}>
        {header}
        <Text style={[s.muted, { textAlign: "center" }]}>
          Times I give you are already in your time zone; your phone told me that.
        </Text>
        <WhereIAmNow
          onPlace={(place) => {
            setAnswers({ home: place });
            go(stepAfter(step));
          }}
          api={api}
        />
        {typing("Your town")}
        <Text style={s.muted}>
          Just the town. Add a street address on About you if you ever want deliveries or
          directions.
        </Text>
      </View>
    );
    footer = typingFooter(true);
  } else if (step === "work") {
    body = (
      <View style={{ gap: 18 }}>
        {header}
        {typing("What you do")}
      </View>
    );
    footer = typingFooter(true);
  } else if (step === "family") {
    body = (
      <View style={{ gap: 18 }}>
        {header}
        {typing("Who’s in your family")}
      </View>
    );
    footer = typingFooter(true);
  } else if (step === "connect") {
    body = (
      <View style={{ gap: 18 }}>
        {header}
        <Text style={[s.muted, { textAlign: "center" }]}>
          You sign in on Google’s or Microsoft’s own page, which also asks what I may see. I never
          see your password, and nothing is sent, bought or changed without your OK.
        </Text>
        <ConnectRows api={api} />
      </View>
    );
    footer = (
      <View style={{ gap: 6 }}>
        <Button primary onPress={() => go(stepAfter(step))}>
          Next
        </Button>
        <Button onPress={() => go(stepAfter(step))}>Do this later</Button>
      </View>
    );
  } else if (step === "focus") {
    const chosen = answers.focus ?? [];
    const toggle = (id: string) => {
      stopListening.current?.();
      setAnswers({
        focus: chosen.includes(id) ? chosen.filter((f) => f !== id) : [...chosen, id],
      });
    };
    const keepFocus = async () => {
      quietDown();
      const line = focusWords(chosen, answers.other ?? "");
      setBusy(true);
      setError("");
      try {
        if (line) await saveFacts([{ key: "you.focus", value: line }]);
        go(stepAfter(step));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn’t save that. Try again.");
      } finally {
        setBusy(false);
      }
    };
    body = (
      <View style={{ gap: 18 }}>
        {header}
        <Text style={[s.muted, { textAlign: "center" }]}>Tap all that fit, or just tell me.</Text>
        <View style={[s.row, { gap: 8, flexWrap: "wrap", justifyContent: "center" }]}>
          {FOCUS_OPTIONS.map((option) => (
            <Button
              key={option.id}
              small
              icon={chosen.includes(option.id) ? Check : undefined}
              selected={chosen.includes(option.id)}
              primary={chosen.includes(option.id)}
              onPress={() => toggle(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </View>
        {heard !== undefined && (
          <Text style={s.muted}>I heard “{heard}”. Tap anything else that fits.</Text>
        )}
        <View style={[s.row, { gap: 10, alignItems: "center" }]}>
          <TextInput
            value={answers.other ?? ""}
            onChangeText={(text) => setAnswers({ other: text })}
            placeholder="Something else…"
            placeholderTextColor={colors.muted}
            accessibilityLabel="Something else you’d like help with"
            style={[s.input, { flex: 1 }]}
          />
          {canListen && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={listening ? "Stop listening" : "Say it"}
              onPress={() => (listening ? quietDown() : listen())}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: listening ? colors.lavender : colors.subtle,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Mic size={20} color={colors.text} />
            </Pressable>
          )}
        </View>
        {listening && (
          <Text style={[s.small, { color: colors.blueText }]} role="status">
            Listening…
          </Text>
        )}
        {!!note && <Text style={s.muted}>{note}</Text>}
        <ErrorNotice error={error} />
      </View>
    );
    footer = (
      <Button primary busy={busy} onPress={() => void keepFocus()}>
        Next
      </Button>
    );
  } else if (step === "history") {
    body = (
      <View style={{ gap: 18 }}>
        {header}
        <Text style={[s.text, { textAlign: "center" }]}>
          Bring your old chats and memories, and I can search them and pick up your preferences,
          your projects and the people you mention. Ask ChatGPT or Claude for an export, it arrives
          by email, and you upload it on About you, best from a computer.
        </Text>
        <HistorySteps api={api} />
      </View>
    );
    footer = <Button onPress={() => go(stepAfter(step))}>Carry on</Button>;
  } else {
    body = (
      <DoneStep
        agent={agent}
        answers={answers}
        api={api}
        onConnect={() => go("connect")}
        onAboutYou={() => {
          void finish();
          close();
          aboutYou.go();
        }}
        makeRoutine={async () => {
          await mutate("/routines", {
            ...MORNING_BRIEF,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
        }}
        onShown={() => void finish()}
      />
    );
    footer = (
      <View style={{ gap: 6 }}>
        <Button
          primary
          onPress={() => {
            void finish();
            close();
            if (workspace.mode !== "sample") call.start();
            else navigate("chat");
          }}
        >
          Start talking
        </Button>
        <Button
          onPress={() => {
            void finish();
            close();
            navigate("chat");
          }}
        >
          Or type in Chat
        </Button>
      </View>
    );
  }
  return (
    <Sheet
      title={`Set up with ${agent}`}
      subtitle={step === "hello" ? "The first couple of minutes" : stepLabel(step)}
      onClose={step === "done" ? () => void skipAll() : pause}
      closeLabel={step === "done" ? "Done" : "Finish later"}
      onBack={step === "hello" || step === "done" ? undefined : () => go(stepBefore(step))}
      footer={footer}
      narrow
      fill
    >
      {/* Always mounted, so a screen reader hears the question and what was heard. */}
      <Text
        role="status"
        pointerEvents="none"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
      >
        {status}
      </Text>
      {/* Room at the end, so the last row isn't under the footer before scrolling. */}
      <View style={{ gap: 18, paddingBottom: 36 }}>
        {body}
        {step !== "hello" && step !== "done" && (
          <View style={[s.row, { justifyContent: "space-between", alignItems: "center" }]}>
            <Button small onPress={() => go(stepBefore(step))}>
              Back
            </Button>
            {quietSwitch}
          </View>
        )}
      </View>
    </Sheet>
  );
}

/** "Use where I am now": only when the browser already lets this site read the location. */
function WhereIAmNow({
  api,
  onPlace,
}: {
  api: ReturnType<typeof useWorkspace>["api"];
  onPlace: (place: string) => void;
}) {
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (Platform.OS !== "web" || !locationAvailable() || !navigator.permissions?.query) return;
    void navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => setAllowed(status.state === "granted"))
      .catch(() => undefined);
  }, []);
  if (!allowed) return null;
  return (
    <View style={{ gap: 8, alignItems: "center" }}>
      <Button
        small
        busy={busy}
        onPress={() => {
          setBusy(true);
          setError("");
          void currentPosition()
            .then((at) => api.request<{ area?: { label?: string } | null }>("/api/area", at))
            .then(({ area }) => {
              if (!area?.label)
                throw new Error("Couldn’t name your town from there. Type it instead.");
              onPlace(area.label);
            })
            .catch((e) => setError(e instanceof Error ? e.message : "Couldn’t find your town."))
            .finally(() => setBusy(false));
        }}
      >
        Use where I am now
      </Button>
      <ErrorNotice error={error} />
    </View>
  );
}

type Link = "idle" | "opening" | "waiting" | "tried" | "blocked";
/** Gmail, Outlook and Google Calendar: each a row with Connect, that waits while they sign in. */
function ConnectRows({ api }: { api: ReturnType<typeof useWorkspace>["api"] }) {
  const [connected, setConnected] = useState<Record<string, boolean>>();
  const [unavailable, setUnavailable] = useState("");
  const [state, setState] = useState<Record<string, Link>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const check = useCallback(
    () =>
      api
        .request<{ apps: { app: string; connected: boolean }[] }>("/api/apps")
        .then((result) => {
          const map: Record<string, boolean> = {};
          for (const item of result.apps) map[item.app] = item.connected;
          setConnected(map);
          return map;
        })
        .catch((e) => {
          setUnavailable(
            e instanceof Error && /503|set up/i.test(e.message)
              ? "Connecting apps isn’t set up on this server yet. You can carry on."
              : "Couldn’t check your apps right now. You can carry on and connect them later.",
          );
          return {} as Record<string, boolean>;
        }),
    [api],
  );
  useEffect(() => {
    void check();
  }, [check]);
  // Coming back from the sign-in page: see whether it finished.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const back = () => {
      if (document.visibilityState !== "visible") return;
      void check().then((map) =>
        setState((current) => {
          const next = { ...current };
          for (const app of Object.keys(next))
            if (next[app] === "waiting") next[app] = map[app] ? "idle" : "tried";
          return next;
        }),
      );
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [check]);
  const connect = (app: string) => {
    const tab = blankTab();
    setState((c) => ({ ...c, [app]: "opening" }));
    void api
      .request<{ connected: boolean; url?: string }>("/api/apps/connect", { app })
      .then((result) => {
        if (result.connected) {
          tab?.close();
          setState((c) => ({ ...c, [app]: "idle" }));
          return check();
        }
        if (!result.url) throw new Error("No sign-in page came back.");
        setUrls((c) => ({ ...c, [app]: result.url as string }));
        setState((c) => ({
          ...c,
          [app]: openPage(result.url as string, tab) ? "waiting" : "blocked",
        }));
      })
      .catch(() => {
        tab?.close();
        setState((c) => ({ ...c, [app]: "tried" }));
      });
  };
  if (unavailable) return <Text style={s.muted}>{unavailable}</Text>;
  return (
    <View style={{ gap: 2 }}>
      {CONNECT_APPS.map(({ app, name, mark, tint }, index) => {
        const on = connected?.[app] === true;
        const link = state[app] ?? "idle";
        return (
          <View
            key={app}
            style={[
              s.row,
              {
                gap: 12,
                alignItems: "center",
                minHeight: 52,
                borderTopWidth: index ? 1 : 0,
                borderTopColor: colors.line,
              },
            ]}
          >
            <View
              aria-hidden
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: tint,
              }}
            >
              <Text
                style={{ color: "#FFFFFF", fontWeight: "800", fontSize: mark.length > 1 ? 12 : 15 }}
              >
                {mark}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.text, { fontWeight: "600" }]}>{name}</Text>
              {link === "tried" && !on && (
                <Text style={[s.small, { color: colors.mutedStrong }]}>Didn’t finish</Text>
              )}
              {link === "blocked" && !on && (
                <Text style={[s.small, { color: colors.mutedStrong }]}>
                  The sign-in page was blocked
                </Text>
              )}
            </View>
            {connected === undefined ? (
              <ActivityIndicator color={colors.mutedStrong} />
            ) : on ? (
              <View style={[s.row, { gap: 4, alignItems: "center" }]}>
                <Check size={16} color={colors.greenText} />
                <Text style={[s.small, { color: colors.greenText, fontWeight: "600" }]}>
                  Connected
                </Text>
              </View>
            ) : link === "opening" || link === "waiting" ? (
              <Text style={s.small}>{link === "opening" ? "Opening…" : "Signing in…"}</Text>
            ) : link === "blocked" && urls[app] ? (
              <Button small onPress={() => openPage(urls[app] as string)}>
                Open the sign-in page
              </Button>
            ) : (
              <Button
                small
                accessibilityLabel={`${link === "tried" ? "Try again" : "Connect"}: ${name}. Opens ${
                  app === "outlook" ? "Microsoft’s" : "Google’s"
                } sign-in page in a new tab`}
                onPress={() => connect(app)}
              >
                {link === "tried" ? "Try again" : "Connect"}
              </Button>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** "Email me the steps" for bringing ChatGPT or Claude history. */
function HistorySteps({ api }: { api: ReturnType<typeof useWorkspace>["api"] }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  return (
    <View style={{ gap: 10, alignItems: "center" }}>
      {sent ? (
        <Text style={[s.text, { textAlign: "center" }]} role="status">
          Sent to {sent}. Nothing to do here now.
        </Text>
      ) : (
        <Button
          primary
          busy={busy}
          onPress={() => {
            setBusy(true);
            setError("");
            void api
              .request<{ sent: boolean; to: string }>("/api/onboarding/history-steps", {})
              .then((r) => setSent(r.to))
              .catch((e) => setError(e instanceof Error ? e.message : "Couldn’t send the email."))
              .finally(() => setBusy(false));
          }}
        >
          Email me the steps
        </Button>
      )}
      <ErrorNotice error={error} />
    </View>
  );
}

/** The last screen: what's known, and something real from it (today's day, or tomorrow's weather). */
function DoneStep({
  agent,
  answers,
  api,
  onConnect,
  onAboutYou,
  makeRoutine,
  onShown,
}: {
  agent: string;
  answers: SetupAnswers;
  api: ReturnType<typeof useWorkspace>["api"];
  onConnect: () => void;
  onAboutYou: () => void;
  makeRoutine: () => Promise<void>;
  onShown: () => void;
}) {
  const [day, setDay] = useState<AppDay | null>();
  const [weather, setWeather] = useState<WeatherResult>();
  const [calendar, setCalendar] = useState<boolean>();
  const [routine, setRoutine] = useState<"idle" | "busy" | "set" | "failed">("idle");
  useEffect(() => {
    onShown();
    void api
      .request<{ apps: { app: string; connected: boolean }[] }>("/api/apps")
      .then((r) => r.apps.some((a) => a.connected && a.app in CALENDAR_NAMES))
      .catch(() => false)
      .then((has) => {
        setCalendar(has);
        if (has) api.request<AppDay>("/api/calendar/today").then(setDay, () => setDay(null));
        else
          api.request<WeatherResult>("/api/weather").then(setWeather, () => setWeather(undefined));
      });
    // Once, when the step appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const known = knownLine(answers);
  const events = day ? todaysEvents(day.events) : [];
  const tomorrow = weather && "weather" in weather ? weather.weather.days[1] : undefined;
  const place = weather && "weather" in weather ? weather.weather.place : answers.home;
  const card = (title: string, children: ReactNode) => (
    <View
      style={{
        gap: 6,
        padding: 14,
        borderRadius: 14,
        backgroundColor: colors.subtle,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>{title}</Text>
      {children}
    </View>
  );
  const when = (iso: string, allDay: boolean) =>
    allDay
      ? "All day"
      : new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <View style={{ gap: 14 }}>
      <View style={{ alignItems: "center", gap: 10 }}>
        <View style={{ marginBottom: 96 * 0.16 }}>
          <AgentAvatar size={96} mood="celebrate" flying />
        </View>
        <Text
          role="heading"
          aria-level={2}
          style={[s.heading, { fontSize: 22, lineHeight: 28, textAlign: "center" }]}
        >
          {calendar && events.length
            ? `Here’s your day${answers.name ? `, ${answers.name}` : ""}.`
            : questionFor("done", answers, agent)}
        </Text>
      </View>
      {calendar &&
        day !== undefined &&
        card(
          "Today",
          events.length ? (
            events.slice(0, 5).map((event) => (
              <Text key={event.id} style={[s.text, { marginTop: 4 }]}>
                {when(event.start, event.allDay)} · {event.title}
              </Text>
            ))
          ) : (
            <Text style={s.muted}>
              {day
                ? "Nothing on your calendar today. Enjoy it."
                : "I couldn’t read your calendar just now."}
            </Text>
          ),
        )}
      {calendar === undefined && <ActivityIndicator color={colors.mutedStrong} />}
      {card(
        "What I know",
        <>
          <Text style={s.text}>{known || "Not much yet, and that’s fine."}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change any of it on About you. Opens About you"
            onPress={onAboutYou}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ fontSize: 14, color: colors.blueText, fontWeight: "600" }}>
              Change any of it on About you
            </Text>
          </Pressable>
        </>,
      )}
      {calendar === false &&
        card(
          place ? `Tomorrow in ${place}` : "Tomorrow",
          tomorrow ? (
            <>
              <Text style={s.text}>
                {tomorrow.emoji} {tomorrow.sky}
                {tomorrow.high !== undefined ? `, high ${Math.round(tomorrow.high)}°` : ""}
                {tomorrow.low !== undefined ? `, low ${Math.round(tomorrow.low)}°` : ""}.
              </Text>
              <Text style={s.muted}>
                I can tell you this every weekday morning at 7:30, with your day, if you like. It
                comes to Home as an update, and as a notification if you turn those on.
              </Text>
            </>
          ) : (
            <Text style={s.muted}>
              {answers.home
                ? "I don’t have a forecast for there yet (I cover US cities), but I can still brief you every morning."
                : "Tell me your town on About you and I’ll have the weather for you."}
            </Text>
          ),
        )}
      {calendar === false && (
        <View style={[s.row, { gap: 8, flexWrap: "wrap", justifyContent: "center" }]}>
          <Button
            small
            busy={routine === "busy"}
            disabled={routine === "set"}
            icon={routine === "set" ? Check : Sparkles}
            onPress={() => {
              setRoutine("busy");
              void makeRoutine()
                .then(() => setRoutine("set"))
                .catch(() => setRoutine("failed"));
            }}
          >
            {routine === "set" ? "Set: weekdays at 7:30 am" : "Yes, weekdays at 7:30 am"}
          </Button>
          <Button small onPress={onConnect}>
            Connect my calendar
          </Button>
        </View>
      )}
      {routine === "failed" && <ErrorNotice error="Couldn’t set that up. You can ask me later." />}
      <Text style={[s.muted, { textAlign: "center" }]}>
        Try me: “
        {calendar && events.length
          ? "What’s on my calendar tomorrow?"
          : tomorrow
            ? "What’s the weather this weekend?"
            : "What can you help me with?"}
        ”
      </Text>
    </View>
  );
}
