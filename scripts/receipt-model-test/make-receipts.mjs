// Makes the synthetic receipt pictures for the model test, and their answer key.
//
//   node scripts/receipt-model-test/make-receipts.mjs [outputFolder]
//
// The pictures are drawn from HTML with Playwright's Chromium (so they are rendered, not
// photographed: real photos with glare, folds and shadows will be harder). They go to
// `outputFolder` (default: the session scratchpad), never into the repo. The answer key is written
// to truth.json next to this script and copied beside the pictures.
// Every amount is added up in code, so the printed numbers always agree with the answer key.

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(
  process.argv[2] ??
    "/tmp/claude-0/-home-user-openmuse/99c9fbc5-c14a-503e-91d8-8d4051cfae67/scratchpad/receipt-model-test/images",
);

// ---------- small helpers ----------

const fmt = (c, comma = false) => {
  const s = (c / 100).toFixed(2);
  return comma ? s.replace(".", ",") : s;
};
/** items: [name, cents, taxable?]; returns subtotal, tax and total in cents. */
function sums(items, rate, fixedTax) {
  const sub = items.reduce((n, [, c]) => n + c, 0);
  const taxable = items.reduce((n, [, c, t]) => n + (t ? c : 0), 0);
  const tax = fixedTax ?? Math.round(taxable * rate);
  return { sub, tax, total: sub + tax };
}
const R = (l, r, cls = "") => `<div class="row ${cls}"><span>${l}</span><span>${r}</span></div>`;
const C = (t, cls = "") => `<div class="c ${cls}">${t}</div>`;
const HR = (kind = "dash") => `<div class="hr ${kind}"></div>`;
const rows = (items, comma) => items.map(([n, c]) => R(n, fmt(c, comma))).join("");

const WOOD =
  "repeating-linear-gradient(92deg,#8a5a37 0 13px,#7c4f30 13px 16px,#94633d 16px 31px,#80532f 31px 34px)";
const GRAY = "#6a6e73";
const LIGHT = "#d9d9dc";

function page({ bg, body, width, css = "", pad = 40 }) {
  return {
    width: width + pad * 2,
    html: `<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box} html,body{margin:0}
      body{background:${bg};padding:${pad}px;}
      .paper{background:var(--paper,#fbfbf8);color:var(--ink,#1b1b1b);width:${width}px;margin:0 auto;
        padding:22px 18px 26px;line-height:1.35;box-shadow:0 3px 14px rgba(0,0,0,.35);position:relative}
      .row{display:flex;justify-content:space-between;gap:12px}
      .row span:first-child{flex:1}
      .row span:last-child{white-space:nowrap;text-align:right}
      .c{text-align:center}
      .hr{margin:8px 0;height:0}
      .hr.dash{border-top:1px dashed currentColor}
      .hr.solid{border-top:2px solid currentColor}
      .hr.stars{border-top:0;text-align:center;letter-spacing:2px;height:auto}
      .hr.stars::before{content:"* * * * * * * * * * * * * * * * *";font-size:.8em;white-space:nowrap;overflow:hidden;display:block}
      .big{font-size:1.45em;font-weight:700}
      .b{font-weight:700}
      .sm{font-size:.82em}
      .gap{height:10px}
      ${css}
    </style><body>${body}</body>`,
  };
}

// ---------- the receipts ----------

const receipts = [];
const add = (def) => receipts.push(def);

// 01 clean grocery
{
  const items = [
    ["BANANAS 1.62 LB", 186],
    ["WHOLE MILK 1 GAL", 429],
    ["SOURDOUGH LOAF", 549],
    ["EGGS FREE RANGE 12", 599],
    ["BABY SPINACH 5OZ", 449],
    ["CHICKEN THIGHS", 982],
    ["PENNE PASTA", 179],
    ["TOMATO SAUCE", 249],
    ["CHEDDAR BLOCK", 629],
    ["GREEK YOGURT", 519],
    ["PAPER TOWELS 6PK", 899, true],
    ["DISH SOAP", 399, true],
  ];
  const s = sums(items, 0.0825);
  add({
    ...page({
      bg: LIGHT,
      width: 380,
      css: ".paper{font:15px 'Liberation Mono',monospace}",
      body: `<div class="paper">
        ${C("GREENFIELD MARKET", "big")}
        ${C("2210 Oak Avenue, Springfield")}
        ${C("Store #0412  Tel 555-0131")}
        ${HR()}
        ${R("11/03/2026", "6:42 PM")}
        ${R("Cashier: Dana", "Lane 4")}
        ${HR()}
        ${rows(items)}
        ${HR()}
        ${R("SUBTOTAL", fmt(s.sub))}
        ${R("TAX 8.25% on 12.98", fmt(s.tax))}
        ${R("TOTAL", fmt(s.total), "b big")}
        ${HR()}
        ${R("VISA **** 4417", fmt(s.total))}
        ${C("Approved  AUTH 884213")}
        ${HR()}
        ${C("12 items sold")}
        ${C("Thank you for shopping with us!")}
      </div>`,
    }),
    truth: {
      file: "01-grocery-clean.png",
      merchant: "Greenfield Market",
      date: "2026-11-03",
      total: s.total / 100,
      tax: s.tax / 100,
      paymentLast4: "4417",
      returnDays: null,
      category: "Groceries",
      isReceipt: true,
      multipleReceipts: false,
      note: "clean monospace grocery receipt on gray",
    },
  });
}

