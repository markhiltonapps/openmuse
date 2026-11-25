import { Download, RotateCcw, Search, ShieldCheck, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Linking, Platform, Text, type TextStyle, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { PastChatsImport } from "./past-chats-ui";
import { Button, Card, CheckRow, colors, ErrorNotice, Field, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Promises the agent keeps, each one true today, with its honest limits (copy review,
 * 2026-11-25): redaction finds numbers by their shape and a call's voice hears raw speech;
 * always-allow rules are the person's own; finished jobs, files and backups outlast a forget.
 * Nothing about AI providers' training: that isn't enforced for every provider yet.
 */
const promises = (agent: string) => [
  `Card numbers, passwords and ID numbers ${agent} can spot are hidden before an AI reads them. On a call, the voice still hears what you say.`,
  "Nothing is sent, booked or bought unless you OK it, or set a rule that always allows it.",
  "Never sold or used for ads.",
  `Forget, download or delete what ${agent} keeps, whenever you like.`,
];

/** A section's title inside the card: smaller than the card's own, so the card reads as one. */
const SECTION: TextStyle = {
  ...s.text,
  fontSize: 14,
  fontWeight: "600",
  letterSpacing: 0.2,
  color: colors.mutedStrong,
};
const RULE = { height: 1, backgroundColor: colors.line, marginVertical: 4 } as const;
const TOPIC_FIELD = "forget-topic";
const KEEP_BUTTON = "forget-keep";
const FORGET_BUTTON = "forget-these";

interface Found {
  topic: string;
  items: { key: string; label: string; name: string }[];
  messages: number;
}

/** "Forget everything about X": find it, choose, confirm, then it's gone. */
function ForgetSomething({ agent }: { agent: string }) {
  const { api } = useWorkspace();
  const [topic, setTopic] = useState("");
  const [found, setFound] = useState<Found>();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState(true);
  const [sure, setSure] = useState(false);
  // When the question appeared: "Yes, forget" ignores presses for a moment, so a double tap on
  // "Forget these…" can't delete for good.
  const [askedAt, setAskedAt] = useState(0);
  const [busy, setBusy] = useState<"find" | "forget">();
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");
  async function find() {
    const words = topic.trim();
    if (words.length < 2) return setError("Say who or what, in a word or two.");
    setBusy("find");
    setError("");
    setSaid("");
    setSure(false);
    try {
      const result = await api.request<Found>("/api/privacy/forget/find", { topic: words });
      setFound(result);
      setChosen(new Set(result.items.map((item) => item.key)));
      setMessages(result.messages > 0);
      setSaid(
        result.items.length || result.messages
          ? `Found ${count(result)} about ${result.topic}. Nothing is deleted yet.`
          : `Nothing ${agent} remembers mentions ${result.topic}.`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(undefined);
    }
  }
  async function forget() {
    if (!found) return;
    setBusy("forget");
    setError("");
    try {
      const done = await api.request<{ forgot: number; messages: number }>("/api/privacy/forget", {
        topic: found.topic,
        keys: [...chosen],
        messages,
      });
      setFound(undefined);
      setSure(false);
      setTopic("");
      setSaid(
        `Forgotten: ${
          [
            done.forgot ? `${done.forgot} ${done.forgot === 1 ? "thing" : "things"}` : "",
            done.messages
              ? `${done.messages} chat ${done.messages === 1 ? "message" : "messages"}`
              : "",
          ]
            .filter(Boolean)
            .join(" and ") || "nothing"
        } about ${found.topic}. Finished jobs and files that mention it stay until you delete them.`,
      );
      // The checklist is gone: focus goes back to the box, not to the top of the page.
      if (Platform.OS === "web")
        setTimeout(() => globalThis.document?.getElementById(TOPIC_FIELD)?.focus(), 0);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(undefined);
    }
  }
  const picked = chosen.size + (messages && found?.messages ? 1 : 0);
  const pickedWords = [
    chosen.size ? `${chosen.size} ${chosen.size === 1 ? "thing" : "things"}` : "",
    messages && found?.messages
      ? `${found.messages} chat ${found.messages === 1 ? "message" : "messages"}`
      : "",
  ]
    .filter(Boolean)
    .join(" and ");
  const question = found
    ? `Forget ${pickedWords} about ${found.topic} for good? This can’t be undone.`
    : "";
  return (
    <View style={{ gap: 10 }}>
      <Text role="heading" aria-level={3} style={SECTION}>
        Forget something
      </Text>
      <Text style={s.muted}>
        {`A person, a place or a topic. ${agent} finds the memories, people, plans, saved emails, calls, recordings and chat messages that mention it, and deletes only what you choose. Or just say “Forget everything about Jordan.”`}
      </Text>
      <View style={[s.row, { gap: 8, alignItems: "center" }]}>
        <View style={{ flex: 1, marginBottom: -16 }}>
          <Field
            nativeID={TOPIC_FIELD}
            label={`Who or what should ${agent} forget?`}
            hideLabel
            placeholder="A name or topic"
            value={topic}
            onChangeText={(text) => {
              setTopic(text);
              if (found) setFound(undefined);
              setSure(false);
            }}
            onSubmitEditing={() => void find()}
            returnKeyType="search"
          />
        </View>
        <Button
          icon={Search}
          busy={busy === "find"}
          disabled={!topic.trim()}
          style={{ minHeight: 45 }}
          onPress={() => void find()}
        >
          Find
        </Button>
      </View>
      {found && (found.items.length > 0 || found.messages > 0) && (
        <View
          role="group"
          aria-label={`What mentions ${found.topic}`}
          style={{ gap: 2, padding: 12, borderRadius: 16, backgroundColor: colors.subtle }}
        >
          {found.items.map((item) => (
            <CheckRow
              key={item.key}
              label={item.name || item.label}
              detail={item.label}
              checked={chosen.has(item.key)}
              onPress={() => {
                setSure(false);
                setChosen((current) => {
                  const next = new Set(current);
                  if (next.has(item.key)) next.delete(item.key);
                  else next.add(item.key);
                  return next;
                });
              }}
            />
          ))}
          {found.messages > 0 && (
            <CheckRow
              label={`${found.messages} chat ${found.messages === 1 ? "message" : "messages"} that mention it`}
              detail={`Gone from your chats and from what ${agent} reads. The company that stores your chats keeps a copy until you delete that chat.`}
              checked={messages}
              onPress={() => {
                setSure(false);
                setMessages(!messages);
              }}
            />
          )}
          {/* One tap never deletes for good: the same spot asks once more. */}
          {sure ? (
            <View style={{ gap: 8, marginTop: 8 }}>
              <Text style={[s.text, { fontWeight: "600" }]}>{question}</Text>
              <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                {/* The safe answer sits where "Forget these…" was, and gets the focus. */}
                <Button
                  nativeID={KEEP_BUTTON}
                  style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.edge }}
                  onPress={() => {
                    setSure(false);
                    setSaid("Nothing was forgotten.");
                    if (Platform.OS === "web")
                      setTimeout(
                        () => globalThis.document?.getElementById(FORGET_BUTTON)?.focus(),
                        0,
                      );
                  }}
                >
                  {picked === 1 ? "Keep it" : "Keep them"}
                </Button>
                <Button
                  danger
                  strong
                  icon={Trash2}
                  busy={busy === "forget"}
                  onPress={() => {
                    if (Date.now() - askedAt < 600) return;
                    void forget();
                  }}
                >
                  Yes, forget
                </Button>
              </View>
            </View>
          ) : (
            <View style={[s.row, { gap: 8, marginTop: 8, flexWrap: "wrap" }]}>
              <Button
                nativeID={FORGET_BUTTON}
                danger
                icon={Trash2}
                disabled={!picked}
                style={DANGER_OUTLINE}
                onPress={() => {
                  setSure(true);
                  setAskedAt(Date.now());
                  setSaid(question);
                  if (Platform.OS === "web")
                    setTimeout(() => globalThis.document?.getElementById(KEEP_BUTTON)?.focus(), 0);
                }}
              >
                {picked
                  ? `Forget ${picked === 1 ? "it" : `these ${picked}`}…`
                  : "Choose what to forget"}
              </Button>
              <Button onPress={() => setFound(undefined)}>Cancel</Button>
            </View>
          )}
        </View>
      )}
      {/* While the question shows, it's read out from here but seen only once, in the panel. */}
      <Text role="status" style={said && !sure ? s.small : HIDDEN}>
        {said}
      </Text>
      <ErrorNotice error={error} />
    </View>
  );
}
const count = (found: Found) =>
  [
    found.items.length
      ? `${found.items.length} ${found.items.length === 1 ? "thing" : "things"}`
      : "",
    found.messages ? `${found.messages} chat ${found.messages === 1 ? "message" : "messages"}` : "",
  ]
    .filter(Boolean)
    .join(" and ");
const HIDDEN = {
  position: "absolute",
  width: 1,
  height: 1,
  opacity: 0,
  overflow: "hidden",
  pointerEvents: "none",
} as const;
/** A first step toward deleting: red words and edge, no fill. The fill is kept for the final yes. */
const DANGER_OUTLINE = {
  backgroundColor: "transparent",
  borderWidth: 1.5,
  borderColor: colors.danger,
} as const;

/** The agent's privacy promise, forgetting, downloading everything, or starting over. */
export function YourDataCard() {
  const { api, notify } = useWorkspace();
  const { data, refresh } = useAgentWorkspace();
  const agent = data?.identity.name || "Neddy";
  const [busy, setBusy] = useState<"export" | "reset">();
  const [resetting, setResetting] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  async function download() {
    setBusy("export");
    setError("");
    try {
      const { url } = await api.request<{ url: string }>("/api/account/export-link", {});
      await Linking.openURL(url);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(undefined);
    }
  }
  async function reset() {
    setBusy("reset");
    setError("");
    try {
      await api.request("/api/account/reset", { confirm: "RESET" });
      setResetting(false);
      setConfirm("");
      notify("Your agent has been reset.");
      // Chats and everything on screen start over.
      if (Platform.OS === "web" && typeof window !== "undefined") window.location.reload();
      else await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <Card style={{ gap: 16 }}>
      <SectionHeading title="Privacy and your data" />
      <View role="list" style={{ gap: 8, marginTop: -6 }}>
        {promises(agent).map((line) => (
          <View key={line} role="listitem" style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.green,
              }}
            >
              <ShieldCheck size={13} color={colors.greenText} />
            </View>
            <Text style={[s.text, { flex: 1, fontSize: 14, lineHeight: 20 }]}>{line}</Text>
          </View>
        ))}
      </View>
      <View style={RULE} />
      <ForgetSomething agent={agent} />
      <View style={RULE} />
      <View style={{ gap: 10 }}>
        <Text role="heading" aria-level={3} style={SECTION}>
          Download everything
        </Text>
        <Text style={s.muted}>
          {`A copy of everything ${agent} keeps: chats, memories, jobs, goals, routines, reminders, your health log and your files. Sign-in secrets for connected apps aren’t included.`}
        </Text>
        <Button
          icon={Download}
          busy={busy === "export"}
          style={{ alignSelf: "flex-start" }}
          onPress={() => void download()}
        >
          Download my data
        </Button>
      </View>
      <View style={RULE} />
      {resetting ? (
        <View style={{ gap: 10 }}>
          <Text role="heading" aria-level={3} style={SECTION}>
            Start over
          </Text>
          <Text style={[s.muted, { fontSize: 14, lineHeight: 20 }]}>
            This permanently deletes all your chats, memories, tasks, goals, routines, reminders,
            health log, files, recordings and agent settings. Your account, connected apps and email
            stay. <Text style={{ fontWeight: "600", color: colors.text }}>It can’t be undone,</Text>{" "}
            so download your data first if you might want it.
          </Text>
          <Field
            label="Type RESET to confirm"
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button
              danger
              strong
              icon={RotateCcw}
              busy={busy === "reset"}
              disabled={confirm.trim() !== "RESET"}
              onPress={() => void reset()}
            >
              Delete everything
            </Button>
            <Button onPress={() => setResetting(false)}>Cancel</Button>
          </View>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Text role="heading" aria-level={3} style={SECTION}>
            Start over
          </Text>
          <Text style={s.muted}>
            {`Deletes everything ${agent} knows, made or recorded for you. Your account and connected apps stay.`}
          </Text>
          <Button
            danger
            icon={RotateCcw}
            style={{ ...DANGER_OUTLINE, alignSelf: "flex-start" }}
            onPress={() => setResetting(true)}
          >
            Delete everything…
          </Button>
        </View>
      )}
      <ErrorNotice error={error} />
    </Card>
  );
}

/**
 * Past chats from ChatGPT and Claude, and ChatGPT's own memory list pasted in as suggestions to
 * keep or dismiss.
 */
export function ChatgptImport() {
  const { api, notify } = useWorkspace();
  const { refresh } = useAgentWorkspace();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function importPasted() {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{ suggested: number }>("/api/memories/import", {
        text: text.trim(),
      });
      await refresh();
      setText("");
      notify(
        result.suggested
          ? `${result.suggested} ${result.suggested === 1 ? "memory" : "memories"} to review below.`
          : "Nothing new to remember was found.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <PastChatsImport />
      <View style={s.divider} />
      <Text style={s.label}>Memories from ChatGPT</Text>
      <Text style={s.muted}>
        Paste the list from ChatGPT's Settings → Personalization → Manage memories. You choose which
        ones to keep.
      </Text>
      <Field
        label="Paste memories"
        value={text}
        onChangeText={setText}
        multiline
        placeholder={"Has a daughter named Emma\nPrefers aisle seats"}
      />
      <Button
        busy={busy}
        disabled={busy || text.trim().length < 3}
        onPress={() => void importPasted()}
      >
        Import pasted memories
      </Button>
      <ErrorNotice error={error} />
    </View>
  );
}
