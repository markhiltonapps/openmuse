/**
 * The Receipt box's plain logic (docs/RECEIPT-BOX-PLAN.md): the server's shapes, money and date
 * words, what is doubtful on a receipt, what blocks filing, grouping and filtering the list. No
 * React in here, so tests can run it. Dates are always the person's own calendar days built from
 * their local parts (never toISOString().slice(0, 10), which is UTC's day).
 */

export const CATEGORIES = [
  "Groceries",
  "Dining",
  "Home",
  "Health",
  "Kids",
  "Pets",
  "Gifts",
  "Travel",
  "Subscriptions",
  "Other",
] as const;
export const KEEP_FOR = ["Return window", "Warranty", "Tax time", "Insurance"] as const;
export type KeepFor = (typeof KEEP_FOR)[number];

/** A receipt as the server keeps it (apps/server/src/receipt-box.ts, BoxReceipt). */
export interface Receipt {
  id: string;
  status: "to-check" | "filed";
  merchant: string | null;
  /** YYYY-MM-DD on the receipt. */
  date: string | null;
  total: number | null;
  candidates: number[];
  tax: number | null;
  currency: string;
  category: string;
  paidLast4: string | null;
  keepFor: string[];
  returnDays: number | null;
  returnBy: string | null;
  returnState: "open" | "returned" | "keeping";
  returnPolicy: string | null;
  warranty: boolean;
  note: string;
  unsure: string[];
  fileId: string;
  source: "photo" | "chat" | "call";
  autoFiled: boolean;
  edited: boolean;
  duplicateOf?: string;
  reminderId?: string;
  /** When the reminder fires (ISO), so the real day is said, never a computed one. */
  reminderAt?: string;
  createdAt: string;
  filedAt?: string;
}

export interface ClosingSoon {
  id: string;
  merchant: string | null;
  total: number | null;
  returnBy: string;
  days: number;
}

/** GET /api/receipt-box. */
export interface BoxSummary {
  available: boolean;
  receipts: Receipt[];
  toCheck: number;
  filedCount: number;
  filedThisMonth: number;
  monthTotal: number;
  closingSoon: ClosingSoon[];
  autoFile: { on: boolean; offer: boolean };
}

export type SnapOutcome =
  | "to-check"
  | "filed"
  | "not-a-receipt"
  | "several"
  | "unreadable"
  | "duplicate";
/** POST /api/receipt-box/snap. */
export interface SnapAnswer {
  outcome: SnapOutcome;
  receipt?: Receipt;
  fileId?: string;
}

/** Longest side of the copy of a photo that is uploaded. */
export const MAX_SIDE = 1600;

/** The size a picture is shrunk to: its longest side at most `max`, never enlarged. */
export function fitWithin(width: number, height: number, max = MAX_SIDE) {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height, scaled: false };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}

// ---------------------------------------------------------------- money

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "$61.27", "$1,284.50" (USD) or "61.27 EUR" (anything else). */
export function moneyText(value: number | null, currency = "USD"): string {
  if (value === null || !Number.isFinite(value)) return "No total";
  const fixed = Math.abs(value).toFixed(2);
  const [whole = "0", cents = "00"] = fixed.split(".");
  const text = `${group(whole)}.${cents}`;
  const sign = value < 0 ? "-" : "";
  return currency === "USD" ? `${sign}$${text}` : `${sign}${text} ${currency}`;
}

/** "$1,284": a month's total, whole dollars (cents only below $100). */
export function moneyWhole(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  return Math.abs(value) < 100
    ? moneyText(value)
    : `$${group(Math.round(Math.abs(value)).toString())}`;
}

/**
 * The total with the unsure digits as "?": 61.27 or 61.21 is "$61.2?". Null when the readings
 * don't line up (different lengths).
 */
