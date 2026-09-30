import { randomUUID } from "node:crypto";
import {
  choreStars,
  cooked,
  dinnerRecipesSchema,
  type FamilyWeek,
  type GroceryItem,
  groceryAddSchema,
  type Recipe,
  WEEKDAYS,
  type WeekChore,
  type WeekDinner,
  type WeekPlanInput,
  type WeekSummary,
  weekPlanSchema,
} from "../../../packages/domain/src/family-week.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/**
 * A family space's weeks: the one on the board, and the ones before it for "Our weeks". The agent
 * plans a week with save_week_plan; the family ticks off groceries and stamps chores on the board.
 */

const KIND = "family-weeks";
const day = (name: string) => Math.max(0, WEEKDAYS.indexOf(name as (typeof WEEKDAYS)[number]));
const key = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
/** A dish's name to compare: "Pork chops & mac and cheese" matches "pork chops and mac & cheese". */
export const dishKey = (text: string) =>
  key(text)
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
/** Whether two grocery names are the same thing: "Lime" and "limes", "Tomato" and "tomatoes". */
function same(a: string, b: string) {
  const [x, y] = [key(a), key(b)];
  return x === y || `${x}s` === y || `${y}s` === x || `${x}es` === y || `${y}es` === x;
}

/** Today in a time zone: its date and weekday, Monday 0 to Sunday 6. */
export function localToday(timeZone: string, now = new Date()) {
  const date = now.toLocaleDateString("en-CA", { timeZone });
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return { date, day: (weekday + 6) % 7 };
}
/** The Monday that starts the week holding `date` (YYYY-MM-DD), moved by whole weeks. */
export function mondayOf(date: string, weeks = 0) {
  const noon = new Date(`${date}T12:00:00Z`);
  const back = (noon.getUTCDay() + 6) % 7;
  noon.setUTCDate(noon.getUTCDate() - back + weeks * 7);
  return noon.toISOString().slice(0, 10);
}

