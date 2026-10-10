import { randomUUID } from "node:crypto";
import type { ChatSummaries } from "./chat-summary.ts";
import type { Store } from "./db.ts";

/**
 * The main chat is one conversation to the person, but it's kept in pages: once the current page
 * passes PAGE_BYTES it starts a fresh CopilotKit thread the next time the app opens it. Opening
 * and sending then carry only the current page, so neither slows down nor hits the server's body
 * limit as months go by. Each finished page is saved here whole, with a running summary of
 * everything up to its end, which the agent is given on the next page; the app shows earlier
 * pages on request ("Show earlier conversation") and the agent can search them.
 */
export const PAGE_BYTES = 1_000_000;

export interface PageRef {
  threadId: string;
  /** When the page was closed. */
  endedAt: string;
  count: number;
}
export interface MainSettings {
  id: "main";
  threadId: string;
  existing: boolean;
  /** Finished pages, oldest first. */
  pages?: PageRef[];
  /** The current page has grown past PAGE_BYTES: start a new one on the next open. */
  turnDue?: boolean;
}
interface SavedPage {
  id: string;
  threadId: string;
  messages: unknown[];
  endedAt: string;
  /** Everything up to the end of this page, for the next one. Written in the background. */
  summary?: string;
}
type Message = { id: string; role: string; content?: unknown };
interface Threads {
  getOrCreateThread(input: { threadId: string; userId: string; agentId: string }): Promise<unknown>;
  getThreadMessages?(input: { threadId: string; userId: string }): Promise<{ messages: unknown[] }>;
}

export const mainSettings = (db: Store, owner: string) =>
  db.get<MainSettings>(owner, "conversation-settings", "main");

/** The newest summary of the main chat's earlier pages (one that failed falls back to older). */
async function newestSummary(db: Store, owner: string, pages: PageRef[]) {
  for (const page of [...pages].reverse().slice(0, 5)) {
    const summary = (await db.get<SavedPage>(owner, "main-pages", page.threadId))?.summary;
    if (summary) return summary;
  }
  return undefined;
}

/** What the agent is told about the main chat's earlier pages: their summary. */
export async function earlierPages(db: Store, owner: string, threadId: string) {
  const main = await mainSettings(db, owner);
  if (!main?.pages?.length || main.threadId !== threadId) return { summary: undefined, pages: 0 };
  return { summary: await newestSummary(db, owner, main.pages), pages: main.pages.length };
}

/**
 * Searches the main chat's earlier pages for search_earlier_chat, newest first, one page at a
 * time, until enough matches are found: every page can be reached without loading them all.
 */
export async function searchEarlierPages(
  db: Store,
  owner: string,
  search: (messages: Message[]) => { from: string; text: string }[],
  limit = 8,
) {
  const main = await mainSettings(db, owner);
  const found: { from: string; text: string; partEnded?: string }[] = [];
  for (const page of [...(main?.pages ?? [])].reverse()) {
    const saved = await db.get<SavedPage>(owner, "main-pages", page.threadId);
    // Not when it was said: a part can cover weeks. Only that it's from before this date.
    const partEnded = `From an older part of the chat, which ended ${page.endedAt}`;
    for (const hit of search((saved?.messages ?? []) as Message[]))
      found.push({ ...hit, partEnded });
    if (found.length >= limit) break;
  }
  return found.slice(0, limit);
}

