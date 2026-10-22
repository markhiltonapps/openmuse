import type { RunAgentInput } from "@ag-ui/core";
import {
  type Found,
  hiddenNames,
  redact,
  redactDeep,
} from "../../../packages/domain/src/redact.ts";

/**
 * Sensitive numbers and secrets never reach the model (owner, 2026-10-22): what the person typed,
 * every tool's result and what jobs read are cleaned by shape first (packages/domain/src/redact.ts),
 * and the model is told, once, in a word it can pass on, that something was hidden. The saved chat
 * history still holds what the person typed; only the model never sees it.
 */
export const redactionInstructions =
  " Card numbers, Social Security numbers, bank and ID numbers, passwords, PINs and secret keys are hidden before you see them (they show as [card ending 1234] and the like). When a tool result has hidden, or a note says something was hidden, tell the person once, in one short line, what was hidden and that you never see it; never ask them to type or paste such a number or password into the chat (a saved sign-in handles passwords, and a purchase goes through its approval).";

/** The note a result carries when something was hidden in it. */
const hiddenFields = (found: Found[]) => ({
  hidden: hiddenNames(found),
  next: "Something sensitive was hidden in this result. Say so in one short line, once, and never ask for the real value.",
});

/** A tool's result with anything sensitive hidden, and a note about it when the result is an object. */
export function guardResult<T>(result: T): T {
  const { value, found } = redactDeep(result);
  if (!found.length) return result;
  if (value && typeof value === "object" && !Array.isArray(value))
    return { ...(value as object), ...hiddenFields(found) } as T;
  return value;
}

/** Wraps tools so every result they return is cleaned before the model reads it. */
export function guardTools<T extends { execute?: (...args: never[]) => unknown }>(tools: T[]): T[] {
  return tools.map((tool) => {
    const run = tool.execute as ((...args: unknown[]) => unknown) | undefined;
    if (!run) return tool;
    return {
      ...tool,
      execute: async (...args: unknown[]) => guardResult(await run(...args)),
    } as T;
  });
}

type Message = RunAgentInput["messages"][number];
/** What the person typed is cleaned too (the whole history, since it is sent again each turn). */
export function guardInput(input: RunAgentInput): { input: RunAgentInput; note: string } {
  const latestUser = [...input.messages].reverse().find((m) => m.role === "user");
  let note = "";
  const messages = input.messages.map((message): Message => {
    const { value, found } = redactDeep(message as unknown as Record<string, unknown>);
    if (message === latestUser && found.length) {
      const names = hiddenNames(found);
      note = `\n\n[Hidden from you: ${names}. Tell the person once, in one short line, that you hid it so you never see it, and don't ask for it again.]`;
      const content = (value as { content?: unknown }).content;
      if (typeof content === "string")
        return { ...(value as object), content: `${content}${note}` } as Message;
      if (Array.isArray(content)) {
        const last = content.findLastIndex((part: { type?: string }) => part?.type === "text");
        if (last >= 0)
          return {
            ...(value as object),
            content: content.map((part, index) =>
              index === last ? { ...part, text: `${part.text}${note}` } : part,
            ),
          } as Message;
      }
    }
    return found.length ? (value as unknown as Message) : message;
  });
  return { input: { ...input, messages }, note };
}

/** Text going to a model as a prompt (a job's task, a summary's transcript), cleaned. */
export const hideText = (text: string) => redact(text).text;
