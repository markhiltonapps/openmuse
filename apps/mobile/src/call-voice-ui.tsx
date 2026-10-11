import { AudioLines, Check, Play, Square } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import {
  Button,
  Card,
  CheckRow,
  colors,
  ErrorNotice,
  Field,
  IconButton,
  SectionHeading,
  Sheet,
  s,
} from "./ui";
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
  /** A voice's hello, or ("listening") the murmurs calls make while listening (the admin's). */
  async function play(voice: string, kind: "sample" | "listening" = "sample") {
    const key = kind === "sample" ? voice : `${kind}:${voice}`;
    stop();
    setError("");
    setPlaying(key);
    try {
      let url = urls.current.get(key);
      if (!url) {
        const response = await fetch(api.url(`/api/call-voices/${voice}/${kind}`), {
          headers: { Authorization: `Bearer ${api.token}` },
        });
        if (!response.ok) throw new Error();
        url = URL.createObjectURL(await response.blob());
        urls.current.set(key, url);
      }
      const sound = new Audio(url);
      audio.current = sound;
      sound.onended = () => {
        if (audio.current === sound) setPlaying("");
      };
      await sound.play();
    } catch {
      setPlaying("");
      setError(
        kind === "sample"
          ? `${voice}’s sample couldn’t be played just now.`
          : "The listening sounds couldn’t be played just now.",
      );
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

interface BrowseVoice extends CallVoice {
  onList: boolean;
}

/** Whether the person signed in is the admin (only they see the browser); unknown until asked. */
function useIsAdmin() {
  const { api } = useWorkspace();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    void api.request<{ role?: string }>("/api/me").then(
      (me) => setAdmin(me.role === "admin"),
      () => undefined,
    );
  }, [api]);
  return admin;
}

/** Every word looked for is in the voice's name or description ("british man"). */
function matches(voice: CallVoice, query: string) {
  const text = ` ${voice.id} ${voice.description} `.toLowerCase();
  return query
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !["a", "an", "the", "voice", "voices", "with"].includes(w))
    .every((w) =>
      // Ours say "a man's/woman's voice", Inworld's "male/female": either finds both, and
      // "man" mustn't find every "woman" or "female".
      ["woman", "women", "female", "girl"].includes(w)
        ? /\bwom[ae]n\b|\bfemale\b|\bgirl\b/.test(text)
        : ["man", "men", "male", "guy"].includes(w)
          ? /[^o]man\b|\bmale\b|\bmen\b/.test(text)
          : text.includes(w),
    );
}

