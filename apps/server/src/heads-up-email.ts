/**
 * The email a heads-up can also go to (off until the person turns it on): the one-line title, what
 * it says, and a button to the app. Calendar titles are untrusted, so everything is escaped and the
 * subject is one line.
 */
const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

const INK = "#11191C";
const MUTED = "#5F686D";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export function headsUpEmail(input: {
  title: string;
  body: string;
  appUrl: string;
  agentName: string;
}) {
  const title = oneLine(input.title).slice(0, 120);
  const link = input.appUrl.replace(/\/$/, "");
  const subject = `Heads-up: ${title}`;
  const text = [
    title,
    "",
    input.body,
    "",
    `Open ${input.agentName}: ${link}`,
    `You’re getting this because email is on for Heads-ups. You can change or turn it off in the app, or just ask ${input.agentName}.`,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F4F5F6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#FFFFFF;border-radius:24px"><tr><td style="padding:28px 28px 8px;font-family:${FONT};font-size:20px;font-weight:700;color:${INK}">${esc(title)}</td></tr><tr><td style="padding:4px 28px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK}">${esc(input.body)}</td></tr><tr><td style="padding:16px 28px 8px;font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED}">You’re getting this because email is on for Heads-ups. You can change or turn it off in the app, or just ask ${esc(input.agentName)}.</td></tr><tr><td align="center" style="padding:12px 28px 32px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${INK}" style="border-radius:999px;background:${INK}"><a href="${esc(link)}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px">Open ${esc(input.agentName)}</a></td></tr></table></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
