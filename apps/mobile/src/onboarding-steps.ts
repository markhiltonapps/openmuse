/**
 * Setup with the agent (the first-run questions), in plain words and data. No React here, so a
 * test can run it: the steps, what each asks, how progress is kept, and how answers are tidied.
 */

/** The screens in order. "hello" and "done" aren't numbered; the rest are "Step n of 8". */
export const SETUP_STEPS = [
  "hello",
  "name",
  "home",
  "work",
  "family",
  "connect",
  "focus",
  "history",
  "done",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
const NUMBERED = SETUP_STEPS.filter((step) => step !== "hello");
/** "Step 2 of 8" for a numbered step; "" for hello. */
export function stepLabel(step: SetupStep) {
  const index = (NUMBERED as readonly SetupStep[]).indexOf(step);
  return index < 0 ? "" : `Step ${index + 1} of ${NUMBERED.length}`;
}
export const stepAfter = (step: SetupStep): SetupStep =>
  SETUP_STEPS[Math.min(SETUP_STEPS.indexOf(step) + 1, SETUP_STEPS.length - 1)] as SetupStep;
export const stepBefore = (step: SetupStep): SetupStep =>
  SETUP_STEPS[Math.max(SETUP_STEPS.indexOf(step) - 1, 0)] as SetupStep;

/** What people can ask for most help with (the chips on the "focus" step). */
export const FOCUS_OPTIONS = [
  { id: "email", label: "Email" },
  { id: "calendar", label: "Calendar" },
  { id: "errands", label: "Bookings & errands" },
  { id: "family", label: "Family" },
  { id: "work", label: "Work projects" },
  { id: "health", label: "Health & food" },
  { id: "money", label: "Money" },
] as const;

export interface SetupAnswers {
  name?: string;
  /** The home town, as the person said it or as the server named it from their location. */
  home?: string;
  work?: string;
  family?: string;
  focus?: string[];
  /** "Something else…" on the focus step. */
  other?: string;
}
export interface SetupProgress {
  step: SetupStep;
  answers: SetupAnswers;
  /** "Read, don't speak": the questions are shown, not said. */
  quiet: boolean;
  /** How many times the sheet was closed part-way; after two it stops opening by itself. */
  dismissed: number;
}
export const SETUP_KEY = "openmuse.setup";
const isStep = (value: unknown): value is SetupStep =>
  typeof value === "string" && (SETUP_STEPS as readonly string[]).includes(value);
const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 300) : undefined);
/** Saved progress, or a fresh start when there is none or it can't be read. */
export function readProgress(raw: string | null | undefined): SetupProgress {
  const fresh: SetupProgress = { step: "hello", answers: {}, quiet: false, dismissed: 0 };
  if (!raw) return fresh;
  try {
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const answers = (saved.answers ?? {}) as Record<string, unknown>;
    return {
      step: isStep(saved.step) ? saved.step : "hello",
      answers: {
        name: text(answers.name),
        home: text(answers.home),
        work: text(answers.work),
        family: text(answers.family),
        focus: Array.isArray(answers.focus)
          ? answers.focus.filter((f): f is string => typeof f === "string").slice(0, 10)
          : undefined,
        other: text(answers.other),
      },
      quiet: saved.quiet === true,
      dismissed: typeof saved.dismissed === "number" ? saved.dismissed : 0,
    };
  } catch {
    return fresh;
  }
}

