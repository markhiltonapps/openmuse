/**
 * Past conversations from another assistant's data export (ChatGPT or Claude), reduced to what a
 * person and the assistant said, in order. Shared by the app, which reads large exports on the
 * device, and the server, which reads small ones sent as a file.
 */

export type ChatSource = "chatgpt" | "claude";
export interface PastChatMessage {
  role: "user" | "assistant";
  text: string;
  at?: string;
}
export interface PastChatInput {
  /** The conversation's id in the source app. */
  sourceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: PastChatMessage[];
  /** How many messages in the middle of a very long chat were left out. */
  omitted?: number;
}

export const CHAT_SOURCES: Record<ChatSource, string> = { chatgpt: "ChatGPT", claude: "Claude" };
/** One message is cut here, and a whole chat keeps its start and end up to this much. */
const MESSAGE_CHARS = 20000;
const CHAT_CHARS = 300000;

/** A zip's files that hold conversations, in either export. */
export const CONVERSATION_FILE = /(^|\/)conversations[^/]*\.json$/i;

const iso = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return new Date(value).toISOString();
  return undefined;
};
const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** A long chat keeps its first third and its last two thirds, noting how much was left out. */
function fit(messages: PastChatMessage[]): Pick<PastChatInput, "messages" | "omitted"> {
  const cut = messages.map((m) => ({ ...m, text: m.text.slice(0, MESSAGE_CHARS) }));
  const total = cut.reduce((sum, m) => sum + m.text.length, 0);
  if (total <= CHAT_CHARS) return { messages: cut };
  const head: PastChatMessage[] = [];
  let size = 0;
  for (const message of cut) {
    if (size + message.text.length > CHAT_CHARS / 3) break;
    head.push(message);
    size += message.text.length;
  }
  const tail: PastChatMessage[] = [];
  size = 0;
  for (let i = cut.length - 1; i >= head.length; i--) {
    const message = cut[i] as PastChatMessage;
    if (size + message.text.length > (CHAT_CHARS * 2) / 3) break;
    tail.unshift(message);
    size += message.text.length;
  }
  return { messages: [...head, ...tail], omitted: cut.length - head.length - tail.length };
}

interface ChatgptNode {
  parent?: string | null;
  message?: {
    author?: { role?: string };
    recipient?: string;
    create_time?: number | null;
    metadata?: { is_visually_hidden_from_conversation?: boolean };
    content?: { content_type?: string; parts?: unknown[]; text?: string };
  } | null;
}
/** The branch the person last saw: from the current message back to the first. */
function chatgptThread(conversation: Record<string, unknown>) {
  const mapping = record(conversation.mapping) as Record<string, ChatgptNode>;
  const chain: ChatgptNode[] = [];
  const seen = new Set<string>();
  let id = text(conversation.current_node);
  while (id && mapping[id] && !seen.has(id)) {
    seen.add(id);
    chain.push(mapping[id] as ChatgptNode);
    id = text(mapping[id]?.parent);
  }
  const nodes = chain.length
    ? chain.reverse()
    : Object.values(mapping).sort(
        (a, b) => (a.message?.create_time ?? 0) - (b.message?.create_time ?? 0),
      );
  return nodes.flatMap((node): PastChatMessage[] => {
    const message = node.message;
    const role = message?.author?.role;
    if (!message || (role !== "user" && role !== "assistant")) return [];
    // Tool calls and hidden setup messages aren't part of the conversation the person saw.
    if (message.recipient && message.recipient !== "all") return [];
    if (message.metadata?.is_visually_hidden_from_conversation) return [];
    const content = message.content ?? {};
    if (content.content_type !== "text" && content.content_type !== "multimodal_text") return [];
    const parts = content.parts ?? [];
    const words = parts.filter((p): p is string => typeof p === "string").join("\n");
    const pictures = parts.some((p) => p && typeof p === "object") ? "[picture]" : "";
    const said = [words, pictures].filter(Boolean).join("\n").trim();
    if (!said) return [];
    const at = iso(message.create_time);
    return [{ role, text: said, ...(at ? { at } : {}) }];
  });
}

