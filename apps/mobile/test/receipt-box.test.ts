import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  briefAsReceipt,
  closesIn,
  closingSoon,
  daysBetween,
  daysLeft,
  differInLastDigit,
  doubts,
  fileBlock,
  filterChips,
  filterReceipts,
  fitWithin,
  groupReceipts,
  homeCardKind,
  keepForChange,
  localToday,
  longDate,
  maskedTotal,
  moneyText,
  moneyWhole,
  monthLabel,
  needsWords,
  orList,
  parseMoney,
  parseToolResult,
  photoRefusedForGood,
  type Receipt,
  relativeDay,
  reminderOn,
  returnByText,
  shortDate,
  unsureFields,
} from "../src/receipt-box-logic.ts";

const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  id: "r1",
  status: "filed",
  merchant: "Target",
  date: "2026-11-11",
  total: 61.27,
  candidates: [],
  tax: null,
  currency: "USD",
  category: "Home",
  paidLast4: null,
  keepFor: [],
  returnDays: null,
  returnBy: null,
  returnState: "open",
  returnPolicy: null,
  warranty: false,
  note: "",
  unsure: [],
  fileId: "f1",
  source: "photo",
  autoFiled: false,
  edited: false,
  createdAt: "2026-11-11T18:00:00.000Z",
  ...over,
});

test("money reads as dollars, other currencies as a number and a code", () => {
  assert.equal(moneyText(61.27), "$61.27");
  assert.equal(moneyText(1284.5), "$1,284.50");
  assert.equal(moneyText(649.99, "USD"), "$649.99");
  assert.equal(moneyText(61.2, "EUR"), "61.20 EUR");
  assert.equal(moneyText(1234567.891, "EUR"), "1,234,567.89 EUR");
  assert.equal(moneyText(0), "$0.00");
  assert.equal(moneyText(null), "No total");
  assert.equal(moneyText(Number.NaN), "No total");
});

test("a month's total is whole dollars, with cents only below $100", () => {
  assert.equal(moneyWhole(1284.49), "$1,284");
  assert.equal(moneyWhole(1284.5), "$1,285");
  assert.equal(moneyWhole(61.27), "$61.27");
  assert.equal(moneyWhole(0), "$0.00");
});

test("a total that can't be told apart shows the unsure digits as question marks", () => {
  assert.equal(maskedTotal([61.27, 61.21]), "$61.2?");
  assert.equal(maskedTotal([61.27, 67.27]), "$6?.27");
  assert.equal(maskedTotal([61.27, 51.21, 41.29]), "$?1.2?");
  assert.equal(maskedTotal([61.27, 61.21], "EUR"), "61.2? EUR");
  assert.equal(maskedTotal([9.99, 10.99]), null, "different lengths can't be lined up");
  assert.equal(maskedTotal([61.27]), null);
  assert.equal(differInLastDigit([61.27, 61.21]), true);
  assert.equal(differInLastDigit([61.27, 67.27]), false);
});

test("lists read in words", () => {
  assert.equal(orList(["$61.27", "$61.21"]), "$61.27 or $61.21");
  assert.equal(orList(["a", "b", "c"]), "a, b or c");
  assert.equal(orList(["a"]), "a");
});

test("typed money: dollar signs, thousands commas and decimal commas", () => {
  assert.equal(parseMoney("$61.27"), 61.27);
  assert.equal(parseMoney("1,284.50"), 1284.5);
  assert.equal(parseMoney("61,27"), 61.27);
  assert.equal(parseMoney(" 12 "), 12);
  assert.equal(parseMoney("abc"), undefined);
  assert.equal(parseMoney(""), undefined);
  assert.equal(parseMoney("-5"), undefined, "a receipt total isn't negative");
  assert.equal(parseMoney("2000000"), undefined, "over the server's limit");
});