export function maskedTotal(candidates: number[], currency = "USD"): string | null {
  if (candidates.length < 2) return null;
  const texts = candidates.map((value) => value.toFixed(2));
  const length = texts[0]?.length ?? 0;
  if (texts.some((text) => text.length !== length)) return null;
  const masked = [...(texts[0] ?? "")]
    .map((char, at) => (texts.every((text) => text[at] === char) ? char : "?"))
    .join("");
  return currency === "USD" ? `$${masked}` : `${masked} ${currency}`;
}

/** Whether the readings differ only in the last digit ("the last digit of the total"). */
export function differInLastDigit(candidates: number[]): boolean {
  const texts = candidates.map((value) => value.toFixed(2));
  if (texts.length < 2) return false;
  const head = texts[0]?.slice(0, -1);
  return texts.every((text) => text.slice(0, -1) === head);
}

/** "$61.27 or $61.21", "$1, $2 or $3". */
export function orList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** What the person typed ("$61.27", "61,27", "1,284.50") as a number; undefined when it isn't one. */
export function parseMoney(text: string): number | undefined {
  let clean = text.trim().replace(/[^\d.,-]/g, "");
  if (!clean || !/\d/.test(clean)) return undefined;
  if (/^-?\d+,\d{1,2}$/.test(clean)) clean = clean.replace(",", ".");
  else clean = clean.replace(/,/g, "");
  const value = Number(clean);
  return Number.isFinite(value) && value >= 0 && value <= 1_000_000
    ? Math.round(value * 100) / 100
    : undefined;
}

// ---------------------------------------------------------------- dates

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");
const parts = (day: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : undefined;
};
export const isDay = (value: unknown): value is string =>
  typeof value === "string" && !!parts(value);

