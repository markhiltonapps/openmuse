import { Drama } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  paceWords,
  type RehearsalAsk,
  type RehearsalView,
} from "../../../packages/domain/src/voice";
import { HIDDEN } from "./job-working-ui";
import { useCallControls, useLiveCall } from "./live-call";
import { Button, Card, colors, ErrorNotice, Field, LinkRow, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/** The kinds of conversation people practise most; a tap fills in who Neddy plays. */
const PARTS = [
  { label: "My boss", who: "my boss" },
  { label: "My landlord", who: "my landlord" },
  { label: "Customer service", who: "a company’s customer service" },
  { label: "A job interview", who: "an interviewer" },
  { label: "Practise a language", who: "a language partner" },
] as const;

/** A card that shows against the sheet in light mode too (the plain card is near-white on white). */
const panel = (gap: number) => ({ gap, backgroundColor: colors.subtle });
/** "1 min 40 s" for a number of seconds. */
function lengthOf(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}
/** "um ×3, you know ×2", or what to say when there were none. */
function counted(rows: { word: string; count: number }[], none: string) {
  return rows.length ? rows.map((row) => `“${row.word}” ×${row.count}`).join(", ") : none;
}

/** Starts the rehearsal: the call screen opens over whatever is open, on a call of its own. */
function useStartRehearsal() {
  const call = useCallControls();
  const { close } = useWorkspace();
  const start = useCallback(
    (ask: RehearsalAsk, closeSheet = false) => {
      call.start(ask);
      call.expand();
      if (closeSheet) close();
    },
    [call, close],
  );
  // Starting ends a call that's going: say so, never do it silently.
  return { start, callOn: call.phase === "on" };
}

/** "Rehearse a conversation": who Neddy plays, what it's about, what you want out of it. */
export function RehearseSheet() {
  const { api, close, open } = useWorkspace();
  const { start, callOn } = useStartRehearsal();
  const [who, setWho] = useState("");
  const [about, setAbout] = useState("");
  const [goal, setGoal] = useState("");
  const [last, setLast] = useState<{ id: string; ask: RehearsalAsk }>();
  useEffect(() => {
    api
      .request<{ rehearsal: (RehearsalView & { id: string }) | null }>("/api/rehearsals/latest")
      .then(
        ({ rehearsal }) => {
          if (rehearsal)
            setLast({
              id: rehearsal.id,
              ask: { who: rehearsal.who, about: rehearsal.about, goal: rehearsal.goal },
            });
        },
        () => undefined,
      );
  }, [api]);
  const ask = { who: who.trim(), about: about.trim(), goal: goal.trim() };
  return (
    <Sheet
      title="Rehearse a talk"
      subtitle="Neddy plays the other person. You practise out loud."
      onClose={close}
      footer={
        <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
          <Button
            strong
            icon={Drama}
            disabled={!ask.who}
            onPress={() => start(ask, true)}
            style={{ minWidth: 150 }}
          >
            {callOn ? "End call and start" : "Start rehearsal"}
          </Button>
          <Button onPress={close}>Cancel</Button>
        </View>
      }
    >
      <View style={{ gap: 14 }}>
        {last && (
          <LinkRow
            title={`Last time: ${last.ask.who}`}
            detail="See how it went"
            icon={Drama}
            onPress={() => open({ type: "rehearsalScore", id: last.id, ask: last.ask })}
          />
        )}
        <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>
          Who is Neddy playing?
        </Text>
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          {PARTS.map((part) => (
            <Button
              key={part.label}
              small
              primary={who === part.who}
              style={{ minHeight: 44 }}
              selected={who === part.who}
              onPress={() => setWho(part.who)}
            >
              {part.label}
            </Button>
          ))}
        </View>
        <Field
          label="Or say who"
          value={who}
          onChangeText={setWho}
          maxLength={80}
          placeholder="My manager, a customer, my sister…"
        />
        <Field
          label="What’s it about?"
          value={about}
          onChangeText={setAbout}
          maxLength={500}
          multiline
          placeholder="Asking for a raise after a year of extra work (or which language to practise)"
          style={{ minHeight: 80 }}
        />
        <Field
          label="What do you want out of it?"
          value={goal}
          onChangeText={setGoal}
          maxLength={300}
          placeholder="A yes, or a date to talk again"
        />
        <Text style={s.small}>
          It’s practice: Neddy plays the part, and you can end the practice any time to see how it
          went. It counts toward your call minutes and stops by itself after 15 minutes.
          {callOn ? " Starting it ends your call." : ""}
        </Text>
      </View>
    </Sheet>
  );
}

/** How a rehearsal went: the numbers at once, the coach's tips a moment later. */
export function RehearsalScoreSheet({ id, ask }: { id: string; ask: RehearsalAsk }) {
  const { api, close } = useWorkspace();
  const { limited } = useLiveCall();
  const { start, callOn } = useStartRehearsal();
  const [view, setView] = useState<RehearsalView>();
  const [error, setError] = useState("");
  const [late, setLate] = useState(false);
  const again = useRef<RehearsalAsk>(ask);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const began = Date.now();
    const look = async () => {
      try {
        const { rehearsal } = await api.request<{ rehearsal: RehearsalView | null }>(
          `/api/voice/live/${encodeURIComponent(id)}/rehearsal`,
        );
        if (stop) return;
        if (rehearsal) {
          setView(rehearsal);
          // The "still scoring" placeholder has no words yet: keep the ask we were opened with.
          if (rehearsal.who)
            again.current = { who: rehearsal.who, about: rehearsal.about, goal: rehearsal.goal };
          if (rehearsal.state !== "scoring") return;
        } else if (Date.now() - began > 15_000) {
          // The call is saved within seconds of ending; past that it isn't coming.
          setError("Couldn’t find that rehearsal.");
          return;
        }
      } catch {
        if (stop) return;
        // Not there yet (the call is still being saved): look again.
      }
      const waited = Date.now() - began;
      // The tips take a few seconds; if they don't come, keep looking, more slowly.
      if (waited > 90_000) setLate(true);
      if (waited > 600_000) return;
      timer = setTimeout(look, waited > 90_000 ? 10_000 : 2000);
    };
    void look();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [api, id]);
  const stats = view?.stats;
  const coaching = view?.coaching;
  const writing = !view || view.state === "scoring";
  return (
    <Sheet
      title={view?.who || ask.who ? `How it went with ${view?.who || ask.who}` : "How it went"}
      subtitle={stats ? `${lengthOf(stats.seconds)} of practice` : undefined}
      onClose={close}
      footer={
        <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
          {!limited && !!again.current.who && (
            <Button strong icon={Drama} onPress={() => start(again.current, true)}>
              Try again
            </Button>
          )}
          <Button onPress={close}>Close</Button>
        </View>
      }
    >
      <View style={{ gap: 14 }}>
        <ErrorNotice error={error} />
        {/* Always there, so a change from "working it out" to the tips is read out. */}
        <Text role="status" style={HIDDEN}>
          {error
            ? ""
            : view?.state === "short"
              ? "There wasn’t enough to score."
              : writing
                ? "Working out how it went."
                : coaching
                  ? "Your scorecard is ready."
                  : "The numbers are ready. The tips couldn’t be written this time."}
        </Text>
        {view?.state === "short" && (
          <Card style={panel(6)}>
            <Text style={s.heading}>Not enough to score</Text>
            <Text style={s.muted}>
              You said very little, so any numbers would mislead. If you were talking, check your
              microphone. Then try again, and talk it through the way you would for real.
            </Text>
          </Card>
        )}
        {stats && view?.state !== "short" && (
          <Card style={panel(12)}>
            <Text style={s.heading}>The numbers</Text>
            <View style={[s.row, { gap: 10 }]}>
              <Stat value={stats.pace ? `${stats.pace}` : "–"} label="words a minute" />
              <Stat value={lengthOf(stats.speakingSeconds)} label="you spoke" />
              <Stat value={`${stats.longestTurn}`} label="words, longest turn" />
            </View>
            <Text style={s.text}>
              {stats.pace
                ? `That’s ${paceWords(stats.pace)}.`
                : "There wasn’t enough talking to tell your pace."}
            </Text>
            <Row name="Filler words" value={counted(stats.fillers, "None I heard")} />
            <Row name="Softening words" value={counted(stats.softeners, "None I heard")} />
            <Text style={s.small}>
              Counted from the written-out words, which can leave out some “um”s. A rough guide,
              never a grade.
            </Text>
          </Card>
        )}
        {view?.state !== "short" && writing && !late && (
          <View style={[s.row, { gap: 10 }]}>
            <ActivityIndicator color={colors.blueDark} />
            <Text style={s.muted}>Writing up the tips…</Text>
          </View>
        )}
        {view?.state !== "short" && writing && late && (
          <Text style={s.muted}>
            The tips are taking longer than usual. You’ll get a notification (and a bell entry) when
            they’re ready.
          </Text>
        )}
        {view?.state === "done" && !coaching && (
          <Text style={s.muted}>
            Couldn’t write the tips this time. The numbers above still stand.
          </Text>
        )}
        {coaching && (
          <Card style={panel(10)}>
            {!!coaching.outcome && (
              <>
                <Text style={s.heading}>Where it landed</Text>
                <Text style={s.text}>{coaching.outcome}</Text>
              </>
            )}
            {!!coaching.wentWell && (
              <>
                <Text style={[s.heading, { marginTop: 4 }]}>What went well</Text>
                <Text style={s.text}>{coaching.wentWell}</Text>
              </>
            )}
            {coaching.tips.length > 0 && (
              <>
                <Text style={[s.heading, { marginTop: 4 }]}>Next time</Text>
                {coaching.tips.map((tip, index) => (
                  <View key={tip} style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
                    <Text style={[s.text, { fontWeight: "700" }]}>{index + 1}</Text>
                    <Text style={[s.text, { flex: 1 }]}>{tip}</Text>
                  </View>
                ))}
              </>
            )}
          </Card>
        )}
      </View>
    </Sheet>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
      <Text style={[s.heading, { fontSize: 20 }]}>{value}</Text>
      <Text style={s.small}>{label}</Text>
    </View>
  );
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>{name}</Text>
      <Text style={s.text}>{value}</Text>
    </View>
  );
}

