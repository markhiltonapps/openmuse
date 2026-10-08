import { z } from "zod";
import type { Store } from "./db.ts";

/**
 * Urgent alerts on a call (owner, 2026-10-08): while the person is on a live call, Neddy speaks up
 * for what can't wait: time to leave for something on the calendar, security alerts, money
 * problems, and messages from people they choose. Each kind has its own switch (in the app, or by
 * saying so). Everything else stays a normal notification.
 */
export const URGENT_KINDS = ["timeToLeave", "security", "money", "people"] as const;
export type UrgentKind = (typeof URGENT_KINDS)[number];
export interface UrgentSettings {
  id: "urgent-alerts";
  timeToLeave: boolean;
  security: boolean;
  money: boolean;
  people: boolean;
  /** Names or email addresses whose messages count as urgent. */
  peopleList: string[];
}
const DEFAULTS: Omit<UrgentSettings, "id"> = {
  timeToLeave: true,
  security: true,
  money: true,
  people: true,
  peopleList: [],
};
export const urgentChangeSchema = z.object({
  timeToLeave: z.boolean().optional(),
  security: z.boolean().optional(),
  money: z.boolean().optional(),
  people: z.boolean().optional(),
  addPeople: z.array(z.string().trim().min(2).max(120)).max(20).optional(),
  removePeople: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
});
export type UrgentChange = z.infer<typeof urgentChangeSchema>;

const SECURITY =
  /\b(new sign[- ]?in|signed in from|login attempt|log[- ]?in attempt|suspicious|unusual (activity|sign)|security alert|password (was )?(reset|changed)|reset your password|verification code|one[- ]time (code|passcode)|2-step|two[- ]factor|account (locked|compromised))\b/i;
const MONEY =
  /\b(payment (failed|declined|was declined|unsuccessful)|card (was )?(declined|blocked|frozen)|fraud|overdra(wn|ft)|low balance|insufficient funds|past due|overdue|due today|final notice|chargeback|unauthori[sz]ed (charge|transaction))\b/i;

/** Which urgent kind a message is, if any (the people list first: a name they chose). */
export function urgentKind(
  item: { from?: string; title: string; text?: string },
  settings: Omit<UrgentSettings, "id">,
): UrgentKind | undefined {
  const words = `${item.title} ${item.text ?? ""}`;
  const from = (item.from ?? "").toLowerCase();
  if (
    settings.people &&
    from &&
    settings.peopleList.some((person) => from.includes(person.toLowerCase()))
  )
    return "people";
  if (settings.security && SECURITY.test(words)) return "security";
  if (settings.money && MONEY.test(words)) return "money";
  return undefined;
}

const clip = (text: string, length = 160) =>
  text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;

/** What the voice is given to say, kept short. */
export function urgentLine(
  kind: UrgentKind,
  item: { from?: string; title: string; text?: string },
) {
  const who = (item.from ?? "").replace(/\s*<.*>$/, "").trim();
  const what = clip([item.title, item.text].filter(Boolean).join(": "));
  switch (kind) {
    case "people":
      return `A message just came in from ${who || "someone you asked me to watch for"}: ${what}`;
    case "security":
      return `A security alert just came in${who ? ` from ${who}` : ""}: ${what}`;
    case "money":
      return `A money alert just came in${who ? ` from ${who}` : ""}: ${what}`;
    default:
      return what;
  }
}

export class UrgentAlerts {
  constructor(
    private readonly db: Store,
    private readonly deps: {
      /** Says it on the person's live call; false when they aren't on one. */
      speak: (owner: string, line: string, key: string) => boolean;
      /** Their calendar events between two times, for time to leave. */
      events?: (
        owner: string,
        from: string,
        to: string,
      ) => Promise<{ title: string; start: string; allDay?: boolean; location?: string }[]>;
      timeZone?: (owner: string) => Promise<string>;
      now?: () => number;
    },
  ) {}
  private now() {
    return this.deps.now?.() ?? Date.now();
  }
  async settings(owner: string): Promise<UrgentSettings> {
    const saved = await this.db.get<UrgentSettings>(owner, "agent-settings", "urgent-alerts");
    return { id: "urgent-alerts", ...DEFAULTS, ...(saved ?? {}) };
  }
  async update(owner: string, raw: unknown) {
    const change = urgentChangeSchema.parse(raw);
    const current = await this.settings(owner);
    const remove = (change.removePeople ?? []).map((p) => p.toLowerCase());
    const people = [
      ...current.peopleList.filter((p) => !remove.some((r) => p.toLowerCase().includes(r))),
      ...(change.addPeople ?? []),
    ];
    const next: UrgentSettings = {
      ...current,
      ...Object.fromEntries(
        URGENT_KINDS.filter((kind) => change[kind] !== undefined).map((kind) => [
          kind,
          change[kind],
        ]),
      ),
      peopleList: [...new Map(people.map((p) => [p.toLowerCase(), p])).values()].slice(0, 30),
    };
    await this.db.put(owner, "agent-settings", next);
    return next;
  }
  /**
   * A new email or app alert: said on their call if it's urgent and that kind is on. Returns the
   * kind it counted as (or undefined).
   */
  async consider(
    owner: string,
    item: { from?: string; title: string; text?: string; key: string },
  ) {
    const kind = urgentKind(item, await this.settings(owner));
    if (!kind) return undefined;
    this.deps.speak(owner, urgentLine(kind, item), `urgent:${item.key}`);
    return kind;
  }
  /**
   * Time to leave: during a call, something on the calendar (not all day) starting in the next 10
   * to 20 minutes is said once. Called every minute or so while they're on a call.
   */
  async checkLeave(owner: string) {
    if (!this.deps.events || !(await this.settings(owner)).timeToLeave) return;
    const now = this.now();
    const from = new Date(now + 10 * 60_000).toISOString();
    const to = new Date(now + 20 * 60_000).toISOString();
    const events = await this.deps.events(owner, from, to).catch(() => []);
    const zone = (await this.deps.timeZone?.(owner).catch(() => "UTC")) ?? "UTC";
    for (const event of events) {
      if (event.allDay) continue;
      const start = Date.parse(event.start);
      if (!(start >= now + 10 * 60_000 && start <= now + 20 * 60_000)) continue;
      const minutes = Math.round((start - now) / 60_000);
      const at = new Date(start).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: zone,
      });
      this.deps.speak(
        owner,
        `Heads up: “${event.title}” starts at ${at}, in about ${minutes} minutes${event.location ? `, at ${clip(event.location, 80)}` : ""}.`,
        `leave:${event.title}:${event.start}`,
      );
    }
  }
}

/** The switches by voice or chat: "stop telling me about money alerts on calls". */
export function urgentToolSpecs(alerts: UrgentAlerts, owner: string) {
  return [
    {
      name: "urgent_alert_settings",
      description:
        "Which urgent alerts the agent says out loud during a live call: time to leave for calendar events, security alerts, money problems, and messages from people they chose (with the list). Each can be on or off.",
      parameters: z.object({}),
      execute: async () => alerts.settings(owner),
    },
    {
      name: "change_urgent_alerts",
      description:
        "Turn an urgent-alert kind on or off (timeToLeave, security, money, people), or add or remove people whose messages count as urgent. Then say what changed in a sentence.",
      parameters: urgentChangeSchema,
      execute: async (change: UrgentChange) => alerts.update(owner, change),
    },
  ];
}
