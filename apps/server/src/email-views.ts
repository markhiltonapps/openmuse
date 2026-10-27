import { createHash } from "node:crypto";
import type { Store } from "./db.ts";
import { emailFromEvent } from "./mail-alerts.ts";

/** An email Neddy read for the person, kept for a week so its card can open it in full. */
export interface EmailView {
  id: string;
  app: "gmail" | "outlook";
  messageId: string;
  threadId?: string;
  from: string;
  to?: string;
  date?: string;
  subject: string;
  body: string;
  link?: string;
  savedAt: string;
}
/**
 * What the chat card shows for each email (the full email stays on the server for a week; its
 * link back to the mailbox stays with the card).
 */
export type EmailCardItem = Pick<EmailView, "id" | "app" | "from" | "subject" | "date" | "link"> & {
  preview: string;
  /**
   * The mailbox's own ids for this email. `id` above is only this app's card id (a 32-character
   * code); the agent once passed it to Gmail as a message id and Gmail answered "Invalid ids value".
   */
  messageId: string;
  threadId?: string;
};

/**
 * Gmail message ids the agent has really read, per person. Gmail quietly skips a message id that
 * doesn't exist ("silently skipped", while answering success), so a move built on ids the agent
 * made up looked done and moved nothing. A change to mail is only sent with ids that were read.
 */
const seenIds = new Map<string, Set<string>>();
const MAX_SEEN = 20000;
const GMAIL_ID = /^[0-9a-f]{10,20}$/i;

/** Notes every Gmail message id in an answer (the full answer, not the part the agent saw). */
export function rememberMailIds(owner: string, data: unknown, depth = 0) {
  const ids = seenIds.get(owner) ?? new Set<string>();
  seenIds.set(owner, ids);
  const visit = (value: unknown, level: number) => {
    if (level > 8 || ids.size >= MAX_SEEN) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, level + 1);
      return;
    }
    if (!record(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if ((key === "messageId" || key === "message_id" || key === "id") && typeof item === "string")
        ids.add(item);
      else visit(item, level + 1);
    }
  };
  visit(data, depth);
}

/** The message ids in a Gmail call's arguments that weren't in anything read for this person. */
export function unreadMailIds(owner: string, args: unknown): string[] {
  const read = seenIds.get(owner);
  const wrong: string[] = [];
  const visit = (value: unknown, level: number) => {
    if (level > 4 || !record(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (/^(ids|messageIds|message_ids|messageId|message_id)$/.test(key)) {
        for (const id of Array.isArray(item) ? item : [item])
          if (typeof id === "string" && !(GMAIL_ID.test(id) && read?.has(id))) wrong.push(id);
      } else visit(item, level + 1);
    }
  };
  visit(args, 0);
  return wrong;
}

/** What a card's id stands for: Gmail and Outlook never see it. */
const CARD_ID = /^[0-9a-f]{32}$/;
/**
 * The same arguments with any card id (from an email card) swapped for the email's own message id,
 * so a move, label or delete that was given the card's id still reaches the right email.
 */
export async function unwrapCardIds(
  value: unknown,
  find: (id: string) => Promise<{ messageId: string } | null | undefined>,
  depth = 0,
): Promise<unknown> {
  if (depth > 6) return value;
  if (typeof value === "string")
    return CARD_ID.test(value) ? ((await find(value))?.messageId ?? value) : value;
  if (Array.isArray(value))
    return Promise.all(value.map((item) => unwrapCardIds(item, find, depth + 1)));
  if (record(value))
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, item]) => [
          key,
          await unwrapCardIds(item, find, depth + 1),
        ]),
      ),
    );
  return value;
}

