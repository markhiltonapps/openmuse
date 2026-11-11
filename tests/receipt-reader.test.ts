import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  daysBetween,
  parseReceiptRead,
  plausibleDate,
  readReceipt,
  receiptPrompt,
  reconcile,
} from "../apps/server/src/receipt-reader.ts";

const good = {
  isReceipt: true,
  merchant: "Target",
  date: "2026-11-11",
  currency: "USD",
  total: 61.27,
  subtotal: 56.5,
  tax: 4.77,
  tip: null,
  paymentLast4: "4821",
  category: "Home",
  returnDays: 30,
  items: [
    { name: "Towels", amount: 30.5 },
    { name: "Lamp", amount: 26 },
  ],
};
const parse = (value: unknown) => {
  const result = parseReceiptRead(typeof value === "string" ? value : JSON.stringify(value));
  assert.ok(result.ok, result.ok ? "" : result.why);
  return result.read;
};

test("a clean answer parses and keeps what was read", () => {
  const read = parse(good);
  assert.equal(read.merchant, "Target");
  assert.equal(read.total, 61.27);
  assert.equal(read.returnDays, 30);
  assert.equal(read.category, "Home");
  assert.equal(read.items.length, 2);
});

test("a code fence or a sentence around the JSON is tolerated", () => {
  assert.equal(
    parse(`Here you go:\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\``).merchant,
    "Target",
  );
});

test("amounts given as text become numbers, with decimal commas and symbols", () => {
  const read = parse({ ...good, total: "$1,284.50", tax: "4,77", tip: "" });
  assert.equal(read.total, 1284.5);
  assert.equal(read.tax, 4.77);
  assert.equal(read.tip, null);
});

test("only the last four card digits are ever kept", () => {
  assert.equal(parse({ ...good, paymentLast4: "4111 1111 1111 4821" }).paymentLast4, "4821");
  assert.equal(parse({ ...good, paymentLast4: "12" }).paymentLast4, null);
});

test("card numbers typed into free text are hidden before anything is kept", () => {
  const read = parse({ ...good, notes: "paid with 4111 1111 1111 1111", merchant: "Target" });
  assert.ok(!read.notes.includes("4111 1111 1111 1111"));
});

test("an unknown category becomes Other, a bad date becomes null, a silly return window is dropped", () => {
  const read = parse({ ...good, category: "Spaceships", date: "11/11/2026", returnDays: 9000 });
  assert.equal(read.category, "Other");
  assert.equal(read.date, null);
  assert.equal(read.returnDays, null);
});

test("an answer that isn't JSON fails with a reason", () => {
  const result = parseReceiptRead("I can't see a receipt.");
  assert.equal(result.ok, false);
});

test("the prompt carries today's date and treats the image's text as data", () => {
  const prompt = receiptPrompt({ today: "2026-11-11" });
  assert.ok(prompt.includes("2026-11-11"));
  assert.ok(/never instructions/.test(prompt));
});

test("reconcile: a clear total with matching sums is sure", () => {
  const result = reconcile(parse(good));
  assert.equal(result.status, "sure");
  assert.equal(result.total, 61.27);
});

test("reconcile: a smudged total is settled by the receipt's own sums, without asking", () => {
  const read = parse({ ...good, total: 61.21, totalOtherReadings: [61.27], unclear: ["total"] });
  const result = reconcile(read);
  assert.equal(result.status, "sure");
  assert.equal(result.total, 61.27);
  assert.equal(result.settledBy, "sums");
});

test("reconcile: when the sums don't settle it, the person picks", () => {
  const read = parse({
    ...good,
    subtotal: null,
    items: [],
    total: 61.27,
    totalOtherReadings: [67.27],
    unclear: ["total"],
  });
  const result = reconcile(read);
  assert.equal(result.status, "pick");
  assert.deepEqual(result.candidates.sort(), [61.27, 67.27]);
});

test("reconcile: a single clear total that the sums contradict is worth a question", () => {
  const result = reconcile(parse({ ...good, total: 91.27 }));
  assert.equal(result.status, "pick");
});

test("reconcile: no total at all is missing", () => {
  const result = reconcile(parse({ ...good, total: null, subtotal: null, items: [] }));
  assert.equal(result.status, "missing");
});

test("reconcile: a tip is part of the sum", () => {
  const read = parse({
    ...good,
    subtotal: 40,
    tax: 3.2,
    tip: 8,
    total: 51.2,
    items: [],
    totalOtherReadings: [],
  });
  assert.equal(reconcile(read).status, "sure");
});

test("date arithmetic is calendar-exact", () => {
  assert.equal(addDays("2026-11-11", 30), "2026-12-11");
  assert.equal(addDays("2026-12-20", 30), "2027-01-19");
  assert.equal(daysBetween("2026-11-11", "2026-12-11"), 30);
  assert.equal(daysBetween("2026-12-11", "2026-11-11"), -30);
});

test("a date in the future or years old is treated as unclear", () => {
  assert.equal(plausibleDate("2026-11-11", "2026-11-11"), "2026-11-11");
  assert.equal(plausibleDate("2027-03-01", "2026-11-11"), null);
  assert.equal(plausibleDate("2015-01-01", "2026-11-11"), null);
});

test("readReceipt tries once more when the first answer isn't usable, then gives up kindly", async () => {
  let calls = 0;
  const flaky = async () => (++calls === 1 ? "sorry, no" : JSON.stringify(good));
  const result = await readReceipt(
    flaky,
    { bytes: new Uint8Array(1), mimeType: "image/png" },
    { today: "2026-11-11" },
  );
  assert.equal(calls, 2);
  assert.equal(result.reconciled.status, "sure");
  let tries = 0;
  await assert.rejects(
    readReceipt(
      async () => {
        tries += 1;
        return "nope";
      },
      { bytes: new Uint8Array(1), mimeType: "image/png" },
      { today: "2026-11-11" },
    ),
    /could not be read/,
  );
  assert.equal(tries, 2);
});

test("readReceipt flags the fields to check: missing date and merchant", async () => {
  const result = await readReceipt(
    async () => JSON.stringify({ ...good, date: null, merchant: null }),
    { bytes: new Uint8Array(1), mimeType: "image/png" },
    { today: "2026-11-11" },
  );
  assert.ok(result.unclear.includes("date"));
  assert.ok(result.unclear.includes("merchant"));
});

test("reconcile: prices that already include tax don't raise a false question", () => {
  const read = parse({
    ...good,
    currency: "EUR",
    subtotal: null,
    tax: 1.42,
    total: 18.8,
    items: [
      { name: "Pain", amount: 8.8 },
      { name: "Fromage", amount: 10 },
    ],
  });
  assert.equal(reconcile(read).status, "sure");
});

test("the prompt tells the model to leave a handwritten tip out and to read dates from the receipt first", () => {
  const prompt = receiptPrompt({ today: "2026-11-11" });
  assert.ok(/handwritten/.test(prompt));
  assert.ok(/own clues first/.test(prompt));
});
