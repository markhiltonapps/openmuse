import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type AgentArtifact,
  type AgentIdentity,
  type AgentMemory,
  type AgentNotification,
  type AgentTask,
  type AgentWorkspace,
  createTaskSchema,
  type Evidence,
  type Goal,
  goalInputSchema,
  type Idea,
  type MemorySuggestion,
  type Monitor,
  memorySuggestionSchema,
  monitorInputSchema,
  type Routine,
  type RunEvent,
  routineInputSchema,
  timeZoneSchema,
} from "../../../../packages/domain/src/agent.ts";
import type {
  ActionProposal,
  Artifact,
  BrowserSession,
  Mail,
  ProposalInput,
} from "../../../../packages/domain/src/index.ts";
import { type ActionService, usesGoogle } from "../actions.ts";
import type { ApprovalRules } from "../approval-rules.ts";
import type { AppConnector } from "../apps.ts";
import type { BrowserService } from "../browser.ts";
import { ComputerService } from "../computer.ts";
import type { Config } from "../config.ts";
import type { Store } from "../db.ts";
import { AppError } from "../errors.ts";
import type { LookAtImage } from "../file-tools.ts";
import type { Files } from "../files.ts";
import type { HealthService } from "../health.ts";
import { ideasSystemPrompt, parseIdeas } from "../ideas-ai.ts";
import { backgroundFailure } from "../log.ts";
import type { MailAlerts } from "../mail-alerts.ts";
import type { ReminderService } from "../reminders.ts";
import type { UsageMeter } from "../usage.ts";
import type { WebSearch } from "../web-search.ts";
import type { WorkspaceService } from "../workspace.ts";
import { analyzeSpending } from "./finance.ts";
import { executeModelTask } from "./model.ts";
import { nextRun, routinePrompt } from "./routines.ts";
import { complete } from "./tanstack-agent.ts";
import { LostLeaseError, type TaskContext, TaskWorker } from "./worker.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const date = () => new Date().toISOString();
const terminal = new Set(["succeeded", "failed", "cancelled"]);
export class AgentService {
  readonly worker: TaskWorker;
  private maintenance?: ReturnType<typeof setInterval>;
  private refreshing = false;
  constructor(
    readonly db: Store,
    readonly config: Config,
    readonly workspace: WorkspaceService,
    readonly files: Files,
    readonly actions: ActionService,
    readonly browser: BrowserService,
    readonly computer: ComputerService = new ComputerService(db, config),
    /** Third-party apps (Composio); absent when COMPOSIO_API_KEY is unset. */
    readonly apps?: AppConnector,
  ) {
    this.worker = new TaskWorker(db, (owner, task, context) => this.execute(owner, task, context), {
      settled: (owner, task) => this.publishOutcome(owner, task),
    });
  }
  start() {
    this.worker.start();
    // Maintenance is independent of the HTTP response and reconciles durable records.
    void this.maintain().catch((error) => backgroundFailure("initial maintenance", error));
    this.maintenance = setInterval(() => {
      void this.maintain().catch((error) => backgroundFailure("maintenance", error));
    }, 60000);
  }
  async stop() {
    if (this.maintenance) clearInterval(this.maintenance);
    this.maintenance = undefined;
    await this.worker.stop();
    while (this.refreshing) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  private async maintain() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      // Recover publications if the process exited after committing an outcome.
      for (const { owner, value } of await this.db.scan<AgentTask>("tasks"))
        await this.publishOutcome(owner, value);
      for (const { owner, value } of await this.db.scan<Monitor>("monitors"))
        await this.activateMonitor(owner, value);
      await this.runDueRoutines();
      await this.feed?.refreshDue().catch((error) => backgroundFailure("feed refresh", error));
      await this.reminders
        ?.deliverDue((owner) => this.removed(owner))
        .catch((error) => backgroundFailure("reminders", error));
      for (const { owner, value } of await this.db.scan<Idea>("ideas"))
        if (
          value.status === "accepted" &&
          value.taskId &&
          !(await this.db.get(owner, "tasks", value.taskId))
        )
          await this.decideIdea(owner, value.id, "accept").catch(async (error) => {
            backgroundFailure("recover accepted idea", error);
            await this.notify(
              owner,
              "Accepted idea needs attention",
              "Open the idea again after making room for another task.",
              undefined,
              `idea-recovery:${value.id}`,
            );
          });
      for (const { owner, value } of await this.db.scan<{ id: string; lastIdeasAt?: string }>(
        "agent-settings",
      )) {
        if (value.id !== "identity" || (await this.removed(owner))) continue;
        if (!value.lastIdeasAt || Date.now() - Date.parse(value.lastIdeasAt) > 15 * 60000)
          await this.refreshIdeas(owner).catch(async () => {
            await this.notify(
              owner,
              "Source refresh needs attention",
              "Reconnect the source or refresh Ideas to see the error.",
              undefined,
              `source-error:${Math.floor(Date.now() / 3600000)}`,
            );
          });
      }
    } finally {
      this.refreshing = false;
    }
  }
  /** A person the admin removed keeps their data, but their agent stops working in the background. */
  private async removed(owner: string) {
    return (
      (await this.db.get<{ status: string }>("system", "accounts", owner))?.status === "disabled"
    );
  }
  async ensure(owner: string) {
    await this.db.insertIfAbsent(owner, "agent-settings", {
      id: "identity",
      name: "Neddy",
      tone: "warm",
      character: "neddy",
    });
  }
  async snapshot(owner: string): Promise<AgentWorkspace> {
    await this.ensure(owner);
    const [
      tasks,
      goals,
      monitors,
      ideas,
      memories,
      artifacts,
      notifications,
      identity,
      suggestions,
      routines,
    ] = await Promise.all([
      this.db.list<AgentTask>(owner, "tasks"),
      this.db.list<Goal>(owner, "goals"),
      this.db.list<Monitor>(owner, "monitors"),
      this.db.list<Idea>(owner, "ideas"),
      this.db.list<AgentMemory>(owner, "memories"),
      this.db.list<AgentArtifact>(owner, "agent-artifacts"),
      this.db.list<AgentNotification>(owner, "notifications"),
      this.db.get<AgentIdentity>(owner, "agent-settings", "identity"),
      this.db.list<MemorySuggestion>(owner, "memory-suggestions"),
      this.db.list<Routine>(owner, "routines"),
    ]);
    const heartbeat = await this.db.get<{ lastTickAt: string }>("system", "worker-status", "tasks");
    return {
      tasks,
      goals,
      monitors,
      ideas,
      memories,
      memorySuggestions: suggestions.filter((s) => s.status === "pending"),
      routines: routines.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      artifacts,
      notifications,
      identity: identity ?? { name: "Neddy", tone: "warm", character: "neddy" },
      worker: {
        running:
          this.worker.running ||
          Boolean(heartbeat && Date.now() - Date.parse(heartbeat.lastTickAt) < 15000),
        lastTickAt: heartbeat?.lastTickAt ?? this.worker.lastTickAt,
      },
    };
  }
  async getTask(owner: string, id: string) {
    const task = await this.db.get<AgentTask>(owner, "tasks", id);
    if (!task) throw new AppError("Task not found", 404);
    return task;
  }
  async detail(owner: string, id: string) {
    const task = await this.getTask(owner, id);
    const files = (await this.db.list<Artifact>(owner, "files")).filter((file) =>
      task.artifactIds.includes(file.id),
    );
    const browsers = (await this.db.list<BrowserSession>(owner, "browsers")).filter((browser) =>
      [task.state.browserId, task.state.sessionId].includes(browser.id),
    );
    return {
      task,
      files: files.map((file) => this.files.signed(owner, file)),
      browsers: browsers.map((browser) => this.browser.decorate(owner, browser)),
      events: (await this.db.list<RunEvent>(owner, "run-events"))
        .filter((e) => e.taskId === id)
        .sort((a, b) => a.date.localeCompare(b.date)),
      artifacts: (await this.db.list<AgentArtifact>(owner, "agent-artifacts")).filter(
        (a) => a.taskId === id,
      ),
    };
  }
  async createTask(owner: string, raw: unknown, idempotencyKey?: string, held = false) {
    const input = createTaskSchema.parse(raw);
    // Document tasks fill a PDF form attached to an email; they can't run without that email.
    if (input.kind === "document" && typeof input.input.messageId !== "string")
      throw new AppError(
        "Document tasks fill a PDF form attached to an email; choose the email first. To read or summarize a file, use read_file.",
        422,
      );
    if (input.kind === "monitor" && !held)
      throw new AppError(
        "To watch a web page, create a watch; for recurring checks of email or apps, create a routine",
        422,
      );
    if (input.goalId && !(await this.db.get(owner, "goals", input.goalId)))
      throw new AppError("Goal not found", 404);
    const id = idempotencyKey ? hash(`task:${idempotencyKey}`) : randomUUID();
    const existing = await this.db.get<AgentTask>(owner, "tasks", id);
    if (existing) return existing;
    if (
      (await this.db.list<AgentTask>(owner, "tasks")).filter((t) => !terminal.has(t.status))
        .length >= 100
    )
      throw new AppError("Finish or cancel some tasks before adding more", 409);
    const titles =
      input.kind === "document"
        ? [
            "Find the source document",
            "Fill a new copy",
            "Prepare a reply",
            "Wait for your decision",
            "Record the outcome",
          ]
        : input.kind === "monitor"
          ? ["Check the source", "Compare with the last observation", "Report a meaningful change"]
          : input.kind === "finance"
            ? ["Validate transactions", "Calculate the summary", "Save your tracker"]
            : ["Understand the outcome", "Plan the work", "Use connected tools", "Return a result"];
    const task: AgentTask = {
      id,
      title: input.title ?? input.prompt.slice(0, 90),
      prompt: input.prompt,
      kind: input.kind,
      goalId: input.goalId,
      status: held ? "paused" : "queued",
      plan: titles.map((title, i) => ({ id: String(i), title, status: "pending" })),
      evidence: [],
      input: input.input,
      state: {
        connectionId: (await this.workspace.connection(owner))?.id ?? null,
        ...(held && input.kind === "monitor" ? { initializingMonitor: true } : {}),
      },
      createdAt: date(),
      updatedAt: date(),
      attempts: 0,
      leaseId: null,
      leaseUntil: null,
      artifactIds: [],
    };
    await this.ensure(owner);
    await this.db.insertIfAbsent(owner, "tasks", task);
    return (await this.db.get<AgentTask>(owner, "tasks", id)) ?? task;
  }
  /** Marks every unread update about a task as read; returns how many there were. */
  async readTaskNotifications(owner: string, taskId: string) {
    const unread = (await this.db.list<AgentNotification>(owner, "notifications")).filter(
      (item) => item.taskId === taskId && !item.read,
    );
    for (const item of unread)
      await this.db.compareAndSwap(owner, "notifications", item.id, {}, { read: true });
    return unread.length;
  }
  async control(owner: string, id: string, action: "pause" | "resume" | "cancel" | "retry") {
    const task = await this.getTask(owner, id);
    // Stopping or retrying a task answers the updates about it.
    if (action === "cancel" || action === "retry") await this.readTaskNotifications(owner, id);
    if (action === "cancel" && task.status === "succeeded")
      throw new AppError("This task is already complete", 409);
    if (action === "retry" && task.status !== "failed")
      throw new AppError("Only failed tasks can be retried", 409);
    if (action === "resume" && task.status !== "paused")
      throw new AppError("Only paused tasks can be resumed", 409);
    if (action === "pause" && (terminal.has(task.status) || task.status === "paused")) return task;
    const status =
      action === "cancel"
        ? "cancelled"
        : action === "pause"
          ? "paused"
          : task.actionId
            ? "waiting_approval"
            : "queued";
    if (action === "retry" && task.actionId) {
      const a = await this.db.get<ActionProposal>(owner, "actions", task.actionId);
      if (a && a.status !== "succeeded")
        throw new AppError(
          "Check the reviewed action before retrying; its outcome may be uncertain. Start a new task when reconciled.",
          409,
        );
    }
    const updated = await this.db.compareAndSwap<AgentTask>(
      owner,
      "tasks",
      id,
      { status: task.status, leaseId: task.leaseId ?? null },
      {
        status,
        leaseId: null,
        leaseUntil: null,
        error: null,
        updatedAt: date(),
        result:
          action === "cancel"
            ? "Stopped by you."
            : action === "pause"
              ? "Paused. Resume when you're ready."
              : "",
        ...(task.kind === "monitor" && action === "resume"
          ? { state: { ...task.state, failures: 0, notice: null, resumingMonitor: false } }
          : {}),
      },
    );
    if (!updated) throw new AppError("Task changed; refresh and try again", 409);
    this.worker.abort(id);
    if (task.kind === "monitor")
      await this.db.compareAndSwap(
        owner,
        "monitors",
        String(task.input.monitorId),
        {},
        {
          status: action === "cancel" ? "stopped" : action === "pause" ? "paused" : "active",
          nextCheckAt: date(),
          // Clearing the error fences out a failure reconcile that read the task before this.
          ...(action === "resume" || action === "retry" ? { error: null } : {}),
        },
      );
    if (action === "cancel" && task.actionId) {
      const proposal = await this.db.get<ActionProposal>(owner, "actions", task.actionId);
      if (proposal?.status === "awaiting_review")
        await this.actions.decide(owner, proposal.id, proposal.hash, "deny");
    }
    await this.db.put(owner, "run-events", {
      id: randomUUID(),
      taskId: id,
      kind: "status",
      date: date(),
      title: `Task ${status}`,
      detail: "Changed by you",
    });
    return updated;
  }
  async answer(
    owner: string,
    id: string,
    answer: string,
    fields?: Record<string, string | boolean>,
  ) {
    const task = await this.getTask(owner, id);
    if (task.status !== "waiting_input")
      throw new AppError("This task is not waiting for input", 409);
    const next = await this.db.compareAndSwap<AgentTask>(
      owner,
      "tasks",
      id,
      { status: "waiting_input" },
      {
        status: "queued",
        question: null,
        input: { ...task.input, ...(fields ? { fields } : {}) },
        state: { ...task.state, answer },
        updatedAt: date(),
      },
    );
    if (!next) throw new AppError("Task changed; refresh and try again", 409);
    return next;
  }
  async createGoal(owner: string, raw: unknown, id?: string) {
    const input = goalInputSchema.parse(raw);
    const goal: Goal = {
      id: id ?? randomUUID(),
      title: input.title,
      description: input.description,
      category: input.category,
      status: "active",
      milestones: input.milestones.map((title) => ({ id: randomUUID(), title, done: false })),
      createdAt: date(),
    };
    await this.db.insertIfAbsent(owner, "goals", goal);
    return (await this.db.get<Goal>(owner, "goals", goal.id)) ?? goal;
  }
  async updateGoal(
    owner: string,
    id: string,
    patch: { status?: Goal["status"]; milestones?: Goal["milestones"] },
  ) {
    const goal = await this.db.get<Goal>(owner, "goals", id);
    if (!goal) throw new AppError("Goal not found", 404);
    const saved = await this.db.put(owner, "goals", { ...goal, ...patch });
    if (patch.status === "paused")
      for (const task of await this.db.list<AgentTask>(owner, "tasks"))
        if (task.goalId === id && !terminal.has(task.status) && task.status !== "paused")
          await this.control(owner, task.id, "pause");
    return saved;
  }
  async createMonitor(owner: string, raw: unknown, idempotencyKey?: string) {
    const input = monitorInputSchema.parse(raw);
    const url = new URL(input.url);
    if (url.protocol === "sample:" && this.config.mode !== "sample")
      throw new AppError("Sample sources are unavailable in live workspaces", 422);
    if (!["https:", "http:", "sample:"].includes(url.protocol) || url.username || url.password)
      throw new AppError("Use a public HTTP(S) page", 422);
    if (url.protocol === "sample:" && input.url !== "sample://availability")
      throw new AppError("Unknown sample source", 422);
    const id = idempotencyKey ? hash(`monitor:${idempotencyKey}`) : randomUUID();
    const existing = await this.db.get<Monitor>(owner, "monitors", id);
    if (existing) {
      await this.activateMonitor(owner, existing);
      return existing;
    }
    const task = await this.createTask(
      owner,
      {
        kind: "monitor",
        title: input.title,
        prompt: `Watch ${input.url} for ${input.condition}${input.value ? `: ${input.value}` : ""}`,
        input: { monitorId: id },
      },
      `monitor:${id}`,
      true,
    );
    const monitor: Monitor = {
      id,
      taskId: task.id,
      ...input,
      status: "active",
      nextCheckAt: date(),
      checks: 0,
    };
    await this.db.insertIfAbsent(owner, "monitors", monitor);
    await this.activateMonitor(owner, monitor);
    return monitor;
  }
  private async activateMonitor(owner: string, monitor: Monitor) {
    if (monitor.status !== "active") return null;
    const task = await this.getTask(owner, monitor.taskId);
    if (task.status !== "paused") return null;
    if (task.state.resumingMonitor)
      return this.db.compareAndSwap(
        owner,
        "tasks",
        task.id,
        { status: "paused", state: { resumingMonitor: true } },
        {
          status: "queued",
          nextRunAt: date(),
          leaseId: null,
          leaseUntil: null,
          error: null,
          state: { ...task.state, resumingMonitor: false, failures: 0, notice: null },
        },
      );
    if (!task.state.initializingMonitor) return null;
    return this.db.compareAndSwap(
      owner,
      "tasks",
      task.id,
      { status: "paused", attempts: 0, state: { initializingMonitor: true } },
      {
        status: "queued",
        state: { ...task.state, initializingMonitor: false },
      },
    );
  }
  async controlMonitor(owner: string, id: string, action: "pause" | "resume" | "stop" | "check") {
    const monitor = await this.db.get<Monitor>(owner, "monitors", id);
    if (!monitor) throw new AppError("Monitor not found", 404);
    if (monitor.status === "stopped" && action !== "stop")
      throw new AppError("Create a new watch to restart this stopped monitor", 409);
    if (action === "pause" || action === "stop") {
      const status = action === "pause" ? "paused" : "stopped";
      const saved = await this.db.put(owner, "monitors", {
        ...monitor,
        status,
        nextCheckAt: date(),
      });
      const task = await this.getTask(owner, monitor.taskId);
      await this.control(owner, task.id, action === "pause" ? "pause" : "cancel");
      return saved;
    }
    let monitorStatus = monitor.status;
    for (let attempt = 0; attempt < 2; attempt++) {
      const task = await this.getTask(owner, monitor.taskId);
      if (task.status === "cancelled") break;
      if (task.status === "paused") {
        // Mark the paused task before activating the monitor so no worker can claim it in between.
        const marked = await this.db.compareAndSwap(
          owner,
          "tasks",
          task.id,
          { status: "paused", leaseId: task.leaseId ?? null },
          { state: { ...task.state, resumingMonitor: true } },
        );
        if (!marked) break;
        const activated = await this.db.compareAndSwap<Monitor>(
          owner,
          "monitors",
          id,
          { status: monitor.status },
          { status: "active", nextCheckAt: date(), error: null },
        );
        const saved = activated ?? (await this.db.get<Monitor>(owner, "monitors", id));
        if (saved?.status === "active" && (await this.activateMonitor(owner, saved))) return saved;
        const unmarked = await this.db.compareAndSwap(
          owner,
          "tasks",
          task.id,
          { status: "paused", state: { resumingMonitor: true } },
          { state: { ...task.state, resumingMonitor: false } },
        );
        // Another request or maintenance may have finished this resume first.
        if (!unmarked && saved?.status === "active") {
          const latest = await this.getTask(owner, task.id);
          if (["queued", "running", "scheduled"].includes(latest.status)) return saved;
        }
        if (activated)
          await this.db.compareAndSwap(
            owner,
            "monitors",
            id,
            { status: "active" },
            { status: monitor.status, error: monitor.error ?? null },
          );
        break;
      }
      // Only activate the monitor we read, so a concurrent stop is never undone.
      const saved = await this.db.compareAndSwap<Monitor>(
        owner,
        "monitors",
        id,
        { status: monitorStatus },
        { status: "active", nextCheckAt: date() },
      );
      if (!saved) break;
      monitorStatus = "active";
      this.worker.abort(task.id);
      const queued = await this.db.compareAndSwap(
        owner,
        "tasks",
        task.id,
        // updatedAt fences out a whole run finishing in between, which would move the baseline.
        { status: task.status, leaseId: task.leaseId ?? null, updatedAt: task.updatedAt },
        {
          status: "queued",
          nextRunAt: date(),
          leaseId: null,
          leaseUntil: null,
          error: null,
          state: { ...task.state, failures: 0, notice: null },
        },
      );
      if (queued) return saved;
    }
    throw new AppError("The watch changed while updating. Try again.", 409);
  }
  /** One reply from the model without tools; replaced in tests. */
  complete: typeof complete = complete;
  /**
   * Ideas the model writes from what the agent knows: goals, tasks, routines, memories, apps and
   * interests. Once a day after 7 am, or when the person asks (at most every ten minutes).
   */
  private async thinkOfIdeas(owner: string, asked: boolean) {
    const model = this.config.workerModel ?? this.config.model;
    if (this.config.agentBackend !== "model" || !model) return;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: await this.timeZone(owner),
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date())
        .map((part) => [part.type, part.value]),
    );
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    const last = await this.db.get<{ id: string; day?: string; at?: string }>(
      owner,
      "agent-settings",
      "written-ideas",
    );
    if (asked ? last?.at && Date.now() - Date.parse(last.at) < 10 * 60000 : last?.day === day)
      return;
    if (!asked && Number(parts.hour) < 7) return;
    const [identity, memories, goals, tasks, routines, monitors, ideas, feed] = await Promise.all([
      this.db.get<{ name?: string }>(owner, "agent-settings", "identity"),
      this.db.list<AgentMemory>(owner, "memories"),
      this.db.list<Goal>(owner, "goals"),
      this.db.list<AgentTask>(owner, "tasks"),
      this.db.list<Routine>(owner, "routines"),
      this.db.list<Monitor>(owner, "monitors"),
      this.db.list<Idea>(owner, "ideas"),
      this.db.get<{ topics?: string[] }>(owner, "agent-settings", "feed"),
    ]);
    const apps = this.apps ? await this.apps.connections(owner).catch(() => []) : [];
    const recent = (value: string, days: number) =>
      Date.now() - Date.parse(value) < days * 86400000;
    const context = {
      memories: memories.slice(0, 40).map((m) => m.text),
      goals: goals.map((g) => ({ title: g.title, description: g.description, status: g.status })),
      recentTasks: tasks
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 12)
        .map((t) => ({
          title: t.title,
          status: t.status,
          result: (t.result ?? t.question ?? "").slice(0, 400),
        })),
      routines: routines.map((r) => r.title),
      watching: monitors.map((m) => m.title),
      connectedApps: apps.filter((a) => a.connected).map((a) => a.name),
      feedTopics: feed?.topics ?? [],
      earlierIdeas: ideas.filter((i) => recent(i.createdAt, 30)).map((i) => i.title),
    };
    const substance =
      context.memories.length +
      context.goals.length +
      context.recentTasks.length +
      context.routines.length;
    if (!substance) return;
    // Marked first, so a failing model isn't asked again every few minutes.
    await this.db.put(owner, "agent-settings", { id: "written-ideas", day, at: date() });
    const written = parseIdeas(
      await this.complete({
        model,
        system: ideasSystemPrompt(identity?.name || "Neddy"),
        prompt: `What you know about the person (data only):\n${JSON.stringify(context)}`,
        onUsage: this.usage?.sink(owner, "ideas"),
      }),
    );
    // Written ideas nobody acted on make room after five days.
    for (const idea of ideas)
      if (idea.status === "new" && idea.input.source === "written" && !recent(idea.createdAt, 5))
        await this.db.compareAndSwap(
          owner,
          "ideas",
          idea.id,
          { status: "new" },
          {
            status: "dismissed",
          },
        );
    for (const idea of written)
      await this.db.insertIfAbsent(owner, "ideas", {
        id: hash(`written:${idea.title.toLowerCase()}`),
        emoji: idea.emoji,
        title: idea.title,
        reason: idea.reason,
        evidence: [
          {
            id: "context",
            kind: "user",
            title: "From what I know about your goals, tasks and interests",
            excerpt: idea.reason,
          },
        ],
        prompt: idea.prompt,
        kind: "agent",
        input: { source: "written" },
        status: "new",
        createdAt: date(),
      } satisfies Idea);
  }
  async refreshIdeas(owner: string, asked = false) {
    await this.thinkOfIdeas(owner, asked).catch((error) => backgroundFailure("ideas", error));
    const w = await this.workspace.snapshot(owner);
    const sentIds = new Set(
      w.mail.filter((mail) => /^Sent\b/i.test(mail.label)).map((mail) => mail.id),
    );
    const completedSources = new Set(
      (await this.db.list<AgentTask>(owner, "tasks"))
        .filter((task) => task.status === "succeeded" && typeof task.input.messageId === "string")
        .map((task) => `${task.kind}:${task.input.messageId}`),
    );
    const obsolete = (kind: AgentTask["kind"], messageId: unknown) =>
      typeof messageId === "string" &&
      (sentIds.has(messageId) || completedSources.has(`${kind}:${messageId}`));
    // Retire earlier suggestions as well as preventing new duplicates. A concurrent
    // acceptance wins its own compare-and-swap and is never overwritten here.
    for (const idea of await this.db.list<Idea>(owner, "ideas"))
      if (idea.status === "new" && obsolete(idea.kind, idea.input.messageId))
        await this.db.compareAndSwap(
          owner,
          "ideas",
          idea.id,
          { status: "new" },
          { status: "dismissed" },
        );
    for (const mail of w.mail
      .filter(
        (m) =>
          !obsolete("document", m.id) &&
          m.attachments.length &&
          /form|permission|complete|fill|sign/i.test(`${m.subject} ${m.body}`),
      )
      .slice(0, 5)) {
      const id = hash(`document:${mail.id}:${mail.body}`);
      const idea: Idea = {
        id,
        title: `I can help with ${mail.subject}`,
        reason: `${mail.sender} sent a document that may need your attention. I can prepare it and a reply for your review.`,
        evidence: [this.mailEvidence(mail)],
        prompt: `Help complete the PDF from “${mail.subject}” and prepare a reply for review.`,
        kind: "document",
        input: { messageId: mail.id },
        status: "new",
        createdAt: date(),
      };
      await this.db.insertIfAbsent(owner, "ideas", idea);
    }
    for (const mail of w.mail
      .filter(
        (m) =>
          !obsolete("agent", m.id) &&
          /coffee|meet|available|schedule/i.test(`${m.subject} ${m.body}`),
      )
      .slice(0, 5)) {
      await this.db.insertIfAbsent(owner, "ideas", {
        id: hash(`coordination:${mail.id}`),
        title: `I can help coordinate ${mail.subject}`,
        reason: `${mail.sender} mentioned getting together. I can check your calendar and prepare a response for review.`,
        evidence: [this.mailEvidence(mail)],
        prompt: `Review the email “${mail.subject}”, check my calendar, and propose a next step. Ask me about missing preferences before preparing a reply.`,
        kind: "agent",
        input: { messageId: mail.id },
        status: "new",
        createdAt: date(),
      } satisfies Idea);
    }
    for (const goal of await this.db.list<Goal>(owner, "goals"))
      if (goal.status === "active" && !goal.milestones.length) {
        const id = hash(`goal:${goal.id}:${goal.description}`);
        await this.db.insertIfAbsent(owner, "ideas", {
          id,
          title: `Let's make a plan for ${goal.title}`,
          reason: "This goal has no milestones yet. A concrete plan will give it a next step.",
          evidence: [{ id: goal.id, kind: "user", title: goal.title, excerpt: goal.description }],
          prompt: `Create an actionable plan for ${goal.title}. ${goal.description}`,
          kind: "plan",
          input: { goalId: goal.id },
          status: "new",
          createdAt: date(),
        } satisfies Idea);
      }
    await this.ensure(owner);
    await this.db.compareAndSwap(owner, "agent-settings", "identity", {}, { lastIdeasAt: date() });
    return this.db.list<Idea>(owner, "ideas");
  }
  async decideIdea(owner: string, id: string, action: "accept" | "dismiss", prompt?: string) {
    let idea = await this.db.get<Idea>(owner, "ideas", id);
    if (!idea) throw new AppError("Idea not found", 404);
    if (idea.status === "dismissed" || (idea.status === "accepted" && action === "dismiss"))
      return idea;
    if (action === "dismiss")
      return this.db.compareAndSwap<Idea>(
        owner,
        "ideas",
        id,
        { status: "new" },
        { status: "dismissed" },
      );
    if (idea.status === "new") {
      const claimed = await this.db.compareAndSwap<Idea>(
        owner,
        "ideas",
        id,
        { status: "new" },
        {
          status: "accepted",
          taskId: hash(`task:idea:${id}`),
          prompt: prompt ?? idea.prompt,
        },
      );
      idea = claimed ?? (await this.db.get<Idea>(owner, "ideas", id));
      if (idea?.status !== "accepted") return idea;
    }
    const goal = await this.createGoal(
      owner,
      { title: idea.title, description: idea.reason },
      hash(`idea-goal:${id}`),
    );
    const task = await this.createTask(
      owner,
      {
        title: idea.title,
        prompt: idea.prompt,
        kind: idea.kind,
        input: idea.input,
        goalId: goal.id,
      },
      `idea:${id}`,
    );
    await this.db.compareAndSwap(
      owner,
      "ideas",
      id,
      { status: "new" },
      { status: "accepted", taskId: task.id },
    );
    return this.db.get<Idea>(owner, "ideas", id);
  }
  /** Meal log and guided workouts. */
  health?: HealthService;
  /** The Feed's morning refresh; runs from the maintenance loop. */
  feed?: { refreshDue(): Promise<void> };
  /** One-off reminders; delivered from the maintenance loop. */
  reminders?: ReminderService;
  /** Connected-app actions the person always allows. */
  approvals?: ApprovalRules;
  /** Looks at pictures in Files; set when a vision model is configured. */
  look?: LookAtImage;
  /** Model usage per person, for costs and plan limits. */
  usage?: UsageMeter;
  /** New-email alerts and "when X emails me" rules. */
  mailAlerts?: MailAlerts;
  /** The agent's own email address; set when agent email is configured. */
  mail?: { address(owner: string): Promise<string | undefined> };
  /** Lets tests stand in for the Anthropic API when designing avatars. */
  avatarFetcher?: typeof fetch;
  /** Web search for current information; set when a search provider is configured. */
  search?: WebSearch;
  /** Purchase guardrails for connected-app actions. */
  spending?: { check(owner: string, amount?: number): Promise<string | undefined> };
  /** Phone and browser notifications; set when web push is available. */
  push?: {
    notify(owner: string, message: { title: string; body: string; tag?: string }): Promise<void>;
  };
  async notify(
    owner: string,
    title: string,
    body: string,
    taskId?: string,
    key?: string,
    extra: Pick<AgentNotification, "reminderId"> = {},
  ) {
    const value: AgentNotification = {
      id: key ? hash(key) : randomUUID(),
      taskId,
      ...extra,
      title,
      body,
      createdAt: date(),
      read: false,
    };
    if ((await this.db.insertIfAbsent(owner, "notifications", value)) && this.push)
      void this.push
        .notify(owner, { title, body, tag: value.id })
        .catch((error) => backgroundFailure("push notification", error));
  }
  async timeZone(owner: string) {
    const settings = await this.db.get<{ timeZone?: string }>(
      owner,
      "agent-settings",
      "preferences",
    );
    return settings?.timeZone ?? "UTC";
  }
  async setTimeZone(owner: string, raw: unknown) {
    const timeZone = timeZoneSchema.parse(raw);
    await this.db.put(owner, "agent-settings", { id: "preferences", timeZone });
    return { timeZone };
  }
  async createRoutine(owner: string, raw: unknown, idempotencyKey?: string) {
    const input = routineInputSchema.parse(raw);
    if ((await this.db.list<Routine>(owner, "routines")).length >= 30)
      throw new AppError("Remove a routine before adding more", 409);
    const timeZone = input.timeZone ?? (await this.timeZone(owner));
    const routine: Routine = {
      id: idempotencyKey ? hash(`routine:${idempotencyKey}`) : randomUUID(),
      title: input.title,
      prompt: input.prompt,
      time: input.time,
      days: input.days,
      timeZone,
      enabled: input.enabled,
      nextRunAt: nextRun({ ...input, timeZone }),
      createdAt: date(),
    };
    return (await this.db.insertIfAbsent(owner, "routines", routine)) ?? routine;
  }
  async updateRoutine(owner: string, id: string, raw: unknown) {
    const current = await this.db.get<Routine>(owner, "routines", id);
    if (!current) throw new AppError("Routine not found", 404);
    const input = routineInputSchema.parse({ ...current, ...(raw as object) });
    const timeZone = input.timeZone ?? current.timeZone;
    return this.db.put(owner, "routines", {
      ...current,
      ...input,
      timeZone,
      nextRunAt: nextRun({ ...input, timeZone }),
    } satisfies Routine);
  }
  async deleteRoutine(owner: string, id: string) {
    if (!(await this.db.take(owner, "routines", id))) throw new AppError("Routine not found", 404);
    return { ok: true };
  }
  /** Starts one run; scheduled runs pass the occurrence they claimed so a run starts once. */
  async runRoutine(owner: string, id: string, occurrence = date()) {
    const routine = await this.db.get<Routine>(owner, "routines", id);
    if (!routine) throw new AppError("Routine not found", 404);
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone: routine.timeZone,
      month: "short",
      day: "numeric",
    }).format(new Date(occurrence));
    const task = await this.createTask(
      owner,
      { kind: "agent", title: `${routine.title} · ${day}`, prompt: routinePrompt(routine) },
      `routine:${routine.id}:${occurrence}`,
    );
    await this.db.compareAndSwap<Routine>(
      owner,
      "routines",
      id,
      {},
      { lastRunAt: occurrence, lastTaskId: task.id },
    );
    return task;
  }
  /** Claims each due occurrence once (compare-and-swap on nextRunAt), then starts its run. */
  async runDueRoutines(now = Date.now()) {
    for (const { owner, value } of await this.db.scan<Routine>("routines")) {
      if (!value.enabled || Date.parse(value.nextRunAt) > now || (await this.removed(owner)))
        continue;
      const claimed = await this.db.compareAndSwap<Routine>(
        owner,
        "routines",
        value.id,
        { nextRunAt: value.nextRunAt },
        { nextRunAt: nextRun(value, now) },
      );
      // A run missed by more than a day (server down) is skipped rather than replayed.
      if (!claimed || now - Date.parse(value.nextRunAt) > 24 * 60 * 60 * 1000) continue;
      await this.runRoutine(owner, value.id, value.nextRunAt).catch((error) =>
        backgroundFailure("routine run", error),
      );
    }
  }
  /** Saves a fact the agent noticed for the person to keep or dismiss; never used until kept. */
  async suggestMemory(
    owner: string,
    raw: unknown,
    source: string,
    options: { quiet?: boolean } = {},
  ) {
    const input = memorySuggestionSchema.parse(raw);
    const normal = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
    const memories = await this.db.list<AgentMemory>(owner, "memories");
    if (memories.some((m) => normal(m.text) === normal(input.text)))
      return { status: "already_remembered" };
    const id = hash(`memory-suggestion:${normal(input.text)}`);
    const suggestion: MemorySuggestion = {
      id,
      text: input.text,
      reason: input.reason,
      source,
      createdAt: date(),
      status: "pending",
    };
    const saved = await this.db.insertIfAbsent(owner, "memory-suggestions", suggestion);
    if (saved && !options.quiet)
      await this.notify(owner, "Something to remember?", input.text, undefined, `memory:${id}`);
    return { status: saved ? "suggested" : "already_suggested", id };
  }
  async decideMemory(owner: string, id: string, action: "keep" | "dismiss", text?: string) {
    const suggestion = await this.db.compareAndSwap<MemorySuggestion>(
      owner,
      "memory-suggestions",
      id,
      { status: "pending" },
      { status: action === "keep" ? "kept" : "dismissed" },
    );
    if (!suggestion) throw new AppError("This suggestion was already handled", 409);
    if (action === "keep")
      await this.db.put(owner, "memories", {
        id: randomUUID(),
        text: text?.trim() || suggestion.text,
        source: `Suggested from ${suggestion.source}`,
        createdAt: date(),
      } satisfies AgentMemory);
    return suggestion;
  }
  /** Kept memories for prompts, newest first and bounded. */
  async memoryContext(owner: string) {
    const memories = await this.db.list<AgentMemory>(owner, "memories");
    const texts: string[] = [];
    let size = 0;
    for (const memory of memories.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      size += memory.text.length;
      if (size > 6000) break;
      texts.push(memory.text);
    }
    return texts;
  }
  mailEvidence(mail: Mail): Evidence {
    return { id: mail.id, kind: "mail", title: mail.subject, excerpt: mail.body.slice(0, 400) };
  }
  async artifact(
    owner: string,
    task: AgentTask,
    kind: AgentArtifact["kind"],
    title: string,
    summary: string,
    data: Record<string, unknown>,
    key: string = kind,
  ) {
    const value: AgentArtifact = {
      id: hash(`${task.id}:${key}`),
      taskId: task.id,
      kind,
      title,
      summary,
      data,
      createdAt: date(),
    };
    await this.db.put(owner, "agent-artifacts", value);
    return value;
  }
  async prepare(
    owner: string,
    task: AgentTask,
    input: ProposalInput,
    key: string,
    context: TaskContext,
  ) {
    await context.guard();
    if (usesGoogle(input.kind)) {
      const connection = await this.workspace.connection(owner);
      if (connection?.id !== task.state.connectionId)
        throw new AppError(
          "Google connection changed during this task. Start a new task using the current account.",
          409,
        );
    }
    const proposal = await this.actions.propose(owner, input, `${task.id}:${key}`, task.id);
    if (proposal.status === "succeeded") return proposal;
    if (proposal.status !== "awaiting_review" && proposal.status !== "executing")
      throw new AppError(
        `Reviewed action ${proposal.status}: ${proposal.error ?? "No further action was taken"}`,
        409,
      );
    try {
      await context.checkpoint({ actionId: proposal.id });
    } catch (error) {
      if (proposal.status === "awaiting_review")
        await this.actions.decide(owner, proposal.id, proposal.hash, "deny");
      throw error;
    }
    if (proposal.status === "awaiting_review")
      await context.event(
        "approval",
        proposal.title,
        `Review prepared for ${proposal.account ?? "the connected account"}`,
      );
    return proposal;
  }
  private async execute(
    owner: string,
    task: AgentTask,
    context: TaskContext,
  ): Promise<Partial<AgentTask>> {
    await context.event(
      "status",
      task.attempts === 1 ? "Started working" : "Resumed work",
      task.prompt,
    );
    if (task.actionId) {
      const action = await this.db.get<ActionProposal>(owner, "actions", task.actionId);
      if (!action) throw new Error("The linked review could not be found");
      if (action.status === "succeeded") {
        await context.event("result", "Approved action completed", action.result);
        if (task.kind === "document")
          return this.finish(task, context, action.result ?? "Reply completed");
        task = await context.checkpoint({
          state: { ...task.state, approvalResult: action.result },
          actionId: null,
        });
      } else if (action.status !== "awaiting_review" && action.status !== "executing")
        throw new Error(
          `Reviewed action ${action.status}: ${action.error ?? "No further action was taken"}`,
        );
      else return { status: "waiting_approval" };
    }
    if (task.kind === "document") return this.document(owner, task, context);
    if (task.kind === "monitor") {
      try {
        return await this.observe(owner, task, context);
      } catch (error) {
        if (error instanceof LostLeaseError || context.signal.aborted) throw error;
        await context.guard();
        const failures = Number(task.state.failures ?? 0) + 1;
        // Each streak of failures (after a success or a resume) gets its own alerts.
        const failureStreak = Number(task.state.failureStreak ?? 0) + (failures === 1 ? 1 : 0);
        const detail = error instanceof Error ? error.message : "Page check failed";
        const nextCheckAt = new Date(
          Date.now() + Math.min(60, 2 ** failures) * 60000,
        ).toISOString();
        await this.db.compareAndSwap(
          owner,
          "monitors",
          String(task.input.monitorId),
          { status: "active" },
          { error: detail, nextCheckAt },
        );
        await context.event(
          "error",
          failures >= 5 ? "Watch paused after repeated failures" : "Check failed; retry scheduled",
          detail,
        );
        return {
          status: failures >= 5 ? "paused" : "scheduled",
          error: detail,
          nextRunAt: nextCheckAt,
          state: {
            ...task.state,
            failures,
            resumingMonitor: false,
            failureStreak,
            notice: {
              title: "Watch needs attention",
              body: detail,
              key: `watch-error:${task.id}:${failureStreak}:${failures >= 5 ? "paused" : "retry"}`,
            },
          },
        };
      }
    }
    if (task.kind === "finance") {
      await context.event("step", "Analyzing the imported transactions");
      const csv = z.string().parse(task.input.csv);
      const data = analyzeSpending(csv);
      const artifact = await this.artifact(
        owner,
        task,
        "finance",
        "Spending tracker",
        `${data.count} transactions · ${data.spending.toFixed(2)} spent`,
        data,
      );
      task = await context.checkpoint({
        artifactIds: [artifact.id],
        evidence: [
          {
            id: task.id,
            kind: "user",
            title: "Your transaction CSV",
            excerpt: `${data.count} rows; ${data.period.from} through ${data.period.to}`,
          },
        ],
      });
      return this.finish(task, context, artifact.summary);
    }
    return executeModelTask(this, owner, task, context);
  }
  async finish(task: AgentTask, context: TaskContext, result: string) {
    await context.guard();
    await context.event("result", "Work completed", result);
    return {
      status: "succeeded" as const,
      result,
      plan: task.plan.map((s) => ({ ...s, status: "succeeded" as const })),
    };
  }
  private async publishOutcome(owner: string, saved: AgentTask) {
    const task = await this.getTask(owner, saved.id);
    if (task.status === "succeeded") {
      await this.notify(
        owner,
        task.title,
        task.result ?? "Work completed",
        task.id,
        `task-done:${task.id}`,
      );
      if (task.goalId) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const goal = await this.db.get<Goal>(owner, "goals", task.goalId);
          if (!goal || goal.milestones.some((m) => m.id === task.id)) break;
          if (
            await this.db.compareAndSwap(
              owner,
              "goals",
              goal.id,
              { milestones: goal.milestones },
              {
                milestones: [...goal.milestones, { id: task.id, title: task.title, done: true }],
              },
            )
          )
            break;
        }
      }
    } else if (task.status === "failed") {
      await this.notify(
        owner,
        "Task needs attention",
        task.error ?? task.title,
        task.id,
        `task-error:${task.id}:${task.attempts}`,
      );
    } else if (task.status === "waiting_input") {
      await this.notify(
        owner,
        "Your details are needed",
        task.question ?? task.title,
        task.id,
        `input:${task.id}:${hash(task.question ?? "")}`,
      );
    } else if (task.status === "waiting_approval") {
      await this.notify(
        owner,
        "Ready for your review",
        task.title,
        task.id,
        `review:${task.actionId}`,
      );
    }
    const notice = z
      .object({ title: z.string(), body: z.string(), key: z.string() })
      .safeParse(task.state.notice);
    if ((task.status === "scheduled" || (task.status === "paused" && task.error)) && notice.success)
      await this.notify(owner, notice.data.title, notice.data.body, task.id, notice.data.key);
    // A watch pauses after repeated failures only once that task outcome has committed.
    if (task.kind === "monitor" && task.status === "paused" && task.error)
      await this.db.compareAndSwap(
        owner,
        "monitors",
        String(task.input.monitorId),
        { status: "active", error: task.error },
        { status: "paused" },
      );
  }
  private async document(
    owner: string,
    task: AgentTask,
    ctx: TaskContext,
  ): Promise<Partial<AgentTask>> {
    let source = task.state.source as { mail: Mail; fileId: string } | undefined;
    if (!source) {
      const w = await this.workspace.snapshot(owner);
      const mail = w.mail.find((m) => m.id === task.input.messageId);
      if (!mail) throw new Error("Choose a current email with a PDF attachment to start this task");
      const ref = mail.attachments[0];
      if (!ref) throw new Error("This email has no PDF attachment");
      await ctx.guard();
      let file: Artifact;
      try {
        file = await this.files.get(owner, ref);
      } catch (error) {
        if (!(error instanceof AppError && error.status === 404)) throw error;
        file = await this.workspace.importAttachment(owner, ref);
      }
      source = { mail, fileId: file.id };
      task = await ctx.checkpoint({
        state: { ...task.state, source },
        evidence: [this.mailEvidence(mail)],
        plan: task.plan.map((s, i) => ({ ...s, status: i === 0 ? "succeeded" : "pending" })),
      });
      await ctx.event("step", "Found the document", file.name);
    }
    const fields = z
      .record(z.string(), z.union([z.string(), z.boolean()]))
      .optional()
      .parse(task.input.fields);
    if (!fields || !Object.keys(fields).length) {
      const file = await this.files.get(owner, source.fileId);
      const names = file.fields
        ?.filter((f) => f.type !== "unsupported")
        .map((f) => f.name)
        .join(", ");
      if (!names)
        throw new Error(
          "This PDF has no supported fillable fields. Open it in Files to review it.",
        );
      return {
        status: "waiting_input",
        question: `Enter the form values you want to use. Supported fields: ${names}. The original PDF will stay intact.`,
        state: {
          ...task.state,
          source,
          missingFields: file.fields?.filter((f) => f.type !== "unsupported"),
        },
      };
    }
    let filledId = typeof task.state.filledId === "string" ? task.state.filledId : undefined;
    if (!filledId) {
      await ctx.guard();
      const filled = await this.files.fill(owner, source.fileId, fields);
      filledId = filled.id;
      task = await ctx.checkpoint({
        state: { ...task.state, source, filledId },
        artifactIds: [filledId],
        plan: task.plan.map((s, i) => ({ ...s, status: i <= 1 ? "succeeded" : "pending" })),
      });
      await ctx.event("step", "Saved a filled copy", filled.name);
    }
    const input: ProposalInput = {
      kind: "email.send",
      data: {
        to: [source.mail.from],
        cc: [],
        bcc: [],
        subject: /^re:/i.test(source.mail.subject)
          ? source.mail.subject
          : `Re: ${source.mail.subject}`,
        body:
          typeof task.input.reply === "string"
            ? task.input.reply
            : "Hello,\n\nPlease find the completed form attached.\n\nThank you.",
        attachmentIds: [filledId],
        threadId: source.mail.threadId,
        replyToMessageId: source.mail.id,
      },
    };
    const proposal = await this.prepare(owner, task, input, "document-reply", ctx);
    return {
      status: "waiting_approval",
      actionId: proposal.id,
      plan: task.plan.map((s, i) => ({
        ...s,
        status: i < 3 ? "succeeded" : i === 3 ? "waiting" : "pending",
      })),
    };
  }
  private async observe(
    owner: string,
    task: AgentTask,
    ctx: TaskContext,
  ): Promise<Partial<AgentTask>> {
    const monitor = await this.db.get<Monitor>(owner, "monitors", String(task.input.monitorId));
    // A watch without its page record can never run; stop instead of retrying.
    if (!monitor)
      return {
        status: "failed",
        error:
          "This watch has no web page to check. For a recurring check of email or apps, ask for a routine.",
      };
    if (monitor.status !== "active")
      return { status: monitor.status === "paused" ? "paused" : "cancelled" };
    let observation: { url: string; title: string; text: string; sessionId?: string };
    if (monitor.url === "sample://availability") {
      if (this.config.mode !== "sample") throw new Error("Sample source unavailable");
      const page = await this.db.get<{ text: string }>(owner, "sample-pages", "availability");
      observation = {
        url: monitor.url,
        title: "Sample dinner availability",
        text: page?.text ?? "No tables available. Check again later.",
      };
    } else {
      await ctx.guard();
      observation = await this.browser.observe(
        owner,
        monitor.url,
        typeof task.state.sessionId === "string" ? task.state.sessionId : undefined,
      );
    }
    const text = observation.text.replace(/\s+/g, " ").trim();
    const currentHash = hash(text);
    const previousHash =
      typeof task.state.lastHash === "string" ? task.state.lastHash : monitor.lastHash;
    const matched =
      monitor.condition === "change"
        ? Boolean(previousHash && previousHash !== currentHash)
        : monitor.condition === "contains"
          ? text.toLowerCase().includes(monitor.value.toLowerCase())
          : this.matchesPrice(text, Number(monitor.value));
    const previouslyMatched = Boolean(task.state.matched);
    const shouldNotify = matched && (monitor.condition === "change" || !previouslyMatched);
    const nextCheckAt = new Date(Date.now() + monitor.intervalMinutes * 60000).toISOString();
    await ctx.guard();
    // Worker lease is checked before each publication; monitor control also invalidates that lease.
    const savedMonitor = await this.db.compareAndSwap(
      owner,
      "monitors",
      monitor.id,
      { status: "active" },
      {
        checks: monitor.checks + 1,
        lastCheckedAt: date(),
        lastHash: currentHash,
        lastValue: text.slice(0, 1000),
        nextCheckAt,
        error: null,
      },
    );
    if (!savedMonitor) throw new LostLeaseError();
    await ctx.event(
      "observation",
      previousHash ? "Checked for changes" : "Saved the first observation",
      text.slice(0, 1000),
    );
    if (shouldNotify) {
      await ctx.guard();
      await ctx.event("result", "A meaningful change was found", text.slice(0, 500));
    }
    return {
      status: "scheduled",
      nextRunAt: nextCheckAt,
      result: shouldNotify
        ? "Change found. A notification is ready."
        : "Watching. I'll check again on schedule.",
      state: {
        ...task.state,
        sessionId: observation.sessionId,
        lastHash: currentHash,
        resumingMonitor: false,
        matched,
        failures: 0,
        notice: shouldNotify
          ? {
              title: monitor.title,
              body: `Condition met at ${observation.url}: ${text.slice(0, 240)}`,
              key: `monitor:${monitor.id}:${currentHash}`,
            }
          : null,
      },
      error: null,
      evidence: [
        {
          id: monitor.id,
          kind: "web",
          title: observation.title,
          url: observation.url,
          excerpt: text.slice(0, 600),
        },
      ],
      plan: task.plan.map((s) => ({ ...s, status: "succeeded" })),
    };
  }
  private matchesPrice(text: string, threshold: number) {
    const matches = [...text.matchAll(/(?:\$|USD\s*)(\d+(?:,\d{3})*(?:\.\d{1,2})?)/g)];
    return matches.some((m) => Number(m[1].replace(/,/g, "")) < threshold);
  }
}
