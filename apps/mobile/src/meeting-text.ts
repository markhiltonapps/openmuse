/**
 * The words about a meeting that don't need a screen: how long something took, who said a turn, and
 * the whole meeting as a text file. Kept free of React so a test can run it, and so the file people
 * download says exactly what the meeting screen says (the same names, times and pauses).
 */

/** "12:05", or "1:02:05" past an hour. */
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
/** "12 minutes" / "1 hour 5 minutes", for screen readers and the bar's name. */
export function spokenLength(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (!minutes) return part(Math.floor(seconds), "second");
  return h ? `${part(h, "hour")}${m ? ` ${part(m, "minute")}` : ""}` : part(m, "minute");
}
/** "40 seconds", "about 3 minutes": how long nothing was recorded. */
export function missedLength(seconds: number) {
  return seconds < 90
    ? spokenLength(Math.round(seconds))
    : `about ${spokenLength(Math.round(seconds / 60) * 60)}`;
}
/** "Speaker 2", or the name they were given. */
export function speakerName(speakers: Record<string, string>, label: string) {
  const named = speakers[label]?.trim();
  if (named) return named;
  // "2:1" is a speaker heard after the first pause: maybe someone else, so it says so.
  const later = label.match(/^(\d+):(.+)$/);
  if (!later) return `Speaker ${label}`;
  const pause = Number(later[1]) - 1;
  return `Speaker ${later[2]} (after pause${pause > 1 ? ` ${pause}` : ""})`;
}

/** What the text file needs from a meeting (a MeetingRead has all of it). */
export interface TranscriptSource {
  title: string;
  summary?: string;
  decisions: string[];
  actionItems: { text: string; who?: string; due?: string }[];
  speakers: Record<string, string>;
  segments: { speaker: string; start: number; end: number; text: string }[];
  /** Where the recording paused, in ms from the start, and for how long. */
  gaps?: { at: number; seconds: number }[];
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The meeting as plain text: its title and when it was, the notes (when there are any), then every
 * word with who said it and when, and the pauses where nothing was recorded. `when` is the line the
 * screen shows under the title ("Sun, Nov 1 · 2:08 PM · 48 min").
 */
export function transcriptText(meeting: TranscriptSource, when: string) {
  const lines: string[] = [oneLine(meeting.title) || "Meeting", when, ""];
  const summary = oneLine(meeting.summary ?? "");
  if (summary) lines.push("SUMMARY", summary, "");
  if (meeting.decisions.length)
    lines.push("DECISIONS", ...meeting.decisions.map((d) => `- ${oneLine(d)}`), "");
  if (meeting.actionItems.length)
    lines.push(
      "ACTION ITEMS",
      ...meeting.actionItems.map((item) => {
        const who = item.who ? `${oneLine(item.who)}: ` : "";
        const due = item.due ? ` (due ${oneLine(item.due)})` : "";
        return `- ${who}${oneLine(item.text)}${due}`;
      }),
      "",
    );
  lines.push("EVERY WORD");
  meeting.segments.forEach((segment, index) => {
    // Pauses that fall between the turn before this one and this one, as on the screen.
    const before = index ? (meeting.segments[index - 1]?.start ?? 0) : -1;
    for (const gap of meeting.gaps ?? [])
      if (gap.at > before && gap.at <= segment.start)
        lines.push(`--- Paused: ${missedLength(gap.seconds)} not recorded ---`);
    lines.push(
      `[${clock(segment.start / 1000)}] ${speakerName(meeting.speakers, segment.speaker)}: ${oneLine(segment.text)}`,
    );
  });
  return `${lines.join("\n")}\n`;
}

/** "Kickoff Q4 plan transcript.txt": the title without what phones and computers refuse. */
export function transcriptFileName(title: string) {
  const safe = [...title]
    .filter((char) => char.charCodeAt(0) >= 32 && !'\\/:*?"<>|'.includes(char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, "");
  return `${safe || "Meeting"} transcript.txt`;
}
