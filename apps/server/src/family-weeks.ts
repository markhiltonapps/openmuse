import { randomUUID } from "node:crypto";
import {
  type FamilyWeek,
  type GroceryItem,
  groceryAddSchema,
  WEEKDAYS,
  type WeekChore,
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
  async save(owner: string, spaceId: string, raw: unknown, timeZone: string) {
    const input: WeekPlanInput = weekPlanSchema.parse(raw);
    const today = localToday(timeZone, this.now());
    const which = input.week ?? (today.day >= 5 ? "next" : "this");
    const weekStart = mondayOf(today.date, which === "next" ? 1 : 0);
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
    if (input.dinners)
      week.dinners = input.dinners
        .map((d) => ({ ...d, day: day(d.day) }))
        .sort((a, b) => a.day - b.day);
    if (input.schedule) week.schedule = input.schedule.map((e) => ({ ...e, day: day(e.day) }));
    if (input.groceries) {
      // Ticked-off items stay ticked when the list is rewritten.
      const done = new Set(week.groceries.filter((g) => g.done).map((g) => key(g.item)));
      week.groceries = input.groceries.map((g) => ({
        id: randomUUID().slice(0, 8),
        ...g,
        done: done.has(key(g.item)),
      }));
    }
    if (input.addGroceries) week.groceries = merge(week.groceries, input.addGroceries);
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
    return { week: which, weekStart, saved: summarize(saved) };
  }
  async addGrocery(owner: string, spaceId: string, weekStart: string, raw: unknown) {
    const week = await this.must(owner, spaceId, weekStart);
    week.groceries = merge(week.groceries, [groceryAddSchema.parse(raw)]);
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
    week.groceries = merge(week.groceries, from.groceries);
    return this.put(owner, week);
  }
  async removeSpace(owner: string, spaceId: string) {
    await this.db.removePrefix(owner, KIND, `${spaceId}:`);
  }
}

/** Items added to a list; one already on it (by name) isn't added twice. */
function merge(list: GroceryItem[], add: { item: string; qty?: string; aisle?: string }[]) {
  const have = new Set(list.map((g) => key(g.item)));
  const added = add
    .filter((g) => !have.has(key(g.item)))
    .map((g) => ({
      id: randomUUID().slice(0, 8),
      item: g.item,
      ...(g.qty ? { qty: g.qty } : {}),
      ...(g.aisle ? { aisle: g.aisle } : {}),
      done: false,
    }));
  return [...list, ...added].slice(0, 150);
}

export function summarize(week: FamilyWeek): WeekSummary {
  return {
    weekStart: week.weekStart,
    ...(week.summary ? { summary: week.summary } : {}),
    ...(week.recap ? { recap: week.recap } : {}),
    dinners: week.dinners,
    chores: {
      stamped: week.chores.reduce((n, c) => n + c.stamps.filter(Boolean).length, 0),
      total: week.chores.length * 7,
    },
    groceries: week.groceries.length,
  };
}
