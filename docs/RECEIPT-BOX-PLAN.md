# Receipt box (plan)

Status: written 2026-11-11; Phase 1 being built the same day. Owner's decisions (2026-11-11): personal records (not
a business-expenses product yet); the name is **Receipt box**; it lives as a Receipt box space plus a card on Home;
check every receipt at first and offer auto-filing after about ten good ones in a row; keep-for tags (Return window,
Warranty, Tax time, Insurance); return-by reminders; only the last four card digits are ever kept; test a cheaper
reading model against a more accurate one before choosing (results: `docs/receipt_model_test_20261111.txt`).
The mockup the owner approved after two review rounds is in the session's design canvas (ten boards: Home, Snap,
Reading, Check it, Filed, The box, One receipt, Desktop, When it isn't simple, Offers and confirmations).

## What the person gets

Take a photo of a receipt (or say "file this receipt" with a photo). Neddy reads it in a few seconds and shows a
**Check it** card: store, date, total, category, with the one thing it wasn't sure of marked. One tap files it.
Later: "where's my Best Buy receipt", "what did I spend at Costco in October", "what's waiting to check".
Receipts with a return window or warranty get a **return-by** reminder. Only personal records: no export to
accounting, no per-line splitting.

## How it works (small pieces, each already a pattern in the app)

1. **The photo** is saved to Files (`Files.import`, up to 10 MB, signed links that expire in 15 minutes, so the app
   fetches a fresh link when a photo is opened).
2. **The reading** is one vision call (`apps/server/src/receipt-reader.ts`). The model only copies what is printed
   (no arithmetic, nulls when unreadable, lists fields it was unsure of). The code does the thinking:
   - `parseReceiptRead` accepts the JSON tolerantly (code fences, "$87.43", decimal commas), drops anything the
     shape doesn't allow, keeps only four card digits, and runs every free-text field through the shared redaction.
   - `reconcile` settles a smudged total from the receipt's own sums (subtotal + tax + tip, or the lines added up,
     within two cents) before anyone is asked; a single clear total the sums contradict becomes a question; no
     total at all is "missing".
   - A date in the future or over six years old is treated as unclear.
   - Not a receipt, or more than one receipt in the photo: never filed; the person is told kindly and nothing merged.
3. **The record** lives in the store as kind `receipt-box` (not "receipts": that word already means the "What I used"
   privacy receipts). Statuses: `to-check` and `filed`. Fields: merchant, date, total, candidates, tax, currency,
   category, paidLast4, keepFor[], returnBy / returnDays, warranty, note, unsure[], fileId, source (`photo`,
   `chat`, `call`), autoFiled, createdAt, filedAt. A duplicate (same merchant, date and total) is offered as "Skip
   this one / Keep both", never dropped silently.
4. **Return-by reminders** use the existing `ReminderService`; marking "I returned it" or "I'm keeping it" clears it.
   Without notifications, Home shows return dates that are close, and the Receipt box says so once.
5. **Auto-filing** is off by default; after ten receipts checked in a row without a change Neddy offers it. When on,
   receipts the reader was sure about (no unsure fields, sums agree) are filed straight away and marked
   "Filed by Neddy", with Undo for a minute and review any time; anything unsure always stops at Check it. A toggle,
   like every feature (owner rule): ⋯ menu or "stop auto-filing".

## API (all `owner`-scoped, behind the normal sign-in)

