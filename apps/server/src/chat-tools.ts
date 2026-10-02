import { z } from "zod";

/**
 * Chats by voice and by asking: open, start, rename, archive, restore, delete or list chats, clear
 * the main chat, and hide or show the other chats. Chats live in the app (CopilotKit's list, the
 * spaces' chats, the app's copies of older ones), so the app reports them here (POST
 * /api/chats/known) and does each action itself when its card appears, in the chat or on a call's
 * screen. Deleting and clearing wait for a tap on that card.
 */

export interface KnownChat {
  id: string;
  name: string;
  kind: "main" | "space" | "other" | "older";
  archived?: boolean;
  /** When it was last used (ISO). */
  lastUsed?: string;
}
export interface ChatDirectory {
  chats: KnownChat[];
  /** The chat on screen. */
  current?: string;
  othersHidden?: boolean;
  updatedAt: string;
}

export const knownChatsSchema = z.object({
  chats: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        name: z.string().trim().min(1).max(200),
        kind: z.enum(["main", "space", "other", "older"]),
        archived: z.boolean().optional(),
        lastUsed: z.string().max(40).optional(),
      }),
    )
    .max(300),
  current: z.string().max(120).optional(),
  othersHidden: z.boolean().optional(),
});

export const chatToolInstructions = ` Chats: besides the main chat, the person can keep other chats, and each space has its own. When they ask to open, start, rename, archive, bring back, delete or list chats, clear the main chat, or show or hide their other chats, call manage_chats: the app does it and shows a card where they are (in the chat or on a call's screen). Deleting a chat or clearing the main chat happens only when they tap Delete (or Clear) on that card, so say it's waiting for their tap. If two chats match, the result has both: say both names and ask which (the card has Open on each). In a typed chat, the switch to another chat happens once your reply is in, so keep the reply to one short sentence. On a call, the chat underneath changes and the call carries on.`;

const ACTIONS = [
  "list",
  "open",
  "start",
  "rename",
  "archive",
  "restore",
  "delete",
  "clear_main",
  "show_other_chats",
  "hide_other_chats",
] as const;
type Action = (typeof ACTIONS)[number];

const parameters = z.object({
  action: z.enum(ACTIONS),
  chat: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe(
      'Which chat, in their words: part of its name, a space\'s name, "main", or "this" for the one they\'re in. Leave it out to mean the chat they\'re in.',
    ),
  name: z
    .string()
    .trim()
    .max(80)
    .optional()
    .describe("rename: the new name. start: what the new chat is about, as its name"),
  firstMessage: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe("start: what to send in the new chat, when they said what it's for"),
  archived: z.boolean().optional().describe("list: the archived chats instead"),
});
type Input = z.infer<typeof parameters>;

const SMALL = new Set([
  "my",
  "the",
  "a",
  "an",
  "chat",
  "chats",
  "conversation",
  "about",
  "on",
  "for",
  "that",
  "one",
  "with",
  "to",
  "of",
  "and",
]);
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !SMALL.has(word));

/** The chats that best fit what they said: the one, or a few to choose from, or none. */
export function matchChats(directory: ChatDirectory, query: string | undefined, archived = false) {
  const said = query?.trim().toLowerCase() ?? "";
  const pool = directory.chats.filter((chat) => !!chat.archived === archived);
  if (!said || /^(this|this one|this chat|the current one|current|here)$/.test(said)) {
    const current = directory.chats.find((chat) => chat.id === directory.current);
    return current ? [current] : [];
  }
  const asked = words(said).filter(
    (word) => !(archived && /^(archived|back|bring|restore)$/.test(word)),
  );
  // "Bring back my archived chat": the only one, or a few to choose from.
  if (archived && !asked.length) return pool.slice(0, 4);
  const scored = pool
    .map((chat) => {
      const name = words(chat.name);
      const score = asked.filter((word) =>
        name.some((part) => part === word || (word.length > 2 && part.startsWith(word))),
      ).length;
      return { chat, score };
    })
    .filter((item) => item.score > 0);
  if (!scored.length) {
    // "Main", "my main chat", "the everyday one".
    if (/\bmain\b|everyday/.test(said)) return pool.filter((chat) => chat.kind === "main");
    return [];
  }
  const best = Math.max(...scored.map((item) => item.score));
  return scored
    .filter((item) => item.score === best)
    .slice(0, 4)
    .map((item) => item.chat);
}

