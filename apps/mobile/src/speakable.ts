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
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .replace(/\s+([.,;:!?])/g, "$1");
  return !text || /[.!?:;]$/.test(text) ? text : `${text}.`;
}

/** Turns a Markdown reply into plain sentences for text-to-speech, in speakable chunks. */
export function speakableChunks(markdown: string): string[] {
  let text = markdown
    .replace(/```[\s\S]*?```/g, "\n(code shown on screen)\n")
    .split("\n")
    .map(speakableLine)
    .filter(Boolean)
    .join(" ");
  if (text.length > MAX_SPOKEN) {
    const cut = text.slice(0, MAX_SPOKEN);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    text = `${cut.slice(0, end > 0 ? end + 1 : MAX_SPOKEN)} The rest is on screen.`;
  }
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
