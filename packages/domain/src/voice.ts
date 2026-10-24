/** The tools whose results a live call shows on screen instead of reading them out. */
export const CALL_DETAIL_TOOLS = [
  "show_on_screen",
  "show_products",
  "show_places",
  "search_web",
  "create_document",
  "create_spreadsheet",
  "create_presentation",
  "look_at_calendar",
  "get_help",
  "manage_chats",
  "meetings",
  "rehearse",
] as const;
/** A conversation to practise: who Neddy plays, what it's about, and what they want out of it. */
export interface RehearsalAsk {
  who: string;
  about: string;
  goal: string;
}
/** Words a person can read the other way round: a number and a few words, never a verdict. */
export interface RehearsalStatsView {
  words: number;
  speakingSeconds: number;
  pace?: number;
  turns: number;
  longestTurn: number;
  fillers: { word: string; count: number }[];
  softeners: { word: string; count: number }[];
  seconds: number;
}
/** Where a speaking pace sits, in words anyone can use. */
export function paceWords(pace: number) {
  if (pace < 105) return "on the slow side, which is fine for a serious point";
  if (pace <= 170) return "a comfortable pace";
  return "quick: slow down for the parts that matter";
}
/** A rehearsal's scorecard as the app gets it. */
export interface RehearsalView extends RehearsalAsk {
  state: "scoring" | "done" | "short";
  stats?: RehearsalStatsView;
  coaching?: { outcome?: string; wentWell?: string; tips: string[] };
}
/**
 * "approval": something saved for their OK, shown as its Approve card. "connect": a button that
 * connects an app (the sign-in link connect_app made). "emails": emails read from Gmail or
 * Outlook, as cards that open in full.
 */
export type CallDetailTool = (typeof CALL_DETAIL_TOOLS)[number] | "approval" | "connect" | "emails";

/**
 * What the agent put on screen for one question during a live call: a long answer, products,
 * places, pictures or a file. Each item is that tool's own result, shown as the chat shows it.
 */
export interface CallDetail {
  /** The hand-over it answered. */
  id: string;
  at: string;
  question: string;
  title: string;
  items: { tool: CallDetailTool; result: unknown }[];
}

/** In a saved call's chat message, the line before a summary of what was shown on screen. */
export const SHOWN_HEADING = "Shown on screen during the call:";

/**
 * What people see when the voice service turns a call away (busy, or the account out of credit).
 * The admin's reason goes to the server's log; the app also stops offering calls until it reopens.
 */
export const LIVE_UNAVAILABLE = "Live talk isn’t available right now. You can type instead.";
/** How the server's answer starts when someone has used this month's live talk minutes. */
export const LIVE_LIMIT = "You’ve used this month’s";
/** What people see when a call can't start because this month's minutes are used up. */
export function liveLimitMessage(limitMinutes: number, nextMonth: string) {
  const minutes = limitMinutes === 1 ? "minute" : "minutes";
  return `${LIVE_LIMIT} ${limitMinutes} ${minutes} of live talk. You’ll get more on ${nextMonth}. Until then, type instead, and tap Listen to hear a reply.`;
}
export const isLiveLimit = (message: string) => message.startsWith(LIVE_LIMIT);
