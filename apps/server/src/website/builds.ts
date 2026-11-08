import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config.ts";
import type { Store } from "../db.ts";
import type { CallPlan } from "../engine/tanstack-agent.ts";
import { backgroundFailure } from "../log.ts";
import type { MiniApps } from "../mini-apps.ts";
import type { UsageSink } from "../usage.ts";
import { type BuiltSite, buildWebsite, type RenderedPage } from "./builder.ts";

/**
 * Websites Neddy builds for the person (owner, 2026-11-08: a quick model on a page-builder made for
 * calculators produced a page that looked like 2009). A build runs in the background on the strong
 * model, takes a few minutes, and the person is told when it's ready. The page is kept as a mini
 * app of kind "website", so opening, sharing and deleting already work.
 */
const KIND = "website-builds";
const MIN_BRIEF = 60;
const MAX_BRIEF = 20_000;
/** Each build uses a strong model (up to three long rounds): a person's limit in any 24 hours… */
export const BUILDS_PER_DAY = 6;
/** …and everyone's together, so a crowd of accounts can't run up the bill. */
export const BUILDS_PER_DAY_ALL = 40;
const AT_ONCE = 2;
const DAY_MS = 24 * 60 * 60_000;
/** A build that hasn't finished by then has hung; it's stopped so it can't hold a slot forever. */
const DEADLINE_MS = 12 * 60_000;
/** A "working" record nobody is running (the server restarted) is given up after this long. */
const ORPHAN_AFTER_MS = 60_000;
const KEEP_RECORDS_MS = 30 * DAY_MS;

export interface BuildRecord {
  id: string;
  name: string;
  status: "working" | "done" | "failed";
  stage: string;
  startedAt: string;
  finishedAt?: string;
  appId?: string;
  title?: string;
  rounds?: number;
  /** Whether the page was drawn and measured by a browser, not only checked as code. */
  measured?: boolean;
  /** What the checks still found when the build ended (empty is clean). */
  problems?: string[];
  error?: string;
  /** What it was built from, so "change the headline" can rebuild from the same facts. */
  brief?: string;
  briefHash?: string;
}

export interface BuildsDeps {
  plan: () => CallPlan;
  complete: (
    options: CallPlan & { system: string; prompt: string; onUsage?: UsageSink },
  ) => Promise<string>;
  usage?: (owner: string) => UsageSink | undefined;
  render?: (html: string) => Promise<RenderedPage[] | undefined>;
  miniApps: MiniApps;
  notify: (owner: string, title: string, body: string, key: string) => Promise<void>;
  /** The server has an AI model to write with. */
  ready: () => boolean;
  now?: () => number;
  /** Everyone's records, to hold the server-wide limit. */
  everyone?: () => Promise<BuildRecord[]>;
}

/** Draws a page in the browser worker, with no network, at phone and desktop width. */
export function workerRenderer(config: Pick<Config, "workerUrl" | "workerToken">) {
  if (!config.workerUrl || !config.workerToken) return undefined;
  return async (html: string): Promise<RenderedPage[] | undefined> => {
    const response = await fetch(`${config.workerUrl}/render`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.workerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ html, widths: [390, 1280] }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { pages?: RenderedPage[] };
    return body.pages;
  };
}

const hashOf = (text: string) =>
  createHash("sha256").update(text.trim()).digest("hex").slice(0, 24);

type StartInput = { brief: string; name?: string; of?: string; change?: string };

