import { randomUUID } from "node:crypto";
import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import {
  BuiltInAgent,
  convertInputToTanStackAI,
  defineTool,
  type ToolDefinition,
} from "@copilotkit/runtime/v2";
import { chat, maxIterations, type SchemaInput, toolDefinition } from "@tanstack/ai";
import { type AnthropicChatModel, anthropicText } from "@tanstack/ai-anthropic";
import { type GeminiTextModel, geminiText } from "@tanstack/ai-gemini";
import { createOpenaiChatCompletions, type OpenAIChatModel, openaiText } from "@tanstack/ai-openai";
import { map, mergeMap, type Observable } from "rxjs";
import { z } from "zod";
import { MODEL_MAX_RETRIES } from "../config.ts";
import { fromTanstack, type UsageSink } from "../usage.ts";

// Same "provider/model" strings, env vars and base URL formats as the AI SDK resolver in
// @copilotkit/runtime. Each provider SDK retries transient failures up to MODEL_MAX_RETRIES times.
function adapter(spec: string) {
  const [, provider = "", model = ""] = spec.trim().match(/^([^/:]*)[/:](.*)$/) ?? [];
  if (!provider || !model.trim())
    throw new Error(
      `Invalid model string "${spec}". Use "openai/gpt-5", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-pro" or "openrouter/openai/gpt-6.1-sol".`,
    );
  const id = model.trim();
  switch (provider.toLowerCase()) {
    case "openai":
      return openaiText(id as OpenAIChatModel, {
        baseURL: process.env.OPENAI_BASE_URL,
        maxRetries: MODEL_MAX_RETRIES,
      });
    case "anthropic":
      // The AI SDK base URL ends in /v1; the Anthropic SDK adds /v1 itself.
      return anthropicText(id as AnthropicChatModel, {
        baseURL: process.env.ANTHROPIC_BASE_URL?.replace(/\/v1\/?$/, ""),
        maxRetries: MODEL_MAX_RETRIES,
      });
    case "openrouter": {
      // OpenRouter speaks OpenAI's Chat Completions, on its own key; "openrouter/openai/gpt-6.1-sol".
      const key = process.env.OPENROUTER_API_KEY?.trim();
      if (!key) throw new Error("OPENROUTER_API_KEY isn't set on this server.");
      return createOpenaiChatCompletions(id as OpenAIChatModel, key, {
        baseURL: process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
        maxRetries: MODEL_MAX_RETRIES,
        defaultHeaders: { "X-Title": "Neato_Muse" },
      });
    }
    case "google":
    case "gemini":
    case "google-gemini":
      // The AI SDK base URL ends in /v1beta; @google/genai adds the API version itself.
      return geminiText(id as GeminiTextModel, {
        httpOptions: {
          baseUrl: process.env.GOOGLE_GENERATIVE_AI_BASE_URL?.replace(/\/v1beta\/?$/, ""),
          // @google/genai counts the first call in `attempts`.
          retryOptions: { attempts: MODEL_MAX_RETRIES + 1 },
        },
      });
    default:
      throw unknownProvider(provider, spec);
  }
}

/** With OPENAI_BASE_URL set, a gateway model ID most likely needs the openai/ prefix. */
export function unknownProvider(
  provider: string,
  spec: string,
  baseUrl = process.env.OPENAI_BASE_URL,
) {
  const hint = baseUrl?.trim()
    ? ` For a model on your OPENAI_BASE_URL gateway, use "openai/${spec.trim()}".`
    : "";
  return new Error(
    `Unknown provider "${provider}" in "${spec}". Supported: openai, anthropic, google (gemini), openrouter.${hint}`,
  );
}

// The classic BuiltInAgent always offers these two state tools. The converter turns their
// results into STATE_SNAPSHOT / STATE_DELTA events.
const stateTools = [
  defineTool({
    name: "AGUISendStateSnapshot",
    description: "Replace the entire application state with a new snapshot",
    parameters: z.object({ snapshot: z.any().describe("The complete new state object") }),
    execute: async ({ snapshot }) => ({ success: true, snapshot }),
  }),
  defineTool({
    name: "AGUISendStateDelta",
    description: "Apply incremental updates to application state using JSON Patch operations",
    parameters: z.object({
      delta: z
        .array(
          z.object({
            op: z.enum(["add", "replace", "remove"]).describe("The operation to perform"),
            path: z.string().describe("JSON Pointer path (e.g., '/foo/bar')"),
            value: z
              .any()
              .optional()
              .describe(
                "The value to set. Required for 'add' and 'replace' operations, ignored for 'remove'.",
              ),
          }),
        )
        .describe("Array of JSON Patch operations"),
    }),
    execute: async ({ delta }) => ({ success: true, delta }),
  }),
];

