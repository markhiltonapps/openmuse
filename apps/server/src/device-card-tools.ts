import { z } from "zod";
import { buildDeviceCard } from "../../../packages/domain/src/device-card.ts";

/**
 * On a call from a watch-style device: put a card on its small screen. The agent chooses this itself
 * whenever an answer has a shape (a score, a price, a time, a short list), after it has the facts.
 * The device draws the card from these few plain facts; nothing else goes there.
 */
export function showOnWatchToolSpec() {
  const team = z.object({
    name: z.string().trim().max(16).describe("Short name: 'Lakers', not 'Los Angeles Lakers'"),
    score: z
      .number()
      .int()
      .min(0)
      .max(999)
      .optional()
      .describe("Leave out if the game hasn't started"),
  });
  return {
    name: "show_on_watch",
    description:
      "On a call from the person's watch: put a card on its small screen. Use it whenever your answer is a game score, a price or other number, a time, a count or distance, or a short list or schedule (up to 5 rows): call it once you have the facts, then say the key point in a sentence. Not for the weather (get_weather puts its own card up) and not for long text. kind 'score' is a game (league, status like 'Final', 'Q3 4:21' or '7:30 PM tonight', away and home with short names and scores). kind 'fact' is one headline value (label like 'AAPL' or 'Drive to work', value like '$187.42' or '24 min', sub like '+1.2% today', tone good/bad/neutral). kind 'list' is up to 5 rows (title, rows each with a label and an optional short value), such as today's calendar (label 'Standup', value '9:00 AM') or a few options. Keep every piece of text very short.",
    parameters: z.object({
      kind: z.enum(["score", "fact", "list"]),
      league: z.string().trim().max(16).optional().describe("score: 'NBA'"),
      status: z
        .string()
        .trim()
        .max(24)
        .optional()
        .describe("score: 'Final', 'Q3 4:21', '7:30 PM tonight'"),
      away: team.optional().describe("score: the visiting team"),
      home: team.optional().describe("score: the home team"),
      label: z.string().trim().max(24).optional().describe("fact: what it is, e.g. 'AAPL'"),
      value: z
        .string()
        .trim()
        .max(18)
        .optional()
        .describe("fact: the headline value, e.g. '$187.42'"),
      sub: z
        .string()
        .trim()
        .max(44)
        .optional()
        .describe("fact: a short line under it, e.g. '+1.2% today'"),
      note: z
        .string()
        .trim()
        .max(36)
        .optional()
        .describe("fact: a smaller grey line, e.g. 'As of 3:58 PM'"),
      tone: z
        .enum(["good", "bad", "neutral"])
        .optional()
        .describe("fact: colour of the line under the value"),
      title: z.string().trim().max(24).optional().describe("list: e.g. 'Today'"),
      rows: z
        .array(
          z.object({
            label: z.string().trim().max(26),
            value: z.string().trim().max(12).optional(),
          }),
        )
        .max(5)
        .optional()
        .describe("list: up to 5 rows"),
    }),
    execute: async (args: unknown) => {
      const built = buildDeviceCard(args);
      if ("error" in built) return { error: built.error };
      return {
        shown: true,
        card: built.card,
        next: "The card is on the watch screen now. Say the key point in a sentence or two, and that it's on the watch screen.",
      };
    },
  };
}
