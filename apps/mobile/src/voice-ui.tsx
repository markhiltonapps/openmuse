import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, CheckRow, colors, SectionHeading, s } from "./ui";
import {
  listVoices,
  primeSpeech,
  speak,
  speechAvailable,
  stopSpeaking,
  updateVoiceSettings,
  useVoiceSettings,
  type VoiceOption,
} from "./voice";
import { dictationAvailable, isIos } from "./web-app";

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
  useEffect(() => {
    void listVoices().then(setVoices);
    return () => stopSpeaking();
  }, []);
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
          ? "Tap the sound-wave button next to the message box to talk with your agent hands-free. Tap Listen under any reply to hear it."
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
                    chosen?.id === voice.id ? colors.sky : pressed ? "#F3F5F6" : "transparent",
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
      <Text style={s.small}>
        {isIos()
          ? "Voices come from this iPhone. For more natural ones, download an Enhanced or Premium voice in Settings → Accessibility → Spoken Content → Voices."
          : "Voices come from this device and browser. Voices marked Natural or Online sound the most lifelike; Microsoft Edge has many."}
      </Text>
    </Card>
  );
}
