import { randomUUID } from "node:crypto";
import type { Artifact } from "../../../packages/domain/src/index.ts";
import type { Blobs } from "./blobs.ts";
import type { Store } from "./db.ts";
import type { Depth } from "./depth.ts";
import { AppError } from "./errors.ts";
import type { Files } from "./files.ts";
import type { Plans } from "./plans.ts";
import type { UsageMeter } from "./usage.ts";

/**
 * Pictures people ask for ("make me a picture of a poodle astronaut"), made through OpenRouter's
 * image endpoint with the key the server already has (owner, 2026-11-07: OpenRouter only, new
 * pictures only, a Draft by default and a Good one on request, the standard limits, and every
 * picture animates as a living photo for free).
 *
 * Each picture is saved to the person's Files at once (no Save step), with a depth map beside it
 * for the app's motion. Counted against the plan (`Plans.claimPicture`), priced from what
 * OpenRouter reports for that call, and off everywhere when the admin turns pictures off.
 */
export type PictureQuality = "draft" | "good";
export type PictureAspect = "square" | "wide" | "tall";

export interface PictureSettings {
  id: "current";
  enabled: boolean;
  /** OpenRouter image model ids ("black-forest-labs/flux-3-image-klein"). */
  draft: string;
  good: string;
}
/** Chosen for price per picture on OpenRouter's image list (2026-11-07). */
export const DEFAULT_PICTURE_MODELS = {
  // About 0.9¢ at 1K: quick, decent, every aspect ratio.
  draft: "black-forest-labs/flux-3-image-klein",
  // About 1.8¢ at 1K: better faces, lettering and detail.
  good: "bytedance-seed/seedream-5-0-flash",
};
const ASPECTS: Record<PictureAspect, string> = { square: "1:1", wide: "16:9", tall: "9:16" };
/** The prompt is kept short: a sentence or two, never a page. */
export const PROMPT_LIMIT = 600;
/**
 * The standard limits (owner): nothing sexual or violent, no real person's likeness, no one who
 * looks under 18. The provider has its own checks; this catches the plain cases before paying,
 * with words that are rarely innocent (a blood orange, a murder of crows and a topless jeep pass).
 */
const REFUSED =
  /\b(nude|nudity|sex|sexual|porn|pornograph(y|ic)|erotic|erotica|nsfw|lingerie|naked (wo)?m[ae]n|naked (girl|boy|child|children|people|body|bodies)|gore|gory|beheaded|beheading|decapitat\w*|mutilat\w*|torture[ds]?|torturing|dismember\w*|murder (scene|victim)|dead bod(y|ies)|underage|child(ren)? (in )?(lingerie|underwear))\b/i;

export interface MadePicture {
  id: string;
  prompt: string;
  quality: PictureQuality;
  aspect: PictureAspect;
  model: string;
  file: Artifact;
  /** A depth map exists beside it, for the living-photo motion. */
  depth: boolean;
  /** Dollars OpenRouter reported for the call, when it did. */
  cost?: number;
}

interface ImageAnswer {
  data?: { b64_json?: string; media_type?: string }[];
  usage?: { cost?: number };
  error?: { message?: string };
}

/** This month's pictures (or only the good ones) are used up: said in the plan's words. */
export class PictureLimit extends AppError {
  constructor(
    message: string,
    /** Only the good kind is used up; a draft can still be made. */
    public readonly goodOnly: boolean,
  ) {
    super(message, 429);
    this.name = "PictureLimit";
  }
}