const KEEP_DAYS = 7;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** HTML (Outlook's body) as plain text. */
function plain(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function addresses(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      const inner = (record(item) ? (item.emailAddress ?? item) : {}) as Record<string, unknown>;
      return text(inner.address ?? inner.email) || text(inner.name);
    })
    .filter(Boolean)
    .join(", ");
}
function dateOf(all: Record<string, unknown>) {
  const raw = all.messageTimestamp ?? all.receivedDateTime ?? all.internalDate ?? all.date;
  const ms =
    typeof raw === "number" || (typeof raw === "string" && /^\d{10,13}$/.test(raw))
      ? Number(raw) * (String(raw).length === 10 ? 1000 : 1)
      : Date.parse(text(raw));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/** The emails in a Gmail or Outlook answer, however deeply it wraps them. */
export function emailsIn(
  data: unknown,
  app: "gmail" | "outlook",
): Omit<EmailView, "id" | "savedAt">[] {
  const found: Omit<EmailView, "id" | "savedAt">[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || found.length >= 25) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 50)) visit(item, depth + 1);
      return;
    }
    if (!record(value)) return;
    const looksLikeEmail =
      (text(value.messageId) || text(value.message_id) || text(value.id)) &&
      (value.subject !== undefined || record(value.preview)) &&
      (value.sender !== undefined || value.from !== undefined || value.messageText !== undefined);
    if (looksLikeEmail) {
      const email = emailFromEvent(app, value);
      const raw =
        text(value.messageText) ||
        text(value.message_text) ||
        (record(value.body) ? text(value.body.content) : text(value.body)) ||
        email.preview;
      // Outlook's body, and Gmail's for newsletters, can be HTML.
      const body = /<(html|body|div|p|br|table|span)\b/i.test(raw) ? plain(raw) : raw;
      const threadId = text(value.threadId) || text(value.thread_id) || text(value.conversationId);
      found.push({
        app,
        messageId: email.messageId,
        ...(threadId ? { threadId } : {}),
        from: email.from,
        ...(addresses(value.to ?? value.toRecipients)
          ? { to: addresses(value.to ?? value.toRecipients).slice(0, 500) }
          : {}),
        ...(dateOf(value) ? { date: dateOf(value) } : {}),
        subject: email.subject,
        body: body.slice(0, 20000),
        ...(app === "gmail"
          ? {
              link: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId || email.messageId)}`,
            }
          : text(value.webLink)
            ? { link: text(value.webLink) }
            : {}),
      });
      return;
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(data, 0);
  return found;
}

/** Emails read for the person, so a card in the chat can open one in full over the chat. */
export class EmailViews {
  constructor(
    private readonly db: Store,
    private readonly now: () => number = Date.now,
  ) {}
  /** Keeps these emails for a week; returns what each card shows. */
  async save(owner: string, emails: Omit<EmailView, "id" | "savedAt">[]): Promise<EmailCardItem[]> {
    const savedAt = new Date(this.now()).toISOString();
    const items: EmailCardItem[] = [];
    for (const email of emails) {
      const id = createHash("sha256")
        .update(`${email.app}:${email.messageId || email.subject + email.date}`)
        .digest("hex")
        .slice(0, 32);
      await this.db.put(owner, "email-views", { ...email, id, savedAt } satisfies EmailView);
      items.push({
        id,
        app: email.app,
        from: email.from,
        subject: email.subject,
        ...(email.date ? { date: email.date } : {}),
        ...(email.link ? { link: email.link } : {}),
        preview: email.body.replace(/\s+/g, " ").trim().slice(0, 160),
        messageId: email.messageId,
        ...(email.threadId ? { threadId: email.threadId } : {}),
      });
    }
    void this.prune(owner).catch(() => undefined);
    return items;
  }
  async get(owner: string, id: string) {
    return this.db.get<EmailView>(owner, "email-views", id);
  }
  /** After a week they're gone: the email is still in the person's mailbox. */
  private async prune(owner: string) {
    const cutoff = this.now() - KEEP_DAYS * 86_400_000;
    for (const view of await this.db.list<EmailView>(owner, "email-views"))
      if (Date.parse(view.savedAt) < cutoff) await this.db.remove(owner, "email-views", view.id);
  }
}
