import { randomUUID } from "node:crypto";
import type { Routine } from "../../../packages/domain/src/agent.ts";
import {
  createSpaceSchema,
  digestSchema,
  emptyPlaybook,
  type PlaybookPatch,
  playbookPatchSchema,
  type SocialPlaybook,
  type Space,
  STARTER_SOCIAL_PROMPTS,
} from "../../../packages/domain/src/spaces.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

const MAX_SPACES = 10;
const MAX_PROMPTS = 30;

/** The routine calls the digest needs; the agent service provides them. */
export interface RoutineCalls {
  createRoutine(owner: string, raw: unknown): Promise<Routine>;
  updateRoutine(owner: string, id: string, raw: unknown): Promise<Routine>;
  deleteRoutine(owner: string, id: string): Promise<unknown>;
}

/**
 * The weekly digest's steps. They're handed to the digest with the playbook when it runs (not kept
 * in the routine), so digests turned on earlier follow the current steps too.
 */
export const DIGEST_STEPS = `1. Competitors: for each product's competitors, use search_web (kind "social", then "web" if needed) for what they posted or advertised in the last 7 days. Note what kind of posts they were (photo, video, text) and which got the most likes, comments and shares.
2. How you did: with the connected apps (find_app_actions, then use_app), read last week's results for each platform in the playbook and any running ads. If a platform isn't connected, say so. Never estimate or invent a number. Put numbers in plain words, for example "about 300 people saw it and 12 liked it".
3. Next week: draft the playbook's number of posts, spread across its platforms in order, in its voice, each with a suggested day and time. Add ad ideas only if adIdeasPerWeek is above 0, dailyAdCeilingUsd is set, and organicUntil (if set) has passed; give each a daily budget within that limit. Check what's already queued first (list_scheduled_posts, and the playbook's scheduler app if it names one), so nothing is doubled. Queue each drafted post for its day: in the playbook's scheduler app through use_app if it names one, otherwise with schedule_post (this app's own scheduler). To start an ad, use use_app. All of these wait for the person's approval. Look up an app's actions with find_app_actions first and never guess an action's name. Nothing is posted, paid for or made with paid credits without it.
Base the drafts on the playbook's content themes and plan, and use last week's results: more of what worked, less of what didn't. When unsure between two ideas, draft both as a side-by-side test.
4. In the first digest of each month, also compare the month's results with the plan: what worked, what to stop, and any change you'd suggest to the plan or themes (the person can ask for it in the space's chat).
5. Finish with a short digest in everyday words under three headings: What competitors posted, How you did, Next week. End by saying how many drafts are waiting in Needs you for their OK.`;

/** The weekly digest routine's task: the playbook and the steps come from get_space_playbook. */
export function digestPrompt(space: Pick<Space, "id" | "name">) {
  return `Weekly social media digest for the space "${space.name}" (space id ${space.id}). First call get_space_playbook with this space id, then follow its weeklyDigestSteps and its playbook: products and competitors, platforms in order, voice, never-do list, how often to post and budget.`;
}

