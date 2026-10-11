import { Check, Play, Square } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { Button, Card, CheckRow, ErrorNotice, IconButton, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

interface CallVoice {
  id: string;
  description: string;
}
interface CallVoiceView {
  onNewVoice: boolean;
  voices: CallVoice[];
  chosen: string;
}

/** Remembered on this device, so the card is there from the start instead of popping in. */
const KEPT = "openmuse.call-voices";
function kept(): CallVoiceView | undefined {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(KEPT) ?? "null");
    return saved && Array.isArray(saved.voices) ? saved : undefined;
  } catch {
    return undefined;
  }
}
function keep(view: CallVoiceView) {
  try {
    globalThis.localStorage?.setItem(KEPT, JSON.stringify(view));
  } catch {
    // Private browsing: the card waits for the server, and that's all.
  }
}

const canPlay = () => typeof globalThis.Audio === "function";

/** Plays each voice's short hello (fetched once, then kept for this screen). */
function useSamples() {
  const { api } = useWorkspace();
  const [playing, setPlaying] = useState("");
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(undefined);
  const urls = useRef(new Map<string, string>());
  useEffect(() => {
    const made = urls.current;
    return () => {
      audio.current?.pause();
      for (const url of made.values()) URL.revokeObjectURL(url);
    };
  }, []);
  function stop() {
    audio.current?.pause();
    audio.current = undefined;
    setPlaying("");
  }
  async function play(voice: string) {
    stop();
    setError("");
    setPlaying(voice);
    try {
      let url = urls.current.get(voice);
      if (!url) {
        const response = await fetch(api.url(`/api/call-voices/${voice}/sample`), {
          headers: { Authorization: `Bearer ${api.token}` },
        });
        if (!response.ok) throw new Error();
        url = URL.createObjectURL(await response.blob());
        urls.current.set(voice, url);
      }
      const sound = new Audio(url);
      audio.current = sound;
      sound.onended = () => {
        if (audio.current === sound) setPlaying("");
      };
      await sound.play();
    } catch {
      setPlaying("");
      setError(`${voice}’s sample couldn’t be played just now.`);
    }
  }
  return { playing, error, setError, play, stop };
}

/** The voices to choose from, each with Play; choosing saves it (and plays its hello). */
function VoiceRows({
  name,
  voices,
  initial,
  single = false,
}: {
  name: string;
  voices: CallVoice[];
  initial: string;
  /** One voice (asked about in the chat): a Choose button instead of a lone radio. */
  single?: boolean;
}) {
  const { api } = useWorkspace();
  const samples = useSamples();
  const [chosen, setChosen] = useState(initial);
  const [news, setNews] = useState("");
  useEffect(() => setChosen(initial), [initial]);
  async function choose(voice: string) {
    if (voice === chosen) return;
    const before = chosen;
    samples.setError("");
    setChosen(voice);
    if (canPlay()) void samples.play(voice);
    try {
      const result = await api.request<{ voice: string; onCallNow: boolean }>(
        "/api/call-voices",
        { voice },
        "PUT",
      );
      const saved = kept();
      if (saved) keep({ ...saved, chosen: result.voice });
      setNews(
        result.onCallNow
          ? `Saved. ${name} now speaks as ${result.voice} on this call.`
          : `Saved. ${name} speaks as ${result.voice} on your next call.`,
      );
    } catch (problem) {
      setChosen(before);
      samples.setError((problem as Error).message);
    }
  }
  const play = (voice: CallVoice) =>
    canPlay() && (
      <IconButton
        tinted
        icon={samples.playing === voice.id ? Square : Play}
        label={samples.playing === voice.id ? `Stop ${voice.id}` : `Play ${voice.id}`}
        onPress={() =>
          samples.playing === voice.id ? samples.stop() : void samples.play(voice.id)
        }
      />
    );
  const status = (
    <>
      <ErrorNotice error={samples.error} />
      <Text
        role="status"
        style={
          news
            ? [s.small, { marginTop: 4 }]
            : { position: "absolute", width: 1, height: 1, opacity: 0 }
        }
        pointerEvents="none"
      >
        {news}
      </Text>
    </>
  );
  const [only] = voices;
  if (single && only)
    return (
      <>
        <View style={[s.row, { gap: 8, alignItems: "center" }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.text}>{only.id}</Text>
            <Text style={s.muted}>{only.description}</Text>
          </View>
          <Button
            icon={chosen === only.id ? Check : undefined}
            selected={chosen === only.id}
            disabled={chosen === only.id}
            onPress={() => void choose(only.id)}
          >
            {chosen === only.id ? "Chosen" : "Choose"}
          </Button>
          {play(only)}
        </View>
        {status}
      </>
    );
  return (
    <>
      <View role="radiogroup" aria-label="Voice on live calls">
        {voices.map((voice) => (
          <View key={voice.id} style={[s.row, { gap: 6, alignItems: "center" }]}>
            <View style={{ flex: 1 }}>
              <CheckRow
                radio
                checked={chosen === voice.id}
                label={voice.id}
                detail={voice.description}
                onPress={() => void choose(voice.id)}
              />
            </View>
            {play(voice)}
          </View>
        ))}
      </View>
      {status}
    </>
  );
}

/** Which voice the agent speaks with on live calls (the new voice), with a sample of each. */
export function CallVoiceCard({ name }: { name: string }) {
  const { api } = useWorkspace();
  const [view, setView] = useState<CallVoiceView | undefined>(kept);
  useEffect(() => {
    void api.request<CallVoiceView>("/api/call-voices").then(
      (next) => {
        setView(next);
        keep(next);
      },
      () => undefined,
    );
  }, [api]);
  if (!view?.onNewVoice || view.voices.length < 2) return null;
  const other = view.voices.find((voice) => voice.id !== view.chosen)?.id;
  return (
    <Card style={{ gap: 4 }}>
      <SectionHeading title="Voice on live calls" />
      <Text style={[s.muted, { marginBottom: 6 }]}>
        {`How ${name} sounds when you talk live. Choosing a voice plays a short hello. Or say “Switch to ${other}” during a call to hear it straight away.`}
      </Text>
      <VoiceRows name={name} voices={view.voices} initial={view.chosen} />
    </Card>
  );
}

/**
 * In the chat, when they ask about the voices ("Let me hear Theodore"): the voices named, each
 * with Play and a choice, so hearing one never needs a trip to Apps.
 */
export function CallVoiceToolCard({ result, loading }: { result: unknown; loading: boolean }) {
  const { data } = useAgentWorkspace();
  const name = data?.identity.name || "Neddy";
  if (loading) return null;
  // The chat passes the tool's result as JSON text.
  let raw = result;
  if (typeof raw === "string")
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<CallVoiceView> & { voice?: string; sounds?: string };
  // A list (all of them, or the ones asked about), or the one just chosen.
  const voices: CallVoice[] = Array.isArray(value.voices)
    ? value.voices.filter((v) => typeof v?.id === "string")
    : typeof value.voice === "string"
      ? [{ id: value.voice, description: value.sounds ?? "" }]
      : [];
  if (!voices.length) return null;
  const chosen = typeof value.chosen === "string" ? value.chosen : (value.voice ?? "");
  return (
    <Card style={{ gap: 4, maxWidth: 520 }}>
      <SectionHeading title={voices.length > 1 ? "Voices on live calls" : "Voice on live calls"} />
      <VoiceRows name={name} voices={voices} initial={chosen} single={voices.length === 1} />
    </Card>
  );
}
