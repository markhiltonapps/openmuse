import { z } from "zod";

/**
 * Spaces: a place for one area of the person's life that their agent runs for them, with its own
 * chat, a playbook the agent follows, saved prompts and a digest that runs on a schedule. The
 * kinds are social media and the family week; a playbook is what the agent learns while setting
 * the space up (from a brand guide, web research and the person's answers) and what every later
 * run follows. The health space is there for everyone: what they've eaten, their workouts and the
 * week's food plan, against the targets in its playbook.
 */
export type SpaceKind = "social" | "family" | "health";

export interface SocialProduct {
  name: string;
  /** One line on what it is and who it's for. */
  about: string;
  competitors: string[];
}

export interface SocialPlaybook {
  products: SocialProduct[];
  /** The platforms to cover, most important first. */
  platforms: string[];
  /**
   * The connected app that queues posts for later (Postiz, Buffer…); without one, a post goes out
   * when the person approves it.
   */
  scheduler?: string;
  /** Who buys: their job or situation, the problems they want solved, where they are online. */
  audience?: string;
  /** What social media should do for the business, e.g. "More customers", "Getting known". */
  goals?: string[];
  /** Where the accounts stood when the space was set up. */
  baseline?: string;
  /** The content themes posts are built on. */
  pillars?: string[];
  /** The agent's plan: 90-day aims, themes, what to post where, first ad test, people to team up with. */
  plan?: string;
  /** When the plan was written, the start of its 90 days; set by the server. */
  planAt?: string;
  /** How the brand sounds. */
  voice: string;
  /** Things never to say or do (claims, names, words, images). */
  avoid: string[];
  /** The brand guide the agent read, in Files. */
  brandFileId?: string;
  brandFileName?: string;
  /** Posts proposed each week, across all platforms. */
  postsPerWeek?: number;
  /** Ad ideas proposed each week once ads start. */
  adIdeasPerWeek?: number;
  /** Why this rhythm, and how the posts split across platforms. */
  rhythmNote?: string;
  /** No ads before this day (YYYY-MM-DD): organic posts only. */
  organicUntil?: string;
  /** The most ads may spend in a day, in US dollars. */
  dailyAdCeilingUsd?: number;
  budgetNote?: string;
}

export interface FamilyMember {
  name: string;
  /** Left out for grown-ups. */
  age?: number;
  /** A few words: what they love, what they can do. */
  notes?: string;
}

export type FamilyTone = "direct" | "warm" | "knowledgeable" | "playful" | "calm";
export const FAMILY_TONES: { id: FamilyTone; label: string; about: string }[] = [
  { id: "direct", label: "Direct", about: "Straight to the point" },
  { id: "warm", label: "Warm", about: "Kind and encouraging" },
  { id: "knowledgeable", label: "Knowledgeable", about: "Confident, and says why" },
  { id: "playful", label: "Playful", about: "Light, with a little humor" },
  { id: "calm", label: "Calm", about: "Steady and reassuring" },
];

/** What the family planner learns during setup and follows every week. */
export interface FamilyPlaybook {
  /** Everyone in the house, grown-ups and children. */
  family: FamilyMember[];
  /** Allergies, diets and firm dislikes: never a suggestion. */
  foodRules: string[];
  /** Meals the family likes, to build weeks around. */
  favorites: string[];
  /** Dinners to plan each week. */
  dinnersPerWeek?: number;
  /** How long there is to cook on a weeknight, e.g. "30 minutes". */
  cookingTime?: string;
  /** The week's fixed points: school and work hours, activities, pickups, who's where when. */
  weekShape?: string;
  /** Who does what around the house, e.g. "Maya (8): feeds the dog, sets the table". */
  chores: string[];
  /** How mornings and evenings should go, and where they fall apart. */
  routines?: string;
  /** What each person enjoys, for activity ideas. */
  interests: string[];
  tone?: FamilyTone;
  /** The day the week ahead is planned; 0 is Sunday. */
  planningDay?: number;
  /** This week's plan as the agent last wrote it: meals, the schedule, chores and ideas. */
  weekPlan?: string;
  /** When the plan was last written; set by the server. */
  weekPlanAt?: string;
  /** Anything else to keep in mind. */
  notes?: string;
}

