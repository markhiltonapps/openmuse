import { MessageSchema } from "@ag-ui/core";
import { z } from "zod";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/** The most recent messages kept per chat. */
const KEEP = 400;

interface ArchivedChat {
  id: string;
  threadId: string;
  name: string;
  messages: unknown[];
  updatedAt: string;
}

/**
 * Chats kept here as well as in CopilotKit Intelligence, which deletes threads after its plan's
 * retention period (3 days on the free plan). A chat whose thread is gone is restored from here.
 */
export class ChatArchive {
  constructor(private readonly db: Store) {}
  async save(owner: string, threadId: string, raw: unknown) {
    const { messages, name } = z
      .object({ messages: z.array(z.unknown()).max(5000), name: z.string().max(200).optional() })
      .parse(raw);
    // Only chat messages are kept; anything else the chat carries is left out.
    const valid = messages.filter((message) => MessageSchema.safeParse(message).success);
    if (!valid.length) return { saved: 0 };
    const kept = valid.slice(-KEEP);
    const first = valid.find(
      (m): m is { role: string; content: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as { role?: unknown }).role === "user" &&
        typeof (m as { content?: unknown }).content === "string",
    );
    await this.db.put(owner, "chat-archive", {
      id: threadId,
      threadId,
      name: name?.trim() || first?.content.replace(/\s+/g, " ").trim().slice(0, 60) || "Chat",
      messages: kept,
      updatedAt: new Date().toISOString(),
    } satisfies ArchivedChat);
    return { saved: kept.length };
  }
  async messages(owner: string, threadId: string) {
    return (await this.db.get<ArchivedChat>(owner, "chat-archive", threadId))?.messages ?? [];
  }
  /** Saved chats, newest first, without their messages. */
  async list(owner: string) {
    return (await this.db.list<ArchivedChat>(owner, "chat-archive"))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ threadId, name, updatedAt, messages }) => ({
        threadId,
        name,
        updatedAt,
        count: messages.length,
      }));
  }
  async remove(owner: string, threadId: string) {
    if (!(await this.db.take(owner, "chat-archive", threadId)))
      throw new AppError("Chat not found", 404);
    return { ok: true };
  }
}
