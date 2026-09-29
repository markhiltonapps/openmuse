import * as DocumentPicker from "expo-document-picker";
import { Unzip, type UnzipFile, UnzipInflate } from "fflate";
import { Upload } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import {
  type ChatSource,
  CONVERSATION_FILE,
  ownWords,
  type PastChatInput,
  parseChatExport,
} from "../../../packages/domain/src/chat-export";
import { useAgentWorkspace } from "./agent-workspace";
import type { MuseApi } from "./api";
import { Button, colors, ErrorNotice, s } from "./ui";
import { chooseAndSend } from "./upload";
import { useWorkspace } from "./workspace";

interface Source {
  id: ChatSource;
  name: string;
  count: number;
  importedAt: string;
}
interface Imported {
  summary: Source;
  sources: Source[];
  suggesting: boolean;
}
const TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/json",
  ".zip",
  ".json",
];
/** Each request stays well under the server's size limit, even for text that isn't English. */
const BATCH_CHARS = 2_500_000;

/**
 * The conversations files in an export, read as it streams in: exports with years of pictures can
 * be gigabytes, and only conversations.json is needed.
 */
async function conversationFiles(file: File, progress: (share: number) => void): Promise<string[]> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x50 || head[1] !== 0x4b) return [await file.text()];
  const cutOff = () =>
    new Error(
      "This .zip is incomplete. The download may have been cut off. Download the export again and upload it.",
    );
  const texts: Promise<string>[] = [];
  let finished = 0;
  const unzip = new Unzip((entry: UnzipFile) => {
    if (!CONVERSATION_FILE.test(entry.name)) return;
    texts.push(
      new Promise((resolve, reject) => {
        const decoder = new TextDecoder();
        const parts: string[] = [];
        entry.ondata = (error, chunk, final) => {
          if (error) return reject(error);
          parts.push(decoder.decode(chunk, { stream: !final }));
          if (final) {
            finished++;
            resolve(parts.join(""));
          }
        };
        entry.start();
      }),
    );
  });
  unzip.register(UnzipInflate);
  const reader = file.stream().getReader();
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      unzip.push(value);
      read += value.length;
      progress(read / (file.size || 1));
    }
    unzip.push(new Uint8Array(0), true);
  } catch {
    throw cutOff();
  }
  // A file whose end never arrived would otherwise be waited for forever.
  if (finished < texts.length) throw cutOff();
  if (!texts.length)
    throw new Error(
      "This .zip doesn't have your chats in it. Upload the .zip ChatGPT or Claude emailed you.",
    );
  return Promise.all(texts);
}

/** Reads an export on this device: which app it's from and its chats. */
async function readExport(file: File, progress: (share: number) => void) {
  let source: ChatSource | undefined;
  const chats: PastChatInput[] = [];
  for (const text of await conversationFiles(file, progress)) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("This file couldn't be read. Upload the .zip ChatGPT or Claude emailed you.");
    }
    const parsed = parseChatExport(data);
    if (source && parsed.source !== source) throw new Error("Upload one app's export at a time.");
    source = parsed.source;
    chats.push(...parsed.chats);
  }
  if (!source || !chats.length) throw new Error("There are no chats in this export.");
  return { source, chats };
}

/** Sends the chats in batches, then finishes: the server counts them and suggests memories. */
async function sendChats(
  api: MuseApi,
  source: ChatSource,
  chats: PastChatInput[],
  progress: (sent: number) => void,
) {
  let batch: PastChatInput[] = [];
  let size = 0;
  let sent = 0;
  const flush = async () => {
    if (!batch.length) return;
    await api.request("/api/past-chats/batch", { source, chats: batch });
    sent += batch.length;
    progress(sent);
    batch = [];
    size = 0;
  };
  for (const chat of chats) {
    const length = JSON.stringify(chat).length;
    if (batch.length && (size + length > BATCH_CHARS || batch.length >= 1000)) await flush();
    batch.push(chat);
    size += length;
  }
  await flush();
  return api.request<Imported>("/api/past-chats/finish", { source, history: ownWords(chats) });
}

