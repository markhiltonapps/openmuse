import { z } from "zod";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/**
 * Where the person lives, as a town or city, so "local news", weather and "near me" searches are
 * about their area. Only the place is kept: a shared location is turned into a city once and the
 * coordinates are dropped.
 */
export interface Area {
  id: "area";
  /** How it reads, such as "Houston, Texas". */
  label: string;
  city?: string;
  region?: string;
  /** Two-letter country code, such as "US". */
  country?: string;
  setAt: string;
}
export type Place = Omit<Area, "id" | "setAt">;
/** A place from a name or from a location. Undefined when nothing matches; throws when unreachable. */
export type PlaceFinder = (
  where: { text: string } | { lat: number; lng: number },
) => Promise<Place | undefined>;
/** What a search is told about where the person is. */
export interface SearchPlace {
  label?: string;
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
}

export const areaInputSchema = z.union([
  z.object({ place: z.string().trim().min(2).max(120) }),
  z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
]);

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  suburb?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
  country_code?: string;
}
/** "Houston, Texas" from an OpenStreetMap address. */
export function placeFrom(address: NominatimAddress | undefined): Place | undefined {
  if (!address) return undefined;
  const city =
    address.city ??
    address.town ??
    address.village ??
    address.municipality ??
    address.hamlet ??
    address.suburb ??
    address.county;
  const region = address.state;
  const country = address.country_code?.toUpperCase();
  const label = [city, region ?? (country === "US" ? undefined : address.country)]
    .filter(Boolean)
    .join(", ");
  if (!label) return undefined;
  return {
    label,
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
    ...(country && /^[A-Z]{2}$/.test(country) ? { country } : {}),
  };
}

/** OpenStreetMap's Nominatim, at most one request a second as its policy asks. */
export function nominatimPlaces(
  userAgent: string,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): PlaceFinder {
  let queue = Promise.resolve();
  let last = 0;
  return (where) => {
    const turn = queue.then(async () => {
      const wait = last + 1100 - now();
      if (wait > 0) await new Promise((done) => setTimeout(done, wait));
      last = now();
      const base = "https://nominatim.openstreetmap.org";
      const url =
        "text" in where
          ? `${base}/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(where.text)}`
          : // Rounded to about a kilometer: enough to name the town, not to find the house.
            `${base}/reverse?format=jsonv2&addressdetails=1&zoom=10&lat=${where.lat.toFixed(2)}&lon=${where.lng.toFixed(2)}`;
      const response = await fetcher(url, {
        headers: { "user-agent": userAgent, accept: "application/json", "accept-language": "en" },
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error(`Place lookup answered ${response.status}`);
      const body = (await response.json()) as
        | { address?: NominatimAddress }
        | { address?: NominatimAddress }[];
      return placeFrom((Array.isArray(body) ? body[0] : body)?.address);
    });
    queue = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  };
}

export class Areas {
  constructor(
    private readonly db: Store,
    /** Absent where the server can't reach a place lookup (sample mode, tests). */
    private readonly find?: PlaceFinder,
    private readonly now: () => number = Date.now,
  ) {}
  async get(owner: string) {
    return (await this.db.get<Area>(owner, "agent-settings", "area")) ?? undefined;
  }
  /** Saves the person's area from a place they typed or the location their device shared. */
  async set(owner: string, raw: unknown) {
    const input = areaInputSchema.parse(raw);
    let place: Place | undefined;
    if ("place" in input) {
      if (!this.find) place = { label: input.place };
      else
        try {
          place = await this.find({ text: input.place });
        } catch {
          // The lookup is down: keep their words, which still steer searches.
          place = { label: input.place };
        }
      if (!place)
        throw new AppError(
          `I couldn’t find “${input.place}”. Try a city and state, like Houston, TX, or a ZIP code.`,
          422,
        );
    } else {
      if (!this.find)
        throw new AppError(
          "Finding your city from your location isn’t available. Type it instead.",
          503,
        );
      place = await this.find({ lat: input.lat, lng: input.lng }).catch(() => {
        throw new AppError("Couldn’t look up your city just now. Type it instead.", 503);
      });
      if (!place) throw new AppError("Couldn’t tell which city you’re in. Type it instead.", 422);
    }
    const area: Area = { id: "area", ...place, setAt: new Date(this.now()).toISOString() };
    await this.db.put(owner, "agent-settings", area);
    return area;
  }
  async clear(owner: string) {
    await this.db.remove(owner, "agent-settings", "area");
    return { ok: true };
  }
}

/** The area and time zone as a search sees them. A UTC default says nothing about where. */
export function searchPlace(area: Area | undefined, timeZone?: string): SearchPlace | undefined {
  const zone = timeZone && timeZone !== "UTC" && timeZone !== "Etc/UTC" ? timeZone : undefined;
  if (!area && !zone) return undefined;
  return {
    ...(area?.label ? { label: area.label } : {}),
    ...(area?.city ? { city: area.city } : {}),
    ...(area?.region ? { region: area.region } : {}),
    ...(area?.country ? { country: area.country } : {}),
    ...(zone ? { timezone: zone } : {}),
  };
}

export const areaInstructions =
  " When the person tells you where they live or asks to change it (for local news, weather or places near them), call set_home_area with their city. Their area, when saved, is in the context; use it for anything local or “near me”.";

export function areaToolSpecs(areas: Areas, owner: string, changed?: (owner: string) => void) {
  return [
    {
      name: "set_home_area",
      description:
        "Save the town or city the person lives in (for example “Houston, TX” or a ZIP code). Local news in their Feed, weather and “near me” searches then use it.",
      parameters: z.object({ place: z.string().trim().min(2).max(120) }),
      execute: async ({ place }: { place: string }) => {
        const area = await areas.set(owner, { place });
        changed?.(owner);
        return {
          area: area.label,
          next: "Tell them their local news and nearby searches now use this area, and that they can change it in Feed under Topics you follow.",
        };
      },
    },
  ];
}
