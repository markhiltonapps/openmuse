/**
 * A result in the person's words: the local stand-in for sending mail says what happened
 * instead of its record id.
 */
export function readableResult(value: string) {
  return /^Saved to (?:sample|local) sent mail(?: · .+)?$/.test(value)
    ? "Reply saved in your local Sent mail."
    : value;
}

/**
 * A result as plain words, for a short preview in the app and a phone's notification, which show
 * text as it is: no headings, bold or italic marks, bullets, quotes, rules, tables, images or link
 * syntax. A heading line is left out when there's anything else ("Today" would take up a preview
 * line), and each line but the last that ends in a word or number gets a stop, so lines shown run
 * together still read as sentences.
 */
export function plainText(value: string) {
  const lines = readableResult(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) => line && !/^([-*_]\s*){3,}$/.test(line) && !/^\|?[\s:|-]*-[\s:|-]*$/.test(line),
    );
  const body = lines.filter((line) => !/^#{1,6}\s/.test(line));
  const words = (body.length ? body : lines)
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>\s?/, "")
        .replace(/^[-*+•]\s+/, "")
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, "$1$2")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/^\|\s*|\s*\|$/g, "")
        .replace(/\s*\|\s*/g, " · ")
        .trim(),
    )
    .filter(Boolean);
  return words
    .map((line, index) =>
      index < words.length - 1 && /[\p{L}\p{N}°%)"'”’]$/u.test(line) ? `${line}.` : line,
    )
    .join("\n");
}