function claudeMessages(conversation: Record<string, unknown>) {
  const messages = Array.isArray(conversation.chat_messages) ? conversation.chat_messages : [];
  return messages.flatMap((raw): PastChatMessage[] => {
    const message = record(raw);
    const role =
      message.sender === "human"
        ? "user"
        : message.sender === "assistant"
          ? "assistant"
          : undefined;
    if (!role) return [];
    // Newer exports split a reply into blocks; only its written text is kept, not thinking or tools.
    const blocks = Array.isArray(message.content) ? message.content.map(record) : [];
    const written = blocks
      .filter((block) => block.type === "text")
      .map((block) => text(block.text))
      .join("\n")
      .trim();
    const files = [
      ...(Array.isArray(message.attachments) ? message.attachments : []),
      ...(Array.isArray(message.files) ? message.files : []),
    ]
      .map((file) => text(record(file).file_name))
      .filter(Boolean)
      .map((name) => `[attached: ${name}]`);
    const said = [written || text(message.text).trim(), ...files].filter(Boolean).join("\n");
    if (!said) return [];
    const at = iso(message.created_at);
    return [{ role, text: said, ...(at ? { at } : {}) }];
  });
}

/** Which assistant an export's conversations came from, or undefined when it's neither. */
export function exportSource(conversations: unknown[]): ChatSource | undefined {
  const sample = conversations.slice(0, 20).map(record);
  if (sample.some((c) => "mapping" in c)) return "chatgpt";
  if (sample.some((c) => "chat_messages" in c)) return "claude";
  return undefined;
}

/** Reads conversations.json from a ChatGPT or Claude export. Throws when it's neither. */
export function parseChatExport(data: unknown): { source: ChatSource; chats: PastChatInput[] } {
  const conversations = Array.isArray(data) ? data : [];
  const source = exportSource(conversations);
  if (!source)
    throw new Error(
      conversations.length === 0 && Array.isArray(data)
        ? "There are no chats in this export."
        : "This doesn't look like a ChatGPT or Claude export. Upload the .zip ChatGPT or Claude emailed you.",
    );
  const chats = conversations.flatMap((raw, index): PastChatInput[] => {
    const conversation = record(raw);
    const messages =
      source === "chatgpt" ? chatgptThread(conversation) : claudeMessages(conversation);
    if (!messages.length) return [];
    const first = messages[0]?.at;
    const last = messages[messages.length - 1]?.at;
    const createdAt =
      iso(source === "chatgpt" ? conversation.create_time : conversation.created_at) ??
      first ??
      new Date(0).toISOString();
    const updatedAt =
      iso(source === "chatgpt" ? conversation.update_time : conversation.updated_at) ??
      last ??
      createdAt;
    const named = text(source === "chatgpt" ? conversation.title : conversation.name).trim();
    const opening = messages.find((m) => m.role === "user")?.text ?? "";
    const sourceId =
      text(conversation.conversation_id) ||
      text(conversation.id) ||
      text(conversation.uuid) ||
      `${createdAt}-${index}`;
    return [
      {
        sourceId: sourceId.slice(0, 120),
        title: (named || opening.split("\n")[0] || "Untitled chat").slice(0, 200),
        createdAt,
        updatedAt,
        ...fit(messages),
      },
    ];
  });
  return { source, chats };
}

/** What the person wrote, newest chats first, up to `limit` characters: for suggesting memories. */
export function ownWords(chats: PastChatInput[], limit = 60000) {
  const kept: string[] = [];
  let size = 0;
  for (const chat of [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    for (const message of chat.messages) {
      if (message.role !== "user") continue;
      const said = message.text.slice(0, 2000);
      if (size + said.length > limit) return kept.join("\n---\n");
      kept.push(said);
      size += said.length + 5;
    }
  return kept.join("\n---\n");
}
