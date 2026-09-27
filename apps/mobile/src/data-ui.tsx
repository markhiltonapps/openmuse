import { Download, RotateCcw, Upload } from "lucide-react-native";
import { useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { Button, Card, ErrorNotice, Field, SectionHeading, s } from "./ui";
import { chooseAndSend } from "./upload";
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

/** Brings what ChatGPT knows about the person over as memory suggestions to keep or dismiss. */
export function ChatgptImport() {
  const { api, notify } = useWorkspace();
  const { refresh } = useAgentWorkspace();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"file" | "text">();
  const [error, setError] = useState("");
  async function run(
    kind: "file" | "text",
    work: () => Promise<{ suggested: number } | undefined>,
  ) {
    setBusy(kind);
    setError("");
    try {
      const result = await work();
      if (!result) return;
      await refresh();
      if (kind === "text") setText("");
      notify(
        result.suggested
          ? `${result.suggested} ${result.suggested === 1 ? "memory" : "memories"} to review below.`
          : "Nothing new to remember was found.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.label}>Import from ChatGPT</Text>
      <Text style={s.small}>
        In ChatGPT, open Settings → Data controls → Export data, then upload the .zip file it emails
        you. Your agent reads what you wrote and suggests things to remember; nothing is kept until
        you approve it. Or paste your memories from ChatGPT's Settings → Personalization → Manage
        memories.
      </Text>
      <Button
        icon={Upload}
        busy={busy === "file"}
        disabled={!!busy}
        onPress={() =>
          void run("file", () =>
            chooseAndSend<{ suggested: number }>(api, "/api/memories/import", [
              "application/zip",
              "application/x-zip-compressed",
              "application/json",
              ".zip",
              ".json",
            ]),
          )
        }
      >
        Upload ChatGPT export
      </Button>
      <Field
        label="Or paste memories"
        value={text}
        onChangeText={setText}
        multiline
        placeholder={"Has a daughter named Emma\nPrefers aisle seats"}
      />
      <Button
        busy={busy === "text"}
        disabled={!!busy || text.trim().length < 3}
        onPress={() =>
          void run("text", () =>
            api.request<{ suggested: number }>("/api/memories/import", { text: text.trim() }),
          )
        }
      >
        Import pasted memories
      </Button>
      <ErrorNotice error={error} />
    </View>
  );
}