export class FamilyWeeks {
  constructor(
    private readonly db: Store,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private id(spaceId: string, weekStart: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new AppError("Unknown week", 404);
    return `${spaceId}:${weekStart}`;
  }
  async get(owner: string, spaceId: string, weekStart: string) {
    return this.db.get<FamilyWeek>(owner, KIND, this.id(spaceId, weekStart));
  }
  private async must(owner: string, spaceId: string, weekStart: string) {
    const week = await this.get(owner, spaceId, weekStart);
    if (!week) throw new AppError("That week hasn't been planned", 404);
    return week;
  }
  private async put(owner: string, week: FamilyWeek) {
    const saved = { ...week, updatedAt: this.now().toISOString() };
    await this.db.put(owner, KIND, saved);
    return saved;
  }
  /** Every week of one space, newest first. */
  async all(owner: string, spaceId: string) {
    return (await this.db.list<FamilyWeek>(owner, KIND))
      .filter((week) => week.spaceId === spaceId)
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }
  /**
   * What the board shows: this week, or next week's plan once it exists on a Saturday or Sunday.
   * `current` is this week either way, for today's timeline; `today` is today, Monday 0. Weeks
   * before the one shown are "Our weeks", so on a weekend this week is there to look back on.
   */
  async board(owner: string, spaceId: string, timeZone: string) {
    const today = localToday(timeZone, this.now());
    const thisWeek = mondayOf(today.date);
    const nextWeek = mondayOf(today.date, 1);
    const [current, next, weeks] = await Promise.all([
      this.get(owner, spaceId, thisWeek),
      this.get(owner, spaceId, nextWeek),
      this.all(owner, spaceId),
    ]);
    const week = today.day >= 5 && next ? next : current;
    const shown = week?.weekStart ?? thisWeek;
    return {
      week,
      current,
      today: today.day,
      thisWeek,
      nextWeek,
      nextPlanned: Boolean(next),
      past: weeks.filter((w) => w.weekStart < shown).map(summarize),
    };
  }
  /** The agent's plan for a week; each section given replaces that section. */
  /** The week a plan or recipe is for: this one, or the one ahead (by default on a weekend). */
  which(week: "this" | "next" | undefined, timeZone: string) {
    const today = localToday(timeZone, this.now());
    const which = week ?? (today.day >= 5 ? "next" : "this");
    return { which, weekStart: mondayOf(today.date, which === "next" ? 1 : 0) };
  }
  async save(owner: string, spaceId: string, raw: unknown, timeZone: string) {
    const input: WeekPlanInput = weekPlanSchema.parse(raw);
    const { which, weekStart } = this.which(input.week, timeZone);
    const now = this.now().toISOString();
    const old = await this.get(owner, spaceId, weekStart);
    const week: FamilyWeek = old ?? {
      id: this.id(spaceId, weekStart),
      spaceId,
      weekStart,
      dinners: [],
      schedule: [],
      groceries: [],
      chores: [],
      ideas: [],
      plannedAt: now,
      updatedAt: now,
    };
    if (input.summary !== undefined) week.summary = input.summary;
    if (input.recap !== undefined) week.recap = input.recap;
    // Nights whose recipes went with a changed dish, for the agent to tell the family.
    const recipesDropped: string[] = [];
    if (input.dinners) {
      // A night that keeps its dish keeps its recipes; a changed dish's groceries come off.
      const before = week.dinners;
      week.dinners = input.dinners
        .map((d): WeekDinner => {
          const night = day(d.day);
          const old = before.find((b) => b.day === night);
          // Whether it's cooked is saved, so a note like "leftovers Thursday" can't change it.
          const cook = d.cook ?? cooked({ dish: d.dish });
          if (old && dishKey(old.dish) === dishKey(d.dish)) {
            const { recipes, chosen, links } = old;
            return { ...d, cook, day: night, ...(recipes ? { recipes, chosen, links } : {}) };
          }
          return { ...d, cook, day: night };
        })
        .sort((a, b) => a.day - b.day);
      for (const old of before) {
        const now = week.dinners.find((d) => d.day === old.day);
        if (now && dishKey(now.dish) === dishKey(old.dish)) continue;
        if (old.recipes) recipesDropped.push(WEEKDAYS[old.day] ?? "");
        week.groceries = release(detach(week.groceries, old.day), old.day);
      }
    }
    // Nights whose recipes are in: their share of the list is the recipe's.
    const sized = new Set(week.dinners.filter((d) => d.recipes?.length).map((d) => d.day));
    if (input.schedule) week.schedule = input.schedule.map((e) => ({ ...e, day: day(e.day) }));
    if (input.groceries) {
      // Ticked-off items stay ticked when the list is rewritten; what the chosen recipes need
      // and what the family added by hand stay on it.
      const old = week.groceries;
      const listed = input.groceries.flatMap(({ for: dinners, ...g }): GroceryItem[] => {
        const was = old.find((o) => same(o.item, g.item));
        const item = { id: randomUUID().slice(0, 8), ...g, done: was?.done ?? false };
        if (was?.by === "family") return [{ ...item, by: "family" }];
        const { plan: _, ...needs } = was?.amounts ?? {};
        const planned = dinners?.map(day).filter((n) => !sized.has(n));
        const planItem = size({
          ...item,
          by: "plan",
          ...(was?.for?.length ? { for: was.for } : {}),
          amounts: { ...needs, ...(g.qty ? { plan: g.qty } : {}) },
          ...(planned ? { planned } : {}),
        });
        // Listed only for dinners whose recipes don't need it: those recipes have the say.
        return held(planItem) ? [planItem] : [];
      });
      const kept = old
        .filter(
          (o) => (o.for?.length || o.by === "family") && !listed.some((g) => same(g.item, o.item)),
        )
        // What's left of an item the plan no longer lists is what the recipes need.
        .map((o) => (o.by === "family" ? o : recipeOnly(o)));
      week.groceries = [...listed, ...kept];
    }
    if (input.addGroceries)
      week.groceries = merge(
        week.groceries,
        input.addGroceries.map(({ for: dinners, ...g }) => {
          // An item added for a night whose recipe is in is an extra for that night, so it stays.
          const planned = dinners?.map(day).filter((n) => !sized.has(n));
          return planned?.length ? { ...g, planned } : g;
        }),
        "plan",
      );
    if (input.chores) {
      const stars = new Map(week.chores.map((c) => [key(`${c.who}|${c.task}`), c.stamps]));
      week.chores = input.chores.map((c) => ({
        id: randomUUID().slice(0, 8),
        ...c,
        stamps: stars.get(key(`${c.who}|${c.task}`)) ?? Array(7).fill(false),
      }));
    }
    if (input.ideas) week.ideas = input.ideas;
    if (!old) week.plannedAt = now;
    const saved = await this.put(owner, week);
    return {
      week: which,
      weekStart,
      saved: summarize(saved),
      ...(recipesDropped.length ? { recipesDropped } : {}),
    };
  }
  /** A night's recipes; the first goes on the grocery list until the family picks another. */
  async saveRecipes(
    owner: string,
    spaceId: string,
    weekStart: string,
    raw: unknown,
    /** The dish they were written for: not saved if the night's dish changed meanwhile. */
    forDish?: string,
  ) {
    const input = dinnerRecipesSchema.parse(raw);
    const week = await this.get(owner, spaceId, weekStart);
    const night = day(input.day);
    const dinner = week?.dinners.find((d) => d.day === night);
    if (!week || !dinner)
      throw new AppError(`There's no dinner on ${input.day} in the week of ${weekStart}.`, 404);
    if (forDish !== undefined && dishKey(forDish) !== dishKey(dinner.dish))
      throw new AppError(
        `${input.day}'s dinner changed while its recipes were being written.`,
        409,
      );
    const first = input.recipes[0] as Recipe;
    week.groceries = attach(detach(week.groceries, night, first), night, first);
    week.dinners = week.dinners.map((d) =>
      d.day === night
        ? {
            ...d,
            recipes: input.recipes,
            chosen: 0,
            ...(input.links ? { links: input.links } : {}),
          }
        : d,
    );
    await this.put(owner, week);
    return {
      weekStart,
      day: input.day,
      saved: input.recipes.map((r) => r.name),
      onGroceryList: input.recipes[0]?.ingredients.length ?? 0,
    };
  }
  /** The family picks a night's recipe: its ingredients replace the last pick's on the list. */
  async chooseRecipe(
    owner: string,
    spaceId: string,
    weekStart: string,
    night: number,
    raw: { recipe?: unknown },
  ) {
    const week = await this.must(owner, spaceId, weekStart);
    const dinner = this.dinner(week, night);
    const index = Number(raw.recipe);
    const recipe = Number.isInteger(index) ? dinner.recipes?.[index] : undefined;
    if (!recipe) throw new AppError("Recipe not found", 404);
    if (dinner.chosen !== index)
      week.groceries = attach(detach(week.groceries, night, recipe), night, recipe);
    week.dinners = week.dinners.map((d) => (d.day === night ? { ...d, chosen: index } : d));
    return this.put(owner, week);
  }
  /** Puts back any of the chosen recipe's ingredients that aren't on the list. */
  async addRecipeGroceries(owner: string, spaceId: string, weekStart: string, night: number) {
    const week = await this.must(owner, spaceId, weekStart);
    const dinner = this.dinner(week, night);
    const recipe = dinner.recipes?.[dinner.chosen ?? 0];
    if (!recipe) throw new AppError("That night has no recipe yet", 404);
    week.groceries = attach(week.groceries, night, recipe);
    return this.put(owner, week);
  }
  private dinner(week: FamilyWeek, night: number) {
    const dinner = Number.isInteger(night) ? week.dinners.find((d) => d.day === night) : undefined;
    if (!dinner) throw new AppError("No dinner that night", 404);
    return dinner;
  }
  async addGrocery(owner: string, spaceId: string, weekStart: string, raw: unknown) {
    const week = await this.must(owner, spaceId, weekStart);
    const added = groceryAddSchema.parse(raw);
    // Typing an item that's already there makes it the family's: no recipe or swap changes it.
    week.groceries = merge(
      week.groceries.map((g): GroceryItem => {
        if (!same(g.item, added.item) || g.by === "family") return g;
        const { for: _for, amounts: _amounts, planned: _planned, ...rest } = g;
        return { ...rest, by: "family", ...(added.qty ? { qty: added.qty } : {}) };
      }),
      [added],
      "family",
    );
    return this.put(owner, week);
  }
  async setGrocery(
    owner: string,
    spaceId: string,
    weekStart: string,
    itemId: string,
    change: { done?: unknown; remove?: unknown },
  ) {
    const week = await this.must(owner, spaceId, weekStart);
    if (!week.groceries.some((g) => g.id === itemId)) throw new AppError("Item not found", 404);
    week.groceries =
      change.remove === true
        ? week.groceries.filter((g) => g.id !== itemId)
        : week.groceries.map((g) => (g.id === itemId ? { ...g, done: change.done === true } : g));
    return this.put(owner, week);
  }
  async stamp(
    owner: string,
    spaceId: string,
    weekStart: string,
    choreId: string,
    change: { day?: unknown; done?: unknown },
  ) {
    const week = await this.must(owner, spaceId, weekStart);
    const which = Number(change.day);
    if (!Number.isInteger(which) || which < 0 || which > 6) throw new AppError("Unknown day", 422);
    if (!week.chores.some((c) => c.id === choreId)) throw new AppError("Chore not found", 404);
    week.chores = week.chores.map(
      (c): WeekChore =>
        c.id === choreId
          ? { ...c, stamps: c.stamps.map((s, i) => (i === which ? change.done === true : s)) }
          : c,
    );
    return this.put(owner, week);
  }
  /** A past week's grocery list on the board's week, nothing ticked off. */
  async reuseGroceries(owner: string, spaceId: string, fromWeek: string, toWeek: string) {
    const from = await this.must(owner, spaceId, fromWeek);
    const now = this.now().toISOString();
    const week = (await this.get(owner, spaceId, toWeek)) ?? {
      id: this.id(spaceId, toWeek),
      spaceId,
      weekStart: toWeek,
      dinners: [],
      schedule: [],
      groceries: [],
      chores: [],
      ideas: [],
      plannedAt: now,
      updatedAt: now,
    };
    week.groceries = merge(
      week.groceries,
      from.groceries.map(({ item, qty, aisle }) => ({ item, qty, aisle })),
      "plan",
    );
    return this.put(owner, week);
  }
  async removeSpace(owner: string, spaceId: string) {
    await this.db.removePrefix(owner, KIND, `${spaceId}:`);
  }
}

/**
 * Whether a plan item has a share of its own: an item for other meals (not listed for dinners
 * only), or one listed for dinners whose recipes haven't come yet.
 */
const planShare = (g: GroceryItem) =>
  g.by === "plan" && (g.planned === undefined || g.planned.length > 0);
/** Whether anything still needs an item: a recipe, the plan, or the family already bought it. */
const held = (g: GroceryItem) => Boolean(g.for?.length) || planShare(g) || g.done;
/** An item's amount on the list: the plan's share and each night's recipe added up. */
function size(g: GroceryItem): GroceryItem {
  const parts = [
    planShare(g) ? g.amounts?.plan : undefined,
    ...(g.for ?? []).map((n) => g.amounts?.[n]),
  ].filter((a): a is string => Boolean(a));
  const { qty: _, ...rest } = g;
  if (parts.length) return { ...rest, qty: parts.join(" + ") };
  // A ticked item nothing needs any more keeps the amount that was bought.
  return g.done ? g : rest;
}
/** An item without the plan's share, when the plan no longer lists it. */
function recipeOnly(g: GroceryItem): GroceryItem {
  const { by: _by, planned: _planned, amounts = {}, ...rest } = g;
  const { plan: _plan, ...needs } = amounts;
  return size({ ...rest, amounts: needs });
}
/**
 * A recipe's ingredients on the list for a night. Pantry staples stay off it, and the family's
 * own items stay as they are. A plan item listed for other meals keeps its amount and the recipe's
 * is added on top; one listed only for this night's dinner is the recipe's from now on, and one
 * the recipe doesn't need comes off (unless it's ticked).
 */
function attach(list: GroceryItem[], night: number, recipe: Recipe) {
  const next = [...list];
  for (const ingredient of recipe.ingredients) {
    if (ingredient.have) continue;
    const at = next.findIndex((g) => same(g.item, ingredient.item));
    const found = next[at];
    if (!found) {
      next.push({
        id: randomUUID().slice(0, 8),
        item: ingredient.item,
        ...(ingredient.qty ? { qty: ingredient.qty } : {}),
        ...(ingredient.aisle ? { aisle: ingredient.aisle } : {}),
        done: false,
        for: [night],
        ...(ingredient.qty ? { amounts: { [night]: ingredient.qty } } : {}),
      });
      continue;
    }
    // The family's items, and ones listed before recipes, are left as they are.
    if (found.by === "family" || (!found.by && !found.for)) continue;
    if (found.for?.includes(night)) continue;
    const amounts: Record<string, string> = { ...found.amounts };
    if (found.by === "plan" && amounts.plan === undefined && !found.for?.length && found.qty)
      amounts.plan = found.qty;
    // Without an amount of its own, a recipe goes by the plan's for this one night.
    const only = found.planned?.length === 1 && found.planned[0] === night;
    const amount = ingredient.qty ?? (only ? amounts.plan : undefined);
    if (amount) amounts[night] = amount;
    next[at] = size({
      ...found,
      for: [...(found.for ?? []), night],
      amounts,
      ...(found.planned ? { planned: found.planned.filter((n) => n !== night) } : {}),
    });
  }
  return release(next, night).slice(0, 150);
}
/**
 * A night's recipe leaves the list: its share of each item comes off, and an item nothing else
 * needs goes, unless it's ticked or the night's next recipe (`next`) needs it too.
 */
function detach(list: GroceryItem[], night: number, next?: Recipe) {
  return list.flatMap((g): GroceryItem[] => {
    if (!g.for?.includes(night)) return [g];
    const { [night]: _gone, ...amounts } = g.amounts ?? {};
    const item = size({ ...g, for: g.for.filter((n) => n !== night), amounts });
    const shared = next?.ingredients.some((i) => !i.have && same(i.item, g.item));
    return held(item) || shared ? [item] : [];
  });
}
/**
 * The plan's items listed for a night's dinner, once its recipe is in or its dish changes: that
 * night's share goes, and an item nothing else needs comes off unless it's ticked.
 */
function release(list: GroceryItem[], night: number) {
  return list.flatMap((g): GroceryItem[] => {
    if (!g.planned?.includes(night)) return [g];
    const item = size({ ...g, planned: g.planned.filter((n) => n !== night) });
    return held(item) ? [item] : [];
  });
}

/** Items added to a list; one already on it (by name) isn't added twice. */
function merge(
  list: GroceryItem[],
  add: { item: string; qty?: string; aisle?: string; planned?: number[] }[],
  by: GroceryItem["by"],
) {
  const have = new Set(list.map((g) => key(g.item)));
  const added = add
    .filter((g) => !list.some((l) => same(l.item, g.item)) && !have.has(key(g.item)))
    .map(
      (g): GroceryItem => ({
        id: randomUUID().slice(0, 8),
        item: g.item,
        ...(g.qty ? { qty: g.qty } : {}),
        ...(g.aisle ? { aisle: g.aisle } : {}),
        done: false,
        by,
        ...(by === "plan" && g.qty ? { amounts: { plan: g.qty } } : {}),
        ...(g.planned ? { planned: g.planned } : {}),
      }),
    );
  return [...list, ...added].slice(0, 150);
}

/** The week for the agent to read: each dinner's recipes by name, not every step. */
export function weekForAgent(week: FamilyWeek) {
  return {
    ...week,
    // The list as the agent writes it: the dinners an item is for by name.
    groceries: week.groceries.map(({ for: needs, planned, amounts: _, by, ...g }) => {
      const nights = [...new Set([...(needs ?? []), ...(planned ?? [])])].sort((a, b) => a - b);
      return {
        ...g,
        ...(by === "family" ? { addedBy: "family" } : {}),
        ...(nights.length ? { for: nights.map((n) => WEEKDAYS[n]) } : {}),
      };
    }),
    dinners: week.dinners.map(({ recipes, chosen, links, ...dinner }) => ({
      ...dinner,
      ...(recipes
        ? { recipes: recipes.map((r) => r.name), cooking: recipes[chosen ?? 0]?.name }
        : {}),
    })),
  };
}

export function summarize(week: FamilyWeek): WeekSummary {
  return {
    weekStart: week.weekStart,
    ...(week.summary ? { summary: week.summary } : {}),
    ...(week.recap ? { recap: week.recap } : {}),
    // Just the plates: recipes stay with the week itself.
    dinners: week.dinners.map(({ day, dish, note, emoji }) => ({
      day,
      dish,
      ...(note ? { note } : {}),
      ...(emoji ? { emoji } : {}),
    })),
    chores: {
      stamped: week.chores.reduce((n, c) => n + c.stamps.filter(Boolean).length, 0),
      total: week.chores.length * 7,
      people: choreStars(week.chores),
    },
    groceries: week.groceries.length,
  };
}
