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
  /** False for leftovers, takeout or eating out: nothing to cook, so no recipes. */
  cook?: boolean;
  /** Two or three recipes to choose from; the chosen one's ingredients are on the grocery list. */
  recipes?: Recipe[];
  /** Which of the recipes the family is cooking; the first until they pick another. */
  chosen?: number;
  /** Real recipe pages the agent found for the dish. */
  links?: RecipeLink[];
}
export interface Recipe {
  name: string;
  /** One line: what it is and why it suits the night. */
  about?: string;
  serves?: number;
  prepMinutes?: number;
  cookMinutes?: number;
  ingredients: { item: string; qty?: string; aisle?: string; have?: boolean }[];
  steps: string[];
}
export interface RecipeLink {
  title: string;
  url: string;
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
  /** Who put it on the list: the plan, or the family by hand. A recipe never takes the family's. */
  by?: "plan" | "family";
  /**
   * Set on an item a chosen recipe needs: the nights (Monday 0) whose recipe needs it. When a
   * night's recipe changes, an unticked item nothing else needs comes off the list.
   */
  for?: number[];
  /**
   * On a plan item listed only for dinners: the nights it's for whose recipes haven't come yet.
   * Each night's recipe takes its share over. A plan item without it is for other meals too, so
   * it stays on the list whatever the recipes need.
   */
  planned?: number[];
  /**
   * How much each night's recipe needs, and the plan's own amount under "plan", added up for
   * the list: "1 dozen + 2".
   */
  amounts?: Record<string, string>;
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
/** A plan grocery's dinners, so each night's recipe can take its share over. */
const forDinners = z
  .array(z.enum(WEEKDAYS))
  .max(7)
  .optional()
  .describe(
    'The dinners this is only for, e.g. ["Tuesday"]; that night\'s recipe takes it over. Leave it out for breakfasts, lunches, snacks, staples and anything shared with them',
  );
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
        cook: z
          .boolean()
          .optional()
          .describe(
            "true when the family cooks this night, false for leftovers, takeout or eating out; always set it. Recipes are written for the nights marked true",
          ),
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
        for: forDinners,
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
        for: forDinners,
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

const ingredient = z.object({
  item: text(80).describe("Plain name as it goes on the grocery list, e.g. 'Chicken thighs'"),
  qty: z.string().trim().max(30).optional().describe("For the whole recipe, e.g. '8' or '1 lb'"),
  aisle: z
    .string()
    .trim()
    .max(40)
    .optional()
    .describe(
      "Fruit and vegetables, Meat and fish, Dairy and eggs, Bread, Pantry, Frozen, Household",
    ),
  have: z
    .boolean()
    .optional()
    .describe(
      "true for pantry staples (salt, pepper, oil, common spices) and anything the family said they have; these stay off the grocery list",
    ),
});
export const recipeSchema = z.object({
  name: text(80),
  about: text(160)
    .optional()
    .describe("One short line, under 160 characters: what it is and why it suits the night"),
  serves: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "How many it feeds: everyone in the family, more when a later night is its leftovers",
    ),
  prepMinutes: z
    .number()
    .int()
    .min(0)
    .max(600)
    .optional()
    .describe("Honest minutes for a home cook"),
  cookMinutes: z
    .number()
    .int()
    .min(0)
    .max(1440)
    .optional()
    .describe("Honest minutes for a home cook"),
  ingredients: z
    .array(ingredient)
    .min(1)
    .max(30)
    .describe("With amounts for the family, every one following the food rules"),
  steps: z.array(text(400)).min(1).max(20).describe("Short steps in order, without numbers"),
});
/** A night's recipes as they're saved: written for the family, with links found on the web. */
export const dinnerRecipesSchema = z.object({
  day,
  recipes: z
    .array(recipeSchema)
    .min(1)
    .max(3)
    .describe("Two or three recipes for the night's dish to choose from; the first is the pick"),
  links: z
    .array(
      z.object({
        title: text(120).describe("The page’s own title"),
        url: z
          .string()
          .trim()
          .max(500)
          .regex(/^https:\/\/\S+$/, "Use a full https:// link"),
      }),
    )
    .max(3)
    .optional()
    .describe("Recipe pages from web search results whose recipes follow the food rules"),
});

/**
 * A dish that isn't cooked: "Leftovers", "Leftover chili", "Thai takeout", "Dinner out". Only the
 * dish's name counts, so "Chili (leftovers Thursday)" and "Better-than-takeout chicken" are cooked.
 */
const NOT_COOKED =
  /^(?:leftovers?|left-?overs?|take-?out|take-?away|take out|delivery|order(?:ing)? in|eat(?:ing)? out|dinner out|night out|out to (?:dinner|eat)|restaurant|fend for yourselves|fend for yourself)(?![\w-])|(?:^|[\s(])(?:take-?out|take-?away|delivery|night out|dinner out)[\s).!]*$/i;
/** Whether a night is cooked at home, so it gets recipes. Plans save `cook`; older ones guess. */
export const cooked = (dinner: Pick<WeekDinner, "dish" | "cook">) =>
  dinner.cook ?? !NOT_COOKED.test(dinner.dish.trim());
export type DinnerRecipesInput = z.infer<typeof dinnerRecipesSchema>;

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
