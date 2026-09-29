import { z } from "zod";

/**
 * A social media space's results for one week, saved by the weekly digest from the connected
 * apps' own numbers: who saw the posts on each platform, the post that did best, what competitors
 * posted, and how the plan's aims are going. Weeks start on Monday.
 */

export interface SocialWeek {
  /** `${spaceId}:${weekStart}` */
  id: string;
  spaceId: string;
  weekStart: string;
  /** The week in a few words: "Video beat photos 3 to 1". */
  headline?: string;
  /** About how many people saw the posts, per platform. */
  reach: { platform: string; people: number }[];
  /** The post that did best, in a few words. */
  best?: string;
  competitors: { name: string; what: string; opening?: string }[];
  /** The 90-day plan's aims with a target: the real number now against it. */
  aims: { aim: string; current: number; target: number; status: string }[];
  savedAt: string;
}

const text = (max: number) => z.string().trim().min(1).max(max);
export const weekResultsSchema = z.object({
  week: z
    .enum(["last", "this"])
    .optional()
    .describe(
      "Which week: 'last' (the Monday-to-Sunday week before this one, the default) or 'this'",
    ),
  headline: text(80)
    .optional()
    .describe(
      "The week's main takeaway in a few words, backed by the numbers, e.g. 'Video beat photos 3 to 1'. Don't repeat the best post; it has its own line.",
    ),
  reach: z
    .array(
      z.object({
        platform: text(40),
        people: z.number().int().min(0).max(1_000_000_000),
      }),
    )
    .max(10)
    .optional()
    .describe(
      "How many people saw the posts on each platform that week, as the app's own count of people or accounts reached (not views or impressions). Leave out a platform you couldn't read; never estimate.",
    ),
  best: text(200)
    .optional()
    .describe(
      "The post that did best and what it got, in a few words, e.g. 'the sourdough video on Instagram, seen by 640 people'",
    ),
  competitors: z
    .array(
      z.object({
        name: text(80),
        what: text(240).describe("What they posted or advertised, in one short sentence"),
        opening: text(240)
          .optional()
          .describe(
            "The chance it leaves this business, in one short sentence to the owner ('you')",
          ),
      }),
    )
    .max(8)
    .optional(),
  aims: z
    .array(
      z.object({
        aim: text(120),
        current: z
          .number()
          .min(0)
          .max(1_000_000_000)
          .describe("The aim's real number now, from the apps or what the person told you"),
        target: z.number().positive().max(1_000_000_000).describe("The number the plan aims for"),
        status: text(200).describe(
          "Where it stands in plain words, with the real number and the target, e.g. '1,380 people a week now. Aiming for 2,500 by mid-December.'",
        ),
      }),
    )
    .max(6)
    .optional()
    .describe(
      "Only the plan's aims that have a target and a real number this week. Leave out an aim with no target yet or nothing real to measure it by. Only aims where the number should go up to the target; leave out one about bringing a number down.",
    ),
});
export type WeekResultsInput = z.infer<typeof weekResultsSchema>;

/** How far along an aim is, 0 to 1, from its real number and target. */
export const aimProgress = (aim: Pick<SocialWeek["aims"][number], "current" | "target">) =>
  Math.min(1, aim.current / aim.target);

/** People who saw the posts that week, added up across platforms. */
export const weekReach = (week: Pick<SocialWeek, "reach">) =>
  week.reach.reduce((sum, r) => sum + r.people, 0);
