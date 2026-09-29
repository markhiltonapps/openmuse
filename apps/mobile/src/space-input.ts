/** Loose typing for a Space's playbook, read the way a person means it. */

/** "8:45", "845", "9am", "9:30 pm", "18:00" → "HH:MM"; null when it isn't a time. */
export function parseTime(input: string) {
  const match = /^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/.exec(
    input.trim().toLowerCase().replace(/[\s.]/g, ""),
  );
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const half = match[3];
  if (minutes > 59) return null;
  if (half) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (half.startsWith("p") ? 12 : 0);
  } else if (hours > 23) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
/** "12,50" or "$1,250" → dollars; null for an empty box, NaN when it isn't an amount. */
export function parseDollars(input: string) {
  const text = input.replace(/[$\s]/g, "");
  if (!text) return null;
  // A comma before one or two final digits is a decimal comma; any other comma groups thousands.
  const normal = /^\d+,\d{1,2}$/.test(text) ? text.replace(",", ".") : text.replace(/,/g, "");
  return /^\d+(\.\d{1,2})?$/.test(normal) ? Number(normal) : Number.NaN;
}
