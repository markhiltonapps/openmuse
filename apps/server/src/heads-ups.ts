import { z } from "zod";
import {
  DEFAULT_HEADS_UP_SETTINGS,
  HEADS_UP_KIND_INFO,
  HEADS_UP_KINDS,
  type HeadsUp,
  type HeadsUpKind,
  type HeadsUpSettings,
  saysKind,
  TRAVEL_BUFFERS,
} from "../../../packages/domain/src/heads-up.ts";
import type { TodayCalendar } from "./calendar-today.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import {
  type Candidate,
  headsUpsFor,
  inQuiet,
  parseQuietHours,
  quietEnds,
  usable,
} from "./heads-up-rules.ts";
import { localDay } from "./health.ts";
import { backgroundFailure } from "./log.ts";

/**
 * Heads-ups (owner, 2026-10-22): Neddy watches the day and speaks first. Every few minutes (more
 * often as something gets close) it reads the person's calendars once, applies the plain rules in
 * heads-up-rules.ts, and tells them what needs attention: a card just above the chat box, the
 * bell, a phone notification, and optionally an email. On for everyone; they can turn it off.
 * No model is involved, so it costs nothing per check. `docs/PROACTIVE-AND-SAFETY-PLAN.md`.
 */
const SETTINGS = "heads-up-settings";
const ITEMS = "heads-ups";
const STATE = "heads-up-state";
const MINUTE = 60_000;
/** The stretch of the calendar each look covers. */
const LOOK_AHEAD = 36 * 60 * MINUTE;
/** Phone notifications a day, by how chatty the person wants Neddy to be. */
const DAILY_PUSHES = { important: 4, normal: 8, chatty: 15 } as const;
/** How long a finished or expired heads-up is kept. */
const KEEP = 2 * 24 * 60 * MINUTE;
/** The most cards shown above the chat box at once. */
const SHOWN = 3;
/** "Later": ten minutes for what's about to happen, a few hours for what's further off; once. */
export const SNOOZE_MINUTES = { now: 10, today: 4 * 60, digest: 4 * 60 } as const;

export const headsUpSettingsSchema = z.object({
  on: z.boolean(),
  chatty: z.enum(["important", "normal", "chatty"]),
  /** `null` clears a kind's own setting so the level decides again (what Undo does). */
  kinds: z.partialRecord(z.enum(HEADS_UP_KINDS), z.boolean().nullable()),
  channels: z.object({ push: z.boolean(), email: z.boolean() }).partial(),
  travelBuffer: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]),
  introSeen: z.boolean(),
});

interface State {
  id: "state";
  nextCheckAt?: string;
  failures?: number;
  /** The last look found no calendar connected (so connecting one is looked at straight away). */
  noCalendar?: boolean;
  /** How the last look went, for the screen to say when something isn't working. */
  lastLook?: "ok" | "none" | "failed" | "no-zone";
  /** The local day the push count is for. */
  day?: string;
  pushed?: number;
}

export interface HeadsUpsDeps {
  /** Every connected calendar's events between two times (shared with the Feed). */
  events: (owner: string, from: string, to: string) => Promise<TodayCalendar>;
  timeZone: (owner: string) => Promise<string>;
  /** Whether the app has ever told us their time zone (without it "UTC" is only a guess). */
  zoneKnown?: (owner: string) => Promise<boolean>;
  /** The person's own words for their quiet hours ("9 pm to 8 am"), if they gave any. */
  quietHours: (owner: string) => Promise<string | undefined>;
  /** Everyone with an account. */
  owners: () => Promise<string[]>;
  /** Saves a bell entry and, when `push`, sends a phone notification; false when it was already there. */
  notify: (
    owner: string,
    note: { id: string; title: string; body: string; key: string; push: boolean },
  ) => Promise<boolean>;
  /** Emails the person, when the server can send email. */
  email?: (owner: string, item: { title: string; body: string }) => Promise<void>;
  now?: () => number;
}