/** Tells `onUsage` the tokens of each model call, to track what each person costs. */
function usageMiddleware(model: string | (() => string), onUsage: UsageSink) {
  const name = () => (typeof model === "string" ? model : model());
  return {
    name: "usage",
    onUsage: (_ctx: unknown, usage: Parameters<typeof fromTanstack>[1]) =>
      onUsage(name(), fromTanstack(name(), usage)),
  };
}

/** How the last call to a model went, for the Models card. */
export interface LastCall {
  ok: boolean;
  at: string;
  /** Why it failed, in plain words. */
  error?: string;
  /** The model that answered instead. */
  usedInstead?: string;
}
export const lastCalls = new Map<string, LastCall>();
/** The last call for each kind of work (or each model, for calls outside one) since startup. */
const noteCall = (plan: CallPlan, call: Omit<LastCall, "at">) =>
  lastCalls.set(plan.job ?? plan.model.trim(), { ...call, at: new Date().toISOString() });

/** A provider's error in plain words: "OpenRouter is out of credit (402)". */
export function plainReason(error: unknown) {
  const text = (error instanceof Error ? error.message : String(error ?? "")).trim();
  const status = Number(
    (error as { status?: unknown })?.status ?? /\b([45]\d\d)\b/.exec(text)?.[1] ?? 0,
  );
  if (status === 401 || status === 403) return `The key was refused (${status})`;
  if (status === 402) return "Out of credit (402)";
  if (status === 404) return "No such model (404)";
  if (status === 429) return "Too many requests right now (429)";
  if (status >= 500) return `The provider had a problem (${status})`;
  return text.slice(0, 160) || "No reason given";
}

/** How a call is run: the model, and for OpenRouter how hard it thinks and how much it writes. */
export interface CallPlan {
  model: string;
  effort?: "low" | "medium" | "high";
  /** Most it may write, reasoning included (OpenRouter models). */
  maxTokens?: number;
  /** Most it may read, in estimated tokens (OpenRouter models). */
  contextLimit?: number;
  /** The server's own model, used when this one fails before it says anything. */
  fallback?: string;
  /** The kind of work, so the Models card can say how its last call went. */
  job?: string;
}
const routed = (model: string) => /^openrouter[/:]/i.test(model.trim());
/** OpenRouter's request fields for effort and output; other providers keep their defaults. */
function openRouterOptions(plan: CallPlan) {
  return {
    ...(plan.maxTokens ? { max_tokens: plan.maxTokens } : {}),
    ...(plan.effort ? { reasoning: { effort: plan.effort } } : {}),
  };
}
/** About four characters a token. */
const estimate = (value: unknown) => Math.ceil((JSON.stringify(value ?? "")?.length ?? 0) / 4);

/**
 * Leaves out the oldest messages until a call fits under `limit` estimated tokens, keeping the
 * person's latest turn and everything after it. Long chats are summarized long before this
 * (ChatSummaries); it's the last guard against GPT-6.1 Sol's price doubling past 272,000 tokens.
 */
export function fitContext<T extends { role: string }>(
  messages: T[],
  fixed: number,
  limit?: number,
): T[] {
  if (!limit) return messages;
  let total = fixed + messages.reduce((sum, message) => sum + estimate(message), 0);
  if (total <= limit) return messages;
  let lastPerson = messages.length - 1;
  while (lastPerson > 0 && messages[lastPerson]?.role !== "user") lastPerson--;
  let start = 0;
  while (total > limit && start < lastPerson) total -= estimate(messages[start++]);
  if (start)
    console.warn(
      `[OpenMuse] Left out the ${start} oldest messages to keep a call under ${limit.toLocaleString("en-US")} tokens.`,
    );
  return messages.slice(start);
}

/**
 * One reply without tools, for small background jobs such as writing ideas. A call that fails is
 * tried once on the plan's `fallback` (the server's own model); one that comes back empty is
 * tried once on the `stronger` plan.
 */
