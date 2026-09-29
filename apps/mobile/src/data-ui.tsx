import { Download, RotateCcw } from "lucide-react-native";
import { useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { PastChatsImport } from "./past-chats-ui";
import { Button, Card, ErrorNotice, Field, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Download everything, or start the agent over. */
export function YourDataCard() {
  const { api, notify } = useWorkspace();
  const { refresh } = useAgentWorkspace();
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
    <Card style={{ gap: 12 }}>
      <SectionHeading title="Your data" />
      <Text style={s.muted}>
        Download a copy of everything your agent keeps: chats, memories, tasks, goals, routines,
        reminders, your health log and your files. Sign-in secrets for connected apps aren't
        included.
      </Text>
      <Button icon={Download} busy={busy === "export"} onPress={() => void download()}>
        Download my data
      </Button>
      {resetting ? (
        <View style={{ gap: 10 }}>
          <Text style={s.text}>
            This permanently deletes all your chats, memories, tasks, goals, routines, reminders,
            health log, files and agent settings. Your account, connected apps and email stay. It
            can't be undone, so download your data first if you might want it.
          </Text>
          <Field
            label="Type RESET to confirm"
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <View style={[s.row, { gap: 8 }]}>
            <Button
              danger
              icon={RotateCcw}
              busy={busy === "reset"}
              disabled={confirm.trim() !== "RESET"}
              onPress={() => void reset()}
            >
              Reset my agent
            </Button>
            <Button onPress={() => setResetting(false)}>Cancel</Button>
          </View>
        </View>
      ) : (
        <Button danger icon={RotateCcw} onPress={() => setResetting(true)}>
          Reset my agent…
        </Button>
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
