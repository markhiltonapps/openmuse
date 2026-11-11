Receipt model test
==================

What it is: a way to compare vision models (cheaper vs more accurate) at reading receipt photos,
using the app's real reader code (apps/server/src/receipt-reader.ts: receiptPrompt, parseReceiptRead,
reconcile). The model's answer goes through the same checks the app uses, so the numbers include what
reconcile() does with a smudged or doubtful total.

The results of the first run (on synthetic receipts) are in docs/receipt_model_test_20261111.txt.

Files here
----------
make-receipts.mjs   Draws 17 synthetic receipt pictures with Playwright and writes their answer key.
                      node scripts/receipt-model-test/make-receipts.mjs [outputFolder]
                    The pictures go to outputFolder (default: the session scratchpad), never into the repo.
truth.json          The answer key for those pictures (also copied beside them).
run.mjs             Calls the models and scores them.

Run it on your own receipt photos
---------------------------------
1. Make a folder (anywhere outside the repo, receipts carry personal details), put the photos in it
   (.jpg, .jpeg, .png, .webp or .gif; phone photos under about 5 MB are fine).

2. In the same folder write truth.json: a list with one entry per photo, in the same shape as
   scripts/receipt-model-test/truth.json:

   [
     {
       "file": "IMG_1234.jpg",
       "merchant": "Costco",              // as printed; the match is forgiving (case, & / and, accents,
                                          //   either name containing the other)
       "date": "2026-10-18",              // YYYY-MM-DD
       "total": 87.43,                    // the printed total (before any handwritten tip)
       "tax": 6.12,                       // null or 0 when no tax is printed
       "paymentLast4": "4417",            // null for cash or when no card digits are printed
       "returnDays": 30,                  // only when the receipt states a window in days, else null
       "category": "Groceries",           // Groceries, Dining, Home, Health, Kids, Pets, Gifts, Travel,
                                          //   Subscriptions or Other
       "categoryAlso": ["Home"],          // optional: other categories that are fine too
       "isReceipt": true,
       "multipleReceipts": false,
       "skip": ["merchant", "date"]       // optional: fields not to score for this photo (use for photos
     }                                    //   of two receipts or things that are not receipts: skip
   ]                                      //   merchant, date, total, tax, paymentLast4, returnDays, category)

   Optional extras that are scored when present: "currency" ("EUR"), "warrantyMentioned" (true),
   "smudgedTotal" (true: the report then says whether the total was settled from the receipt's sums).
   Notes ("note") are ignored. JSON has no comments: leave the // remarks out of the real file.

3. Run (Node 22; the key is read from the environment and is never printed or written):

     OPENROUTER_API_KEY=... npx tsx scripts/receipt-model-test/run.mjs <folder>

   Options:
     --models a,b        model ids, comma separated (default: claude-haiku-4.5, claude-haiku-5.5,
                         claude-sonnet-5, claude-sonnet-5.5, gemini-3.5-flash-lite). Ids that are not in
                         OpenRouter's list are skipped with a message.
     --out <dir>         where the raw per-call JSON and the summary go (default <folder>/results)
     --cap <dollars>     stop before total spend passes this (default 1.50; it counts calls already saved)
     --concurrency <n>   calls at once per model (default 3)
     --only a.jpg,b.jpg  only these photos (a quick trial)
     --today YYYY-MM-DD  the date given to the model (default 2026-11-11: set it to today)
     --country <name>    the country given to the model (default "United States")
     --score-only        no calls: score the saved raw results again (free)
     --force             call again even where a saved result exists

   Each finished call is saved in <out>/raw, so a stopped run carries on where it left off and nothing is
   paid for twice. A call that failed (an error from OpenRouter) is not kept as a result and is tried
   again next time. The run stops at once if OpenRouter says the key has no credit or has reached its own
   limit (HTTP 402/403); the script prints how much the key has left before starting.

4. Read <out>/summary.txt (tables), <out>/failures.txt (every wrong field: what the model said, the truth,
   what reconcile() did with it) and <out>/scores.json. Raw answers are in <out>/raw.

What the numbers mean
---------------------
fields       share of all field checks right (merchant, date, final total, tax, last 4, return days,
             category, isReceipt, multipleReceipts). "Final total" is what reconcile() settles on.
key-4        share of receipts with merchant + date + total + last 4 all right (single receipts only).
danger       the total is wrong but reconcile() said "sure": the person would never be asked. The most
             important column. "pick" with the right total among the candidates is a harmless question.
parse        answers that could not be parsed (the app's retry-once rule is NOT used here, so this is the
             first-try failure rate). Check finish_reason in <out>/raw: "length" means the answer was cut off
             by max_tokens (newer Claude models spend part of it on hidden reasoning).
16dig        answers containing a run of 12 or more digits: a leaked card number. Must be 0.
c/receipt    mean cost of one read in cents (OpenRouter's usage.cost); $/100 is the cost of 100 receipts.

Your photos carry card digits, addresses and so on: keep the folder, <out> and anything copied from them
out of the repo and out of chat.
