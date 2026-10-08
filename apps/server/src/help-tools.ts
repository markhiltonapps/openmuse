import { z } from "zod";
import { APP_PLACES } from "../../../packages/domain/src/app-places.ts";
import {
  HELP_TOPICS,
  type HelpTopic,
  helpText,
  helpTopic,
  sayText,
  searchHelp,
} from "../../../packages/domain/src/help.ts";

/**
 * "How do I…?" answered from the app's help guide (packages/domain/src/help.ts), the same pages
 * as its Help screen, so the agent's steps match what people see. The chat and a call show the
 * topic as a card that opens it in Help.
 */
export const helpToolInstructions =
  " When the person asks how to do something in this app, where something is, what a button or screen is for, or why something in the app isn't working, call get_help with their question and answer from the topic it returns, in a sentence or two (its card shows the steps and opens it in Help). If you could just do it for them (the topic's theyCanSay, or something your tools do), offer to do it now (\"Want me to connect Gmail for you?\") instead of walking them through the taps. On a call, say that offer or the one step that matters; the card has the rest. If nothing fits, say so; never make up steps or screens.";

/** A topic in the agent's words: steps and text with their name, without formatting marks. */
function forAgent(topic: HelpTopic, agent: string) {
  const plain = (text: string) => helpText(text, agent).replaceAll("**", "");
  return {
    id: topic.id,
    title: plain(topic.title),
    summary: plain(topic.summary),
    ...(topic.steps ? { steps: topic.steps.map(plain) } : {}),
    ...(topic.body ? { more: topic.body.map(plain) } : {}),
    // A line that only works somewhere ("on a call") says where, so it isn't offered out of the blue.
    ...(topic.say
      ? {
          theyCanSay: topic.say.map((line) => {
            const said = helpText(sayText(line), agent);
            return typeof line === "object" && "where" in line ? `${said} (${line.where})` : said;
          }),
        }
      : {}),
    ...(topic.place
      ? { where: `${APP_PLACES[topic.place].where} › ${APP_PLACES[topic.place].name}` }
      : {}),
  };
}

export function helpToolSpecs(
  owner: string,
  deps: {
    agentName: (owner: string) => Promise<string>;
    isAdmin?: (owner: string) => Promise<boolean>;
  },
) {
  return [
    {
      name: "get_help",
      description:
        "Look up how to do something in this app in its help guide: give the person's question (or a topic id). Returns the best matching topics with their steps. Use it whenever they ask how to do something, what the app or you can do, where a setting is, or how a feature works, rather than answering from memory: features change (for example approving by voice, “brief me”, urgent alerts on calls, sharing their location, reminders that follow the calendar, AI models and costs).",
      parameters: z.object({
        question: z.string().trim().min(1).max(300).describe("What they asked, in their words"),
        topic: z.string().trim().max(60).optional().describe("A topic id, when you know it"),
      }),
      execute: async ({ question, topic }: { question: string; topic?: string }) => {
        const [agent, admin] = await Promise.all([
          deps.agentName(owner).catch(() => "Neddy"),
          deps.isAdmin?.(owner).catch(() => false) ?? Promise.resolve(false),
        ]);
        const asked = topic ? helpTopic(topic) : undefined;
        const found = [
          ...(asked && (admin || !asked.admin) ? [asked] : []),
          ...searchHelp(question, { admin, limit: 3 }),
        ].filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index);
        const topics = found.slice(0, 2).map((item) => forAgent(item, agent));
        return topics.length
          ? { topics }
          : {
              topics: [],
              note: `The help guide has nothing on that. Say so, and offer to try it with them. It has ${HELP_TOPICS.length} topics, such as connecting apps, calls, jobs, Spaces and approvals.`,
            };
      },
    },
  ];
}
