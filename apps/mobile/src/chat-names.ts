/**
 * Names and times for the Chats list and the chat button, in the person's own day (local dates,
 * never UTC's). Plain functions, so tests can run them without React Native.
 */

const date = (value: Date) => value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const time = (value: Date) =>
  value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const startOfDay = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

/** When a chat was last used: "Just now", "5 minutes ago", "2 hours ago", "Yesterday", "Sep 27". */
export function whenLabel(iso: string, now = new Date()) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  // Hours for today, and for the last few hours even across midnight ("2 hours ago" at 1am).
  if (days <= 0 || minutes < 6 * 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (days === 1) return "Yesterday";
  return date(at);
}

/** A chat's name: its own, or when it started ("Chat from Sep 24, 3:10 PM"). */
export function threadTitle(thread: { name?: string | null; createdAt: string }) {
  const name = thread.name?.trim();
  if (name && name !== "Untitled conversation") return name;
  const at = new Date(thread.createdAt);
  return Number.isNaN(at.getTime()) ? "Chat" : `Chat from ${date(at)}, ${time(at)}`;
}
