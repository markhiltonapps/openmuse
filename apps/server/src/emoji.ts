import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Microsoft's Fluent 3D emoji (MIT), 256 px pictures named by code point, such as
 * 1f4f0.webp for 📰. Served by the app so every emoji can be drawn in 3D, like Meta's.
 */
const folder = (() => {
  try {
    const require = createRequire(import.meta.url);
    return join(dirname(require.resolve("@lobehub/fluent-emoji-3d/package.json")), "assets");
  } catch {
    return undefined;
  }
})();
/** Code points without the FE0F variation selector, which files and text use inconsistently. */
const key = (code: string) =>
  code
    .toLowerCase()
    .split("-")
    .filter((part) => part && part !== "fe0f")
    .join("-");
let files: Map<string, string> | undefined;
function index() {
  if (!files) {
    files = new Map();
    try {
      for (const file of folder ? readdirSync(folder) : [])
        if (file.endsWith(".webp")) files.set(key(file.slice(0, -5)), file);
    } catch {
      // No pictures: the app shows the plain emoji.
    }
  }
  return files;
}
/** "📰" → "1f4f0". */
export function emojiCode(emoji: string) {
  return key([...emoji].map((character) => character.codePointAt(0)?.toString(16) ?? "").join("-"));
}
export async function emojiPicture(code: string) {
  if (!/^[0-9a-f-]{2,80}$/i.test(code) || !folder) return undefined;
  const file = index().get(key(code));
  return file ? readFile(join(folder, file)) : undefined;
}
export function hasEmojiPicture(emoji: string) {
  return index().has(emojiCode(emoji));
}