export class Pictures {
  constructor(
    private readonly db: Store,
    private readonly files: Files,
    private readonly blobs: Blobs,
    private readonly options: {
      key?: () => string | undefined;
      base?: string;
      fetcher?: typeof fetch;
      usage?: UsageMeter;
      plans?: Pick<Plans, "claimPicture">;
      depth?: Depth;
      /** Who made it, for the file's source line ("Made by Neddy"). */
      agentName?: (owner: string) => Promise<string>;
    } = {},
  ) {}
  private get key() {
    return this.options.key?.() ?? process.env.OPENROUTER_API_KEY?.trim();
  }
  /** Pictures can be made here: a key is set and the admin hasn't turned them off. */
  async available(): Promise<boolean> {
    return Boolean(this.key) && (await this.settings()).enabled;
  }
  async settings(): Promise<PictureSettings> {
    const saved = await this.db.get<Partial<PictureSettings>>("system", "pictures", "current");
    return {
      id: "current",
      enabled: saved?.enabled !== false,
      draft: saved?.draft?.trim() || DEFAULT_PICTURE_MODELS.draft,
      good: saved?.good?.trim() || DEFAULT_PICTURE_MODELS.good,
    };
  }
  /** The admin's switch and model choices; an empty model goes back to the default. */
  async save(patch: Partial<Pick<PictureSettings, "enabled" | "draft" | "good">>) {
    const current = await this.settings();
    const next: PictureSettings = {
      id: "current",
      enabled: patch.enabled ?? current.enabled,
      draft:
        patch.draft !== undefined
          ? patch.draft.trim() || DEFAULT_PICTURE_MODELS.draft
          : current.draft,
      good:
        patch.good !== undefined ? patch.good.trim() || DEFAULT_PICTURE_MODELS.good : current.good,
    };
    for (const model of [next.draft, next.good])
      if (!/^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(model))
        throw new AppError(
          "A picture model is the company, a slash, then the model, like black-forest-labs/flux-3-image-klein.",
          422,
        );
    await this.db.put("system", "pictures", next);
    return next;
  }
  /** Why a prompt can't be drawn, in words for the person; undefined when it can. */
  static refused(prompt: string) {
    const hit = REFUSED.exec(prompt);
    if (hit)
      return `I can’t draw that one: “${hit[0].toLowerCase()}” is on my no-go list. Try other words?`;
    return undefined;
  }
  /**
   * Makes one picture, saves it to Files with its depth map, counts it and prices it. Asking
   * again with the same `id` (a retry) is never counted twice.
   */
  async make(
    owner: string,
    request: { prompt: string; quality?: PictureQuality; aspect?: PictureAspect; id?: string },
  ): Promise<MadePicture> {
    const prompt = request.prompt.replace(/\s+/g, " ").trim();
    if (!prompt) throw new AppError("Say what the picture should show.", 422);
    if (prompt.length > PROMPT_LIMIT)
      throw new AppError(`Keep it under ${PROMPT_LIMIT} characters.`, 422);
    const why = Pictures.refused(prompt);
    if (why) throw new AppError(why, 422);
    const settings = await this.settings();
    if (!settings.enabled) throw new AppError("Pictures are turned off here.", 503);
    const key = this.key;
    if (!key) throw new AppError("Pictures aren’t set up here yet.", 503);
    const quality: PictureQuality = request.quality === "good" ? "good" : "draft";
    const aspect: PictureAspect = request.aspect ?? "square";
    const id = request.id ?? randomUUID();
    const claim = await this.options.plans?.claimPicture(owner, id, quality === "good");
    if (claim && !claim.ok)
      throw new PictureLimit(claim.text, "good" in claim && claim.good === true);
    const model = quality === "good" ? settings.good : settings.draft;
    const base =
      this.options.base ??
      process.env.OPENROUTER_BASE_URL?.trim() ??
      "https://openrouter.ai/api/v1";
    const fetcher = this.options.fetcher ?? fetch;
    let answer: ImageAnswer;
    let response: Response;
    try {
      response = await fetcher(`${base}/images`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Neddy",
        },
        body: JSON.stringify({
          model,
          prompt,
          aspect_ratio: ASPECTS[aspect],
          resolution: "1K",
          n: 1,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      answer = (await response.json().catch(() => ({}))) as ImageAnswer;
    } catch (error) {
      console.warn(
        `[OpenMuse] A picture couldn't be made (${model}): ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new AppError("The picture couldn’t be made just now. Try again in a minute.", 502);
    }
    const first = answer.data?.[0];
    if (!response.ok || !first?.b64_json) {
      // The provider's own reason goes in the log (never the key), plain words to the person.
      console.warn(
        `[OpenMuse] A picture couldn't be made (${model}): ${response.status} ${answer.error?.message ?? "no image in the answer"}`,
      );
      throw new AppError(
        response.status === 402
          ? "The picture service has run out of credit. The admin needs to top it up."
          : /safety|moderat|policy|content/i.test(answer.error?.message ?? "")
            ? "That one was turned down by the picture service. Try describing it another way."
            : "The picture couldn’t be made just now. Try again in a minute.",
        502,
      );
    }
    const bytes = new Uint8Array(Buffer.from(first.b64_json, "base64"));
    const ext = /jpe?g/i.test(first.media_type ?? "")
      ? "jpg"
      : /webp/i.test(first.media_type ?? "")
        ? "webp"
        : "png";
    const name = `${
      prompt
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "picture"
    }.${ext}`;
    const agent = (await this.options.agentName?.(owner).catch(() => undefined)) ?? "Neddy";
    const file = await this.files.import(owner, name, bytes, `Made by ${agent}`);
    const cost = typeof answer.usage?.cost === "number" ? answer.usage.cost : undefined;
    if (cost !== undefined)
      void this.options.usage?.recordCost(owner, "pictures", model, cost).catch(() => undefined);
    // The living photo's depth map, made now so the card can move as soon as it shows.
    let depth = false;
    const map = await this.options.depth?.map(bytes).catch(() => undefined);
    if (map) {
      await this.blobs.put(Pictures.depthKey(file.id), map, "image/png");
      depth = true;
    }
    await this.db.put(owner, "pictures", {
      id: file.id,
      prompt,
      quality,
      aspect,
      model,
      depth,
      createdAt: new Date().toISOString(),
    });
    return { id: file.id, prompt, quality, aspect, model, file, depth, cost };
  }
  static depthKey(fileId: string) {
    return `files/${fileId}.depth.png`;
  }
  /** The depth map beside a picture in Files, or null. */
  async depth(owner: string, fileId: string) {
    await this.files.get(owner, fileId);
    return this.blobs.get(Pictures.depthKey(fileId));
  }
  /** What the app shows about a picture file (its prompt and kind), or undefined for other files. */
  async about(owner: string, fileId: string) {
    return this.db.get<{ prompt: string; quality: PictureQuality; depth: boolean }>(
      owner,
      "pictures",
      fileId,
    );
  }
}