/** The person's calendar day, from their local date parts (or a zone's, when given). */
export function localToday(now: Date = new Date(), timeZone?: string): string {
  if (timeZone) {
    try {
      const found = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      const get = (type: string) => found.find((part) => part.type === type)?.value ?? "";
      return `${get("year")}-${get("month")}-${get("day")}`;
    } catch {
      // An unknown zone: the device's own day.
    }
  }
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from one day to another (negative when the second is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}
export function addDays(day: string, days: number): string {
  const p = parts(day);
  if (!p) return day;
  const date = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** "Nov 11", or "Nov 11, 2025" when it isn't this year. */
export function shortDate(day: string | null, today: string): string {
  const p = day ? parts(day) : undefined;
  if (!p) return "No date";
  const name = (MONTHS[p.m - 1] ?? "").slice(0, 3);
  return p.y === parts(today)?.y ? `${name} ${p.d}` : `${name} ${p.d}, ${p.y}`;
}
/** "Wed, Nov 11, 2026". */
export function longDate(day: string | null): string {
  const p = day ? parts(day) : undefined;
  if (!p) return "No date";
  const weekday = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()] ?? "";
  return `${weekday}, ${(MONTHS[p.m - 1] ?? "").slice(0, 3)} ${p.d}, ${p.y}`;
}
/** "Today", "Yesterday", else "Nov 9". */
export function relativeDay(day: string | null, today: string): string {
  if (!day) return "No date";
  const gap = daysBetween(day, today);
  return gap === 0 ? "Today" : gap === 1 ? "Yesterday" : shortDate(day, today);
}
/** "November", or "November 2025" when it isn't this year. */
export function monthLabel(month: string, today: string): string {
  const p = parts(`${month}-01`);
  if (!p) return "No date";
  const name = MONTHS[p.m - 1] ?? "";
  return p.y === parts(today)?.y ? name : `${name} ${p.y}`;
}

/** "closes today", "closes tomorrow", "closes in 9 days", "closed 3 days ago". */
export function closesIn(days: number): string {
  if (days === 0) return "closes today";
  if (days === 1) return "closes tomorrow";
  if (days > 1) return `closes in ${days} days`;
  return days === -1 ? "closed yesterday" : `closed ${-days} days ago`;
}
/** "Return by Dec 11". */
export const returnByText = (returnBy: string, today: string) =>
  `Return by ${shortDate(returnBy, today)}`;
/** "29 days left", "Last day", "Closed 3 days ago". */
export function daysLeft(returnBy: string, today: string): string {
  const days = daysBetween(today, returnBy);
  if (days > 1) return `${days} days left`;
  if (days === 1) return "1 day left";
  if (days === 0) return "Last day";
  return days === -1 ? "Closed yesterday" : `Closed ${-days} days ago`;
}

/**
 * The day the reminder really goes off (the server's `reminderAt`, in the person's own calendar),
 * or null when there is none to promise: not filed, the return was settled, or it already went off.
 */
export function reminderOn(
  receipt: Pick<Receipt, "reminderAt" | "returnState" | "status">,
  now: Date = new Date(),
  timeZone?: string,
): string | null {
  if (receipt.status !== "filed" || receipt.returnState !== "open" || !receipt.reminderAt)
    return null;
  const at = new Date(receipt.reminderAt);
  if (!Number.isFinite(at.getTime()) || at.getTime() <= now.getTime()) return null;
  return localToday(at, timeZone);
}

/** Return dates closing in the next `within` days, soonest first (those still open, on filed receipts). */
export function closingSoon(receipts: Receipt[], today: string, within = 14): ClosingSoon[] {
  return receipts
    .filter((r) => r.status === "filed" && r.returnBy && r.returnState === "open")
    .map((r) => ({
      id: r.id,
      merchant: r.merchant,
      total: r.total,
      returnBy: r.returnBy as string,
      days: daysBetween(today, r.returnBy as string),
    }))
    .filter((r) => r.days >= 0 && r.days <= within)
    .sort((a, b) => a.days - b.days || (a.merchant ?? "").localeCompare(b.merchant ?? ""));
}

// ---------------------------------------------------------------- what is doubtful

/** What the amber note on a Check it card says, one line per doubt (most important first). */
export function doubts(receipt: Receipt): string[] {
  const lines: string[] = [];
  const picks = receipt.candidates.length > 1;
  if (picks) {
    const options = orList(receipt.candidates.map((c) => moneyText(c, receipt.currency)));
    lines.push(
      `I couldn’t read ${differInLastDigit(receipt.candidates) ? "the last digit of the total" : "all of the total"}. Is it ${options}?`,
    );
  } else if (receipt.total === null) {
    lines.push("I couldn’t find the total. Add it to file this one.");
  } else if (receipt.unsure.includes("total")) {
    lines.push("I wasn’t sure about the total. Check it against your receipt.");
  }
  if (!receipt.merchant) lines.push("I couldn’t read the store name. Add it to file this one.");
  else if (receipt.unsure.includes("merchant")) lines.push("I wasn’t sure about the store name.");
  if (!receipt.date) lines.push("I couldn’t read the date.");
  else if (receipt.unsure.includes("date")) lines.push("I wasn’t sure about the date.");
  if (receipt.unsure.includes("tax")) lines.push("I wasn’t sure about the tax.");
  if (receipt.unsure.includes("payment")) lines.push("I couldn’t read how it was paid.");
  return lines;
}

/** Which of the editable fields are marked as unsure (amber). */
export function unsureFields(receipt: Receipt): Set<"merchant" | "date" | "total"> {
  const found = new Set<"merchant" | "date" | "total">();
  if (!receipt.merchant || receipt.unsure.includes("merchant")) found.add("merchant");
  if (!receipt.date || receipt.unsure.includes("date")) found.add("date");
  if (receipt.total === null || receipt.unsure.includes("total") || receipt.candidates.length > 1)
    found.add("total");
  return found;
}

/**
 * Why File it can't be tapped yet (the server refuses these too, only while there is a total to
 * choose between), or null. "or say…" only when a chat or a call is open to say it in.
 */
export function fileBlock(receipt: Receipt, canSay = false): string | null {
  if (receipt.candidates.length > 1) {
    const sample = receipt.candidates[receipt.candidates.length - 1] ?? 0;
    return canSay
      ? `Pick the total first, or say “it’s ${moneyText(sample, receipt.currency)}”.`
      : "Pick the total first.";
  }
  if (!receipt.merchant && receipt.total === null)
    return canSay
      ? "Add the store and the total first, or say them."
      : "Add the store and the total first.";
  if (!receipt.merchant)
    return canSay ? "Add the store first, or say its name." : "Add the store first.";
  if (receipt.total === null)
    return canSay ? "Add the total first, or say it." : "Add the total first.";
  return null;
}

/** The short line under a To check row. */
export function needsWords(receipt: Receipt): string {
  if (receipt.candidates.length > 1) return "Which total is right?";
  if (receipt.total === null) return "No total found";
  if (!receipt.merchant) return "No store name";
  if (receipt.unsure.includes("total")) return "Check the total";
  if (!receipt.date || receipt.unsure.includes("date")) return "Check the date";
  if (receipt.unsure.includes("merchant")) return "Check the store";
  return "Ready to check";
}

// ---------------------------------------------------------------- the list

export interface DayGroup {
  key: string;
  label: string;
  items: Receipt[];
}
export interface MonthGroup {
  key: string;
  label: string;
  total: number;
  count: number;
  days: DayGroup[];
}

/** Receipts newest first, by month (with the month's total) and then by day. */
export function groupReceipts(receipts: Receipt[], today: string): MonthGroup[] {
  const sorted = [...receipts].sort(
    (a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.createdAt.localeCompare(a.createdAt),
  );
  const months: MonthGroup[] = [];
  for (const receipt of sorted) {
    const month = receipt.date ? receipt.date.slice(0, 7) : "none";
    let group = months.find((item) => item.key === month);
    if (!group) {
      group = {
        key: month,
        label: month === "none" ? "No date" : monthLabel(month, today),
        total: 0,
        count: 0,
        days: [],
      };
      months.push(group);
    }
    group.total += receipt.total ?? 0;
    group.count += 1;
    const dayKey = receipt.date ?? "none";
    let day = group.days.find((item) => item.key === dayKey);
    if (!day) {
      day = { key: dayKey, label: relativeDay(receipt.date, today), items: [] };
      group.days.push(day);
    }
    day.items.push(receipt);
  }
  for (const group of months) group.total = Math.round(group.total * 100) / 100;
  // "No date" always last.
  return months.sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : 0));
}

