/** How apps write their own names, where the connector's id runs the words together. */
const APP_NAMES: Record<string, string> = {
  googledrive: "Google Drive",
  googlesheets: "Google Sheets",
  googledocs: "Google Docs",
  googleslides: "Google Slides",
  googlecalendar: "Google Calendar",
  googlemeet: "Google Meet",
  gmail: "Gmail",
  onedrive: "OneDrive",
  outlook: "Outlook",
  hubspot: "HubSpot",
  github: "GitHub",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  clickup: "ClickUp",
};

/** "Google Drive" for googledrive; otherwise the id with its words capitalised. */
export function appLabel(app: string) {
  return (
    APP_NAMES[app.toLowerCase().replace(/[^a-z0-9]/g, "")] ||
    app.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ||
    "this app"
  );
}

const CONNECT_LINK = /https:\/\/connect\.composio\.dev\/link\/[^\s)*\]>"'`]+/i;

/**
 * Whether the agent's words ask the person to connect an app first ("connect Google Sheets
 * first: <link>"). That's a question for them, never a job's result.
 */
export function asksToConnect(text: string) {
  return (
    /connect\.composio\.dev|\/link\/lk_/i.test(text) ||
    /\b(connect|reconnect|authori[sz]e|link)\b[^.\n]{0,80}\bfirst\b/i.test(text)
  );
}

/** The sign-in link in those words, if they have one. */
export function connectLink(text: string) {
  return CONNECT_LINK.exec(text)?.[0];
}

/** The app they name ("connect Google Sheets first" → "Google Sheets"), if they name one. */
export function appToConnect(text: string) {
  return /\b(?:[Rr]e)?[Cc]onnect (?:your |to )?((?:[A-Z][\w.]*)(?: [A-Z][\w.]*){0,2})/.exec(
    text,
  )?.[1];
}
