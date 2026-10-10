import type { Message, ToolMessage } from "@copilotkit/react-native/headless";
import { Check, Copy, Square, Trash2, Volume2 } from "lucide-react-native";
import { Component, memo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { AssistantResponse } from "./assistant-response";
import { BrowserRunContext } from "./browser-tool-card";
import { plainText } from "./copy-text";
import { SpokenCall } from "./live-talk-ui";
import { glass } from "./theme";
import { colors, s } from "./ui";
import { speechAvailable } from "./voice";

export type ToolCall = NonNullable<Extract<Message, { role: "assistant" }>["toolCalls"]>[number];

/**
 * What a row shows, as text: CopilotKit may update a message in place while a reply streams, so
 * a row compares this, not the message object, to know it has to be drawn again.
 */
export function rowSignature(
  text: string,
  toolCalls: ToolCall[],
  results: (ToolMessage | undefined)[],
) {
  const calls = toolCalls.map((call) => `${call.id}:${call.function?.arguments?.length ?? 0}`);
  const done = results.map((result) =>
    result ? `${result.id}:${typeof result.content === "string" ? result.content.length : 1}` : "",
  );
  return `${text.length}:${text.slice(-24)}|${calls.join(",")}|${done.join(",")}`;
}

/**
 * A saved message in the chat's form: an earlier part may hold tool calls as `{id, name, args}`
 * (CopilotKit Intelligence's history), which the chat can't draw.
 */
export function asChatMessage(message: Message): Message {
  if (!("toolCalls" in message) || !Array.isArray(message.toolCalls)) return message;
  const toolCalls = message.toolCalls.map((call) => {
    const raw = call as unknown as { id?: string; name?: string; args?: unknown };
    if (call.function) return call;
    const args = raw.args ?? "";
    return {
      id: String(raw.id ?? ""),
      type: "function" as const,
      function: {
        name: String(raw.name ?? ""),
        arguments: typeof args === "string" ? args : JSON.stringify(args),
      },
    };
  });
  return { ...message, toolCalls } as Message;
}

export interface MessageRowProps {
  message: Message;
  text: string;
  toolCalls: ToolCall[];
  results: (ToolMessage | undefined)[];
  signature: string;
  running: boolean;
  active: boolean;
  fresh: boolean;
  shown: boolean;
  speaking: boolean;
  copied: boolean;
  confirming: boolean;
  canCopy: boolean;
  /** An earlier page or this device's copy: no deleting from here. */
  readOnly?: boolean;
  renderToolCall: (input: { toolCall: ToolCall; toolMessage?: ToolMessage }) => ReactNode;
  onListen: (id: string, text: string) => void;
  onStop: () => void;
  onCopy: (id: string, text: string) => void;
  onAskDelete: (id: string | undefined) => void;
  onDelete: (id: string) => void;
}

const same = (a: MessageRowProps, b: MessageRowProps) =>
  a.message.id === b.message.id &&
  a.signature === b.signature &&
  a.running === b.running &&
  a.active === b.active &&
  a.fresh === b.fresh &&
  a.shown === b.shown &&
  a.speaking === b.speaking &&
  a.copied === b.copied &&
  a.confirming === b.confirming &&
  a.canCopy === b.canCopy &&
  a.readOnly === b.readOnly &&
  a.renderToolCall === b.renderToolCall &&
  a.onListen === b.onListen &&
  a.onStop === b.onStop &&
  a.onCopy === b.onCopy &&
  a.onAskDelete === b.onAskDelete &&
  a.onDelete === b.onDelete;

/** One message that can't be drawn says so, instead of taking the whole screen down with it. */
class RowBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("A chat message couldn't be shown", error);
  }
  render() {
    return this.state.failed ? (
      <Text style={[s.small, { alignSelf: "center" }]}>This message can’t be shown.</Text>
    ) : (
      this.props.children
    );
  }
}

/** One message in the chat with its buttons and cards; drawn again only when it changes. */
export const MessageRow = memo(function MessageRow(props: MessageRowProps) {
  return (
    <RowBoundary>
      <MessageBody {...props} />
    </RowBoundary>
  );
}, same);

