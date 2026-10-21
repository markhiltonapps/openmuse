import {
  COUNTED,
  type Counted,
  EXTRAS,
  isPlanId,
  limitText,
  PLANS,
  type Plan,
  type PlanId,
} from "../../../packages/domain/src/plans.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/** What a person gets this month: the plan's count plus extras added, `null` for not counted. */
export type Limits = Record<Counted, number | null>;
interface SavedPlan {
  id: string;
  plan: PlanId;
  updatedAt: string;
}
/** Extras added for one month, per person ("plan-extras", id = the month). */
type Extras = { id: string } & Partial<Record<Counted, number>>;
/** Typed messages and handed-off jobs counted this month, with the last few ids seen so a retry isn't counted twice. */
interface Counts {
  id: string;
  messages: number;
  jobs: number;
  seen: string[];
}
const SEEN = 60;

/** The 1st of next month in the person's time zone, as "November 1". */
export function nextMonthDay(timeZone = "UTC", now = new Date()) {
  let month = now.getUTCMonth() + 1;
  try {
    month = Number(new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric" }).format(now));
  } catch {
    // An unknown zone: UTC's month.
  }
  const next = new Date(Date.UTC(2000, month % 12, 1)).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  return `${next} 1`;
}

/**
 * Who is on which plan, and this month's counts (owner, 2026-10-21). Call minutes and meeting
 * hours are already measured by the usage meter and the meeting recorder; this holds the limits
 * they check, and counts the two things nothing counted before: typed messages and handed-off
 * jobs. Anyone without a plan stays on "early", today's limits, so nothing changes until the
 * admin chooses a plan for a person.
 */
export class Plans {
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(
    private readonly db: Store,
    private readonly options: {
      /** Early access's limits (VOICE_MONTHLY_MINUTES, MEETING_MONTHLY_HOURS); 0 is no limit. */
      early?: { callMinutes: number; meetingHours: number };
      /** Card payments are switched on, so the limit message can point at buttons, not an email. */
      billing?: () => boolean;
      timeZone?: (owner: string) => Promise<string>;
      now?: () => Date;
    } = {},
  ) {}
  private now() {
    return this.options.now?.() ?? new Date();
  }
  private month() {
    // The same month the usage meter keeps (UTC), so minutes and counts reset together.
    return this.now().toISOString().slice(0, 7);
  }
  /** One at a time per person, so two quick messages can't both slip under the limit. */
  private serial<T>(owner: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(owner) ?? Promise.resolve()).then(work, work);
    this.queues.set(
      owner,
      next.catch(() => undefined),
    );
    return next;
  }
  /** The plan a person is on; early access when nobody chose one. */
  async planOf(owner: string): Promise<Plan> {
    const saved = await this.db.get<SavedPlan>("system", "plans", owner);
    const plan = saved && isPlanId(saved.plan) ? PLANS[saved.plan] : PLANS.early;
    if (plan.id !== "early" || !this.options.early) return plan;
    return {
      ...plan,
      callMinutes: this.options.early.callMinutes,
      meetingHours: this.options.early.meetingHours,
    };
  }
  async setPlan(owner: string, id: PlanId) {
    if (!isPlanId(id)) throw new AppError("That isn’t one of the plans", 422);
    const saved: SavedPlan = { id: owner, plan: id, updatedAt: this.now().toISOString() };
    await this.db.put("system", "plans", saved);
    return this.view(owner);
  }
  /** Extras added this month. */
  async extras(owner: string): Promise<Partial<Record<Counted, number>>> {
    const found = await this.db.get<Extras>(owner, "plan-extras", this.month());
    const { id: _id, ...rest } = found ?? { id: "" };
    return rest;
  }
  /** The admin adds a pack (or more) of one extra for this month, until card payments do it. */
  async addExtra(owner: string, kind: Counted, packs = 1) {
    if (!COUNTED.includes(kind)) throw new AppError("That isn’t something that can be added", 422);
    if (!Number.isInteger(packs) || packs < 1 || packs > 100)
      throw new AppError("Add between 1 and 100 packs at a time", 422);
    return this.serial(owner, async () => {
      const month = this.month();
      const current = (await this.db.get<Extras>(owner, "plan-extras", month)) ?? { id: month };
      const amount = (current[kind] ?? 0) + EXTRAS[kind].amount * packs;
      await this.db.put(owner, "plan-extras", { ...current, [kind]: amount });
      return this.view(owner);
    });
  }
  /** This month's limits: the plan's counts plus extras; 0 from early access means not counted. */
  async limits(owner: string): Promise<{ plan: Plan; limit: Limits }> {
    const [plan, extras] = await Promise.all([this.planOf(owner), this.extras(owner)]);
    const limit = {} as Limits;
    for (const kind of COUNTED) {
      const base = plan[kind];
      // Not counted (early access's messages and jobs, or a limit set to 0): no limit at all.
      limit[kind] = base ? base + (extras[kind] ?? 0) : null;
    }
    return { plan, limit };
  }
  async counts(owner: string) {
    const found = await this.db.get<Counts>(owner, "plan-counts", this.month());
    return { messages: found?.messages ?? 0, jobs: found?.jobs ?? 0 };
  }
  /** What a limit says, in words, with the day it comes back. */
  async limitMessage(owner: string, kind: Counted) {
    const { plan, limit } = await this.limits(owner);
    const zone = (await this.options.timeZone?.(owner).catch(() => "UTC")) ?? "UTC";
    return limitText(
      kind,
      plan,
      limit[kind] ?? 0,
      nextMonthDay(zone, this.now()),
      this.options.billing?.() ?? false,
    );
  }
  /**
   * Counts one typed message (or one handed-off job) unless this month's count is used up.
   * Asking again with the same id, a retry, is never counted twice. Returns what to say instead
   * when it can't go ahead.
   */
  private claim(owner: string, kind: "messages" | "jobs", id: string) {
    return this.serial(owner, async () => {
      const month = this.month();
      const current = (await this.db.get<Counts>(owner, "plan-counts", month)) ?? {
        id: month,
        messages: 0,
        jobs: 0,
        seen: [],
      };
      const key = `${kind}:${id}`;
      if (current.seen.includes(key)) return { ok: true as const };
      const { limit } = await this.limits(owner);
      const cap = limit[kind];
      if (cap !== null && current[kind] >= cap)
        return { ok: false as const, text: await this.limitMessage(owner, kind) };
      await this.db.put(owner, "plan-counts", {
        ...current,
        [kind]: current[kind] + 1,
        seen: [...current.seen, key].slice(-SEEN),
      } satisfies Counts);
      return { ok: true as const };
    });
  }
  claimMessage(owner: string, messageId: string) {
    return this.claim(owner, "messages", messageId);
  }
  claimJob(owner: string, taskId: string) {
    return this.claim(owner, "jobs", taskId);
  }
  /** A person's plan, limits and this month's counts, for the app and the admin. */
  async view(owner: string) {
    const [{ plan, limit }, counts] = await Promise.all([this.limits(owner), this.counts(owner)]);
    return { plan: plan.id, name: plan.name, price: plan.price, limit, ...counts };
  }
}
