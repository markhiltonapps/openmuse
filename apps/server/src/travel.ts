import {
  type CountryFacts,
  countryFacts,
  EMBASSY_HELP,
  emergencyWords,
} from "../../../packages/domain/src/travel.ts";
import type { Areas } from "./area.ts";
import type { Store } from "./db.ts";

/**
 * Travel mode (owner, 2026-11-25): when the phone is in another country than the person's home
 * area, Neddy knows it, and has what a visitor needs at hand: the local time against home, the
 * money and today's rate, the emergency numbers, the language, and their embassy. Only while the
 * app is open with location on (Whereabouts); nothing about where they've been is kept.
 */
export interface TravelStatus {
  travelling: boolean;
  /** Where they are: "Singapore", "Kyoto, Japan". */
  here?: string;
  country?: string;
  countryName?: string;
  /** Their home area's label and country, from Weather and where you live. */
  home?: { label?: string; country?: string };
  localTime?: string;
  homeTime?: string;
  currency?: { code: string; name: string; homeCode?: string; rate?: number; rateDate?: string };
  emergency?: CountryFacts["emergency"];
  language?: string;
  alsoSpoken?: string[];
  embassy?: { finder: string; label: string; line?: string; lineName?: string };
  /** Why it isn't on, for the screens and the agent: "location off", "no home area". */
  why?: string;
}

const HOUR = 3_600_000;
/** A home country's money, for "about how much is that at home". */
const HOME_CURRENCY: Record<string, string> = {
  US: "USD",
  GB: "GBP",
  CA: "CAD",
  AU: "AUD",
  NZ: "NZD",
  IE: "EUR",
  FR: "EUR",
  DE: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  SG: "SGD",
  IN: "INR",
  JP: "JPY",
  MX: "MXN",
};

