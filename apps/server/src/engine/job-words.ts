/**
 * What a job page says about a job the agent is running: a short "now doing" line made from the
 * tool it is using (never the model's own words), and how its last words are read when a run
 * ends without finish_task or ask_user.
 */

/** "amazon.com" from "https://www.amazon.com/s?k=…". */
export function siteOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

/** What the avatar holds while it works: a magnifier, a globe, a laptop, a page… */
export type NowKind =
  | "search"
  | "browse"
  | "apps"
  | "read"
  | "writing"
  | "mail"
  | "plan"
  | "computer";

/**
 * The line for a tool call, with the prop the avatar holds, or undefined to keep the one before
 * (quick lookups and bookkeeping).
 */
export function nowDoing(
  tool: string,
  args: unknown,
  site?: string,
): { label: string; kind: NowKind } | undefined {
  const format = (args as { format?: unknown } | null)?.format;
  const on = site ? ` ${site}` : " a website";
  const say = (label: string, kind: NowKind) => ({ label, kind });
  switch (tool) {
    case "set_plan":
      return say("Making a plan", "plan");
    case "search_web":
    case "web_search":
      return say("Searching the web", "search");
    case "read_web":
    case "open_page":
      return say(`Looking at${on}`, "browse");
    // Looking at the page and clicking take turns, so they share one line.
    case "look_at_page":
    case "use_page":
      return say(`Using${on}`, "apps");
    case "sign_in_with_saved_login":
    case "enter_sign_in_code":
      return say(`Signing in to${on}`, "apps");
    case "save_downloads":
    case "download_to_files":
    case "save_to_files":
      return say("Saving files", "read");
    case "create_document":
      return say(format === "docx" ? "Writing your document" : "Making your PDF", "writing");
    case "create_spreadsheet":
      return say("Making your spreadsheet", "writing");
    case "create_presentation":
      return say("Making your slides", "writing");
    case "list_files":
    case "read_file":
    case "look_at_image":
    case "import_pdf":
    case "inspect_pdf":
      return say("Reading your files", "read");
    case "fill_pdf":
      return say("Filling in the form", "writing");
    case "read_workspace": {
      const section = (args as { section?: unknown } | null)?.section;
      return section === "calendar"
        ? say("Checking your calendar", "plan")
        : section === "files"
          ? say("Reading your files", "read")
          : section === "all"
            ? say("Checking your email and calendar", "mail")
            : say("Reading your email", "mail");
    }
    case "read_mail_thread":
      return say("Reading your email", "mail");
    case "prepare_email":
    case "email_from_agent":
      return say("Writing an email", "mail");
    case "prepare_event":
      return say("Getting a calendar event ready", "plan");
    case "use_app":
    case "find_app_actions":
      return say("Using your apps", "apps");
    case "run_code":
    case "code_execution":
      return say("Doing the math", "computer");
    case "get_weather":
      return say("Checking the weather", "search");
    case "find_table":
      return say("Looking for a table", "search");
    case "finish_task":
      return say("Finishing up", "writing");
    default:
      return undefined;
  }
}

/**
 * A run that stopped without finish_task or ask_user. Its last words (the text after its last
 * tool call) are a question for the person, the answer itself, or a stop part-way ("Let me check
 * the price:"), which isn't worth showing.
 */
export function readLastWords(words: string): {
  kind: "question" | "answer" | "stopped";
  text: string;
} {
  let text = words.trim();
  // "Let me compile the final answer:" before the answer itself.
  const first = text.split(/\n\s*\n/);
  if (
    first.length > 1 &&
    (first[0]?.length ?? 0) < 240 &&
    /:\s*$/.test(first[0] ?? "") &&
    /\b(let me|i'll|i will|here's|here is|now)\b/i.test(first[0] ?? "")
  )
    text = first.slice(1).join("\n\n").trim();
  if (!text) return { kind: "stopped", text };
  const paragraphs = text.split(/\n\s*\n/);
  const end = paragraphs.at(-1)?.trim() ?? "";
  // A question mark in the last paragraph (not in a link's address) asks the person something,
  // unless it's an offer after a full answer ("Would you like a PDF of this?").
  if (/\?/.test(end.replace(/\bhttps?:\/\/\S+/g, ""))) {
    const before = paragraphs.slice(0, -1).join("\n\n").trim();
    if (
      before.length >= 300 &&
      /^(would you like|do you want|want me to|shall i|should i|if you'd like|let me know)/i.test(
        end,
      )
    )
      return { kind: "answer", text: before };
    return { kind: "question", text };
  }
  const lastLine = end.split("\n").at(-1)?.trim() ?? "";
  const lastSentence =
    end
      .split(/(?<=[.!])\s+/)
      .at(-1)
      ?.trim() ?? "";
  if (
    /(:|\.\.\.|…)$/.test(lastLine) ||
    (text.length < 300 &&
      /^((ok|okay|great|perfect)[,!]?\s+)?((now|next)[,]?\s+)?(let me|i'll|i will|i'm going to|i am going to)\b/i.test(
        lastSentence,
      ))
  )
    return { kind: "stopped", text };
  return { kind: "answer", text };
}