export class WebsiteBuilds {
  private readonly running = new Map<string, Promise<void>>();
  /** One start at a time per person, so two at once can't both pass the limits. */
  private readonly starting = new Map<string, Promise<unknown>>();
  constructor(
    private readonly db: Store,
    private readonly deps: BuildsDeps,
  ) {}
  private now() {
    return this.deps.now?.() ?? Date.now();
  }
  get available() {
    return this.deps.ready();
  }
  /** Their builds, newest first; one that no longer runs (a restart) is closed as interrupted. */
  async list(owner: string) {
    const all = (await this.db.list<BuildRecord>(owner, KIND)).sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
    const now = this.now();
    const kept: BuildRecord[] = [];
    for (const build of all) {
      const age = now - Date.parse(build.startedAt);
      if (build.status === "working" && !this.running.has(build.id) && age > ORPHAN_AFTER_MS) {
        Object.assign(build, {
          status: "failed",
          stage: "Interrupted",
          finishedAt: new Date(now).toISOString(),
          error: "The server restarted while it was building.",
        } satisfies Partial<BuildRecord>);
        await this.db.put<BuildRecord>(owner, KIND, build);
      } else if (age > KEEP_RECORDS_MS && build.status !== "working") {
        await this.db.remove(owner, KIND, build.id);
        continue;
      }
      kept.push(build);
    }
    return kept;
  }
  async get(owner: string, id?: string) {
    const all = await this.list(owner);
    return id ? all.find((b) => b.id === id) : all[0];
  }
  private async update(owner: string, id: string, patch: Partial<BuildRecord>) {
    const current = await this.db.get<BuildRecord>(owner, KIND, id);
    if (current) await this.db.put<BuildRecord>(owner, KIND, { ...current, ...patch });
  }
  /** A build that failed before the model wrote anything cost nothing, so it doesn't use up the day. */
  private counts(build: BuildRecord) {
    return !(build.status === "failed" && !build.rounds);
  }

  /**
   * Starts a build and returns at once; the page is ready in a few minutes. With `of` (a website's id)
   * and `change` it rebuilds that website from the same facts plus the change, replacing the page.
   */
  start(owner: string, input: StartInput) {
    const turn = (this.starting.get(owner) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.begin(owner, input));
    this.starting.set(owner, turn);
    return turn;
  }
  private async begin(owner: string, input: StartInput) {
    if (!this.available) return { reason: "no-model" as const };
    let brief = input.brief.trim();
    let replaces: string | undefined;
    let name = input.name?.trim() || "Website";
    const all = await this.list(owner);
    if (input.of) {
      const earlier = all.find((b) => b.appId === input.of && b.brief);
      if (!earlier) return { reason: "no-original" as const };
      if (!input.change?.trim()) return { reason: "thin" as const };
      brief = `${earlier.brief}\n\nTHE PERSON NOW ASKS FOR THIS CHANGE (a style or content wish; apply it, keep everything else, and still use only the facts above):\n${input.change.trim().slice(0, 2000)}`;
      replaces = input.of;
      name = input.name?.trim() || earlier.name;
    }
    if (brief.length < MIN_BRIEF) return { reason: "thin" as const };
    const hash = hashOf(brief);
    // The same request again while it's still building (a doubled tool call) is the same build.
    const twin = all.find((b) => b.status === "working" && b.briefHash === hash);
    if (twin) return { build: twin };
    if (all.filter((b) => b.status === "working").length >= AT_ONCE)
      return { reason: "busy" as const };
    const since = this.now() - DAY_MS;
    if (
      all.filter((b) => this.counts(b) && Date.parse(b.startedAt) > since).length >= BUILDS_PER_DAY
    )
      return { reason: "limit" as const };
    if (this.deps.everyone) {
      const everyone = await this.deps.everyone().catch(() => [] as BuildRecord[]);
      if (
        everyone.filter((b) => this.counts(b) && Date.parse(b.startedAt) > since).length >=
        BUILDS_PER_DAY_ALL
      )
        return { reason: "busy-server" as const };
    }
    const record: BuildRecord = {
      id: randomUUID(),
      name: name.slice(0, 80),
      status: "working",
      stage: "Starting",
      startedAt: new Date(this.now()).toISOString(),
      brief: brief.slice(0, MAX_BRIEF),
      briefHash: hash,
    };
    await this.db.put<BuildRecord>(owner, KIND, record);
    const run = this.run(owner, record, brief.slice(0, MAX_BRIEF), replaces).finally(() =>
      this.running.delete(record.id),
    );
    this.running.set(record.id, run);
    return { build: record };
  }
  /** The saved website, as the card shows it (without its page). */
  async app(owner: string, id: string) {
    return this.deps.miniApps.summary(owner, id).catch(() => undefined);
  }
  /** Waits for builds in flight (tests and shutdown). */
  async settled() {
    await Promise.all([...this.running.values()]);
  }

