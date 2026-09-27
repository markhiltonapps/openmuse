import { createHash } from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import type { UsageSink } from "./usage.ts";
import type { SearchSource, WebSearch } from "./web-search.ts";

export const feedTopicsSchema = z.object({
  topics: z.array(z.string().trim().min(2).max(80)).max(8),
});
interface FeedSettings {
  id: "feed";
  topics: string[];
  /** The person's local date of the last full refresh. */
  refreshedOn?: string;
  refreshedAt?: string;
}
export interface FeedItem {
  id: string;
  topic: string;
  summary: string;
  sources: SearchSource[];
  day: string;
  createdAt: string;
}
const KEEP_DAYS = 7;
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

/** The local date and hour for a time zone. */
function local(now: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(now))
      .map((part) => [part.type, part.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/**
 * The Feed: what's new on the topics a person follows, searched once each morning (after 6 am
 * in their time zone) and on request.
 */
export class FeedService {
  private refreshing = new Set<string>();
  /** Where each person's search usage is recorded. */
  usage?: (owner: string) => UsageSink;
  constructor(
    private readonly db: Store,
    private readonly search: WebSearch | undefined,
    private readonly timeZone: (owner: string) => Promise<string>,
    private readonly now: () => number = Date.now,
  ) {}
  private async settings(owner: string): Promise<FeedSettings> {
    return (
      (await this.db.get<FeedSettings>(owner, "agent-settings", "feed")) ?? {
        id: "feed",
        topics: [],
      }
    );
  }
  async get(owner: string) {
    const settings = await this.settings(owner);
    const items = (await this.db.list<FeedItem>(owner, "feed-items")).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    return {
      topics: settings.topics,
      refreshedAt: settings.refreshedAt,
      searchAvailable: Boolean(this.search),
      refreshing: this.refreshing.has(owner),
      items,
    };
  }
  async setTopics(owner: string, raw: unknown) {
    const topics = [...new Set(feedTopicsSchema.parse(raw).topics)];
    const before = await this.settings(owner);
    await this.db.put(owner, "agent-settings", { ...before, topics });
    const added = topics.filter((topic) => !before.topics.includes(topic));
    if (added.length) void this.refresh(owner, added).catch(() => undefined);
    return this.get(owner);
  }
  /** Refreshes on request, at most every ten minutes. */
  async refreshNow(owner: string) {
    if (!this.search) throw new AppError("The Feed needs web search, which isn't set up", 409);
    const { refreshedAt, topics } = await this.settings(owner);
    if (!topics.length) throw new AppError("Add a topic to follow first", 409);
    if (refreshedAt && this.now() - Date.parse(refreshedAt) < 10 * 60 * 1000)
      throw new AppError("The Feed was refreshed a few minutes ago", 429);
    void this.refresh(owner).catch(() => undefined);
    return this.get(owner);
  }
  /** Searches each topic and saves one item per topic per day. */
  async refresh(owner: string, only?: string[]) {
    if (!this.search || this.refreshing.has(owner)) return;
    this.refreshing.add(owner);
    try {
      const settings = await this.settings(owner);
      const { day } = local(this.now(), await this.timeZone(owner));
      for (const topic of only ?? settings.topics) {
        const found = await this.search
          .search(
            `What's new about ${topic}? The most important news and developments from the past few days.`,
            this.usage?.(owner),
          )
          .catch(() => undefined);
        if (!found || found.answer === "No results found.") continue;
        await this.db.put(owner, "feed-items", {
          id: hash(`${day}:${topic.toLowerCase()}`),
          topic,
          summary: found.answer,
          sources: found.sources.slice(0, 4),
          day,
          createdAt: new Date(this.now()).toISOString(),
        } satisfies FeedItem);
      }
      const latest = await this.settings(owner);
      await this.db.put(owner, "agent-settings", {
        ...latest,
        ...(only ? {} : { refreshedOn: day }),
        refreshedAt: new Date(this.now()).toISOString(),
      });
      const cutoff = this.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
      for (const item of await this.db.list<FeedItem>(owner, "feed-items"))
        if (Date.parse(item.createdAt) < cutoff) await this.db.remove(owner, "feed-items", item.id);
    } finally {
      this.refreshing.delete(owner);
    }
  }
  /** Called from the agent's maintenance loop: each person's first refresh of their day. */
  async refreshDue() {
    if (!this.search) return;
    for (const { owner, value } of await this.db.scan<FeedSettings & { id: string }>(
      "agent-settings",
    )) {
      if (value.id !== "feed" || !value.topics?.length) continue;
      const account = await this.db.get<{ status: string }>("system", "accounts", owner);
      if (account?.status === "disabled") continue;
      const { day, hour } = local(this.now(), await this.timeZone(owner));
      if (value.refreshedOn !== day && hour >= 6) await this.refresh(owner);
    }
  }
}
