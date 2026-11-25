import { z } from "zod";
import type { ThreadStore } from "./data-controls.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { type CallEar, saysAll, saysHedge, saysNo, saysYes } from "./voice-approval.ts";

/**
 * "Forget everything about X" (owner, 2026-11-25: privacy you can prove, the thing Meta can't
 * credibly offer). Muse's forget keeps the original messages and its agent is told not to say so;
 * Neddy's finds every place it keeps the topic, shows the list, and deletes exactly what the person
 * confirms. It says plainly what it can't reach (the chat service's own copy of a message until
 * the chat itself is deleted, jobs and files).
 */

/** What can be forgotten one by one, and how each is named in the list. */
const KINDS = {
  memories: { label: "Memory", name: (v: Record<string, unknown>) => String(v.text ?? "") },
  persona: {
    label: "About you",
    name: (v: Record<string, unknown>) => String(v.value ?? ""),
  },
  people: {
    label: "Person",
    name: (v: Record<string, unknown>) =>
      `${String(v.name ?? "")}${v.relation ? ` (${String(v.relation)})` : ""}`,
  },
  commitments: {
    label: "Plan",
    name: (v: Record<string, unknown>) => String(v.title ?? ""),
  },
  "email-views": {
    label: "Saved email",
    name: (v: Record<string, unknown>) =>
      `${String(v.subject ?? "(no subject)")}${v.from ? `, from ${String(v.from).replace(/\s*<.*>$/, "")}` : ""}`,
  },
  "voice-sessions": {
    label: "Saved call",
    name: (v: Record<string, unknown>) =>
      `Call on ${new Date(String(v.startedAt ?? v.endedAt ?? "")).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })}`,
  },
  meetings: {
    label: "Recording",
    name: (v: Record<string, unknown>) => String(v.title ?? "A recording"),
  },
} as const;
type Kind = keyof typeof KINDS;
const isKind = (kind: string): kind is Kind => kind in KINDS;

export interface ForgetItem {
  /** `kind:id`, what the person confirms. */
  key: string;
  kind: Kind;
  /** "Memory", "Plan", … */
  label: string;
  name: string;
}

export const forgetTopic = z
  .string()
  .trim()
  .min(2, "Say what to forget, in a word or two")
  .max(80, "Keep it to a few words");

