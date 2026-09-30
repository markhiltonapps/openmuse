/**
 * The email sent when a job the person handed to the agent finishes, needs their answer, or
 * can't be finished: what happened in a few lines, and a button that opens the job in the app.
 * Same look as the sign-in email: inline styles and tables, PNG pictures served by the web app.
 */
export interface JobEmail {
  outcome: "done" | "question" | "failed";
  /** What the person asked for: the job's title. */
  title: string;
  /** The agent's summary, question, or what went wrong (Markdown is flattened). */
  body: string;
  agentName: string;
  /** The web app, which serves the pictures and opens the job. */
  appUrl: string;
  taskId: string;
  /** Files the job made, by name. */
  files?: string[];
}

const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
const INK = "#11191C";
const MUTED = "#5F686D";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
/** How much of the summary goes in the email; the rest is one tap away. */
const MAX_BODY = 900;

/** Markdown as plain lines: no **, #, or [text](link) syntax, bullets as "•". */
export function plainLines(markdown: string) {
  return lines(
    markdown
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$)/g, "$1$2"),
  );
}
/** Headings and bullets tidied into lines, keeping links and bold for the HTML part. */
function lines(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^\s*[-*·]\s+/, "• ")
        .trimEnd(),
    )
    .filter((line, index, lines) => line.trim() || (index > 0 && lines[index - 1]?.trim()))
    .join("\n")
    .trim();
}

/** One block of the email: text escaped, [links](…) as links and **bold** as bold. */
function inline(text: string) {
  const parts: string[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*/g)) {
    const at = match.index ?? 0;
    parts.push(esc(text.slice(last, at)));
    parts.push(
      match[2]
        ? `<a href="${esc(match[2])}" style="color:#1473C8;text-decoration:underline">${esc(match[1] ?? "")}</a>`
        : `<b>${esc(match[3] ?? "")}</b>`,
    );
    last = at + match[0].length;
  }
  parts.push(esc(text.slice(last)));
  return parts.join("");
}

function shorten(text: string) {
  if (text.length <= MAX_BODY) return { text, cut: false };
  const cut = text.slice(0, MAX_BODY);
  const end = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return { text: `${cut.slice(0, end > MAX_BODY / 2 ? end + 1 : MAX_BODY).trimEnd()}…`, cut: true };
}

function button(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr><td bgcolor="${INK}" style="border-radius:999px;background:${INK}"><a href="${href}" style="display:inline-block;padding:16px 34px;font-family:${FONT};font-size:17px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px">${label}</a></td></tr></table>`;
}

export function jobEmail(input: JobEmail) {
  const base = input.appUrl.replace(/\/$/, "");
  const link = `${base}/?task=${encodeURIComponent(input.taskId)}`;
  const title = input.title.replace(/\s+/g, " ").trim();
  const short = title.length > 70 ? `${title.slice(0, 69).trimEnd()}…` : title;
  const subject =
    input.outcome === "done"
      ? `Done: ${short}`
      : input.outcome === "question"
        ? `${input.agentName} needs your answer: ${short}`
        : `Couldn’t finish: ${short}`;
  const heading =
    input.outcome === "done"
      ? "It’s done"
      : input.outcome === "question"
        ? "I need your answer to carry on"
        : "I couldn’t finish this one";
  const tint =
    input.outcome === "done" ? "#E3F3E8" : input.outcome === "question" ? "#EDF7FD" : "#FBEFED";
  const action =
    input.outcome === "done"
      ? "Open in Neato_Muse"
      : input.outcome === "question"
        ? "Answer in Neato_Muse"
        : "See what happened";
  // A failure's own text is usually an error message, not something to put in an inbox.
  const source =
    input.outcome === "failed"
      ? "Something went wrong on my side and I had to stop. You can ask me to try again from the app."
      : input.body;
  const { text: body, cut } = shorten(plainLines(source));
  const { text: rich } = shorten(lines(source));
  const files =
    input.files?.length === 1
      ? `I saved ${input.files[0]} in your Files.`
      : input.files?.length
        ? `I saved these in your Files: ${input.files.join(", ")}.`
        : "";
  // Job emails come from a no-reply address, so a reply wouldn't reach the agent.
  const reply =
    input.outcome === "question"
      ? "Tap the button to answer. Replies to this email don’t reach me."
      : "";
  const more = cut ? "There’s more in the app." : "";

  const text = [
    `${heading}.`,
    `You asked: ${title}`,
    body,
    files,
    more,
    reply,
    `${action}: ${link}`,
    `You’re getting this because you asked ${input.agentName} to do this in Neato_Muse. You can turn these emails off in Apps › Alerts.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const paragraphs = rich
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p style="margin:0 0 12px;font-family:${FONT};font-size:16px;line-height:24px;color:${INK}">${inline(block).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head><body style="margin:0;padding:0;background:#F3F4F1"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(body.slice(0, 140))}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F4F1" style="background:#F3F4F1"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="max-width:600px;background:#FFFFFF;border-radius:28px"><tr><td bgcolor="${tint}" style="background:${tint};padding:26px 24px 22px;border-radius:28px 28px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" style="padding-right:14px"><img src="${base}/email/neddy.png" width="56" height="56" alt="" style="display:block;border:0;border-radius:18px;width:56px;height:56px"></td><td valign="middle" style="font-family:${FONT}"><div style="font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-0.4px;color:${INK}">${esc(heading)}</div><div style="font-size:15px;line-height:21px;color:${MUTED};margin-top:4px">You asked: ${esc(title)}</div></td></tr></table></td></tr><tr><td style="padding:24px 24px 4px">${paragraphs}${files ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:16px;line-height:24px;color:${INK}"><b>${esc(files)}</b></p>` : ""}${more ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED}">${more}</p>` : ""}${reply ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED}">${esc(reply)}</p>` : ""}</td></tr><tr><td align="center" style="padding:14px 24px 30px">${button(esc(link), esc(action))}</td></tr></table><div style="max-width:560px;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};padding:18px 12px 0;text-align:center">You’re getting this because you asked ${esc(input.agentName)} to do this in Neato_Muse. You can turn these emails off in Apps › Alerts.</div></td></tr></table></body></html>`;

  return { subject, text, html };
}
