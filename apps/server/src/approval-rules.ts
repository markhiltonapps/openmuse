import { z } from "zod";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

export const approvalRuleSchema = z.object({
  app: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]+$/)
    .max(100),
  /** One action (OUTLOOK_SEND_EMAIL); without it, every action in the app. */
  tool: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]+$/)
    .max(200)
    .optional(),
  /** For a while only, like Muse's time-limited grants; without it, until turned off. */
  hours: z.number().int().min(1).max(720).optional(),
});
export interface ApprovalRule {
  id: string;
  app: string;
  tool?: string;
  createdAt: string;
  expiresAt?: string;
}
interface AppPermission {
  /** The app's slug. */
  id: string;
  readOnly: boolean;
}

const DESTRUCTIVE =
  /^(DELETE|REMOVE|TRASH|DESTROY|PURGE|REVOKE|CANCEL|ARCHIVE|UNSUBSCRIBE|BAN|KICK|CLEAR|WIPE|RESET)$/;
/** Deleting or cancelling things never runs on an app-wide rule; it needs its own. */
export function destructiveAction(slug: string, app: string, tags: string[] = []) {
  if (tags.includes("destructiveHint")) return true;
  const prefix = `${app.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_`;
  const action = slug.toUpperCase().startsWith(prefix) ? slug.slice(prefix.length) : slug;
  return action
    .toUpperCase()
    .split("_")
    .some((word) => DESTRUCTIVE.test(word));
}

/** Connected-app actions the person lets run without asking each time. Purchases always ask. */
export class ApprovalRules {
  constructor(
    private readonly db: Store,
    private readonly now: () => number = Date.now,
  ) {}
  /** Rules still in force; ones for a while are gone once their time is up. */
  async list(owner: string) {
    const now = new Date(this.now()).toISOString();
    return (await this.db.list<ApprovalRule>(owner, "approval-rules"))
      .filter((rule) => !rule.expiresAt || rule.expiresAt > now)
      .sort((a, b) => `${a.app}:${a.tool ?? ""}`.localeCompare(`${b.app}:${b.tool ?? ""}`));
  }
  /** Apps the person set to read-only: the agent can look, never change anything there. */
  async readOnlyApps(owner: string) {
    return (await this.db.list<AppPermission>(owner, "app-permissions"))
      .filter((p) => p.readOnly)
      .map((p) => p.id)
      .sort();
  }
  async setReadOnly(owner: string, raw: unknown) {
    const input = z.object({ app: approvalRuleSchema.shape.app, readOnly: z.boolean() }).parse(raw);
    if (input.readOnly)
      await this.db.put(owner, "app-permissions", { id: input.app, readOnly: true });
    else await this.db.remove(owner, "app-permissions", input.app);
    return { readOnly: await this.readOnlyApps(owner) };
  }
  /** Why an action that changes something can't run in this app, or undefined when it can. */
  async blocked(owner: string, tool: { app: string; readOnly: boolean }) {
    if (tool.readOnly) return undefined;
    const app = tool.app.toLowerCase();
    if (!(await this.readOnlyApps(owner)).includes(app)) return undefined;
    const name = app.charAt(0).toUpperCase() + app.slice(1);
    return `${name} is set to read-only, so nothing there can be changed or sent. The person can allow changes under Apps → Apps → App permissions.`;
  }
  async add(owner: string, raw: unknown) {
    const input = approvalRuleSchema.parse(raw);
    const rule: ApprovalRule = {
      id: input.tool ? `tool:${input.tool}` : `app:${input.app}`,
      app: input.app,
      ...(input.tool ? { tool: input.tool } : {}),
      createdAt: new Date(this.now()).toISOString(),
      ...(input.hours
        ? { expiresAt: new Date(this.now() + input.hours * 3_600_000).toISOString() }
        : {}),
    };
    // A new grant replaces an older one for the same thing (say, "for an hour" after "always").
    await this.db.put(owner, "approval-rules", rule);
    return rule;
  }
  async remove(owner: string, id: string) {
    if (!(await this.db.take(owner, "approval-rules", id)))
      throw new AppError("Rule not found", 404);
    return { ok: true };
  }
  /** How the rule that lets this action run reads, or undefined when it needs review. */
  async allows(owner: string, tool: { slug: string; app: string; destructive?: boolean }) {
    const rules = await this.list(owner);
    const name = tool.app.charAt(0).toUpperCase() + tool.app.slice(1);
    if (rules.some((r) => r.tool === tool.slug.toUpperCase())) return `${tool.slug} in ${name}`;
    if (!tool.destructive && rules.some((r) => !r.tool && r.app === tool.app.toLowerCase()))
      return `${name} actions`;
    return undefined;
  }
}