export class Spaces {
  constructor(
    private readonly db: Store,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async list(owner: string) {
    return (await this.db.list<Space>(owner, "spaces")).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }
  async get(owner: string, id: string) {
    const space = await this.db.get<Space>(owner, "spaces", id);
    if (!space) throw new AppError("Space not found", 404);
    return space;
  }
  /** The space whose chat this is, if any. */
  async byThread(owner: string, threadId: string) {
    return (await this.list(owner)).find((space) => space.threadId === threadId);
  }
  /**
   * The space a tool means: the one named, else this chat's, else the only one there is.
   */
  async resolve(owner: string, spaceId?: string, threadId?: string) {
    if (spaceId) return this.get(owner, spaceId);
    const spaces = await this.list(owner);
    const found =
      (threadId && spaces.find((space) => space.threadId === threadId)) ||
      (spaces.length === 1 ? spaces[0] : undefined);
    if (!found)
      throw new AppError(
        spaces.length
          ? `Say which space: ${spaces.map((s) => `${s.name} (${s.id})`).join(", ")}`
          : "There's no space yet. The person can start one from Spaces in the menu.",
        404,
      );
    return found;
  }
  async create(owner: string, raw: unknown) {
    const input = createSpaceSchema.parse(raw ?? {});
    if ((await this.db.list(owner, "spaces")).length >= MAX_SPACES)
      throw new AppError("Remove a space before adding another", 409);
    const at = this.now().toISOString();
    return this.db.put<Space>(owner, "spaces", {
      id: randomUUID(),
      kind: input.kind,
      name: input.name,
      threadId: randomUUID(),
      threadStarted: false,
      playbook: emptyPlaybook(),
      prompts: STARTER_SOCIAL_PROMPTS.map((text) => ({ id: randomUUID(), text })),
      setupDone: false,
      createdAt: at,
      updatedAt: at,
    });
  }
  private save(owner: string, space: Space) {
    return this.db.put<Space>(owner, "spaces", {
      ...space,
      updatedAt: this.now().toISOString(),
    });
  }
  /** Changes the fields given; null clears an optional one. */
  async update(owner: string, id: string, raw: unknown, setupDone?: boolean) {
    const patch: PlaybookPatch = playbookPatchSchema.parse(raw ?? {});
    const space = await this.get(owner, id);
    const playbook: Record<string, unknown> = { ...space.playbook };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete playbook[key];
      else if (value !== undefined) playbook[key] = value;
    }
    return this.save(owner, {
      ...space,
      playbook: playbook as unknown as SocialPlaybook,
      setupDone: setupDone ?? space.setupDone,
    });
  }
  async rename(owner: string, id: string, name: unknown) {
    const { name: next } = createSpaceSchema.pick({ name: true }).parse({ name });
    return this.save(owner, { ...(await this.get(owner, id)), name: next });
  }
  async addPrompt(owner: string, id: string, raw: unknown) {
    const text = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
    if (!text || text.length > 300) throw new AppError("A prompt is 1 to 300 characters", 400);
    const space = await this.get(owner, id);
    if (space.prompts.some((p) => p.text.toLowerCase() === text.toLowerCase())) return space;
    if (space.prompts.length >= MAX_PROMPTS)
      throw new AppError("Remove a prompt before saving another", 409);
    return this.save(owner, { ...space, prompts: [...space.prompts, { id: randomUUID(), text }] });
  }
  async removePrompt(owner: string, id: string, promptId: string) {
    const space = await this.get(owner, id);
    return this.save(owner, {
      ...space,
      prompts: space.prompts.filter((p) => p.id !== promptId),
    });
  }
  async markStarted(owner: string, id: string) {
    const space = await this.get(owner, id);
    return space.threadStarted ? space : this.save(owner, { ...space, threadStarted: true });
  }
  /** Turns the weekly digest on (at a day and time) or off. */
  async setDigest(owner: string, id: string, raw: unknown, routines: RoutineCalls) {
    const input = digestSchema.parse(raw ?? {});
    const space = await this.get(owner, id);
    if (!input.on) {
      if (space.digestRoutineId)
        await routines.deleteRoutine(owner, space.digestRoutineId).catch(() => undefined);
      return this.save(owner, { ...space, digestRoutineId: undefined });
    }
    const schedule = {
      title: `${space.name} digest`,
      prompt: digestPrompt(space),
      time: input.time,
      days: [input.day],
      enabled: true,
    };
    const existing =
      space.digestRoutineId &&
      (await routines.updateRoutine(owner, space.digestRoutineId, schedule).catch(() => undefined));
    const routine = existing || (await routines.createRoutine(owner, schedule));
    return this.save(owner, { ...space, digestRoutineId: routine.id });
  }
  async remove(owner: string, id: string, routines: RoutineCalls) {
    const space = await this.get(owner, id);
    if (space.digestRoutineId)
      await routines.deleteRoutine(owner, space.digestRoutineId).catch(() => undefined);
    await this.db.take(owner, "spaces", id);
    return { ok: true };
  }
}
