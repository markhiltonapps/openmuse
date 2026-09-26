// File types Files accepts besides PDFs, recognised by their contents rather than their names.
export type FileKind = "pdf" | "png" | "jpeg" | "webp" | "gif" | "docx" | "xlsx" | "csv" | "text";
export const FILE_KINDS: Record<FileKind, { mime: string; ext: string; label: string }> = {
  pdf: { mime: "application/pdf", ext: "pdf", label: "PDF" },
  png: { mime: "image/png", ext: "png", label: "Picture" },
  jpeg: { mime: "image/jpeg", ext: "jpg", label: "Picture" },
  webp: { mime: "image/webp", ext: "webp", label: "Picture" },
  gif: { mime: "image/gif", ext: "gif", label: "Picture" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: "docx",
    label: "Word",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
    label: "Excel",
  },
  csv: { mime: "text/csv", ext: "csv", label: "CSV" },
  text: { mime: "text/plain", ext: "txt", label: "Text" },
};
export const IMAGE_KINDS = new Set<FileKind>(["png", "jpeg", "webp", "gif"]);
export const SUPPORTED_FILES =
  "PDFs, pictures (JPEG, PNG, WebP or GIF), Word (.docx), Excel (.xlsx), CSV and text files";

export function kindOfMime(mime: string): FileKind | undefined {
  return (Object.keys(FILE_KINDS) as FileKind[]).find((kind) => FILE_KINDS[kind].mime === mime);
}
const extension = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
const starts = (bytes: Uint8Array, ...signature: number[]) =>
  signature.every((byte, i) => bytes[i] === byte);

/** Whether a file with this name or media type is worth downloading to try. */
export function acceptsFile(name: string, type = "") {
  return (
    /pdf|image\/(png|jpe?g|webp|gif)|wordprocessingml|spreadsheetml|text\/(csv|plain|markdown)/i.test(
      type,
    ) || /^(pdf|png|jpe?g|webp|gif|docx|xlsx|csv|txt|md)$/.test(extension(name))
  );
}

/** The kind of file, from its first bytes (and its name for Office and text files). */
export function detectKind(name: string, bytes: Uint8Array): FileKind | undefined {
  if (starts(bytes, 0x25, 0x50, 0x44, 0x46)) return "pdf";
  if (starts(bytes, 0x89, 0x50, 0x4e, 0x47)) return "png";
  if (starts(bytes, 0xff, 0xd8, 0xff)) return "jpeg";
  if (starts(bytes, 0x47, 0x49, 0x46, 0x38)) return "gif";
  if (starts(bytes, 0x52, 0x49, 0x46, 0x46) && starts(bytes.subarray(8), 0x57, 0x45, 0x42, 0x50))
    return "webp";
  const ext = extension(name);
  if (starts(bytes, 0x50, 0x4b, 0x03, 0x04)) {
    if (ext === "docx") return "docx";
    if (ext === "xlsx") return "xlsx";
    return undefined;
  }
  if (["csv", "txt", "md"].includes(ext) && !bytes.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return ext === "csv" ? "csv" : "text";
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Splits long text into pages of about `size` characters, at paragraph breaks where possible. */
export function paginate(text: string, size = 3500): string[] {
  const pages: string[] = [];
  let current = "";
  for (const paragraph of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const block = paragraph.trim();
    if (!block) continue;
    if (current && current.length + block.length + 2 > size) {
      pages.push(current);
      current = "";
    }
    if (block.length > size) {
      for (let i = 0; i < block.length; i += size) pages.push(block.slice(i, i + size));
      continue;
    }
    current = current ? `${current}\n\n${block}` : block;
  }
  if (current) pages.push(current);
  return pages.length ? pages : [""];
}

/** The text of a Word, Excel, CSV or text file, in pages. */
export async function documentPages(kind: FileKind, bytes: Uint8Array): Promise<string[]> {
  if (kind === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return paginate(result.value);
  }
  if (kind === "xlsx") {
    const { default: readXlsxFile } = await import("read-excel-file/node");
    const sheets = await readXlsxFile(Buffer.from(bytes));
    return sheets.flatMap(({ sheet, data }) => {
      const rows = data
        .slice(0, 5000)
        .map((row) => row.map((cell) => (cell === null ? "" : String(cell))).join(" | "))
        .filter((row) => row.replace(/[\s|]/g, ""));
      return paginate(`Sheet: ${sheet}\n\n${rows.join("\n")}`, 6000);
    });
  }
  return paginate(new TextDecoder().decode(bytes), kind === "csv" ? 6000 : 3500);
}
