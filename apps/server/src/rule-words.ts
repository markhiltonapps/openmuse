/**
 * Rules said back in plain words before they're saved on a call (owner, 2026-10-08): "Every
 * weekday at 7:30 AM: give me a brief for today. Shall I set that up?"
 */
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "every day", "every weekday", "on weekends", "every Monday and Friday". */
export function spokenDays(days: number[] = [0, 1, 2, 3, 4, 5, 6]) {
  const set = [...new Set(days)].sort();
  if (set.length === 7) return "every day";
  if (set.join() === "1,2,3,4,5") return "every weekday";
  if (set.join() === "0,6") return "every weekend day";
  const names = set.map((day) => DAYS[day] ?? "");
  return `every ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}`;
}
/** "07:30" as "7:30 AM". */
export function spokenTime(time: string) {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}
/** Their own words, short, without a closing full stop (the sentence adds one). */
const quoted = (text: string) => {
  const trimmed = text.trim().replace(/\s+/g, " ").replace(/[.]+$/, "");
  return trimmed.length > 160 ? `${trimmed.slice(0, 157).trimEnd()}…` : trimmed;
};

export function routineWords(rule: { prompt: string; time: string; days?: number[] }) {
  return `${spokenDays(rule.days)} at ${spokenTime(rule.time)}, I’ll run this request: “${quoted(rule.prompt)}”.`.replace(
    /^./,
    (c) => c.toUpperCase(),
  );
}
export function emailRuleWords(rule: {
  from: string;
  subjectContains?: string;
  instruction: string;
  app?: string;
}) {
  const where = rule.app === "gmail" ? " in Gmail" : rule.app === "outlook" ? " in Outlook" : "";
  const about = rule.subjectContains ? ` about “${rule.subjectContains}”` : "";
  return `When an email from ${rule.from}${about} arrives${where}, I’ll do this: “${quoted(rule.instruction)}”.`;
}

/** What a tool says instead of saving, until they've heard it and said yes. */
export const confirmFirst = (words: string) => ({
  saved: false,
  say: `${words} Want me to set that up?`,
  message:
    "Nothing is saved yet. Say `say` to them, and only if they say yes, call this again with the same details and confirmed: true. If they change something, use their change.",
});
