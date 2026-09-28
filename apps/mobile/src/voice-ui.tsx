import { Mic } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, CheckRow, colors, ErrorNotice, SectionHeading, s } from "./ui";
import {
  listVoices,
  primeSpeech,
  speak,
  speechAvailable,
  stopSpeaking,
  updateVoiceSettings,
  useVoiceSettings,
  type VoiceOption,
  voiceSettings,
} from "./voice";
import { dictate, dictationAvailable, isIos, microphones } from "./web-app";

/** "Say it" for an answer box: what's heard is added to the box, to check before sending. */
export function DictateButton({
  onText,
  label = "Say it",
}: {
  onText: (text: string) => void;
  label?: string;
}) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const stop = useRef<() => void>(undefined);
  useEffect(() => () => stop.current?.(), []);
  if (!dictationAvailable()) return null;
  return (
    <View style={{ gap: 6 }}>
      <Button
        small
        icon={Mic}
        style={{
          alignSelf: "flex-start",
          ...(listening ? { backgroundColor: colors.lavender } : {}),
        }}
        onPress={() => {
          if (listening) return stop.current?.();
          setError("");
          setListening(true);
          stop.current = dictate(
            onText,
            (problem) => {
              setListening(false);
              stop.current = undefined;
              if (problem) setError(problem);
            },
            voiceSettings().microphone,
          );
        }}
      >
        {listening ? "Listening… tap to stop" : label}
      </Button>
      <ErrorNotice error={error} />
    </View>
  );
}

const SPEEDS = [
  { label: "Slower", rate: 0.85 },
  { label: "Normal", rate: 1 },
  { label: "Faster", rate: 1.2 },
];

/** How your agent sounds on this device: read-aloud, voice and speed. */
export function VoiceCard({ name }: { name: string }) {
  const settings = useVoiceSettings();
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [mics, setMics] = useState<{ id: string; name: string; named: boolean }[]>([]);
  const [micError, setMicError] = useState("");
  useEffect(() => {
    void listVoices().then(setVoices);
    if (dictationAvailable()) void microphones().then(setMics, () => undefined);
    return () => stopSpeaking();
  }, []);
  async function showMicrophones() {
    setMicError("");
    try {
      setMics(await microphones(true));
    } catch {
      setMicError("Allow microphone access in your browser to choose one.");
    }
  }
  if (!speechAvailable()) return null;
  const chosen = voices.find((v) => v.id === settings.voice) ?? voices[0];
  const preview = (voice?: string, rate?: number) => {
    primeSpeech();
    void speak(`Hi, I'm ${name}. This is how I'll sound when I read my replies to you.`, {
      voice,
      rate,
    });
  };
  const shown = showAll ? voices : voices.slice(0, 6);
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="Voice" />
      <Text style={s.muted}>
        {dictationAvailable()
          ? "Tap the sound-wave button next to the message box to talk with your agent hands-free. Tap Interrupt, or press Esc on a computer, to cut in while it's talking. Tap Listen under any reply to hear it."
          : "Tap Listen under any reply to hear it."}
      </Text>
      <CheckRow
        checked={settings.readAloud}
        label="Read every reply aloud"
        onPress={() => {
          primeSpeech();
          updateVoiceSettings({ readAloud: !settings.readAloud });
        }}
      />
      <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>Speed</Text>
      <View style={[s.row, { gap: 8 }]}>
        {SPEEDS.map((speed) => (
          <Button
            key={speed.label}
            small
            primary={settings.rate === speed.rate}
            onPress={() => {
              updateVoiceSettings({ rate: speed.rate });
              preview(chosen?.id, speed.rate);
            }}
          >
            {speed.label}
          </Button>
        ))}
      </View>
      {voices.length > 0 && (
        <>
          <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>Voice</Text>
          {shown.map((voice) => (
            <Pressable
              key={voice.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: chosen?.id === voice.id }}
              onPress={() => {
                updateVoiceSettings({ voice: voice.id });
                preview(voice.id);
              }}
              style={({ pressed }) => [
                s.row,
                {
                  gap: 10,
                  paddingVertical: 9,
                  paddingHorizontal: 12,
                  borderRadius: 14,
                  backgroundColor:
                    chosen?.id === voice.id ? colors.sky : pressed ? colors.subtle : "transparent",
                },
              ]}
            >
              <Text style={[s.text, { flex: 1 }]} numberOfLines={1}>
                {voice.name}
              </Text>
              <Text style={s.small}>{voice.lang}</Text>
            </Pressable>
          ))}
          {voices.length > 6 && (
            <Button small onPress={() => setShowAll(!showAll)}>
              {showAll ? "Fewer voices" : `All ${voices.length} voices`}
            </Button>
          )}
        </>
      )}
      {dictationAvailable() && (
        <>
          <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>Microphone</Text>
          {[{ id: "", name: "Device default", named: true }, ...mics].map((mic) => (
            <Pressable
              key={mic.id || "default"}
              accessibilityRole="radio"
              accessibilityState={{ checked: (settings.microphone ?? "") === mic.id }}
              onPress={() => updateVoiceSettings({ microphone: mic.id || undefined })}
              style={({ pressed }) => [
                s.row,
                {
                  paddingVertical: 9,
                  paddingHorizontal: 12,
                  borderRadius: 14,
                  backgroundColor:
                    (settings.microphone ?? "") === mic.id
                      ? colors.sky
                      : pressed
                        ? colors.subtle
                        : "transparent",
                },
              ]}
            >
              <Text style={[s.text, { flex: 1 }]} numberOfLines={1}>
                {mic.name}
              </Text>
            </Pressable>
          ))}
          {!mics.some((mic) => mic.named) && (
            <Button small onPress={() => void showMicrophones()}>
              Show my microphones
            </Button>
          )}
          <ErrorNotice error={micError} />
          <Text style={s.small}>
            If this browser can't switch microphones for voice input, it uses the device default
            {isIos() ? "." : " (on Windows: Settings → System → Sound → Input)."}
          </Text>
        </>
      )}
      <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>Speaker</Text>
      <Text style={s.small}>
        {isIos()
          ? "Replies play through the iPhone's current audio output, such as its speaker, AirPods or a car."
          : "Browsers play spoken replies through the device's default speaker. On Windows, pick it in Settings → System → Sound → Output, or give your browser its own speaker under Volume mixer."}
      </Text>
      <Text style={s.small}>
        {isIos()
          ? "Voices come from this iPhone. For more natural ones, download an Enhanced or Premium voice in Settings → Accessibility → Spoken Content → Voices."
          : "Voices come from this device and browser. Voices marked Natural or Online sound the most lifelike; Microsoft Edge has many."}
      </Text>
    </Card>
  );
}
