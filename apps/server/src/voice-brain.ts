import { randomUUID } from "node:crypto";
import { type BaseEvent, EventType, type Message, type RunAgentInput } from "@ag-ui/core";
import type { Observable } from "rxjs";
import type { AgentTask } from "../../../packages/domain/src/agent.ts";
import type { ActionProposal } from "../../../packages/domain/src/index.ts";
import type { DayEvent } from "./calendar-today.ts";
import type { Store } from "./db.ts";
import { nowDoing } from "./engine/job-words.ts";
import { localInstant } from "./engine/routines.ts";
import type { HealthEntry } from "./health.ts";
import { localDay } from "./health.ts";
import type { LiveAnswer, VoiceSession, VoiceTurn } from "./voice-live.ts";

/**
 * Live voice's brain: a snapshot of the person's day for the voice to start with, and answers to
 * what the voice hands over ("hold on, let me check"), from the same chat agent and tools as the
 * typed chat.
 */
export interface VoiceBrain {
  db: Store;
  /** Runs the person's chat agent once (it isn't saved to any chat). */
  run: (owner: string, input: RunAgentInput) => Observable<BaseEvent>;
  timeZone: (owner: string) => Promise<string>;
  name: (owner: string) => Promise<string>;
  /** The last week's meals and workouts. */
  health: (owner: string) => Promise<HealthEntry[]>;
  calendar: (owner: string) => Promise<DayEvent[]>;
  reminders: (owner: string) => Promise<{ text: string; dueAt: string; when?: string }[]>;
  /** The person's main chat, as the app last saved it. */
  chat: (owner: string) => Promise<unknown[]>;
  /** Tells the person something is waiting for them (a bell entry and a push that opens it). */
  notify: (
    owner: string,
    title: string,
    body: string,
    key: string,
    actionId?: string,
  ) => Promise<unknown>;
  now?: () => number;
}

/** How a call's answers are given: spoken, short, and honest about what waits for approval. */
export const VOICE_RULES =
  "The person is talking with you out loud in a live voice call, maybe while driving, and a voice reads your reply to them. Reply in one to three short spoken sentences in plain, everyday words: no lists, markdown, links, emoji or long numbers. Use your tools as usual to look things up; never guess. Set reminders and notes straight away. If you need something from them first, ask one short question. Anything that sends, books, buys or changes something for other people is saved for their approval: say it's waiting for their OK in the app. If the work will take more than about half a minute (comparing products, research across several sites, documents), start it with delegate_task and say you'll let them know when it's done. The latest messages are the call so far, and the last one is what they just asked; earlier ones are from their typed chat.";

/** A short, plain progress note for a tool the chat agent is using. */
export function voiceNote(tool: string, args: unknown) {
  switch (tool) {
    case "search_mail":
    case "read_mail_thread":
      return "Checking your email";
    case "find_app_actions":
    case "use_app":
    case "list_app_events":
    case "list_connected_apps":
      return "Checking your connected apps";
    case "browse_web":
      return "Reading a web page";
    case "get_food_log":
      return "Checking your food log";
    case "log_meal":
      return "Adding it to your food log";
    case "list_reminders":
      return "Checking your reminders";
    case "set_reminder":
    case "change_reminder":
    case "cancel_reminder":
      return "Updating your reminders";
    case "list_commitments":
      return "Checking what's coming up";
    case "track_commitment":
      return "Noting it down";
    case "look_up_person":
    case "get_about_person":
      return "Looking at your notes on people";
    case "read_past_chat":
    case "search_past_chats":
    case "search_earlier_chat":
      return "Looking back through your chats";
    case "agent_status":
      return "Checking your jobs";
    case "get_weather":
      return "Checking the weather";
    case "delegate_task":
      return "Starting a job";
    case "email_from_agent":
      return "Writing the email";
    default:
      return nowDoing(tool, args)?.label ?? "Looking into it";
  }
}

const STATUS: Partial<Record<AgentTask["status"], string>> = {
  queued: "starting",
  running: "working on it now",
  waiting_input: "needs their answer",
  waiting_approval: "waiting for their OK",
  scheduled: "scheduled",
  paused: "paused",
  succeeded: "done",
  failed: "couldn't finish",
};

/** Chat messages as plain {role, content} text, without tool calls. */
function chatLines(messages: unknown[]) {
  return messages.flatMap((raw) => {
    const message = raw as { id?: unknown; role?: unknown; content?: unknown };
    if (message.role !== "user" && message.role !== "assistant") return [];
    if (typeof message.content !== "string" || !message.content.trim()) return [];
    return [
      {
        id: typeof message.id === "string" ? message.id : randomUUID(),
        role: message.role,
        content: message.content.trim(),
      },
    ];
  });
}
const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;

/** Within a time limit, or the fallback: the voice shouldn't wait on a slow calendar. */
function soon<T>(promise: Promise<T>, fallback: T, ms = 2500) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms).unref?.()),
  ]);
}

