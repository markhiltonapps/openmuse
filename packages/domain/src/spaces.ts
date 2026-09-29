import { z } from "zod";

/**
 * Spaces: a place for one area of the person's life that their agent runs for them, with its own
 * chat, a playbook the agent follows, saved prompts and a weekly digest. The first kind is social
 * media; the playbook is what the agent learns while setting it up (from a brand guide, web
 * research and the person's answers) and what every later run follows.
 */
export type SpaceKind = "social";

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

export interface SavedPrompt {
  id: string;
  text: string;
}

export interface Space {
  id: string;
  kind: SpaceKind;
  name: string;
  /** The space's own chat. */
  threadId: string;
  /** The chat has messages, so opening it loads them. */
  threadStarted: boolean;
  playbook: SocialPlaybook;
  prompts: SavedPrompt[];
  /** The weekly digest routine, when it's on. */
  digestRoutineId?: string;
  setupDone: boolean;
  createdAt: string;
  updatedAt: string;
}

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

export const createSpaceSchema = z.object({
  kind: z.literal("social").default("social"),
  name: line(60).default("Social media"),
});

export const digestSchema = z.object({
  on: z.boolean(),
  /** 0 is Sunday. */
  day: z.number().int().min(0).max(6).default(1),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("08:45"),
});

/** The prompts a new social media space starts with; brackets are filled in before sending. */
export const STARTER_SOCIAL_PROMPTS = [
  "Draft this week’s posts",
  "What did [competitor] post this week?",
  "Make 3 ad ideas for [product]",
  "Which post did best this month, and why?",
  "Draft replies to new comments",
  "What’s scheduled for this week?",
  "What’s in this week’s digest?",
];

/** Composio apps that belong to social media work, for the space's "Needs you" list. */
export const SOCIAL_APPS =
  /instagram|facebook|linkedin|youtube|tiktok|twitter|threads|pinterest|metaads|meta_ads|postiz|higgsfield|buffer|hootsuite/i;

export function emptyPlaybook(): SocialPlaybook {
  return { products: [], platforms: [], voice: "", avoid: [] };
}