/**
 * A name for a new chat from its first message, so the list never says "Untitled": "Can you find
 * a plumber for the upstairs bath this week?" becomes "Find a plumber for the upstairs bath".
 */
export function chatNameFrom(text: string) {
  const cleaned = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hey|hi|hello|ok|okay)\b[,!.]?\s*/i, "")
    .replace(/^(can|could|would|will) you (please )?/i, "")
    .replace(/^please,? /i, "")
    .replace(
      /^(i need you to|i need to|i want to|i'd like to|i would like to|help me|let's|lets) /i,
      "",
    );
  const short = cleaned
    .split(" ")
    .slice(0, 7)
    .join(" ")
    .replace(/[?.!,;:…]+$/, "");
  const name = short.length > 48 ? short.slice(0, 48).replace(/\s+\S*$/, "") : short;
  return name.length > 1 ? name.charAt(0).toUpperCase() + name.slice(1) : undefined;
}

const brief = (chat: KnownChat) => ({ id: chat.id, name: chat.name, kind: chat.kind });

export function chatToolSpecs(
  owner: string,
  load: (owner: string) => Promise<ChatDirectory | null | undefined>,
) {
  return [
    {
      name: "manage_chats",
      description:
        "Open, start, rename, archive, restore, delete or list the person's chats, clear the main chat, or show or hide their other chats in the Chats list. The app does it and shows a card; deleting and clearing wait for their tap.",
      parameters,
      execute: async (input: Input) => {
        const at = new Date().toISOString();
        const action: Action = input.action;
        if (action === "start")
          return {
            action,
            ...(input.name ? { name: input.name } : {}),
            ...(input.firstMessage ? { firstMessage: input.firstMessage } : {}),
            at,
            shown: true,
          };
        if (action === "show_other_chats" || action === "hide_other_chats")
          return { action, at, shown: true };
        const directory = await load(owner).catch(() => undefined);
        if (!directory?.chats.length)
          return {
            action,
            shown: false,
            note: "The app hasn't shared their chats yet (it does once it's open). Ask them to open the app and try again.",
          };
        const main = directory.chats.find((chat) => chat.kind === "main");
        if (action === "clear_main")
          return main
            ? { action, chat: brief(main), at, shown: true }
            : { action, shown: false, note: "There's no main chat to clear." };
        if (action === "list") {
          const chats = directory.chats.filter((chat) => !!chat.archived === !!input.archived);
          return {
            action,
            archived: !!input.archived,
            current: directory.current,
            chats: chats.map((chat) => ({ ...brief(chat), lastUsed: chat.lastUsed })),
            ...(directory.othersHidden ? { othersHidden: true } : {}),
            at,
            shown: true,
          };
        }
        const matches = matchChats(directory, input.chat, action === "restore");
        if (!matches.length) {
          const names = directory.chats
            .filter((chat) => !!chat.archived === (action === "restore"))
            .map((chat) => chat.name)
            .slice(0, 12);
          return {
            action,
            shown: false,
            note: `No ${action === "restore" ? "archived " : ""}chat matches “${input.chat ?? "this"}”.${names.length ? ` Their ${action === "restore" ? "archived " : ""}chats: ${names.join(", ")}.` : ""} Ask which one they mean.`,
          };
        }
        if (matches.length > 1)
          return { action: "choose", for: action, matches: matches.map(brief), at, shown: true };
        const [chat] = matches;
        if (!chat) return { action, shown: false };
        if (action !== "open") {
          if (chat.kind === "main")
            return {
              action,
              shown: false,
              note:
                action === "delete"
                  ? "The main chat can't be deleted; it can be cleared (clear_main), which empties it."
                  : `The main chat can't be ${action === "rename" ? "renamed" : action === "archive" ? "archived" : "restored"}.`,
            };
          if (chat.kind === "space")
            return {
              action,
              shown: false,
              note: "A space's chat goes with its space and keeps its name; change it from the space instead.",
            };
          if (chat.kind === "older" && action !== "delete")
            return {
              action,
              shown: false,
              note: "That's an older chat the app keeps a copy of: it can only be opened or deleted.",
            };
        }
        if (action === "rename" && !input.name)
          return { action, shown: false, note: `Ask what to call “${chat.name}”.` };
        return {
          action,
          chat: brief(chat),
          ...(action === "rename" ? { name: input.name } : {}),
          at,
          shown: true,
        };
      },
    },
  ];
}