export async function complete(
  options: CallPlan & {
    system: string;
    prompt: string;
    onUsage?: UsageSink;
    stronger?: CallPlan;
  },
) {
  const once = async (plan: CallPlan) => {
    const reply = await chat({
      adapter: adapter(plan.model),
      messages: [{ role: "user", content: options.prompt }],
      systemPrompts: [options.system],
      stream: false,
      ...(routed(plan.model) ? { modelOptions: openRouterOptions(plan) } : {}),
      ...(options.onUsage ? { middleware: [usageMiddleware(plan.model, options.onUsage)] } : {}),
    } as never);
    return String(reply ?? "");
  };
  const run = async (plan: CallPlan) => {
    try {
      const text = await once(plan);
      noteCall(plan, { ok: true });
      return text;
    } catch (error) {
      if (!plan.fallback || plan.fallback === plan.model) throw error;
      const reason = plainReason(error);
      noteCall(plan, { ok: false, error: reason, usedInstead: plan.fallback });
      console.warn(`[OpenMuse] ${plan.model} failed (${reason}); trying ${plan.fallback} once.`);
      return once({ model: plan.fallback });
    }
  };
  const text = await run(options);
  const stronger = options.stronger;
  if (text.trim() || !stronger?.model || stronger.model === options.model) return text;
  console.warn(`[OpenMuse] ${options.model} gave no answer; trying ${stronger.model} once.`);
  return run(stronger);
}

/**
 * The conversation sent to the model always ends with the person's turn: newer models refuse to
 * continue the agent's own reply. The chat can hold a reply after the message that answers it
 * (saved out of order when the app reconnects mid-reply); it goes back before that message.
 * Replies after a finished tool step, with nothing new from the person, are left out and written
 * again, and so are tool calls that never got a result.
 */
export function endWithPerson<T extends { role: string; toolCalls?: unknown[] }>(messages: T[]) {
  let last = messages.length - 1;
  while (last >= 0 && messages[last]?.role === "assistant") last--;
  const turn = messages[last];
  if (!turn || last === messages.length - 1) return messages;
  const replies = messages.slice(last + 1).filter((m) => !m.toolCalls?.length);
  console.warn(
    `[OpenMuse] The chat ended with ${messages.length - last - 1} agent message(s) after the person's turn; ${turn.role === "user" ? "moved them before it" : "left them out"}.`,
  );
  return turn.role === "user"
    ? [...messages.slice(0, last), ...replies, turn]
    : messages.slice(0, last + 1);
}

type ToolStep = {
  role: string;
  toolCalls?: { id: string }[];
  toolCallId?: string;
  content?: unknown;
};
/** What a tool call that never finished reads as, so the model sees it was cut off. */
export const CUT_OFF = JSON.stringify({ error: "This step was cut off before it finished." });

/**
 * Every tool call is followed straight away by its result, as the model requires; otherwise it
 * refuses the whole conversation, and every later message in that chat fails. A reply cut off
 * mid-step (a deploy, a lost connection) can leave a call with no result anywhere in the chat:
 * it gets a "cut off" result. A result saved in the wrong place moves to its call, one with no
 * call is left out, and a call id used twice keeps only its first use.
 */
export function repairToolSteps<T extends ToolStep>(messages: T[]): T[] {
  const results = new Map<string, T>();
  for (const message of messages)
    if (message.role === "tool" && message.toolCallId && !results.has(message.toolCallId))
      results.set(message.toolCallId, message);
  const placed = new Set<string>();
  const out: T[] = [];
  let cutOff = 0;
  let moved = 0;
  messages.forEach((message, index) => {
    if (message.role === "tool") return;
    const calls = (message.role === "assistant" && message.toolCalls) || [];
    const fresh = calls.filter((call) => !placed.has(call.id));
    if (fresh.length !== calls.length) {
      // A repeated call id: the model refuses it twice, so only the first one stays.
      if (!fresh.length && !message.content) return;
      out.push({ ...message, toolCalls: fresh.length ? fresh : undefined });
    } else out.push(message);
    let next = index + 1;
    for (const call of fresh) {
      placed.add(call.id);
      const result = results.get(call.id);
      if (!result) {
        cutOff++;
        out.push({ role: "tool", toolCallId: call.id, content: CUT_OFF } as T);
        continue;
      }
      if (messages[next] !== result) moved++;
      else next++;
      out.push(result);
    }
  });
  const strays = [...results.keys()].filter((id) => !placed.has(id)).length;
  if (cutOff || moved || strays)
    console.warn(
      `[OpenMuse] Repaired the chat's tool steps: ${cutOff} cut off, ${moved} moved, ${strays} left out.`,
    );
  return cutOff || moved || strays || out.length !== messages.length ? out : messages;
}