function parsed(result: unknown): Record<string, unknown> | undefined {
  if (typeof result === "string")
    try {
      return JSON.parse(result) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  return result && typeof result === "object" ? (result as Record<string, unknown>) : undefined;
}

/**
 * In the chat and on a call: "Ready to rehearse" with the part Neddy will play. Nothing starts
 * until it's tapped (on a call, that ends the call first).
 */
export function RehearseToolCard({
  result,
  loading,
  onCall,
}: {
  result: unknown;
  loading?: boolean;
  onCall?: boolean;
}) {
  const { start, callOn } = useStartRehearsal();
  const value = parsed(result);
  const ask = value?.rehearsal as Partial<RehearsalAsk> | undefined;
  if (loading || !ask || typeof ask.who !== "string") return null;
  const full: RehearsalAsk = {
    who: ask.who,
    about: typeof ask.about === "string" ? ask.about : "",
    goal: typeof ask.goal === "string" ? ask.goal : "",
  };
  return (
    <Card style={panel(10)}>
      <View style={[s.row, { gap: 10 }]}>
        <Drama size={20} color={colors.blueDark} />
        <Text style={[s.heading, { flex: 1 }]}>Ready to rehearse with {full.who}</Text>
      </View>
      {!!full.about && <Text style={s.text}>{full.about}</Text>}
      {!!full.goal && <Text style={s.muted}>Your goal: {full.goal}</Text>}
      <Text style={s.small}>
        {onCall || callOn
          ? "This ends the call and starts the practice. You can end the practice any time to see how it went."
          : "I play the part. You can end the practice any time to see how it went."}
      </Text>
      <Button strong icon={Drama} onPress={() => start(full)}>
        {onCall || callOn ? "End call and start" : "Start rehearsal"}
      </Button>
    </Card>
  );
}
