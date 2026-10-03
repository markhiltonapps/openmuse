/**
 * The app has two ways into someone's email and calendar: its built-in Google sign-in (search_mail,
 * read_workspace and the rest; not set up on Railway) and the Gmail, Outlook or Google Calendar app
 * they connect under Apps (find_app_actions, use_app). Without saying which is on, the agent took
 * "Google is disconnected", or an empty built-in inbox, to mean their Gmail was off: the chat sent
 * Connect cards for a Gmail that was connected, and a job said it couldn't reach their email.
 */
export const builtInMailOff = (apps: boolean) =>
  apps
    ? "The app's built-in Google mailbox isn't connected. It's separate from the person's mail apps: read their email with find_app_actions and use_app (their Gmail or Outlook app). Don't say their email is disconnected, and don't call connect_app, unless no mail app is connected."
    : "Google is disconnected, so there's no mailbox to read.";

/** The chat's line on which mailbox is on. */
export const mailContext = (builtInMail: boolean, apps: boolean) =>
  builtInMail
    ? "The built-in Google mailbox is connected: search_mail and read_mail_thread read it."
    : apps
      ? "The built-in Google mailbox isn't connected, so don't use search_mail. Read their email with their mail app (Gmail or Outlook): find_app_actions, then use_app."
      : "No mailbox is connected.";

/** A job's tools for the built-in mailbox and calendar, when it isn't connected. */
export const builtInOff = (apps: boolean) =>
  apps
    ? "The app's built-in Google mailbox and calendar aren't connected. They're separate from the person's own apps: read and change their email and calendar with find_app_actions and use_app (their Gmail, Outlook or Google Calendar app). Don't say you can't reach their email or calendar unless no such app is connected."
    : "Google is disconnected, so there's no mailbox or calendar to use.";

/** A background job's line on which mailbox and calendar are on. */
export const jobMailContext = (builtIn: boolean, apps: boolean) =>
  builtIn
    ? "The built-in Google mailbox and calendar are connected: read_workspace and read_mail_thread read them, and prepare_email and prepare_event write to them."
    : apps
      ? "The built-in Google mailbox and calendar aren't connected, so read_workspace has no email or events, and read_mail_thread, import_pdf, prepare_email and prepare_event can't be used. Their email and calendar are in their own apps (Gmail, Outlook, Google Calendar): find_app_actions, then use_app."
      : "No mailbox or calendar is connected.";

/**
 * "Do I have any emails I need to respond to?": every mailbox, sent mail before saying a reply is
 * owed, and things to do that need no reply. Checking only Gmail once missed the person's Outlook,
 * called a reply they'd already sent from Outlook still owed, and waved away a declined payment and
 * a security alert as "automated notices".
 */
export const inboxCheckInstructions =
  " When they ask what in their email needs them (what to reply to, anything important, what's new), check every mailbox they have: each mail app they've connected (list_connected_apps shows which; often both Gmail and Outlook) and the built-in one if it's connected. Look at the last 7 days (for “what's new”, since yesterday), plus older mail from people still waiting on them, and say which mailboxes and how far back you looked (“I checked Gmail and Outlook for the last week.”). If a mailbox couldn't be read, say which one and why before anything else, and call connect_app if it needs reconnecting; never say nothing needs them when a mailbox wasn't checked. Before saying they still owe someone a reply, look in that mailbox's sent mail for a reply they've already sent. What needs them, most important first: a message from a person that asks them something or is waiting on them (unless their sent mail shows they've answered); then security alerts (a new sign-in, an app given access to their account) and a bank or card asking them to review or confirm activity; failed or declined payments; bills and renewals coming due; invitations to accept, forms to sign and deliveries that need them; and anything with a deadline or a decision. For a security alert, a payment problem or an account notice, tell them to open the company's own app or website, never a link in that email, and if the sender or wording doesn't look like that company, say it may be a scam and not to click anything. Leave out what's already settled (a payment that went through on a retry, an alert they've confirmed), list an email that's in two mailboxes once, and leave out newsletters and marketing unless they ask.";
