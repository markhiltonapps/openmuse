/**
 * AI models by their everyday names, shared by the server (what the agent says) and the app (what
 * the Models card and Usage show).
 */
// A non-breaking hyphen keeps "GPT-6.1" on one line.
const NAMES: Record<string, string> = {
  "gpt-6.1-sol": "GPT‑6.1 Sol",
  "deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
};

/** "GPT-6.1 Sol", "Claude Haiku 4.5" (from anthropic/claude-haiku-4-5-20251001), else its plain ID. */
export function modelLabel(model?: string | null) {
  if (!model) return "";
  const id = model
    .trim()
    .replace(/^openrouter\//i, "")
    .replace(/^[^/]+\//, "");
  if (NAMES[id]) return NAMES[id];
  const claude = /^claude-([a-z]+)-(\d+)(?:[-.](\d))?(?:-\d{8})?$/i.exec(id);
  if (claude)
    return `Claude ${claude[1]?.[0]?.toUpperCase()}${claude[1]?.slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  return id;
}

/** What each kind of AI use is called on the Usage card and when the agent talks about costs. */
export const USAGE_KINDS: Record<string, string> = {
  chat: "Chat",
  background: "Background jobs and routines",
  search: "Web searches",
  feed: "Feed",
  pictures: "Looking at pictures",
  import: "Memory import",
  avatar: "Avatar design",
  ideas: "Ideas",
  summary: "Summarizing long chats",
  code: "Running code",
  recipes: "Dinner recipes",
  voice: "Live voice",
};

/** How hard a model thinks, as the Models card and the agent call it. */
export const EFFORT_LABELS = {
  low: "Quick",
  medium: "Some thinking",
  high: "Thinks hard",
} as const;
