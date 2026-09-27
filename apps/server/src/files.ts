import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact } from "../../../packages/domain/src/index.ts";
import {
  acceptsFile,
  detectKind,
  documentPages,
  FILE_KINDS,
  type FileKind,
  IMAGE_KINDS,
  kindOfMime,
  SUPPORTED_FILES,
} from "../../../packages/integrations/src/documents.ts";
import { fillPdf, inspectPdf, pdfPageText } from "../../../packages/integrations/src/pdf.ts";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

export interface FileText {
  id: string;
  name: string;
  kind?: "picture";
  pageCount: number;
  fromPage: number;
  toPage: number;
  text: string;
  more?: string;
}

export class Files {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly auth: Auth,
  ) {}
  async import(
    owner: string,
    name: string,
    bytes: Uint8Array,
    source: string,
    parentId?: string,
  ): Promise<Artifact> {
    if (bytes.length > 10 * 1024 * 1024) throw new AppError("Files must be 10 MB or smaller", 413);
    const safeName = Array.from(name.split(/[\\/]/).at(-1) ?? "document.pdf")
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("")
      .slice(0, 180);
    const kind = detectKind(safeName, bytes);
    if (!kind) throw new AppError(`Files can be ${SUPPORTED_FILES}`, 422);
    let metadata: { pageCount: number; fields: NonNullable<Artifact["fields"]> } = {
      pageCount: 1,
      fields: [],
    };
    let pages: string[] | undefined;
    if (kind === "pdf") {
      metadata = await inspectPdf(bytes);
      if (metadata.pageCount > 500) throw new AppError("PDFs must have 500 pages or fewer", 422);
    } else if (!IMAGE_KINDS.has(kind)) {
      // Reading the text now proves the document opens and saves doing it again later.
      pages = await documentPages(kind, bytes).catch(() => {
        throw new AppError(`This ${FILE_KINDS[kind].label} file couldn't be opened`, 422);
      });
      metadata = { pageCount: pages.length, fields: [] };
    }
    const id = randomUUID();
    const artifact: Artifact = {
      id,
      name: safeName,
      mimeType: FILE_KINDS[kind].mime,
      size: bytes.length,
      pageCount: metadata.pageCount,
      fields: metadata.fields,
      url: "",
      createdAt: new Date().toISOString(),
      source,
      parentId,
    };
    const directory = join(this.config.dataDir, "files");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(this.path(artifact), bytes, { mode: 0o600, flag: "wx" });
    if (pages)
      await writeFile(join(directory, `${id}.text.json`), JSON.stringify(pages), { mode: 0o600 });
    await this.db.put(owner, "files", artifact);
    return this.signed(owner, artifact);
  }
  /** Whether a file with this name and type is worth trying to save to Files. */
  accepts(name: string, type = "") {
    return acceptsFile(name, type);
  }
  kind(file: Artifact): FileKind {
    return kindOfMime(file.mimeType) ?? "pdf";
  }
  private path(file: Artifact) {
    return join(this.config.dataDir, "files", `${file.id}.${FILE_KINDS[this.kind(file)].ext}`);
  }
  signed(owner: string, file: Artifact): Artifact {
    return { ...file, url: this.auth.sign(owner, `/api/files/${file.id}/content`) };
  }
  async list(owner: string) {
    return (await this.db.list<Artifact>(owner, "files")).map((file) => this.signed(owner, file));
  }
  async get(owner: string, id: string) {
    const file = await this.db.get<Artifact>(owner, "files", id);
    if (!file) throw new AppError("File not found", 404);
    return file;
  }
  /** Deletes a file's contents and extracted text from disk (the record is removed separately). */
  async erase(file: Artifact) {
    await rm(this.path(file), { force: true });
    await rm(join(this.config.dataDir, "files", `${file.id}.text.json`), { force: true });
  }
  async bytes(owner: string, id: string) {
    return readFile(this.path(await this.get(owner, id)));
  }
  /** Page text, extracted once and kept next to the PDF. */
  async pages(owner: string, id: string): Promise<string[]> {
    const file = await this.get(owner, id);
    const kind = this.kind(file);
    if (IMAGE_KINDS.has(kind)) return [];
    const cache = join(this.config.dataDir, "files", `${id}.text.json`);
    try {
      return JSON.parse(await readFile(cache, "utf8")) as string[];
    } catch {
      const bytes = await this.bytes(owner, id);
      const pages = kind === "pdf" ? await pdfPageText(bytes) : await documentPages(kind, bytes);
      await writeFile(cache, JSON.stringify(pages), { mode: 0o600 }).catch(() => undefined);
      return pages;
    }
  }
  /** Text from `fromPage` on, as much as fits in `maxChars`, with page markers. */
  async read(owner: string, id: string, fromPage = 1, maxChars = 30000): Promise<FileText> {
    const file = await this.get(owner, id);
    if (IMAGE_KINDS.has(this.kind(file)))
      return {
        id: file.id,
        name: file.name,
        kind: "picture",
        pageCount: 0,
        fromPage: 1,
        toPage: 0,
        text: "This file is a picture. Call look_at_image with its file ID and a question to see it.",
      };
    const pages = await this.pages(owner, id);
    const start = Math.min(Math.max(1, Math.floor(fromPage)), Math.max(1, pages.length));
    let text = "";
    let toPage = start - 1;
    for (let page = start; page <= pages.length; page++) {
      const chunk = `--- Page ${page} ---\n${pages[page - 1] ?? ""}\n`;
      if (text && text.length + chunk.length > maxChars) break;
      text += chunk.slice(0, maxChars - text.length);
      toPage = page;
    }
    return {
      id: file.id,
      name: file.name,
      pageCount: pages.length,
      fromPage: start,
      toPage,
      text: pages.some((page) => page.trim())
        ? text
        : this.kind(file) === "pdf"
          ? "This PDF has no text layer; it may be a scanned image, which can't be read yet."
          : "This document has no text.",
      ...(toPage < pages.length
        ? { more: `Read again from page ${toPage + 1} for the rest.` }
        : {}),
    };
  }
  async fill(owner: string, id: string, values: Record<string, string | boolean>) {
    const file = await this.get(owner, id);
    if (this.kind(file) !== "pdf") throw new AppError("Only PDF forms can be filled", 422);
    const bytes = await this.bytes(owner, id);
    const output = await fillPdf(bytes, values);
    return this.import(
      owner,
      `${file.name.replace(/\.pdf$/i, "")} — filled.pdf`,
      output,
      `Filled from ${file.name}`,
      id,
    );
  }
}