type Adapter = ReturnType<typeof adapter>;
type StreamOptions = Parameters<Adapter["chatStream"]>[0];
/**
 * A model that fails before it says anything (no credit, a refused key, an unknown model, an
 * outage) hands the call to `fallback`, the server's own model, and so does every later step of
 * that reply. `current` says which model is answering, so its tokens are priced right.
 */
function withFallback(primary: Adapter, plan: CallPlan, current: { model: string }) {
  const fallback = plan.fallback;
  if (!fallback || fallback === plan.model) return primary;
  let backup: Adapter | undefined;
  const useBackup = (options: StreamOptions) => {
    backup ??= adapter(fallback);
    current.model = fallback;
    // Effort and output caps are OpenRouter's fields; the server's model keeps its defaults.
    return backup.chatStream({ ...options, model: backup.model, modelOptions: undefined } as never);
  };
  return new Proxy(primary, {
    get(target, key, receiver) {
      if (key !== "chatStream") return Reflect.get(target, key, receiver);
      return async function* (options: StreamOptions) {
        if (backup) {
          yield* useBackup(options);
          return;
        }
        const held: unknown[] = [];
        let said = false;
        for await (const chunk of target.chatStream(options as never)) {
          const type = (chunk as { type?: string }).type;
          if (!said && type === "RUN_STARTED") {
            held.push(chunk);
            continue;
          }
          // A stopped reply isn't a failure.
          if (!said && type === "RUN_ERROR" && (chunk as { code?: unknown }).code !== "aborted") {
            const reason = plainReason(
              Object.assign(new Error(String((chunk as { message?: unknown }).message ?? "")), {
                status: (chunk as { code?: unknown }).code,
              }),
            );
            noteCall(plan, { ok: false, error: reason, usedInstead: fallback });
            console.warn(
              `[OpenMuse] ${plan.model} failed (${reason}); this reply uses ${fallback} instead.`,
            );
            yield* useBackup(options);
            return;
          }
          if (!said) {
            said = true;
            noteCall(plan, { ok: true });
            yield* held as (typeof chunk)[];
          }
          yield chunk;
        }
        if (!said) yield* held as never[];
      };
    },
  });
}

/** Anthropic prompt caching: a cache read costs a tenth of the normal input price. */
const CACHE = { type: "ephemeral" } as const;
export const caches = (model: string) => /^anthropic[/:]/i.test(model.trim());

