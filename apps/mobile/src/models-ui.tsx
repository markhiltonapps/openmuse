import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { EFFORT_LABELS, modelLabel } from "../../../packages/domain/src/model-names";
import { HIDDEN } from "./job-working-ui";
import { Button, Card, CheckRow, colors, ErrorNotice, Field, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

type Job = "chat" | "background" | "simple";
type Effort = "low" | "medium" | "high";
interface Choice {
  model: string;
  effort?: Effort;
}
interface Row {
  job: Job;
  choice: Choice;
  saved: boolean;
  recommended: Required<Choice>;
  serverModel: string | null;
  using: string | null;
  /** How the last call went since the server started (OpenRouter models only). */
  lastCall: { ok: boolean; at: string; error?: string; usedInstead?: string } | null;
}
interface ModelsView {
  ready: boolean;
  jobs: Row[];
}

const SERVER = "server";
const SOL = "openrouter/openai/gpt-6.1-sol";
const FLASH = "openrouter/deepseek/deepseek-v4.1-flash";
const JOBS: Record<Job, { title: string; detail: string }> = {
  chat: {
    title: "Chat",
    detail: "Talking with you in chat, and looking things up during voice calls",
  },
  background: {
    title: "Background jobs and routines",
    detail: "Jobs you hand off, scheduled routines, and work done on websites",
  },
  simple: {
    title: "Simple jobs",
    detail: "Summaries of long chats, Ideas, and bookings found in emails",
  },
};
const EFFORT_DETAILS: Record<Effort, string> = {
  low: "Fastest and cheapest. Fine for simple jobs.",
  medium: "A balance of speed, cost and care.",
  high: "Slowest and costs the most, but the most careful.",
};
const changeId = (job: Job) => `models-change-${job}`;
const editorId = (job: Job) => `models-editor-${job}`;
/** On the web, move focus to an element once it's drawn (after a sheet's focus trap has run). */
function focusSoon(id: string) {
  if (Platform.OS !== "web") return;
  setTimeout(() => document.getElementById(id)?.focus(), 0);
}
/** How hard it thinks, inside a sentence. */
const EFFORT_SAID: Record<Effort, string> = {
  low: "quick",
  medium: "some thinking",
  high: "thinking hard",
};
/** "GPT-6.1 Sol, thinking hard". */
const named = (choice: Choice, fallback: Effort) =>
  `${modelLabel(choice.model)}, ${EFFORT_SAID[choice.effort ?? fallback]}`;
const onRecommended = (row: Row) =>
  row.choice.model === row.recommended.model &&
  (row.choice.effort ?? row.recommended.effort) === row.recommended.effort;
/** "2:14 PM". */
const timeOf = (at: string) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * The admin picks which AI model does which kind of work. OpenRouter models need OPENROUTER_API_KEY
 * on the server; until then everything uses the server's Claude models, as before. The agent can
 * change them too (change_ai_models), when the admin says so.
 */
export function ModelsCard() {
  const { api } = useWorkspace();
  const [view, setView] = useState<ModelsView>();
  const [editing, setEditing] = useState<Job>();
  const [news, setNews] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let admin = false;
    const load = () => {
      if (admin) void api.request<ModelsView>("/api/models").then(setView, () => undefined);
    };
    // Only the admin sees the card.
    void api.request<{ role?: string }>("/api/me").then(
      (me) => {
        admin = me.role === "admin";
        load();
      },
      () => undefined,
    );
    // Back on the tab after adding the key on Railway: show that it's set up.
    if (Platform.OS !== "web") return;
    const visible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [api]);
  if (!view) return null;
  const allClaude = view.jobs.every((row) => row.choice.model === SERVER);
  const allRecommended = view.jobs.every(onRecommended);
  async function setAll(all: "claude" | "recommended") {
    setBusy(true);
    setError("");
    setNews("");
    try {
      const next = await api.request<ModelsView>("/api/models", { all });
      setView(next);
      setNews(
        all === "claude"
          ? "Saved. All three kinds of work use Claude, as before."
          : `Saved. All three are back on the recommended picks.${next.ready ? "" : " They start once OpenRouter is set up."}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 14 }}>
      <SectionHeading title="AI models" />
      {view.ready ? (
        <Text style={s.muted}>
          Each kind of work below uses the model shown. Changes apply to everyone on this app, from
          the next message or job.
        </Text>
      ) : (
        <View style={{ gap: 6, padding: 12, borderRadius: 14, backgroundColor: colors.sky }}>
          <Text style={[s.text, { fontWeight: "600" }]}>
            OpenRouter isn’t set up yet, so everything uses Claude, as before.
          </Text>
          <Text style={[s.muted, { color: colors.mutedStrong }]}>
            OpenRouter is the service that lets the app use models from other companies. To switch:
            create a key at openrouter.ai and add some credit there. Then add the key as{" "}
            <Text style={{ fontFamily: "monospace", fontWeight: "700", color: colors.text }}>
              OPENROUTER_API_KEY
            </Text>{" "}
            under the api service’s Variables on Railway, and choose Deploy on the banner Railway
            shows. The picks below then start by themselves.
          </Text>
        </View>
      )}
      {view.jobs.map((row, index) => {
        const line = usingLine(row, view.ready);
        const failed = row.lastCall && !row.lastCall.ok ? row.lastCall : undefined;
        return (
          <View
            key={row.job}
            style={
              index ? { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14 } : undefined
            }
          >
            {editing === row.job ? (
              <ModelEditor
                row={row}
                ready={view.ready}
                onCancel={() => {
                  setEditing(undefined);
                  focusSoon(changeId(row.job));
                }}
                onSaved={(next, message) => {
                  setView(next);
                  setEditing(undefined);
                  setNews(message);
                  focusSoon(changeId(row.job));
                }}
              />
            ) : (
              <View style={{ gap: 4 }}>
                <Text role="heading" aria-level={4} style={[s.text, { fontWeight: "600" }]}>
                  {JOBS[row.job].title}
                </Text>
                <Text style={s.muted}>{JOBS[row.job].detail}</Text>
                <View style={[s.row, { gap: 10, marginTop: 4 }]}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={[s.text, { fontWeight: "600" }]}>{line.name}</Text>
                    <Text style={[s.muted, { color: colors.mutedStrong }]}>{line.note}</Text>
                    {line.hint ? <Text style={s.muted}>{line.hint}</Text> : null}
                  </View>
                  <Button
                    small
                    nativeID={changeId(row.job)}
                    style={{ minHeight: 44 }}
                    accessibilityLabel={`Change the model for ${JOBS[row.job].title}`}
                    onPress={() => {
                      setNews("");
                      setError("");
                      setEditing(row.job);
                      focusSoon(editorId(row.job));
                    }}
                  >
                    Change
                  </Button>
                </View>
                {row.lastCall ? (
                  <Text style={[s.muted, failed ? { color: colors.danger } : undefined]}>
                    {failed
                      ? `The last AI call, at ${timeOf(failed.at)}, didn’t work: ${failed.error}. ${modelLabel(failed.usedInstead) || "Claude"} answered instead.`
                      : `Working. Last AI call at ${timeOf(row.lastCall.at)}.`}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        );
      })}
      {!editing && (!allClaude || !allRecommended) && (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          {!allClaude && (
            <Button small busy={busy} onPress={() => void setAll("claude")}>
              Put everything back on Claude
            </Button>
          )}
          {!allRecommended && (
            <Button small busy={busy} onPress={() => void setAll("recommended")}>
              Use the recommended picks
            </Button>
          )}
        </View>
      )}
      <ErrorNotice error={error} />
      <Text style={s.small}>
        Live voice calls use their own voice model, which isn’t changed here.
      </Text>
      {/* Always mounted, so a screen reader hears when a choice is saved. */}
      <Text role="status" style={news ? [s.muted, { color: colors.greenText }] : HIDDEN}>
        {news}
      </Text>
    </Card>
  );
}

/**
 * The model a job uses (name), how hard it thinks or which Claude it is (note), and what it would
 * use instead (hint): the recommended pick, or the pick that starts once OpenRouter is set up.
 */
function usingLine(row: Row, ready: boolean): { name: string; note: string; hint?: string } {
  const { choice, recommended } = row;
  const pick = named(recommended, recommended.effort);
  const claude = modelLabel(row.serverModel) || "No model set";
  if (choice.model === SERVER)
    return { name: "Claude, as before", note: claude, hint: `Recommended: ${pick}` };
  const effort = choice.effort ?? recommended.effort;
  const hint = onRecommended(row) ? undefined : `Recommended: ${pick}`;
  if (!ready)
    return {
      name: `Claude, as before (${claude})`,
      note: `Switches to ${named(choice, effort)} once OpenRouter is set up`,
      hint,
    };
  return {
    name: modelLabel(choice.model),
    note: `${EFFORT_LABELS[effort]}${hint ? "" : " · recommended"}`,
    hint,
  };
}

/** A saved choice said back: "Saved. Chat: GPT-6.1 Sol, Thinks hard." */
function savedMessage(title: string, choice: Choice, ready: boolean, reset: boolean) {
  if (choice.model === SERVER) return `Saved. ${title} now uses Claude, as before.`;
  const name = named(choice, "medium");
  const later = ready ? "" : " It starts once OpenRouter is set up.";
  return reset
    ? `Saved. ${title} is back on the recommended pick, ${name}.${later}`
    : `Saved. ${title} now uses ${name}.${later}`;
}

function ModelEditor({
  row,
  ready,
  onCancel,
  onSaved,
}: {
  row: Row;
  ready: boolean;
  onCancel: () => void;
  onSaved: (view: ModelsView, message: string) => void;
}) {
  const { api } = useWorkspace();
  const known = [SOL, FLASH, SERVER].includes(row.choice.model);
  const first = {
    model: known ? row.choice.model : "other",
    other: known ? "" : row.choice.model.replace(/^openrouter\//, ""),
    effort: row.choice.effort ?? row.recommended.effort,
  };
  const [model, setModel] = useState(first.model);
  const [other, setOther] = useState(first.other);
  const [effort, setEffort] = useState<Effort>(first.effort);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = JOBS[row.job].title;
  async function save(choice: Choice | null) {
    setBusy(true);
    setError("");
    try {
      const next = await api.request<ModelsView>("/api/models", { job: row.job, choice });
      const saved = next.jobs.find((j) => j.job === row.job)?.choice ?? row.recommended;
      onSaved(next, savedMessage(title, saved, next.ready, !choice));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const chosen = model === "other" ? other.trim() : model;
  const routed = model !== SERVER;
  // Nothing to save until something changes, so a look never pins a job to its current model.
  const changed =
    model !== first.model ||
    (model === "other" && other.trim() !== first.other) ||
    (routed && effort !== first.effort);
  const groupLabel = [s.label, { color: colors.mutedStrong, marginTop: 8, marginBottom: -6 }];
  return (
    <View style={{ gap: 10, padding: 14, borderRadius: 14, backgroundColor: colors.subtle }}>
      <View style={{ gap: 2 }}>
        <Text
          nativeID={editorId(row.job)}
          role="heading"
          aria-level={4}
          style={[s.text, { fontWeight: "600" }]}
          {...({ tabIndex: -1 } as object)}
        >
          {title}
        </Text>
        <Text style={[s.muted, { color: colors.mutedStrong }]}>{JOBS[row.job].detail}</Text>
      </View>
      <Text role="heading" aria-level={5} style={groupLabel}>
        Model
      </Text>
      <View role="radiogroup" aria-label={`Model for ${title}`}>
        <CheckRow
          radio
          label={`GPT‑6.1 Sol${row.recommended.model === SOL ? " (recommended)" : ""}`}
          detail={"For hard, important work.\n$2 per million tokens read, $10 per million written."}
          checked={model === SOL}
          onPress={() => setModel(SOL)}
        />
        <CheckRow
          radio
          label={`DeepSeek V4.1 Flash${row.recommended.model === FLASH ? " (recommended)" : ""}`}
          detail={
            "Fast and cheap, for simple jobs.\n$0.04 per million tokens read, $1.20 per million written."
          }
          checked={model === FLASH}
          onPress={() => setModel(FLASH)}
        />
        <CheckRow
          radio
          label="Claude, as before"
          detail={`The Claude model the server was using before: ${modelLabel(row.serverModel) || "none set"}.`}
          checked={model === SERVER}
          onPress={() => setModel(SERVER)}
        />
        <CheckRow
          radio
          label="Another OpenRouter model"
          detail="Type the model’s ID from its page at openrouter.ai, like openai/gpt-6.1-sol. It’s checked with OpenRouter before it’s saved."
          checked={model === "other"}
          onPress={() => setModel("other")}
        />
      </View>
      {model === "other" && (
        <View style={{ marginLeft: 29, marginBottom: -10 }}>
          <Field
            label="OpenRouter model ID"
            hideLabel
            value={other}
            onChangeText={setOther}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="company/model"
          />
        </View>
      )}
      <Text style={[s.small, { color: colors.mutedStrong }]}>
        A token is a small piece of text, about three-quarters of a word. Writing costs more than
        reading.
      </Text>
      {routed && (
        <>
          <Text role="heading" aria-level={5} style={groupLabel}>
            How hard it thinks
          </Text>
          <View role="radiogroup" aria-label={`How hard it thinks for ${title}`}>
            {(["low", "medium", "high"] as const).map((level) => (
              <CheckRow
                key={level}
                radio
                label={`${EFFORT_LABELS[level]}${level === row.recommended.effort ? " (recommended)" : ""}`}
                detail={EFFORT_DETAILS[level]}
                checked={effort === level}
                onPress={() => setEffort(level)}
              />
            ))}
          </View>
        </>
      )}
      {!ready && routed && (
        <Text style={[s.muted, { color: colors.mutedStrong }]}>
          This takes effect once OpenRouter is set up on the server. Until then, this job keeps
          using Claude.
        </Text>
      )}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          primary
          busy={busy}
          disabled={!chosen || !changed}
          onPress={() => void save(routed ? { model: chosen, effort } : { model: SERVER })}
        >
          Save
        </Button>
        <Button style={{ backgroundColor: colors.surface }} onPress={onCancel}>
          Cancel
        </Button>
      </View>
      {!onRecommended(row) && (
        <Button
          busy={busy}
          style={{ backgroundColor: colors.surface, alignSelf: "flex-start" }}
          onPress={() => void save(null)}
        >
          {`Back to ${named(row.recommended, row.recommended.effort)} (recommended)`}
        </Button>
      )}
    </View>
  );
}