  private async run(owner: string, record: BuildRecord, brief: string, replaces?: string) {
    let saved: { id: string; title: string } | undefined;
    let site: BuiltSite | undefined;
    try {
      const plan = this.deps.plan();
      const sink = this.deps.usage?.(owner);
      const work = buildWebsite(brief, {
        complete: (system, prompt) =>
          this.deps.complete({ ...plan, system, prompt, ...(sink ? { onUsage: sink } : {}) }),
        ...(this.deps.render ? { render: this.deps.render } : {}),
        progress: (stage) => this.update(owner, record.id, { stage }),
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("It took too long and was stopped.")),
          DEADLINE_MS,
        );
        timer.unref?.();
      });
      site = await Promise.race([work, deadline]).finally(() => clearTimeout(timer));
      const app = await this.deps.miniApps.save(owner, {
        ...(replaces ? { id: replaces } : {}),
        kind: "website",
        title: site.parts.title.slice(0, 80) || record.name,
        description: (site.parts.description ?? `A website for ${record.name}`).slice(0, 240),
        html: site.html,
      });
      saved = { id: app.id, title: app.title };
      await this.update(owner, record.id, {
        status: "done",
        stage: "Ready",
        finishedAt: new Date(this.now()).toISOString(),
        appId: app.id,
        title: app.title,
        rounds: site.rounds,
        measured: site.measured,
        problems: site.problems.filter((p) => p.level === "error").map((p) => p.message),
      });
    } catch (error) {
      backgroundFailure("a website build", error);
      await this.update(owner, record.id, {
        status: "failed",
        stage: "Couldn’t finish",
        finishedAt: new Date(this.now()).toISOString(),
        error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
        ...(site ? { rounds: site.rounds } : {}),
      }).catch(() => undefined);
    }
    // Telling the person can fail without undoing a page that was saved.
    const errors = site?.problems.filter((p) => p.level === "error").length ?? 0;
    const unnamed = record.name === "Website";
    const title = saved
      ? `Your website${unnamed ? "" : ` for ${record.name}`} is ready`
      : `${unnamed ? "Your website" : `The website for ${record.name}`} didn’t get built`;
    const body = saved
      ? `${errors ? "It’s built, but the checks flagged something. Ask me what, or open it" : "Open it"} from Files & media › Mini apps, or ask me to show it.${site?.measured ? "" : " It was checked as code only, not drawn on a phone."}`
      : "Something went wrong while building it. Ask me to try again (it may count toward today’s limit).";
    await this.deps.notify(owner, title, body, `website:${record.id}`).catch(() => undefined);
  }
}

export const websiteInstructions =
  " To build a website for a business (a one-page site, landing page or demo site), use build_website, never make_mini_app: pass the person's whole request and every fact they gave in `brief`, word for word. It builds in the background on a stronger model and takes a few minutes (sometimes ten), so say so and carry on; check_website_build tells you how it's going, and the person is notified when it's ready. To change a finished website, call build_website again with its id (`of`) and the change: it rebuilds from the same facts and replaces the page, and counts toward the limit. Don't make up facts to fill a gap and don't summarise their reviews or quotes: the builder uses only what's in the brief. In the chat, a finished website shows as a card with an Open button when you call check_website_build.";