/** A BuiltInAgent in TanStack factory mode with the options of the classic AI SDK mode. */
export function tanstackAgent(options: {
  model: string;
  /** How hard it thinks, and how much it may read and write (OpenRouter models). */
  effort?: CallPlan["effort"];
  maxTokens?: number;
  contextLimit?: number;
  /** The server's own model, for a reply the chosen model can't start. */
  fallback?: string;
  job?: string;
  maxSteps: number;
  tools: ToolDefinition[];
  prompt: string;
  /** Said when the step limit, not the model, ends a run; otherwise the reply just stops. */
  stepLimitNote?: string;
  /** Told the tokens of each model call, to track what each person costs. */
  onUsage?: UsageSink;
}) {
  const agent = new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const converted = convertInputToTanStackAI(input);
      // Build the system prompt like the classic mode. It does not forward system messages.
      // The instructions come first and never change, so Claude can reuse them from its cache;
      // the context after them (the time, memories) changes between turns.
      let system = "";
      if (input.context.length) {
        system += "\n## Context from the application\n";
        for (const ctx of input.context) system += `${ctx.description}:\n${ctx.value}\n`;
      }
      if (
        input.state !== undefined &&
        input.state !== null &&
        !(typeof input.state === "object" && Object.keys(input.state).length === 0)
      )
        system += `\n## Application State\nThis is state from the application that you can edit by calling AGUISendStateSnapshot or AGUISendStateDelta.\n\`\`\`json\n${JSON.stringify(input.state, null, 2)}\n\`\`\`\n`;
      const cached = caches(options.model);
      // Tool definitions are read with every call too; about 20,000 tokens is a safe allowance.
      const fixed = estimate(options.prompt) + estimate(system) + 20_000;
      const current = { model: options.model };
      return chat({
        adapter: withFallback(adapter(options.model), options, current),
        messages: repairToolSteps(
          fitContext(endWithPerson(converted.messages), fixed, options.contextLimit),
        ),
        systemPrompts: [
          ...(options.prompt
            ? [
                cached
                  ? { content: options.prompt, metadata: { cache_control: CACHE } }
                  : options.prompt,
              ]
            : []),
          ...(system.trim() ? [system.trim()] : []),
        ] as never,
        // The conversation so far is cached too, so each step of a reply rereads it cheaply.
        // OpenRouter models cache a repeated beginning by themselves.
        ...(cached ? { modelOptions: { cache_control: CACHE } as never } : {}),
        ...(routed(options.model) ? { modelOptions: openRouterOptions(options) as never } : {}),
        tools: [
          ...converted.tools,
          ...[...options.tools, ...stateTools].map((tool) =>
            toolDefinition({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.parameters as SchemaInput,
            }).server((args) => (tool.execute as (args: unknown) => Promise<unknown>)(args)),
          ),
        ],
        agentLoopStrategy: maxIterations(options.maxSteps),
        ...(options.onUsage
          ? { middleware: [usageMiddleware(() => current.model, options.onUsage)] }
          : {}),
        abortController,
      });
    },
  });
  const run = agent.run.bind(agent);
  agent.run = (input: RunAgentInput) => {
    const events = logRunErrors(splitTextAtToolCalls(run(input)));
    return options.stepLimitNote
      ? reportStepLimit(events, options.maxSteps, options.stepLimitNote)
      : events;
  };
  return agent;
}

/** A failed reply says why in the server's log (the model's or tool's message, never the chat). */
export function logRunErrors(events: Observable<BaseEvent>) {
  return events.pipe(
    map((event) => {
      if (event.type === EventType.RUN_ERROR)
        console.error(
          `[OpenMuse] A chat reply failed: ${String((event as { message?: unknown }).message ?? "no reason given").slice(0, 500)}`,
        );
      return event;
    }),
  );
}

/**
 * maxIterations ends the loop after the last allowed tool step without a final model reply.
 * When a run ends that way, add a short assistant message so it does not stop silently.
 */
export function reportStepLimit(events: Observable<BaseEvent>, maxSteps: number, note: string) {
  let steps = 0;
  let phase: "text" | "calling" | "results" = "text";
  return events.pipe(
    mergeMap((event): BaseEvent[] => {
      if (event.type === EventType.TOOL_CALL_START) {
        // Parallel calls of one model step arrive together; results end the step.
        if (phase !== "calling") steps++;
        phase = "calling";
      } else if (event.type === EventType.TOOL_CALL_RESULT) phase = "results";
      else if (event.type === EventType.TEXT_MESSAGE_CHUNK) phase = "text";
      else if (event.type === EventType.RUN_FINISHED && phase === "results" && steps >= maxSteps)
        return [
          {
            type: EventType.TEXT_MESSAGE_CHUNK,
            messageId: randomUUID(),
            role: "assistant",
            delta: note,
          } as BaseEvent,
          event,
        ];
      return [event];
    }),
  );
}

// ponytail: the TanStack converter in @copilotkit/runtime 1.70.1 uses one message ID for the
// whole run. Remove this when it starts a new ID for each step, like the classic mode does.
// Text after a tool call gets a new message ID, so each step's text is a separate message.
function splitTextAtToolCalls(events: Observable<BaseEvent>) {
  let messageId: string | undefined;
  let afterToolCall = false;
  return events.pipe(
    map((event) => {
      if (event.type === EventType.TEXT_MESSAGE_CHUNK) {
        if (!messageId || afterToolCall) messageId = randomUUID();
        afterToolCall = false;
        return { ...event, messageId };
      }
      if (event.type === EventType.TOOL_CALL_START) {
        afterToolCall = true;
        return messageId ? { ...event, parentMessageId: messageId } : event;
      }
      if (event.type === EventType.TOOL_CALL_RESULT) afterToolCall = true;
      return event;
    }),
  );
}
