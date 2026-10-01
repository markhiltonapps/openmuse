import { z } from "zod";
import type { ActionProposal } from "../../../packages/domain/src/index.ts";
import type { Store } from "./db.ts";

/** Every value in an action's details, as words to match (not its field names). */
function values(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === "object") return Object.values(value).flatMap(values);
  return [];
}
/** JSON with its keys in order, so the same details always read the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
/**
 * What an action actually does, never its summary or title (the agent words those afresh each time
 * it sets something up again): two with the same key do the same thing.
 */
function whatItDoes(action: ActionProposal) {
  const d = action.data;
  const sorted = (value: unknown) =>
    Array.isArray(value) ? value.map((item) => String(item).toLowerCase()).sort() : [];
  switch (action.kind) {
    case "app.action":
      return stable([d.app, d.tool, d.arguments ?? {}]);
    case "email.send":
    case "agent_email.send":
      return stable([
        sorted(d.to),
        String(d.subject ?? "")
          .trim()
          .toLowerCase(),
      ]);
    case "browser.step":
      return stable([d.site, d.url, d.element, d.action]);
    case "browser.signin":
      return stable([d.site, d.username, d.step]);
    default:
      return stable([action.kind, d.title, d.start, d.eventId]);
  }
}
const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length)}…` : text;

/** What an expired action was, so the agent can set it up again with the same tool. */
function described(action: ActionProposal) {
  const d = action.data;
  const details =
    action.kind === "app.action"
      ? { app: d.app, tool: d.tool, arguments: d.arguments }
      : action.kind === "agent_email.send" || action.kind === "email.send"
        ? { to: d.to, cc: d.cc, subject: d.subject, body: clip(String(d.body ?? ""), 2000) }
        : { summary: clip(JSON.stringify(d), 1500) };
  return { title: action.title, kind: action.kind, details };
}

/**
 * What's waiting for the person's OK, brought back into the conversation as Approve cards, so
 * "send the draft I told you to send" is one tap where they are, not a trip to Activity. One that
 * expired comes back as its details, so the agent can set it up again.
 */
export function approvalToolSpec(db: Store, owner: string, now: () => number = Date.now) {
  return {
    name: "show_approvals",
    description:
      "Bring up what's waiting for the person's OK (emails, app actions, website steps, calendar changes) as Approve cards right where they are, so they approve it with one tap without leaving the chat or call. Use it whenever they want to approve, send or go ahead with something that's already waiting, or ask what's waiting. Narrow it with words from what it is, e.g. 'Dan' or 'invoice'. Something that expired comes back as its details, to set up again.",
    parameters: z.object({
      about: z.string().trim().max(200).optional().describe("Words from what it is"),
    }),
    execute: async ({ about }: { about?: string }) => {
      const at = now();
      const all = await db.list<ActionProposal>(owner, "actions");
      const newest = (a: ActionProposal, b: ActionProposal) =>
        b.createdAt.localeCompare(a.createdAt);
      const waiting = all
        .filter((action) => action.status === "awaiting_review")
        .filter((action) => Date.parse(action.expiresAt) > at)
        .sort(newest);
      // Expired in the last day, never approved: the agent can set it up again.
      const lapsed = all
        .filter(
          (action) =>
            action.status === "expired" ||
            (action.status === "awaiting_review" && Date.parse(action.expiresAt) <= at),
        )
        .filter((action) => at - Date.parse(action.expiresAt) < 86_400_000)
        .sort(newest);
      // The same thing set up again later: it went through (or may have), or it's waiting again.
      const same = (a: ActionProposal, b: ActionProposal) =>
        a.kind === b.kind && whatItDoes(a) === whatItDoes(b);
      const later = (action: ActionProposal, statuses: ActionProposal["status"][]) =>
        all.find(
          (other) =>
            other.id !== action.id &&
            other.createdAt > action.createdAt &&
            statuses.includes(other.status) &&
            same(other, action),
        );
      const doneSince = (action: ActionProposal) =>
        later(action, ["succeeded", "executing", "outcome_unknown"]);
      // Done (or going through) in the last day: what they asked about may be one of these.
      const settled = all
        .filter((action) => ["succeeded", "executing", "outcome_unknown"].includes(action.status))
        .filter((action) => at - Date.parse(action.createdAt) < 86_400_000)
        .sort(newest);
      const open = lapsed.filter(
        (action) => !doneSince(action) && !later(action, ["awaiting_review"]),
      );
      // Ranked by how many of their words it has (short words like "to" don't count).
      const words = (about ?? "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}@.]+/u)
        .filter((word) => word.length >= 3);
      const scoreOf = (action: ActionProposal) => {
        const text = [action.title, ...values(action.data)].join(" ").toLowerCase();
        return words.filter((word) => text.includes(word)).length;
      };
      const ranked = (actions: ActionProposal[]) =>
        actions
          .map((action) => ({ action, score: scoreOf(action) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score)
          .map(({ action }) => action);
      const matching = words.length ? ranked(waiting) : waiting;
      const expiredMatches = words.length ? ranked(open) : open;
      const doneMatches = words.length ? ranked(settled) : [];
      // What they meant was already done after all: never set it up a second time. (When an expired
      // one fits their words better, that's what they meant; a tie counts as done, to be safe.)
      const bestDone = doneMatches[0] ? scoreOf(doneMatches[0]) : 0;
      const bestExpired = expiredMatches[0] ? scoreOf(expiredMatches[0]) : 0;
      if (!matching.length && doneMatches.length && bestDone >= bestExpired)
        return {
          approvals: [],
          alreadyDone: doneMatches.slice(0, 2).map((action) => ({
            title: action.title,
            status: action.status,
            ...(action.result ? { result: clip(action.result, 500) } : {}),
            at: action.createdAt,
          })),
          message:
            "That was already done or is going through now; say so, and what happened. Don't set it up again unless they say they want it done again. If its status is executing, say it's still going through; if it's outcome_unknown, say it couldn't be confirmed and they should check before trying again.",
        };
      // What they meant expired: set up again. With no words, ask first.
      if (!matching.length && expiredMatches.length && (words.length || !waiting.length))
        return {
          approvals: [],
          expired: expiredMatches.slice(0, 2).map(described),
          message: words.length
            ? "That expired before it was approved. Set it up again with the same details (use_app, email_from_agent, or use_page on the same page), so a fresh Approve card appears, and tell them it's a fresh one. If it came from a job, offer to run the job again instead."
            : "Nothing is waiting, but these expired in the last day before they were approved. Ask if they want any set up again; don't do it unprompted.",
        };
      if (!waiting.length)
        return {
          approvals: [],
          message:
            "No emails, app actions, website steps or calendar changes are waiting for their OK right now.",
        };
      const shown = (matching.length ? matching : waiting).slice(0, 3);
      const more = waiting.length - shown.length;
      return {
        approvals: shown.map((action) => ({ actionId: action.id, title: action.title })),
        ...(more > 0 ? { more } : {}),
        message:
          matching.length || !words.length
            ? `Their Approve cards are on the person's screen now. Name them in a few words, and say each happens only when they tap Approve.${more > 0 ? ` ${more} more ${more === 1 ? "is" : "are"} waiting; if it's not one of these, ask which.` : ""}`
            : "Nothing matched those words, so what's waiting is on their screen instead. Ask if it's one of these.",
      };
    },
  };
}