/** A whole-word, any-case match for the topic ("Dana" finds "dana's", not "Danaher"). */
export function topicPattern(topic: string) {
  const words = forgetTopic
    .parse(topic)
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(^|[^\\p{L}\\p{N}])${words.join("[\\s\\-_]+")}(?=$|[^\\p{L}\\p{N}])`, "iu");
}

/** The words a person or the agent wrote in a stored message, never its ids. */
function wordsOf(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => wordsOf(item, depth + 1)).join(" ");
  if (typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .filter(
      ([key]) =>
        !/^(id|key|messageId|threadId|toolCallId|link|url|hash|createdAt|updatedAt|savedAt)$/i.test(
          key,
        ),
    )
    .map(([, item]) => wordsOf(item, depth + 1))
    .join(" ");
}

interface ChatMessage {
  id: string;
  role: string;
  content?: unknown;
  toolCalls?: { id: string; function?: { arguments?: string } }[];
  toolCallId?: string;
}

/**
 * The messages to hide so a chat no longer holds the topic. A tool's result can't go on its own
 * (the model refuses a call without its result), so the reply that made the call goes, and its
 * results with it (`withoutHidden`).
 */
export function messagesToHide(messages: ChatMessage[], pattern: RegExp) {
  const callers = new Map<string, string>();
  for (const message of messages)
    for (const call of message.toolCalls ?? []) callers.set(call.id, message.id);
  const ids = new Set<string>();
  for (const message of messages) {
    if (!pattern.test(wordsOf({ content: message.content, calls: message.toolCalls }))) continue;
    const caller = message.toolCallId ? callers.get(message.toolCallId) : undefined;
    ids.add(caller ?? message.id);
  }
  return [...ids];
}

export class Forgetting {
  constructor(
    private readonly db: Store,
    private readonly threads: ThreadStore = {},
    /** Deletes a recording with its audio (meetings.ts), so nothing of it is left in storage. */
    private readonly removeMeeting?: (owner: string, id: string) => Promise<unknown>,
  ) {}
  /** Every chat this person has, the main chat's current part included. */
  private async chats(owner: string) {
    const ids = new Set<string>();
    const main = await this.db.get<{ threadId: string }>(owner, "conversation-settings", "main");
    if (main?.threadId) ids.add(main.threadId);
    if (this.threads.listThreads) {
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await this.threads.listThreads({
          userId: owner,
          agentId: "default",
          includeArchived: true,
          limit: 100,
          cursor,
        });
        for (const thread of result.threads) ids.add(thread.id);
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
    }
    return [...ids];
  }
  /** Messages in each chat (and in the main chat's older parts) that mention the topic. */
  private async chatMatches(owner: string, pattern: RegExp) {
    const found: { threadId: string; ids: string[] }[] = [];
    const hidden = new Set(
      (await this.db.list<{ threadId: string; messageId: string }>(owner, "hidden-messages")).map(
        (m) => `${m.threadId}:${m.messageId}`,
      ),
    );
    for (const threadId of await this.chats(owner).catch(() => [])) {
      const result = await this.threads
        .getThreadMessages?.({ threadId, userId: owner })
        .catch(() => undefined);
      const messages = (result?.messages ?? []) as unknown as ChatMessage[];
      const ids = messagesToHide(messages, pattern).filter(
        (id) => !hidden.has(`${threadId}:${id}`),
      );
      if (ids.length) found.push({ threadId, ids });
    }
    const pages: { threadId: string; ids: string[] }[] = [];
    for (const page of await this.db.list<{
      id: string;
      threadId: string;
      messages: ChatMessage[];
    }>(owner, "main-pages")) {
      const ids = messagesToHide(page.messages ?? [], pattern);
      if (ids.length) pages.push({ threadId: page.threadId, ids });
    }
    return { found, pages };
  }
  /** What mentions the topic: each item to confirm, and how many chat messages do. */
  async find(owner: string, topic: string) {
    const pattern = topicPattern(topic);
    const items: ForgetItem[] = [];
    for (const kind of Object.keys(KINDS) as Kind[]) {
      for (const value of await this.db.list<Record<string, unknown>>(owner, kind)) {
        if (!pattern.test(wordsOf(value))) continue;
        const name = KINDS[kind].name(value).replace(/\s+/g, " ").trim().slice(0, 140);
        items.push({ key: `${kind}:${String(value.id)}`, kind, label: KINDS[kind].label, name });
      }
    }
    const chats = await this.chatMatches(owner, pattern);
    const messages =
      chats.found.reduce((sum, chat) => sum + chat.ids.length, 0) +
      chats.pages.reduce((sum, page) => sum + page.ids.length, 0);
    return { topic: topic.trim(), items, messages };
  }
  /**
   * Forgets exactly the items confirmed (only ones that still mention the topic: a key from
   * somewhere else is refused), and the chat messages too when asked. Summaries that mention the
   * topic are always dropped: they're written again without it.
   */
  async forget(owner: string, topic: string, keys: string[], messages: boolean) {
    const pattern = topicPattern(topic);
    const found = await this.find(owner, topic);
    const allowed = new Set(found.items.map((item) => item.key));
    const wrong = keys.filter((key) => !allowed.has(key));
    if (wrong.length)
      throw new AppError(
        `${wrong.length === 1 ? "One of those isn’t" : "Some of those aren’t"} in what was found for “${found.topic}”. Look again and confirm from the new list.`,
        422,
      );
    let forgot = 0;
    for (const key of keys) {
      const [kind = "", ...rest] = key.split(":");
      const id = rest.join(":");
      if (!isKind(kind)) continue;
      if (kind === "meetings" && this.removeMeeting) await this.removeMeeting(owner, id);
      else await this.db.remove(owner, kind, id);
      forgot++;
    }
    for (const summary of await this.db.list<{ id: string }>(owner, "chat-summaries"))
      if (pattern.test(wordsOf(summary))) await this.db.remove(owner, "chat-summaries", summary.id);
    let hidden = 0;
    if (messages) {
      const chats = await this.chatMatches(owner, pattern);
      for (const chat of chats.found)
        for (const messageId of chat.ids) {
          await this.db.put(owner, "hidden-messages", {
            id: `${chat.threadId}:${messageId}`,
            threadId: chat.threadId,
            messageId,
            createdAt: new Date().toISOString(),
          });
          hidden++;
        }
      // The main chat's older parts are kept here, so their messages are taken out for good.
      for (const page of chats.pages) {
        const saved = await this.db.get<{
          id: string;
          threadId: string;
          messages: ChatMessage[];
          summary?: string;
        }>(owner, "main-pages", page.threadId);
        if (!saved) continue;
        const gone = new Set(page.ids);
        const calls = new Set(
          saved.messages
            .filter((m) => gone.has(m.id))
            .flatMap((m) => (m.toolCalls ?? []).map((c) => c.id)),
        );
        const kept = saved.messages.filter(
          (m) => !gone.has(m.id) && !(m.toolCallId && calls.has(m.toolCallId)),
        );
        hidden += page.ids.length;
        const { summary, ...rest } = saved;
        await this.db.put(owner, "main-pages", {
          ...rest,
          messages: kept,
          ...(summary && !pattern.test(summary) ? { summary } : {}),
        });
      }
      for (const chat of chats.found) await this.db.remove(owner, "chat-summaries", chat.threadId);
    }
    return { topic: found.topic, forgot, messages: hidden };
  }
}

export const forgetInstructions =
  " When the person asks you to forget someone or something (“forget everything about my ex”, “delete what you know about the Smith deal”), call forget_about with the topic first: it lists what Neddy remembers that mentions it (memories, About you facts, people, plans, saved emails, saved calls, recordings) and how many chat messages do, and gives a `say` line and a confirmId. Say the `say` line and wait. When they answer, call forget_about again with the confirmId and the keys they said yes to (all of them only when they say all), and messages true only if they want the chat messages gone too; it goes through only when their own words say yes. Afterwards say exactly what was forgotten, and plainly what wasn’t: finished jobs and files that mention it stay until they delete them, and the company that stores their chats keeps a copy of a removed message until they delete that chat.";

/** A list that was shown and is waiting for the person's yes. */
interface Pending {
  topic: string;
  keys: string[];
  messages: number;
  /** The person's message the list answered (in the chat): their yes has to come after it. */
  turn?: string;
  at: number;
}
const TEN_MINUTES = 10 * 60_000;

/** What the forget tool knows about the turn it runs in. */
export interface ForgetTurn {
  /** The person's latest message in this chat: its id and words. */
  latest(): { id?: string; words: string };
  /** On a live call, their own spoken words after a read-back (voice-approval.ts). */
  ear?: CallEar;
  /** A call's hand-over: the words in it are the voice's, so without an ear nothing is deleted. */
  call?: boolean;
  now?: () => number;
}

const pending = new Map<string, Pending>();

function listWords(found: { topic: string; items: ForgetItem[]; messages: number }) {
  const shown = found.items.slice(0, 5).map((item) => `${item.label.toLowerCase()}: ${item.name}`);
  const more = found.items.length > 5 ? `, and ${found.items.length - 5} more` : "";
  const things = found.items.length
    ? `${found.items.length === 1 ? "1 thing" : `${found.items.length} things`} about ${found.topic} (${shown.join("; ")}${more})`
    : "";
  const chats = found.messages
    ? `${found.messages === 1 ? "1 chat message that mentions" : `${found.messages} chat messages that mention`} ${found.topic}`
    : "";
  return [things, chats].filter(Boolean).join(", and ");
}

const VERB = /\b(forget|delete|remove|erase)\b/i;
/** "don't forget", "do not delete", "never remove": a forget word with a no just before it. */
const NEGATED_VERB =
  /\b(don'?t|do not|never|not|no)\b(\W+\w+){0,2}?\W+(forget|delete|remove|erase)\b/i;
/**
 * Whether the person's own words confirm a forget (usability review, 2026-11-25). A forget word
 * counts as yes only when no "don't" comes just before it; any no, keep, nothing or anything
 * refuses, except "forget these but keep the plan" while they're choosing some; and an answer
 * about another topic ("forget everything about Sam") never confirms this one.
 */
export function forgetAnswer(
  words: string,
  topic: string,
  choosing: boolean,
): "yes" | "no" | "unclear" | "other topic" {
  const about = /\babout\s+(?:my\s+|the\s+|our\s+)?([\p{L}'’-]+)/iu.exec(words)?.[1]?.toLowerCase();
  if (
    about &&
    !/^(him|her|them|it|that|this|those|these|everything|all|anything|nothing)$/.test(about) &&
    !topicPattern(topic).test(words)
  )
    return "other topic";
  if (saysHedge(words)) return "no";
  const verbYes = VERB.test(words) && !NEGATED_VERB.test(words);
  const yes = (saysYes(words) || verbYes) && !NEGATED_VERB.test(words);
  const no = saysNo(words) || /\b(keep|nothing|anything)\b/i.test(words);
  const butKeep =
    verbYes && /\b(but|except|apart from)\b/i.test(words) && !/\b(sure|know)\b/i.test(words);
  if (no && !(butKeep && choosing)) return "no";
  return yes ? "yes" : "unclear";
}

export function forgetToolSpecs(forgetting: Forgetting, owner: string, turn: ForgetTurn) {
  const now = turn.now ?? Date.now;
  return [
    {
      name: "forget_about",
      description:
        "Forget a person or topic from what Neddy remembers. First call with only `topic`: returns each item that mentions it (memories, About you facts, people, plans, saved emails, saved calls, recordings, each with a key), how many chat messages mention it, a `say` line and a confirmId; nothing is deleted. Say the `say` line and wait for their answer. Then call again with the confirmId, the `keys` they said yes to, and `messages: true` only if they want the chat messages gone too. It goes through only when their own words say yes; never decide for them.",
      parameters: z.object({
        topic: forgetTopic,
        confirmId: z.string().max(80).optional(),
        keys: z.array(z.string().max(200)).max(200).optional(),
        messages: z.boolean().optional(),
      }),
      execute: async (input: {
        topic: string;
        confirmId?: string;
        keys?: string[];
        messages?: boolean;
      }) => {
        for (const [id, waiting] of pending)
          if (now() - waiting.at > TEN_MINUTES) pending.delete(id);
        if (!input.confirmId) {
          const found = await forgetting.find(owner, input.topic);
          if (!found.items.length && !found.messages)
            return { ...found, say: "Nothing Neddy remembers mentions that." };
          const confirmId = `forget-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          pending.set(`${owner}:${confirmId}`, {
            topic: found.topic,
            keys: found.items.map((item) => item.key),
            messages: found.messages,
            turn: turn.latest().id,
            at: now(),
          });
          turn.ear?.readBack([confirmId]);
          return {
            ...found,
            confirmId,
            say: `I found ${listWords(found)}. Should I forget ${found.items.length + (found.messages ? 1 : 0) > 1 ? "all of it, or just some" : "it"}? It can’t be undone.`,
            next: "Nothing is deleted yet. Say `say`, then wait for their answer.",
          };
        }
        const key = `${owner}:${input.confirmId}`;
        const waiting = pending.get(key);
        if (!waiting || waiting.topic.toLowerCase() !== input.topic.trim().toLowerCase())
          return {
            error:
              "That list has expired or was for something else. Call forget_about with only the topic again and read the new list back.",
          };
        // Only the person's own words count: on a call what they said after the read-back, in the
        // chat a new message of theirs after the list.
        let words = "";
        if (turn.ear) {
          const heard = turn.ear.heard();
          if (!heard?.ids.includes(input.confirmId))
            return { error: "Read the list back first (call forget_about with only the topic)." };
          words = heard.said.join(" ").trim();
        } else if (turn.call) {
          return {
            error:
              "This call can’t confirm a forget by voice. Say they can do it in the chat, or under You › Account, in Privacy and your data.",
          };
        } else {
          const latest = turn.latest();
          if (latest.id && latest.id === waiting.turn)
            return { error: "They haven’t answered yet. Say the list and wait for their reply." };
          words = latest.words.trim();
        }
        if (!words) return { error: "They haven’t answered yet. Wait for them to say yes or no." };
        const keys = input.keys ?? [];
        const unknown = keys.filter((k) => !waiting.keys.includes(k));
        if (unknown.length)
          return { error: "Only what was in the list can be forgotten. Look again for the rest." };
        const forgetAll = keys.length + (input.messages ? 1 : 0);
        const offered = waiting.keys.length + (waiting.messages ? 1 : 0);
        const choosing = forgetAll < offered;
        const verdict = forgetAnswer(words, waiting.topic, choosing);
        if (verdict === "other topic")
          return {
            error:
              "Their answer is about something else, so nothing was forgotten. Start again with forget_about and that topic.",
            heard: words,
          };
        if (verdict !== "yes")
          return {
            error:
              verdict === "no"
                ? "They said no or to keep something, so nothing was forgotten."
                : "Their answer wasn’t a clear yes, so nothing was forgotten. Ask again.",
            heard: words,
          };
        if (forgetAll > 1 && !choosing && !saysAll(words))
          return {
            error:
              "They didn’t say all of it. Ask whether to forget all of it, or which ones; nothing was forgotten.",
            heard: words,
          };
        pending.delete(key);
        turn.ear?.forget();
        const result = await forgetting.forget(owner, waiting.topic, keys, input.messages ?? false);
        return {
          ...result,
          note: "Gone from what Neddy remembers and from their chats. Finished jobs and files that mention it stay until they’re deleted, and the company that stores their chats keeps a copy of a removed message until that chat is deleted.",
        };
      },
    },
  ];
}