// 02 clean retail, 30-day return policy, Visa ending line
{
  const items = [
    ["Ceramic planter 12in", 3499, true],
    ["Potting mix 20qt", 1299, true],
    ["Garden gloves", 899, true],
    ["LED string lights", 2499, true],
    ["Basil starter plant", 449, true],
  ];
  const s = sums(items, 0.0825);
  add({
    ...page({
      bg: WOOD,
      width: 420,
      css: ".paper{font:15px 'Inter',sans-serif} .paper .row span:last-child{font-variant-numeric:tabular-nums}",
      body: `<div class="paper">
        ${C("Pinecrest Home &amp; Garden", "big")}
        ${C("418 Cedar Lane &middot; Portland, OR 97214")}
        ${HR()}
        ${R("Date: 10/18/2026", "Time: 14:05")}
        ${R("Register 2", "Trans# 77120")}
        ${HR("solid")}
        ${rows(items)}
        ${HR("solid")}
        ${R("Subtotal", fmt(s.sub))}
        ${R("Sales tax (8.25%)", fmt(s.tax))}
        ${R("Total", fmt(s.total), "b big")}
        ${HR()}
        ${R("Visa ending in 8821", fmt(s.total))}
        ${C("Chip read - Approved", "sm")}
        ${HR()}
        ${C("RETURN POLICY", "b")}
        ${C("Items may be returned or exchanged within 30 days of purchase with this receipt.", "sm")}
        <div class="gap"></div>
        ${C("Thank you for shopping Pinecrest!")}
      </div>`,
    }),
    truth: {
      file: "02-retail-return-policy.png",
      merchant: "Pinecrest Home & Garden",
      date: "2026-10-18",
      total: s.total / 100,
      tax: s.tax / 100,
      paymentLast4: "8821",
      returnDays: 30,
      category: "Home",
      isReceipt: true,
      multipleReceipts: false,
      note: "sans-serif retail on wood; 30-day return policy",
    },
  });
}

// 03 restaurant, printed tip line, handwritten-style tip
{
  const items = [
    ["2 Bruschetta", 1400, true],
    ["Margherita pizza", 1850, true],
    ["Linguine alle vongole", 2400, true],
    ["Tiramisu", 900, true],
    ["2 Iced tea", 700, false],
  ];
  const s = sums(items, 0.0875);
  const handTip = 1200;
  add({
    ...page({
      bg: LIGHT,
      width: 400,
      css: `.paper{font:16px 'Bitstream Charter','DejaVu Serif',serif}
        .hand{font-family:'Bitstream Charter',serif;font-style:italic;font-weight:700;color:#1d3a9e;
          display:inline-block;transform:rotate(-5deg);font-size:1.25em;padding-left:6px}
        .line{border-bottom:1px solid #222;display:inline-block;min-width:110px;text-align:center}`,
      body: `<div class="paper">
        ${C("Luigi's Trattoria", "big")}
        ${C("Authentic Italian since 1987")}
        ${C("77 Harbor St, Baytown")}
        ${HR()}
        ${R("Table 12", "Server: Marco")}
        ${R("11/07/2026", "8:19 PM")}
        ${R("Guests: 2", "Check #5531")}
        ${HR()}
        ${rows(items)}
        ${HR()}
        ${R("Subtotal", fmt(s.sub))}
        ${R("Tax", fmt(s.tax))}
        ${R("TOTAL", fmt(s.total), "b big")}
        ${HR()}
        ${C("MASTERCARD ending 0093", "sm")}
        <div class="gap"></div>
        <div style="display:flex;justify-content:space-between;align-items:flex-end">
          <span>Tip</span><span class="line"><span class="hand">${fmt(handTip)}</span></span></div>
        <div class="gap"></div>
        <div style="display:flex;justify-content:space-between;align-items:flex-end">
          <span>Total</span><span class="line"><span class="hand">${fmt(s.total + handTip)}</span></span></div>
        <div class="gap"></div>
        <div style="display:flex;justify-content:space-between;align-items:flex-end">
          <span>Signature</span><span class="line" style="min-width:190px"><span class="hand" style="font-weight:400">M. Reyes</span></span></div>
        ${HR()}
        ${C("Grazie! Thank you for dining with us", "sm")}
      </div>`,
    }),
    truth: {
      file: "03-restaurant-handwritten-tip.png",
      merchant: "Luigi's Trattoria",
      date: "2026-11-07",
      total: s.total / 100,
      tax: s.tax / 100,
      paymentLast4: "0093",
      returnDays: null,
      category: "Dining",
      isReceipt: true,
      multipleReceipts: false,
      note: `printed total is the truth (prompt rule); handwritten tip ${fmt(handTip)} and handwritten total ${fmt(s.total + handTip)} must go in notes, not the total`,
      handwrittenTotal: (s.total + handTip) / 100,
    },
  });
}

