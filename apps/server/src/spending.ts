import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.ts";

/** Write actions that spend money. Read-only actions never reach this check. */
const PURCHASE =
  /(^|_)(PURCHASE|ORDER|CHECKOUT|PAY|PAYMENT|PAYOUT|BUY|CHARGE|SUBSCRIBE|SUBSCRIPTION|DONATE|TRANSFER|SEND_MONEY|BOOK|RESERVE|TIP)(_|$)/;
export const isPurchase = (slug: string) => PURCHASE.test(slug.toUpperCase());

/** The largest money-like value in the action's inputs, in dollars ("…cents" keys divided by 100). */
export function statedAmount(args: unknown, depth = 0): number {
  if (!args || typeof args !== "object" || depth > 4) return 0;
  let max = 0;
  for (const [key, value] of Object.entries(args)) {
    const money = /amount|total|price|cost|subtotal|payment|charge/i.test(key);
    const number = typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : value;
    if (money && typeof number === "number" && Number.isFinite(number) && number > 0)
      max = Math.max(max, /cents/i.test(key) ? number / 100 : number);
    else if (value && typeof value === "object")
      max = Math.max(max, statedAmount(value, depth + 1));
  }
  return max;
}

export const spendingSettingsSchema = z.object({
  enabled: z.boolean(),
  perPurchaseLimit: z.number().positive().max(100000),
  monthlyLimit: z.number().positive().max(1000000),
});
export type SpendingSettings = z.infer<typeof spendingSettingsSchema>;
const DEFAULTS: SpendingSettings = { enabled: false, perPurchaseLimit: 100, monthlyLimit: 500 };
const month = (at: number) => new Date(at).toISOString().slice(0, 7);

/** Purchase guardrails: off until enabled, then capped per purchase and per calendar month. */
export class SpendingService {
  constructor(
    private readonly db: Store,
    private readonly now: () => number = Date.now,
  ) {}
  async settings(owner: string) {
    const saved = await this.db.get<SpendingSettings & { id: string }>(
      owner,
      "agent-settings",
      "spending",
    );
    const settings = spendingSettingsSchema.parse({ ...DEFAULTS, ...saved });
    return { ...settings, spentThisMonth: await this.spent(owner) };
  }
  async update(owner: string, raw: unknown) {
    const input = spendingSettingsSchema.parse(raw);
    await this.db.put(owner, "agent-settings", { id: "spending", ...input });
    return this.settings(owner);
  }
  async spent(owner: string) {
    const current = month(this.now());
    const ledger = await this.db.list<{ amount: number; month: string }>(owner, "spending");
    return ledger.filter((e) => e.month === current).reduce((sum, e) => sum + e.amount, 0);
  }
  /** Why this purchase is not allowed right now, or undefined when it is. */
  async check(owner: string, amount: number | undefined) {
    const settings = await this.settings(owner);
    if (!settings.enabled)
      return "Purchases are turned off. The person can turn them on in Apps → Spending.";
    if (!amount || amount <= 0)
      return "State the purchase total in US dollars (amountUsd) so it can be checked against the spending limits.";
    if (amount > settings.perPurchaseLimit)
      return `$${amount.toFixed(2)} is over the $${settings.perPurchaseLimit.toFixed(2)} per-purchase limit.`;
    if (settings.spentThisMonth + amount > settings.monthlyLimit)
      return `This would pass the $${settings.monthlyLimit.toFixed(2)} monthly limit ($${settings.spentThisMonth.toFixed(2)} spent so far).`;
    return undefined;
  }
  async record(owner: string, actionId: string, amount: number) {
    await this.db.insertIfAbsent(owner, "spending", {
      id: actionId || randomUUID(),
      amount,
      month: month(this.now()),
      at: new Date(this.now()).toISOString(),
    });
  }
}
