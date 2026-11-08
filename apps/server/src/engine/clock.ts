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

/** The hour (0-23) it is now in a time zone; undefined when the zone isn't one. */
export function hourIn(timeZone: string, now = Date.now()): number | undefined {
  try {
    const text = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date(now));
    const hour = Number.parseInt(text, 10);
    return Number.isInteger(hour) ? hour % 24 : undefined;
  } catch {
    return undefined;
  }
}
