/** "Sunday, September 27, 2026 at 8:45 PM (America/Chicago)", so the agent can place "tomorrow at 3". */
export function localNow(timeZone: string, now = Date.now()) {
  const text = new Date(now).toLocaleString("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${text} (${timeZone})`;
}
