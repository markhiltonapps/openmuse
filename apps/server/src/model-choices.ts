import type { Store } from "./db.ts";
import { lastCalls } from "./engine/tanstack-agent.ts";
import type { Price } from "./usage.ts";

/**
 * Which model does which job (owner, 2026-10-06): the chat (hard, important work), background
 * jobs and routines (many steps), and simple jobs (summaries, Ideas, bookings from emails).
 *
 * With OPENROUTER_API_KEY set, each job uses the pick below unless the admin chose another on the
 * Models card. Without it, or for "the server's model", the job keeps MODEL / WORKER_MODEL, the
 * Claude setup that was there before, so switching back is one tap. A call OpenRouter can't start
 * (no credit, an outage) is answered by that Claude model too.
 */
export type ModelJob = "chat" | "background" | "simple";
export const MODEL_JOBS: ModelJob[] = ["chat", "background", "simple"];
export type Effort = "low" | "medium" | "high";

/** The server's own model (MODEL, or WORKER_MODEL for background and simple jobs). */
export const SERVER_MODEL = "server";

export interface ModelChoice {
  /** "openrouter/vendor/model", or SERVER_MODEL. */
  model: string;
  /** How hard a reasoning model thinks; OpenRouter models only. */
  effort?: Effort;
  /** OpenRouter's price when it was chosen, for a model the usage meter doesn't know. */
  price?: Price;
}

/**
 * Chosen by cost per finished task, not price per token: GPT-6.1 Sol came close to the best model
 * in a coding-agent benchmark at a fraction of its cost per task, and used the fewest tokens.
 * Never its "-pro" variant (same price, several times the reasoning tokens). Simple jobs need a
 * cheap, fast model that doesn't burn tokens.
 */
export const RECOMMENDED: Record<ModelJob, { model: string; effort: Effort }> = {
  chat: { model: "openrouter/openai/gpt-6.1-sol", effort: "high" },
  background: { model: "openrouter/openai/gpt-6.1-sol", effort: "medium" },
  simple: { model: "openrouter/deepseek/deepseek-v4.1-flash", effort: "low" },
};

/** Most each call may write (reasoning included): room for big jobs, little for simple ones. */
export const OUTPUT_LIMITS: Record<ModelJob, number> = {
  chat: 16_000,
  background: 32_000,
  simple: 4_000,
};
/** A simple job that thinks harder gets room for its thinking, or its answer would be cut off. */
export const outputLimit = (job: ModelJob, effort: Effort) =>
  job === "simple" ? { low: 4_000, medium: 8_000, high: 16_000 }[effort] : OUTPUT_LIMITS[job];

/** The models the card offers by name; anything else is checked against OpenRouter's list. */
export const PICKS = {
  "gpt-6.1-sol": "openrouter/openai/gpt-6.1-sol",
  "deepseek-v4.1-flash": "openrouter/deepseek/deepseek-v4.1-flash",
  claude: SERVER_MODEL,
} as const;

/**
 * Input above 272,000 tokens costs about twice as much on GPT-6.1 Sol, so an OpenRouter call's
 * oldest messages are left out past this many (estimated) tokens.
 */
export const CONTEXT_LIMIT = 250_000;

/** What a call should use. */
export interface ModelPlan {
  model: string;
  effort?: Effort;
  /** Output cap, for OpenRouter models. */
  maxTokens?: number;
  /** Input cap in estimated tokens, for OpenRouter models. */
  contextLimit?: number;
  /** The server's own model, for a call OpenRouter can't start. */
  fallback?: string;
  job?: ModelJob;
}

const isOpenRouter = (model: string) => /^openrouter[/:]/i.test(model.trim());
/** "openrouter/vendor/model" with a sensible vendor and model. */
export const validOpenRouterModel = (model: string) =>
  /^openrouter\/[a-z0-9][\w.-]*\/[\w.:-]+$/i.test(model.trim()) && !/-pro\b/i.test(model);

/** A model in OpenRouter's public list (openrouter.ai/api/v1/models). */
interface ListedModel {
  id: string;
  supported_parameters?: string[];
  /** Dollars per token, as strings. */
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string };
}
const perMillion = (value?: string) => Math.round(Number(value ?? Number.NaN) * 1e6 * 1e4) / 1e4;
function priceOf(model: ListedModel): Price | undefined {
  const input = perMillion(model.pricing?.prompt);
  const output = perMillion(model.pricing?.completion);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  const cacheRead = perMillion(model.pricing?.input_cache_read);
  return { input, output, ...(Number.isFinite(cacheRead) ? { cacheRead } : {}) };
}

interface SavedChoices {
  id: "current";
  jobs: Partial<Record<ModelJob, ModelChoice>>;
  updatedAt: string;
}

