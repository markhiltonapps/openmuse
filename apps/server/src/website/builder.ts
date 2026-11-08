import {
  checkSite,
  type Parts,
  type Problem,
  type RenderMetrics,
  renderProblems,
} from "./checks.ts";
import { assembleSite } from "./kit.ts";
import { briefPrompt, fixPrompt, parseReply, websiteSystemPrompt } from "./prompt.ts";

export interface RenderedPage {
  metrics: RenderMetrics;
  jpeg: string;
}

export interface BuildDeps {
  /** One reply from the building model (already set up with its plan and usage meter). */
  complete: (system: string, prompt: string) => Promise<string>;
  /** Draws the page and measures it, when a browser is available. */
  render?: (html: string) => Promise<RenderedPage[] | undefined>;
  /** Says how it's going ("Writing the page", "Checking it on a phone"). */
  progress?: (stage: string) => void | Promise<void>;
  /** The most times the model is asked (the first write and then fixes). */
  rounds?: number;
}

export interface BuiltSite {
  html: string;
  parts: Parts;
  /** What's still wrong after the last round; empty is a clean page. */
  problems: Problem[];
  rounds: number;
  /** Whether it was drawn and measured (no browser means only the code checks ran). */
  measured: boolean;
  previews: RenderedPage[];
}

/**
 * Brief in, finished page out: the model writes it inside the house kit, the code checks the facts,
 * structure and styling, a browser draws it at phone and desktop width and measures it, and the
 * model fixes what's found. The best page seen is kept, so a bad round can't make it worse.
 */
export async function buildWebsite(brief: string, deps: BuildDeps): Promise<BuiltSite> {
  const rounds = Math.max(1, deps.rounds ?? 3);
  // A status update that fails must never fail a build that has already cost money.
  const progress = async (stage: string) => {
    try {
      await deps.progress?.(stage);
    } catch {
      // The status line is only a nicety.
    }
  };
  let best: BuiltSite | undefined;
  let prompt = briefPrompt(brief);
  let reply = "";
  let ran = 0;
  const unsafe = (site: { problems: Problem[] }) => site.problems.some((p) => p.safety);
  const errors = (site: { problems: Problem[] }) =>
    site.problems.filter((p) => p.level === "error").length;
  for (let round = 1; round <= rounds; round++) {
    ran = round;
    await progress(round === 1 ? "Writing the page" : "Fixing what the checks found");
    reply = await deps.complete(websiteSystemPrompt, prompt);
    const parsed = parseReply(reply);
    if ("error" in parsed) {
      if (round === rounds) break;
      prompt = `${briefPrompt(brief)}\n\nYour last reply couldn't be used: ${parsed.error} Reply again in exactly the three-part format.`;
      continue;
    }
    const { parts } = parsed;
    const html = assembleSite(parts);
    await progress("Checking the facts and the code");
    const problems = checkSite(parts, brief, html);
    let previews: RenderedPage[] = [];
    let measured = false;
    // Drawn only once the code checks pass: no point photographing a page that must change anyway.
    if (deps.render && !problems.some((p) => p.level === "error")) {
      await progress("Checking it on a phone and a computer");
      previews = (await deps.render(html).catch(() => undefined)) ?? [];
      measured = previews.length > 0;
      problems.push(...renderProblems(previews.map((p) => p.metrics)));
    }
    const site: BuiltSite = { html, parts, problems, rounds: round, measured, previews };
    if (
      !best ||
      (unsafe(best) && !unsafe(site)) ||
      (!unsafe(site) && errors(site) < errors(best)) ||
      (errors(site) === errors(best) && site.measured && !best.measured)
    )
      best = site;
    if (!errors(site)) {
      best = site;
      break;
    }
    if (round < rounds) prompt = fixPrompt(brief, reply, problems);
  }
  if (!best)
    throw new Error("The model never produced a page in the right format. Try again in a minute.");
  // A page that could run code or send the viewer away is never handed back, whatever else is right with it.
  if (unsafe(best))
    throw new Error(
      "The page kept including something unsafe (a script, a redirect or an outside load), so it was thrown away. Try again.",
    );
  return { ...best, rounds: ran };
}
