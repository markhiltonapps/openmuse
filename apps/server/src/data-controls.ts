import type { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { strToU8, zipSync } from "fflate";
import type { Artifact } from "../../../packages/domain/src/index.ts";
import type { Store } from "./db.ts";
import type { Files } from "./files.ts";

export type ThreadStore = Partial<
  Pick<CopilotKitIntelligence, "listThreads" | "getThreadMessages" | "deleteThread">
>;

/**
 * What a reset keeps: sign-ins to other services, devices for notifications and mail synced from
 * them. Everything the agent knows, made or was asked to do goes.
 */
const KEEP_ON_RESET = [
  "settings",
  "mail",
  "events",
  "imports",
  "credentials",
  "push-subscriptions",
  "app-connector",
  "agent-inbox",
  "usage",
];
/** Never exported: sign-in secrets and internal bookkeeping. */
const NOT_EXPORTED = ["credentials", "push-subscriptions", "app-connector", "computer-state"];
/** Files larger than this in total are listed in the export but not included. */
const MAX_EXPORT_BYTES = 200 * 1024 * 1024;

interface Message {
  id: string;
  role: string;
  toolCalls?: { id: string }[];
  toolCallId?: string;
}
/**
 * A conversation without the messages the person deleted, and without the tool results of a
 * deleted reply (a result whose call is gone would be rejected by the model).
 */
export function withoutHidden<T extends Message>(messages: T[], hidden: Set<string>): T[] {
  if (!hidden.size) return messages;
  const calls = new Set(
    messages
      .filter((m) => hidden.has(m.id))
      .flatMap((m) => m.toolCalls ?? [])
      .map((call) => call.id),
  );
  return messages.filter((m) => !hidden.has(m.id) && !(m.toolCallId && calls.has(m.toolCallId)));
}

/** Message ids the person deleted from one chat. */
export async function hiddenMessages(db: Store, owner: string, threadId: string) {
  const all = await db.list<{ threadId: string; messageId: string }>(owner, "hidden-messages");
  return all.filter((m) => m.threadId === threadId).map((m) => m.messageId);
}

const safe = (name: string) => name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "file";

/** Export, delete a message, and reset: the person's own controls over their data. */
export class DataControls {
  constructor(
    private readonly db: Store,
    private readonly files: Files,
    private readonly threads: ThreadStore = {},
  ) {}
  hidden(owner: string, threadId: string) {
    return hiddenMessages(this.db, owner, threadId);
  }
  /** Removes a message from the chat and from everything the agent sees from now on. */
  async hide(owner: string, threadId: string, messageId: string) {
    await this.db.put(owner, "hidden-messages", {
      id: `${threadId}:${messageId}`,
      threadId,
      messageId,
      createdAt: new Date().toISOString(),
    });
    return { messageIds: await this.hidden(owner, threadId) };
  }
  private async allThreads(owner: string) {
    const found: { id: string; name: string | null }[] = [];
    if (!this.threads.listThreads) return found;
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await this.threads.listThreads({
        userId: owner,
        agentId: "default",
        includeArchived: true,
        limit: 100,
        cursor,
      });
      found.push(...result.threads.map((t) => ({ id: t.id, name: t.name })));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return found;
  }
  /** A zip of everything the person has here: records, chats and files. */
  async export(owner: string): Promise<Uint8Array> {
    const entries: Record<string, Uint8Array> = {};
    const json = (value: unknown) => strToU8(JSON.stringify(value, null, 2));
    const records = await this.db.records(owner, NOT_EXPORTED);
    const kinds = new Map<string, unknown[]>();
    for (const { kind, value } of records) kinds.set(kind, [...(kinds.get(kind) ?? []), value]);
    for (const [kind, values] of kinds) entries[`data/${kind}.json`] = json(values);

    const notes: string[] = [];
    try {
      for (const thread of await this.allThreads(owner)) {
        const { messages } = (await this.threads.getThreadMessages?.({
          threadId: thread.id,
          userId: owner,
        })) ?? { messages: [] };
        entries[`chats/${safe(thread.name ?? "chat")}-${thread.id.slice(0, 8)}.json`] = json({
          id: thread.id,
          name: thread.name,
          messages,
        });
      }
    } catch (error) {
      notes.push(
        `Some chats couldn't be exported: ${error instanceof Error ? error.message : error}`,
      );
    }

    let total = 0;
    for (const { kind, value } of records) {
      if (kind !== "files") continue;
      const file = value as unknown as Artifact;
      if (total + file.size > MAX_EXPORT_BYTES) {
        notes.push(`${file.name} was too large to include; download it from Files.`);
        continue;
      }
      try {
        entries[`files/${file.id.slice(0, 8)}-${safe(file.name)}`] = new Uint8Array(
          await this.files.bytes(owner, file.id),
        );
        total += file.size;
      } catch {
        notes.push(`${file.name} couldn't be read.`);
      }
    }
    entries["README.txt"] = strToU8(
      [
        `Neato_Meca export, ${new Date().toISOString()}`,
        "",
        "data/   everything your agent keeps, one JSON file per kind (memories, tasks, goals,",
        "        routines, reminders, health log, notifications and more)",
        "chats/  your conversations",
        "files/  your files",
        "",
        "Sign-in secrets for connected services are not included.",
        ...(notes.length ? ["", ...notes] : []),
      ].join("\n"),
    );
    return zipSync(entries, { level: 6 });
  }
  /**
   * Starts the agent over for this person: chats, memories, tasks, goals, routines, reminders,
   * files and settings are deleted. Their account, sign-ins to other apps and devices stay.
   */
  async reset(owner: string) {
    let chats = 0;
    for (const thread of await this.allThreads(owner).catch(() => [])) {
      await this.threads
        .deleteThread?.({ threadId: thread.id, userId: owner, agentId: "default" })
        .then(() => chats++)
        .catch(() => undefined);
    }
    const main = await this.db.get<{ threadId: string }>(owner, "conversation-settings", "main");
    if (main)
      await this.threads
        .deleteThread?.({ threadId: main.threadId, userId: owner, agentId: "default" })
        .catch(() => undefined);
    for (const file of await this.db.list<Artifact>(owner, "files"))
      await this.files.erase(file).catch(() => undefined);
    const preferences = await this.db.get<{ id: string }>(owner, "agent-settings", "preferences");
    await this.db.removeAll(owner, KEEP_ON_RESET);
    if (preferences) await this.db.put(owner, "agent-settings", preferences);
    return { ok: true, chats };
  }
}