test("today is the local calendar day built from the parts, not UTC's day", () => {
  // 11:30 pm on Nov 11 in Los Angeles is already Nov 12 in UTC.
  const instant = new Date("2026-11-12T07:30:00Z");
  assert.equal(localToday(instant, "America/Los_Angeles"), "2026-11-11");
  assert.equal(localToday(instant, "UTC"), "2026-11-12");
  assert.equal(localToday(instant, "Asia/Tokyo"), "2026-11-12");
  // A date made of this machine's own parts never comes from toISOString.
  const local = new Date(2026, 0, 5, 23, 59);
  assert.equal(localToday(local), "2026-01-05");
  // An unknown zone falls back to the device's own day.
  assert.equal(localToday(local, "Not/AZone"), "2026-01-05");
});

test("days count across months and years", () => {
  assert.equal(daysBetween("2026-11-11", "2026-12-11"), 30);
  assert.equal(daysBetween("2026-12-11", "2026-11-11"), -30);
  assert.equal(daysBetween("2026-12-30", "2027-01-02"), 3);
  assert.equal(addDays("2026-11-11", 30), "2026-12-11");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  // The end of daylight saving doesn't make a day 23 or 25 hours: days are calendar days.
  assert.equal(daysBetween("2026-11-01", "2026-11-02"), 1);
});

test("dates read as 'Nov 11', with the year only when it isn't this year", () => {
  assert.equal(shortDate("2026-11-11", "2026-11-20"), "Nov 11");
  assert.equal(shortDate("2025-12-01", "2026-11-20"), "Dec 1, 2025");
  assert.equal(shortDate(null, "2026-11-20"), "No date");
  assert.equal(longDate("2026-11-11"), "Wed, Nov 11, 2026");
  assert.equal(longDate("2026-11-10"), "Tue, Nov 10, 2026");
  assert.equal(relativeDay("2026-11-11", "2026-11-11"), "Today");
  assert.equal(relativeDay("2026-11-10", "2026-11-11"), "Yesterday");
  assert.equal(relativeDay("2026-11-09", "2026-11-11"), "Nov 9");
  assert.equal(monthLabel("2026-11", "2026-11-11"), "November");
  assert.equal(monthLabel("2025-12", "2026-11-11"), "December 2025");
});

test("return-by wording: when it closes, what's left", () => {
  assert.equal(returnByText("2026-12-11", "2026-11-11"), "Return by Dec 11");
  assert.equal(closesIn(0), "closes today");
  assert.equal(closesIn(1), "closes tomorrow");
  assert.equal(closesIn(9), "closes in 9 days");
  assert.equal(closesIn(-1), "closed yesterday");
  assert.equal(closesIn(-3), "closed 3 days ago");
  assert.equal(daysLeft("2026-12-10", "2026-11-11"), "29 days left");
  assert.equal(daysLeft("2026-11-12", "2026-11-11"), "1 day left");
  assert.equal(daysLeft("2026-11-11", "2026-11-11"), "Last day");
  assert.equal(daysLeft("2026-11-08", "2026-11-11"), "Closed 3 days ago");
});

test("the reminder day is the server's real one, in the person's calendar, and only while it's still ahead", () => {
  const now = new Date("2026-11-11T20:00:00Z");
  const base = { status: "filed" as const, returnState: "open" as const };
  // 9 am in Los Angeles on Dec 8 is 17:00 UTC.
  assert.equal(
    reminderOn({ ...base, reminderAt: "2026-12-08T17:00:00.000Z" }, now, "America/Los_Angeles"),
    "2026-12-08",
  );
  // 11 pm in Los Angeles is already the next day in UTC: the person's day wins.
  assert.equal(
    reminderOn({ ...base, reminderAt: "2026-12-09T07:00:00.000Z" }, now, "America/Los_Angeles"),
    "2026-12-08",
  );
  assert.equal(reminderOn({ ...base }, now), null, "no reminder was set");
  assert.equal(
    reminderOn({ ...base, reminderAt: "2026-11-10T17:00:00.000Z" }, now),
    null,
    "already went off",
  );
  assert.equal(
    reminderOn({ ...base, returnState: "returned", reminderAt: "2026-12-08T17:00:00.000Z" }, now),
    null,
  );
  assert.equal(
    reminderOn({ ...base, status: "to-check", reminderAt: "2026-12-08T17:00:00.000Z" }, now),
    null,
  );
  assert.equal(reminderOn({ ...base, reminderAt: "nonsense" }, now), null);
});