export class ModelChoices {
  private saved: SavedChoices["jobs"] = {};
  private listed?: { at: number; models: Map<string, ListedModel> };
  private readonly hasKey: () => boolean;
  constructor(
    private readonly db: Store,
    private readonly server: { model?: string; workerModel?: string },
    private readonly options: {
      /** OpenRouter is set up; OPENROUTER_API_KEY by default. */
      hasKey?: () => boolean;
      /** Tells the usage meter the price of a model it doesn't know. */
      onPrice?: (model: string, price: Price) => void;
      fetcher?: typeof fetch;
    } = {},
  ) {
    this.hasKey = options.hasKey ?? (() => Boolean(process.env.OPENROUTER_API_KEY?.trim()));
  }
  /** Reads the admin's saved choices; call once at startup. */
  async load() {
    const found = await this.db.get<SavedChoices>("system", "model-choices", "current");
    this.saved = found?.jobs ?? {};
    for (const choice of Object.values(this.saved))
      if (choice?.price) this.options.onPrice?.(choice.model, choice.price);
    return this;
  }
  /** OpenRouter is set up on this server. */
  get ready() {
    return this.hasKey();
  }
  /** The server's own model for a job: MODEL for the chat, WORKER_MODEL (or MODEL) otherwise. */
  serverModel(job: ModelJob) {
    return job === "chat" ? this.server.model : (this.server.workerModel ?? this.server.model);
  }
  /** The admin's choice, else the recommendation (which waits for the key). */
  choice(job: ModelJob): ModelChoice {
    return this.saved[job] ?? RECOMMENDED[job];
  }
  /** What a call for this job uses right now. */
  plan(job: ModelJob): ModelPlan {
    const chosen = this.choice(job);
    const server = this.serverModel(job);
    if (chosen.model === SERVER_MODEL || !isOpenRouter(chosen.model) || !this.ready)
      return { model: server ?? "" };
    const effort = chosen.effort ?? RECOMMENDED[job].effort;
    return {
      model: chosen.model,
      effort,
      maxTokens: outputLimit(job, effort),
      contextLimit: CONTEXT_LIMIT,
      ...(server ? { fallback: server } : {}),
      job,
    };
  }
  /** For the Models card. */
  view() {
    return {
      ready: this.ready,
      jobs: MODEL_JOBS.map((job) => {
        const plan = this.plan(job);
        const { price: _price, ...choice } = this.choice(job);
        return {
          job,
          choice,
          saved: Boolean(this.saved[job]),
          recommended: RECOMMENDED[job],
          serverModel: this.serverModel(job) ?? null,
          using: plan.model || null,
          // How its last call went since the server started, when it's on OpenRouter.
          lastCall: plan.job ? (lastCalls.get(job) ?? null) : null,
        };
      }),
    };
  }
  /** OpenRouter's list of models, kept for ten minutes. */
  private async lookup(id: string) {
    if (!this.listed || Date.now() - this.listed.at > 600_000) {
      const base = process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
      const response = await (this.options.fetcher ?? fetch)(`${base}/models`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`OpenRouter's model list answered ${response.status}`);
      const body = (await response.json()) as { data?: ListedModel[] };
      this.listed = { at: Date.now(), models: new Map((body.data ?? []).map((m) => [m.id, m])) };
    }
    return this.listed.models.get(id);
  }
  /**
   * Refuses a model that can't do the job: a mistyped ID, a "-pro" model, one OpenRouter doesn't
   * have, or (for the chat and jobs) one that can't use tools. Returns its price.
   */
  private async check(job: ModelJob, model: string): Promise<Price | undefined> {
    if (model === SERVER_MODEL || Object.values(PICKS).includes(model as never)) return undefined;
    const id = model.replace(/^openrouter\//i, "");
    if (/-pro\b/i.test(model))
      throw new Error(
        "“-pro” models aren’t allowed here. They cost the same per token but use several times as many tokens, so they cost far more.",
      );
    if (!validOpenRouterModel(model))
      throw new Error(
        "That doesn’t look like an OpenRouter model ID. It should be the company, a slash, then the model, like openai/gpt-6.1-sol.",
      );
    let found: ListedModel | undefined;
    try {
      found = await this.lookup(id);
    } catch (error) {
      console.warn(
        `[OpenMuse] Couldn't read OpenRouter's model list: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new Error("Couldn’t reach OpenRouter to check that model. Try again in a minute.");
    }
    if (!found)
      throw new Error(
        `OpenRouter doesn’t have a model called “${id}”. Copy the ID from the model’s page at openrouter.ai/models.`,
      );
    if (job !== "simple" && !found.supported_parameters?.includes("tools"))
      throw new Error(
        `“${id}” can’t use the app’s tools, so it can’t do this kind of work. Pick another model.`,
      );
    return priceOf(found);
  }
  /** The admin's choice for one job; `null` goes back to the recommendation. */
  async save(job: ModelJob, choice: ModelChoice | null) {
    const jobs = { ...this.saved };
    if (choice) {
      const model = choice.model.trim();
      const price = await this.check(job, model);
      if (price) this.options.onPrice?.(model, price);
      jobs[job] = {
        model,
        ...(choice.effort && model !== SERVER_MODEL ? { effort: choice.effort } : {}),
        ...(price ? { price } : {}),
      };
    } else delete jobs[job];
    return this.store(jobs);
  }
  /** Every job back on Claude, or every job on its recommended pick. */
  async saveAll(pick: "claude" | "recommended") {
    return this.store(
      pick === "claude"
        ? Object.fromEntries(MODEL_JOBS.map((job) => [job, { model: SERVER_MODEL }]))
        : {},
    );
  }
  private async store(jobs: SavedChoices["jobs"]) {
    await this.db.put<SavedChoices>("system", "model-choices", {
      id: "current",
      jobs,
      updatedAt: new Date().toISOString(),
    });
    this.saved = jobs;
    return this.view();
  }
}
