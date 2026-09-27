/**
 * The invite and sign-in emails: Neddy, a big button and, for invites, a picture tour of what the
 * agent does, in the look of the help guide. Email apps only follow inline styles and tables, and
 * Outlook on Windows can't show WebP, so pictures are PNGs the web app serves under /email.
 */
export interface SignInEmail {
  invite: boolean;
  /** The one-time sign-in link. */
  link: string;
  /** The web app, which serves the pictures and the help guide. */
  appUrl: string;
  expiry: string;
  name?: string;
  email: string;
  /** The agent's own address, for invites. */
  address?: string;
}

const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

const INK = "#11191C";
const MUTED = "#5F686D";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const TILES = [
  { pic: "email", title: "Email", line: "Summaries and replies drafted for you", tint: "#EDF7FD" },
  { pic: "calendar", title: "Calendar", line: "Your day, planned and moved", tint: "#F0EEFA" },
  {
    pic: "dinner",
    title: "Restaurants",
    line: "Open tables with it all filled in",
    tint: "#FDF0DF",
  },
  { pic: "alarm", title: "Reminders", line: "Just say when", tint: "#FDEEF2" },
  {
    pic: "news",
    title: "Morning feed",
    line: "News with pictures, picked for you",
    tint: "#E3F3E8",
  },
  { pic: "eyes", title: "Watch the web", line: "Price drops and page changes", tint: "#E2F5F3" },
];

function button(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr><td bgcolor="${INK}" style="border-radius:999px;background:${INK}"><a href="${href}" style="display:inline-block;padding:16px 34px;font-family:${FONT};font-size:17px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px">${label}</a></td></tr></table>`;
}

function tile(t: (typeof TILES)[number], img: (name: string) => string) {
  return `<td width="50%" valign="top" style="padding:6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${t.tint}" style="background:${t.tint};border-radius:20px;padding:16px 14px;font-family:${FONT}"><img src="${img(t.pic)}" width="44" height="44" alt="" style="display:block;border:0;width:44px;height:44px"><div style="font-size:16px;font-weight:700;color:${INK};margin-top:8px">${t.title}</div><div style="font-size:14px;line-height:19px;color:${MUTED};margin-top:2px">${t.line}</div></td></tr></table></td>`;
}

function row(pic: string, html: string) {
  return `<tr><td width="44" valign="top" style="padding:6px 12px 6px 0"><img src="${pic}" width="36" height="36" alt="" style="display:block;border:0;width:36px;height:36px"></td><td valign="middle" style="padding:6px 0;font-family:${FONT};font-size:15px;line-height:21px;color:${INK}">${html}</td></tr>`;
}

export function signInEmail(input: SignInEmail) {
  const base = input.appUrl.replace(/\/$/, "");
  const img = (name: string) => `${base}/email/${name}.png`;
  const link = esc(input.link);
  const help = esc(`${base}/help.html`);
  const first = input.name?.trim().split(/\s+/)[0];
  const hello = first ? `Hi ${esc(first)}, you're invited!` : "You're invited!";
  const subject = input.invite ? "You're invited to Neato_Muse" : "Your Neato_Muse sign-in link";

  const intro = input.invite
    ? `You've been invited to Neato_Muse, a personal assistant for your email, calendar, apps and errands.`
    : "Here's your link to sign in to Neato_Muse.";
  const agent =
    input.invite && input.address
      ? `\n\nYour assistant's email address is ${input.address}. Send or forward email there from ${input.email} to hand it work.`
      : "";
  const guide = input.invite ? `\n\nNew to Neato_Muse? See how it works: ${base}/help.html` : "";
  const text = `${intro}\n\nSign in: ${input.link}\n\nThe link works once and expires ${input.expiry}.${agent}${guide}`;

  const header = `<tr><td bgcolor="#E2F5F3" align="center" style="background:#E2F5F3;padding:34px 24px 26px;border-radius:28px 28px 0 0"><img src="${img("neddy")}" width="${input.invite ? 120 : 88}" height="${input.invite ? 120 : 88}" alt="Neddy, the Neato_Muse robot" style="display:block;border:0;border-radius:32px;width:${input.invite ? 120 : 88}px;height:${input.invite ? 120 : 88}px"><div style="font-family:${FONT};font-size:${input.invite ? 30 : 26}px;line-height:1.15;font-weight:800;letter-spacing:-0.6px;color:${INK};margin-top:18px">${input.invite ? hello : "Here's your sign-in link"}</div>${
    input.invite
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:18px auto 0;max-width:470px"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #D6ECE9;border-radius:22px;padding:14px 18px;font-family:${FONT};font-size:16px;line-height:23px;color:${INK};text-align:left">Hi, I'm <b>Neddy</b>, your new personal AI agent. I read and draft your email, keep your calendar, research things, set reminders and run errands, and I always check with you before I send, buy or change anything.</td></tr></table>`
      : ""
  }</td></tr>`;

  const cta = `<tr><td align="center" style="padding:28px 24px 8px">${button(link, input.invite ? "Accept your invite &rarr;" : "Sign in to Neato_Muse")}<div style="font-family:${FONT};font-size:13px;color:${MUTED};margin-top:12px">The link works once and expires ${esc(input.expiry)}.</div></td></tr>`;

  const tour = input.invite
    ? `<tr><td style="padding:26px 18px 4px"><div style="font-family:${FONT};font-size:21px;font-weight:800;letter-spacing:-0.3px;color:${INK};padding:0 6px 8px">What I can do for you</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${[
        0, 2, 4,
      ]
        .map(
          (i) =>
            `<tr>${tile(TILES[i] as (typeof TILES)[number], img)}${tile(TILES[i + 1] as (typeof TILES)[number], img)}</tr>`,
        )
        .join("")}</table></td></tr>
