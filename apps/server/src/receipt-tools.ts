import { z } from "zod";
import { type BoxReceipt, KEEP_FOR, type ReceiptBox, type ReceiptSnap } from "./receipt-box.ts";
import { RECEIPT_CATEGORIES } from "./receipt-reader.ts";

export const receiptToolInstructions =
  ' The Receipt box keeps the person\'s personal receipts. When they send a photo of a receipt, or say "file this receipt", call receipt_box with do "read" and the photo\'s file id; a Check it card with the store, date, total and category appears on their screen, and they file it with one tap or by saying "file it". Say what you read in one short sentence and name anything marked unsure (never present an unsure number as certain). When they correct a field ("it\'s $61.21", "make it Dining") use do "fix"; "file it" is do "file"; "check it later" needs nothing; "undo that" is do "unfile". For "where\'s my Best Buy receipt", "what did I spend at Costco in October" or "what\'s waiting to check" use do "find" or "to_check" and never answer from memory. "Remind me to return this by the tenth" is do "fix" with returnBy (YYYY-MM-DD), which sets the reminder once it\'s filed. Only the last four card digits are ever kept. Several receipts in one photo can\'t be filed together: ask for them one at a time. The Receipt box is in Spaces, and its card is on Home.';

const brief = (receipt: BoxReceipt) => ({
  id: receipt.id,
  status: receipt.status,
  merchant: receipt.merchant,
  date: receipt.date,
  total: receipt.total,
  currency: receipt.currency,
  category: receipt.category,
  keepFor: receipt.keepFor,
  returnBy: receipt.returnBy,
  paidLast4: receipt.paidLast4,
  ...(receipt.candidates.length > 1 ? { chooseBetween: receipt.candidates } : {}),
  ...(receipt.unsure.length ? { unsure: receipt.unsure } : {}),
  ...(receipt.autoFiled ? { filedByNeddy: true } : {}),
  ...(receipt.duplicateOf ? { looksLikeOneAlreadyFiled: receipt.duplicateOf } : {}),
});

/** What the agent is told about a read: the facts, in words, never a claim about what's on screen. */
function snapResult(snap: ReceiptSnap) {
  switch (snap.outcome) {
    case "not-a-receipt":
      return {
        outcome: "not a receipt",
        say: "That doesn’t look like a receipt, so nothing was filed.",
      };
    case "several":
      return {
        outcome: "several receipts",
        say: "There’s more than one receipt in that photo, so nothing was filed. Ask for them one at a time.",
      };
    case "unreadable":
      return {
        outcome: "couldn't read it",
        say: "The photo couldn’t be read. Try again with the receipt flat and the light on it.",
      };
    case "duplicate":
      return {
        outcome: "duplicate",
        receipt: snap.receipt ? brief(snap.receipt) : undefined,
        say: "This looks like one that’s already in the box. They can skip it or keep both.",
      };
    case "filed":
      return {
        outcome: "filed automatically",
        receipt: snap.receipt ? brief(snap.receipt) : undefined,
        say: "Read clearly and filed (marked Filed by Neddy). They can undo it.",
      };
    default:
      return {
        outcome: "ready to check",
        receipt: snap.receipt ? brief(snap.receipt) : undefined,
        say: "Read, and waiting for them to check and file it.",
      };
  }
}

/** One tool for the whole Receipt box, so the agent's tool list stays short. */
export function receiptToolSpec(
  box: ReceiptBox,
  owner: string,
  options: { onCall?: boolean } = {},
) {
  /** A card exists in the chat for these; on a call the agent says it aloud instead. */
  const shown = options.onCall ? {} : { shown: "On their screen." };
  return {
    name: "receipt_box",
    description:
      "The person's Receipt box (personal receipts). do: read (photo file id: read it and put it in To check), fix (change store, date, total, category, keepFor, returnBy or note), file (file a checked receipt), unfile (take it back to To check), to_check (what's waiting), find (search by text, merchant, category, month YYYY-MM, keepFor, status).",
    parameters: z.object({
      do: z.enum(["read", "fix", "file", "unfile", "to_check", "find"]),
      fileId: z.string().max(200).optional().describe("For read: the photo's file id"),
      id: z
        .string()
        .max(100)
        .optional()
        .describe(
          "The receipt's id; for fix, file and unfile. Leave out to mean the one just read.",
        ),
      merchant: z.string().max(120).optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("YYYY-MM-DD"),
      total: z.number().min(0).max(1_000_000).optional(),
      category: z.enum(RECEIPT_CATEGORIES).optional(),
      keepFor: z.array(z.enum(KEEP_FOR)).max(4).optional(),
      returnBy: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional()
        .describe("YYYY-MM-DD; null for no return window"),
      note: z.string().max(300).optional(),
      text: z.string().max(120).optional().describe("For find: words to look for"),
      month: z
        .string()
        .regex(/^\d{4}-\d{2}(-\d{2})?$/)
        .optional()
        .describe("For find: YYYY-MM"),
      status: z.enum(["to-check", "filed"]).optional(),
    }),
    execute: async (args: {
      do: "read" | "fix" | "file" | "unfile" | "to_check" | "find";
      fileId?: string;
      id?: string;
      text?: string;
      month?: string;
      status?: "to-check" | "filed";
      merchant?: string;
      category?: string;
      keepFor?: string[];
      date?: string;
      total?: number;
      returnBy?: string | null;
      note?: string;
    }) => {
      if (!box.available) return { error: "Reading receipts isn’t set up on this server yet." };
      const latest = async () => (await box.list(owner, { status: "to-check", limit: 1 }))[0];
      const target = async () => args.id ?? (await latest())?.id;
      switch (args.do) {
        case "read": {
          if (!args.fileId) return { error: "I need the receipt photo to read." };
          const snap = await box.snapFile(owner, args.fileId, options.onCall ? "call" : "chat");
          const result = snapResult(snap);
          return snap.receipt ? { ...result, ...shown } : result;
        }
        case "fix": {
          const id = await target();
          if (!id) return { error: "There’s no receipt waiting to fix." };
          const { do: _do, fileId: _f, id: _i, text: _t, month: _m, status: _s, ...change } = args;
          return { receipt: brief(await box.update(owner, id, change)), ...shown };
        }
        case "file": {
          const id = await target();
          if (!id) return { error: "There’s no receipt waiting to file." };
          const filed = await box.file(owner, id);
          return {
            receipt: brief(filed),
            ...(filed.returnBy
              ? { reminder: `A return reminder is set for ${filed.returnBy}.` }
              : {}),
            ...shown,
          };
        }
        case "unfile": {
          const id = args.id ?? (await box.list(owner, { status: "filed", limit: 1 }))[0]?.id;
          if (!id) return { error: "Nothing is filed yet." };
          return { receipt: brief(await box.unfile(owner, id)), ...shown };
        }
        case "to_check": {
          const waiting = await box.list(owner, { status: "to-check" });
          return {
            count: waiting.length,
            receipts: waiting.slice(0, 10).map(brief),
            ...(waiting.length ? shown : {}),
          };
        }
        default: {
          const found = await box.list(owner, {
            text: args.text,
            merchant: args.merchant,
            category: args.category,
            keepFor: args.keepFor?.[0],
            month: args.month,
            status: args.status,
            limit: 25,
          });
          const total = found.reduce((sum, r) => sum + (r.total ?? 0), 0);
          return {
            count: found.length,
            total: Math.round(total * 100) / 100,
            receipts: found.map(brief),
            ...(found.length ? shown : { none: true }),
          };
        }
      }
    },
  };
}