export class HeadsUps {
  constructor(
    private readonly db: Store,
    private readonly deps: HeadsUpsDeps,
  ) {}
  private now() {
    return this.deps.now?.() ?? Date.now();
  }
  async settings(owner: string): Promise<HeadsUpSettings> {
    const saved = await this.db.get<HeadsUpSettings>(owner, SETTINGS, "settings");
    return {
      ...DEFAULT_HEADS_UP_SETTINGS,
      ...saved,
      channels: { ...DEFAULT_HEADS_UP_SETTINGS.channels, ...saved?.channels },
      updatedAt: saved?.updatedAt ?? new Date(0).toISOString(),
    };
  }
  async update(owner: string, raw: unknown) {
    const input = headsUpSettingsSchema.partial().parse(raw);
    const current = await this.settings(owner);
    const kinds = { ...current.kinds, ...input.kinds } as Record<
      string,
      boolean | null | undefined
    >;
    for (const kind of Object.keys(kinds)) if (kinds[kind] === null) delete kinds[kind];
    const next: HeadsUpSettings = {
      ...current,
      ...input,
      kinds: kinds as HeadsUpSettings["kinds"],
      channels: { ...current.channels, ...input.channels },
      updatedAt: new Date(this.now()).toISOString(),
    } as HeadsUpSettings;
    await this.db.put(owner, SETTINGS, next);
    // A change (turned on, a new travel time) is looked at on the next pass, not in an hour.
    await this.soon(owner);
    return next;
  }
  /** Whether this server can send email. */
  get canEmail() {
    return !!this.deps.email;
  }
  /** Something changed that makes a look worthwhile now (their time zone arrived). */
  async refresh(owner: string) {
    await this.soon(owner);
  }
  /** A calendar app may just have been connected: look again now if the last look found none. */
  async poke(owner: string) {
    const state = await this.db.get<State>(owner, STATE, "state");
    if (state?.noCalendar || state?.lastLook === "failed") await this.soon(owner);
  }
  private async soon(owner: string) {
    const state = (await this.db.get<State>(owner, STATE, "state")) ?? { id: "state" as const };
    await this.db.put(owner, STATE, { ...state, failures: 0, nextCheckAt: undefined });
  }
  /** From the maintenance loop: everyone whose turn has come. */
  async due(skip: (owner: string) => Promise<boolean> = async () => false) {
    const now = this.now();
    for (const owner of await this.deps.owners()) {
      const state = await this.db.get<State>(owner, STATE, "state");
      if (state?.nextCheckAt && Date.parse(state.nextCheckAt) > now) continue;
      if (await skip(owner)) continue;
      await this.check(owner, now).catch((error) => this.backOff(owner, error));
    }
  }
  private async later(owner: string, ms: number, patch: Partial<State> = {}) {
    const state = (await this.db.get<State>(owner, STATE, "state")) ?? { id: "state" as const };
    await this.db.put(owner, STATE, {
      ...state,
      failures: 0,
      noCalendar: false,
      lastLook: "ok" as const,
      ...patch,
      nextCheckAt: new Date(this.now() + Math.max(ms, MINUTE)).toISOString(),
    });
  }
  /** A calendar that couldn't be read: try again a little later each time, up to an hour. */
  private async backOff(owner: string, error: unknown) {
    const state = (await this.db.get<State>(owner, STATE, "state")) ?? { id: "state" as const };
    const failures = (state.failures ?? 0) + 1;
    backgroundFailure(`heads-ups for one person (try ${failures})`, error);
    await this.db.put(owner, STATE, {
      ...state,
      failures,
      lastLook: "failed",
      nextCheckAt: new Date(
        this.now() + Math.min(15 * 2 ** (failures - 1), 60) * MINUTE,
      ).toISOString(),
    });
  }

  private async check(owner: string, now: number) {
    const settings = await this.settings(owner);
    if (!settings.on) return this.later(owner, 6 * 60 * MINUTE);
    const zone = await this.deps.timeZone(owner).catch(() => "UTC");
    const quiet = parseQuietHours(await this.deps.quietHours(owner).catch(() => undefined));
    const zoneKnown = this.deps.zoneKnown ? await this.deps.zoneKnown(owner) : zone !== "UTC";
    if (zoneKnown && inQuiet(now, zone, quiet))
      return this.later(owner, quietEnds(now, zone, quiet) - now);

    // One read of the next day and a half, on a quarter-hour grid so nearby reads share a cache.
    const from = Math.floor(now / (15 * MINUTE)) * 15 * MINUTE;
    const calendar = await this.deps.events(
      owner,
      new Date(from).toISOString(),
      new Date(from + LOOK_AHEAD).toISOString(),
    );
    if (!calendar.checked.length && !calendar.failed.length)
      return this.later(owner, 60 * MINUTE, { noCalendar: true, lastLook: "none" });
    if (calendar.failed.length && !calendar.checked.length)
      throw new Error("The calendar couldn't be read");
    // Without their time zone every time we'd say would be wrong, so wait until the app has sent it.
    if (!zoneKnown) return this.later(owner, 60 * MINUTE, { lastLook: "no-zone" });

    await this.reopen(owner, now, zone);
    const found = headsUpsFor(calendar.events, {
      now,
      buffer: settings.travelBuffer,
      timeZone: zone,
      chatty: settings.chatty,
    }).filter((c) => saysKind(settings, c.kind));
    let upcoming = Number.POSITIVE_INFINITY;
    for (const candidate of found) {
      const showAt = Date.parse(candidate.showAt);
      if (showAt > now) {
        upcoming = Math.min(upcoming, showAt - now);
        continue;
      }
      if (Date.parse(candidate.expiresAt) <= now) continue;
      await this.say(owner, candidate, settings, zone);
    }
    await this.tidy(owner, now);

    // Looked at again sooner as the next thing gets close.
    const first = usable(calendar.events, now).find((e) => Date.parse(e.start) > now);
    const wait = first ? Date.parse(first.start) - now : Number.POSITIVE_INFINITY;
    const every =
      wait < 2 * 60 * MINUTE ? 10 * MINUTE : wait < 6 * 60 * MINUTE ? 20 * MINUTE : 60 * MINUTE;
    // And in time for a snoozed one to come back when it said it would.
    let reminder = Number.POSITIVE_INFINITY;
    for (const item of await this.db.list<HeadsUp>(owner, ITEMS))
      if (item.status === "snoozed" && item.remindAt)
        reminder = Math.min(reminder, Math.max(0, Date.parse(item.remindAt) - now));
    return this.later(owner, Math.min(every, upcoming, reminder));
  }