export interface ReceiptFilter {
  /** "keep:Warranty" or "cat:Home" (see filterChips). */
  chip?: string;
  text?: string;
}
export function filterReceipts(receipts: Receipt[], filter: ReceiptFilter): Receipt[] {
  const text = filter.text?.trim().toLowerCase();
  return receipts.filter((r) => {
    if (filter.chip?.startsWith("keep:") && !r.keepFor.includes(filter.chip.slice(5))) return false;
    if (filter.chip?.startsWith("cat:") && r.category !== filter.chip.slice(4)) return false;
    if (!text) return true;
    return `${r.merchant ?? ""} ${r.category} ${r.note} ${r.total ?? ""} ${r.keepFor.join(" ")} ${r.date ?? ""}`
      .toLowerCase()
      .includes(text);
  });
}

export interface FilterChip {
  key: string;
  label: string;
  count: number;
  kind: "keep" | "cat";
}
/** The filters worth showing: keep-for tags in use, then categories in use (most receipts first). */
export function filterChips(receipts: Receipt[]): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const tag of KEEP_FOR) {
    const count = receipts.filter((r) => r.keepFor.includes(tag)).length;
    if (count) chips.push({ key: `keep:${tag}`, label: tag, count, kind: "keep" });
  }
  const cats = CATEGORIES.map((name) => ({
    name,
    count: receipts.filter((r) => r.category === name).length,
  }))
    .filter((item) => item.count)
    .sort((a, b) => b.count - a.count);
  for (const item of cats)
    chips.push({ key: `cat:${item.name}`, label: item.name, count: item.count, kind: "cat" });
  return chips;
}

