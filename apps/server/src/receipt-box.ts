import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import type { Files } from "./files.ts";
import { localDay } from "./health.ts";
import {
  addDays,
  daysBetween,
  type LookAtReceipt,
  RECEIPT_CATEGORIES,
  readReceipt,
} from "./receipt-reader.ts";
import type { ReminderService } from "./reminders.ts";

/** The Receipt box: personal receipts the person photographs, checks and files (docs/RECEIPT-BOX-PLAN.md). */
const KIND = "receipt-box";
const SETTINGS_KIND = "receipt-box-settings";
export const KEEP_FOR = ["Return window", "Warranty", "Tax time", "Insurance"] as const;
/** After this many receipts checked in a row without a change, auto-filing is offered. */
export const GOOD_STREAK = 10;
/** A safety ceiling against runaway use (a stuck loop), not a plan limit. */
const READS_PER_HOUR = 30;
const READS_PER_DAY = 120;

export type ReceiptOutcome =
  | "to-check"
  | "filed"
  | "not-a-receipt"
  | "several"
  | "unreadable"
  | "duplicate";

export interface BoxReceipt {
  id: string;
  status: "to-check" | "filed";
  merchant: string | null;
  /** YYYY-MM-DD on the receipt. */
  date: string | null;
  total: number | null;
  /** Other readings of the total when the person should choose. */
  candidates: number[];
  tax: number | null;
  currency: string;
  category: string;
  /** Last four digits only. */
  paidLast4: string | null;
  keepFor: string[];
  returnDays: number | null;
  returnBy: string | null;
  /** open until the person says they returned it or are keeping it. */
  returnState: "open" | "returned" | "keeping";
  returnPolicy: string | null;
  warranty: boolean;
  note: string;
  /** Fields the reader wasn't sure of, shown marked on the Check it card. */
  unsure: string[];
  fileId: string;
  source: "photo" | "chat" | "call";
  autoFiled: boolean;
  /** Set when the person changed anything, so a "good" check isn't counted. */
  edited: boolean;
  duplicateOf?: string;
  reminderId?: string;
  /** When the reminder fires (ISO), so screens say the real day. */
  reminderAt?: string;
  createdAt: string;
  filedAt?: string;
}

interface Settings {
  id: "settings";
  autoFile: boolean;
  /** The offer has been answered (yes or not now), so it isn't made again. */
  offerAnswered: boolean;
  /** Receipts checked in a row without a change. */
  streak: number;
}

export interface ReceiptSnap {
  outcome: ReceiptOutcome;
  receipt?: BoxReceipt;
  fileId?: string;
}

export const receiptChangeSchema = z.object({
  merchant: z.string().trim().min(1).max(120).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  total: z.number().min(0).max(1_000_000).optional(),
  tax: z.number().min(0).max(1_000_000).nullable().optional(),
  category: z.enum(RECEIPT_CATEGORIES).optional(),
  keepFor: z.array(z.enum(KEEP_FOR)).max(4).optional(),
  /** YYYY-MM-DD, or null for "no return window". */
  returnBy: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  note: z.string().trim().max(300).optional(),
});

export interface ReceiptQuery {
  text?: string;
  merchant?: string;
  category?: string;
  keepFor?: string;
  /** YYYY-MM or YYYY-MM-DD prefix of the receipt's date. */
  month?: string;
  status?: "to-check" | "filed";
  limit?: number;
}

const money = (value: number | null, currency = "USD") =>
  value === null
    ? "an unknown amount"
    : currency === "USD"
      ? `$${value.toFixed(2)}`
      : `${value.toFixed(2)} ${currency}`;

