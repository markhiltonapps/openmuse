import type { Store } from "./db.ts";

/** Tokens from one model call, split the way providers bill them. */
export interface Tokens {
  /** Input read at the full price. */
  input: number;
  /** Input read from the prompt cache, at a tenth of the price. */
  cacheRead: number;
  /** Input written to the prompt cache (Claude charges a quarter more for it). */
  cacheWrite: number;
  output: number;
  /** Web searches the model ran itself, billed per search. */
  searches: number;
}
/** Called after each model call with the model it used and what it read and wrote. */
export type UsageSink = (model: string, tokens: Tokens) => void;
/** What the usage is for, as shown to the person. */
export type UsageKind =
  | "chat"
  | "background"
  | "search"
  | "feed"
  | "pictures"
  | "import"
  | "avatar";

/** Dollars per million tokens. */
export interface Price {
  input: number;
  output: number;
}
/**
 * List prices in US dollars per million tokens, matched on the start of the model name.
 * MODEL_PRICES adds or corrects models: "claude-opus-5=5/25,gpt-5.6-terra=2/12".
 */
export const PRICES: Record<string, Price> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gemini-3.1-pro": { input: 2, output: 12 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
};
/** Anthropic's server-side web search: $10 per 1,000 searches. */
const SEARCH_PRICE = 0.01;

export function parsePrices(value = process.env.MODEL_PRICES ?? ""): Record<string, Price> {
  const prices: Record<string, Price> = {};
  for (const pair of value.split(",")) {
    const [model, rates] = pair.split("=").map((part) => part.trim());
    const [input, output] = (rates ?? "").split("/").map(Number);
    if (model && Number.isFinite(input) && Number.isFinite(output))
      prices[modelName(model)] = { input: input as number, output: output as number };
  }
  return prices;
}

/** "anthropic/claude-sonnet-5" → "claude-sonnet-5". */
export function modelName(model: string) {
  return model
    .trim()
    .replace(/^[^/:]*[/:]/, "")
    .toLowerCase();
}
const provider = (model: string) =>
  /^claude/.test(model) ? "anthropic" : /^gemini/.test(model) ? "google" : "openai";

export function priceOf(model: string, prices: Record<string, Price>) {
  const name = modelName(model);
  const keys = Object.keys(prices).sort((a, b) => b.length - a.length);
  // "claude-haiku-4.5" is also written "claude-haiku-4-5".
  const key =
    keys.find((k) => name.startsWith(k)) ??
    keys.find((k) => name.replace(/\./g, "-").startsWith(k));
  return key ? prices[key] : undefined;
}

/** Estimated cost in dollars, or undefined for a model without a known price. */
export function costOf(model: string, tokens: Tokens, prices: Record<string, Price>) {
  const price = priceOf(model, prices);
  if (!price) return tokens.searches ? tokens.searches * SEARCH_PRICE : undefined;
  const write = provider(modelName(model)) === "anthropic" ? 1.25 : 1;
  return (
    (tokens.input * price.input +
      tokens.cacheRead * price.input * 0.1 +
      tokens.cacheWrite * price.input * write +
      tokens.output * price.output) /
      1_000_000 +
    tokens.searches * SEARCH_PRICE
  );
}

/** A Claude Messages API `usage` object. */
export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number } | null;
}
export function fromAnthropic(usage: AnthropicUsage | undefined): Tokens | undefined {
  if (!usage) return undefined;
  return {
    input: usage.input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    searches: usage.server_tool_use?.web_search_requests ?? 0,
  };
}
/** TanStack AI usage, whose prompt tokens include cache reads except for Claude. */
export function fromTanstack(
  model: string,
  usage: {
    promptTokens: number;
    completionTokens: number;
    promptTokensDetails?: { cachedTokens?: number; cacheWriteTokens?: number };
    providerUsageDetails?: unknown;
  },
): Tokens {
  const cacheRead = usage.promptTokensDetails?.cachedTokens ?? 0;
  const cacheWrite = usage.promptTokensDetails?.cacheWriteTokens ?? 0;
  const claude = provider(modelName(model)) === "anthropic";
  const details = usage.providerUsageDetails as
    | { serverToolUse?: { webSearchRequests?: number } }
    | undefined;
  return {
    input: claude ? usage.promptTokens : Math.max(0, usage.promptTokens - cacheRead),
    cacheRead,
    cacheWrite,
    output: usage.completionTokens,
    searches: details?.serverToolUse?.webSearchRequests ?? 0,
  };
}

