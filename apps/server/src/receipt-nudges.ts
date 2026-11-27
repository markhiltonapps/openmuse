import { metersBetween } from "../../../packages/domain/src/location.ts";
import type { AppConnector } from "./apps.ts";
import type { Store } from "./db.ts";
import { localDay } from "./health.ts";
import type { Moment, Proactive } from "./proactive.ts";
import type { BoxReceipt } from "./receipt-box.ts";
import type { ReportEvent } from "./whereabouts.ts";

/**
 * "Add the receipt?" at the right moment (owner, 2026-11-27: "the app should know when I'm at a
 * restaurant and ask me if I want to upload a receipt"). Three ways in, one judge:
 *
 * - A restaurant charge on their connected card (Brex), checked every half hour on the server, so
 *   it reaches their phone with the app closed. Restaurants are known by the card network's own
 *   business code (5812 restaurants, 5813 bars, 5814 fast food and coffee), never by guessing names.
 * - A visit: while the app is open with location on, 20 minutes at a place to eat or drink (from
 *   the map), then a report from somewhere else within three hours. Nothing about where they were
 *   is stored beyond the open question itself.
 * - Receipt emails (food delivery, rides, restaurant payment apps) go straight into the Receipt
 *   box on their own (receipt-box.ts `fromEmail`); see `looksLikeReceiptEmail`.
 *
 * Every question goes through the proactive judge (area "receipts"): quiet hours, the daily limit,
 * "fewer like that" and its own switch. A charge or visit with a matching receipt already in the box
 * is never asked about, and each one is asked about once.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Card network business codes for places to eat and drink. */
export const RESTAURANT_MCC = new Set(["5811", "5812", "5813", "5814"]);
const POLL_EVERY = 30 * MINUTE;
/** A charge older than this isn't asked about (the receipt is long gone). */
const CHARGE_WINDOW = 3 * DAY;
/** Time at one spot before a place to eat counts as a visit. */
export const DWELL = 20 * MINUTE;
/** How far the phone can wander and still be "at the same spot". */
const SAME_SPOT = 80;
/** A visit noticed after this long away isn't asked about. */
const VISIT_STALE = 3 * HOUR;

export interface ReceiptNudge {
  id: string;
  source: "card" | "visit";
  merchant: string;
  /** In the card's currency's main unit. */
  amount?: number;
  currency?: string;
  /** YYYY-MM-DD, the person's local day. */
  day: string;
  status: "waiting" | "asked" | "done" | "dismissed";
  createdAt: string;
  askedAt?: string;
  receiptId?: string;
  /** "Later": asked again no sooner than this (ISO), once. */
  notBefore?: string;
  /** How many times it has been asked (a "Later" asks once more). */
  asks?: number;
}

export interface CardCharge {
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  /** YYYY-MM-DD. */
  day: string;
  mcc: string;
}