export function websiteToolSpecs(
  builds: WebsiteBuilds,
  owner: string,
  options: { check?: boolean } = {},
) {
  const check = {
    name: "check_website_build",
    description:
      "How a website build is going, or the finished site: pass the id build_website gave, or nothing for the latest. When it's done the result is the website itself (in the chat it shows as a card with an Open button).",
    parameters: z.object({ id: z.string().max(60).optional() }),
    execute: async ({ id }: { id?: string }) => {
      const build = await builds.get(owner, id);
      if (!build) return { none: true, message: "No website has been built yet." };
      if (build.status === "working")
        return {
          working: true,
          stage: build.stage,
          message: `Still working: ${build.stage}. Say so briefly; it can take a few minutes, sometimes ten.`,
        };
      if (build.status === "failed")
        return {
          failed: true,
          message: `It didn’t get built${build.error ? ` (${build.error})` : ""}. Offer to try again; a build that failed after the model had written something counts toward the limit.`,
        };
      const app = build.appId ? await builds.app(owner, build.appId) : undefined;
      if (!app)
        return {
          gone: true,
          message:
            "That website was built but has since been removed from Files. Offer to build it again.",
        };
      const problems = build.problems ?? [];
      return {
        ...app,
        ready: true,
        measured: build.measured === true,
        ...(problems.length ? { problems } : {}),
        message: `It's ready. Say so in a sentence. ${problems.length ? `The automatic checks still flagged: ${problems.slice(0, 3).join(" ")} Mention it plainly. ` : ""}${build.measured ? "It was drawn and measured at phone and computer width. " : "It was checked as code only; it wasn't drawn in a browser, so don't say it was checked on a phone. "}The person can open it from Files & media › Mini apps (in the chat it also shows as a card with an Open button). Offer to change anything (build_website with its id), or to share it by link (share_mini_app). A tap on the phone number or map link may not work inside the app or from a shared link yet: if they ask, say the number and address are still on the page to copy.`,
      };
    },
  };
  // A background job reads email and web pages, which can't be trusted to spend money: only the chat starts a build.
  if (options.check) return [check];
  return [
    {
      name: "build_website",
      description:
        "Build a complete, polished, responsive one-page website for a business: a real design (type, layout, colour, icons, call buttons, reviews, hours, map link) on a stronger model, then drawn and measured at phone and desktop width when the browser is available (check_website_build says if it wasn't). Use for 'build me a website', a landing page or a demo site. NOT for calculators, trackers or dashboards (use make_mini_app). brief: the person's whole request plus every fact they gave (name, phone, address, hours, services, reviews, rating, banner or footer wording, style wishes), pasted word for word. Never add facts and never summarise quotes. It runs in the background (a few minutes); say so, then carry on. Don't ask questions you can answer from the brief; ask only if the business name or what it does is missing. To change a finished website, pass its id as `of` and the change as `change` (brief can then be a few words): it is rebuilt from the same facts and replaces the page.",
      parameters: z.object({
        brief: z
          .string()
          .min(1)
          .max(MAX_BRIEF)
          .describe("Their request and all their facts, verbatim"),
        name: z
          .string()
          .max(80)
          .optional()
          .describe("The business or site name, for the status line"),
        of: z.string().max(60).optional().describe("To change a finished website: its id"),
        change: z.string().max(2000).optional().describe("With `of`: what to change"),
      }),
      execute: async ({
        brief,
        name,
        of,
        change,
      }: {
        brief: string;
        name?: string;
        of?: string;
        change?: string;
      }) => {
        const started = await builds.start(owner, {
          brief,
          ...(name ? { name } : {}),
          ...(of ? { of } : {}),
          ...(change ? { change } : {}),
        });
        if ("reason" in started) {
          const reasons: Record<string, string> = {
            "no-model": "Building websites needs the AI model, which isn't set up on this server.",
            thin: "That isn’t enough to build from. Ask for the business’s name and what it does, and any phone, address, hours or reviews they want on the page, then try again. (To change a website, give its id and what to change.)",
            "no-original":
              "That website wasn't built here, so there are no facts to rebuild it from. Offer to build it again from their facts.",
            limit: `${BUILDS_PER_DAY} websites in any 24 hours is the most, because each one uses a stronger, more expensive AI model. A build that failed before it wrote anything doesn't count. One frees up as the oldest passes 24 hours.`,
            busy: "Two websites are already being built. Wait for one to finish.",
            "busy-server":
              "Lots of websites are being built across the whole service today, so this one has to wait. Ask again later.",
          };
          return {
            started: false,
            message: reasons[started.reason as string] ?? "It couldn't start.",
          };
        }
        return {
          started: true,
          id: started.build.id,
          message:
            "Started (or already building from this same request). It takes a few minutes, sometimes ten, and runs in the background. Tell the person that, that they'll get a notice when it's ready, and carry on. check_website_build shows how it's going.",
        };
      },
    },
    check,
  ];
}
