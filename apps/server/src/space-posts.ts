import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { type ScheduledPost, SOCIAL_APPS } from "../../../packages/domain/src/spaces.ts";
import type { AppConnector } from "./apps.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { isPurchase } from "./spending.ts";

/** A post can be queued up to this far ahead. */
const MAX_AHEAD_MS = 60 * 86_400_000;
/** A post whose time passed longer ago than this (the server was down) waits for the person. */
const MISSED_MS = 12 * 3_600_000;

export const schedulePostSchema = z.object({
  tool: z.string().trim().min(3).max(120),
  arguments: z.record(z.string(), z.unknown()),
  summary: z.string().trim().min(1).max(600),
  postAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Give a date and time"),
});

/** "instagram" → "Instagram", "metaads" → "Metaads": the app as people read it. */
const named = (app: string) => app.charAt(0).toUpperCase() + app.slice(1);

const hashOf = (post: Pick<ScheduledPost, "tool" | "arguments" | "postAt">) =>
  createHash("sha256")
    .update(JSON.stringify({ tool: post.tool, arguments: post.arguments, postAt: post.postAt }))
    .digest("hex");

/**
 * The app's own scheduler, for people without one such as Postiz: the agent queues a post (a
 * connected app's action and its exact arguments, plus a time), the person approves it ahead of
 * time, and it's published at its time through the same connected app. Approval covers that
 * exact post: nothing about it can change afterwards.
 */
export class ScheduledPosts {
  constructor(
    private readonly db: Store,
    private readonly apps: Pick<AppConnector, "tool" | "execute"> | undefined,
    private readonly notify: (
      owner: string,
      title: string,
      body: string,
      key: string,
    ) => Promise<unknown>,
    private readonly now: () => number = Date.now,
  ) {}
  async list(owner: string, spaceId?: string) {
    return (await this.db.list<ScheduledPost>(owner, "space-posts"))
      .filter((post) => !spaceId || post.spaceId === spaceId)
      .sort((a, b) => a.postAt.localeCompare(b.postAt));
  }
  /** Queues a post for the person's approval. Only social apps' actions, never a purchase. */
  async propose(owner: string, spaceId: string, raw: unknown) {
    if (!this.apps) throw new AppError("Connected apps are not configured on this server", 409);
    const input = schedulePostSchema.parse(raw);
    const tool = await this.apps.tool(owner, input.tool);
    if (!SOCIAL_APPS.test(tool.app))
      throw new AppError(`Only social media posts can be scheduled here, not ${tool.app}.`, 400);
    if (tool.readOnly || tool.destructive || isPurchase(tool.slug))
      throw new AppError(`${tool.slug} isn't a post, so it can't be scheduled.`, 400);
    const at = Date.parse(input.postAt);
    if (at < this.now() + 60_000)
      throw new AppError("Pick a time at least a minute from now.", 400);
    if (at > this.now() + MAX_AHEAD_MS)
      throw new AppError("Posts can be scheduled up to 60 days ahead.", 400);
    const post: ScheduledPost = {
      id: randomUUID(),
      spaceId,
      app: tool.app,
      tool: tool.slug,
      arguments: input.arguments,
      summary: input.summary,
      postAt: new Date(at).toISOString(),
      status: "awaiting_review",
      hash: "",
      createdAt: new Date(this.now()).toISOString(),
    };
    post.hash = hashOf(post);
    return this.db.put(owner, "space-posts", post);
  }
  /** The person's OK for this exact post; one whose time has passed goes out on the next check. */
  async approve(owner: string, id: string, hash: unknown) {
    const post = await this.get(owner, id);
    if (post.hash !== hash)
      throw new AppError("This post changed. Look at it again before approving.", 409);
    const approved = await this.db.compareAndSwap<ScheduledPost>(
      owner,
      "space-posts",
      id,
      { status: "awaiting_review", hash: post.hash },
      { status: "scheduled", decidedAt: new Date(this.now()).toISOString() },
    );
    if (!approved) return this.get(owner, id);
    return approved;
  }
  /** Takes a post off the queue before it goes out. */
  async cancel(owner: string, id: string) {
    const post = await this.get(owner, id);
    if (post.status !== "awaiting_review" && post.status !== "scheduled") return post;
    return (
      (await this.db.compareAndSwap<ScheduledPost>(
        owner,
        "space-posts",
        id,
        { status: post.status },
        { status: "cancelled", decidedAt: new Date(this.now()).toISOString() },
      )) ?? this.get(owner, id)
    );
  }
  /** Everything still queued for a space, taken off when the space is removed. */
  async cancelSpace(owner: string, spaceId: string) {
    for (const post of await this.list(owner, spaceId)) await this.cancel(owner, post.id);
  }
  /** Publishes approved posts whose time has come; one copy of the server claims each. */
  async publishDue(skip: (owner: string) => Promise<boolean> = async () => false) {
    const now = this.now();
    for (const { owner, value } of await this.db.scan<ScheduledPost>("space-posts")) {
      if (value.status !== "scheduled" || Date.parse(value.postAt) > now) continue;
      if (await skip(owner)) continue;
      const late = now - Date.parse(value.postAt) > MISSED_MS;
      const claimed = await this.db.compareAndSwap<ScheduledPost>(
        owner,
        "space-posts",
        value.id,
        { status: "scheduled" },
        late
          ? { status: "failed", error: "It missed its time; ask for a new time." }
          : { status: "posting" },
      );
      if (!claimed) continue;
      if (late) {
        await this.notify(
          owner,
          `A post to ${named(value.app)} missed its time`,
          `“${value.summary.slice(0, 120)}” didn’t go out. Pick a new time in the space.`,
          `space-post:${value.id}`,
        );
        continue;
      }
      await this.publish(owner, claimed);
    }
  }
  private async publish(owner: string, post: ScheduledPost) {
    try {
      if (!this.apps) throw new Error("Connected apps are not configured on this server");
      const data = await this.apps.execute(owner, post.tool, post.arguments);
      const detail = data === undefined ? "" : JSON.stringify(data).slice(0, 300);
      await this.db.put(owner, "space-posts", {
        ...post,
        status: "posted",
        postedAt: new Date(this.now()).toISOString(),
        result: detail,
      } satisfies ScheduledPost);
      await this.notify(
        owner,
        `Posted to ${named(post.app)}`,
        post.summary.slice(0, 200),
        `space-post:${post.id}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db.put(owner, "space-posts", {
        ...post,
        status: "failed",
        error: message.slice(0, 600),
      } satisfies ScheduledPost);
      await this.notify(
        owner,
        `Couldn’t post to ${named(post.app)}`,
        `“${post.summary.slice(0, 120)}”: ${message.slice(0, 200)}`,
        `space-post:${post.id}`,
      );
    }
  }
  private async get(owner: string, id: string) {
    const post = await this.db.get<ScheduledPost>(owner, "space-posts", id);
    if (!post) throw new AppError("Post not found", 404);
    return post;
  }
}
