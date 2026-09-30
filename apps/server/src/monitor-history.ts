import type { Monitor, RunEvent } from "../../../packages/domain/src/agent.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/**
 * A watched page's recent checks, for its chart and "Recent checks" table. Each check the worker
 * runs is saved as an observation event on the watch's task (the page's text, up to 1,000
 * characters); this reads back the last few and keeps only a short excerpt of each, so the answer
 * stays small however long the watch runs.
 */

/** How many checks the history shows. */
export const CHECKS_KEPT = 60;
/** Enough of what the page said to recognise it. */
const EXCERPT = 160;

export interface MonitorCheck {
  at: string;
  /** The start of what the page said. */
  value: string;
  /** A price watch: the lowest price on the page, in dollars. */
  price?: number;
  /** A change or text watch: whether the page changed since the check before. */
  changed?: boolean;
  /** A text watch: whether the text was on the page. */
  found?: boolean;
}

/** The lowest dollar price on a page ("$1,299.00", "USD 45"), as the price watch reads prices. */
export function lowestPrice(text: string) {
  const prices = [...text.matchAll(/(?:\$|USD\s*)(\d+(?:,\d{3})*(?:\.\d{1,2})?)/g)]
    .map((m) => Number((m[1] ?? "").replace(/,/g, "")))
    .filter((price) => Number.isFinite(price) && price > 0);
  return prices.length ? Math.min(...prices) : undefined;
}

/** What each of `observations` (oldest first) saw, with `results` marking the checks that alerted. */
export function checksFrom(
  monitor: Pick<Monitor, "condition" | "value">,
  observations: Pick<RunEvent, "date" | "detail" | "title">[],
  results: Pick<RunEvent, "date">[] = [],
): MonitorCheck[] {
  return observations.map((seen, i) => {
    const text = seen.detail;
    const check: MonitorCheck = { at: seen.date, value: text.slice(0, EXCERPT) };
    if (monitor.condition === "price_below") {
      const price = lowestPrice(text);
      if (price !== undefined) check.price = price;
      return check;
    }
    if (monitor.condition === "contains")
      check.found = text.toLowerCase().includes(monitor.value.trim().toLowerCase());
    // The very first look has nothing to compare with.
    if (seen.title.startsWith("Saved the first")) return check;
    const before = observations[i - 1];
    const next = observations[i + 1];
    // A change watch alerts on every change, so its alerts say exactly which checks saw one.
    check.changed =
      monitor.condition === "change"
        ? results.some((r) => r.date >= seen.date && (!next || r.date < next.date))
        : !!before && before.detail !== text;
    return check;
  });
}

/** A watch's last checks, oldest first. */
export async function monitorChecks(db: Store, owner: string, monitorId: string) {
  const monitor = await db.get<Monitor>(owner, "monitors", monitorId);
  if (!monitor) throw new AppError("Watch not found", 404);
  const events = (kind: RunEvent["kind"]) =>
    db.listWhere<RunEvent>(owner, "run-events", { taskId: monitor.taskId, kind }, CHECKS_KEPT + 1);
  const [observations, results] = await Promise.all([
    events("observation"),
    monitor.condition === "change" ? events("result") : [],
  ]);
  // One more than is shown, so the oldest shown can say whether it changed.
  return checksFrom(monitor, observations.reverse(), results).slice(-CHECKS_KEPT);
}