function MessageBody({
  message,
  text,
  toolCalls,
  results,
  running,
  active,
  fresh,
  shown,
  speaking,
  copied,
  confirming,
  canCopy,
  readOnly,
  renderToolCall,
  onListen,
  onStop,
  onCopy,
  onAskDelete,
  onDelete,
}: MessageRowProps) {
  const user = message.role === "user";
  // A live voice call, added once it was over.
  const spokenCall = !user && message.id.startsWith("spoken-");
  return (
    <View
      style={{
        alignSelf: user ? "flex-end" : "flex-start",
        maxWidth: user ? "85%" : "95%",
        width: toolCalls.length ? "95%" : undefined,
        gap: 8,
      }}
    >
      {!!text && (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 13,
            borderRadius: 22,
            borderBottomRightRadius: user ? 7 : 22,
            borderBottomLeftRadius: user ? 22 : 7,
            backgroundColor: user ? colors.blue : colors.bubble,
          }}
        >
          {user ? (
            <Text selectable style={[s.text, { fontSize: 16, lineHeight: 24 }]}>
              {text}
            </Text>
          ) : spokenCall ? (
            <SpokenCall text={text} id={message.id.slice("spoken-".length)} />
          ) : (
            <AssistantResponse content={text} />
          )}
        </View>
      )}
      {!!text && (
        <View
          style={[
            s.row,
            {
              gap: 12,
              alignSelf: user ? "flex-end" : "flex-start",
              paddingHorizontal: 6,
            },
          ]}
        >
          {!user && !spokenCall && speechAvailable() && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={speaking ? "Stop reading" : "Read aloud"}
              hitSlop={8}
              onPress={() => (speaking ? onStop() : onListen(message.id, text))}
              style={[s.row, { gap: 5 }]}
            >
              {speaking ? (
                <Square size={12} fill={colors.muted} strokeWidth={0} />
              ) : (
                <Volume2 size={14} color={colors.muted} />
              )}
              <Text style={s.small}>{speaking ? "Stop" : "Listen"}</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              copied ? "Copied" : `${canCopy ? "Copy" : "Share"} ${user ? "message" : "reply"}`
            }
            hitSlop={8}
            onPress={() => onCopy(message.id, user ? text : plainText(text))}
            style={[s.row, { gap: 5 }]}
          >
            {copied ? (
              <Check size={14} color={colors.greenDark} />
            ) : (
              <Copy size={14} color={colors.muted} />
            )}
            <Text style={s.small} accessibilityLiveRegion="polite">
              {copied ? "Copied" : canCopy ? "Copy" : "Share"}
            </Text>
          </Pressable>
          {readOnly ? null : confirming ? (
            <>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => onDelete(message.id)}
              >
                <Text style={[s.small, { color: colors.danger, fontWeight: "600" }]}>
                  Delete message
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => onAskDelete(undefined)}
              >
                <Text style={s.small}>Keep</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete this message"
              hitSlop={8}
              onPress={() => onAskDelete(message.id)}
              style={{ opacity: 0.55 }}
            >
              <Trash2 size={13} color={colors.muted} />
            </Pressable>
          )}
        </View>
      )}
      <BrowserRunContext value={{ running, active, fresh, shown }}>
        {toolCalls.map((toolCall, index) => (
          <View key={toolCall.id}>{renderToolCall({ toolCall, toolMessage: results[index] })}</View>
        ))}
      </BrowserRunContext>
    </View>
  );
}

/** A small label on the chat's background, with its own backing over a backdrop (which can be bright). */
export function SceneLabel({ text }: { text: string }) {
  return (
    <View
      style={{
        alignSelf: "center",
        paddingHorizontal: 10,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: glass ? colors.card : "transparent",
      }}
    >
      <Text style={[s.small, { fontWeight: "600" }, glass && { color: colors.mutedStrong }]}>
        {text}
      </Text>
    </View>
  );
}

/** The line between the chat's current part and an earlier one shown above it. */
export function EarlierDivider({ label }: { label: string }) {
  return (
    <View style={[s.row, { gap: 10, marginVertical: 6 }]}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
      <SceneLabel text={label} />
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
    </View>
  );
}

// This device's copy of the end of each chat, shown the moment the chat opens while the rest
// loads. Up to CACHE_MESSAGES visible messages (with their cards' results), at most CACHE_BYTES.
const CACHE_PREFIX = "openmuse.chat.";
const CACHE_MESSAGES = 30;
const CACHE_BYTES = 400_000;
export function readChatCache(threadId: string): Message[] {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_PREFIX + threadId);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as Message[]) : [];
  } catch {
    return [];
  }
}
const CACHE_INDEX = "openmuse.chat-copies";
const CACHE_CHATS = 5;
/** Keeps copies of only the few chats used most recently, so the site's storage never fills. */
function rememberCopy(threadId: string) {
  const storage = globalThis.localStorage;
  if (!storage) return;
  let recent: string[] = [];
  try {
    recent = JSON.parse(storage.getItem(CACHE_INDEX) ?? "[]") as string[];
  } catch {
    recent = [];
  }
  recent = [threadId, ...recent.filter((id) => id !== threadId)];
  for (const old of recent.slice(CACHE_CHATS)) storage.removeItem(CACHE_PREFIX + old);
  storage.setItem(CACHE_INDEX, JSON.stringify(recent.slice(0, CACHE_CHATS)));
}
/** Drops chats' copies (the main chat's earlier parts, which never open on their own). */
export function forgetChatCopies(threadIds: string[]) {
  try {
    for (const id of threadIds) globalThis.localStorage?.removeItem(CACHE_PREFIX + id);
  } catch {
    // Nothing to drop.
  }
}
export function writeChatCache(threadId: string, messages: Message[], hidden: Set<string>) {
  try {
    rememberCopy(threadId);
    const kept = messages.filter((m) => !hidden.has(m.id));
    let shown = 0;
    let start = kept.length;
    while (start > 0 && shown < CACHE_MESSAGES) {
      start--;
      const role = kept[start]?.role;
      if (role === "user" || role === "assistant") shown++;
    }
    for (let from = start; from < kept.length; from += 4) {
      const text = JSON.stringify(kept.slice(from));
      if (text.length <= CACHE_BYTES || from + 4 >= kept.length) {
        if (text.length <= CACHE_BYTES)
          globalThis.localStorage?.setItem(CACHE_PREFIX + threadId, text);
        return;
      }
    }
  } catch {
    // Full or private storage: the chat just loads the usual way.
  }
}