/** Card processors' prefixes and a city/state tail, so "SQ *MARLOWS SAN FRANCISCO CA" reads "Marlows". */
export function merchantName(raw: string) {
  const cleaned = raw
    .replace(/^(SQ|TST|PY|SP|DD|UBER|LYFT|PAYPAL|GOOGLE|APPLE)\s*\*+\s*/i, "")
    .replace(/\s+\d{3}[-\s]?\d{3}[-\s]?\d{4}\b.*$/, "")
    .replace(/\s+[A-Z][A-Za-z.]+(\s[A-Z][A-Za-z.]+)?\s+[A-Z]{2}(\s\d{5})?$/, "")
    .replace(/[#*]+\s*\d*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = (cleaned || raw.trim()).toLowerCase().split(" ");
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .slice(0, 60);
}

/**
 * Card charges from a Brex transactions answer, however the connector wraps it (`data.items`,
 * `data.response_data.items`, …). Brex gives amounts in cents. Refunds and non-restaurant charges
 * are left out.
 */
export function restaurantCharges(data: unknown): CardCharge[] {
  const found: CardCharge[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const item = value as Record<string, unknown>;
    const merchant = item.merchant as Record<string, unknown> | undefined;
    const money = item.amount as Record<string, unknown> | number | undefined;
    if (
      typeof item.id === "string" &&
      merchant &&
      typeof merchant === "object" &&
      money !== undefined
    ) {
      const mcc = String(merchant.mcc ?? "");
      const cents =
        typeof money === "number" ? money : typeof money === "object" ? Number(money.amount) : NaN;
      const currency =
        typeof money === "object" && typeof money.currency === "string" ? money.currency : "USD";
      const type = String(item.type ?? "PURCHASE").toUpperCase();
      const day = String(item.initiated_at_date ?? item.posted_at_date ?? "").slice(0, 10);
      const raw = String(merchant.raw_descriptor ?? item.description ?? "");
      if (
        RESTAURANT_MCC.has(mcc) &&
        type === "PURCHASE" &&
        Number.isFinite(cents) &&
        cents > 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(day) &&
        raw
      )
        found.push({
          id: item.id,
          merchant: merchantName(raw),
          amount: Math.round(cents) / 100,
          currency,
          day,
          mcc,
        });
      return;
    }
    for (const child of Object.values(item)) visit(child, depth + 1);
  };
  visit(data, 0);
  return found;
}

/** A receipt already in the box for this charge or visit: same day give or take one, and the name or the amount agrees. */
export function alreadyHave(
  receipts: Pick<BoxReceipt, "merchant" | "date" | "total">[],
  wanted: { merchant: string; day: string; amount?: number },
) {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/['’]/g, "")
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 4),
    );
  const theirs = words(wanted.merchant);
  return receipts.some((receipt) => {
    if (!receipt.date) return false;
    const days = Math.abs(Date.parse(receipt.date) - Date.parse(wanted.day)) / DAY;
    if (days > 1) return false;
    const named = [...words(receipt.merchant ?? "")].some((word) => theirs.has(word));
    // A charge includes the tip, the receipt may not: within a third either way.
    const priced =
      wanted.amount !== undefined &&
      receipt.total !== null &&
      Math.abs(receipt.total - wanted.amount) <= Math.max(0.5, wanted.amount / 3);
    return named || (priced && wanted.amount !== undefined);
  });
}

/** Senders whose emails are receipts for a meal or a ride (by address, never by what the email claims). */
const RECEIPT_SENDERS =
  /@(?:[a-z0-9-]+\.)*(uber\.com|doordash\.com|grubhub\.com|seamless\.com|postmates\.com|caviar\.com|toasttab\.com|squareup\.com|square\.com|opentable\.com|resy\.com|lyft\.com|instacart\.com|chownow\.com|gopuff\.com|deliveroo\.[a-z.]+|just-eat\.[a-z.]+|grab\.com|clover\.com|tock\.com|sevenrooms\.com)>?$/i;
const RECEIPT_SUBJECT =
  /\b(receipt|your order|order (confirmation|#)|your trip|trip with|thanks for (dining|ordering|riding)|payment (receipt|confirmation))\b/i;

/** Whether an email is a meal or ride receipt worth filing. */
export function looksLikeReceiptEmail(email: { from: string; subject: string }) {
  const address = /<([^>]+)>/.exec(email.from)?.[1] ?? email.from;
  return RECEIPT_SENDERS.test(address.trim()) && RECEIPT_SUBJECT.test(email.subject);
}

/** Gmail's search for recent meal and ride receipts, for the daily sweep. */
export const RECEIPT_EMAIL_QUERY =
  "newer_than:2d subject:(receipt OR order OR trip) from:(uber.com OR doordash.com OR grubhub.com OR seamless.com OR postmates.com OR toasttab.com OR squareup.com OR square.com OR opentable.com OR resy.com OR lyft.com OR chownow.com OR clover.com OR tock.com)";

export interface ReceiptEmail {
  app: string;
  messageId: string;
  from: string;
  subject: string;
  body: string;
}

interface Visit {
  lat: number;
  lng: number;
  since: number;
  last: number;
  looked: boolean;
  place?: { name: string };
}

export class ReceiptNudges {
  private readonly visits = new Map<string, Visit>();
  private readonly polled = new Map<string, number>();
  private readonly retried = new Map<string, number>();
  constructor(
    private readonly db: Store,
    private readonly deps: {
      proactive: Proactive;
      /** Sends the question (the bell, the phone) with a way to open the Receipt box. */
      notify(
        owner: string,
        note: { title: string; body: string; key: string; nudgeId: string },
      ): Promise<unknown>;
      timeZone(owner: string): Promise<string>;
      receipts(owner: string): Promise<BoxReceipt[]>;
      apps?: AppConnector;
      /** People to check: everyone with an account. */
      owners(): Promise<string[]>;
      /** Reads a receipt email and files it (receipt-box.ts `fromEmail`); undefined when it isn't one. */
      fileEmail?(owner: string, email: ReceiptEmail): Promise<unknown>;
      /** The nearest place to eat or drink within a few dozen meters, if any. */
      placeToEat?(
        spot: { lat: number; lng: number },
        accuracy?: number,
      ): Promise<{ name: string } | undefined>;
      now?: () => number;
    },
  ) {}
  private get now() {
    return (this.deps.now ?? Date.now)();
  }
  private async day(owner: string, at = this.now) {
    return localDay(at, await this.deps.timeZone(owner).catch(() => "UTC"));
  }

  /**
   * Each maintenance pass: every half hour per person with Brex connected, new restaurant charges
   * become questions; every ten minutes, questions held back (quiet hours, the daily limit) are
   * tried again.
   */
  async tick() {
    for (const owner of await this.deps.owners()) {
      if (this.now - (this.retried.get(owner) ?? 0) >= 10 * MINUTE) {
        this.retried.set(owner, this.now);
        await this.retryWaiting(owner).catch(() => undefined);
      }
      if (!this.deps.apps || this.now - (this.polled.get(owner) ?? 0) < POLL_EVERY) continue;
      this.polled.set(owner, this.now);
      await this.pollCard(owner, this.deps.apps);
    }
  }

  private async pollCard(owner: string, apps: AppConnector) {
    const connections = await apps.connections(owner).catch(() => []);
    if (!connections.some((app) => app.app === "brex" && app.connected)) return;
    let charges: CardCharge[];
    try {
      charges = restaurantCharges(
        await apps.execute(owner, "BREX_GET_CARD_TRANSACTIONS", { limit: 50 }),
      );
    } catch (error) {
      console.warn(
        `[OpenMuse] Couldn't read Brex card charges: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const today = await this.day(owner);
    for (const charge of charges) {
      if (Date.parse(today) - Date.parse(charge.day) > CHARGE_WINDOW) continue;
      await this.consider(owner, {
        id: `card:${charge.id}`,
        source: "card",
        merchant: charge.merchant,
        amount: charge.amount,
        currency: charge.currency,
        day: charge.day,
      });
    }
  }

  /** Location reports while the app is open: a stay at a place to eat, then leaving it. */
  async seen(event: ReportEvent) {
    const spot = { lat: event.lat, lng: event.lng };
    const visit = this.visits.get(event.owner);
    const moved =
      !visit || metersBetween(visit, spot) > SAME_SPOT + Math.min(event.accuracy ?? 0, 100);
    if (moved) {
      if (visit?.place && visit.last - visit.since >= DWELL && event.at - visit.last <= VISIT_STALE)
        await this.consider(event.owner, {
          id: `visit:${await this.day(event.owner, visit.since)}:${visit.place.name.toLowerCase()}`,
          source: "visit",
          merchant: visit.place.name,
          day: await this.day(event.owner, visit.since),
        }).catch(() => undefined);
      this.visits.set(event.owner, { ...spot, since: event.at, last: event.at, looked: false });
      return;
    }
    visit.last = event.at;
    if (!visit.looked && visit.last - visit.since >= DWELL && this.deps.placeToEat) {
      visit.looked = true;
      visit.place = await this.deps.placeToEat(spot, event.accuracy).catch(() => undefined);
    }
  }

  /** One charge or visit: asked about once, unless its receipt is already in the box. */
  private async consider(
    owner: string,
    found: Pick<ReceiptNudge, "id" | "source" | "merchant" | "amount" | "currency" | "day">,
  ) {
    if (await this.db.get(owner, "receipt-nudges", found.id)) return;
    // A visit and the charge for it are one meal: the second one isn't asked about.
    const same = (await this.db.list<ReceiptNudge>(owner, "receipt-nudges")).find(
      (other) =>
        other.day === found.day &&
        other.source !== found.source &&
        alreadyHave(
          [{ merchant: other.merchant, date: other.day, total: other.amount ?? null }],
          found,
        ),
    );
    const nudge: ReceiptNudge = {
      ...found,
      status: same ? "dismissed" : "waiting",
      createdAt: new Date(this.now).toISOString(),
    };
    await this.db.put(owner, "receipt-nudges", nudge);
    if (!same) await this.ask(owner, nudge);
  }

  private async retryWaiting(owner: string) {
    for (const nudge of await this.db.list<ReceiptNudge>(owner, "receipt-nudges"))
      if (nudge.status === "waiting") await this.ask(owner, nudge);
  }

  private async ask(owner: string, nudge: ReceiptNudge) {
    if (nudge.notBefore && Date.parse(nudge.notBefore) > this.now) return;
    if (alreadyHave(await this.deps.receipts(owner), nudge)) {
      await this.db.put(owner, "receipt-nudges", { ...nudge, status: "done" });
      return;
    }
    const money = nudge.amount !== undefined ? amountWords(nudge.amount, nudge.currency) : "";
    const moment: Moment = {
      // A "Later" asks again under its own key (the bell keeps one entry per key).
      key: `receipt:${nudge.id}${nudge.asks ? `:${nudge.asks}` : ""}`,
      area: "receipts",
      detector: nudge.source === "card" ? "restaurant card charge" : "restaurant visit",
      title: `Add the receipt for ${nudge.merchant}?`,
      body:
        nudge.source === "card"
          ? `${money} on your card. Snap the receipt and I’ll read it in.`
          : "You spent a while there. If you ate, snap the receipt and I’ll read it in.",
      why:
        nudge.source === "card"
          ? "From a restaurant charge on your Brex card."
          : "From your location while the app was open.",
      urgency: "normal",
      expires: Date.parse(nudge.day) + 3 * DAY,
    };
    if (this.now > moment.expires) {
      await this.db.put(owner, "receipt-nudges", { ...nudge, status: "dismissed" });
      return;
    }
    const verdict = await this.deps.proactive.decide(owner, moment);
    if (verdict.action === "hold") return;
    if (verdict.action !== "send") {
      await this.db.put(owner, "receipt-nudges", { ...nudge, status: "dismissed" });
      return;
    }
    // Marked first, so a slow notification (or two servers) never asks twice.
    await this.db.put(owner, "receipt-nudges", {
      ...nudge,
      status: "asked",
      askedAt: new Date(this.now).toISOString(),
      asks: (nudge.asks ?? 0) + 1,
    });
    await this.deps.notify(owner, {
      title: moment.title,
      body: moment.body,
      key: moment.key,
      nudgeId: nudge.id,
    });
    await this.deps.proactive.sent(owner, moment);
  }

  /**
   * Emails the person's apps just read (the chat, the inbox check): meal and ride receipts go into
   * the box. Plain code picks them by sender and subject, so most emails cost nothing.
   */
  async fromEmails(owner: string, emails: ReceiptEmail[]) {
    if (!this.deps.fileEmail) return 0;
    let filed = 0;
    for (const email of emails
      .filter((email) => email.messageId && looksLikeReceiptEmail(email))
      .slice(0, 10))
      try {
        if (await this.deps.fileEmail(owner, email)) filed++;
      } catch (error) {
        // The hourly reading limit, or the model failing: the next sweep tries again.
        console.warn(
          `[OpenMuse] Couldn't file a receipt email: ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }
    return filed;
  }
  /** Every six hours per person with Gmail connected: the last two days of meal and ride receipts. */
  async sweepEmail(emailsIn: (data: unknown) => ReceiptEmail[]) {
    if (!this.deps.apps || !this.deps.fileEmail) return;
    for (const owner of await this.deps.owners()) {
      const last = await this.db.get<{ id: string; at: string }>(
        owner,
        "agent-settings",
        "receipt-email-sweep",
      );
      if (last && this.now - Date.parse(last.at) < 6 * HOUR) continue;
      await this.db.put(owner, "agent-settings", {
        id: "receipt-email-sweep",
        at: new Date(this.now).toISOString(),
      });
      const connections = await this.deps.apps.connections(owner).catch(() => []);
      if (!connections.some((app) => app.app === "gmail" && app.connected)) continue;
      try {
        const data = await this.deps.apps.execute(owner, "GMAIL_FETCH_EMAILS", {
          query: RECEIPT_EMAIL_QUERY,
          max_results: 15,
          include_payload: true,
        });
        const filed = await this.fromEmails(owner, emailsIn(data));
        if (filed) console.info(`[OpenMuse] Receipt emails filed: ${filed}`);
      } catch (error) {
        console.warn(
          `[OpenMuse] Couldn't look for receipt emails: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** The question, for the Receipt box's banner. */
  async get(owner: string, id: string) {
    return this.db.get<ReceiptNudge>(owner, "receipt-nudges", id);
  }
  /**
   * The answer: done (a receipt came in through it), not wanted, or "Later" (asked once more in
   * three hours, through the judge; a second "Later" just leaves it in the updates).
   */
  async close(owner: string, id: string, how: "done" | "dismissed" | "later", receiptId?: string) {
    const nudge = await this.get(owner, id);
    if (!nudge) return undefined;
    const closed: ReceiptNudge =
      how === "later"
        ? (nudge.asks ?? 1) < 2
          ? { ...nudge, status: "waiting", notBefore: new Date(this.now + 3 * HOUR).toISOString() }
          : nudge
        : { ...nudge, status: how, ...(receiptId ? { receiptId } : {}) };
    await this.db.put(owner, "receipt-nudges", closed);
    return closed;
  }
  /** Questions asked and not yet answered, newest first (for "I didn't get a receipt for Marlow's"). */
  async open(owner: string) {
    return (await this.db.list<ReceiptNudge>(owner, "receipt-nudges"))
      .filter(
        (n) => n.status === "asked" && n.askedAt && this.now - Date.parse(n.askedAt) < 3 * DAY,
      )
      .sort((a, b) => (b.askedAt ?? "").localeCompare(a.askedAt ?? ""));
  }
}

/** "$48.20", "€12.50", "SGD 30.00". */
export function amountWords(amount: number, currency = "USD") {
  const symbol: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", CAD: "C$", AUD: "A$" };
  const fixed = amount.toFixed(2);
  return symbol[currency] ? `${symbol[currency]}${fixed}` : `${currency} ${fixed}`;
}
