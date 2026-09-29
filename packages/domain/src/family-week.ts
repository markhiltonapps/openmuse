import { z } from "zod";

/**
 * A family space's week as a board: dinners, the schedule, the grocery list, chores and ideas.
 * Each week is kept, so the family can look back at "Our weeks". Weeks start on Monday; `day` is
 * 0 for Monday through 6 for Sunday.
 */

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface WeekDinner {
  day: number;
  dish: string;
  /** Why this night, who cooks, or what to prep: "20 min", "Sam cooks". */
  note?: string;
  /** One food emoji for the plate, such as 🌮. */
  emoji?: string;
}
export interface WeekEvent {
  day: number;
  /** As the family says it: "7:40 AM". Left out for all-day things. */
  time?: string;
  title: string;
  /** Who it's for or who's driving. */
  who?: string;
}
export interface GroceryItem {
  id: string;
  item: string;
  qty?: string;
  aisle?: string;
  done: boolean;
}
export interface WeekChore {
  id: string;
  who: string;
  task: string;
  /** A star for each day it got done, Monday first. */
  stamps: boolean[];
}
export interface WeekIdea {
  title: string;
  /** Who it's for. */
  for?: string;
  when?: string;
  emoji?: string;
}
export interface FamilyWeek {
  /** `${spaceId}:${weekStart}` */
  id: string;
  spaceId: string;
  /** The Monday it starts, YYYY-MM-DD. */
  weekStart: string;
  /** One line about the week. */
  summary?: string;
  dinners: WeekDinner[];
  schedule: WeekEvent[];
  groceries: GroceryItem[];
  chores: WeekChore[];
  ideas: WeekIdea[];
  /** How the week went, written as it ends. */
  recap?: string;
  plannedAt: string;
  updatedAt: string;
}
/** A past week as "Our weeks" lists it. */
export interface WeekSummary {
  weekStart: string;
  summary?: string;
  recap?: string;
  dinners: WeekDinner[];
  chores: { stamped: number; total: number };
  groceries: number;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const day = z.enum(WEEKDAYS);
/** What the agent saves; each section given replaces that section of the week. */
export const weekPlanSchema = z.object({
  week: z
    .enum(["this", "next"])
    .optional()
    .describe(
      "Which week: this one (Monday to Sunday) or the one ahead. Default: next week on a Saturday or Sunday, this week otherwise.",
    ),
  summary: text(200).optional().describe("One line about the week, e.g. 'Swim starts Tuesday'"),
  dinners: z
    .array(
      z.object({
        day,
        dish: text(80),
        note: text(80).optional().describe("Why this night, who cooks, or prep: '20 min'"),
        emoji: z.string().trim().max(8).optional().describe("One food emoji, such as 🌮"),
      }),
    )
    .max(14)
    .optional()
    .describe("Replaces the week's dinners: give every night you plan, including leftover nights"),
  schedule: z
    .array(
      z.object({
        day,
        time: z.string().trim().max(20).optional().describe("Like 7:40 AM; leave out if all day"),
        title: text(100),
        who: text(80).optional().describe("Who it's for or who's driving"),
      }),
    )
    .max(80)
    .optional()
    .describe("Replaces the week's schedule"),
  groceries: z
    .array(
      z.object({
        item: text(80),
        qty: z.string().trim().max(30).optional(),
        aisle: z
          .string()
          .trim()
          .max(40)
          .optional()
          .describe(
            "Fruit and vegetables, Meat and fish, Dairy and eggs, Bread, Pantry, Frozen, Household",
          ),
      }),
    )
    .max(120)
    .optional()
    .describe("Replaces the grocery list; items already ticked off stay ticked"),
  addGroceries: z
    .array(
      z.object({
        item: text(80),
        qty: z.string().trim().max(30).optional(),
        aisle: z.string().trim().max(40).optional(),
      }),
    )
    .max(40)
    .optional()
    .describe("Adds to the grocery list without replacing it"),
  chores: z
    .array(z.object({ who: text(60), task: text(120) }))
    .max(30)
    .optional()
    .describe("Replaces the chores; a chore that stays keeps its stars"),
  ideas: z
    .array(
      z.object({
        title: text(100),
        for: text(60).optional(),
        when: text(60).optional(),
        emoji: z.string().trim().max(8).optional(),
      }),
    )
    .max(6)
    .optional(),
  recap: text(600).optional().describe("How the week went, as it ends: what was cooked, wins"),
});
export type WeekPlanInput = z.infer<typeof weekPlanSchema>;

export const groceryAddSchema = z.object({
  item: text(80),
  qty: z.string().trim().max(30).optional(),
  aisle: z.string().trim().max(40).optional(),
});

/** The plate for a dinner: its own emoji, or one that fits the dish's name. */
export function dishEmoji(dinner: Pick<WeekDinner, "dish" | "emoji">) {
  if (dinner.emoji) return dinner.emoji;
  const dish = dinner.dish.toLowerCase();
  const table: [RegExp, string][] = [
    [/taco|burrito|fajita|quesadilla|nacho|enchilada/, "🌮"],
    [/pizza|flatbread/, "🍕"],
    [/pasta|spaghetti|noodle|lasagn|mac|penne|ravioli|pesto/, "🍝"],
    [/chicken|turkey|wing/, "🍗"],
    [/soup|stew|chili|chowder|broth/, "🍲"],
    [/salad|bowl|poke/, "🥗"],
    [/fish|salmon|tuna|shrimp|cod|seafood/, "🐟"],
    [/curry|rice|stir|fried rice|risotto/, "🍛"],
    [/burger|slider|hot dog/, "🍔"],
    [/steak|beef|pork|roast|ribs|meatball/, "🥩"],
    [/egg|omelet|frittata|breakfast|pancake|waffle/, "🍳"],
    [/sandwich|wrap|panini|grilled cheese|sub\b/, "🥪"],
    [/sushi/, "🍣"],
    [/takeout|take-out|order in|delivery|restaurant|eat out|dinner out/, "🥡"],
    [/leftover|open|out|free|grandma|away|off/, "🍽️"],
  ];
  return table.find(([pattern]) => pattern.test(dish))?.[1] ?? "🍽️";
}
