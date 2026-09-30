import { createHash } from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.ts";
import { previewImage } from "./link-preview.ts";

/**
 * Places on a map and products as cards in chat. The agent names the places or products; the
 * server finds where each place is (OpenStreetMap's geocoder, cached) and each product's picture
 * (the picture its page shares), so neither is made up.
 */
/**
 * Where a place is; undefined when there's no such place. With `strict`, a lookup that failed
 * (busy, down) throws instead of looking like no match.
 */
export type Geocoder = (
  query: string,
  options?: { strict?: boolean },
) => Promise<{ lat: number; lng: number } | undefined>;

/** OpenStreetMap's Nominatim, one request a second as its policy asks, with answers cached. */
export function nominatim(
  db: Store,
  userAgent: string,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Geocoder {
  let queue = Promise.resolve();
  let last = 0;
  return async (query, options) => {
    const text = query.trim().replace(/\s+/g, " ").slice(0, 300);
    if (!text) return undefined;
    const id = createHash("sha256").update(text.toLowerCase()).digest("hex");
    const cached = await db.get<{ lat?: number; lng?: number; at: number }>(
      "system",
      "geocode",
      id,
    );
    if (cached && now() - cached.at < 30 * 86_400_000)
      return cached.lat === undefined || cached.lng === undefined
        ? undefined
        : { lat: cached.lat, lng: cached.lng };
    const turn = queue.then(async () => {
      const wait = last + 1100 - now();
      if (wait > 0) await new Promise((done) => setTimeout(done, wait));
      last = now();
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(text)}`;
      const response = await fetcher(url, {
        headers: { "user-agent": userAgent, accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error(`Geocoder answered ${response.status}`);
      const [hit] = (await response.json()) as { lat?: string; lon?: string }[];
      const lat = Number(hit?.lat);
      const lng = Number(hit?.lon);
      return Number.isFinite(lat) && Number.isFinite(lng) && hit ? { lat, lng } : undefined;
    });
    queue = turn.then(
      () => undefined,
      () => undefined,
    );
    const found = await turn.catch(() => null);
    // Errors aren't cached, so a busy moment doesn't hide a place for a month.
    if (found !== null) await db.put("system", "geocode", { id, ...found, at: now() });
    else if (options?.strict) throw new Error("The place lookup didn't answer");
    return found ?? undefined;
  };
}

const httpUrl = z
  .url()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), "Use a web link");

const placeInput = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300).optional().describe("Street address, as found"),
  note: z.string().trim().max(200).optional().describe("Why it's worth a look, hours, price"),
  url: httpUrl.optional().describe("Its website or listing page"),
});
const productInput = z.object({
  title: z.string().trim().min(1).max(160),
  price: z.string().trim().max(40).optional().describe("As the store shows it, e.g. $24.99"),
  store: z.string().trim().max(80).optional(),
  url: httpUrl.describe("The product's page on the store's site, from search results"),
  note: z.string().trim().max(200).optional(),
});

export interface ShownPlace extends z.infer<typeof placeInput> {
  lat: number;
  lng: number;
}
export type ShownProduct = z.infer<typeof productInput> & { image?: string };

export const richCardInstructions =
  " When your answer recommends or lists real places (restaurants, shops, sights, venues, addresses), also call show_places with each one's name and street address from your sources, plus the area, so they appear on a map; don't write coordinates. When you suggest products to buy, call show_products with each product's page link, price and store from search results so they show as cards with pictures; never invent prices or links. Then answer briefly without repeating every detail.";

export function richCardToolSpecs(
  geocode: Geocoder,
  pictureOf: (page: string) => Promise<string | undefined> = (page) => previewImage(page),
) {
  return [
    {
      name: "show_places",
      description:
        "Show places on a map in the chat, with a numbered pin and a directions link for each. Give names and street addresses from your sources; the server finds where they are.",
      parameters: z.object({
        title: z.string().trim().max(80).optional().describe("e.g. 'Tacos near you'"),
        near: z
          .string()
          .trim()
          .max(120)
          .optional()
          .describe("The city or area, e.g. 'Austin, TX', to find the right place"),
        places: z.array(placeInput).min(1).max(10),
      }),
      execute: async (input: {
        title?: string;
        near?: string;
        places: z.infer<typeof placeInput>[];
      }) => {
        const shown: ShownPlace[] = [];
        const notFound: string[] = [];
        for (const place of input.places) {
          const query = [place.address || place.name, input.near].filter(Boolean).join(", ");
          const at =
            (await geocode(query)) ??
            (place.address ? await geocode([place.name, place.address].join(", ")) : undefined);
          if (at) shown.push({ ...place, ...at });
          else notFound.push(place.name);
        }
        return {
          ...(input.title ? { title: input.title } : {}),
          places: shown,
          ...(notFound.length
            ? {
                notFound,
                note: "These couldn't be found on the map; give their addresses in your answer instead.",
              }
            : {}),
        };
      },
    },
    {
      name: "show_products",
      description:
        "Show products as cards in the chat, each with its picture, price, store and a link to buy. Use the product page links, prices and stores from search results.",
      parameters: z.object({
        title: z.string().trim().max(80).optional(),
        products: z.array(productInput).min(1).max(8),
      }),
      execute: async (input: { title?: string; products: z.infer<typeof productInput>[] }) => {
        // Pictures come from the product pages themselves, never from the agent: a picture the
        // app loads by itself must not be a link the agent could have been talked into writing.
        const products: ShownProduct[] = await Promise.all(
          input.products.map(async (product) => {
            const image = await pictureOf(product.url).catch(() => undefined);
            return image ? { ...product, image } : product;
          }),
        );
        return { ...(input.title ? { title: input.title } : {}), products };
      },
    },
  ];
}
