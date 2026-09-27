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
});
export interface ApprovalRule {
  id: string;
  app: string;
  tool?: string;
  createdAt: string;
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
  constructor(private readonly db: Store) {}
  async list(owner: string) {
    return (await this.db.list<ApprovalRule>(owner, "approval-rules")).sort((a, b) =>
      `${a.app}:${a.tool ?? ""}`.localeCompare(`${b.app}:${b.tool ?? ""}`),
    );
  }
  async add(owner: string, raw: unknown) {
    const input = approvalRuleSchema.parse(raw);
    const rule: ApprovalRule = {
      id: input.tool ? `tool:${input.tool}` : `app:${input.app}`,
      app: input.app,
      ...(input.tool ? { tool: input.tool } : {}),
      createdAt: new Date().toISOString(),
    };
    return (await this.db.insertIfAbsent(owner, "approval-rules", rule)) ?? rule;
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
