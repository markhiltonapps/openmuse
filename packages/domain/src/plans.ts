/**
 * Neddy's plans and what each one counts (owner, 2026-10-21: Free, Starter $10, Neddy $20, Neddy
 * Max $100; the three paid plans are final). Everything is counted per calendar month, in the
 * person's time zone, and nothing carries over. `docs/pricing_math.md` has the cost behind each
 * number; the website's pricing page shows the same ones.
 */
export type PlanId = "free" | "starter" | "neddy" | "max" | "early";

/** What a plan counts. `null` is not counted at all (early access only). */
export interface Plan {
  id: PlanId;
  name: string;
  /** Dollars a month; 0 for Free. */
  price: number;
  callMinutes: number;
  messages: number | null;
  /** Hours of recorded meetings; Free gets half an hour. */
  meetingHours: number;
  jobs: number | null;
}

export const PLANS: Record<PlanId, Plan> = {
  // Free costs about $1.80 a month at the ceilings (100 messages at 1.5¢, 5 call minutes at 2¢,
  // half an hour of meetings at 12¢ an hour, one job at 15¢); it is by invite like everything.
  free: {
    id: "free",
    name: "Free",
    price: 0,
    callMinutes: 5,
    messages: 100,
    meetingHours: 0.5,
    jobs: 1,
  },
  starter: {
    id: "starter",
    name: "Starter",
    price: 10,
    callMinutes: 20,
    messages: 500,
    meetingHours: 1,
    jobs: 2,
  },
  neddy: {
    id: "neddy",
    name: "Neddy",
    price: 20,
    callMinutes: 60,
    messages: 1000,
    meetingHours: 3,
    jobs: 5,
  },
  // Exactly five times Neddy on price and on every count.
  max: {
    id: "max",
    name: "Neddy Max",
    price: 100,
    callMinutes: 300,
    messages: 5000,
    meetingHours: 15,
    jobs: 25,
  },
  // Anyone the admin hasn't given a plan keeps what early access always had: 200 call minutes and
  // 10 meeting hours, with messages and jobs not counted. Never shown on the website.
  early: {
    id: "early",
    name: "Early access",
    price: 0,
    callMinutes: 200,
    messages: null,
    meetingHours: 10,
    jobs: null,
  },
};
/** The plans people can choose, cheapest first; Free first because it costs nothing. */
export const PLAN_ORDER: PlanId[] = ["free", "starter", "neddy", "max"];
export const isPlanId = (value: unknown): value is PlanId =>
  typeof value === "string" && Object.hasOwn(PLANS, value);
/** The next plan up, for "move up a plan"; none above Max or for early access. */
export function nextPlan(id: PlanId): Plan | undefined {
  const at = PLAN_ORDER.indexOf(id);
  const next = at < 0 ? undefined : PLAN_ORDER[at + 1];
  return next ? PLANS[next] : undefined;
}

/** The four things that are counted. */
export type Counted = "callMinutes" | "messages" | "meetingHours" | "jobs";
export const COUNTED: Counted[] = ["callMinutes", "messages", "meetingHours", "jobs"];

/** Extras, bought in these packs on any plan (owner: at a limit, offer to add more). */
export const EXTRAS: Record<Counted, { amount: number; price: number; label: string }> = {
  callMinutes: { amount: 30, price: 3.6, label: "30 more call minutes" },
  messages: { amount: 50, price: 4, label: "50 more messages" },
  meetingHours: { amount: 1, price: 0.8, label: "another meeting hour" },
  jobs: { amount: 1, price: 1.5, label: "another background job" },
};

/** Where people write to for more room until billing is switched on. */
export const CONTACT_EMAIL = "hello@neatoventures.com";

const money = (dollars: number) =>
  Number.isInteger(dollars)
    ? `$${dollars}`
    : dollars < 1
      ? `${Math.round(dollars * 100)}¢`
      : `$${dollars.toFixed(2)}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What was used up, in the words people hear. */
const WHAT: Record<Counted, (limit: number) => string> = {
  callMinutes: (n) => `${n} ${plural(n, "minute", "minutes")} of live talk`,
  messages: (n) => `${n} ${plural(n, "message", "messages")}`,
  meetingHours: (n) =>
    n < 1
      ? `${Math.round(n * 60)} minutes of recorded meetings`
      : `${n} ${plural(n, "hour", "hours")} of recorded meetings`,
  jobs: (n) => (n === 1 ? "background job" : `${n} background jobs`),
};

/**
 * What people are told when this month's count is used up. Said kindly, never as an error, with
 * what comes next: the day it comes back, and how to get more now. Before billing is switched on
 * "more" means writing to a person; `billing` flips it to the app's own buttons later.
 * `limit` is the plan's count plus any extras already added this month.
 */
export function limitText(
  kind: Counted,
  plan: Plan,
  limit: number,
  nextMonth: string,
  billing = false,
) {
  const extra = EXTRAS[kind];
  const up = nextPlan(plan.id);
  const how = billing
    ? `You can add ${extra.label} for ${money(extra.price)}${up ? `, or move up to ${up.name} for ${money(up.price)} a month` : ""}.`
    : `For more room, email ${CONTACT_EMAIL} and a person will help.`;
  const tail =
    kind === "callMinutes"
      ? " Until then, you can still type, and tap Listen to hear a reply."
      : "";
  return `You’ve used this month’s ${WHAT[kind](limit)} on ${plan.id === "early" ? "early access" : `the ${plan.name} plan`}. ${limit === 1 ? "It comes" : "They come"} back on ${nextMonth}.${tail} ${how}`.replace(
    /\s+/g,
    " ",
  );
}