/** The teal ramp for category dots: the label always sits beside the dot, so colour only helps. */
const RAMP_LIGHT: Record<string, string> = {
  Home: "#1F5B55",
  Groceries: "#2F7A72",
  Dining: "#7BB5AE",
  Health: "#3A8A82",
  Kids: "#5BA39B",
  Pets: "#8FC4BD",
  Gifts: "#4A968D",
  Travel: "#6FB0A8",
  Subscriptions: "#A5D0CA",
  Other: "#BDB5A6",
};
const RAMP_DARK: Record<string, string> = {
  Home: "#5FC6BB",
  Groceries: "#4FB0A6",
  Dining: "#9ED8D1",
  Health: "#72D2C7",
  Kids: "#3F9F95",
  Pets: "#B4E2DC",
  Gifts: "#5BBBB0",
  Travel: "#86CFC7",
  Subscriptions: "#CDEAE6",
  Other: "#8B93A0",
};
export const categoryColor = (category: string, dark: boolean) =>
  (dark ? RAMP_DARK : RAMP_LIGHT)[category] ?? (dark ? "#8B93A0" : "#BDB5A6");

// ---------------------------------------------------------------- Home

/**
 * What the Home card shows: "attention" (something to check or a return date close), "invite"
 * (the box is empty, so the first snap is offered), or nothing. Never nothing-and-silent: a card
 * that is drawn always says one of these.
 */
export function homeCardKind(summary: BoxSummary | undefined): "attention" | "invite" | null {
  if (!summary) return null;
  if (summary.toCheck > 0 || summary.closingSoon.length > 0) return "attention";
  if (summary.receipts.length === 0 && summary.available) return "invite";
  return null;
}

/** The Home card's line about return dates: "Home Depot return window closes in 9 days". */
export function closingLine(item: ClosingSoon, more: number): { who: string; when: string } {
  const who = item.merchant ?? "A receipt";
  return {
    who,
    when: `return window ${closesIn(item.days)}${more > 0 ? `, and ${more} more soon` : ""}`,
  };
}

// ---------------------------------------------------------------- keep-for tags

/** The change to send when a keep-for tag is switched on or off. */
export function keepForChange(
  receipt: Pick<Receipt, "keepFor">,
  tag: string,
  on: boolean,
): { keepFor: string[]; returnBy?: null } {
  const rest = receipt.keepFor.filter((item) => item !== tag);
  const keepFor = on ? [...rest, tag] : rest;
  // Without the Return window tag there is no return date: the server drops the tag with it.
  return tag === "Return window" && !on ? { keepFor, returnBy: null } : { keepFor };
}

// ---------------------------------------------------------------- the chat tool's answer

/** One receipt as the agent's receipt_box tool describes it (apps/server/src/receipt-tools.ts). */
export interface ToolBrief {
  id: string;
  status: "to-check" | "filed";
  merchant: string | null;
  date: string | null;
  total: number | null;
  currency: string;
  category: string;
  keepFor: string[];
  returnBy: string | null;
  paidLast4: string | null;
  chooseBetween?: number[];
  unsure?: string[];
  filedByNeddy?: boolean;
  looksLikeOneAlreadyFiled?: string;
}
export interface ToolResult {
  outcome?: string;
  receipt?: ToolBrief;
  receipts?: ToolBrief[];
  count?: number;
  total?: number;
  shown?: string;
  say?: string;
  error?: string;
  reminder?: string;
  none?: boolean;
}

