import type { AgentArtifact } from "../../../packages/domain/src/agent";

/**
 * Plans & bookings, reminders and saved results as the data views show them. No React Native here,
 * so it can be tested on its own.
 */

export type CommitmentKind =
  | "reservation"
  | "delivery"
  | "trip"
  | "appointment"
  | "bill"
  | "event"
  | "other";
export interface Commitment {
  id: string;
  kind: CommitmentKind;
  title: string;
  /** When it happens, arrives or is due (an instant). */
  at?: string;
  /** The person's time zone when it was saved. */
  timeZone?: string;
  where?: string;
  reference?: string;
  link?: string;
  status: "upcoming" | "done" | "cancelled";
  /** How the server words the time, such as "Tue, Sep 29, 7:30 PM". */
  when: string;
  updatedAt?: string;
}
export const COMMITMENT_EMOJI: Record<CommitmentKind, string> = {
  reservation: "🍽️",
  delivery: "📦",
  trip: "✈️",
  appointment: "🩺",
  bill: "💳",
  event: "🎟️",
  other: "📌",
};

export interface Reminder {
  id: string;
  text: string;
  dueAt: string;
  timeZone?: string;
  status?: "upcoming" | "sent";
  sentAt?: string;
  /** How the server words the time. */
  when: string;
}

/** YYYY-MM-DD for an instant in a time zone (the device's when there's none). */
export function dayIn(date: Date, timeZone?: string) {
  const parts = (zone?: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
  let found: Intl.DateTimeFormatPart[];
  try {
    found = parts(timeZone);
  } catch {
    found = parts();
  }
  const part = (type: string) => found.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * "Tue, Sep 29" and "7:30 PM" in the time zone it was saved in, so it reads as the Feed and the
 * agent say it; the year joins the day when it isn't this year.
 */
export function localWhen(iso: string | undefined, timeZone?: string, now = new Date()) {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const format = (options: Intl.DateTimeFormatOptions) => {
    try {
      return date.toLocaleString("en-US", { ...options, timeZone });
    } catch {
      return date.toLocaleString("en-US", options);
    }
  };
  const thisYear = dayIn(date, timeZone).slice(0, 4) === dayIn(now, timeZone).slice(0, 4);
  return {
    day: format({
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(thisYear ? {} : { year: "numeric" }),
    }),
    time: format({ hour: "numeric", minute: "2-digit" }),
  };
}

/** "Wed, Sep 30 · 7:30 PM" on one line, for a narrow table's line under the title. */
export function whenLine(iso: string | undefined, timeZone?: string, now = new Date()) {
  const when = localWhen(iso, timeZone, now);
  return when ? `${when.day} · ${when.time}` : "No date yet";
}

/** Upcoming soonest first (undated last); done and cancelled most recent first. */
export function splitCommitments(items: Commitment[]) {
  const time = (item: Commitment) => item.at ?? item.updatedAt ?? "";
  return {
    upcoming: items
      .filter((item) => item.status === "upcoming")
      .sort((a, b) => (a.at ?? "9999").localeCompare(b.at ?? "9999")),
    past: items
      .filter((item) => item.status !== "upcoming")
      .sort((a, b) => time(b).localeCompare(time(a))),
  };
}

/**
 * Where it stands, in a word or two: "Today", "Tomorrow", "Coming up", "Just passed" (its time has
 * gone but it isn't marked done yet), "Done" or "Cancelled".
 */
export function commitmentStatus(item: Commitment, now = new Date()) {
  if (item.status === "done") return "Done";
  if (item.status === "cancelled") return "Cancelled";
  if (!item.at) return "Coming up";
  const at = new Date(item.at);
  if (at.getTime() < now.getTime()) return "Just passed";
  const day = dayIn(at, item.timeZone);
  if (day === dayIn(now, item.timeZone)) return "Today";
  if (day === dayIn(new Date(now.getTime() + 86_400_000), item.timeZone)) return "Tomorrow";
  return "Coming up";
}

export const ARTIFACT_KINDS: Record<
  AgentArtifact["kind"],
  { label: string; plural: string; emoji: string }
> = {
  report: { label: "Report", plural: "Reports", emoji: "📄" },
  comparison: { label: "Comparison", plural: "Comparisons", emoji: "⚖️" },
  plan: { label: "Plan", plural: "Plans", emoji: "🗺️" },
  finance: { label: "Finance tracker", plural: "Finance trackers", emoji: "💸" },
};
export const artifactKind = (kind: string) =>
  ARTIFACT_KINDS[kind as AgentArtifact["kind"]] ?? { label: kind, plural: kind, emoji: "📄" };

/** Newest first, and the kinds there are, in a steady order. */
export function savedResults(artifacts: AgentArtifact[]) {
  const rows = [...artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const order = Object.keys(ARTIFACT_KINDS);
  const kinds = [...new Set(rows.map((row) => row.kind))].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  );
  return { rows, kinds };
}

/** "Sep 29" in the device's calendar, with the year when it isn't this year. */
export function savedDate(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * Whether a choice of these labels fits in `room` px without cutting a word: side by side at their
 * own size from 420px (Segmented's), or sharing the width equally below that. A rough measure,
 * on the generous side (14px text, bold when chosen).
 */
export function choiceFits(labels: string[], room: number) {
  const text = (label: string) => label.length * 8.2;
  if (room >= 420) return labels.reduce((sum, label) => sum + text(label) + 28, 6) <= room;
  return labels.every((label) => text(label) + 12 <= (room - 6) / labels.length);
}

/** Tells the Feed that plans or reminders changed in a sheet, so its day card catches up. */
const listeners = new Set<() => void>();
export function onPlansChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function plansChanged() {
  for (const listener of listeners) listener();
}