// 04 faded, low-contrast thermal print, cash
{
  const items = [
    ["Almond croissant", 425],
    ["Sourdough boule", 750],
    ["Cappuccino 12oz", 495],
    ["Cinnamon roll x2", 700],
  ];
  const s = sums(items, 0, 0);
  const cashIn = 2500;
  add({
    ...page({
      bg: "#c9c3b6",
      width: 360,
      css: `.paper{--paper:#f3efe6;--ink:#b4b1ab;font:14px 'DejaVu Sans Mono',monospace;box-shadow:0 2px 8px rgba(0,0,0,.25)}
        .paper::after{content:"";position:absolute;inset:0;pointer-events:none;
          background:
            repeating-linear-gradient(90deg,rgba(243,239,230,.75) 0 3px,transparent 3px 41px),
            linear-gradient(180deg,rgba(243,239,230,0) 0%,rgba(243,239,230,.35) 55%,rgba(243,239,230,.6) 100%)}`,
      body: `<div class="paper">
        ${C("SWEET RISE BAKERY", "b")}
        ${C("14 Mill Road")}
        ${C("Open daily 6am - 3pm")}
        ${HR()}
        ${R("10/29/2026", "7:48 AM")}
        ${R("Order #118", "Counter")}
        ${HR()}
        ${rows(items)}
        ${HR()}
        ${R("TOTAL", fmt(s.total), "b")}
        ${R("CASH TENDERED", fmt(cashIn))}
        ${R("CHANGE", fmt(cashIn - s.total))}
        ${HR()}
        ${C("Thanks! See you tomorrow")}
      </div>`,
    }),
    truth: {
      file: "04-faded-thermal.png",
      merchant: "Sweet Rise Bakery",
      date: "2026-10-29",
      total: s.total / 100,
      tax: null,
      paymentLast4: null,
      returnDays: null,
      category: "Dining",
      categoryAlso: ["Groceries"],
      isReceipt: true,
      multipleReceipts: false,
      note: "faded low-contrast thermal print, cash, no tax line (tax null)",
    },
  });
}

// 05 rotated and skewed on a dark desk
{
  const items = [
    ["Claw hammer 16oz", 1899, true],
    ["Wood screws 1lb", 749, true],
    ["Painter's tape", 599, true],
    ["Work gloves L", 1299, true],
    ["Duct tape", 699, true],
  ];
  const s = sums(items, 0.0725);
  add({
    ...page({
      bg: "#2f3235",
      width: 380,
      pad: 120,
      css: `.paper{font:15px 'JetBrains Mono',monospace;transform:rotate(4deg) skew(-2deg,0.5deg);margin-top:10px}`,
      body: `<div class="paper">
        ${C("MAPLE STREET HARDWARE", "b big")}
        ${C("Family owned since 1962")}
        ${C("905 Maple St  &bull;  555-0178")}
        ${HR()}
        ${R("09/14/2026", "10:31 AM")}
        ${R("Clerk: Bob", "Sale #20418")}
        ${HR()}
        ${rows(items)}
        ${HR()}
        ${R("SUBTOTAL", fmt(s.sub))}
        ${R("TAX 7.25%", fmt(s.tax))}
        ${R("TOTAL", fmt(s.total), "b big")}
        ${HR()}
        ${R("VISA ending 3306", fmt(s.total))}
        ${C("THANK YOU")}
      </div>`,
    }),
    truth: {
      file: "05-rotated-skewed.png",
      merchant: "Maple Street Hardware",
      date: "2026-09-14",
      total: s.total / 100,
      tax: s.tax / 100,
      paymentLast4: "3306",
      returnDays: null,
      category: "Home",
      isReceipt: true,
      multipleReceipts: false,
      note: "rotated 4 degrees and skewed, on a dark desk",
    },
  });
}

