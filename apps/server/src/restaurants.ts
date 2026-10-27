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
  " To book a restaurant, first work out where it takes bookings: use search_web for its own site, Resy, Tock or OpenTable. Some chains (Texas Roadhouse, for one) aren't on OpenTable and use their own waitlist or call-ahead page. Ask for anything missing in one short question (date, time, party size, and the name and mobile number to book under; use the person's name and number from About you or memory when there are some, and ask which to use if you're unsure), then do the booking in your own browser: open the booking page with browse_web, look_at_page for its fields and buttons, and use_page to fill in the details and choose a time, looking again after each step. For a restaurant on OpenTable, find_table opens its page with the date, time and party size filled in; use it first, then carry on in the browser from there. Stop at the last button (Book, Reserve, Confirm, Complete, Join waitlist): that step waits for the person's OK and appears as an Approve card, so say in one line what you've set up (restaurant, place, day, time, party size, name) and that it's waiting for their OK. Never say a table is booked or the wait is joined until the site confirms it after they approve. Never type a card number; if a deposit or card is needed, stop and tell them. If the site turns your browser away (OpenTable often does, a page asking you to prove you're human), don't retry or blame an outage: tell them in one sentence, give them the booking link as a markdown link (for OpenTable the one find_table returned, with the details filled in), or the restaurant's phone number from search_web, and they can finish with Take control on the browser card. If nothing fits their time, say what is open and ask. After it's booked, offer to set a reminder.";
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
        "For a restaurant that takes bookings on OpenTable: open its OpenTable page in the chat browser with the date, time and party size filled in, and return the page's text and link. Does not book anything; carry on in the browser from there (look_at_page, use_page), and the final step waits for the person's OK. Not for restaurants that aren't on OpenTable.",
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
