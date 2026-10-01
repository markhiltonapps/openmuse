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
] as const;
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