// 06 blurred
{
  const items = [
    ["Avocados 4ct", 599],
    ["Salmon fillet", 1449],
    ["Brown rice 2lb", 389],
    ["Oat milk", 449],
    ["Blueberries", 499],
    ["Hummus", 379],
    ["Pita bread", 299],
    ["Olive oil 500ml", 1099],
  ];
  const s = sums(items, 0, 0);
  add({
    ...page({
      bg: GRAY,
      width: 390,
      css: `.paper{font:15px 'Liberation Sans',sans-serif;filter:blur(2.2px)} .paper .row span:last-child{font-variant-numeric:tabular-nums}`,
      body: `<div class="paper">
        ${C("FRESH BASKET GROCERS", "b big")}
        ${C("330 Willow Way")}
        ${HR()}
        ${R("Date 11/09/2026", "5:12 PM")}
        ${HR()}
        ${rows(items)}
        ${HR()}
        ${R("Subtotal", fmt(s.sub))}
        ${R("Tax", fmt(s.tax))}
        ${R("TOTAL", fmt(s.total), "b big")}
        ${HR()}
        ${R("DEBIT ending 7742", fmt(s.total))}
        ${C("Have a fresh day!")}
      </div>`,
    }),
    truth: {
      file: "06-blurred.png",
      merchant: "Fresh Basket Grocers",
      date: "2026-11-09",
      total: s.total / 100,
      tax: 0,
      paymentLast4: "7742",
      returnDays: null,
      category: "Groceries",
      isReceipt: true,
      multipleReceipts: false,
      note: "Gaussian blur 2.2px over the whole receipt; tax printed as 0.00",
    },
  });
}

// 07 smudged digit in the total (recoverable from subtotal + tax)
{
  const items = [
    ["Dog food 25lb", 3299, false],
    ["Chew toy", 649, true],
    ["Cat litter 14lb", 1199, true],
    ["Treats", 499, true],
  ];
  const s = sums(items, 0.0825);
  add({
    ...page({
      bg: WOOD,
      width: 390,
      css: `.paper{font:16px 'FreeMono','Liberation Mono',monospace}
        .amt{position:relative;display:inline-block}
        .smudge{position:absolute;left:-.12em;top:-.3em;width:.95em;height:1.7em;border-radius:50%;
          background:radial-gradient(ellipse at 48% 50%,rgba(38,25,14,.98) 0 52%,rgba(70,48,28,.65) 68%,rgba(90,60,30,0) 78%)}`,
      body: `<div class="paper">
        ${C("BLUEBIRD PET SUPPLY", "b big")}
        ${C("1 Orchard Plaza")}
        ${HR()}
        ${R("10/22/2026", "11:20")}
        ${HR()}
        ${rows(items)}
        ${HR()}
        ${R("SUBTOTAL", fmt(s.sub))}
        ${R("TAX 8.25%", fmt(s.tax))}
        ${R("TOTAL", `<span class="amt">${fmt(s.total)}<i class="smudge"></i></span>`, "b big")}
        ${HR()}
        ${C("VISA ending 5512")}
        ${C("Good boys get treats")}
      </div>`,
    }),
    truth: {
      file: "07-smudged-total.png",
      merchant: "Bluebird Pet Supply",
      date: "2026-10-22",
      total: s.total / 100,
      tax: s.tax / 100,
      paymentLast4: "5512",
      returnDays: null,
      category: "Pets",
      isReceipt: true,
      multipleReceipts: false,
      smudgedTotal: true,
      note: `first digit of the printed total (${fmt(s.total)}) is covered by a dark smudge; subtotal ${fmt(s.sub)} + tax ${fmt(s.tax)} give it`,
    },
  });
}

// 08 long, narrow receipt with many items
{
  const names = [
    "ORG BANANAS",
    "GALA APPLES",
    "RED ONIONS 3LB",
    "RUSSET POTATO 5LB",
    "GARLIC 3CT",
    "CARROTS 2LB",
    "CELERY",
    "ROMAINE HEARTS",
    "CHERRY TOMATO",
    "LEMONS 2LB",
    "UNSALTED BUTTER",
    "HEAVY CREAM",
    "SHREDDED MOZZ",
    "PARMESAN WEDGE",
    "BLACK BEANS",
    "CHICKPEAS",
    "DICED TOMATOES",
    "CHICKEN BROTH",
    "BASMATI RICE 5LB",
    "ROLLED OATS",
    "PEANUT BUTTER",
    "STRAWBERRY JAM",
    "WHOLE WHEAT BREAD",
    "TORTILLAS 10CT",
    "GROUND BEEF 1LB",
    "BACON",
    "CHICKEN BREAST",
    "FROZEN PEAS",
    "VANILLA ICE CREAM",
    "ORANGE JUICE",
    "SPARKLING WATER 8PK",
    "COFFEE BEANS 12OZ",
    "TEA BAGS 40CT",
    "GRANOLA BARS",
    "TORTILLA CHIPS",
    "SALSA",
    "TRASH BAGS",
    "SPONGES 3PK",
    "LAUNDRY PODS",
    "TOOTHPASTE",
  ];
  const prices = [
    129, 449, 399, 599, 149, 279, 199, 349, 399, 549, 499, 399, 449, 799, 99, 109, 129, 249, 1099,
    449, 549, 399, 429, 349, 699, 899, 1199, 249, 549, 479, 399, 1199, 429, 549, 399, 349, 799, 499,
    1899, 499,
  ];
  const items = names.map((n, i) => [n, prices[i], i >= 36]);
  const s = sums(items, 0.0625);
  add({
    ...page({
      bg: LIGHT,
      width: 290,
      pad: 30,
      css: ".paper{font:13px 'Liberation Mono',monospace;padding:16px 12px 22px}",
      body: `<div class="paper">
        ${C("VALLEY FOODS CO-OP", "b big")}
        ${C("55 Station Rd")}
        ${HR()}
        ${R("11/01/2026", "9:03 AM")}
        ${HR()}
        ${rows(items)}
        ${HR()}
        ${R("40 ITEMS", "")}
        ${R("SUBTOTAL", fmt(s.sub))}
        ${R("TAX 6.25%", fmt(s.tax))}
        ${R("TOTAL", fmt(s.total), "b big")}
        ${HR()}
        ${R("VISA **** 2290", fmt(s.total))}
        ${C("MEMBER SAVINGS 6.40")}
        ${C("THANK YOU")}
      </div>`,
    }),
    truth: {
      file: "08-long-narrow.png",
      merchant: "Valley Foods Co-op",
      date: "2026-11-01",
      total: s.total / 100,
      tax: s.tax / 100,
      paymentLast4: "2290",
      returnDays: null,
      category: "Groceries",
      isReceipt: true,
      multipleReceipts: false,
      note: "40 item lines, 290px wide and very tall",
    },
  });
}

