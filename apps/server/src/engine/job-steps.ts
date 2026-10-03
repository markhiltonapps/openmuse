import { createHash } from "node:crypto";

/**
 * The steps a job has already done in other apps (approved and run, or allowed without asking).
 * A job starts its work again after each approval, so it is told what's done and can't do the
 * same thing twice: it once made the same Google Drive spreadsheet four times, asking each time.
 */

export interface DoneStep {
  app: string;
  tool: string;
  title: string;
  /** What makes it the same step again (see stepIdentity). */
  same: string;
  /** What it returned, cut short. */
  result?: string;
  at: string;
}

const MAX_STEPS = 30;
const SHORT = 200;

/**
 * Two steps are the same thing when they're the same tool in the same app with the same short
 * details (names, recipients, subjects, times, ids), whatever the agent wrote around them: long
 * text (a file's contents, an email's body) and its own summary change every time it writes them.
 */
export function stepIdentity(app: string, tool: string, args: unknown) {
  const short: Record<string, unknown> = {};
  const walk = (value: unknown, path: string) => {
    if (value === null || typeof value === "boolean" || typeof value === "number")
      short[path] = value;
    else if (typeof value === "string") {
      if (value.length <= SHORT) short[path] = value.trim().toLowerCase();
    } else if (Array.isArray(value))
      for (const [index, item] of value.entries()) walk(item, `${path}[${index}]`);
    else if (typeof value === "object")
      for (const [key, item] of Object.entries(value as Record<string, unknown>))
        walk(item, path ? `${path}.${key}` : key);
  };
  walk(args, "");
  const sorted = Object.fromEntries(Object.entries(short).sort(([a], [b]) => a.localeCompare(b)));
  return `${app.toLowerCase()}:${tool.toUpperCase()}:${JSON.stringify(sorted)}`;
}

/** The review's key: app, tool and arguments, never the agent's own one-line summary. */
export function appActionKey(data: { app: string; tool: string; arguments?: unknown }) {
  return createHash("sha256")
    .update(JSON.stringify([data.app.toLowerCase(), data.tool.toUpperCase(), data.arguments ?? {}]))
    .digest("hex");
}

const stepsOf = (state: Record<string, unknown>): DoneStep[] =>
  Array.isArray(state.done) ? (state.done as DoneStep[]) : [];

/** The job's state with this step added to what's done. */
export function rememberStep(
  state: Record<string, unknown>,
  step: { app: string; tool: string; title: string; args: unknown; result?: unknown },
) {
  const same = stepIdentity(step.app, step.tool, step.args);
  const result =
    step.result === undefined
      ? undefined
      : (typeof step.result === "string" ? step.result : JSON.stringify(step.result)).slice(
          0,
          1500,
        );
  const done = stepsOf(state).filter((item) => item.same !== same);
  done.push({
    app: step.app,
    tool: step.tool,
    title: step.title,
    same,
    ...(result ? { result } : {}),
    at: new Date().toISOString(),
  });
  return { ...state, done: done.slice(-MAX_STEPS) };
}

/** The earlier step this one repeats, if the job has done it already. */
export function findDone(state: Record<string, unknown>, app: string, tool: string, args: unknown) {
  const same = stepIdentity(app, tool, args);
  return stepsOf(state).find((step) => step.same === same);
}

/** For the job's prompt: what's done, so it carries on instead of starting again. */
export const doneStepsInstructions =
  " The saved state's `done` list is what this job has already done in the person's apps (each approved and run, or allowed without asking): never do any of those again, and use their results (a file's link, an id) to carry on from where it got to. If an approved step failed, don't try it again the same way: say what went wrong with ask_user.";
