/** Longest reply read aloud; the rest stays on screen. */
const MAX_SPOKEN = 2400;
/** Browsers cut off long utterances, so replies are spoken in pieces of about this size. */
const CHUNK = 220;

/** One Markdown line as plain speech, ending in punctuation so list items get a pause. */
function speakableLine(line: string) {
  const text = line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<?https?:\/\/[^\s)>]+>?/g, "the link")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*[-*+•]\s+/, "")
    .replace(/^\s*\|?\s*:?-{3,}.*$/, "")
    .replace(/\|/g, ", ")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)(.*?\S)\1/g, "$2")
    // Emphasis or a link cut in two where a reply was still being written.
    .replace(/\*+|~~|[[\]]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .replace(/\s+([.,;:!?])/g, "$1");
  return !text || /[.!?:;]$/.test(text) ? text : `${text}.`;
}

/** Markdown as plain sentences for text-to-speech. */
function speakableText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, "\n(code shown on screen)\n")
    .split("\n")
    .map(speakableLine)
    .filter(Boolean)
    .join(" ");
}

/** Keeps what fits in `room` characters, ending at a sentence. */
function cap(text: string, room: number) {
  if (text.length <= room) return { text, capped: false };
  const cut = text.slice(0, Math.max(0, room));
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  const kept = cut.slice(0, end > 0 ? end + 1 : room).trim();
  return { text: `${kept ? `${kept} ` : ""}The rest is on screen.`, capped: true };
}

/** Plain text in pieces short enough for the browser to say in one go, split at sentences. */
function chunked(text: string): string[] {
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [];
  const chunks: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const last = chunks.at(-1);
    if (last && last.length + sentence.length + 1 <= CHUNK)
      chunks[chunks.length - 1] = `${last} ${sentence}`;
    else if (sentence.length <= CHUNK) chunks.push(sentence);
    else
      for (const part of sentence.match(new RegExp(`.{1,${CHUNK}}(?:\\s|$)`, "g")) ?? [sentence])
        if (part.trim()) chunks.push(part.trim());
  }
  return chunks;
}

/** Turns a Markdown reply into plain sentences for text-to-speech, in speakable chunks. */
export function speakableChunks(markdown: string): string[] {
  return chunked(cap(speakableText(markdown), MAX_SPOKEN).text);
}

/**
 * How much of a reply that is still being written can be read aloud already: up to its last
 * finished sentence or line, and never into a code block that hasn't closed yet.
 */
export function speakableEnd(markdown: string, done = false): number {
  if (done) return markdown.length;
  let end = 0;
  for (const match of markdown.matchAll(/\n|[.!?]["'”’)\]*_]*(?=\s)/g)) {
    if (match[0] !== "\n") {
      const line = markdown.slice(markdown.lastIndexOf("\n", match.index) + 1, match.index + 1);
      // "1." starting a list item, or "Dr." and "e.g." partway through a sentence.
      if (
        /^\s*\d+\.$/.test(line) ||
        /(?:^|[\s(])(?:[A-Za-z]|e\.g|i\.e|mr|mrs|ms|dr|st|vs|jr|sr)\.$/i.test(line)
      )
        continue;
    }
    end = match.index + match[0].length;
  }
  if ((markdown.slice(0, end).split("```").length - 1) % 2) end = markdown.lastIndexOf("```", end);
  return end;
}

interface ReplyMessage {
  role: string;
  content?: unknown;
  toolCalls?: unknown[];
}
/**
 * The text of a reply so far, across the messages the agent writes around its tool calls. A
 * message it has moved on from ends in a line break, so its last sentence can be read out.
 */
export function replyText(messages: ReplyMessage[]): string {
  return messages
    .map((message, index) => {
      if (message.role !== "assistant" || typeof message.content !== "string") return "";
      if (!message.content.trim()) return "";
      const finished = index < messages.length - 1 || !!message.toolCalls?.length;
      return finished ? `${message.content}\n\n` : message.content;
    })
    .join("");
}

/** Follows a reply as it's written and hands out the parts that are ready to be said. */
export class SpokenReply {
  private read = 0;
  private accepted = 0;
  private waiting = "";
  private capped = false;
  /** The reply so far; `done` once it's finished. */
  update(markdown: string, done = false) {
    if (this.capped) return;
    const end = speakableEnd(markdown, done);
    if (end <= this.read) return;
    const fitted = cap(speakableText(markdown.slice(this.read, end)), MAX_SPOKEN - this.accepted);
    this.read = end;
    this.capped = fitted.capped;
    if (!fitted.text) return;
    this.accepted += fitted.text.length + 1;
    this.waiting = this.waiting ? `${this.waiting} ${fitted.text}` : fitted.text;
  }
  /** The next piece to say, or undefined until more of the reply is ready. */
  next(): string | undefined {
    const [first, ...rest] = chunked(this.waiting);
    this.waiting = rest.join(" ");
    return first;
  }
}
