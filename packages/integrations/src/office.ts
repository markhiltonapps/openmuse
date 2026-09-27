import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

// Spreadsheets and slide decks the agent makes, and the text of slide decks people share.

export type Cell = string | number | boolean | null;
export interface Sheet {
  name: string;
  columns: string[];
  rows: Cell[][];
}

const xml = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
/** "A", "B", … "Z", "AA", … for a zero-based column. */
export function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
/** Excel's sheet-name rules: at most 31 characters, none of []:*?/\ and unique. */
function sheetNames(sheets: Sheet[]) {
  const used = new Set<string>();
  return sheets.map((sheet, i) => {
    const base = (sheet.name.replace(/[[\]:*?/\\]/g, " ").trim() || `Sheet${i + 1}`).slice(0, 31);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function cellXml(value: Cell, ref: string, header: boolean) {
  const style = header ? ' s="1"' : "";
  if (value === null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value))
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  const text = String(value);
  // "=SUM(B2:B9)" is a formula that Excel, Numbers and Sheets work out when the file opens.
  if (!header && /^=[A-Z]/i.test(text) && text.length <= 500)
    return `<c r="${ref}"${style}><f>${xml(text.slice(1))}</f></c>`;
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(text.slice(0, 32000))}</t></is></c>`;
}

function sheetXml(sheet: Sheet) {
  const rows = [sheet.columns, ...sheet.rows].slice(0, 10001);
  const width = Math.max(1, ...rows.map((r) => r.length));
  // Columns as wide as their longest value, within reason.
  const cols = Array.from({ length: width }, (_, c) => {
    const longest = Math.max(...rows.map((r) => String(r[c] ?? "").length));
    return `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(8, longest + 2))}" customWidth="1"/>`;
  }).join("");
  const body = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .slice(0, 200)
          .map((value, c) => cellXml(value, `${columnName(c)}${r + 1}`, r === 0))
          .join("")}</row>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
}

/** An .xlsx workbook: a bold, frozen header row per sheet, numbers as numbers and "=" formulas. */
export function makeXlsx(sheets: Sheet[]): Uint8Array {
  const list = sheets.length ? sheets.slice(0, 20) : [{ name: "Sheet1", columns: [], rows: [] }];
  const names = sheetNames(list);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
      .map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join(
        "",
      )}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2F5F3"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
  };
  list.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet));
  });
  return zipSync(files, { level: 6 });
}

export interface Slide {
  title: string;
  bullets?: string[];
  notes?: string;
}

/** A clean 16:9 deck: a title slide, then a title and bullets on each slide, with speaker notes. */
export async function makePptx(title: string, slides: Slide[], subtitle = ""): Promise<Uint8Array> {
  const PptxGenJS = (await import("pptxgenjs"))
    .default as unknown as typeof import("pptxgenjs").default;
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.title = title;
  deck.author = "Neato_Muse";
  const ink = "291A14";
  const teal = "1E6B6B";
  deck.defineSlideMaster({
    title: "CONTENT",
    background: { color: "F6F5EE" },
    objects: [{ rect: { x: 0, y: 7.2, w: 13.33, h: 0.3, fill: { color: "45C4C2" } } }],
  });
  const cover = deck.addSlide();
  cover.background = { color: "F6F5EE" };
  cover.addShape("rect", { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: "45C4C2" } });
  cover.addText(title, {
    x: 0.9,
    y: 2.4,
    w: 11.5,
    h: 1.6,
    fontSize: 40,
    bold: true,
    color: ink,
    fontFace: "Calibri",
    valign: "bottom",
  });
  if (subtitle)
    cover.addText(subtitle, { x: 0.9, y: 4.1, w: 11.5, h: 0.8, fontSize: 20, color: teal });
  for (const slide of slides.slice(0, 60)) {
    const page = deck.addSlide({ masterName: "CONTENT" });
    page.addText(slide.title.slice(0, 200), {
      x: 0.7,
      y: 0.45,
      w: 11.9,
      h: 1,
      fontSize: 30,
      bold: true,
      color: ink,
      fontFace: "Calibri",
    });
    const bullets = (slide.bullets ?? []).slice(0, 12).map((text) => ({
      text: text.slice(0, 500),
      options: { bullet: true, breakLine: true },
    }));
    if (bullets.length)
      page.addText(bullets, {
        x: 0.9,
        y: 1.7,
        w: 11.5,
        h: 5.2,
        fontSize: bullets.length > 6 ? 18 : 22,
        color: ink,
        valign: "top",
        paraSpaceAfter: 10,
      });
    if (slide.notes) page.addNotes(slide.notes.slice(0, 4000));
  }
  const out = await deck.write({ outputType: "uint8array" });
  return out as Uint8Array;
}

/** The text of each slide in a .pptx, in order, with its speaker notes. */
export function pptxPages(bytes: Uint8Array): string[] {
  const zip = unzipSync(bytes, {
    filter: (file) => /^ppt\/(slides|notesSlides)\/\w+\d+\.xml$/.test(file.name),
  });
  const number = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
  const text = (xmlText: string) =>
    xmlText
      .split(/<\/a:p>/)
      .map((paragraph) =>
        [...paragraph.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
          .map((m) => m[1] ?? "")
          .join("")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, "&")
          .trim(),
      )
      .filter(Boolean)
      .join("\n");
  const slides = Object.keys(zip)
    .filter((name) => name.startsWith("ppt/slides/"))
    .sort((a, b) => number(a) - number(b));
  if (!slides.length) throw new Error("No slides found");
  return slides.map((name, i) => {
    const notes = zip[`ppt/notesSlides/notesSlide${number(name)}.xml`];
    const noteText = notes ? text(strFromU8(notes)).replace(/^\d+$/gm, "").trim() : "";
    return `Slide ${i + 1}\n\n${text(strFromU8(zip[name] as Uint8Array))}${noteText ? `\n\nSpeaker notes: ${noteText}` : ""}`;
  });
}