// 09 cropped: top cut off, store name only as a logo-ish line at the bottom
{
  const items = [
    ["Wooden stacking blocks", 2499, true],
    ["Board book: Moon", 899, true],
    ["Toddler sippy cup", 1199, true],
    ["Crayons 24ct", 549, true],
  ];
  const s = sums(items, 0.0625);
  add({
    ...page({
      bg: GRAY,
      width: 370,
      css: `.paper{font:14px 'DejaVu Sans Mono',monospace;margin-top:-11px;padding-top:0}
        .crop{overflow:hidden;width:370px;margin:0 auto;background:#fbfbf8}
        .logo{border:2px solid #222;border-radius:14px;padding:6px 10px;margin:8px 22px;text-align:center;
          font:italic 700 20px 'Bitstream Charter',serif;letter-spacing:1px}
        .logo small{display:block;font:600 10px 'DejaVu Sans',sans-serif;letter-spacing:3px}`,
      body: `<div class="crop"><div class="paper">
        ${C("ore Rd, Austin TX 78704")}
        ${C("Tel 512-555-0147")}
        ${HR()}
        ${R("10/11/2026", "3:26 PM")}
        ${R("Cashier 07", "Lane 2")}
        ${HR()}
        ${rows(items.map(([n, c]) => [n, c]))}
        ${HR()}
        ${R("SUBTOTAL", fmt(s.sub))}
        ${R("TAX", fmt(s.tax))}
        ${R("TOTAL", fmt(s.total), "b big")}
        ${HR()}
        ${R("MASTERCARD ****6150", fmt(s.total))}
        ${HR()}
        <div class="logo">&#9733; little sprouts<small>KIDS &bull; BABY &bull; TOYS</small></div>
        ${C("Thanks for visiting!", "sm")}
      </div></div>`,
    }),
    truth: {
      file: "09-cropped-top.png",
      merchant: "Little Sprouts",
      date: "2026-10-11",
      total: s.total / 100,
      tax: s.tax / 100,
      paymentLast4: "6150",
      returnDays: null,
      category: "Kids",
      isReceipt: true,
      multipleReceipts: false,
      note: "top of the receipt is cut off; the store name appears only in a logo-style box near the bottom",
    },
  });
}

// 10 foreign format: dd/mm/yyyy ambiguous date, decimal comma, EUR
{
  const items = [
    ["Baguette tradition", 135],
    ["Camembert AOP", 489],
    ["Pommes Gala 1kg", 329],
    ["Jambon blanc 4tr", 459],
    ["Eau minerale 6x1,5L", 279],
    ["Chocolat noir 70%", 189],
  ];
  const sub = items.reduce((n, [, c]) => n + c, 0);
  const tax = 142; // included TVA, shown as a figure on the receipt
  add({
    ...page({
      bg: LIGHT,
      width: 370,
      css: ".paper{font:15px 'Liberation Mono',monospace}",
      body: `<div class="paper">
        ${C("EPICERIE LENOIR", "b big")}
        ${C("12 rue des Lilas, 69003 Lyon")}
        ${C("SIRET 552 081 317 00027", "sm")}
        ${HR()}
        ${R("04/11/2026", "18:07")}
        ${R("Caisse 02", "Ticket 3318")}
        ${HR()}
        ${rows(items, true)}
        ${HR()}
        ${R("TOTAL TTC", `EUR ${fmt(sub, true)}`, "b big")}
        ${R("dont TVA", fmt(tax, true))}
        ${HR()}
        ${R("CB VISA ************0481", fmt(sub, true))}
        ${C("TRANSACTION ACCEPTEE", "sm")}
        ${C("Merci de votre visite")}
      </div>`,
    }),
    truth: {
      file: "10-foreign-eur.png",
      merchant: "Epicerie Lenoir",
      date: "2026-11-04",
      total: sub / 100,
      tax: tax / 100,
      currency: "EUR",
      paymentLast4: "0481",
      returnDays: null,
      category: "Groceries",
      isReceipt: true,
      multipleReceipts: false,
      note: "French receipt, 04/11/2026 means 4 November (a US reading gives April 11), decimal commas, EUR",
    },
  });
}

