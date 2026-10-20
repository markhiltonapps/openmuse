# Pricing math: an 80% margin on the $20 and $100 plans

Written 2026-10-20. The owner wants plans like Meta Muse's (Power $20, Maximum $100) that are a better deal, with caps that keep at least an 80% gross margin on usage. So usage may cost at most $4 a month on the $20 plan and $20 on the $100 plan. Fixed costs (Railway, CopilotKit Cloud, domains) come out of the remaining 80%.

## What each thing costs us (measured on Railway, Oct 2026)

| Thing | Cost today | With the leaner chat setup | Notes |
|---|---|---|---|
| Call minute (our own voice) | 1.6¢, plan on 2¢ | 2¢ | Soniox 0.2¢ + Inworld ~0.5¢ + Haiku ~0.4¢ + a share of look-ups. OpenAI's voice is 5¢ and shouldn't be on these plans. |
| Chat message (Sonnet 5, 70k context) | 1.6¢ warm, 17.7¢ after a quiet spell; ~4.8¢ blended | 1.2¢ blended | "Leaner" = chat on Haiku 4.5 with a ~30k context. Not built yet. |
| Recorded meeting, per hour | 12¢ | 12¢ | Soniox 10¢ + notes ~1¢. |
| Background job | ~20¢ | ~15¢ | 10 to 20 Haiku steps plus a few web searches at 1¢ each. |
| CopilotKit Cloud | not known per thread | | Check the invoice after a month of real use. |

## Caps at 80% margin

### $20 plan ("Neddy")

| Included | Today's costs | Leaner chat |
|---|---|---|
| 60 call minutes | $1.20 | $1.20 |
| 150 messages | $7.20 (too much) | $1.80 |
| 3 meeting hours | $0.36 | $0.36 |
| 5 background jobs | $1.00 | $0.75 |
| Total | $9.76 (51% margin) | $4.11 (79% margin) |

With today's chat costs the $20 plan would have to drop to about 40 messages a month to hold 80%, which is not sellable. So the $20 plan as shown on the pricing page assumes the leaner chat setup. Build that first.

### $100 plan ("Neddy Max"): five times the $20 plan, at the same rates

| Included | Today's costs | Leaner chat |
|---|---|---|
| 300 call minutes | $6.00 | $6.00 |
| 750 messages | $36.00 (too much) | $9.00 |
| 15 meeting hours | $1.80 | $1.80 |
| 25 background jobs | $5.00 | $3.75 |
| Total | $48.80 (51% margin) | $20.55 (79.5% margin) |

Max is exactly five times Neddy, so neither plan is a worse deal per unit than the other. The
margin sits a hair under 80% on the job-cost guess (15¢); at 13¢ a job it is 80%. The copy
reviewer's first draft had Max at 350/600/12/20, which made the $20 plan the better deal on
three of four counts and let a person buy Max's allowances cheaper as extras; both fixed.

### Over the cap

Each extra unit is priced at six to eight times its cost, so overage holds 83% to 87%:

| Extra | Price | Our cost |
|---|---|---|
| Call minute | 12¢ | 2¢ |
| Message | 8¢ | 1.2¢ |
| Meeting hour | 80¢ | 12¢ |
| Background job | $1.50 | 15 to 20¢ |

The check that matters: a person on the $20 plan must not be able to buy Max's allowances as
extras for less than Max. 240 minutes + 600 messages + 12 hours + 20 jobs as extras cost
$28.80 + $48 + $9.60 + $30 = $116.40 on top of $20, so Max at $100 wins. (The first draft's
extras of 10¢ / 6¢ / 60¢ / $1 came to $96.40 and undercut Max; the copy reviewer caught it.)

Overage is optional on the page (off by default: when a cap is reached Neddy says so and offers Type instead or the next plan). Turn it on later with a card on file.

## What a typical person actually uses

- Light: 10 minutes of calls, 60 messages, 1 meeting hour, 1 job a month: about $1.30 on the leaner setup. Margin on $20: 93%.
- Typical: 40 minutes, 150 messages, 3 hours, 3 jobs: about $3.40. Margin 83%.
- Heavy on $100: 250 minutes, 600 messages, 10 hours, 15 jobs: about $15.65. Margin 84%.

Most people never reach the caps, so the real margin sits above 80% even before overage.

## Against Meta Muse

Muse sells tokens (500M a week on Power, 3B on Maximum). Apples to apples, by the owner's
question on Oct 20: a Neddy message costs ~70k tokens (mostly the cached re-read of memory and
the conversation), so our $20 plan is ~2.5M tokens a week against Muse's 500M, about 200× less
raw; even if Muse spends 3× the tokens per message, their plan is ~70× ours in typed chat.
For chat, Muse is effectively unlimited and we are capped; the page now says so plainly
("We won't pretend that's more") and frames the $20 on what Muse's pages don't list: an hour of
calls, three meeting hours with notes, five background jobs, editable memory, a person who
answers. Competing on chat volume would need a budget model (DeepSeek flash ~0.1¢ a message)
at a visible quality cost; not chosen.

## To do before the pricing page goes live

1. Build the leaner chat setup (Haiku 4.5 for chat, ~30k context) and measure a week of real messages.
2. Put the caps into the server (calls and meetings already have monthly limits; add messages and jobs), and make the "you've reached your cap" moment kind: say it, offer Type instead or the next plan, never a red error.
3. Read the first CopilotKit Cloud invoice and add its per-thread cost here.
4. Decide on overage (card on file) or hard caps.