/** What the health space follows: the person's goals, food rules and daily targets. */
export interface HealthPlaybook {
  /** In the person's words: "More protein", "Lose 10 pounds by March". */
  goals: string[];
  /** Diets, allergies and foods they avoid: never suggested. */
  foodRules: string[];
  /** Calories a day to aim for. */
  calorieTarget?: number;
  /** Grams of protein a day to aim for. */
  proteinTarget?: number;
  /** Minutes of exercise a week to aim for. */
  workoutMinutes?: number;
  /** Anything else to keep in mind. */
  notes?: string;
}

export interface SavedPrompt {
  id: string;
  text: string;
}

interface SpaceBase {
  id: string;
  name: string;
  /** The space's own chat. */
  threadId: string;
  /** The chat has messages, so opening it loads them. */
  threadStarted: boolean;
  prompts: SavedPrompt[];
  /** The digest routine (a weekly digest, or a family's daily rundown), when it's on. */
  digestRoutineId?: string;
  setupDone: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface SocialSpace extends SpaceBase {
  kind: "social";
  playbook: SocialPlaybook;
}
export interface FamilySpace extends SpaceBase {
  kind: "family";
  playbook: FamilyPlaybook;
}
export interface HealthSpace extends SpaceBase {
  kind: "health";
  playbook: HealthPlaybook;
}
export type Space = SocialSpace | FamilySpace | HealthSpace;

/**
 * A post queued by the app's own scheduler: a connected app's action with its exact arguments,
 * approved ahead of time and published at `postAt`.
 */
export interface ScheduledPost {
  id: string;
  spaceId: string;
  /** The connected app, e.g. instagram. */
  app: string;
  /** The app's action, e.g. INSTAGRAM_CREATE_POST. */
  tool: string;
  arguments: Record<string, unknown>;
  /** What the person sees: the platform, the kind of post and its text. */
  summary: string;
  postAt: string;
  status: "awaiting_review" | "scheduled" | "posting" | "posted" | "failed" | "cancelled";
  /** Fixes what was approved: the action, its arguments and the time. */
  hash: string;
  createdAt: string;
  decidedAt?: string;
  postedAt?: string;
  result?: string;
  error?: string;
}

const line = (max: number) => z.string().trim().min(1).max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-06");

export const socialProductSchema = z.object({
  name: line(120),
  about: z.string().trim().max(400).default(""),
  competitors: z.array(line(120)).max(8).default([]),
});

/**
 * A change to the playbook: only the fields given change, lists replace the old list, and null
 * clears an optional value.
 */
export const playbookPatchSchema = z
  .object({
    products: z.array(socialProductSchema).max(12),
    platforms: z.array(line(40)).max(8),
    scheduler: z.string().trim().min(1).max(40).nullable(),
    audience: z.string().trim().max(1500).nullable(),
    goals: z.array(line(80)).max(6),
    baseline: z.string().trim().max(1500).nullable(),
    pillars: z.array(line(160)).max(8),
    plan: z.string().trim().max(8000).nullable(),
    /** With plan: a new 90-day plan, whose 90 days start now; left out for an edit to the plan. */
    newPlan: z
      .boolean()
      .describe(
        "With plan: true only for a new 90-day plan, so its 90 days start today. Leave it out when changing the current plan.",
      ),
    voice: z.string().trim().max(1500),
    avoid: z.array(line(300)).max(25),
    brandFileId: z.string().max(100).nullable(),
    brandFileName: z.string().trim().max(200).nullable(),
    postsPerWeek: z.number().int().min(0).max(21).nullable(),
    adIdeasPerWeek: z.number().int().min(0).max(14).nullable(),
    rhythmNote: z.string().trim().max(800).nullable(),
    organicUntil: day.nullable(),
    dailyAdCeilingUsd: z.number().min(0).max(10_000).nullable(),
    budgetNote: z.string().trim().max(800).nullable(),
  })
  .partial();
export type PlaybookPatch = z.infer<typeof playbookPatchSchema>;

const familyMemberSchema = z.object({
  name: line(60),
  age: z.number().int().min(0).max(120).optional(),
  notes: z.string().trim().max(200).optional(),
});
export const familyPlaybookPatchSchema = z
  .object({
    family: z.array(familyMemberSchema).max(12),
    foodRules: z.array(line(120)).max(20),
    favorites: z.array(line(120)).max(30),
    dinnersPerWeek: z.number().int().min(0).max(7).nullable(),
    cookingTime: z.string().trim().max(60).nullable(),
    weekShape: z.string().trim().max(2000).nullable(),
    chores: z.array(line(160)).max(30),
    routines: z.string().trim().max(2000).nullable(),
    interests: z.array(line(120)).max(30),
    tone: z.enum(["direct", "warm", "knowledgeable", "playful", "calm"]).nullable(),
    planningDay: z.number().int().min(0).max(6).nullable(),
    weekPlan: z.string().trim().max(8000).nullable(),
    notes: z.string().trim().max(1500).nullable(),
  })
  .partial();
export type FamilyPlaybookPatch = z.infer<typeof familyPlaybookPatchSchema>;

export const healthPlaybookPatchSchema = z
  .object({
    goals: z.array(line(160)).max(12),
    foodRules: z.array(line(120)).max(20),
    calorieTarget: z.number().int().min(800).max(6000).nullable(),
    proteinTarget: z.number().int().min(10).max(400).nullable(),
    workoutMinutes: z.number().int().min(0).max(3000).nullable(),
    notes: z.string().trim().max(1500).nullable(),
  })
  .partial();
export type HealthPlaybookPatch = z.infer<typeof healthPlaybookPatchSchema>;

/** The patch schema for a space's kind; unknown fields are dropped. */
export const patchSchemaFor = (kind: SpaceKind) =>
  kind === "family"
    ? familyPlaybookPatchSchema
    : kind === "health"
      ? healthPlaybookPatchSchema
      : playbookPatchSchema;

export const spaceNameSchema = z.object({ name: line(60) });
export const createSpaceSchema = z.object({
  kind: z.enum(["social", "family", "health"]).default("social"),
  name: line(60).optional(),
});
export const defaultSpaceName = (kind: SpaceKind) =>
  kind === "family" ? "Family" : kind === "health" ? "Health" : "Social media";

export const digestSchema = z.object({
  on: z.boolean(),
  /** 0 is Sunday. */
  day: z.number().int().min(0).max(6).default(1),
  /** Several days, such as every morning for a family's rundown; `day` alone otherwise. */
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("08:45"),
});

/** The prompts a new social media space starts with; brackets are filled in before sending. */
export const STARTER_SOCIAL_PROMPTS = [
  "Draft this week’s posts",
  "What did [competitor] post this week?",
  "Find post ideas our competitors are missing",
  "Make 3 ad ideas for [product]",
  "Which post did best this month, and why?",
  "Draft replies to new comments",
  "What’s scheduled for this week?",
  "What’s in this week’s digest?",
];

/** The prompts a new family space starts with. */
export const STARTER_FAMILY_PROMPTS = [
  "Plan this week’s dinners",
  "Make the grocery list",
  "What’s on today?",
  "Ideas for a rainy afternoon with [child]",
  "Set up a chore chart",
  "Help our mornings go smoother",
  "Move [activity] to another day",
  "What’s in this week’s plan?",
];
/** The prompts a health space starts with. */
export const STARTER_HEALTH_PROMPTS = [
  "What have I eaten this week?",
  "How am I doing against my targets?",
  "Log what I just ate",
  "A 20-minute workout with no equipment",
  "Ideas for a high-protein lunch",
  "Set my daily targets",
];
export const starterPromptsFor = (kind: SpaceKind) =>
  kind === "family"
    ? STARTER_FAMILY_PROMPTS
    : kind === "health"
      ? STARTER_HEALTH_PROMPTS
      : STARTER_SOCIAL_PROMPTS;

/** Composio apps that belong to social media work, for the space's "Needs you" list. */
export const SOCIAL_APPS =
  /instagram|facebook|linkedin|youtube|tiktok|twitter|threads|pinterest|metaads|meta_ads|postiz|higgsfield|buffer|hootsuite/i;
/** Apps a family planner reaches for: calendars and to-do lists. */
export const FAMILY_APPS = /calendar|todoist|tasks|reminders|notion|trello|anylist/i;
/** Fitness and food apps a health space reads from. */
export const HEALTH_APPS =
  /fitbit|strava|garmin|oura|whoop|myfitnesspal|withings|googlefit|google_fit/i;

export function emptyPlaybook(): SocialPlaybook {
  return { products: [], platforms: [], voice: "", avoid: [] };
}
export function emptyFamilyPlaybook(): FamilyPlaybook {
  return { family: [], foodRules: [], favorites: [], chores: [], interests: [] };
}
export function emptyHealthPlaybook(): HealthPlaybook {
  return { goals: [], foodRules: [] };
}
export const emptyPlaybookFor = (kind: SpaceKind) =>
  kind === "family"
    ? emptyFamilyPlaybook()
    : kind === "health"
      ? emptyHealthPlaybook()
      : emptyPlaybook();