/** Today in a few short lines: meals, calendar, reminders, jobs and the last few chat messages. */
export async function voiceToday(brain: VoiceBrain, owner: string) {
  const now = brain.now?.() ?? Date.now();
  const zone = await soon(brain.timeZone(owner), "UTC");
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
    });
  const today = localDay(now, zone);
  const [health, events, reminders, tasks, chat, name] = await Promise.all([
    // Unknown (a slow or failed read) is left out, rather than said to be empty.
    soon(brain.health(owner), undefined as HealthEntry[] | undefined),
    soon(brain.calendar(owner), [] as DayEvent[]),
    soon(brain.reminders(owner), []),
    soon(brain.db.list<AgentTask>(owner, "tasks"), [] as AgentTask[]),
    soon(brain.chat(owner), [] as unknown[]),
    soon(brain.name(owner), "Neddy"),
  ]);
  const parts: string[] = [];
  const todays = (health ?? [])
    .filter((entry) => localDay(entry.at, zone) === today)
    .sort((a, b) => a.at.localeCompare(b.at));
  const meals = todays.filter((entry) => entry.kind === "meal");
  if (meals.length) {
    const total = (key: "calories" | "protein") =>
      Math.round(meals.reduce((sum, entry) => sum + (entry[key] ?? 0), 0));
    parts.push(
      [
        "Meals logged today:",
        ...meals.map(
          (meal) =>
            `- ${meal.meal ? meal.meal[0]?.toUpperCase() + meal.meal.slice(1) : "Meal"} at ${time(meal.at)}: ${meal.title}${meal.calories ? ` (about ${meal.calories} calories)` : ""}`,
        ),
        `Total so far: about ${total("calories")} calories, ${total("protein")} g protein.`,
      ].join("\n"),
    );
  } else if (health) parts.push("Meals logged today: none yet.");
  const workouts = todays.filter((entry) => entry.kind === "workout");
  if (workouts.length)
    parts.push(
      [
        "Workouts today:",
        ...workouts.map(
          (workout) =>
            `- ${workout.title} at ${time(workout.at)}${workout.minutes ? ` (${workout.minutes} min)` : ""}`,
        ),
      ].join("\n"),
    );
  if (events.length)
    parts.push(
      [
        "Calendar today:",
        ...events
          .slice(0, 12)
          .map(
            (event) =>
              `- ${event.allDay ? "All day" : time(event.start)}: ${event.title}${event.location ? ` at ${event.location}` : ""}`,
          ),
      ].join("\n"),
    );
  const dayAhead = reminders.filter((reminder) => {
    const due = Date.parse(reminder.dueAt);
    return due >= now && due - now <= 24 * 60 * 60 * 1000;
  });
  if (dayAhead.length)
    parts.push(
      [
        "Reminders in the next day:",
        ...dayAhead
          .slice(0, 8)
          .map((reminder) => `- ${reminder.when ?? time(reminder.dueAt)}: ${reminder.text}`),
      ].join("\n"),
    );
  const jobs = tasks
    .filter((task) =>
      task.status === "succeeded" || task.status === "failed"
        ? now - Date.parse(task.updatedAt) <= 24 * 60 * 60 * 1000
        : task.status !== "cancelled",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  if (jobs.length)
    parts.push(
      [
        "Jobs (running, waiting, or finished in the last day):",
        ...jobs.map((task) => `- ${task.title}: ${STATUS[task.status] ?? task.status}`),
      ].join("\n"),
    );
  const recent = chatLines(chat).slice(-8);
  if (recent.length)
    parts.push(
      [
        "The last few messages in their typed chat:",
        ...recent.map(
          (message) => `${message.role === "user" ? "Them" : name}: ${clip(message.content, 280)}`,
        ),
      ].join("\n"),
    );
  return clip(parts.join("\n\n"), 5000);
}

