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
