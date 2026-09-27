import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";

// Documents the agent writes for the person, from simple Markdown: # headings, paragraphs,
// "-" bullets, "1." numbered items and **bold**.
type Run = { text: string; bold: boolean };
export type Block =
  | { type: "h1" | "h2" | "h3" | "p"; runs: Run[] }
  | { type: "bullet" | "number"; runs: Run[]; label: string };

function runs(text: string): Run[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**")
        ? { text: part.slice(2, -2), bold: true }
        : { text: part.replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,;:!?])/g, "$1$2"), bold: false },
    );
}

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "p", runs: runs(paragraph.join(" ")) });
    paragraph = [];
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^(\d{1,3})[.)]\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      blocks.push({ type: `h${heading[1]?.length}` as "h1", runs: runs(heading[2] ?? "") });
    } else if (bullet) {
      flush();
      blocks.push({ type: "bullet", label: "•", runs: runs(bullet[1] ?? "") });
    } else if (numbered) {
      flush();
      blocks.push({ type: "number", label: `${numbered[1]}.`, runs: runs(numbered[2] ?? "") });
    } else paragraph.push(line);
  }
  flush();
  return blocks;
}

const SIZES = { title: 22, h1: 17, h2: 14.5, h3: 12.5, p: 11, bullet: 11, number: 11 };

export async function makePdf(title: string, markdown: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("OpenMuse");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set(regular.getCharacterSet());
  // The standard PDF fonts cover Western European text; anything else becomes a close match.
  const clean = (text: string) =>
    Array.from(
      text
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, "-")
        .replace(/…/g, "...")
        .replace(/\u00a0/g, " ")
        .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ""),
    )
      .map((c) => (supported.has(c.codePointAt(0) ?? 0) ? c : c.trim() ? "?" : " "))
      .join("");
  const [width, height] = [612, 792];
  const margin = 64;
  let page: PDFPage = pdf.addPage([width, height]);
  let y = height - margin;
  const newPage = () => {
    page = pdf.addPage([width, height]);
    y = height - margin;
  };
  /** Lays out runs of text across the line, wrapping at the right margin. */
  const write = (parts: Run[], size: number, indent = 0, forceBold = false) => {
    const lineHeight = size * 1.45;
    const words = parts.flatMap((part) =>
      clean(part.text)
        .split(/(\s+)/)
        .filter((w) => w.length)
        .map((w) => ({ text: w, font: forceBold || part.bold ? bold : regular })),
    );
    let line: { text: string; font: PDFFont }[] = [];
    let lineWidth = 0;
    const draw = () => {
      if (y - lineHeight < margin) newPage();
      let x = margin + indent;
      for (const word of line) {
        page.drawText(word.text, {
          x,
          y: y - size,
          size,
          font: word.font,
          color: rgb(0.13, 0.15, 0.17),
        });
        x += word.font.widthOfTextAtSize(word.text, size);
      }
      y -= lineHeight;
      line = [];
      lineWidth = 0;
    };
    const room = width - margin * 2 - indent;
    for (const word of words) {
      const w = word.font.widthOfTextAtSize(word.text, size);
      if (/^\s+$/.test(word.text) && !line.length) continue;
      if (lineWidth + w > room && line.length) {
        draw();
        if (/^\s+$/.test(word.text)) continue;
      }
      line.push(word);
      lineWidth += w;
    }
    if (line.length) draw();
  };
  write([{ text: title, bold: true }], SIZES.title);
  y -= 8;
  let previous: Block["type"] | undefined;
  for (const block of parseBlocks(markdown)) {
    const size = SIZES[block.type];
    // A little room after a list, before whatever follows it.
    if ((previous === "bullet" || previous === "number") && block.type !== previous) y -= 6;
    previous = block.type;
    if (block.type.startsWith("h")) {
      y -= size * 0.6;
      write(block.runs, size, 0, true);
      y -= 2;
    } else if (block.type === "bullet" || block.type === "number") {
      if (y - size * 1.45 < margin) newPage();
      page.drawText(block.label, {
        x: margin + 4,
        y: y - size,
        size,
        font: regular,
        color: rgb(0.13, 0.15, 0.17),
      });
      write(block.runs, size, 22);
      y -= 2;
    } else {
      write(block.runs, size);
      y -= size * 0.7;
    }
  }
  return pdf.save();
}

export async function makeDocx(title: string, markdown: string): Promise<Uint8Array> {
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: title, bold: true })],
    }),
    ...parseBlocks(markdown).map((block) => {
      const textRuns = block.runs.map((run) => new TextRun({ text: run.text, bold: run.bold }));
      if (block.type === "bullet")
        return new Paragraph({ bullet: { level: 0 }, children: textRuns });
      if (block.type === "number")
        return new Paragraph({ children: [new TextRun(`${block.label} `), ...textRuns] });
      if (block.type === "p") return new Paragraph({ children: textRuns, spacing: { after: 160 } });
      return new Paragraph({
        heading:
          block.type === "h1"
            ? HeadingLevel.HEADING_1
            : block.type === "h2"
              ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3,
        children: textRuns,
      });
    }),
  ];
  const doc = new Document({ creator: "OpenMuse", title, sections: [{ children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}
