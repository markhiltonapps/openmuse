/**
 * Joins speech-recognition results into one transcript. Some browsers repeat the phrase so far
 * in each new result ("This", "This is", "This is a test"), so a result that extends, or is
 * already contained in, the one before it replaces it instead of being added again.
 */
export function mergeTranscripts(results: string[]): string {
  const parts: string[] = [];
  const normal = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  for (const raw of results) {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const last = parts.at(-1);
    if (last && normal(text).startsWith(normal(last))) parts[parts.length - 1] = text;
    else if (!last || !normal(last).startsWith(normal(text))) parts.push(text);
  }
  return parts.join(" ");
}