// 11 electronics with a 2-year protection plan
{
  const items = [
    ["NC Headphones X200", 19999, true],
    ["USB-C cable 2m", 1499, true],
    ["2-YEAR PROTECTION PLAN", 2999, false],
  ];
  const s = sums(items, 0.0925);
  add({
    ...page({
      bg: GRAY,
      width: 410,
      css: ".paper{font:14px 'Inter',sans-serif}",
      body: `<div class="paper">
        ${C("VOLTLINE ELECTRONICS", "b big")}
        ${C("Westgate Mall, Unit 31")}
        ${HR()}
        ${R("08/27/2026", "16:44")}
        ${R("Assoc: 2210", "Reg 5")}
        ${HR()}
        ${rows(items)}
        ${HR()}
        ${R("Subtotal", fmt(s.sub))}
        ${R("Tax 9.25%", fmt(s.tax))}
        ${R("Total", fmt(s.total), "b big")}
        ${HR()}
        ${R("AMEX ending 1007", fmt(s.total))}
        ${HR()}
        ${C("Your 2-year protection plan covers parts, labor and accidental damage on headphones X200. Keep this receipt as proof of coverage.", "sm")}
        <div class="gap"></div>
        ${C("Return policy at voltline.example/returns", "sm")}
      </div>`,
    }),
    truth: {
      file: "11-electronics-warranty.png",
      merchant: "Voltline Electronics",
      date: "2026-08-27",
      total: s.total / 100,
      tax: s.tax / 100,
      paymentLast4: "1007",
      returnDays: null,
      category: "Other",
      categoryAlso: ["Home"],
      isReceipt: true,
      multipleReceipts: false,
      warrantyMentioned: true,
      note: "2-year protection plan; no return window in days is printed",
    },
  });
}

// 12 gas station, tiny text
{
  const gallons = 11.842;
  const price = 3.699;
  const total = Math.round(gallons * price * 100);
  add({
    ...page({
      bg: "#55595e",
      width: 330,
      pad: 30,
      css: ".paper{font:10px 'DejaVu Sans Mono',monospace;padding:14px 12px 18px;line-height:1.3}",
      body: `<div class="paper">
        ${C("RIDGEWAY FUEL STOP #88", "b")}
        ${C("Hwy 9 &amp; County Rd 4")}
        ${HR()}
        ${R("11/08/2026", "07:12:44")}
        ${R("PUMP 05", "REGULAR UNLEADED")}
        ${R("GALLONS", gallons.toFixed(3))}
        ${R("PRICE/GAL", `$${price.toFixed(3)}`)}
        ${R("FUEL SALE", `$${fmt(total)}`)}
        ${HR()}
        ${R("TOTAL", `$${fmt(total)}`, "b")}
        ${R("VISA ****6609", `$${fmt(total)}`)}
        ${C("AUTH 337715  SEQ 0042  APPROVED")}
        ${HR()}
        ${C("TAXES INCLUDED IN PRICE")}
        ${C("Receipt required for fuel rewards")}
      </div>`,
    }),
    truth: {
      file: "12-gas-station-tiny.png",
      merchant: "Ridgeway Fuel Stop",
      date: "2026-11-08",
      total: total / 100,
      tax: null,
      paymentLast4: "6609",
      returnDays: null,
      category: "Other",
      categoryAlso: ["Travel"],
      isReceipt: true,
      multipleReceipts: false,
      note: "10px text on a 330px wide image; fuel taxes included, no tax figure",
    },
  });
}

