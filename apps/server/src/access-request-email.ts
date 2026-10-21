/**
 * The email the admin gets when someone asks to join from the sign-in screen: who, their address
 * and note, and a button to the app, where People lists the request to approve or decline. What
 * the person typed is untrusted, so it is escaped and kept out of the subject's line breaks.
 */
export interface AccessRequestEmail {
  name: string;
  email: string;
  note?: string;
  /** The web app the button opens. */
  appUrl: string;
  /** Requests waiting now, this one included. */
  waiting?: number;
}

const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

const INK = "#11191C";
const MUTED = "#5F686D";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export function accessRequestEmail(input: AccessRequestEmail) {
  const name = oneLine(input.name);
  const link = input.appUrl.replace(/\/$/, "");
  const subject = `${name.slice(0, 60)} asked to join Neddy`;
  const others =
    input.waiting && input.waiting > 1
      ? ` ${input.waiting} people are waiting for an answer in all.`
      : "";
  const text = [
    `${name} asked to join.`,
    `Email: ${input.email}`,
    ...(input.note ? [`Note: ${oneLine(input.note)}`] : []),
    "",
    `Approve or decline in the app: Apps & settings › Account › People.${others}`,
    link,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F4F5F6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#FFFFFF;border-radius:24px"><tr><td style="padding:28px 28px 8px;font-family:${FONT};font-size:22px;font-weight:700;color:${INK}">${esc(name)} asked to join</td></tr><tr><td style="padding:4px 28px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${INK}">${esc(input.email)}</td></tr>${
    input.note
      ? `<tr><td style="padding:12px 28px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${MUTED};font-style:italic">“${esc(oneLine(input.note))}”</td></tr>`
      : ""
  }<tr><td style="padding:20px 28px 8px;font-family:${FONT};font-size:15px;line-height:22px;color:${MUTED}">Approve or decline in the app under Apps &amp; settings › Account › People.${esc(others)}</td></tr><tr><td align="center" style="padding:12px 28px 32px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${INK}" style="border-radius:999px;background:${INK}"><a href="${esc(link)}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px">Open Neddy</a></td></tr></table></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