  /** Says one heads-up, once: a card in chat, the bell, and the person's other channels. */
  private async say(owner: string, candidate: Candidate, settings: HeadsUpSettings, zone: string) {
    const item: HeadsUp = {
      ...candidate,
      status: "open",
      createdAt: new Date(this.now()).toISOString(),
    };
    // Inserted once: a restart or a second copy of the server can't say it twice.
    if (!(await this.db.insertIfAbsent(owner, ITEMS, item))) return;
    const today = localDay(this.now(), zone);
    const state = (await this.db.get<State>(owner, STATE, "state")) ?? { id: "state" as const };
    const pushed = state.day === today ? (state.pushed ?? 0) : 0;
    if (candidate.urgency !== "digest") {
      // Past the day's limit it's still a card and a bell entry, just not a phone buzz.
      // A meeting about to start is a card and a bell entry; the phone is kept for "leave now".
      const push =
        settings.channels.push &&
        candidate.kind !== "starting_soon" &&
        pushed < DAILY_PUSHES[settings.chatty];
      await this.deps.notify(owner, {
        id: item.id,
        title: item.title,
        body: item.body,
        key: `heads-up:${item.id}`,
        push,
      });
      await this.db.put(owner, STATE, {
        ...state,
        day: today,
        pushed: pushed + (push ? 1 : 0),
      });
    }
    // Email is for what can wait; "leave now" is never emailed.
    if (settings.channels.email && candidate.urgency !== "now")
      await this.deps
        .email?.(owner, { title: item.title, body: item.body })
        .catch((error) => backgroundFailure("heads-up email", error));
  }
  /** Snoozed ones come back when their time is up, if they still matter. */
  private async reopen(owner: string, now: number, zone: string) {
    for (const item of await this.db.list<HeadsUp>(owner, ITEMS)) {
      if (item.status !== "snoozed" || !item.remindAt || Date.parse(item.remindAt) > now) continue;
      const reopened = await this.db.compareAndSwap<HeadsUp>(
        owner,
        ITEMS,
        item.id,
        { status: "snoozed", remindAt: item.remindAt },
        { status: "open" },
      );
      if (!reopened || Date.parse(item.expiresAt) <= now) continue;
      const settings = await this.settings(owner);
      const today = localDay(now, zone);
      const state = (await this.db.get<State>(owner, STATE, "state")) ?? { id: "state" as const };
      const pushed = state.day === today ? (state.pushed ?? 0) : 0;
      // Coming back is a card and a bell entry; only what's about to happen buzzes, within the day's limit.
      const push =
        settings.channels.push &&
        item.urgency === "now" &&
        item.kind !== "starting_soon" &&
        pushed < DAILY_PUSHES[settings.chatty];
      await this.deps
        .notify(owner, {
          id: item.id,
          title: item.title,
          body: item.body,
          key: `heads-up:${item.id}:${item.remindAt}`,
          push,
        })
        .catch((error) => backgroundFailure("snoozed heads-up", error));
      if (push) await this.db.put(owner, STATE, { ...state, day: today, pushed: pushed + 1 });
    }
  }
  private async tidy(owner: string, now: number) {
    for (const item of await this.db.list<HeadsUp>(owner, ITEMS))
      if (now - Date.parse(item.expiresAt) > KEEP) await this.db.take(owner, ITEMS, item.id);
  }

