import { z } from "zod";

export const tableRequestSchema = z.object({
  restaurant: z.string().trim().min(2).max(120).describe("Restaurant name"),
  area: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe("City or neighborhood, to find the right restaurant"),
  date: z.iso.date().describe("YYYY-MM-DD"),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .describe("24-hour HH:MM"),
  partySize: z.number().int().min(1).max(20),
  opentableUrl: z
    .url()
    .max(2000)
    .optional()
    .describe("The restaurant's opentable.com page, when known from search_web"),
});
export type TableRequest = z.infer<typeof tableRequestSchema>;

/**
 * The OpenTable page for a table request, with the date, time and party size filled in: the
 * restaurant's own page when its address is known, otherwise OpenTable's search.
 */
export function openTableLink(request: TableRequest) {
  const dateTime = `${request.date}T${request.time}`;
  if (request.opentableUrl) {
    const url = new URL(request.opentableUrl);
    if (/(^|\.)opentable\.[a-z.]+$/i.test(url.hostname) && url.protocol === "https:") {
      url.searchParams.set("covers", String(request.partySize));
      url.searchParams.set("dateTime", dateTime);
      return url.toString();
    }
  }
  const url = new URL("https://www.opentable.com/s");
  url.searchParams.set("covers", String(request.partySize));
  url.searchParams.set("dateTime", dateTime);
  url.searchParams.set("term", [request.restaurant, request.area].filter(Boolean).join(" "));
  return url.toString();
}

export const restaurantInstructions =
  " To book a restaurant, call find_table with the restaurant, date, time and party size (ask for any that are missing; use the person's usual party size from memory when there is one). It opens OpenTable with those filled in. When it loaded, tell the person the times that are open, from the page text only. When loaded is false (OpenTable often turns away automated browsers), don't retry or blame an outage: give them the returned link as a markdown link, since it opens OpenTable on their phone with the date, time and party size already filled in. You never complete a booking yourself: the person picks a time and books with their own OpenTable account, on the link or with Take control on the browser card. Never say a table is booked until they tell you it is. For a restaurant that isn't on OpenTable, find its phone number or own booking page with search_web. After they book, offer to set a reminder.";
/** Words on the pages sites show automated browsers instead of the real one. */
const TURNED_AWAY =
  /access denied|pardon our interruption|verify (that )?you are (a )?human|are you a robot|unusual traffic|request blocked|bot detection|captcha/i;

/** find_table for an agent that can open pages in its browser. */
export function restaurantToolSpecs(
  open: (url: string) => Promise<{ url: string; title: string; text: string; sessionId: string }>,
) {
  return [
    {
      name: "find_table",
      description:
        "Check a restaurant's open tables on OpenTable for a date, time and party size. Opens the booking page in the chat browser with everything filled in and returns its text and link, so the person can confirm the booking themselves with Take control. Does not book anything.",
      parameters: tableRequestSchema,
      execute: async (request: TableRequest) => {
        const link = openTableLink(request);
        const handOff = (reason: string) => ({
          link,
          loaded: false,
          reason,
          booked: false,
          next: `Give the person this link as a markdown link: ${link} — it opens OpenTable with ${request.partySize} people on ${request.date} at ${request.time} filled in, where they pick a time and book. Tell them in one short sentence that OpenTable turned away your browser.`,
        });
        let page: Awaited<ReturnType<typeof open>>;
        try {
          page = await open(link);
        } catch (error) {
          return handOff(error instanceof Error ? error.message : "OpenTable didn't load");
        }
        if (TURNED_AWAY.test(`${page.title} ${page.text.slice(0, 2000)}`))
          return handOff("OpenTable showed a page for automated browsers instead of the tables");
        return {
          link,
          loaded: true,
          url: page.url,
          title: page.title,
          sessionId: page.sessionId,
          text: page.text.slice(0, 12_000),
          booked: false,
          next: "List the open times from this text. The person confirms the booking with Take control on the browser card or the link; it isn't booked until they do.",
        };
      },
    },
  ];
}
