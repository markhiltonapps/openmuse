import type { Artifact } from "../../../packages/domain/src";

/** What Files accepts, for the document picker. */
export const PICKER_TYPES = [
  "application/pdf",
  "image/*",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
  "text/markdown",
];
export const isPicture = (file: Pick<Artifact, "mimeType">) => file.mimeType.startsWith("image/");
export const isPdf = (file: Pick<Artifact, "mimeType">) => file.mimeType === "application/pdf";
export function fileLabel(file: Pick<Artifact, "mimeType">) {
  const type = file.mimeType;
  return isPdf(file)
    ? "PDF"
    : isPicture(file)
      ? "Picture"
      : type.includes("wordprocessingml")
        ? "Word"
        : type.includes("spreadsheetml")
          ? "Excel"
          : type.includes("presentationml")
            ? "PowerPoint"
            : type === "text/csv"
              ? "CSV"
              : "Text";
}
/** "120 KB", or "1.7 MB" from a megabyte up. */
export function sizeLabel(bytes: number) {
  const kb = Math.max(1, Math.round(bytes / 1024));
  return kb < 1024 ? `${kb} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
/** "3 pages · 120 KB", "Picture · 800 KB", "Excel · 40 KB". */
export function fileSummary(file: Pick<Artifact, "mimeType" | "pageCount" | "size">) {
  const size = sizeLabel(file.size);
  if (isPdf(file)) return `${file.pageCount} ${file.pageCount === 1 ? "page" : "pages"} · ${size}`;
  return `${fileLabel(file)} · ${size}`;
}
export function fileExtension(file: Pick<Artifact, "mimeType" | "name">) {
  return /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? (isPdf(file) ? "pdf" : "bin");
}