/** "my name is mark." → "Mark"; "call me Jo" → "Jo"; "Mark Hilton" stays. */
export function nameFrom(said: string) {
  const words = said
    .trim()
    .replace(/[.!?,]+$/g, "")
    .replace(/^(?:my name is|my name's|i am|i'm|im|it's|its|call me|this is|just)\s+/i, "")
    .trim();
  if (!words) return "";
  return words
    .split(/\s+/)
    .map((w) => (w === w.toLowerCase() ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
/** A dictated or typed answer, tidied: trimmed, first letter up, no doubled spaces. */
export function tidyAnswer(said: string) {
  const words = said.replace(/\s+/g, " ").trim();
  return words ? words[0]?.toUpperCase() + words.slice(1) : "";
}
/** "email, calendar and work projects" */
export function listWords(items: string[]) {
  const words = items.filter(Boolean);
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
/** What they want help with, as one line for About you: "Email, calendar and work projects". */
export function focusWords(focus: string[] = [], other = "") {
  const labels = FOCUS_OPTIONS.filter((o) => focus.includes(o.id)).map((o) =>
    o.label.toLowerCase(),
  );
  const extra = other.trim();
  const line = listWords(extra ? [...labels, extra] : labels);
  return line ? line[0]?.toUpperCase() + line.slice(1) : "";
}
/** "Mark · Spring, Texas · runs a small AI company · wants help with email and calendar" */
export function knownLine(answers: SetupAnswers) {
  const help = focusWords(answers.focus, answers.other);
  return [
    answers.name,
    answers.home,
    answers.work,
    answers.family ? `family: ${answers.family}` : "",
    help ? `wants help with ${help.toLowerCase()}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
/** What the agent asks on a step, said aloud and shown. */
export function questionFor(step: SetupStep, answers: SetupAnswers, agent = "Neddy") {
  const name = answers.name ? `, ${answers.name}` : "";
  switch (step) {
    case "hello":
      return `Hi, I’m ${agent}. I help with your day: email, calendar, bookings, and more.`;
    case "name":
      return "What should I call you?";
    case "home":
      return `Nice to meet you${name}. Where’s home? The town is enough.`;
    case "work":
      return "What do you do for work? A sentence is plenty.";
    case "family":
      return "Who’s in your family? Names and who they are to you.";
    case "connect":
      return "Connect your email and calendar, and I can start today.";
    case "focus":
      return "What would you like the most help with?";
    case "history":
      return "Have you used ChatGPT or Claude before?";
    case "done":
      return `Here’s what I’ve got so far${name}.`;
  }
}
/** The steps a person answers by voice or typing (the others are taps). */
export const SPOKEN_STEPS: readonly SetupStep[] = ["name", "home", "work", "family", "focus"];

/** A spoken answer that is really a tap: "skip", "back", "that's it". */
export function spokenCommand(said: string): "skip" | "back" | "yes" | undefined {
  const words = said
    .toLowerCase()
    .replace(/[.,!?’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(skip( it| this)?|next|pass|no|none|nothing|no one|nobody|not now)$/.test(words))
    return "skip";
  if (/^(go )?back$/.test(words)) return "back";
  if (/^(thats it|thats right|yes|yes thats it|correct|right|keep it|yep|yeah)$/.test(words))
    return "yes";
  return undefined;
}
/** "I live in Spring, Texas" → "Spring, Texas". */
export function placeFrom(said: string) {
  return tidyAnswer(
    said
      .trim()
      .replace(/[.!?]+$/g, "")
      .replace(/^(?:i live in|i'm in|im in|i am in|it's|its|home is|we're in|were in|in)\s+/i, ""),
  );
}
const FOCUS_WORDS: Record<string, RegExp> = {
  email: /\b(e-?mails?|inbox|mail)\b/,
  calendar: /\b(calendar|schedule|meetings?|appointments?)\b/,
  errands: /\b(bookings?|errands?|reservations?|restaurants?|travel|trips?|shopping)\b/,
  family: /\b(family|kids?|children|school|wife|husband|partner|parents?)\b/,
  work: /\b(work|projects?|business|company|job|clients?)\b/,
  health: /\b(health|food|meals?|diet|exercise|workouts?|gym|weight|sleep)\b/,
  money: /\b(money|budget|bills?|finances?|spending|savings?)\b/,
};
/** What a spoken "email and my calendar, and the garden" means: chips to tick, and the rest. */
export function focusFromSpeech(said: string) {
  const lower = said.toLowerCase();
  const ids = FOCUS_OPTIONS.map((o) => o.id).filter((id) => FOCUS_WORDS[id]?.test(lower));
  // Anything that matched no chip stays as "something else", in their words.
  const rest = ids.length
    ? ""
    : tidyAnswer(said.replace(/^(?:help (?:me )?with|mostly|probably|i'd say|id say)\s+/i, ""));
  return { ids, other: rest };
}
