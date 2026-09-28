import { createHash } from "node:crypto";
import { z } from "zod";
import type { SearchPlace } from "./area.ts";
import type { Store } from "./db.ts";
import { hasEmojiPicture } from "./emoji.ts";
import { AppError } from "./errors.ts";
import { previewImage } from "./link-preview.ts";
import type { UsageSink } from "./usage.ts";
import type { SearchSource, Story, WebSearch } from "./web-search.ts";

export const feedTopicsSchema = z.object({
  topics: z.array(z.string().trim().min(2).max(80)).max(8),
});
/** Items saved before the Feed told news as stories are fetched again once. */
const FORMAT = 2;
interface FeedSettings {
  id: "feed";
  topics: string[];
  /** The person's local date of the last full refresh. */
  refreshedOn?: string;
  refreshedAt?: string;
  format?: number;
  /** Headlines the person gave a thumbs up or down, newest first, to steer later stories. */
  liked?: string[];
  disliked?: string[];
}
export interface FeedStory extends Story {
  /** The article's share picture, when it has one. */
  image?: string;
  feedback?: "up" | "down";
}
export const feedFeedbackSchema = z.object({
  itemId: z.string().min(1).max(100),
  headline: z.string().min(1).max(200),
  feedback: z.enum(["up", "down"]).nullable(),
});
const TASTE = 15;
export interface FeedItem {
  id: string;
  topic: string;
  summary: string;
  sources: SearchSource[];
  /** The news as separate stories with headlines and pictures; older items have only a summary. */
  stories?: FeedStory[];
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
  /** Where the person lives, so local topics are about their area. */
  where?: (owner: string) => Promise<SearchPlace | undefined>;
  /** Finds an article's share picture. */
  preview: (url: string) => Promise<string | undefined> = (url) => previewImage(url);
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
    const where = await this.where?.(owner).catch(() => undefined);
    return {
      topics: settings.topics,
      area: where?.label,
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
        const item = await this.lookUp(owner, topic).catch(() => undefined);
        if (!item) continue;
        await this.db.put(owner, "feed-items", {
          id: hash(`${day}:${topic.toLowerCase()}`),
          topic,
          ...item,
          day,
          createdAt: new Date(this.now()).toISOString(),
        } satisfies FeedItem);
      }
      const latest = await this.settings(owner);
      await this.db.put(owner, "agent-settings", {
        ...latest,
        ...(only ? {} : { refreshedOn: day, format: FORMAT }),
        refreshedAt: new Date(this.now()).toISOString(),
      });
      const cutoff = this.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
      for (const item of await this.db.list<FeedItem>(owner, "feed-items"))
        if (Date.parse(item.createdAt) < cutoff) await this.db.remove(owner, "feed-items", item.id);
    } finally {
      this.refreshing.delete(owner);
    }
  }
  /** What's new on one topic: stories with pictures when the search can tell them apart. */
  private async lookUp(owner: string, topic: string) {
    const search = this.search;
    if (!search) return undefined;
    const where = await this.where?.(owner).catch(() => undefined);
    if (search.stories) {
      const settings = await this.settings(owner);
      const found = await search.stories(
        topic,
        this.usage?.(owner),
        { liked: settings.liked ?? [], disliked: settings.disliked ?? [] },
        where,
      );
      if (found.stories.length) {
        const stories = await Promise.all(
          found.stories.map(async (story) => {
            const image = await this.picture(story);
            return {
              ...story,
              emoji: hasEmojiPicture(story.emoji) ? story.emoji : "📰",
              ...(image ? { image } : {}),
            } satisfies FeedStory;
          }),
        );
        return {
          stories,
          summary: stories.map((story) => `**${story.headline}** ${story.summary}`).join("\n\n"),
          sources: found.sources.slice(0, 4),
        };
      }
      console.warn(`[OpenMuse] Feed stories for a topic couldn't be read; using a summary`);
    }
    const found = await search.search(
      `What's new about ${topic}? The most important news and developments from the past few days.`,
      this.usage?.(owner),
      "web",
      where,
    );
    if (found.answer === "No results found.") return undefined;
    // Never a wall of text: the first real paragraph, as one story.
    const paragraph =
      found.answer
        .replace(/\*\*[^*\n]+:\*\*/g, "\n")
        .split(/\n+/)
        .map((line) => line.replace(/[#*]/g, "").trim())
        .find((line) => line.length >= 60 && !/:$/.test(line) && !/^I'll search/i.test(line)) ??
      found.answer.slice(0, 400);
    const short =
      paragraph.length <= 400 ? paragraph : `${paragraph.slice(0, 400).replace(/\s+\S*$/, "")}…`;
    return {
      stories: [
        {
          emoji: "📰",
          headline: topic,
          summary: short,
          ...(found.sources[0] ? { url: found.sources[0].url } : {}),
        },
      ],
      summary: found.answer,
      sources: found.sources.slice(0, 4),
    };
  }
  /** The story's own picture, or one from an article its summary links to. */
  private async picture(story: Story) {
    const pages = [
      story.url,
      ...[...story.summary.matchAll(/\]\((https:[^)\s]+)\)/g)].map((match) => match[1]),
    ].filter((url, index, all): url is string => Boolean(url) && all.indexOf(url) === index);
    for (const page of pages.slice(0, 3)) {
      const image = await this.preview(page).catch(() => undefined);
      if (image) return image;
    }
    return undefined;
  }
  /** A thumbs up or down on a story: remembered on the story and used for later ones. */
  async feedback(owner: string, raw: unknown) {
    const { itemId, headline, feedback } = feedFeedbackSchema.parse(raw);
    const item = await this.db.get<FeedItem>(owner, "feed-items", itemId);
    const story = item?.stories?.find((s) => s.headline === headline);
    if (!item || !story) throw new AppError("Story not found", 404);
    if (feedback) story.feedback = feedback;
    else delete story.feedback;
    await this.db.put(owner, "feed-items", item);
    const settings = await this.settings(owner);
    const line = `${headline} (${item.topic})`;
    const without = (list?: string[]) => (list ?? []).filter((entry) => entry !== line);
    settings.liked = without(settings.liked);
    settings.disliked = without(settings.disliked);
    if (feedback === "up") settings.liked = [line, ...settings.liked].slice(0, TASTE);
    if (feedback === "down") settings.disliked = [line, ...settings.disliked].slice(0, TASTE);
    await this.db.put(owner, "agent-settings", settings);
    return this.get(owner);
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
      const outdated = value.format !== FORMAT && Boolean(this.search.stories);
      if ((value.refreshedOn !== day && hour >= 6) || outdated) await this.refresh(owner);
    }
  }
}