<tr><td style="padding:18px 24px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #EEEEF0;border-radius:22px"><tr><td style="padding:16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="right" style="padding-bottom:8px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"><tr><td bgcolor="#1473C8" style="background:#1473C8;border-radius:18px 18px 4px 18px;padding:10px 14px;font-family:${FONT};font-size:15px;line-height:21px;color:#FFFFFF">Summarize my unread email and draft replies to anything urgent.</td></tr></table></td></tr><tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="bottom" style="padding-right:8px"><img src="${img("neddy")}" width="30" height="30" alt="" style="display:block;border:0;border-radius:9px;width:30px;height:30px"></td><td bgcolor="#EEEEF0" style="background:#EEEEF0;border-radius:18px 18px 18px 4px;padding:10px 14px;font-family:${FONT};font-size:15px;line-height:21px;color:${INK}">You have 3 that need you. I drafted 2 replies for you to check.</td></tr></table></td></tr></table></td></tr></table></td></tr>
<tr><td style="padding:22px 24px 4px"><div style="font-family:${FONT};font-size:21px;font-weight:800;letter-spacing:-0.3px;color:${INK};padding-bottom:6px">You're always in control</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${row(img("check"), "Nothing is sent, bought or booked until you tap <b>Approve</b>.")}${row(img("lock"), "Your chats, memory and apps are private to you.")}${
        input.address
          ? row(
              img("mailbox"),
              `Your agent has its own address, <b>${esc(input.address)}</b>. Forward email there from ${esc(input.email)} to hand it work.`,
            )
          : ""
      }</table></td></tr>
<tr><td style="padding:22px 24px 4px"><div style="font-family:${FONT};font-size:21px;font-weight:800;letter-spacing:-0.3px;color:${INK};padding-bottom:6px">Get going in 3 steps</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${row(img("wave"), "<b>Tap Accept your invite.</b> There's no password to remember.")}${row(img("phone"), "<b>Add it to your home screen.</b> iPhone: Safari, Share, Add to Home Screen. Android: Chrome, &#8942;, Install app.")}${row(img("plug"), "<b>Connect your apps</b>, like Gmail, Outlook or Google Calendar, and say hi.")}</table><div style="font-family:${FONT};font-size:15px;padding:10px 0 0 56px"><a href="${help}" style="color:#1473C8;font-weight:600;text-decoration:none">See the picture guide &rarr;</a></div></td></tr>
<tr><td align="center" style="padding:28px 24px 30px">${button(link, "Meet Neddy &rarr;")}</td></tr>`
    : `<tr><td style="padding:0 24px 28px"></td></tr>`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${subject}</title></head><body style="margin:0;padding:0;background:#F3F4F1"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${input.invite ? "Meet Neddy, your new personal AI agent. Your invite link works for 3 days." : "Your one-time sign-in link for Neato_Muse."}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F4F1" style="background:#F3F4F1"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="max-width:600px;background:#FFFFFF;border-radius:28px">${header}${cta}${tour}</table><div style="max-width:560px;font-family:${FONT};font-size:12px;line-height:18px;color:#8A9296;padding:18px 12px 0;text-align:center">${input.invite ? "You're getting this because someone invited you to their Neato_Muse." : "You asked for a sign-in link."} If you weren't expecting it, you can ignore this email.</div></td></tr></table></body></html>`;

  return { subject, text, html };
}
