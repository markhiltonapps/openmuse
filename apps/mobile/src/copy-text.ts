/**
 * A reply as it reads, for pasting into an email or note: formatting marks go, links keep their
 * address, and lists and paragraphs keep their shape. Code, in blocks or inline, is copied exactly.
 */
export function plainText(markdown: string) {
  const kept: string[] = [];
  // Code is set aside first so the formatting rules below never touch it.
  const keep = (code: string) => `\uE000${kept.push(code) - 1}\uE000`;
  const text = markdown
    .replace(/```[^\n]*\n?([\s\S]*?)\n?```/g, (_, code: string) => keep(code))
    .replace(/`([^`\n]+)`/g, (_, code: string) => keep(code))
    .split("\n")
    .map((line) =>
      line
        .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, "$1 ($2)")
        .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label: string, url: string) =>
          label === url ? url : `${label} (${url})`,
        )
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
  return text.replace(/\uE000(\d+)\uE000/g, (_, index: string) => kept[Number(index)] ?? "");
}
