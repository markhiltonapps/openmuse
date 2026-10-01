import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  PDFString,
  type RGB,
  rgb,
  StandardFonts,
} from "pdf-lib";

// Documents the agent writes for the person, from simple Markdown: # headings, paragraphs,
// "-" bullets, "1." numbered items, | tables |, [links](https://…), **bold** and "---" rules.
type Run = { text: string; bold: boolean; link?: string };
export type Block =
  | { type: "h1" | "h2" | "h3" | "p"; runs: Run[] }
  | { type: "bullet" | "number"; runs: Run[]; label: string }
  | { type: "table"; header: Run[][]; rows: Run[][][]; right: boolean[] }
  | { type: "rule" };

const plain = (text: string) => text.replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,;:!?])/g, "$1$2");

/** One line of Markdown as runs of text: **bold**, [links](https://…) and bare https:// links. */
export function runs(text: string): Run[] {
  const out: Run[] = [];
  const pattern =
    /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ text: plain(text.slice(last, at)), bold: false });
    if (match[1] !== undefined) out.push({ text: plain(match[1]), bold: true });
    else if (match[2] !== undefined)
      out.push({ text: plain(match[2]), bold: false, link: match[3] });
    else if (match[4] !== undefined) out.push({ text: match[4], bold: false, link: match[4] });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ text: plain(text.slice(last)), bold: false });
  return out.filter((run) => run.text);
}

