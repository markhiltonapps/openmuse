import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact } from "../../../packages/domain/src/index.ts";
import { fillPdf, inspectPdf, pdfPageText } from "../../../packages/integrations/src/pdf.ts";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

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
    if (bytes.length > 10 * 1024 * 1024) throw new AppError("PDFs must be 10 MB or smaller", 413);
    const metadata = await inspectPdf(bytes);
    if (metadata.pageCount > 500) throw new AppError("PDFs must have 500 pages or fewer", 422);
    const id = randomUUID();
    const safeName = Array.from(name.split(/[\\/]/).at(-1) ?? "document.pdf")
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("")
      .slice(0, 180);
    const artifact: Artifact = {
      id,
      name: safeName,
      mimeType: "application/pdf",
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
    await writeFile(join(directory, `${id}.pdf`), bytes, { mode: 0o600, flag: "wx" });
    await this.db.put(owner, "files", artifact);
    return this.signed(owner, artifact);
  }
  /** Whether a file with this name and type can be saved to Files. */
  accepts(name: string, type = "") {
    return /pdf/i.test(type) || /\.pdf$/i.test(name);
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
  async bytes(owner: string, id: string) {
    await this.get(owner, id);
    return readFile(join(this.config.dataDir, "files", `${id}.pdf`));
  }
  /** Page text, extracted once and kept next to the PDF. */
  async pages(owner: string, id: string): Promise<string[]> {
    await this.get(owner, id);
    const cache = join(this.config.dataDir, "files", `${id}.text.json`);
    try {
      return JSON.parse(await readFile(cache, "utf8")) as string[];
    } catch {
      const pages = await pdfPageText(await this.bytes(owner, id));
      await writeFile(cache, JSON.stringify(pages), { mode: 0o600 }).catch(() => undefined);
      return pages;
    }
  }
  /** Text from `fromPage` on, as much as fits in `maxChars`, with page markers. */
  async read(owner: string, id: string, fromPage = 1, maxChars = 30000) {
    const file = await this.get(owner, id);
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
        : "This PDF has no text layer; it may be a scanned image, which can't be read yet.",
      ...(toPage < pages.length
        ? { more: `Read again from page ${toPage + 1} for the rest.` }
        : {}),
    };
  }
  async fill(owner: string, id: string, values: Record<string, string | boolean>) {
    const file = await this.get(owner, id);
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
