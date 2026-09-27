/** What the agent is visibly doing, for the avatar's prop and the status line under it. */
export type ActivityKind =
  | "thinking"
  | "writing"
  | "search"
  | "browse"
  | "read"
  | "mail"
  | "apps"
  | "plan"
  | "computer";
export interface Activity {
  kind: ActivityKind;
  label: string;
}

const quoted = (value: unknown, max = 48) => {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return "";
  return `“${text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text}”`;
};
const host = (value: unknown) => {
  try {
    return new URL(String(value)).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const appName = (value: unknown) =>
  typeof value === "string" && value.trim()
    ? value
        .trim()
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "";
/** App named by an action slug such as OUTLOOK_SEND_EMAIL. */
const slugApp = (value: unknown) =>
  typeof value === "string" && /^[A-Z0-9]+_/.test(value)
    ? appName(value.split("_")[0]?.toLowerCase())
    : "";

/** Arguments of a tool call that may still be streaming in. */
export function toolArguments(raw: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function toolActivity(name: string, args: Record<string, unknown> = {}): Activity {
  switch (name) {
    case "search_web":
    case "web_search": {
      const query = quoted(args.query);
      return {
        kind: "search",
        label: query ? `Searching the web for ${query}…` : "Searching the web…",
      };
    }
    case "browse_web": {
      const site = host(args.url);
      return { kind: "browse", label: site ? `Reading ${site}…` : "Reading a web page…" };
    }
    case "list_files":
      return { kind: "read", label: "Looking through your files…" };
    case "read_file":
      return { kind: "read", label: "Reading your document…" };
    case "log_meal":
      return { kind: "writing", label: "Logging your meal…" };
    case "create_workout":
      return { kind: "plan", label: "Planning your workout…" };
    case "create_document":
      return { kind: "writing", label: "Writing your document…" };
    case "look_at_image":
      return { kind: "read", label: "Looking at your picture…" };
    case "search_mail":
      return {
        kind: "mail",
        label: quoted(args.query)
          ? `Searching your email for ${quoted(args.query)}…`
          : "Checking your email…",
      };
    case "email_from_agent":
      return { kind: "mail", label: "Writing an email for you to review…" };
    case "read_mail_thread":
      return { kind: "mail", label: "Reading an email…" };
    case "find_app_actions":
      return { kind: "apps", label: "Finding the right app…" };
    case "list_connected_apps":
      return { kind: "apps", label: "Checking your connected apps…" };
    case "connect_app": {
      const app = appName(args.app);
      return { kind: "apps", label: app ? `Connecting ${app}…` : "Connecting an app…" };
    }
    case "use_app": {
      const app = appName(args.app) || slugApp(args.tool);
      return { kind: "apps", label: app ? `Working in ${app}…` : "Working in your apps…" };
    }
    case "delegate_task":
      return { kind: "plan", label: "Setting up a task…" };
    case "create_routine":
      return { kind: "plan", label: "Setting up a routine…" };
    case "create_goal":
      return { kind: "plan", label: "Saving your goal…" };
    case "watch_page":
      return { kind: "browse", label: "Setting up a watch…" };
    case "remember_fact":
    case "suggest_memory":
      return { kind: "writing", label: "Making a note…" };
    case "agent_status":
      return { kind: "plan", label: "Checking on your tasks…" };
    default:
      if (/computer/.test(name)) return { kind: "computer", label: "Using the computer…" };
      return { kind: "thinking", label: "Working on it…" };
  }
}

interface ChatMessage {
  id: string;
  role: string;
  content?: unknown;
  toolCalls?: { id: string; function: { name: string; arguments?: string } }[];
  toolCallId?: string;
}
/** What the agent is doing in the reply after the latest message from the person. */
export function chatActivity(messages: ChatMessage[], replying: boolean): Activity | undefined {
  if (!replying) return undefined;
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  const reply = messages.slice(lastUser + 1);
  const answered = new Set(reply.filter((m) => m.role === "tool").map((m) => m.toolCallId));
  const calls = reply.flatMap((m) => m.toolCalls ?? []);
  const open = calls.filter((call) => !answered.has(call.id)).at(-1);
  if (open) return toolActivity(open.function.name, toolArguments(open.function.arguments));
  const last = reply.at(-1);
  if (last?.role === "assistant" && typeof last.content === "string" && last.content.trim())
    return { kind: "writing", label: "Writing a reply…" };
  return { kind: "thinking", label: "Thinking…" };
}

/** A background task's current step, shown when the chat is idle. */
export function taskActivity(task: {
  kind: string;
  title: string;
  plan: { title: string; status: string }[];
}): Activity {
  const step = task.plan.find((s) => s.status === "running")?.title ?? task.title;
  const kind: ActivityKind =
    task.kind === "monitor"
      ? "browse"
      : task.kind === "document"
        ? "read"
        : /search|research|find|look up|compare/i.test(step)
          ? "search"
          : /email|mail|inbox/i.test(step)
            ? "mail"
            : /read|review|document|pdf/i.test(step)
              ? "read"
              : /plan|organi[sz]e|schedule/i.test(step)
                ? "plan"
                : "apps";
  return { kind, label: `${step.replace(/[.…]+$/, "")}…` };
}