/** Answers a hand-over with the chat agent, sending progress notes as it uses its tools. */
export function voiceAnswer(brain: VoiceBrain): LiveAnswer {
  return async ({ owner, sessionId, delegationId, turns, progress, signal }) => {
    const [chat, name] = await Promise.all([
      brain.chat(owner).catch(() => [] as unknown[]),
      brain.name(owner).catch(() => "Neddy"),
    ]);
    const typed = chatLines(chat)
      .slice(-16)
      .map((message) => ({ ...message, content: clip(message.content, 2000) }));
    const spoken = turns.map((turn, index) => ({
      // The question's id keys this run's actions, so asking again isn't mistaken for a repeat.
      id:
        index === turns.length - 1
          ? `voice-${sessionId}-${delegationId}`
          : `voice-${sessionId}-${index}`,
      role: turn.role,
      content: turn.text,
    }));
    const input: RunAgentInput = {
      threadId: `voice-${sessionId}`,
      runId: randomUUID(),
      messages: [...typed, ...spoken] as Message[],
      tools: [],
      context: [{ description: "This is a live voice call", value: VOICE_RULES }],
      state: {},
      forwardedProps: {},
    };
    return await new Promise<string>((resolve, reject) => {
      let words = "";
      let afterTool = false;
      let failure = "";
      const calls = new Map<string, { name: string; args: string }>();
      const reviews: string[] = [];
      const subscription = brain.run(owner, input).subscribe({
        next: (event) => {
          const e = event as BaseEvent & {
            delta?: unknown;
            toolCallId?: string;
            toolCallName?: string;
            content?: unknown;
            message?: unknown;
          };
          if (
            (e.type === EventType.TEXT_MESSAGE_CHUNK ||
              e.type === EventType.TEXT_MESSAGE_CONTENT) &&
            typeof e.delta === "string"
          ) {
            // Only what it says after its last tool is the answer; earlier words are narration.
            if (afterTool) words = "";
            afterTool = false;
            words += e.delta;
          }
          if (e.type === EventType.TOOL_CALL_START && e.toolCallId) {
            afterTool = true;
            calls.set(e.toolCallId, { name: e.toolCallName ?? "", args: "" });
          }
          if (e.type === EventType.TOOL_CALL_ARGS && e.toolCallId && typeof e.delta === "string") {
            const call = calls.get(e.toolCallId);
            if (call) call.args += e.delta;
          }
          if (e.type === EventType.TOOL_CALL_END && e.toolCallId) {
            const call = calls.get(e.toolCallId);
            if (call) {
              let args: unknown = {};
              try {
                args = JSON.parse(call.args || "{}");
              } catch {
                // Partial arguments: the note is still right without them.
              }
              progress(voiceNote(call.name, args));
            }
          }
          if (e.type === EventType.TOOL_CALL_RESULT && typeof e.content === "string") {
            try {
              const result = JSON.parse(e.content) as { status?: unknown; actionId?: unknown };
              if (result.status === "awaiting_review" && typeof result.actionId === "string")
                reviews.push(result.actionId);
            } catch {
              // Not JSON; nothing to approve.
            }
          }
          if (e.type === EventType.RUN_ERROR) failure = String(e.message ?? "The agent stopped.");
        },
        error: reject,
        complete: () => {
          // Things saved for approval on a call wait until tonight, and get a bell entry that
          // says what they are.
          void Promise.all(
            reviews.map(async (actionId) => {
              const title = await holdForTonight(brain, owner, actionId).catch(() => undefined);
              await brain.notify(
                owner,
                "Ready for your review",
                title
                  ? `${title}, from your call. It waits for your OK in Activity.`
                  : `${name} saved something from your call. It waits for your OK in Activity.`,
                `review:${actionId}`,
                actionId,
              );
            }),
          )
            .catch(() => undefined)
            .finally(() => {
              if (failure && !words.trim()) reject(new Error(failure));
              else resolve(words.trim());
            });
        },
      });
      signal.addEventListener(
        "abort",
        () => {
          subscription.unsubscribe();
          reject(new Error("stopped"));
        },
        { once: true },
      );
    });
  };
}

/**
 * Something saved for approval during a call waits until midnight where the person is (at least
 * two hours), not the usual 30 minutes: they may be driving. Returns its title.
 */
export async function holdForTonight(brain: VoiceBrain, owner: string, actionId: string) {
  const action = await brain.db.get<ActionProposal>(owner, "actions", actionId);
  if (action?.status !== "awaiting_review") return action?.title;
  const zone = await brain.timeZone(owner);
  const now = brain.now?.() ?? Date.now();
  const tomorrow = new Date(Date.parse(`${localDay(now, zone)}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const until = Math.max(localInstant(`${tomorrow}T00:00`, zone), now + 2 * 60 * 60 * 1000);
  if (until > Date.parse(action.expiresAt))
    await brain.db.compareAndSwap(
      owner,
      "actions",
      actionId,
      { status: "awaiting_review", expiresAt: action.expiresAt },
      { expiresAt: new Date(until).toISOString() },
    );
  return action.title;
}

/** The id a saved call has as a chat message, so the app can show it as a call. */
export const SPOKEN_PREFIX = "spoken-";

/** A finished call as one chat message: a heading, then who said what. */
export function spokenCallText(session: VoiceSession, name: string, timeZone: string) {
  const minutes = Math.round(session.seconds / 60);
  const length =
    session.seconds < 60
      ? "under 1 min"
      : minutes < 60
        ? `${minutes} min`
        : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  const at = new Date(session.startedAt).toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const lines = session.turns.map((turn: VoiceTurn) =>
    `${turn.role === "user" ? "You" : name}: ${turn.text}`.replace(/\s+/g, " "),
  );
  // A very long call keeps its end, which is what's usually wanted next.
  while (lines.join("\n").length > 8000 && lines.length > 1) lines.shift();
  return `Spoken conversation · ${length} · ${at}\n\n${lines.join("\n")}`;
}