export class Travel {
  private places = new Map<string, { country?: string; here?: string; at: number }>();
  private rates = new Map<string, { rates: Record<string, number>; date?: string; at: number }>();
  /**
   * The last place seen abroad, per person, in memory only (never stored): a dropped location or a
   * failed look-up keeps travel mode on for 12 hours; only seeing the home country turns it off.
   */
  private lastAbroad = new Map<string, { country: string; here?: string; at: number }>();
  constructor(
    private readonly db: Store,
    private readonly areas: Areas,
    private readonly where: {
      current(owner: string): Promise<{ lat: number; lng: number } | undefined>;
    },
    private readonly timeZone: (owner: string) => Promise<string>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}
  /** The country at the person's spot, looked up once per area (about 10 km) every six hours. */
  private async countryHere(owner: string) {
    const spot = await this.where.current(owner).catch(() => undefined);
    if (!spot) return undefined;
    const key = `${spot.lat.toFixed(1)},${spot.lng.toFixed(1)}`;
    const cached = this.places.get(key);
    if (cached && this.now() - cached.at < 6 * HOUR) return cached;
    const place = await this.areas.placeAt(spot.lat, spot.lng)?.catch(() => undefined);
    if (!place) return cached;
    const found = { country: place.country, here: place.label, at: this.now() };
    this.places.set(key, found);
    return found;
  }
  /** Today's rates from one currency (open.er-api.com, no key), kept for twelve hours. */
  private async rate(from: string, to: string) {
    let table = this.rates.get(from);
    if (!table || this.now() - table.at > 12 * HOUR) {
      try {
        const response = await this.fetcher(`https://open.er-api.com/v6/latest/${from}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) throw new Error(`Rates answered ${response.status}`);
        const body = (await response.json()) as {
          result?: string;
          rates?: Record<string, number>;
          time_last_update_utc?: string;
        };
        if (body.result !== "success" || !body.rates) throw new Error("No rates");
        table = { rates: body.rates, date: body.time_last_update_utc, at: this.now() };
        this.rates.set(from, table);
      } catch {
        return undefined;
      }
    }
    const value = table.rates[to];
    return typeof value === "number" && value > 0 ? { rate: value, date: table.date } : undefined;
  }
  private clock(timeZone: string) {
    return new Date(this.now()).toLocaleTimeString("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  /** Whether they're abroad now, and what a visitor needs if they are. */
  async status(owner: string): Promise<TravelStatus> {
    const home = await this.areas.get(owner);
    const zone = await this.timeZone(owner).catch(() => "UTC");
    const seen = await this.countryHere(owner);
    const last = this.lastAbroad.get(owner);
    const here =
      seen?.country || !last || this.now() - last.at > 12 * HOUR
        ? seen
        : { country: last.country, here: last.here };
    if (!here?.country) return { travelling: false, why: "location off" };
    if (!home?.country) return { travelling: false, why: "no home area" };
    if (here.country === home.country) {
      this.lastAbroad.delete(owner);
      // At home: their zone now is their home zone, kept for "what time is it at home" later.
      if (zone && zone !== "UTC")
        await this.db
          .put(owner, "agent-settings", { id: "home-zone", zone })
          .catch(() => undefined);
      return { travelling: false };
    }
    if (seen?.country)
      this.lastAbroad.set(owner, { country: seen.country, here: seen.here, at: this.now() });
    const facts = countryFacts(here.country);
    const homeZone = (
      await this.db
        .get<{ zone?: string }>(owner, "agent-settings", "home-zone")
        .catch(() => undefined)
    )?.zone;
    const homeCode = HOME_CURRENCY[home.country];
    const money = facts?.currency;
    const converted =
      money && homeCode && money.code !== homeCode
        ? await this.rate(homeCode, money.code)
        : undefined;
    return {
      travelling: true,
      here: here.here,
      country: here.country,
      ...(facts ? { countryName: facts.name } : {}),
      home: { label: home.label, country: home.country },
      localTime: this.clock(zone),
      ...(homeZone && homeZone !== zone ? { homeTime: this.clock(homeZone) } : {}),
      ...(money
        ? {
            currency: {
              ...money,
              ...(homeCode ? { homeCode } : {}),
              ...(converted ? { rate: converted.rate, rateDate: converted.date } : {}),
            },
          }
        : {}),
      ...(facts
        ? {
            emergency: facts.emergency,
            language: facts.language,
            ...(facts.alsoSpoken ? { alsoSpoken: facts.alsoSpoken } : {}),
          }
        : {}),
      ...(EMBASSY_HELP[home.country] ? { embassy: EMBASSY_HELP[home.country] } : {}),
    };
  }
  /** One line for the chat's context while abroad (it changes as they move: it's volatile). */
  async contextLine(owner: string) {
    const status = await this.status(owner).catch(() => undefined);
    if (!status?.travelling) return "";
    const facts = status.country ? countryFacts(status.country) : undefined;
    const money = status.currency
      ? `${status.currency.name} (${status.currency.code})${
          status.currency.rate && status.currency.homeCode
            ? `, 1 ${status.currency.homeCode} ≈ ${roundRate(status.currency.rate)} ${status.currency.code}`
            : ""
        }`
      : "";
    return [
      `In ${status.here ?? status.countryName ?? status.country}${status.home?.label ? ` (home: ${status.home.label})` : ""}.`,
      status.localTime
        ? `Local time ${status.localTime}${status.homeTime ? `; at home it's ${status.homeTime}` : ""}.`
        : "",
      money ? `Money: ${money}.` : "",
      facts
        ? `Emergency: ${emergencyWords(facts)} (numbers can differ by city).`
        : "Emergency numbers here aren't in Neddy's list: say to check locally.",
      status.language
        ? `Local language: ${status.language}${status.alsoSpoken?.length ? ` (also ${status.alsoSpoken.join(", ")})` : ""}.`
        : "",
      status.embassy
        ? `Their embassy: ${status.embassy.label}, ${status.embassy.finder}${status.embassy.line ? `; ${status.embassy.line}` : ""}.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
}

/** A rate people can say: 1.29, 34.6, 25,400. */
export const roundRate = (rate: number) =>
  rate >= 1000
    ? Math.round(rate).toLocaleString("en-US")
    : rate >= 10
      ? String(Math.round(rate * 10) / 10)
      : String(Math.round(rate * 100) / 100);

export const travelInstructions =
  " When the context says they're travelling (Travelling right now), answer for where they are: local time, prices in the local money with the amount at home when it helps (use the rate given; say it's approximate), the emergency numbers given (never other numbers from memory), and their embassy from the context. Offer short phrases in the local language when it would help (with how to say them), and give directions with get_directions as usual.";
