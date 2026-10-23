import { createHash } from "node:crypto";
import type { Found } from "../../../packages/domain/src/redact.ts";
import { hiddenNames } from "../../../packages/domain/src/redact.ts";
import type { Store } from "./db.ts";

/**
 * What was hidden from the model while it answered, kept per question so the "What I used"
 * button under an answer can say so. Only the kinds and a count are kept, never the values.
 */
export interface Receipt {
  id: string;
  threadId: string;
  /** The message the person sent: the answer under it is this receipt's. */
  userMessageId: string;
  at: string;
  /** The same moment under the name the store sorts by. */
  date: string;
  /** Said in words ("a card number and a password"); empty when nothing was hidden. */
  hidden: string;
  /** How many things were hidden. */
  hiddenCount: number;
}
export interface TurnReceipt {
  at: string;
  hidden: string;
  hiddenCount: number;
}

const KIND = "receipts";
/** A thread's receipts shown at once: more than the chat ever draws. */
const PER_THREAD = 400;

export class Receipts {
  constructor(
    private readonly db: Store,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private id(threadId: string, userMessageId: string) {
    return createHash("sha1").update(`${threadId}\n${userMessageId}`).digest("hex");
  }
  /** Kept once per question, however many times it is retried (the hidden things are merged). */
  async record(owner: string, threadId: string, userMessageId: string, found: Found[]) {
    const id = this.id(threadId, userMessageId);
    const before = await this.db.get<Receipt>(owner, KIND, id);
    const merged = [...found];
    const receipt: Receipt = {
      id,
      threadId,
      userMessageId,
      at: this.now().toISOString(),
      date: this.now().toISOString(),
      hidden: hiddenNames(merged),
      hiddenCount: Math.max(merged.length, before?.hiddenCount ?? 0),
    };
    if (before && !merged.length) receipt.hidden = before.hidden;
    await this.db.put(owner, KIND, receipt);
    return receipt;
  }
  /** Each question's receipt in a thread, by the message that asked it. */
  async forThread(owner: string, threadId: string) {
    const rows = await this.db.listWhere<Receipt>(owner, KIND, { threadId }, PER_THREAD);
    const turns: Record<string, TurnReceipt> = {};
    for (const row of rows)
      turns[row.userMessageId] = { at: row.at, hidden: row.hidden, hiddenCount: row.hiddenCount };
    return turns;
  }
}