  /** What's worth showing above the chat box now, and the person's settings. */
  async current(owner: string) {
    const now = this.now();
    const [settings, items, state] = await Promise.all([
      this.settings(owner),
      this.db.list<HeadsUp>(owner, ITEMS),
      this.db.get<State>(owner, STATE, "state"),
    ]);
    const open = settings.on
      ? items
          .filter(
            (i) =>
              i.status === "open" && Date.parse(i.showAt) <= now && Date.parse(i.expiresAt) > now,
          )
          .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
      : [];
    return {
      settings,
      intro: !settings.introSeen,
      /** False when the last look found no calendar connected, so the intro can say so. */
      calendar: state?.noCalendar !== true,
      /** How the last look went: "ok", "none" (no calendar), "failed" (couldn't read it), "no-zone" or "unknown" (not looked yet). */
      look: state?.lastLook ?? "unknown",
      /** Whether this server can send email, for the email switch. */
      email: !!this.deps.email,
      open: open.slice(0, SHOWN),
      more: Math.max(0, open.length - SHOWN),
      kinds: HEADS_UP_KINDS.map((kind) => ({
        kind,
        label: HEADS_UP_KIND_INFO[kind].label,
        on: saysKind(settings, kind),
      })),
    };
  }
  private async get(owner: string, id: string) {
    const item = await this.db.get<HeadsUp>(owner, ITEMS, id);
    if (!item) throw new AppError("That heads-up has already been cleared away.", 404);
    return item;
  }
  async done(owner: string, id: string) {
    await this.get(owner, id);
    await this.db.compareAndSwap<HeadsUp>(owner, ITEMS, id, {}, { status: "done" });
    return { ok: true };
  }
  async snooze(owner: string, id: string) {
    const item = await this.get(owner, id);
    // One "later" per heads-up, and none once it's too close to the time to matter.
    if ((item.snoozes ?? 0) >= 1)
      return { ...(await this.done(owner, id)), reason: "last" as const };
    const remindAt = new Date(this.now() + SNOOZE_MINUTES[item.urgency] * MINUTE);
    if (remindAt.getTime() >= Date.parse(item.expiresAt))
      return { ...(await this.done(owner, id)), reason: "close" as const };
    await this.db.compareAndSwap<HeadsUp>(
      owner,
      ITEMS,
      id,
      {},
      { status: "snoozed", remindAt: remindAt.toISOString(), snoozes: (item.snoozes ?? 0) + 1 },
    );
    return { remindAt: remindAt.toISOString() };
  }
  /** "Not useful": this one is closed and Neddy stops saying this kind of thing. */
  async mute(owner: string, id: string) {
    const item = await this.get(owner, id);
    await this.db.compareAndSwap<HeadsUp>(owner, ITEMS, id, {}, { status: "muted" });
    await this.update(owner, { kinds: { [item.kind]: false } });
    return { kind: item.kind, label: HEADS_UP_KIND_INFO[item.kind].label };
  }
}

const KIND_NAMES: Record<string, HeadsUpKind> = {
  leaving: "leave_for",
  leave: "leave_for",
  "leave by": "leave_by",
  tight: "tight_gap",
  overlap: "overlap",
  overlaps: "overlap",
  conflicts: "overlap",
  "starting soon": "starting_soon",
  links: "starting_soon",
  breaks: "no_break",
  "no break": "no_break",
};
export const headsUpKindFor = (word: string) =>
  (HEADS_UP_KINDS as readonly string[]).includes(word)
    ? (word as HeadsUpKind)
    : KIND_NAMES[word.toLowerCase().trim()];

export const headsUpInstructions =
  " Heads-ups: you watch the person’s calendar and tell them first when something needs attention (when to leave for an appointment, a tight gap before the next meeting, two things at the same time, a meeting about to start). It’s on unless they turn it off. In the app chat each one shows as a card just above the chat box, and most of them also go to the bell and, if they allow it, their phone. On a call no card appears, so say it. When they ask what you’ve flagged or what needs attention, call my_heads_ups; for what’s on their calendar, use the calendar tools. When they want fewer, more, none, or a different travel time (“stop telling me when to leave”, “only the important ones”, “it takes me 45 minutes to get anywhere”, “turn heads-ups off”, “email me those too”, “turn that one back on”), call set_heads_ups. A heads-up only tells them; anything to send or change still waits for their OK. If they ask you to draft a note about a tight gap or a clash, write it as a draft for their approval.";