/** The tool's result (a JSON string or an object), or undefined when it isn't one. */
export function parseToolResult(result: unknown): ToolResult | undefined {
  let value = result;
  if (typeof value === "string")
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const found = value as Record<string, unknown>;
  const brief = (item: unknown): ToolBrief | undefined => {
    if (!item || typeof item !== "object") return undefined;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || (r.status !== "to-check" && r.status !== "filed"))
      return undefined;
    return {
      id: r.id,
      status: r.status,
      merchant: typeof r.merchant === "string" ? r.merchant : null,
      date: isDay(r.date) ? r.date : null,
      total: typeof r.total === "number" ? r.total : null,
      currency: typeof r.currency === "string" ? r.currency : "USD",
      category: typeof r.category === "string" ? r.category : "Other",
      keepFor: Array.isArray(r.keepFor) ? r.keepFor.filter((k) => typeof k === "string") : [],
      returnBy: isDay(r.returnBy) ? r.returnBy : null,
      paidLast4: typeof r.paidLast4 === "string" ? r.paidLast4 : null,
      ...(Array.isArray(r.chooseBetween)
        ? { chooseBetween: r.chooseBetween.filter((n) => typeof n === "number") }
        : {}),
      ...(Array.isArray(r.unsure) ? { unsure: r.unsure.filter((u) => typeof u === "string") } : {}),
      ...(r.filedByNeddy ? { filedByNeddy: true } : {}),
      ...(typeof r.looksLikeOneAlreadyFiled === "string"
        ? { looksLikeOneAlreadyFiled: r.looksLikeOneAlreadyFiled }
        : {}),
    };
  };
  const receipts = Array.isArray(found.receipts)
    ? found.receipts.map(brief).filter((item): item is ToolBrief => !!item)
    : undefined;
  return {
    outcome: typeof found.outcome === "string" ? found.outcome : undefined,
    receipt: brief(found.receipt),
    receipts,
    count: typeof found.count === "number" ? found.count : undefined,
    total: typeof found.total === "number" ? found.total : undefined,
    shown: typeof found.shown === "string" ? found.shown : undefined,
    say: typeof found.say === "string" ? found.say : undefined,
    error: typeof found.error === "string" ? found.error : undefined,
    reminder: typeof found.reminder === "string" ? found.reminder : undefined,
    none: found.none === true ? true : undefined,
  };
}

/** A tool brief as a full receipt for the shared pieces (what the card doesn't know is filled in plainly). */
export function briefAsReceipt(brief: ToolBrief): Receipt {
  return {
    id: brief.id,
    status: brief.status,
    merchant: brief.merchant,
    date: brief.date,
    total: brief.total,
    candidates: brief.chooseBetween ?? [],
    tax: null,
    currency: brief.currency,
    category: brief.category,
    paidLast4: brief.paidLast4,
    keepFor: brief.keepFor,
    returnDays: null,
    returnBy: brief.returnBy,
    returnState: "open",
    returnPolicy: null,
    warranty: brief.keepFor.includes("Warranty"),
    note: "",
    unsure: brief.unsure ?? [],
    fileId: "",
    source: "chat",
    autoFiled: !!brief.filedByNeddy,
    edited: false,
    createdAt: "",
  };
}

/** The server's answer that a receipt isn't (or is no longer) in the box: HTTP 404, or its words. */
export function isNotInBox(error: unknown): boolean {
  if ((error as { status?: number } | undefined)?.status === 404) return true;
  return error instanceof Error && /isn[’']t in your Receipt box any more/i.test(error.message);
}

/**
 * Whether the server itself said, in its own words, that this saved photo can never be read (it is
 * not an image, too big, or malformed). Only then is it removed from the device. A signed-out
 * session (401), a forbidden or missing route (403, 404: a deploy can answer a plain "404 Not
 * Found"), a busy server (5xx) or an answer with no JSON error from the server are never the photo's
 * fault, so the photo stays.
 */
export function photoRefusedForGood(error: unknown) {
  const { status, fromServer } = (error ?? {}) as { status?: number; fromServer?: boolean };
  return (
    fromServer === true && (status === 400 || status === 413 || status === 415 || status === 422)
  );
}
