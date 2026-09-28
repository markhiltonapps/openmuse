/**
 * A reply as it reads, for pasting into an email or note: formatting marks go, links keep their
 * address, and lists and paragraphs keep their shape.
 */
export function plainText(markdown: string) {
  return markdown
    .replace(/```[a-z]*\n?([\s\S]*?)```/gi, "$1")
    .split("\n")
    .map((line) =>
      line
        .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, "$1 ($2)")
        .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label: string, url: string) =>
          label === url ? url : `${label} (${url})`,
        )
        .replace(/`([^`]*)`/g, "$1")
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^(\s*)[-*+]\s+/, "$1• ")
        .replace(/(\*\*|__|~~)(?=\S)(.*?\S)\1/g, "$2")
        .replace(/(^|[\s(])[*_](?=\S)(.*?\S)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
        .replace(/^\s*\|?\s*:?-{3,}[-:|\s]*$/, "")
        .replace(/^\|\s*|\s*\|$/g, "")
        .replace(/\s*\|\s*/g, "  ")
        .trimEnd(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
