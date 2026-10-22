/**
 * Heads-ups (owner, 2026-10-22): Neddy watches the day and speaks first, for example "your dentist
 * ends at 2:00 and your Zoom starts at 2:30, so head back right away". On for everyone, and it
 * can be turned off. `docs/PROACTIVE-AND-SAFETY-PLAN.md` has the design.
 */
export const HEADS_UP_KINDS = [
  "leave_for",
  "leave_by",
  "tight_gap",
  "overlap",
  "starting_soon",
  "no_break",
] as const;
export type HeadsUpKind = (typeof HEADS_UP_KINDS)[number];

/** `now` is for the next hour or so, `today` can wait for a glance, `digest` is never pushed. */
export type Urgency = "now" | "today" | "digest";
/** How much Neddy says: only what can go wrong, the usual, or everything it notices. */
export type Chattiness = "important" | "normal" | "chatty";

export const TRAVEL_BUFFERS = [15, 30, 45, 60] as const;
export type TravelBuffer = (typeof TRAVEL_BUFFERS)[number];

/** What each kind is called to the person, and how chatty Neddy has to be to say it. */
export const HEADS_UP_KIND_INFO: Record<
  HeadsUpKind,
  { label: string; level: Chattiness; urgency: Urgency }
> = {
  leave_for: {
    label: "When to leave for an appointment or outing",
    level: "normal",
    urgency: "now",
  },
  leave_by: {
    label: "When to head back for your next meeting",
    level: "important",
    urgency: "now",
  },
  tight_gap: { label: "Not enough time between two things", level: "important", urgency: "now" },
  overlap: { label: "Two things at the same time", level: "important", urgency: "today" },
  starting_soon: {
    label: "A meeting or event about to start",
    level: "normal",
    urgency: "now",
  },
  no_break: { label: "A long stretch with no break", level: "chatty", urgency: "digest" },
};

export interface HeadsUp {
  /** A hash of the kind, the events and their times: said once, said again if an event moves. */
  id: string;
  kind: HeadsUpKind;
  urgency: Urgency;
  title: string;
  body: string;
  eventIds: string[];
  /** The meeting's join link, when the calendar has one. */
  joinUrl?: string;
  /** For "tight" and "overlap": the event that's likely to need moving. */
  moveTitle?: string;
  showAt: string;
  expiresAt: string;
  status: "open" | "snoozed" | "done" | "muted";
  /** When a snoozed heads-up shows again. */
  remindAt?: string;
  /** How many times "Later" was used; a second one closes it. */
  snoozes?: number;
  createdAt: string;
}

export interface HeadsUpSettings {
  id: "settings";
  /** On for everyone until they turn it off. */
  on: boolean;
  chatty: Chattiness;
  /** A kind switched off by "Not useful" or by saying so; missing means the chattiness decides. */
  kinds: Partial<Record<HeadsUpKind, boolean>>;
  /** Where else a heads-up shows up. The card in chat and the bell are always there. */
  channels: { push: boolean; email: boolean };
  /** Usual time to get from one place to another, for "when to leave". */
  travelBuffer: TravelBuffer;
  /** The one-time card that explains Heads-ups has been seen. */
  introSeen: boolean;
  updatedAt: string;
}

export const DEFAULT_HEADS_UP_SETTINGS: Omit<HeadsUpSettings, "updatedAt"> = {
  id: "settings",
  on: true,
  chatty: "normal",
  kinds: {},
  channels: { push: true, email: false },
  travelBuffer: 30,
  introSeen: false,
};

const LEVELS: Chattiness[] = ["important", "normal", "chatty"];
/** Whether a kind is said at this chattiness (unless the person switched that kind off). */
export const saysKind = (settings: Pick<HeadsUpSettings, "chatty" | "kinds">, kind: HeadsUpKind) =>
  settings.kinds[kind] ??
  LEVELS.indexOf(HEADS_UP_KIND_INFO[kind].level) <= LEVELS.indexOf(settings.chatty);
