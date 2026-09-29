import { type SocialWeek, weekResultsSchema } from "../../../packages/domain/src/social-week.ts";
import type { Store } from "./db.ts";
import { localToday, mondayOf } from "./family-weeks.ts";

/**
 * A social media space's weekly results, one record per week, for the Results tab's chart and
 * past digests. The weekly digest saves them with save_week_results.
 */

const KIND = "social-weeks";

export class SocialWeeks {
  constructor(
    private readonly db: Store,
    private readonly now: () => Date = () => new Date(),
  ) {}
  /** Every week of one space, oldest first. */
  async all(owner: string, spaceId: string) {
    return (await this.db.list<SocialWeek>(owner, KIND))
      .filter((week) => week.spaceId === spaceId)
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  }
  /** A week's results; each part given replaces that part. */
  async save(owner: string, spaceId: string, raw: unknown, timeZone: string) {
    const input = weekResultsSchema.parse(raw);
    const today = localToday(timeZone, this.now());
    const weekStart = mondayOf(today.date, input.week === "this" ? 0 : -1);
    const id = `${spaceId}:${weekStart}`;
    const old = await this.db.get<SocialWeek>(owner, KIND, id);
    const week: SocialWeek = {
      ...(old ?? { id, spaceId, weekStart, reach: [], competitors: [], aims: [] }),
      ...(input.headline !== undefined ? { headline: input.headline } : {}),
      ...(input.best !== undefined ? { best: input.best } : {}),
      ...(input.reach ? { reach: input.reach } : {}),
      ...(input.competitors ? { competitors: input.competitors } : {}),
      ...(input.aims ? { aims: input.aims } : {}),
      savedAt: this.now().toISOString(),
    };
    await this.db.put(owner, KIND, week);
    return { weekStart, saved: true };
  }
  async removeSpace(owner: string, spaceId: string) {
    await this.db.removePrefix(owner, KIND, `${spaceId}:`);
  }
}