export class ReceiptBox {
  private readonly reads = new Map<string, number[]>();
  constructor(
    private readonly db: Store,
    private readonly files: Files,
    private readonly timeZone: (owner: string) => Promise<string>,
    /** The reading model for this person; undefined when none is set up. */
    private readonly look: (owner: string) => LookAtReceipt | undefined,
    private readonly reminders?: ReminderService,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether reading is possible at all (a model is set up). */
  get available() {
    return this.look("") !== undefined;
  }

  private async settings(owner: string): Promise<Settings> {
    return (
      (await this.db.get<Settings>(owner, SETTINGS_KIND, "settings")) ?? {
        id: "settings",
        autoFile: false,
        offerAnswered: false,
        streak: 0,
      }
    );
  }
  private async today(owner: string) {
    return localDay(this.now(), await this.timeZone(owner));
  }
  private claimRead(owner: string) {
    const now = this.now();
    const recent = (this.reads.get(owner) ?? []).filter((at) => now - at < 24 * 3_600_000);
    if (
      recent.length >= READS_PER_DAY ||
      recent.filter((at) => now - at < 3_600_000).length >= READS_PER_HOUR
    )
      throw new AppError("That’s a lot of receipts at once. Try again in a little while.", 429);
    this.reads.set(owner, [...recent, now]);
  }

  /** Saves a photo, reads it and puts the result where it belongs. Nothing is merged or guessed. */
  async snap(
    owner: string,
    photo: { bytes: Uint8Array; name: string; mimeType: string },
    source: BoxReceipt["source"] = "photo",
  ): Promise<ReceiptSnap> {
    if (!this.look(owner))
      throw new AppError("Reading receipts isn’t set up on this server yet.", 503);
    this.claimRead(owner);
    const file = await this.files.import(owner, photo.name, photo.bytes, "receipt-box");
    return this.process(owner, file.id, file.mimeType, photo.bytes, source, true);
  }
  /** Reads a picture already in Files (a photo sent in the chat); a picture that isn't a receipt stays where it was. */
  async snapFile(
    owner: string,
    fileId: string,
    source: BoxReceipt["source"] = "chat",
  ): Promise<ReceiptSnap> {
    if (!this.look(owner))
      throw new AppError("Reading receipts isn’t set up on this server yet.", 503);
    const file = await this.files.get(owner, fileId);
    if (!file.mimeType.startsWith("image/"))
      throw new AppError("That isn’t a picture, so I can’t read a receipt from it.", 422);
    const existing = (await this.db.list<BoxReceipt>(owner, KIND)).find((r) => r.fileId === fileId);
    if (existing)
      return { outcome: existing.status === "filed" ? "filed" : "to-check", receipt: existing };
    this.claimRead(owner);
    return this.process(
      owner,
      fileId,
      file.mimeType,
      await this.files.bytes(owner, fileId),
      source,
      false,
    );
  }

  private async process(
    owner: string,
    fileId: string,
    mimeType: string,
    bytes: Uint8Array,
    source: BoxReceipt["source"],
    ours: boolean,
  ): Promise<ReceiptSnap> {
    const look = this.look(owner) as LookAtReceipt;
    const today = await this.today(owner);
    let result: Awaited<ReturnType<typeof readReceipt>>;
    try {
      result = await readReceipt(look, { bytes, mimeType }, { today });
    } catch {
      // The photo is kept so "Try again" or "Save the photo anyway" has something to work with.
      return { outcome: "unreadable", fileId };
    }
    const { read, reconciled, unclear } = result;
    if (!read.isReceipt) {
      if (ours) await this.discard(owner, fileId);
      return { outcome: "not-a-receipt" };
    }
    if (read.multipleReceipts) {
      if (ours) await this.discard(owner, fileId);
      return { outcome: "several" };
    }
    const settings = await this.settings(owner);
    const returnDays = read.returnDays;
    const keepFor = [
      ...(returnDays ? ["Return window"] : []),
      ...(read.warrantyMentioned ? ["Warranty"] : []),
    ];
    const receipt: BoxReceipt = {
      id: randomUUID(),
      status: "to-check",
      merchant: read.merchant,
      date: read.date,
      total: reconciled.total,
      candidates: reconciled.status === "pick" ? reconciled.candidates : [],
      tax: read.tax,
      currency: read.currency ?? "USD",
      category: read.category,
      paidLast4: read.paymentLast4,
      keepFor,
      returnDays,
      returnBy: read.date && returnDays ? addDays(read.date, returnDays) : null,
      returnState: "open",
      returnPolicy: read.returnPolicyText,
      warranty: read.warrantyMentioned,
      note: read.notes,
      unsure: unclear,
      fileId,
      source,
      autoFiled: false,
      edited: false,
      createdAt: new Date(this.now()).toISOString(),
    };
    const duplicate = await this.findDuplicate(owner, receipt);
    if (duplicate) {
      receipt.duplicateOf = duplicate.id;
      await this.db.put(owner, KIND, receipt);
      return { outcome: "duplicate", receipt };
    }
    // Auto-filing only when everything was read clearly; anything unsure always stops at Check it.
    const sure =
      settings.autoFile &&
      unclear.length === 0 &&
      reconciled.status === "sure" &&
      receipt.merchant &&
      receipt.date &&
      receipt.total !== null;
    if (sure) {
      receipt.status = "filed";
      receipt.autoFiled = true;
      receipt.filedAt = receipt.createdAt;
      await this.scheduleReminder(owner, receipt);
    }
    await this.db.put(owner, KIND, receipt);
    return { outcome: sure ? "filed" : "to-check", receipt };
  }

  private async discard(owner: string, fileId: string) {
    const file = await this.files.get(owner, fileId).catch(() => null);
    if (file) {
      await this.files.erase(file);
      await this.db.remove(owner, "files", fileId);
    }
  }

  private async findDuplicate(owner: string, receipt: BoxReceipt) {
    if (!receipt.merchant || !receipt.date || receipt.total === null) return undefined;
    const merchant = receipt.merchant.toLowerCase();
    return (await this.db.list<BoxReceipt>(owner, KIND)).find(
      (other) =>
        other.id !== receipt.id &&
        other.merchant?.toLowerCase() === merchant &&
        other.date === receipt.date &&
        other.total !== null &&
        Math.abs(other.total - (receipt.total as number)) < 0.005,
    );
  }

  async get(owner: string, id: string) {
    const receipt = await this.db.get<BoxReceipt>(owner, KIND, id);
    if (!receipt) throw new AppError("That receipt isn’t in your Receipt box any more.", 404);
    return receipt;
  }
  /** A fresh signed link to the photo (links expire, so one is made each time it's opened). */
  async photoUrl(owner: string, receipt: BoxReceipt) {
    const file = await this.files.get(owner, receipt.fileId).catch(() => null);
    return file ? this.files.signed(owner, file).url : null;
  }

  async list(owner: string, query: ReceiptQuery = {}) {
    const text = query.text?.trim().toLowerCase();
    const found = (await this.db.list<BoxReceipt>(owner, KIND))
      .filter((r) => !query.status || r.status === query.status)
      .filter(
        (r) => !query.merchant || r.merchant?.toLowerCase().includes(query.merchant.toLowerCase()),
      )
      .filter((r) => !query.category || r.category.toLowerCase() === query.category.toLowerCase())
      .filter(
        (r) =>
          !query.keepFor || r.keepFor.some((k) => k.toLowerCase() === query.keepFor?.toLowerCase()),
      )
      .filter((r) => !query.month || r.date?.startsWith(query.month))
      .filter(
        (r) =>
          !text ||
          `${r.merchant ?? ""} ${r.category} ${r.note} ${r.total ?? ""} ${r.keepFor.join(" ")}`
            .toLowerCase()
            .includes(text),
      )
      .sort((a, b) => (b.date ?? b.createdAt).localeCompare(a.date ?? a.createdAt));
    return found.slice(0, Math.min(query.limit ?? 200, 500));
  }

  /** What the screens and the home card show. */
  async summary(owner: string) {
    const all = await this.list(owner);
    const today = await this.today(owner);
    const month = today.slice(0, 7);
    const filed = all.filter((r) => r.status === "filed");
    const inMonth = filed.filter((r) => r.date?.startsWith(month));
    const settings = await this.settings(owner);
    const closingSoon = filed
      .filter((r) => r.returnBy && r.returnState === "open")
      .map((r) => ({
        id: r.id,
        merchant: r.merchant,
        total: r.total,
        returnBy: r.returnBy as string,
        days: daysBetween(today, r.returnBy as string),
      }))
      .filter((r) => r.days >= 0 && r.days <= 14)
      .sort((a, b) => a.days - b.days);
    return {
      available: this.available,
      receipts: all,
      toCheck: all.filter((r) => r.status === "to-check").length,
      filedCount: filed.length,
      filedThisMonth: inMonth.length,
      // Only US dollars are added together; amounts in other currencies are never mixed in.
      monthTotal:
        Math.round(
          inMonth.filter((r) => r.currency === "USD").reduce((sum, r) => sum + (r.total ?? 0), 0) *
            100,
        ) / 100,
      closingSoon,
      autoFile: {
        on: settings.autoFile,
        // Offered once, after enough good checks in a row, and not again once answered.
        offer: !settings.autoFile && !settings.offerAnswered && settings.streak >= GOOD_STREAK,
      },
    };
  }

  async update(owner: string, id: string, raw: unknown) {
    const change = receiptChangeSchema.parse(raw);
    const current = await this.get(owner, id);
    const next: BoxReceipt = { ...current, edited: true };
    if (change.merchant !== undefined) next.merchant = change.merchant;
    if (change.date !== undefined) next.date = change.date;
    if (change.total !== undefined) {
      next.total = change.total;
      next.candidates = [];
    }
    if (change.tax !== undefined) next.tax = change.tax;
    if (change.category !== undefined) next.category = change.category;
    if (change.keepFor !== undefined) next.keepFor = change.keepFor;
    if (change.note !== undefined) next.note = change.note;
    if (change.returnBy !== undefined) {
      next.returnBy = change.returnBy;
      next.returnDays =
        change.returnBy && next.date ? daysBetween(next.date, change.returnBy) : null;
      next.returnState = "open";
      if (change.returnBy && !next.keepFor.includes("Return window"))
        next.keepFor = [...next.keepFor, "Return window"];
      if (!change.returnBy) next.keepFor = next.keepFor.filter((k) => k !== "Return window");
    }
    // What the person fixed is no longer in doubt.
    next.unsure = next.unsure.filter(
      (field) =>
        !(
          (field === "merchant" && change.merchant !== undefined) ||
          (field === "date" && change.date !== undefined) ||
          (field === "total" && change.total !== undefined) ||
          (field === "tax" && change.tax !== undefined)
        ),
    );
    if (next.status === "filed" && (change.returnBy !== undefined || change.date !== undefined)) {
      await this.cancelReminder(owner, next);
      await this.scheduleReminder(owner, next);
    }
    return this.db.put(owner, KIND, next);
  }

  /** The person files it (after checking). A change-free check counts toward the auto-file offer. */
  async file(owner: string, id: string) {
    const receipt = await this.get(owner, id);
    if (receipt.status === "filed") return receipt;
    if (receipt.total === null || !receipt.merchant)
      throw new AppError("Add the store and the total before filing this one.", 422);
    if (receipt.candidates.length > 1)
      throw new AppError("Choose which total is right before filing this one.", 422);
    const next: BoxReceipt = {
      ...receipt,
      status: "filed",
      filedAt: new Date(this.now()).toISOString(),
    };
    await this.scheduleReminder(owner, next);
    await this.db.put(owner, KIND, next);
    const settings = await this.settings(owner);
    await this.db.put(owner, SETTINGS_KIND, {
      ...settings,
      streak: receipt.edited || receipt.unsure.length ? 0 : settings.streak + 1,
    });
    return next;
  }

  /** Takes a filed receipt back to To check (an auto-filed one that was wrong, or a mistake). */
  async unfile(owner: string, id: string) {
    const receipt = await this.get(owner, id);
    if (receipt.status !== "filed") return receipt;
    await this.cancelReminder(owner, receipt);
    const next: BoxReceipt = {
      ...receipt,
      status: "to-check",
      autoFiled: false,
      filedAt: undefined,
      reminderId: undefined,
    };
    if (receipt.autoFiled) {
      // An auto-filed one taken back means auto-filing got something wrong: start counting again.
      const settings = await this.settings(owner);
      await this.db.put(owner, SETTINGS_KIND, { ...settings, streak: 0 });
    }
    return this.db.put(owner, KIND, next);
  }

  async setReturn(owner: string, id: string, state: "returned" | "keeping" | "snooze") {
    const receipt = await this.get(owner, id);
    if (state === "snooze") {
      await this.cancelReminder(owner, receipt);
      const next = { ...receipt };
      if (
        this.reminders &&
        receipt.returnBy &&
        this.now() < Date.parse(`${receipt.returnBy}T23:59:00Z`)
      ) {
        try {
          const reminder = await this.reminders.set(
            owner,
            { text: this.reminderText(receipt), inMinutes: 24 * 60 },
            `receipt-box:${id}:snooze:${localDay(this.now(), await this.timeZone(owner))}`,
          );
          next.reminderId = reminder.id;
          next.reminderAt = reminder.dueAt;
        } catch {
          // A reminder that can't be made leaves the date on the receipt.
        }
      }
      return this.db.put(owner, KIND, next);
    }
    await this.cancelReminder(owner, receipt);
    return this.db.put(owner, KIND, {
      ...receipt,
      returnState: state,
      reminderId: undefined,
      reminderAt: undefined,
    });
  }

  /** Removes the photo, the details and any reminder. */
  async remove(owner: string, id: string) {
    const receipt = await this.get(owner, id);
    await this.cancelReminder(owner, receipt);
    await this.discard(owner, receipt.fileId);
    await this.db.remove(owner, KIND, id);
    return { removed: id };
  }

  async setAutoFile(owner: string, on: boolean) {
    const settings = await this.settings(owner);
    await this.db.put(owner, SETTINGS_KIND, { ...settings, autoFile: on, offerAnswered: true });
    return { on };
  }

  private reminderText(receipt: BoxReceipt) {
    return `${receipt.merchant ?? "A"} return window closes ${receipt.returnBy} (${money(receipt.total, receipt.currency)}). Return it, or tell me you're keeping it.`;
  }
  /** Three days before the return date at 9am if that's still ahead, else that morning; never fails the filing. */
  private async scheduleReminder(owner: string, receipt: BoxReceipt) {
    if (!this.reminders || !receipt.returnBy || receipt.returnState !== "open") return;
    for (const day of [addDays(receipt.returnBy, -3), receipt.returnBy]) {
      try {
        const reminder = await this.reminders.set(
          owner,
          { text: this.reminderText(receipt), at: `${day}T09:00` },
          `receipt-box:${receipt.id}:${receipt.returnBy}:${this.now()}`,
        );
        receipt.reminderId = reminder.id;
        receipt.reminderAt = reminder.dueAt;
        return;
      } catch {
        // That time has passed (or too many reminders): try the next, then give up quietly.
      }
    }
  }
  private async cancelReminder(owner: string, receipt: BoxReceipt) {
    if (!this.reminders || !receipt.reminderId) return;
    await this.reminders.cancel(owner, receipt.reminderId).catch(() => undefined);
  }
}