/** "| a | b |" as its cells; a "\|" stays in the cell. */
function cells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}
const isTableLine = (line: string) => line.startsWith("|") && line.indexOf("|", 1) > 0;
/** "$299.99", "12,480", "4.4★", "-3%", "1.2k": a cell that's a number. */
const NUMBER = /^[-+]?[$€£]?\s?\d[\d,]*(\.\d+)?\s?(%|★|⭐|k|K|M|x)?$/;
const isDivider = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line);

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "p", runs: runs(paragraph.join(" ")) });
    paragraph = [];
  };
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? "").trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^(\d{1,3})[.)]\s+(.*)$/.exec(line);
    // A table: a header row, a |---|---| divider, then its rows.
    if (isTableLine(line) && isDivider((lines[index + 1] ?? "").trim())) {
      flush();
      const header = cells(line).map(runs);
      const marks = cells(lines[index + 1] ?? "");
      const texts: string[][] = [];
      index += 2;
      while (index < lines.length && isTableLine((lines[index] ?? "").trim())) {
        const row = cells(lines[index] ?? "");
        // Every row has the header's columns, so a short row doesn't shift the table.
        texts.push(header.map((_, column) => row[column] ?? ""));
        index++;
      }
      index--;
      // Numbers line up on the right: a "---:" divider, or a column of prices, counts, ratings.
      const right = header.map(
        (_, column) =>
          /^\s*-+:\s*$/.test(marks[column] ?? "") ||
          (texts.length > 0 &&
            texts.every((row) => NUMBER.test((row[column] ?? "").replace(/\*\*/g, "").trim()))),
      );
      blocks.push({ type: "table", header, rows: texts.map((row) => row.map(runs)), right });
    } else if (!line) flush();
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
      blocks.push({ type: "rule" });
    } else if (heading) {
      flush();
      const level = Math.min(heading[1]?.length ?? 1, 3);
      blocks.push({ type: `h${level}` as "h1", runs: runs(heading[2] ?? "") });
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

const SIZES = { title: 22, h1: 16, h2: 13.5, h3: 12, p: 10.5, bullet: 10.5, number: 10.5 };
const TABLE_SIZE = 9.5;
const INK = rgb(0.067, 0.098, 0.11);
const MUTED = rgb(0.37, 0.41, 0.43);
const LINK = rgb(0.078, 0.451, 0.784);
const LINE = rgb(0.835, 0.859, 0.871);
const HEADER_FILL = rgb(0.933, 0.949, 0.957);
/** Emoji the standard fonts can't draw, as the nearest symbol they can. */
const SYMBOLS: Record<string, string> = { "⭐": "★", "🌟": "★", "✅": "✓", "❌": "✗", "➡": "→" };

/** A piece of a line in one font: a word, a space, or a symbol from a symbol font. */
type Piece = {
  text: string;
  font: PDFFont;
  size: number;
  color: RGB;
  link?: string;
  /** A star, drawn as a shape: the fonts' stars are small and read back as "#". */
  star?: boolean;
};
/** A five-pointed star in a 24 × 24 box. */
const STAR = "M12 2 L14.9 8.6 L22 9.3 L16.6 14 L18.2 21 L12 17.3 L5.8 21 L7.4 14 L2 9.3 L9.1 8.6 Z";

export async function makePdf(title: string, markdown: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("OpenMuse");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const symbol = await pdf.embedFont(StandardFonts.Symbol);
  const dingbats = await pdf.embedFont(StandardFonts.ZapfDingbats);
  const covers = (font: PDFFont) => new Set(font.getCharacterSet());
  const text = covers(regular);
  const symbols = covers(symbol);
  const dings = covers(dingbats);
  const [width, height] = [612, 792];
  const margin = 56;
  const room = width - margin * 2;
  let page: PDFPage = pdf.addPage([width, height]);
  let y = height - margin;
  const newPage = () => {
    page = pdf.addPage([width, height]);
    y = height - margin;
  };

  /**
   * Text in pieces the fonts can draw. The standard fonts cover Western European text; stars,
   * arrows and ticks come from the symbol fonts, and emoji become a symbol or are left out.
   */
  const pieces = (run: Run, size: number, forceBold: boolean, color: RGB): Piece[] => {
    const font = forceBold || run.bold ? bold : regular;
    const out: Piece[] = [];
    const add = (char: string, from: PDFFont, scale = 1) => {
      const last = out.at(-1);
      if (
        last &&
        !last.star &&
        last.font === from &&
        from !== dingbats &&
        !/\s/.test(char) === !/\s/.test(last.text)
      )
        last.text += char;
      else
        out.push({
          text: char,
          font: from,
          size: size * scale,
          color: run.link ? LINK : color,
          link: run.link,
        });
    };
    const source = run.text
      .replace(/ /g, " ")
      .replace(/[\u{FE0F}\u{200D}]/gu, "")
      .replace(/./gu, (c) => SYMBOLS[c] ?? c);
    for (const char of source) {
      const code = char.codePointAt(0) ?? 0;
      if (char === "★")
        out.push({
          text: char,
          font,
          size,
          color: run.link ? LINK : color,
          link: run.link,
          star: true,
        });
      else if (/\s/.test(char)) add(" ", font);
      else if (text.has(code)) add(char, font);
      else if (symbols.has(code)) add(char, symbol);
      else if (dings.has(code)) add(char, dingbats, 0.8);
      else if (char === "…") add("...", font);
      else if (/\p{L}|\p{N}/u.test(char)) add("?", font);
    }
    return out;
  };
  const widthOf = (piece: Piece) =>
    piece.star ? piece.size * 0.82 : piece.font.widthOfTextAtSize(piece.text, piece.size);

  /** Pieces in lines that fit `max`, breaking at spaces (and inside a word too long for a line). */
  const lay = (parts: Piece[], max: number) => {
    const lines: Piece[][] = [];
    let line: Piece[] = [];
    let used = 0;
    // Words: runs of pieces between spaces, so "4.4★" stays together.
    const words: Piece[][] = [];
    let word: Piece[] = [];
    for (const piece of parts) {
      if (piece.text === " " || /^\s+$/.test(piece.text)) {
        if (word.length) words.push(word);
        words.push([piece]);
        word = [];
      } else word.push(piece);
    }
    if (word.length) words.push(word);
    const breakLine = () => {
      while (line.length && /^\s+$/.test(line.at(-1)?.text ?? "")) line.pop();
      lines.push(line);
      line = [];
      used = 0;
    };
    for (const next of words) {
      const space = /^\s+$/.test(next[0]?.text ?? "");
      if (space && !line.length) continue;
      const w = next.reduce((sum, piece) => sum + widthOf(piece), 0);
      if (used + w > max && line.length) {
        breakLine();
        if (space) continue;
      }
      if (w > max) {
        // A long address or word: split it by characters across lines.
        for (const piece of next)
          for (const char of Array.from(piece.text)) {
            const part = { ...piece, text: char };
            const cw = widthOf(part);
            if (used + cw > max && line.length) breakLine();
            const last = line.at(-1);
            if (last && !last.star && last.font === part.font && last.link === part.link)
              last.text += char;
            else line.push(part);
            used += cw;
          }
        continue;
      }
      line.push(...next.map((piece) => ({ ...piece })));
      used += w;
    }
    if (line.length) breakLine();
    return lines;
  };

  /** Draws one laid-out line with its baseline at `base`, links underlined and clickable. */
  const drawLine = (line: Piece[], x: number, base: number) => {
    let at = x;
    const spans: { link: string; from: number; to: number; size: number }[] = [];
    for (const piece of line) {
      const w = widthOf(piece);
      if (piece.star)
        page.drawSvgPath(STAR, {
          x: at,
          y: base + piece.size * 0.78,
          scale: (piece.size * 0.8) / 24,
          color: piece.color,
        });
      else
        page.drawText(piece.text, {
          x: at,
          y: base,
          size: piece.size,
          font: piece.font,
          color: piece.color,
        });
      if (piece.link) {
        const span = spans.at(-1);
        if (span && span.link === piece.link && Math.abs(span.to - at) < 0.01) span.to = at + w;
        else spans.push({ link: piece.link, from: at, to: at + w, size: piece.size });
      }
      at += w;
    }
    for (const span of spans) {
      page.drawLine({
        start: { x: span.from, y: base - 1.5 },
        end: { x: span.to, y: base - 1.5 },
        thickness: 0.6,
        color: LINK,
      });
      const annotation = pdf.context.register(
        pdf.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [span.from, base - 3, span.to, base + span.size],
          Border: [0, 0, 0],
          A: { Type: "Action", S: "URI", URI: PDFString.of(span.link) },
        }),
      );
      page.node.addAnnot(annotation);
    }
  };

  /** A block of text across the page, starting a new page when it runs out of room. */
  const write = (parts: Run[], size: number, indent = 0, forceBold = false, color = INK) => {
    const lineHeight = size * 1.45;
    const lines = lay(
      parts.flatMap((run) => pieces(run, size, forceBold, color)),
      room - indent,
    );
    for (const line of lines) {
      if (y - lineHeight < margin) newPage();
      drawLine(line, margin + indent, y - size);
      y -= lineHeight;
    }
  };

  /** A table across the page: a shaded header row, a line under each row, text wrapped in cells. */
  const table = (header: Run[][], rows: Run[][][], right: boolean[]) => {
    const pad = 6;
    const size = TABLE_SIZE;
    const lineHeight = size * 1.35;
    const columns = header.length;
    const content = (row: Run[][], heading: boolean) =>
      row.map((cell) => cell.flatMap((run) => pieces(run, size, heading, INK)));
    const all = [content(header, true), ...rows.map((row) => content(row, false))];
    // Each column's natural width (its longest cell on one line) and least width (its longest word).
    const natural = Array.from({ length: columns }, (_, c) =>
      Math.max(...all.map((row) => (row[c] ?? []).reduce((sum, p) => sum + widthOf(p), 0))),
    );
    const least = Array.from({ length: columns }, (_, c) =>
      Math.min(
        room / 2,
        Math.max(
          28,
          ...all.flatMap((row) =>
            lay(row[c] ?? [], 1e6)
              .flat()
              .filter((p) => !/^\s+$/.test(p.text))
              .map(widthOf),
          ),
        ),
      ),
    );
    const inner = room - pad * 2 * columns;
    // Short columns (a price, a rating, a link) keep their whole width so they don't wrap; the
    // long ones share what's left, never narrower than their longest word.
    const widths = natural.slice();
    const flexible = new Set(natural.map((_, c) => c));
    for (let changed = true; changed; ) {
      changed = false;
      const fixed = [...natural.keys()]
        .filter((c) => !flexible.has(c))
        .reduce((sum, c) => sum + (natural[c] ?? 0), 0);
      const share = (inner - fixed) / (flexible.size || 1);
      for (const c of flexible)
        if ((natural[c] ?? 0) <= share) {
          flexible.delete(c);
          changed = true;
        }
    }
    if (flexible.size) {
      const fixed = [...natural.keys()]
        .filter((c) => !flexible.has(c))
        .reduce((sum, c) => sum + (natural[c] ?? 0), 0);
      const left = inner - fixed;
      const wanted = [...flexible].reduce((sum, c) => sum + (natural[c] ?? 0), 0);
      for (const c of flexible)
        widths[c] = Math.max(least[c] ?? 0, (left * (natural[c] ?? 0)) / wanted);
    } else {
      // Everything fits on one line: spread the spare room across the columns.
      const total = natural.reduce((a, b) => a + b, 0);
      natural.forEach((w, c) => {
        widths[c] = w + ((inner - total) * w) / (total || 1);
      });
    }
    // When the least widths alone are too wide, shrink everything to fit.
    const sum = widths.reduce((a, b) => a + b, 0);
    if (sum > inner)
      widths.forEach((w, c) => {
        widths[c] = (w * inner) / sum;
      });
    const drawRow = (row: Piece[][], heading: boolean) => {
      const laid = row.map((cell, c) => lay(cell, widths[c] ?? 40));
      const tall = Math.max(1, ...laid.map((lines) => lines.length)) * lineHeight + pad * 1.5;
      if (y - tall < margin) {
        newPage();
        if (!heading) drawRow(all[0] ?? [], true);
      }
      if (heading)
        page.drawRectangle({
          x: margin,
          y: y - tall,
          width: room,
          height: tall,
          color: HEADER_FILL,
        });
      let x = margin;
      laid.forEach((lines, c) => {
        lines.forEach((line, n) => {
          const spare = right[c]
            ? (widths[c] ?? 0) - line.reduce((sum, p) => sum + widthOf(p), 0)
            : 0;
          drawLine(line, x + pad + Math.max(0, spare), y - pad * 0.75 - size - n * lineHeight);
        });
        x += (widths[c] ?? 0) + pad * 2;
      });
      y -= tall;
      page.drawLine({
        start: { x: margin, y },
        end: { x: margin + room, y },
        thickness: heading ? 0.9 : 0.5,
        color: heading ? MUTED : LINE,
      });
    };
    all.forEach((row, index) => {
      drawRow(row, index === 0);
    });
  };

  write([{ text: title, bold: true }], SIZES.title);
  y -= 4;
  page.drawRectangle({ x: margin, y: y - 2, width: 40, height: 3, color: LINK });
  y -= 18;
  let previous: Block["type"] | undefined;
  for (const block of parseBlocks(markdown)) {
    // A little room after a list or table, before whatever follows it.
    if ((previous === "bullet" || previous === "number") && block.type !== previous) y -= 6;
    if (previous === "table") y -= 12;
    previous = block.type;
    if (block.type === "rule") {
      y -= 6;
      if (y - 12 < margin) newPage();
      page.drawLine({
        start: { x: margin, y },
        end: { x: margin + room, y },
        thickness: 0.5,
        color: LINE,
      });
      y -= 12;
    } else if (block.type === "table") {
      y -= 4;
      table(block.header, block.rows, block.right);
    } else if (block.type === "h1" || block.type === "h2" || block.type === "h3") {
      const size = SIZES[block.type];
      y -= size * 0.7;
      // Keep a heading with the first lines after it.
      if (y - size * 4 < margin) newPage();
      write(block.runs, size, 0, true);
      y -= 2;
    } else if (block.type === "bullet" || block.type === "number") {
      const size = SIZES[block.type];
      if (y - size * 1.45 < margin) newPage();
      page.drawText(block.label, { x: margin + 4, y: y - size, size, font: regular, color: MUTED });
      write(block.runs, size, 20);
      y -= 3;
    } else {
      write(block.runs, SIZES.p);
      y -= SIZES.p * 0.75;
    }
  }
  // "2 of 3" at the foot of each page of a longer document.
  const pages = pdf.getPages();
  if (pages.length > 1)
    pages.forEach((sheet, index) => {
      const label = `${index + 1} of ${pages.length}`;
      sheet.drawText(label, {
        x: width - margin - regular.widthOfTextAtSize(label, 8),
        y: margin / 2,
        size: 8,
        font: regular,
        color: MUTED,
      });
    });
  return pdf.save();
}