export class MainPages {
  constructor(
    private readonly db: Store,
    private readonly threads: Threads,
    private readonly chats: Pick<ChatSummaries, "saved" | "merge">,
    /** The app's own copy of a chat, for when CopilotKit can't give the whole page. */
    private readonly backup: (owner: string, threadId: string) => Promise<unknown[]>,
  ) {}
  /** Called with each copy the app saves: marks the main chat for a new page once it's big. */
  async noteSize(owner: string, threadId: string, bytes: number) {
    if (bytes <= PAGE_BYTES) return;
    const main = await mainSettings(this.db, owner);
    if (main && main.threadId === threadId && !main.turnDue)
      await this.db.put(owner, "conversation-settings", { ...main, turnDue: true });
  }
  /** The main chat as the app opens it, starting a new page first when one is due. */
  async open(owner: string): Promise<MainSettings> {
    await this.db.insertIfAbsent(owner, "conversation-settings", {
      id: "main",
      threadId: randomUUID(),
      existing: false,
    });
    const main = await mainSettings(this.db, owner);
    if (!main) throw new Error("Main conversation could not be loaded");
    if (!main.turnDue) return main;
    try {
      return await this.turn(owner, main);
    } catch (error) {
      // The page stays as it is; the next open tries again.
      console.warn(
        `[OpenMuse] Main chat couldn't start a new page: ${error instanceof Error ? error.message : String(error)}`,
      );
      return main;
    }
  }
  private async turn(owner: string, main: MainSettings) {
    const old = main.threadId;
    const whole = await this.threads.getThreadMessages?.({ threadId: old, userId: owner }).then(
      (result) => result.messages,
      () => [],
    );
    const messages = whole?.length ? whole : await this.backup(owner, old);
    const endedAt = new Date().toISOString();
    // The finished page is saved whole before the chat moves on.
    await this.db.put(owner, "main-pages", { id: old, threadId: old, messages, endedAt });
    const next = randomUUID();
    await this.threads.getOrCreateThread({ threadId: next, userId: owner, agentId: "default" });
    const pages = [...(main.pages ?? []), { threadId: old, endedAt, count: messages.length }];
    const turned: MainSettings = { id: "main", threadId: next, existing: true, pages };
    await this.db.put(owner, "conversation-settings", turned);
    console.info(
      `[OpenMuse] Main chat started a new page (owner ${owner.slice(0, 8)}): the last one had ${messages.length} messages`,
    );
    void this.carrySummary(owner, old, messages as Message[], main.pages);
    return turned;
  }
  /** Writes the summary of everything up to the end of the finished page. */
  private async carrySummary(
    owner: string,
    threadId: string,
    messages: Message[],
    before?: PageRef[],
  ) {
    try {
      const previous = before?.length ? await newestSummary(this.db, owner, before) : undefined;
      const saved = await this.chats.saved(owner, threadId);
      const covered = saved ? messages.findIndex((m) => m.id === saved.through) : -1;
      // The chat's own summary covers all but its last stretch; that stretch is merged in. If it
      // has none, only the most recent part fits in one call.
      const unsummarized = messages
        .slice(covered + 1)
        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "tool");
      const rest: Message[] = [];
      let room = 200_000;
      for (const message of unsummarized.reverse()) {
        room -= JSON.stringify(message).length;
        if (room < 0) break;
        rest.unshift(message);
      }
      const start = [previous, covered >= 0 ? saved?.summary : undefined]
        .filter(Boolean)
        .join("\n\n");
      const summary = (
        rest.length ? await this.chats.merge(owner, start, rest as never) : start
      ).trim();
      const page = await this.db.get<SavedPage>(owner, "main-pages", threadId);
      if (page && summary)
        await this.db.put(owner, "main-pages", { ...page, summary: summary.slice(0, 8000) });
    } catch (error) {
      console.warn(
        `[OpenMuse] Main chat page summary failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  /** One finished page's messages, for "Show earlier conversation". */
  async page(owner: string, threadId: string) {
    const main = await mainSettings(this.db, owner);
    if (!main?.pages?.some((page) => page.threadId === threadId)) return undefined;
    return (await this.db.get<SavedPage>(owner, "main-pages", threadId))?.messages;
  }
  /** Forgets every finished page (the main chat was started over). */
  async clear(owner: string, pages: PageRef[] = []) {
    for (const page of pages) await this.db.remove(owner, "main-pages", page.threadId);
  }
}
