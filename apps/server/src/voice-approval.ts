import { z } from "zod";
import type { ActionProposal } from "../../../packages/domain/src/index.ts";
import type { Store } from "./db.ts";
import { isPurchase, statedAmount } from "./spending.ts";

/**
 * Approving by voice on a live call (owner, 2026-10-08): everything except money. The agent reads
 * back what's waiting (read_back_approvals), and an approval goes through only when the person's
 * own words in the call, heard after that read-back, say yes. The model's decision alone never
 * approves, so something it read out ("approve this") can't approve itself.
 */

/** The live call, as the voice tools see it. */
export interface CallEar {
  /** Remembers what was read back, from this point in the call. */
  readBack(ids: string[]): void;
  /** What was read back, and what the person has said since (their own words only). */
  heard(): { ids: string[]; at: number; said: string[] } | undefined;
  /** One read-back, one decision. */
  forget(): void;
}

/** Purchases, payments and steps that need a typed code still need a tap. */
export function needsTap(action: ActionProposal) {
  const d = action.data as Record<string, unknown>;
  if (action.kind === "app.action")
    return (
      isPurchase(String(d.tool ?? "")) ||
      typeof d.amountUsd === "number" ||
      statedAmount(d.arguments) > 0
    );
  if (action.kind === "browser.step")
    return /\b(pay|buy|purchase|checkout|check out|place (your )?order|order now|subscribe|donate|add to cart)\b|[$€£]\s?\d/i.test(
      `${d.element ?? ""} ${d.summary ?? ""}`,
    );
  if (action.kind === "browser.signin") return d.step === "code";
  return false;
}

const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
/** "Tuesday, Oct 14 at 3 PM", in the event's own time zone. */
function when(start: unknown, zone: unknown) {
  const date = new Date(String(start ?? ""));
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: typeof zone === "string" && zone ? zone : undefined,
    });
  } catch {
    return "";
  }
}

/** What an action does, as Neddy says it out loud: "the email to Bob Smith about “Friday”". */
export function spokenWhat(action: ActionProposal) {
  const d = action.data as Record<string, unknown>;
  const to = Array.isArray(d.to) ? (d.to as string[]) : [];
  switch (action.kind) {
    case "email.send":
    case "agent_email.send":
      return `the email to ${list(to.map(String))}${d.subject ? ` about “${d.subject}”` : ""}`;
    case "calendar.create":
      return `adding “${d.title}” to your calendar${when(d.start, d.timeZone) ? ` on ${when(d.start, d.timeZone)}` : ""}`;
    case "calendar.update":
      return `changing “${d.title}” on your calendar${when(d.start, d.timeZone) ? ` to ${when(d.start, d.timeZone)}` : ""}`;
    case "calendar.delete":
      return `removing “${d.title}” from your calendar`;
    case "browser.step":
      return `pressing “${d.element}” on ${d.site}`;
    case "browser.signin":
      return `signing in to ${d.site}`;
    default:
      return action.title.charAt(0).toLowerCase() + action.title.slice(1);
  }
}

