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
import { type OpenAIChatModel, openaiText } from "@tanstack/ai-openai";
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
      `Invalid model string "${spec}". Use "openai/gpt-5", "anthropic/claude-sonnet-4.5", or "google/gemini-2.5-pro".`,
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
    `Unknown provider "${provider}" in "${spec}". Supported: openai, anthropic, google (gemini).${hint}`,
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
function usageMiddleware(model: string, onUsage: UsageSink) {
  return {
    name: "usage",
    onUsage: (_ctx: unknown, usage: Parameters<typeof fromTanstack>[1]) =>
      onUsage(model, fromTanstack(model, usage)),
  };
}

/** One reply without tools, for small background jobs such as writing ideas. */
export async function complete(options: {
  model: string;
  system: string;
  prompt: string;
  onUsage?: UsageSink;
}) {
  const reply = await chat({
    adapter: adapter(options.model),
    messages: [{ role: "user", content: options.prompt }],
    systemPrompts: [options.system],
    stream: false,
    ...(options.onUsage ? { middleware: [usageMiddleware(options.model, options.onUsage)] } : {}),
  } as never);
  return String(reply ?? "");
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

/** Anthropic prompt caching: a cache read costs a tenth of the normal input price. */
const CACHE = { type: "ephemeral" } as const;
export const caches = (model: string) => /^anthropic[/:]/i.test(model.trim());

/** A BuiltInAgent in TanStack factory mode with the options of the classic AI SDK mode. */
export function tanstackAgent(options: {
  model: string;
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
      return chat({
        adapter: adapter(options.model),
        messages: endWithPerson(converted.messages),
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
        ...(cached ? { modelOptions: { cache_control: CACHE } as never } : {}),
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
          ? { middleware: [usageMiddleware(options.model, options.onUsage)] }
          : {}),
        abortController,
      });
    },
  });
  const run = agent.run.bind(agent);
  agent.run = (input: RunAgentInput) => {
    const events = splitTextAtToolCalls(run(input));
    return options.stepLimitNote
      ? reportStepLimit(events, options.maxSteps, options.stepLimitNote)
      : events;
  };
  return agent;
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
