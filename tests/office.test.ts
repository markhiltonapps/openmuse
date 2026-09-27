import assert from "node:assert/strict";
import { test } from "node:test";
import { unzipSync } from "fflate";
import { detectKind, documentPages } from "../packages/integrations/src/documents.ts";
import { columnName, makePptx, makeXlsx } from "../packages/integrations/src/office.ts";

test("spreadsheets open with their sheets, numbers, formulas and a bold header", async () => {
  const bytes = makeXlsx([
    {
      name: "Budget: Oct/Nov",
      columns: ["Item", "Cost", "Paid"],
      rows: [
        ["Rent", 1800, true],
        ["Groceries <weekly> & more", 420.5, false],
        ["Total", "=SUM(B2:B3)", null],
      ],
    },
    { name: "Budget: Oct/Nov", columns: ["Notes"], rows: [["Second sheet, same name"]] },
  ]);
  assert.equal(detectKind("budget.xlsx", bytes), "xlsx");
  const pages = await documentPages("xlsx", bytes);
  assert.match(pages[0] ?? "", /Sheet: Budget {2}Oct Nov/);
  assert.match(pages[0] ?? "", /Rent \| 1800 \| true/);
  assert.match(pages[0] ?? "", /Groceries <weekly> & more \| 420\.5/);
  assert.match(pages[1] ?? "", /Sheet: Budget {2}Oct Nov 2/);
  const sheet = new TextDecoder().decode(unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /<f>SUM\(B2:B3\)<\/f>/);
  assert.match(sheet, /<c r="A1" t="inlineStr" s="1">/);
  assert.match(sheet, /state="frozen"/);
  assert.equal(columnName(0), "A");
  assert.equal(columnName(27), "AB");
});

test("slide decks round-trip through the PowerPoint reader, notes included", async () => {
  const bytes = await makePptx(
    "Q4 plan",
    [
      { title: "Where we are", bullets: ["Revenue up", "Two hires"], notes: "Keep it short" },
      { title: "What's next", bullets: ["Launch the beta"] },
    ],
    "Neato Ventures",
  );
  assert.equal(detectKind("plan.pptx", bytes), "pptx");
  const pages = await documentPages("pptx", bytes);
  assert.equal(pages.length, 3);
  assert.match(pages[0] ?? "", /^Slide 1\n\nQ4 plan\nNeato Ventures/);
  assert.match(pages[1] ?? "", /Where we are\nRevenue up\nTwo hires/);
  assert.match(pages[1] ?? "", /Speaker notes: Keep it short/);
  assert.match(pages[2] ?? "", /Launch the beta/);
});