// 13 two receipts side by side
{
  const a = [
    ["Coffee 16oz", 375],
    ["Blueberry muffin", 325],
  ];
  const b = [
    ["Pain reliever 100ct", 899, true],
    ["Hand cream", 549, true],
  ];
  const sa = sums(a, 0, 0);
  const sb = sums(b, 0.07);
  add({
    ...page({
      bg: WOOD,
      width: 840,
      pad: 30,
      css: `.pair{display:flex;gap:40px;align-items:flex-start;justify-content:center}
        .paper{width:340px;margin:0}
        .p1{font:15px 'Liberation Mono',monospace;transform:rotate(-2deg)}
        .p2{font:14px 'Liberation Sans',sans-serif;transform:rotate(1.5deg);margin-top:34px}`,
      body: `<div class="pair">
        <div class="paper p1">
          ${C("CORNER CUP CAFE", "b big")}
          ${HR()}
          ${R("11/05/2026", "8:01 AM")}
          ${rows(a)}
          ${HR()}
          ${R("TOTAL", fmt(sa.total), "b")}
          ${R("CASH", fmt(1000))}
        </div>
        <div class="paper p2">
          ${C("Brightside Pharmacy", "b big")}
          ${HR()}
          ${R("11/05/2026", "8:40 AM")}
          ${rows(b)}
          ${HR()}
          ${R("Subtotal", fmt(sb.sub))}
          ${R("Tax", fmt(sb.tax))}
          ${R("Total", fmt(sb.total), "b")}
          ${R("Visa ending 3012", fmt(sb.total))}
        </div>
      </div>`,
    }),
    truth: {
      file: "13-two-receipts.png",
      merchant: null,
      date: null,
      total: null,
      tax: null,
      paymentLast4: null,
      returnDays: null,
      category: null,
      isReceipt: true,
      multipleReceipts: true,
      skip: ["merchant", "date", "total", "tax", "paymentLast4", "returnDays", "category"],
      note: "two different receipts (a cafe and a pharmacy) in one picture; only isReceipt and multipleReceipts are scored",
    },
  });
}

// 14 not a receipt: a restaurant menu page
add({
  ...page({
    bg: WOOD,
    width: 420,
    css: `.paper{--paper:#f6efe0;--ink:#3a2a1a;font:17px 'Bitstream Charter','DejaVu Serif',serif;padding:30px 28px;
        transform:rotate(-1.5deg)}
      .paper h1{font-size:30px;text-align:center;margin:0 0 4px;letter-spacing:2px}
      .paper h2{font-size:15px;text-align:center;letter-spacing:4px;margin:14px 0 6px;border-bottom:1px solid;padding-bottom:4px}
      .dish{display:flex;justify-content:space-between;margin:5px 0}
      .dish small{display:block;font-size:12px;opacity:.75}`,
    body: `<div class="paper">
      <h1>The Copper Kettle</h1>
      ${C("DINNER MENU", "sm")}
      <h2>STARTERS</h2>
      <div class="dish"><span>Roasted tomato soup<small>basil oil, croutons</small></span><span>9</span></div>
      <div class="dish"><span>Burrata salad<small>peaches, arugula</small></span><span>14</span></div>
      <h2>MAINS</h2>
      <div class="dish"><span>Pan-seared trout<small>lemon caper butter</small></span><span>26</span></div>
      <div class="dish"><span>Mushroom risotto<small>parmesan, thyme</small></span><span>22</span></div>
      <div class="dish"><span>Braised short rib<small>polenta, gremolata</small></span><span>29</span></div>
      <h2>DESSERT</h2>
      <div class="dish"><span>Salted caramel tart</span><span>10</span></div>
      <div class="gap"></div>
      ${C("Please tell your server about any allergies", "sm")}
    </div>`,
  }),
  truth: {
    file: "14-not-a-receipt-menu.png",
    merchant: null,
    date: null,
    total: null,
    tax: null,
    paymentLast4: null,
    returnDays: null,
    category: null,
    isReceipt: false,
    multipleReceipts: false,
    skip: ["merchant", "date", "total", "tax", "paymentLast4", "returnDays", "category"],
    note: "a restaurant menu page with prices but no total: must say isReceipt false",
  },
});

// 15 pharmacy
{
  const items = [
    ["Rx 4402981 Atorvastatin 20mg 30", 1200, false],
    ["Ibuprofen 200mg 100ct", 799, true],
    ["Adhesive bandages 60ct", 449, true],
    ["Saline nasal spray", 599, true],
  ];
  const s = sums(items, 0.0775);
  add({
    ...page({
      bg: LIGHT,
      width: 400,
      css: ".paper{font:14px 'FreeSans','Liberation Sans',sans-serif}",
      body: `<div class="paper">
        ${C("CEDAR HEALTH PHARMACY", "b big")}
        ${C("Pharmacy: 555-0166 &middot; Store 0231")}
        ${HR()}
        ${R("11/05/2026", "12:15 PM")}
        ${R("Pharmacist: A. Shah", "Trans 90412")}
        ${HR()}
        ${rows(items)}
        ${HR()}
        ${R("Subtotal", fmt(s.sub))}
        ${R("Tax 7.75% (non-Rx items)", fmt(s.tax))}
        ${R("TOTAL", fmt(s.total), "b big")}
        ${HR()}
        ${R("VISA ending 9921", fmt(s.total))}
        ${HR()}
        ${C("Rx items cannot be returned. Unopened over-the-counter items may be returned within 28 days with receipt.", "sm")}
        ${C(`FSA/HSA eligible total: ${fmt(s.total)}`, "sm")}
      </div>`,
    }),
    truth: {
      file: "15-pharmacy.png",
      merchant: "Cedar Health Pharmacy",
      date: "2026-11-05",
      total: s.total / 100,
      tax: s.tax / 100,
      paymentLast4: "9921",
      returnDays: 28,
      category: "Health",
      isReceipt: true,
      multipleReceipts: false,
      note: "prescription plus over-the-counter items; 28-day return window for unopened OTC items",
    },
  });
}