const count = (n: number) => n.toLocaleString();
const added = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Apps & settings → Agent: bring past chats over from ChatGPT and Claude. */
export function PastChatsImport() {
  const { api, notify } = useWorkspace();
  const { data, refresh } = useAgentWorkspace();
  const agent = data?.identity.name || "Your agent";
  const [sources, setSources] = useState<Source[]>();
  const [status, setStatus] = useState("");
  const [removing, setRemoving] = useState<ChatSource>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api.request<{ sources: Source[] }>("/api/past-chats").then(
        (value) => setSources(value.sources),
        () => setSources([]),
      ),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function bringOver() {
    setError("");
    let saving: { source: ChatSource; sent: number; total: number } | undefined;
    try {
      let result: Imported | undefined;
      if (Platform.OS !== "web") {
        setBusy(true);
        setStatus("Sending your export…");
        result = await chooseAndSend<Imported>(api, "/api/past-chats/upload", TYPES, {
          maxBytes: 12 * 1024 * 1024,
          tooBig:
            "This export is too big for the phone app. Upload it from Neato_Muse in a web browser.",
        });
      } else {
        const picked = await DocumentPicker.getDocumentAsync({ type: TYPES });
        const file = picked.canceled ? undefined : picked.assets[0]?.file;
        if (!file) return;
        setBusy(true);
        setStatus("Reading your export…");
        // Let the progress line show before the page is busy reading.
        await new Promise((resolve) => setTimeout(resolve, 50));
        let shown = 0;
        const { source, chats } = await readExport(file, (share) => {
          const percent = Math.floor(share * 100);
          if (percent < shown + 5 && percent < 100) return;
          shown = percent;
          setStatus(`Reading your export… ${percent}%`);
        });
        saving = { source, sent: 0, total: chats.length };
        setStatus(`Saving chats… 0 of ${count(chats.length)}`);
        result = await sendChats(api, source, chats, (sent) => {
          if (saving) saving.sent = sent;
          setStatus(`Saving chats… ${count(sent)} of ${count(chats.length)}`);
        });
      }
      if (!result) return;
      setSources(result.sources);
      await refresh();
      notify(
        `Brought over ${count(result.summary.count)} ${result.summary.count === 1 ? "chat" : "chats"} from ${result.summary.name}. ${agent} can look through them now.${result.suggesting ? " You'll get a note when there are things to remember." : ""}`,
      );
    } catch (e) {
      const problem = e instanceof Error ? e.message : String(e);
      const dropped = e instanceof TypeError;
      if (saving?.sent) {
        // Keep what was saved visible (and removable); the same file again finishes the rest.
        const { source, sent, total } = saving;
        await api.request("/api/past-chats/finish", { source }).catch(() => undefined);
        await load();
        setError(
          dropped
            ? `Saved ${count(sent)} of ${count(total)} chats before the connection dropped. Upload the same file again to finish. Chats already saved won't be added twice.`
            : `Saved ${count(sent)} of ${count(total)} chats. ${problem}`,
        );
      } else if (saving && dropped)
        setError(
          "The connection dropped before any chats were saved. Check your connection, then upload the file again.",
        );
      else if (Platform.OS !== "web" && /too large/i.test(problem))
        setError(
          "This export is too big for the phone app. Upload it from Neato_Muse in a web browser.",
        );
      else setError(problem);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }
  async function remove(source: Source) {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{ sources: Source[] }>("/api/past-chats/remove", {
        source: source.id,
      });
      setSources(result.sources);
      setRemoving(undefined);
      notify(`Your ${source.name} chats were removed.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.label}>Chats from ChatGPT and Claude</Text>
      <Text style={s.muted}>
        Bring over your past chats so you can ask about them, like “What did I work out with ChatGPT
        about pricing?” {agent} will also suggest things to remember from what you wrote. Nothing is
        kept until you say so.
      </Text>
      <Text style={s.muted}>
        In ChatGPT: Settings → Data controls → Export data.{"\n"}In Claude: Settings → Privacy →
        Export data.{"\n"}You'll get a .zip by email. Upload it here without unzipping it.
      </Text>
      {sources?.map((source) =>
        removing === source.id ? (
          <View
            key={source.id}
            style={{
              gap: 8,
              paddingVertical: 6,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
          >
            <Text style={s.text}>
              Remove your {source.name} chats? {agent} won't be able to look through them anymore.
            </Text>
            <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
              <Button
                danger
                busy={busy}
                accessibilityLabel={`Yes, remove your ${source.name} chats`}
                onPress={() => void remove(source)}
              >
                Yes, remove
              </Button>
              <Button
                disabled={busy}
                accessibilityLabel={`Keep your ${source.name} chats`}
                onPress={() => setRemoving(undefined)}
              >
                Keep
              </Button>
            </View>
          </View>
        ) : (
          <View
            key={source.id}
            style={[
              s.between,
              { gap: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.text, { fontWeight: "600" }]}>{source.name}</Text>
              <Text style={s.muted}>
                {count(source.count)} {source.count === 1 ? "chat" : "chats"} · added{" "}
                {added(source.importedAt)}
              </Text>
            </View>
            <Button
              disabled={busy}
              accessibilityLabel={`Remove your ${source.name} chats`}
              onPress={() => setRemoving(source.id)}
            >
              Remove
            </Button>
          </View>
        ),
      )}
      {!!status && (
        <Text accessibilityRole="alert" style={s.muted}>
          {status}
        </Text>
      )}
      <Button icon={Upload} busy={busy} disabled={busy} onPress={() => void bringOver()}>
        Upload a ChatGPT or Claude export
      </Button>
      <ErrorNotice error={error} />
    </View>
  );
}
