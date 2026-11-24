/**
 * The turn coach (owner, 2026-11-24): "make the AI more intelligent, not just for that one question".
 * The chat's quick model, under a large prompt, takes the easy path and answers questions about the real
 * world from memory (Railway's logs showed a whole exchange about directions in Singapore with no tool
 * calls), and it repeats itself when told an answer failed. A short note in the turn itself, saying what
 * this particular message needs, changes that far more than another paragraph in the fixed
 * instructions, which a small model reads past. The coach is plain code (no model, no cost, no delay):
 * it reads the person's latest words and returns what they need and the note to add. It only points at
 * tools the server really has.
 */

export type Need = "directions" | "places" | "shopping" | "live" | "recommendation" | "correction";

export interface CoachTools {
  search: boolean;
  directions: boolean;
  nearby: boolean;
}

const DIRECTIONS =
  /\b(how (do|can|would|should) (i|we) (get|go|walk|drive|reach)|directions?|which way|the way to|route to|walk(ing)? (back )?to|get (back )?to|i'?m lost|how far (is|to)|navigate)\b/i;
const PLACES =
  /\b(nearby|near (me|here|my (hotel|office|place))|close to (me|here)|closest|nearest|around here|within walking|walking distance|in (this|the) (area|mall|neighbou?rhood))\b/i;
const SHOPPING =
  /\b(where (can|could|do|would|should) (i|we) (buy|get|find|pick up)|(buy|purchase)\b|in stock|who sells|which (store|shop)|a (store|shop) (that|for|with))/i;
const LIVE =
  /\b(open (now|today|tonight|late|on)|opening hours|hours|closes?|price|cost|how much|fare|exchange rate|latest|currently|right now|this (week|weekend)|tonight|news|delayed|on time|(train|bus|ferry|flight|shuttle) (schedule|times?|timetable)|tickets?|reviews?|still (open|available|running))\b/i;
const RECOMMEND =
  /\b(best|recommend|suggest(ion)?s?|good (place|spot|restaurant|hotel|bar|cafe|coffee)|where should (i|we)|worth (it|going|visiting)|top \d+)\b/i;
const CORRECTION =
  /\b(that'?s (wrong|not (right|it|what i))|(you'?re|you are|that was|this is|it'?s) wrong|not (helpful|right|what i (asked|meant|need))|(doesn'?t|didn'?t|does not|did not) (help|work)|useless|can'?t find (it|that)|still (can'?t|lost|don'?t|no)|you (just )?(said|told me)|i already (said|told|tried|did)|try again|you missed|that'?s not (true|correct)|too vague|(you|that) failed)\b/i;
/** Questions about their own things (calendar, mail, files) are answered from their data, not the web. */
const OWN_DATA =
  /\b(my|our) (calendar|schedule|day|meetings?|inbox|e-?mails?|mail|files?|notes|tasks?|reminders?|plans?|bookings?|trip|flight|order|spending|budget|money|accounts?|bank|health|weight|steps|sleep|meals?)\b|\b(did|have) (i|we)\b/i;

/** What the person's latest words need. */
export function needsOf(text: string): Need[] {
  const words = text.trim();
  if (!words) return [];
  const needs = new Set<Need>();
  const own = OWN_DATA.test(words);
  if (DIRECTIONS.test(words)) needs.add("directions");
  if (SHOPPING.test(words)) needs.add("shopping");
  if (PLACES.test(words) && !needs.has("directions")) needs.add("places");
  if (RECOMMEND.test(words)) needs.add("recommendation");
  if (LIVE.test(words) && !own) needs.add("live");
  if (CORRECTION.test(words)) needs.add("correction");
  return [...needs];
}

/** The needs that should never be answered without a tool in the turn. */
export const CHECKED: readonly Need[] = [
  "directions",
  "places",
  "shopping",
  "live",
  "recommendation",
];

/** The note added to this turn (empty when the message needs nothing special). */
export function coachNote(needs: Need[], tools: CoachTools) {
  if (!needs.length) return "";
  const web = tools.search ? "search_web" : "";
  const lines: string[] = [];
  if (needs.includes("correction"))
    lines.push(
      "They're saying the last answer didn't work. In one short line, say what was missing (for example: you answered from memory, or you can't see inside the building), then get it right with a tool or a different source. Don't repeat the earlier answer or apologise at length.",
    );
  if (needs.includes("directions"))
    lines.push(
      tools.directions
        ? "This needs directions: call get_directions before answering (to = the place as they said it, here = exactly where they say they are). Never give turns, exits or levels from memory."
        : `This needs directions, and there's no directions tool here: give a Google Maps link for the place and${web ? " use search_web for how to get there" : " say you can't give step-by-step directions"}; never give turns from memory.`,
    );
  if (needs.includes("shopping"))
    lines.push(
      web
        ? "They want to buy something: call search_web for shops that sell it near them (the shop's name, its mall and unit number), then show_places. Never answer with a list of malls or neighbourhoods."
        : "They want to buy something: say you can't search shops here, and suggest the kind of shop to ask.",
    );
  if (needs.includes("places") && !needs.includes("shopping"))
    lines.push(
      `This is about places near them: ${tools.nearby ? "use find_nearby for everyday kinds (pharmacy, coffee, ATM, restroom…)" : ""}${tools.nearby && web ? ", or " : ""}${web ? "search_web for anything else" : ""}, before naming any place.`,
    );
  if (needs.includes("recommendation") && web)
    lines.push(
      "A recommendation: base it on what search_web finds (ratings, reviews, recent posts), name your sources, and say why each one fits them.",
    );
  if (needs.includes("live") && web)
    lines.push(
      "This depends on current, real-world facts (hours, prices, schedules, news): check with search_web or the matching tool before answering, and say what you checked.",
    );
  if (needs.some((need) => CHECKED.includes(need)))
    lines.push(
      "If no tool can check it, say plainly what you don't know and how they can find out, rather than guessing.",
    );
  return lines.join(" ");
}

/** The latest words the person wrote in a run's messages (text parts only). */
export function latestWords(messages: { role?: string; content?: unknown }[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content))
      return content
        .map((part) =>
          part && typeof part === "object" && "text" in part
            ? String((part as { text: unknown }).text)
            : "",
        )
        .join(" ");
    return "";
  }
  return "";
}

export const groundingInstructions =
  " Real-world specifics (places and routes, shops and what they sell, prices, opening hours, schedules, current events, facts about people or businesses) come from a tool in this turn or from the person's own data, never from memory alone; general knowledge (how something works, definitions, advice) needs no tool. When something can't be checked, say what you don't know and how they can find out. A per-message coach note (Coach for this message) says what this message needs: follow it.";
