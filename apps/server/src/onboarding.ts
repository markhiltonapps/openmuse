/**
 * The email that carries the steps for bringing ChatGPT or Claude history: the setup's "Email me
 * the steps". The words come from the Help topic, so the two can't drift apart.
 */
import { helpText, helpTopic } from "../../../packages/domain/src/help.ts";

const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** "**Bold**" as HTML, and as plain words. */
const html = (text: string) => esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "$1");

export function historyStepsEmail(agent: string, appUrl?: string) {
  const topic = helpTopic("import-chatgpt");
  const steps = (topic?.steps ?? []).map((step) => helpText(step, agent));
  const intro = `Here are the steps for bringing your ChatGPT or Claude chats to ${agent}, so it can search them and pick up your preferences, your projects and the people you mention. It’s easiest from a computer.`;
  const where = appUrl ? `Open ${agent}: ${appUrl}` : "";
  const text = [
    intro,
    "",
    ...steps.map((step, i) => `${i + 1}. ${plain(step)}`),
    "",
    where,
    `Nothing happens until you upload the file; ${agent} never asks ChatGPT or Claude for it.`,
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
  const body = [
    `<p>${esc(intro)}</p>`,
    `<ol>${steps.map((step) => `<li>${html(step)}</li>`).join("")}</ol>`,
    where ? `<p><a href="${esc(appUrl as string)}">Open ${esc(agent)}</a></p>` : "",
    `<p>Nothing happens until you upload the file; ${esc(agent)} never asks ChatGPT or Claude for it.</p>`,
  ].join("");
  return {
    subject: `Bringing your ChatGPT or Claude history to ${agent}`,
    text,
    html: `<div style="font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a">${body}</div>`,
  };
}