test("closing soon: filed, still open, within two weeks, soonest first", () => {
  const list = [
    receipt({ id: "a", merchant: "Home Depot", returnBy: "2026-11-20" }),
    receipt({ id: "b", merchant: "Best Buy", returnBy: "2026-11-14" }),
    receipt({ id: "c", merchant: "Costco", returnBy: "2026-12-30" }),
    receipt({ id: "d", merchant: "Past", returnBy: "2026-11-01" }),
    receipt({ id: "e", merchant: "Returned", returnBy: "2026-11-15", returnState: "returned" }),
    receipt({ id: "f", merchant: "Unfiled", returnBy: "2026-11-15", status: "to-check" }),
    receipt({ id: "g", merchant: "Abe", returnBy: "2026-11-14" }),
    receipt({ id: "h", merchant: "Today", returnBy: "2026-11-11" }),
    receipt({ id: "i", merchant: "Edge", returnBy: "2026-11-25" }),
  ];
  const soon = closingSoon(list, "2026-11-11");
  assert.deepEqual(
    soon.map((item) => item.id),
    ["h", "g", "b", "a", "i"],
  );
  assert.deepEqual(
    soon.map((item) => item.days),
    [0, 3, 3, 9, 14],
  );
  assert.equal(closingSoon(list, "2026-11-11", 3).length, 3);
});

test("what's doubtful on a card, in the words the person sees", () => {
  const picks = receipt({
    status: "to-check",
    total: null,
    candidates: [61.27, 61.21],
    unsure: ["total"],
  });
  assert.deepEqual(doubts(picks), [
    "I couldn’t read the last digit of the total. Is it $61.27 or $61.21?",
  ]);
  const bigger = receipt({ candidates: [61.27, 67.27] });
  assert.match(doubts(bigger)[0] ?? "", /all of the total/);
  // Choosing a total clears the readings on the server; editing something else does not.
  assert.equal(
    doubts(receipt({ candidates: [61.27, 61.21], edited: true })).length,
    1,
    "an edit elsewhere doesn't settle it",
  );
  assert.deepEqual(doubts(receipt({ total: null })), [
    "I couldn’t find the total. Add it to file this one.",
  ]);
  assert.deepEqual(doubts(receipt({ unsure: ["total"] })), [
    "I wasn’t sure about the total. Check it against your receipt.",
  ]);
  assert.deepEqual(doubts(receipt({ merchant: null, date: null })), [
    "I couldn’t read the store name. Add it to file this one.",
    "I couldn’t read the date.",
  ]);
  assert.deepEqual(doubts(receipt()), []);
  assert.ok(doubts(receipt({ unsure: ["tax", "payment"] })).length === 2);
});

test("which fields are marked amber", () => {
  assert.deepEqual([...unsureFields(receipt())], []);
  assert.deepEqual([...unsureFields(receipt({ unsure: ["date"] }))], ["date"]);
  assert.deepEqual([...unsureFields(receipt({ merchant: null, total: null }))].sort(), [
    "merchant",
    "total",
  ]);
  assert.deepEqual([...unsureFields(receipt({ candidates: [1, 2] }))], ["total"]);
  assert.deepEqual([...unsureFields(receipt({ candidates: [1, 2], edited: true }))], ["total"]);
});

test("File it waits for what the server also insists on", () => {
  assert.equal(fileBlock(receipt()), null);
  const picks = receipt({ candidates: [61.27, 61.21] });
  assert.equal(fileBlock(picks), "Pick the total first.");
  assert.equal(fileBlock(picks, true), "Pick the total first, or say “it’s $61.21”.");
  // Only choosing a total lifts it (the server clears the readings); an edit elsewhere doesn't.
  assert.equal(fileBlock({ ...picks, edited: true }), "Pick the total first.");
  assert.equal(fileBlock(receipt({ total: null })), "Add the total first.");
  assert.equal(fileBlock(receipt({ total: null }), true), "Add the total first, or say it.");
  assert.equal(fileBlock(receipt({ merchant: null })), "Add the store first.");
  assert.equal(
    fileBlock(receipt({ merchant: null }), true),
    "Add the store first, or say its name.",
  );
  assert.equal(
    fileBlock(receipt({ merchant: null, total: null })),
    "Add the store and the total first.",
  );
});