const YES =
  /\b(yes|yeah|yep|yup|sure|ok(ay)?|approve[ds]?|approving|go ahead|go for it|do it|do them|send (it|them|both)|confirm(ed)?|sounds good|please do|that'?s (fine|right|correct)|correct)\b/i;
const NO =
  /\b(no|nope|nah|don'?t|do not|wait|hold on|hang on|stop|cancel|not yet|never ?mind|skip|leave|reject|deny)\b/i;
const ALL = /\b(all|both|everything|every one|them all|all of them|the lot)\b/i;
/** Their words say yes, and (unless they're choosing some and not others) nothing says no. */
export const saysYes = (words: string) => YES.test(words);
export const saysNo = (words: string) => NO.test(words);
export const saysAll = (words: string) => ALL.test(words);

const waiting = async (db: Store, owner: string, now: number) =>
  (await db.list<ActionProposal>(owner, "actions"))
    .filter((action) => action.status === "awaiting_review" && Date.parse(action.expiresAt) > now)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

export interface Decider {
  decide(
    owner: string,
    id: string,
    hash: string,
    decision: "approve" | "deny",
  ): Promise<ActionProposal>;
}

/** The two tools a call's hand-over gets: read back what's waiting, then act on their yes. */
export function voiceApprovalTools(
  db: Store,
  decider: Decider,
  owner: string,
  ear: CallEar,
  now: () => number = Date.now,
) {
  return [
    {
      name: "read_back_approvals",
      description:
        "On a live call, when they want to approve, send or go ahead with something waiting for their OK: reads back exactly what each one is, so they can say yes out loud. Say its `say` text as it is, word for word, then wait for their answer. Give actionIds (from show_approvals) to read back only those; leave them out for everything that's waiting.",
      parameters: z.object({
        actionIds: z.array(z.string().min(1).max(100)).max(10).optional(),
      }),
      execute: async ({ actionIds }: { actionIds?: string[] }) => {
        const all = await waiting(db, owner, now());
        const chosen = actionIds?.length ? all.filter((a) => actionIds.includes(a.id)) : all;
        if (!chosen.length)
          return {
            approvals: [],
            say: "Nothing is waiting for your OK right now.",
          };
        const byVoice = chosen.filter((action) => !needsTap(action)).slice(0, 6);
        const tapOnly = chosen.filter(needsTap);
        ear.readBack(byVoice.map((action) => action.id));
        const items = byVoice.map((action, index) => ({
          number: index + 1,
          actionId: action.id,
          what: spokenWhat(action),
        }));
        const named = items.map((item) => item.what);
        const tap = tapOnly.length
          ? ` ${tapOnly.length === 1 ? `${spokenWhat(tapOnly[0] as ActionProposal)} involves money, so it needs` : `${tapOnly.length} others involve money, so they need`} a tap on Approve when it's safe.`
          : "";
        const say = !items.length
          ? `${tap.trim()}`
          : items.length === 1
            ? `That's ${named[0]}. Say “yes, approve” to go ahead, or “no” to leave it.${tap}`
            : `${items.length} things are waiting: ${list(named.map((what, i) => `${i + 1}, ${what}`))}. Say “approve all”, or tell me which ones.${tap}`;
        return {
          // Their Approve cards go on the screen too.
          approvals: chosen.map((action) => ({ actionId: action.id, title: action.title })),
          items,
          say,
          message:
            "Say `say` word for word, then wait. When they answer, call approve_by_voice with the actionIds they said yes to (and any they said no to); never decide for them.",
        };
      },
    },
    {
      name: "approve_by_voice",
      description:
        "After read_back_approvals and their spoken answer: approves the ones they said yes to, and turns down the ones they said no to (anything not named keeps waiting). It goes through only if their own words after the read-back say so. Then say what was done, in a sentence.",
      parameters: z.object({
        approve: z.array(z.string().min(1).max(100)).max(10).default([]),
        decline: z.array(z.string().min(1).max(100)).max(10).default([]),
      }),
      execute: async ({ approve, decline }: { approve: string[]; decline: string[] }) => {
        const heard = ear.heard();
        if (!heard || now() - heard.at > 5 * 60_000)
          return {
            error:
              "Nothing was read back to them in the last few minutes. Call read_back_approvals first, say it, and wait for their answer.",
          };
        const words = heard.said.join(" ").trim();
        if (!words) return { error: "They haven't answered yet. Wait for them to say yes or no." };
        const unknown = [...approve, ...decline].filter((id) => !heard.ids.includes(id));
        if (unknown.length)
          return {
            error:
              "Only what was just read back can be approved by voice. Read the others back first.",
          };
        const yes = saysYes(words);
        const no = saysNo(words);
        // Choosing some and not others ("the email, not the calendar"): yes and no together are
        // fine. A yes for everything that was read back must be clear.
        const choosing = approve.length > 0 && approve.length < heard.ids.length;
        if (approve.length && (!yes || (no && !choosing)))
          return {
            error:
              "Their answer wasn't a clear yes, so nothing was approved. Ask them to say “yes, approve” or “no”.",
            heard: words,
          };
        if (approve.length > 1 && approve.length === heard.ids.length && !saysAll(words))
          return {
            error: "They didn't say all of them. Ask which ones, or have them say “approve all”.",
            heard: words,
          };
        if (decline.length && !no)
          return { error: "They didn't say no to those, so they keep waiting.", heard: words };
        ear.forget();
        const actions = await db.list<ActionProposal>(owner, "actions");
        const done: string[] = [];
        const declined: string[] = [];
        const failed: string[] = [];
        for (const [ids, decision] of [
          [approve, "approve"],
          [decline, "deny"],
        ] as const)
          for (const id of ids) {
            const action = actions.find((a) => a.id === id);
            if (!action || needsTap(action)) continue;
            try {
              const after = await decider.decide(owner, id, action.hash, decision);
              (decision === "approve" ? done : declined).push(spokenWhat(after));
            } catch (error) {
              failed.push(
                `${spokenWhat(action)} (${error instanceof Error ? error.message : "it didn't go through"})`,
              );
            }
          }
        return {
          approved: done,
          declined,
          failed,
          message:
            "Say in one or two short sentences what was approved, what was turned down, and anything that failed and why. Anything not named is still waiting.",
        };
      },
    },
  ];
}
