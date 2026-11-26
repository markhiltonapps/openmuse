/**
 * Sending to yourself never asks (owner, 2026-11-26: "I don't want to approve them every day").
 * A routine's email that goes only to the person's own addresses runs without review; anything
 * with someone else on it (to, cc or bcc), or any address we can't read, still waits for their OK.
 */

const ADDRESS = /[^\s<>"',;:()[\]]+@[^\s<>"',;:()[\]]+\.[A-Za-z]{2,}/g;
/** Argument names that carry who an email goes to, in Gmail's, Outlook's and our own shapes. */
const RECIPIENT_KEY =
  /^(to|cc|bcc|recipient|recipients|recipient_?emails?|extra_?recipients|(to|cc|bcc)_?recipients|send_?to|email_?to|to_?emails?|(to|cc|bcc)_?address(es)?)$/i;
/** Actions that send an email (not drafts, replies to a thread whose people we can't see, or forwards). */
const SENDS_EMAIL = /^(GMAIL|OUTLOOK|OUTLOOK_OUTLOOK)_SEND_EMAIL$/;

export const normalAddress = (address: string) => address.trim().toLowerCase();

/** Every address in the recipient fields, however the app shapes them (strings, lists, objects). */
export function recipientsIn(args: unknown): string[] {
  const found: string[] = [];
  const collect = (value: unknown, depth: number): void => {
    if (depth > 6 || value == null) return;
    if (typeof value === "string") {
      for (const match of value.match(ADDRESS) ?? []) found.push(normalAddress(match));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item, depth + 1);
      return;
    }
    if (typeof value === "object")
      for (const item of Object.values(value as Record<string, unknown>)) collect(item, depth + 1);
  };
  const walk = (value: unknown, depth: number): void => {
    if (depth > 4 || !value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (RECIPIENT_KEY.test(key)) collect(item, 0);
      else if (item && typeof item === "object" && !Array.isArray(item)) walk(item, depth + 1);
    }
  };
  walk(args, 0);
  return found;
}

/**
 * Whether this send goes only to the person: an email-sending action, at least one recipient,
 * and every recipient one of their own addresses.
 */
export function onlyToThem(slug: string, args: unknown, own: string[]): boolean {
  if (!SENDS_EMAIL.test(slug.toUpperCase())) return false;
  return onlyTo(recipientsIn(args), own);
}

/** The built-in mailbox's draft ({to, cc, bcc}): every address one of theirs. */
export function draftOnlyToThem(
  draft: { to?: string[]; cc?: string[]; bcc?: string[] },
  own: string[],
) {
  return onlyTo(
    [...(draft.to ?? []), ...(draft.cc ?? []), ...(draft.bcc ?? [])].map(normalAddress),
    own,
  );
}

function onlyTo(recipients: string[], own: string[]) {
  const mine = new Set(own.map(normalAddress).filter((address) => address.includes("@")));
  return recipients.length > 0 && mine.size > 0 && recipients.every((r) => mine.has(r));
}

/** How the reason reads in the job's result: "Done without review, because the person allowed …". */
export const SELF_SEND_RULE = "a routine’s emails sent only to themselves";
