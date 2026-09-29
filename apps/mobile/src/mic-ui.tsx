import { ChevronUp, MicOff, X } from "lucide-react-native";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, colors, ErrorNotice, IconButton, Sheet, s } from "./ui";
import { updateVoiceSettings, useVoiceSettings, voiceSettings } from "./voice";
import { microphoneName, SPEAKING_LEVEL, watchMicrophones } from "./web-app";

/**
 * Choosing the microphone right next to the mic button, with live bars that show which one hears
 * you, and a note when voice input heard nothing.
 */

interface Silence {
  /** The microphone picked up sound, so the words were lost somewhere else. */
  sound: boolean;
  /** The chosen microphone's id; "" for whatever the computer uses. */
  mic: string;
}
let state: { open: boolean; silence?: Silence } = { open: false };
const listeners = new Set<() => void>();
const set = (next: typeof state) => {
  state = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const useMicState = () =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
export const openMicPicker = () => set({ open: true });
/** Voice input ended without words; `sound` says whether the microphone heard anything. */
export const reportSilence = (sound: boolean) =>
  set({ ...state, silence: { sound, mic: voiceSettings().microphone ?? "" } });
export const clearSilence = () => {
  if (state.silence) set({ ...state, silence: undefined });
};

/** The small arrow beside the mic button that opens the choice of microphone. */
export function MicChooserButton() {
  const settings = useVoiceSettings();
  const [name, setName] = useState<string>();
  useEffect(() => {
    void microphoneName(settings.microphone).then(setName, () => undefined);
  }, [settings.microphone]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name ? `Choose a microphone, now using ${name}` : "Choose a microphone"}
      onPress={openMicPicker}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.sky : "transparent",
      })}
    >
      <ChevronUp size={17} strokeWidth={2.2} color={colors.muted} />
    </Pressable>
  );
}

/** Five bars that light up with the microphone's level. */
function LevelBars({ level }: { level: number }) {
  const steps = [0.008, 0.016, 0.03, 0.05, 0.08];
  return (
    <View accessible={false} style={[s.row, { gap: 3, alignItems: "flex-end", height: 22 }]}>
      {steps.map((step, i) => (
        <View
          key={step}
          style={{
            width: 4,
            height: 8 + i * 3.5,
            borderRadius: 2,
            backgroundColor: level >= step ? colors.greenDark : colors.muted,
            opacity: level >= step ? 1 : 0.3,
          }}
        />
      ))}
    </View>
  );
}

function MicPicker({ onClose }: { onClose: () => void }) {
  const settings = useVoiceSettings();
  const chosen = settings.microphone ?? "";
  const [mics, setMics] = useState<{ id: string; name: string }[]>();
  const [levels, setLevels] = useState<Record<string, number>>({});
  // A microphone "hears you" for a moment after its level last went past talking loudness.
  const heardAt = useRef<Record<string, number>>({});
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    setError("");
    watchMicrophones((next) => {
      const now = Date.now();
      for (const [id, level] of Object.entries(next))
        if (level >= SPEAKING_LEVEL) heardAt.current[id] = now;
      setLevels(next);
    }).then(
      (watching) => {
        if (cancelled) return watching.stop();
        stop = watching.stop;
        setMics(watching.mics);
      },
      () => {
        if (!cancelled)
          setError(
            "Microphone access is blocked. Select the icon beside the web address, allow the microphone, then choose “Try again”.",
          );
      },
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [attempt]);
  const rows = [
    { id: "", name: "Same as my computer", note: "Your computer's choice" },
    ...(mics ?? []).map((mic) => ({ ...mic, note: "" })),
  ];
  return (
    <Sheet
      title="Microphone"
      subtitle="Say something. The bars move next to each microphone that hears you."
      onClose={onClose}
    >
      <View accessibilityRole="radiogroup" accessibilityLabel="Microphone" style={{ gap: 4 }}>
        {!mics && !error && <Text style={s.muted}>Looking for your microphones…</Text>}
        {mics &&
          rows.map((mic) => {
            const selected = chosen === mic.id;
            const hears = Date.now() - (heardAt.current[mic.id] ?? 0) < 1500;
            return (
              <Pressable
                key={mic.id || "default"}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${mic.name}${hears ? ", hears you" : ""}`}
                onPress={() => {
                  updateVoiceSettings({ microphone: mic.id || undefined });
                  clearSilence();
                }}
                style={({ pressed }) => [
                  s.row,
                  {
                    gap: 12,
                    minHeight: 56,
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    borderRadius: 16,
                    backgroundColor: selected
                      ? colors.sky
                      : pressed
                        ? colors.subtle
                        : "transparent",
                  },
                ]}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: selected ? colors.blueDark : colors.muted,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {selected && (
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: colors.blueDark,
                      }}
                    />
                  )}
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={[s.text, { fontWeight: "600" }]} numberOfLines={1}>
                    {mic.name}
                  </Text>
                  <Text
                    style={[
                      s.muted,
                      { fontSize: 13 },
                      hears && { color: colors.text, fontWeight: "600" },
                    ]}
                  >
                    {hears ? "Hears you" : mic.note || "No sound"}
                    {selected ? " · in use" : ""}
                  </Text>
                </View>
                <LevelBars level={levels[mic.id] ?? 0} />
              </Pressable>
            );
          })}
      </View>
      {!!error && (
        <View style={{ gap: 10, marginTop: 8 }}>
          <ErrorNotice error={error} />
          <Button onPress={() => setAttempt((n) => n + 1)}>Try again</Button>
        </View>
      )}
      <Button primary onPress={onClose} style={{ marginTop: 16 }}>
        Done
      </Button>
    </Sheet>
  );
}

/** Above the message box: what went wrong when voice input heard nothing, and the picker. */
export function MicHelp() {
  const { open, silence } = useMicState();
  const [name, setName] = useState<string>();
  useEffect(() => {
    setName(undefined);
    if (silence) void microphoneName(silence.mic).then(setName, () => setName(undefined));
  }, [silence]);
  const mic = name ?? "your microphone";
  const note = !silence
    ? undefined
    : !silence.sound
      ? {
          title: `Didn't hear anything from ${mic}.`,
          body: "Choose the microphone you're using. Its bars move when you talk.",
        }
      : silence.mic
        ? {
            title: `${name ?? "That microphone"} picked up sound, but no words came through.`,
            body: "This browser may only listen to your computer's default microphone. Choose “Same as my computer”, or make this one the default in your sound settings.",
          }
        : {
            title: "Heard you, but couldn't make out the words.",
            body: "Try again a little closer to the microphone, or choose another one.",
          };
  return (
    <>
      {note && (
        <View
          accessibilityRole="alert"
          style={{
            backgroundColor: colors.orange,
            borderRadius: 22,
            padding: 14,
            gap: 10,
            marginBottom: 10,
          }}
        >
          <View style={[s.row, { gap: 12, alignItems: "flex-start" }]}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: colors.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MicOff size={18} color={colors.text} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[s.text, { fontWeight: "600" }]}>{note.title}</Text>
              <Text style={s.text}>{note.body}</Text>
            </View>
            <IconButton icon={X} label="Dismiss" onPress={clearSilence} />
          </View>
          <View style={[s.row, { gap: 8, flexWrap: "wrap", paddingLeft: 48 }]}>
            <Button primary onPress={openMicPicker}>
              Choose a microphone
            </Button>
          </View>
        </View>
      )}
      {open && <MicPicker onClose={() => set({ open: false, silence: state.silence })} />}
    </>
  );
}