| Route | What it does |
|---|---|
| `POST /api/receipt-box/snap` (multipart `photo`, optional `timeZone`) | Saves the photo, reads it, returns `{receipt, outcome}` where outcome is `to-check`, `filed` (auto), `not-a-receipt`, `several`, `unreadable`, `duplicate` (with `of`), or `limit`. |
| `GET /api/receipt-box` | `{receipts[], toCheck, filedThisMonth, filedCount, monthTotal, closingSoon[], autoFile: {on, offered}}`. |
| `GET /api/receipt-box/:id` | One receipt plus a fresh photo link. |
| `POST /api/receipt-box/:id` | Fix fields (merchant, date, total, category, keepFor, returnBy, note). |
| `POST /api/receipt-box/:id/file` / `/unfile` | File it; take it back to To check (within a minute for auto-filed ones, any time for the person's own). |
| `POST /api/receipt-box/:id/return` | `{state: "returned" \| "keeping" \| "snooze"}`. |
| `POST /api/receipt-box/:id/delete` | Needs `{confirm: true}`; removes the photo, details and reminders. |
| `POST /api/receipt-box/auto-file` | `{on: boolean}` (the offer's answer, and the ⋯ toggle). |

## Agent tools (voice first: everything a tap does can be said)

`file_receipt` (read the photo in this message), `find_receipts` (merchant, month, category, keep-for, text),
`receipts_to_check`, `fix_receipt` ("it's $61.21", "make it Dining"), `file_it` / `check_it_later`,
`set_return_reminder` ("remind me to return this by the tenth"), `undo_filing`. A tool says a card is "shown" only
when one is drawn (the four-step call-card rule), and tool text stays neutral because background jobs share it.

## Which model reads (tested 2026-11-11, `docs/receipt_model_test_20261111.txt`)

On 17 synthetic (rendered, not photographed) receipts: claude-sonnet-5 got every key field right on 14 of 15
single receipts at about 0.75¢ a read; claude-haiku-5.5 about 0.04¢ (19 times cheaper, fastest) but was less
reliable (it read a French 04/11 as April 11 and was cut off once); claude-haiku-4.5 was the worst value (7 times
the price of haiku-5.5, one confident wrong total). No model leaked a card number. **Default: claude-sonnet-5**
(the server's vision default; `RECEIPT_MODEL` overrides). Idea to try later: read with haiku-5.5 and re-read with
Sonnet only when the first read is unsure (about 0.27¢ average). Findings fixed in the reader: the answer limit
(newer models spend hidden reasoning tokens, so receipts get 4,000), tax-included totals no longer raise a false
"which total is right", the tip/total wording, and day/month order now follows the receipt's own clues first.
sonnet-5.5 and Gemini flash-lite are untested (the OpenRouter key's $10 limit ran out). Real photos will be harder:
re-run `scripts/receipt-model-test` on 20-30 real receipts before choosing for good.

## Cost and limits

Each read is one vision call, about 0.4–0.8¢ (see the model test for the measured figure on the chosen model).
Owner's plan: count reads against plan allowances like pictures, with no separate charge (suggested Free about 20 a
month, paid about 300). **Open decision:** what happens at the limit. Phase 1 ships with no plan counter, only a
server-side abuse cap (a small number per hour and per day per person), and the limit text, once there is one,
starts "You’ve used this month’s" so the call screen's limit logic recognizes it. Adding the counter later touches
plans.ts, the site, Help and `docs/pricing_math.md`.

## Privacy

Card, bank and ID numbers are redacted by shape before any model sees text we pass on; the reader's prompt says to
output only the last four digits; the saved record has only four. The receipt photo itself still shows whatever
was printed on it (stated in Help: "the photo is kept as you took it"). Delete removes the photo, the record and
the reminders. Reading happens on the server's model, not a third party chosen by the photo's content (text in the
photo is treated as data).

## Phases

**Phase 1 (building now):** reader, store, routes, tools, Receipt box screen with Home card, snap → reading →
check → filed, detail with return reminders, edge states (couldn't read, not a receipt, duplicate, camera denied,
offline), auto-file offer, Help topic with pictures, website paragraph.

**Later:** two photos for one long receipt; handwritten tip and foreign-currency polish (the model test shows how
often they matter); a spending-by-category chart; CSV export for tax time; business use (a separate decision).

## Known limits to say plainly

Reads can be wrong, especially smudged totals and handwriting: that is why every receipt is checked at first and
unsure ones always stop. Several receipts in one photo can't be filed together. A read that fails after the photo
is saved keeps the photo in "To read". Offline photos wait on the device and are read when the app is back online
and open.
