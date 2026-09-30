import { randomUUID } from "node:crypto";
import type { Routine } from "../../../packages/domain/src/agent.ts";
import {
  createSpaceSchema,
  defaultSpaceName,
  digestSchema,
  emptyPlaybookFor,
  patchSchemaFor,
  type Space,
  type SpaceKind,
  spaceNameSchema,
  starterPromptsFor,
} from "../../../packages/domain/src/spaces.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

const MAX_SPACES = 10;
/** A social media plan's length: 13 weeks. */
const PLAN_DAYS = 91;
const MAX_PROMPTS = 30;

/** The routine calls the digest needs; the agent service provides them. */
/** Deleting a space's chat; the app's thread store provides it. */
export interface ChatCalls {
  deleteThread(owner: string, threadId: string): Promise<unknown>;
}
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
2. How you did: with the connected apps (find_app_actions, then use_app), read last week's results for each platform in the playbook and any running ads; these are the numbers you save in step 5. If a platform isn't connected, say so. Never estimate or invent a number. Put numbers in plain words, for example "300 people saw it and 12 liked it".
3. Next week: draft the playbook's number of posts, spread across its platforms in order, in its voice, each with a suggested day and time. Add ad ideas only if adIdeasPerWeek is above 0, dailyAdCeilingUsd is set, and organicUntil (if set) has passed; give each a daily budget within that limit. Check what's already queued first (list_scheduled_posts, and the playbook's scheduler app if it names one), so nothing is doubled. Queue each drafted post for its day: in the playbook's scheduler app through use_app if it names one, otherwise with schedule_post (this app's own scheduler). To start an ad, use use_app. All of these wait for the person's approval. Look up an app's actions with find_app_actions first and never guess an action's name. Nothing is posted, paid for or made with paid credits without it.
Base the drafts on the playbook's content themes and plan, and use last week's results: more of what worked, less of what didn't. When unsure between two ideas, draft both as a side-by-side test.
4. In the first digest of each month, also compare the month's results with the plan: what worked, what to stop, and any change you'd suggest to the plan or themes (the person can ask for it in the space's chat). If the plan has no targets yet and there are four weeks of results, suggest targets based on them.
5. Save last week's results with save_week_results, so the person sees them on the space's Results tab: for each platform you could read, how many people saw the posts, as the app's own count of people or accounts reached (not views or impressions); the post that did best and what it got; a headline of a few words that the numbers back up and that doesn't repeat the best post; what each competitor posted, with the chance it leaves this business; and each of the plan's aims that has a target, with its real number now, the target and where it stands. Leave out a platform you couldn't read (don't save 0 for it), an aim with no target or no real number yet, and any part you have nothing real for. Never estimate a number.
6. Finish with a short digest in everyday words under three headings: What competitors posted, How you did, Next week. End by saying how many drafts are waiting in Needs you for their OK.`;

/**
 * A family's daily rundown, and its plan for the week ahead on the planning day. Handed to the
 * routine with the playbook when it runs, like the social digest's steps.
 */
export const FAMILY_RUNDOWN_STEPS = `1. Today: work out today's date and day in the person's time zone. Read thisWeek (the week on the family's board), the playbook's weekShape and routines. If a calendar app is connected (find_app_actions, then use_app to read today's and tomorrow's events), use it; never invent an appointment.
2. Plan the week ahead first when today is the planning day (the playbook's planningDay; Sunday when unset) or when thisWeek isn't planned yet. On the planning day, first save a two-line recap of the week that's ending (what was cooked, how chores went, one highlight) with save_week_plan, week "this" and recap. Then plan the week ahead (week "next" on a Saturday or Sunday): dinners for the week (dinnersPerWeek, or 5) that fit foodRules, favorites and cookingTime, with a line on why each night's pick (a busy night gets something quick); the grocery list for them, grouped by aisle; the schedule from weekShape and the calendar, with clashes and who's driving called out; chores for the week by person; two or three activity ideas for free time that fit interests, ages and the week's forecast (get_weather). Save it to the board with save_week_plan: summary, dinners (each with a short note, one food emoji, and cook: false for leftovers, takeout or eating out, true for the rest), schedule, groceries by aisle (for an item only for dinners, list those nights in for), chores by person and ideas. When save_week_plan's result says recipes are being written, mention in one line that they'll show on the board within a few minutes.
3. Every run: a short rundown, under 150 words, in the playbook's tone (warm when none is set): the weather in a few words when it matters for the day (get_weather: rain at pickup time, a coat, a weather alert); today's schedule with times; dinner tonight and any prep to start early; chores due today; one thing to get ready for tomorrow; one encouraging line. Put the rundown first and, on a planning day, the week's plan under it.
4. Nothing is added to a calendar, bought or sent without the person's approval. No medical, legal or money advice: an allergy is planned around, never advised on.`;
/** A health space's weekly check-in: how the week went against the person's targets. */
export const HEALTH_CHECKIN_STEPS = `1. Read last week (the Monday-to-Sunday week that just ended) with get_food_log, giving any date in it, and this week so far. The playbook has the person's goals, food rules and targets.
2. Write a short check-in, under 150 words, in everyday words and an encouraging tone: how many days they logged, average calories and protein a logged day against their targets (when set), workout minutes against their weekly target, and one thing that went well. Count only what was logged; never guess what wasn't, and don't scold a day with nothing logged.
3. Suggest one small, concrete change for the week ahead that fits their goals and food rules, such as a high-protein breakfast they'd like or a 20-minute walk on their two busiest days.
4. No medical advice: if a number looks worrying or they mention a condition, suggest checking with a doctor. End by saying their week is in Spaces → Health, where the charts and the food log are.`;

export const digestSteps = (kind: SpaceKind) =>
  kind === "family"
    ? FAMILY_RUNDOWN_STEPS
    : kind === "health"
      ? HEALTH_CHECKIN_STEPS
      : DIGEST_STEPS;

/** The digest routine's task: the playbook and the steps come from get_space_playbook. */
export function digestPrompt(space: Pick<Space, "id" | "name" | "kind">) {
  if (space.kind === "health")
    return `Weekly health check-in for the space "${space.name}" (space id ${space.id}). First call get_space_playbook with this space id, then follow its weeklyCheckInSteps and its playbook: goals, food rules and targets.`;
  if (space.kind === "family")
    return `Daily family rundown for the space "${space.name}" (space id ${space.id}). First call get_space_playbook with this space id, then follow its dailyRundownSteps and its playbook: who's in the family, food rules and favorites, the week's shape, chores, routines, interests and tone.`;
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
  /**
   * Everyone has a health space: it's where their food log and workouts are. It's made once, the
   * first time their spaces are listed, and isn't made again if they remove it.
   */
  async ensureHealth(owner: string) {
    const first = await this.db.insertIfAbsent(owner, "agent-settings", {
      id: "health-space",
      at: this.now().toISOString(),
    });
    if (!first) return;
    const spaces = await this.list(owner);
    if (spaces.some((space) => space.kind === "health")) return;
    // No room yet: try again next time, rather than never.
    if (spaces.length >= MAX_SPACES) {
      await this.db.take(owner, "agent-settings", "health-space");
      return;
    }
    await this.create(owner, { kind: "health" });
  }
  async create(owner: string, raw: unknown) {
    const input = createSpaceSchema.parse(raw ?? {});
    if ((await this.db.list(owner, "spaces")).length >= MAX_SPACES)
      throw new AppError("Remove a space before adding another", 409);
    const at = this.now().toISOString();
    return this.db.put<Space>(owner, "spaces", {
      id: randomUUID(),
      kind: input.kind,
      name: input.name ?? defaultSpaceName(input.kind),
      threadId: randomUUID(),
      threadStarted: false,
      playbook: emptyPlaybookFor(input.kind),
      prompts: starterPromptsFor(input.kind).map((text) => ({ id: randomUUID(), text })),
      setupDone: false,
      createdAt: at,
      updatedAt: at,
    } as Space);
  }
  private save(owner: string, space: Space) {
    return this.db.put<Space>(owner, "spaces", {
      ...space,
      updatedAt: this.now().toISOString(),
    });
  }
  /** Changes the fields given (of this kind of space); null clears an optional one. */
  async update(owner: string, id: string, raw: unknown, setupDone?: boolean) {
    const space = await this.get(owner, id);
    const { newPlan, ...patch } = patchSchemaFor(space.kind).parse(raw ?? {}) as Record<
      string,
      unknown
    >;
    const playbook: Record<string, unknown> = { ...space.playbook };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete playbook[key];
      else if (value !== undefined) playbook[key] = value;
    }
    // A family's week plan carries its date, so the rundown knows when it has gone stale.
    if (space.kind === "family" && "weekPlan" in patch) {
      if (patch.weekPlan) playbook.weekPlanAt = this.now().toISOString();
      else delete playbook.weekPlanAt;
    }
    // A new social media plan starts its 90 days now; an edit to the plan keeps them, unless the
    // 90 days were already over (then it's a new plan, even if newPlan was left out).
    if (space.kind === "social" && "plan" in patch && patch.plan !== space.playbook.plan) {
      const started = Date.parse(space.playbook.planAt ?? "");
      const over = started + PLAN_DAYS * 86_400_000 <= this.now().getTime();
      if (!patch.plan) delete playbook.planAt;
      else if (newPlan || !space.playbook.plan || Number.isNaN(started) || over)
        playbook.planAt = this.now().toISOString();
    }
    return this.save(owner, {
      ...space,
      playbook,
      setupDone: setupDone ?? space.setupDone,
    } as unknown as Space);
  }
  async rename(owner: string, id: string, name: unknown) {
    const { name: next } = spaceNameSchema.parse({ name });
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
      title: `${space.name} ${space.kind === "family" ? "rundown" : space.kind === "health" ? "check-in" : "digest"}`,
      prompt: digestPrompt(space),
      time: input.time,
      days: input.days ?? [input.day],
      enabled: true,
    };
    const existing =
      space.digestRoutineId &&
      (await routines.updateRoutine(owner, space.digestRoutineId, schedule).catch(() => undefined));
    const routine = existing || (await routines.createRoutine(owner, schedule));
    return this.save(owner, { ...space, digestRoutineId: routine.id });
  }
  /** Removes the space and its digest; its chat too when asked, since it holds what they said. */
  async remove(
    owner: string,
    id: string,
    routines: RoutineCalls,
    chats?: ChatCalls,
    deleteChat = false,
  ) {
    const space = await this.get(owner, id);
    if (space.digestRoutineId)
      await routines.deleteRoutine(owner, space.digestRoutineId).catch(() => undefined);
    if (deleteChat && chats) await chats.deleteThread(owner, space.threadId).catch(() => undefined);
    await this.db.take(owner, "spaces", id);
    return { ok: true, chatDeleted: deleteChat && !!chats };
  }
}
