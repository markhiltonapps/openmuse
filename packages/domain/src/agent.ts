import { z } from "zod";

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_input"
  | "scheduled"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";
export interface Evidence {
  id: string;
  kind: "mail" | "file" | "web" | "user";
  title: string;
  excerpt: string;
  url?: string;
}
export interface TaskStep {
  id: string;
  title: string;
  status: "pending" | "running" | "succeeded" | "failed" | "waiting";
  detail?: string;
}
export interface AgentTask {
  id: string;
  title: string;
  prompt: string;
  kind: "agent" | "document" | "monitor" | "finance" | "plan";
  status: TaskStatus;
  goalId?: string;
  plan: TaskStep[];
  evidence: Evidence[];
  input: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  leaseId?: string | null;
  leaseUntil?: string | null;
  attempts: number;
  actionId?: string | null;
  result?: string;
  error?: string | null;
  question?: string;
  artifactIds: string[];
}
export interface RunEvent {
  id: string;
  taskId: string;
  date: string;
  kind: "plan" | "step" | "observation" | "approval" | "result" | "error" | "status";
  title: string;
  detail: string;
}
export interface Goal {
  id: string;
  title: string;
  description: string;
  category: string;
  status: "active" | "paused" | "completed";
  milestones: { id: string; title: string; done: boolean }[];
  createdAt: string;
}
export interface Monitor {
  id: string;
  taskId: string;
  title: string;
  url: string;
  condition: "change" | "contains" | "price_below";
  value: string;
  intervalMinutes: number;
  status: "active" | "paused" | "stopped";
  nextCheckAt: string;
  lastCheckedAt?: string;
  lastValue?: string;
  lastHash?: string;
  error?: string;
  checks: number;
}
export interface Idea {
  id: string;
  /** Drawn in 3D next to the idea; picked from its words when missing. */
  emoji?: string;
  title: string;
  reason: string;
  evidence: Evidence[];
  prompt: string;
  kind: AgentTask["kind"];
  input: Record<string, unknown>;
  status: "new" | "dismissed" | "accepted";
  taskId?: string;
  createdAt: string;
}
export interface AgentMemory {
  id: string;
  text: string;
  source: string;
  createdAt: string;
}
/** A fact the agent noticed; used only after the person keeps it. */
export interface MemorySuggestion {
  id: string;
  text: string;
  reason: string;
  source: string;
  createdAt: string;
  status: "pending" | "kept" | "dismissed";
}
export const memorySuggestionSchema = z.object({
  text: z.string().trim().min(3).max(500),
  reason: z.string().trim().max(300).default(""),
});
/** A recurring job: each run becomes an ordinary task in Activity. */
export interface Routine {
  id: string;
  title: string;
  prompt: string;
  /** Local time of day, HH:MM (24-hour). */
  time: string;
  /** Days it runs, 0 = Sunday. */
  days: number[];
  timeZone: string;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  lastTaskId?: string;
  createdAt: string;
}
const validTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};
export const timeZoneSchema = z.string().trim().min(1).max(80).refine(validTimeZone, {
  message: "Unknown time zone",
});
export const routineInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(4000),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 07:30"),
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .transform((days) => [...new Set(days)].sort())
    .default([0, 1, 2, 3, 4, 5, 6]),
  timeZone: timeZoneSchema.optional(),
  enabled: z.boolean().default(true),
});
export interface AgentArtifact {
  id: string;
  taskId: string;
  kind: "plan" | "comparison" | "finance" | "report";
  title: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
  /** The finished job's own summary, saved as a report; the job's page already shows it. */
  final?: boolean;
}
export interface AgentNotification {
  id: string;
  taskId?: string;
  /** Set on a reminder going off. */
  reminderId?: string;
  /** Set on a meal check-in ("What did you have for lunch?"); answered from chat. */
  checkInId?: string;
  /** Set on something saved for approval outside a job (from a live call): opens its review. */
  actionId?: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}
export const avatarCharacters = [
  "neddy",
  "todd",
  "capybara",
  "fox",
  "cat",
  "panda",
  "owl",
  "robot",
  "spark",
  "custom",
] as const;
export const avatarColors = ["sky", "sand", "lilac", "mint", "peach"] as const;
export interface AgentIdentity {
  name: string;
  tone: "warm" | "concise" | "thoughtful";
  /** Background color behind the avatar. */
  avatar?: (typeof avatarColors)[number];
  character?: (typeof avatarCharacters)[number];
  /** Changes whenever a custom picture or design is saved. */
  avatarImageVersion?: string;
  /** Older setting: false kept updates out of chat. `updatesDisplay` replaces it. */
  showChatUpdates?: boolean;
  /** Where background updates show: a pop-up by the bell (default), only the bell, or in chat. */
  updatesDisplay?: "popup" | "bell" | "chat";
  /** Email the person when a job they handed off is done, needs them, or fails (on unless false). */
  emailJobUpdates?: boolean;
}
/** A person's own avatar: an uploaded photo (data URL) or a designed SVG. */
export interface AvatarImage {
  id: "avatar-image";
  kind: "photo" | "svg";
  data: string;
  updatedAt: string;
}
export interface AgentWorkspace {
  tasks: AgentTask[];
  goals: Goal[];
  monitors: Monitor[];
  ideas: Idea[];
  memories: AgentMemory[];
  /** Pending suggestions only. */
  memorySuggestions: MemorySuggestion[];
  routines: Routine[];
  artifacts: AgentArtifact[];
  notifications: AgentNotification[];
  identity: AgentIdentity;
  worker: { running: boolean; lastTickAt?: string };
}
export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  prompt: z.string().trim().min(1).max(12000),
  kind: z.enum(["agent", "document", "monitor", "finance", "plan"]).default("agent"),
  goalId: z.string().optional(),
  input: z.record(z.string(), z.unknown()).default({}),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export const monitorInputSchema = z
  .object({
    title: z.string().min(1).max(160),
    url: z.url().max(4096),
    condition: z.enum(["change", "contains", "price_below"]).default("change"),
    value: z.string().max(300).default(""),
    intervalMinutes: z.number().int().min(1).max(10080).default(15),
  })
  .superRefine((v, c) => {
    if (v.condition !== "change" && !v.value.trim())
      c.addIssue({ code: "custom", message: "Enter a condition value" });
    if (
      v.condition === "price_below" &&
      (!Number.isFinite(Number(v.value)) || Number(v.value) <= 0)
    )
      c.addIssue({ code: "custom", message: "Enter a positive price" });
  });
export const goalInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000).default(""),
  category: z.string().max(80).default("Personal"),
  milestones: z.array(z.string().min(1).max(200)).max(20).default([]),
});