test("a To check row says what's wrong in a few words", () => {
  assert.equal(needsWords(receipt({ candidates: [1, 2] })), "Which total is right?");
  assert.equal(needsWords(receipt({ total: null })), "No total found");
  assert.equal(needsWords(receipt({ merchant: null })), "No store name");
  assert.equal(needsWords(receipt({ unsure: ["date"] })), "Check the date");
  assert.equal(needsWords(receipt()), "Ready to check");
});

test("keep-for tags: turning Return window off also drops the return date", () => {
  assert.deepEqual(keepForChange({ keepFor: ["Warranty"] }, "Tax time", true), {
    keepFor: ["Warranty", "Tax time"],
  });
  assert.deepEqual(keepForChange({ keepFor: ["Return window", "Warranty"] }, "Warranty", false), {
    keepFor: ["Return window"],
  });
  assert.deepEqual(
    keepForChange({ keepFor: ["Return window", "Warranty"] }, "Return window", false),
    {
      keepFor: ["Warranty"],
      returnBy: null,
    },
  );
  assert.deepEqual(keepForChange({ keepFor: [] }, "Return window", true), {
    keepFor: ["Return window"],
  });
});

test("the list: newest first, by month and day, with each month's total", () => {
  const list = [
    receipt({ id: "1", date: "2026-11-11", total: 61.27 }),
    receipt({ id: "2", date: "2026-11-11", total: 14.75, createdAt: "2026-11-11T19:00:00.000Z" }),
    receipt({ id: "3", date: "2026-11-10", total: 649.99 }),
    receipt({ id: "4", date: "2026-10-30", total: 20 }),
    receipt({ id: "5", date: null, total: 5 }),
    receipt({ id: "6", date: "2025-12-24", total: 100 }),
  ];
  const groups = groupReceipts(list, "2026-11-11");
  assert.deepEqual(
    groups.map((g) => g.label),
    ["November", "October", "December 2025", "No date"],
  );
  const november = groups[0];
  assert.equal(november?.total, 726.01);
  assert.equal(november?.count, 3);
  assert.deepEqual(
    november?.days.map((d) => d.label),
    ["Today", "Yesterday"],
  );
  // Same day: the one added later is first.
  assert.deepEqual(
    november?.days[0]?.items.map((r) => r.id),
    ["2", "1"],
  );
});

test("filters by chip and by words", () => {
  const list = [
    receipt({
      id: "1",
      merchant: "Best Buy",
      category: "Home",
      keepFor: ["Return window", "Warranty"],
      total: 649.99,
    }),
    receipt({ id: "2", merchant: "Costco", category: "Groceries", keepFor: [] }),
    receipt({
      id: "3",
      merchant: "CVS Pharmacy",
      category: "Health",
      keepFor: ["Tax time"],
      note: "allergy meds",
    }),
  ];
  const ids = (found: Receipt[]) => found.map((r) => r.id);
  assert.deepEqual(ids(filterReceipts(list, { chip: "keep:Warranty" })), ["1"]);
  assert.deepEqual(ids(filterReceipts(list, { chip: "cat:Groceries" })), ["2"]);
  assert.deepEqual(ids(filterReceipts(list, { text: "best" })), ["1"]);
  assert.deepEqual(ids(filterReceipts(list, { text: "ALLERGY" })), ["3"]);
  assert.deepEqual(ids(filterReceipts(list, { text: "649.99" })), ["1"]);
  assert.deepEqual(ids(filterReceipts(list, { text: "  " })), ["1", "2", "3"]);
  assert.deepEqual(ids(filterReceipts(list, { chip: "cat:Home", text: "costco" })), []);
  const chips = filterChips(list);
  assert.deepEqual(
    chips.map((c) => c.key),
    [
      "keep:Return window",
      "keep:Warranty",
      "keep:Tax time",
      "cat:Groceries",
      "cat:Home",
      "cat:Health",
    ],
  );
  assert.equal(chips[0]?.count, 1);
});