export async function makeDocx(title: string, markdown: string): Promise<Uint8Array> {
  const textRuns = (parts: Run[], size?: number, forceBold = false) =>
    parts.map((run) =>
      run.link
        ? new ExternalHyperlink({
            link: run.link,
            children: [
              new TextRun({
                text: run.text,
                bold: run.bold || forceBold,
                size,
                style: "Hyperlink",
              }),
            ],
          })
        : new TextRun({ text: run.text, bold: run.bold || forceBold, size }),
    );
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: title, bold: true })],
    }),
    ...parseBlocks(markdown).map((block) => {
      if (block.type === "rule")
        return new Paragraph({
          children: [],
          border: { bottom: { style: "single", size: 6, color: "D5DBDE", space: 1 } },
        });
      if (block.type === "table") {
        const row = (cells: Run[][], heading: boolean) =>
          new TableRow({
            tableHeader: heading,
            children: cells.map(
              (cell) =>
                new TableCell({
                  children: [new Paragraph({ children: textRuns(cell, 19, heading) })],
                  margins: { top: 60, bottom: 60, left: 100, right: 100 },
                  ...(heading
                    ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: "EEF2F4" } }
                    : {}),
                }),
            ),
          });
        return new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [row(block.header, true), ...block.rows.map((cells) => row(cells, false))],
        });
      }
      if (block.type === "bullet")
        return new Paragraph({ bullet: { level: 0 }, children: textRuns(block.runs) });
      if (block.type === "number")
        return new Paragraph({
          children: [new TextRun(`${block.label} `), ...textRuns(block.runs)],
        });
      if (block.type === "p")
        return new Paragraph({ children: textRuns(block.runs), spacing: { after: 160 } });
      return new Paragraph({
        heading:
          block.type === "h1"
            ? HeadingLevel.HEADING_1
            : block.type === "h2"
              ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3,
        children: textRuns(block.runs),
      });
    }),
  ];
  const doc = new Document({ creator: "OpenMuse", title, sections: [{ children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}