interface UsageLine extends Tokens {
  kind: UsageKind;
  model: string;
  calls: number;
}
interface UsageMonth {
  /** The month in UTC, "2026-09". */
  id: string;
  lines: UsageLine[];
  updatedAt: string;
}
const TOKEN_KEYS = ["input", "cacheRead", "cacheWrite", "output", "searches"] as const;

/**
 * Model usage per person per month, kept to see what each person costs and, later, to set plan
 * limits. Costs are estimates from list prices; the provider's bill is the final word.
 */
export class UsageMeter {
  private readonly queues = new Map<string, Promise<void>>();
  constructor(
    private readonly db: Store,
    private readonly prices: Record<string, Price> = { ...PRICES, ...parsePrices() },
    private readonly now: () => Date = () => new Date(),
  ) {}
  /** Adds one call; calls for one person are saved one at a time so none are lost. */
  record(owner: string, kind: UsageKind, model: string, tokens: Tokens): Promise<void> {
    const name = modelName(model);
    const month = this.now().toISOString().slice(0, 7);
    const previous = this.queues.get(owner) ?? Promise.resolve();
    const next = previous.then(async () => {
      const current = (await this.db.get<UsageMonth>(owner, "usage", month)) ?? {
        id: month,
        lines: [],
        updatedAt: "",
      };
      let line = current.lines.find((l) => l.kind === kind && l.model === name);
      if (!line) {
        line = {
          kind,
          model: name,
          calls: 0,
          input: 0,
          cacheRead: 0,
          cacheWrite: 0,
          output: 0,
          searches: 0,
        };
        current.lines.push(line);
      }
      line.calls++;
      for (const key of TOKEN_KEYS) line[key] += Math.max(0, Math.round(tokens[key] || 0));
      current.updatedAt = this.now().toISOString();
      await this.db.put(owner, "usage", current);
    });
    const settled = next.catch((error: unknown) => {
      console.warn(
        `[OpenMuse] Usage not saved: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    this.queues.set(owner, settled);
    void settled.then(() => {
      if (this.queues.get(owner) === settled) this.queues.delete(owner);
    });
    return settled;
  }
  /** A sink that records for one person and purpose without waiting. */
  sink(owner: string, kind: UsageKind): UsageSink {
    return (model, tokens) => void this.record(owner, kind, model, tokens);
  }
  /** One month's usage with estimated costs; the current month by default. */
  async month(owner: string, month = this.now().toISOString().slice(0, 7)) {
    const saved = await this.db.get<UsageMonth>(owner, "usage", month);
    const lines = (saved?.lines ?? []).map((line) => ({
      ...line,
      cost: costOf(line.model, line, this.prices),
    }));
    return {
      month,
      cost: lines.reduce((sum, line) => sum + (line.cost ?? 0), 0),
      calls: lines.reduce((sum, line) => sum + line.calls, 0),
      /** Models without a price, whose cost is left out. */
      unpriced: [...new Set(lines.filter((l) => l.cost === undefined).map((l) => l.model))],
      lines: lines.sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)),
    };
  }
  /** Earlier months, newest first, with their totals. */
  async history(owner: string) {
    const months = await this.db.list<UsageMonth>(owner, "usage");
    return Promise.all(
      months
        .map((m) => m.id)
        .sort()
        .reverse()
        .slice(0, 12)
        .map(async (id) => {
          const { month, cost, calls } = await this.month(owner, id);
          return { month, cost, calls };
        }),
    );
  }
}