test("Home's card: something to check or a close date, or the first-use invitation, or nothing", () => {
  const summary = (over: Record<string, unknown> = {}) => ({
    available: true,
    receipts: [receipt()],
    toCheck: 0,
    filedCount: 1,
    filedThisMonth: 1,
    monthTotal: 61.27,
    closingSoon: [],
    autoFile: { on: false, offer: false },
    ...over,
  });
  assert.equal(homeCardKind(undefined), null);
  assert.equal(homeCardKind(summary()), null, "filed receipts and nothing to say");
  assert.equal(homeCardKind(summary({ toCheck: 1 })), "attention");
  assert.equal(
    homeCardKind(
      summary({
        closingSoon: [{ id: "a", merchant: "X", total: 1, returnBy: "2026-11-12", days: 1 }],
      }),
    ),
    "attention",
  );
  assert.equal(homeCardKind(summary({ receipts: [] })), "invite");
  assert.equal(
    homeCardKind(summary({ receipts: [], available: false })),
    null,
    "nothing to invite to",
  );
  assert.equal(homeCardKind(summary({ receipts: [], toCheck: 2 })), "attention");
});

test("photos are shrunk to 1600 pixels on the longest side, never enlarged", () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 1600, height: 1200, scaled: true });
  assert.deepEqual(fitWithin(3000, 4000), { width: 1200, height: 1600, scaled: true });
  assert.deepEqual(fitWithin(1600, 900), { width: 1600, height: 900, scaled: false });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600, scaled: false });
  assert.deepEqual(fitWithin(10000, 1), { width: 1600, height: 1, scaled: true });
});

test("the agent tool's answer is read tolerantly", () => {
  const filed = parseToolResult(
    JSON.stringify({
      outcome: "filed automatically",
      receipt: {
        id: "r1",
        status: "filed",
        merchant: "Target",
        date: "2026-11-11",
        total: 61.27,
        currency: "USD",
        category: "Home",
        keepFor: ["Return window"],
        returnBy: "2026-12-11",
        paidLast4: "4821",
        filedByNeddy: true,
      },
      shown: "On their screen.",
    }),
  );
  assert.equal(filed?.receipt?.merchant, "Target");
  assert.equal(filed?.receipt?.filedByNeddy, true);
  assert.equal(filed?.shown, "On their screen.");
  const waiting = parseToolResult({
    count: 2,
    receipts: [
      {
        id: "a",
        status: "to-check",
        merchant: null,
        date: "bad",
        total: "x",
        currency: "USD",
        category: "Other",
        keepFor: [],
        returnBy: null,
        paidLast4: null,
        chooseBetween: [1, 2, "x"],
      },
      { id: 5 },
      null,
    ],
  });
  assert.equal(waiting?.count, 2);
  assert.equal(waiting?.receipts?.length, 1, "an entry that isn't a receipt is dropped");
  assert.equal(waiting?.receipts?.[0]?.date, null);
  assert.equal(waiting?.receipts?.[0]?.total, null);
  assert.deepEqual(waiting?.receipts?.[0]?.chooseBetween, [1, 2]);
  assert.equal(parseToolResult("not json"), undefined);
  assert.equal(parseToolResult(null), undefined);
  assert.equal(parseToolResult([1]), undefined);
  assert.equal(parseToolResult({ error: "Nothing is filed yet." })?.error, "Nothing is filed yet.");
  const asReceipt = briefAsReceipt(waiting?.receipts?.[0] as never);
  assert.deepEqual(asReceipt.candidates, [1, 2]);
  assert.equal(asReceipt.status, "to-check");
});

test("a saved photo is removed only when the server itself says it can never be read", () => {
  // The server's own JSON refusal of the photo: removed.
  for (const status of [400, 413, 415, 422])
    assert.equal(photoRefusedForGood({ status, fromServer: true }), true);
  // Signed out, forbidden, missing (a deploy can answer a plain "404 Not Found"), busy: kept.
  for (const status of [401, 403, 404, 408, 429, 500, 502, 503])
    assert.equal(photoRefusedForGood({ status, fromServer: true }), false);
  // A refusal with no JSON error from our server (something in front of it): kept.
  assert.equal(photoRefusedForGood({ status: 422, fromServer: false }), false);
  assert.equal(photoRefusedForGood(new TypeError("Failed to fetch")), false);
  assert.equal(photoRefusedForGood(undefined), false);
});