/** Inworld's voices with Play, and Add or Remove for the list everyone chooses from. */
function BrowseRows({
  voices,
  usual,
  onChanged,
}: {
  voices: BrowseVoice[];
  usual: string;
  onChanged?: (voice: string, onList: boolean) => void;
}) {
  const { api } = useWorkspace();
  const samples = useSamples();
  const [listed, setListed] = useState(
    () => new Set(voices.filter((v) => v.onList).map((v) => v.id)),
  );
  const [busy, setBusy] = useState("");
  const [news, setNews] = useState("");
  // Only when the server's answer changes (a new search gives a new array of the same voices).
  const given = voices.map((v) => `${v.id}:${v.onList}`).join(",");
  useEffect(() => {
    setListed(
      new Set(
        given
          .split(",")
          .filter((v) => v.endsWith(":true"))
          .map((v) => v.slice(0, -5)),
      ),
    );
  }, [given]);
  // The last change, so it can be undone from the status line.
  const [last, setLast] = useState<{ voice: string; added: boolean }>();
  async function edit(voice: string, add: boolean) {
    setBusy(voice);
    samples.setError("");
    try {
      // From here a removal is plain to see and undoable, so it doesn't ask first.
      const result = await api.request<{ movedBack?: number; usual?: string }>(
        "/api/call-voices/list",
        add ? { add: voice } : { remove: voice, confirm: true },
      );
      setListed((was) => {
        const next = new Set(was);
        if (add) next.add(voice);
        else next.delete(voice);
        return next;
      });
      const moved = result.movedBack ?? 0;
      setNews(
        add
          ? `Added ${voice}. Everyone can choose it now.`
          : moved
            ? `Removed ${voice}. ${moved === 1 ? "1 person was" : `${moved} people were`} using it; they’re back on ${result.usual} from their next call.`
            : `Removed ${voice} from the list.`,
      );
      setLast({ voice, added: add });
      onChanged?.(voice, add);
    } catch (problem) {
      samples.setError((problem as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      {/* Above the rows, so it's seen whichever row was tapped. */}
      <View style={[s.row, { gap: 8, alignItems: "center" }]}>
        <Text
          role="status"
          style={
            news
              ? [s.small, { flex: 1 }]
              : { position: "absolute", width: 1, height: 1, opacity: 0 }
          }
          pointerEvents="none"
        >
          {news}
        </Text>
        {news && last ? (
          <Button
            small
            busy={busy === last.voice}
            accessibilityLabel={
              last.added ? `Undo: remove ${last.voice}` : `Undo: add ${last.voice} back`
            }
            onPress={() => {
              const undo = last;
              setLast(undefined);
              void edit(undo.voice, !undo.added).then(() => setLast(undefined));
            }}
          >
            Undo
          </Button>
        ) : null}
      </View>
      <ErrorNotice error={samples.error} />
      {voices.map((voice) => {
        const on = listed.has(voice.id);
        return (
          <View
            key={voice.id}
            style={[s.row, { gap: 8, alignItems: "center", paddingVertical: 6 }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <View style={[s.row, { gap: 8, alignItems: "center", flexWrap: "wrap" }]}>
                <Text style={s.text}>{voice.id}</Text>
                {on || voice.id === usual ? (
                  <View
                    style={[
                      s.row,
                      {
                        gap: 4,
                        alignItems: "center",
                        backgroundColor: colors.green,
                        borderRadius: 999,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                      },
                    ]}
                  >
                    <Check size={12} color={colors.greenText} />
                    <Text style={[s.small, { color: colors.greenText, fontWeight: "600" }]}>
                      {voice.id === usual ? "Usual voice" : "On the list"}
                    </Text>
                  </View>
                ) : null}
              </View>
              {voice.description ? <Text style={s.muted}>{voice.description}</Text> : null}
            </View>
            {voice.id === usual ? null : (
              <Button
                busy={busy === voice.id}
                accessibilityLabel={
                  on ? `Remove ${voice.id} from the list` : `Add ${voice.id} to the list`
                }
                onPress={() => void edit(voice.id, !on)}
              >
                {on ? "Remove" : "Add"}
              </Button>
            )}
            {canPlay() && (
              <IconButton
                tinted
                icon={samples.playing === voice.id ? Square : Play}
                label={samples.playing === voice.id ? `Stop ${voice.id}` : `Play ${voice.id}`}
                onPress={() =>
                  samples.playing === voice.id ? samples.stop() : void samples.play(voice.id)
                }
              />
            )}
          </View>
        );
      })}
    </>
  );
}

/** The murmurs calls make while listening, in one voice, with Play (the admin's). */
function ListeningRow({ name, voice }: { name: string; voice: string }) {
  const samples = useSamples();
  const key = `listening:${voice}`;
  return (
    <View style={{ gap: 6 }}>
      <View style={[s.row, { gap: 8, alignItems: "center" }]}>
        <Text style={[s.muted, { flex: 1 }]}>
          {`The soft “mm-hmm” ${name} makes while you talk, in ${voice}’s voice.`}
        </Text>
        {canPlay() && (
          <IconButton
            tinted
            icon={samples.playing === key ? Square : AudioLines}
            label={
              samples.playing === key ? "Stop the listening sounds" : "Play the listening sounds"
            }
            onPress={() =>
              samples.playing === key ? samples.stop() : void samples.play(voice, "listening")
            }
          />
        )}
      </View>
      <ErrorNotice error={samples.error} />
    </View>
  );
}

/**
 * The admin's browser: every English voice Inworld has, to hear and add to the list everyone
 * chooses from; and the murmurs calls make while listening, to hear how they sound.
 */
function VoiceBrowser({
  name,
  chosen,
  onClose,
  onChanged,
}: {
  name: string;
  chosen: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { api } = useWorkspace();
  const [all, setAll] = useState<{ usual: string; voices: BrowseVoice[] }>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void api
      .request<{ usual: string; voices: BrowseVoice[] }>("/api/call-voices/all")
      .then(setAll, (problem: Error) => setError(problem.message));
  }, [api]);
  const shown = all?.voices.filter((voice) => matches(voice, query)) ?? [];
  return (
    <Sheet
      title="All Inworld voices"
      subtitle="Play any voice. Add puts it on the list everyone chooses from."
      onClose={onClose}
      fill
    >
      <View style={{ gap: 6, marginBottom: 12 }}>
        <Text style={[s.small, { fontWeight: "600" }]}>Listening sounds</Text>
        <ListeningRow name={name} voice={chosen} />
      </View>
      <Field
        label="Find a voice"
        placeholder="A name, or words like “british man”"
        value={query}
        onChangeText={setQuery}
      />
      <ErrorNotice error={error} />
      {all && (
        <Text style={[s.small, { marginVertical: 8 }]}>
          {query ? `${shown.length} of ${all.voices.length} voices` : `${all.voices.length} voices`}
        </Text>
      )}
      {!all && !error ? <Text style={s.muted}>Loading Inworld’s voices…</Text> : null}
      {all && (
        <BrowseRows
          voices={shown}
          usual={all.usual}
          onChanged={(voice, on) => {
            setAll(
              (was) =>
                was && {
                  ...was,
                  voices: was.voices.map((v) => (v.id === voice ? { ...v, onList: on } : v)),
                },
            );
            onChanged();
          }}
        />
      )}
    </Sheet>
  );
}

/** Which voice the agent speaks with on live calls (the new voice), with a sample of each. */
export function CallVoiceCard({ name }: { name: string }) {
  const { api } = useWorkspace();
  const admin = useIsAdmin();
  const [view, setView] = useState<CallVoiceView | undefined>(kept);
  const [browsing, setBrowsing] = useState(false);
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    void loads;
    void api.request<CallVoiceView>("/api/call-voices").then(
      (next) => {
        setView(next);
        keep(next);
      },
      () => undefined,
    );
  }, [api, loads]);
  if (!view?.onNewVoice || view.voices.length < 2) return null;
  const other = view.voices.find((voice) => voice.id !== view.chosen)?.id;
  return (
    <Card style={{ gap: 4 }}>
      <SectionHeading title="Voice on live calls" />
      <Text style={[s.muted, { marginBottom: 6 }]}>
        {`How ${name} sounds when you talk live. Choosing a voice plays a short hello. Or say “Switch to ${other}” during a call to hear it straight away.`}
      </Text>
      <VoiceRows name={name} voices={view.voices} initial={view.chosen} />
      {admin && (
        <Button style={{ alignSelf: "flex-start", marginTop: 8 }} onPress={() => setBrowsing(true)}>
          All Inworld voices
        </Button>
      )}
      {browsing && (
        <VoiceBrowser
          name={name}
          chosen={view.chosen}
          onClose={() => setBrowsing(false)}
          onChanged={() => setLoads((n) => n + 1)}
        />
      )}
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
  const value = raw as Partial<CallVoiceView> & {
    voice?: string;
    sounds?: string;
    browse?: boolean;
    usual?: string;
    matched?: number;
    added?: boolean;
    description?: string;
    listening?: boolean;
  };
  // The admin added or removed a voice: just that voice, with Play and the way back.
  if (typeof value.added === "boolean" && typeof value.voice === "string") {
    return (
      <Card style={{ gap: 4, maxWidth: 520 }}>
        <SectionHeading title="Inworld voices" />
        <BrowseRows
          voices={[{ id: value.voice, description: value.description ?? "", onList: value.added }]}
          usual={value.usual ?? ""}
        />
      </Card>
    );
  }
  // The admin asked to hear the listening sounds.
  if (value.listening && typeof value.voice === "string") {
    return (
      <Card style={{ gap: 4, maxWidth: 520 }}>
        <SectionHeading title="Listening sounds" />
        <ListeningRow name={name} voice={value.voice} />
      </Card>
    );
  }
  // The admin browsing Inworld's voices: each with Play, and Add or Remove.
  if (value.browse && Array.isArray(value.voices)) {
    const found = (value.voices as BrowseVoice[]).filter((v) => typeof v?.id === "string");
    if (!found.length) return null;
    return (
      <Card style={{ gap: 4, maxWidth: 520 }}>
        <SectionHeading title="Inworld voices" />
        {value.matched && value.matched > found.length ? (
          <Text style={s.small}>{`The first ${found.length} of ${value.matched}`}</Text>
        ) : null}
        <BrowseRows voices={found} usual={value.usual ?? ""} />
      </Card>
    );
  }
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