export function headsUpToolSpecs(headsUps: HeadsUps, owner: string) {
  return [
    {
      name: "my_heads_ups",
      description:
        "What Heads-ups is telling the person now and their Heads-ups settings: on or off, how chatty, their usual travel time, which kinds are on, whether phone notifications and email are on.",
      parameters: z.object({}),
      execute: async () => {
        const { settings, open, more, kinds, look } = await headsUps.current(owner);
        return {
          on: settings.on,
          chatty: settings.chatty,
          travelMinutes: settings.travelBuffer,
          phoneNotifications: settings.channels.push,
          email: settings.channels.email,
          kinds: kinds.map(({ label, on }) => ({ label, on })),
          open: open.map((h) => ({ title: h.title, body: h.body })),
          more,
          look,
          next: !settings.on
            ? "Heads-ups are off. Say so in one line and offer to turn them on."
            : look === "none"
              ? "No calendar is connected, so nothing is being watched. Say so in one line and offer to connect one under Apps."
              : look === "failed"
                ? "The calendar couldn’t be read last time. Say so in one line and offer to reconnect it under Apps."
                : look === "no-zone"
                  ? "Their time zone isn’t known yet, so nothing is being watched. It usually sorts itself out within a few minutes while the app is open; if not, ask them to reload the app."
                  : open.length
                    ? `Say them in a short line each, the most urgent first.${more ? ` There are ${more} more waiting; say so.` : ""}`
                    : "Nothing needs attention right now. Say so in one line.",
        };
      },
    },
    {
      name: "set_heads_ups",
      description:
        "Change Heads-ups for the person: on or off, how chatty (important = only what can go wrong, normal, chatty = everything), their usual travel time in minutes (15, 30, 45 or 60), phone notifications or email on or off, or one kind off or on. Kinds: leave_for (when to leave for an appointment or outing), leave_by (when to head back for the next meeting), tight_gap, overlap, starting_soon, no_break.",
      parameters: z.object({
        on: z.boolean().optional(),
        chatty: z.enum(["important", "normal", "chatty"]).optional(),
        travelMinutes: z.number().int().min(1).max(180).optional(),
        phoneNotifications: z.boolean().optional(),
        email: z.boolean().optional(),
        kind: z.string().trim().max(40).optional(),
        kindOn: z.boolean().optional(),
      }),
      execute: async (input: {
        on?: boolean;
        chatty?: "important" | "normal" | "chatty";
        travelMinutes?: number;
        phoneNotifications?: boolean;
        email?: boolean;
        kind?: string;
        kindOn?: boolean;
      }) => {
        const patch: Record<string, unknown> = {};
        if (input.on !== undefined) patch.on = input.on;
        if (input.chatty) patch.chatty = input.chatty;
        if (input.travelMinutes !== undefined)
          // The nearest of the four choices the app offers.
          patch.travelBuffer = [...TRAVEL_BUFFERS].sort(
            (a, b) =>
              Math.abs(a - (input.travelMinutes as number)) -
              Math.abs(b - (input.travelMinutes as number)),
          )[0];
        // Email can't be turned on where the server can't send it: say so instead of promising it.
        const emailRefused = input.email === true && !headsUps.canEmail;
        if (input.phoneNotifications !== undefined || (input.email !== undefined && !emailRefused))
          patch.channels = {
            ...(input.phoneNotifications !== undefined ? { push: input.phoneNotifications } : {}),
            ...(input.email !== undefined && !emailRefused ? { email: input.email } : {}),
          };
        if (input.kind) {
          const kind = headsUpKindFor(input.kind);
          if (!kind)
            return {
              error: `I don’t know a heads-up called “${input.kind}”.`,
              kinds: HEADS_UP_KINDS.map((k) => ({ id: k, label: HEADS_UP_KIND_INFO[k].label })),
              next: "Use the labels when you speak, never the ids.",
            };
          patch.kinds = { [kind]: input.kindOn ?? false };
        }
        const settings = await headsUps.update(owner, { ...patch, introSeen: true });
        return {
          on: settings.on,
          chatty: settings.chatty,
          travelMinutes: settings.travelBuffer,
          phoneNotifications: settings.channels.push,
          email: settings.channels.email,
          kindsOff: HEADS_UP_KINDS.filter((k) => !saysKind(settings, k)).map(
            (k) => HEADS_UP_KIND_INFO[k].label,
          ),
          next: `${emailRefused ? "Email isn’t available yet, so nothing was turned on for it. Say so in one line. " : ""}Say what changed in a few words, nothing more. Only if they ask where: Apps › Alerts › Heads-ups. If travelMinutes isn’t what they asked for, say it was set to the nearest choice (15, 30, 45 or 60). If email is on, say it’s only for things that can wait.`,
        };
      },
    },
  ];
}