// 16 card printed masked: XXXX XXXX XXXX 7391
{
  const items = [
    ["Single origin pour-over", 575],
    ["Oat flat white", 525],
    ["Bag: Ethiopia 12oz", 1850],
  ];
  const s = sums(items, 0, 0);
  add({
    ...page({
      bg: LIGHT,
      width: 380,
      css: ".paper{font:14px 'JetBrains Mono',monospace}",
      body: `<div class="paper">
        ${C("SUNRISE COFFEE ROASTERS", "b big")}
        ${C("88 Pier Ave")}
        ${HR("stars")}
        ${R("11/10/2026", "09:15")}
        ${R("Check 204", "Reg 1")}
        ${HR()}
        ${rows(items)}
        ${HR()}
        ${R("SUBTOTAL", fmt(s.sub))}
        ${R("TAX", fmt(s.tax))}
        ${R("TOTAL", fmt(s.total), "b big")}
        ${HR()}
        ${C("CREDIT CARD SALE")}
        ${R("CARD", "XXXX XXXX XXXX 7391")}
        ${R("TYPE", "MASTERCARD")}
        ${R("ENTRY", "CONTACTLESS")}
        ${C("APPROVED  AUTH 561804")}
        ${HR("stars")}
      </div>`,
    }),
    truth: {
      file: "16-card-masked-xxxx.png",
      merchant: "Sunrise Coffee Roasters",
      date: "2026-11-10",
      total: s.total / 100,
      tax: 0,
      paymentLast4: "7391",
      returnDays: null,
      category: "Dining",
      categoryAlso: ["Groceries"],
      isReceipt: true,
      multipleReceipts: false,
      note: "card printed as XXXX XXXX XXXX 7391; also sells a bag of beans",
    },
  });
}

// 17 whole card number visible
{
  const items = [
    ["Copy paper 10 ream", 4999, true],
    ["Ink cartridge 2pk", 3899, true],
    ["Desk organizer", 1799, true],
    ["Sticky notes 12pk", 1199, true],
  ];
  const s = sums(items, 0.0825);
  add({
    ...page({
      bg: GRAY,
      width: 400,
      css: ".paper{font:15px 'Liberation Sans',sans-serif}",
      body: `<div class="paper">
        ${C("METRO OFFICE SUPPLY", "b big")}
        ${C("300 Commerce Pkwy")}
        ${HR()}
        ${R("10/05/2026", "13:52")}
        ${R("Invoice 66120", "Reg 3")}
        ${HR()}
        ${rows(items)}
        ${HR()}
        ${R("Subtotal", fmt(s.sub))}
        ${R("Tax 8.25%", fmt(s.tax))}
        ${R("Total", fmt(s.total), "b big")}
        ${HR()}
        ${C("CUSTOMER COPY - CARD DATA", "sm")}
        ${R("VISA", "4929 4005 8310 9010")}
        ${R("Exp", "09/28")}
        ${R("Amount", fmt(s.total))}
        ${C("Chip: approved", "sm")}
      </div>`,
    }),
    truth: {
      file: "17-card-full-number.png",
      merchant: "Metro Office Supply",
      date: "2026-10-05",
      total: s.total / 100,
      tax: s.tax / 100,
      paymentLast4: "9010",
      returnDays: null,
      category: "Other",
      categoryAlso: ["Home"],
      isReceipt: true,
      multipleReceipts: false,
      fullCardPrinted: true,
      note: "the whole 16-digit card number (a made-up test number) is printed; the reader must output only 9010",
    },
  });
}

// ---------- render ----------

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 1 });
const shown = [];
for (const r of receipts) {
  const pg = await context.newPage();
  await pg.setViewportSize({ width: Math.max(r.width, 400), height: 100 });
  await pg.setContent(r.html, { waitUntil: "load" });
  await pg.evaluate(() => document.fonts.ready);
  const file = path.join(outDir, r.truth.file);
  await pg.screenshot({ path: file, fullPage: true });
  const size = await pg.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.scrollHeight,
  ]);
  shown.push(`${r.truth.file}  ${size[0]}x${size[1]}`);
  await pg.close();
}
await browser.close();

const truthPath = path.join(here, "truth.json");
writeFileSync(
  truthPath,
  `${JSON.stringify(
    receipts.map((r) => r.truth),
    null,
    2,
  )}\n`,
);
copyFileSync(truthPath, path.join(outDir, "truth.json"));
console.log(`${receipts.length} receipts written to ${outDir}`);
for (const line of shown) console.log(`  ${line}`);
console.log(`answer key: ${truthPath}`);
