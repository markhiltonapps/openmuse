# Pricing math: the $10 / $20 / $100 ladder

Rewritten 2026-10-20 after the owner chose to market on privacy and generous chat rather than
compare tokens with Meta Muse. Targets: at least an 80% margin on what people typically use, and
never a loss at the ceilings. Fixed costs (Railway, CopilotKit Cloud, domains) and card fees come
out of what is left.

## What each thing costs us

| Thing | Cost | Basis |
|---|---|---|
| Call minute (our own voice) | 2¢ | Measured 1.6¢ typical, 1.9¢ chatty; plan on 2¢. OpenAI's voice is 5¢ and isn't offered on these plans. |
| Chat message, before | 4.8¢ blended (2¢ follow-up, 8¢ after 5 quiet minutes, 18¢ after an hour) | Measured on Railway on Sonnet 5 with ~70k tokens a call, Oct 19–20. |
| Chat message, now | **about 1.5¢ blended** (0.65¢ follow-up, 2.6¢, 5.8¢) | A projection, not a measurement: the same mix scaled by price (Haiku 4.5 is half of Sonnet 5 per token) and size (~45k tokens a call instead of ~70k), 0.5 × 0.64 = 0.32. **Check it against Railway's "Model call: chat" lines after the deploy.** |
| Recorded meeting, per hour | 12¢ | Soniox 10¢ + notes ~1¢. |
| Background job | 15¢ | 10 to 20 Haiku steps plus a few web searches at 1¢ each. |
| Card fees | 2.9% + 30¢ a charge | $0.59 on $10, $0.88 on $20, $3.20 on $100. Not yet in the margins below. |
| CopilotKit Cloud | unknown per thread | Read the first invoice after a month of real use. |

### Where the chat's tokens went (measured with the test fixtures, Oct 20)

A chat call carries about 26,000 tokens before any conversation: 7,000 of instructions and 19,000
of tool definitions (89 tools; the largest are show_in_app, save_week_plan and
update_space_playbook at ~1,250 each). The rest is the person's own context (memories, people,
meetings, summaries) and the conversation. Two changes cut it: the chat model went from Sonnet 5
to the quick worker model (Haiku 4.5), and the word-for-word part of a long chat went from
100,000 characters to 40,000 (summarized sooner: LIMIT 40,000, TAIL 20,000 in chat-summary.ts),
which takes the conversation share from up to ~25,000 tokens to ~10,000. That makes ~45,000 a call
for a person with a lot of context. Pruning the tool descriptions would save a few thousand more
tokens; not done, because it risks the agent picking the wrong tool.

Haiku 4.5 only caches prompts of 4,096 tokens or more; these are far over that.

## The ladder

| | Starter $10 | Neddy $20 | Neddy Max $100 |
|---|---|---|---|
| Call minutes | 20 | 60 | 300 |
| Typed messages (ceiling) | 500 | 1,000 | 5,000 |
| Meeting hours | 1 | 3 | 15 |
| Background jobs | 2 | 5 | 25 |

Max is exactly five times Neddy on all four counts and on price. The page says "generous", never
"unlimited": a hard ceiling isn't unlimited, and the pricing page's copy reviewer would object.

## Margin by how people use it (at 1.5¢ a message)

Usage cost = messages × 1.5¢ + minutes × 2¢ + meeting hours × 12¢ + jobs × 15¢.

| Profile | Usage | Cost | Margin on $10 | on $20 | on $100 |
|---|---|---|---|---|---|
| Light: 5 messages a day (150), 10 min, 1 h, 1 job | | $2.72 | 73% | 86% | 97% |
| Typical: 10 a day (300), 40 min, 3 h, 3 jobs | | $6.11 | over Starter's caps | 69% | 94% |
| Heavy on Max: 600 messages, 250 min, 10 h, 15 jobs | | $16.45 | | | 84% |

| At the ceilings (everything used) | Cost | Margin before fees and fixed costs |
|---|---|---|
| Starter | $8.32 | 17% |
| Neddy | $17.31 | 13% |
| Neddy Max | $86.55 | 13% |

Read this honestly:

- **The 80% target holds for a light user and for a heavy Max user, not for a typical $20 user at
  ten messages a day (69%).** An 80% margin on the $20 plan leaves $4 of usage; after calls,
  meetings and jobs at typical levels (about $1.60) that is about 160 messages, five a day.
- **There is no real usage data yet** (a handful of invited people, mostly testing), so
  "typical" here is an assumption. Measure a month of real use per person (Usage already
  tracks it) before selling, and move the ceilings or the price to match.
- **Nobody loses us money at the ceilings** (13% to 17% before card fees and fixed costs), so
  the exposure is thin margin, not a loss.
- Levers if the typical margin needs to rise: a smaller context (trim tool descriptions,
  summarize chats at 20,000 characters), a one-hour cache on the whole conversation block, a
  lower message ceiling on Starter and Neddy (for example 300 and 600), or $24 for the middle plan.

## Extras (over a cap)

| Extra | Price | Our cost | Margin |
|---|---|---|---|
| 30 more call minutes | $3.60 (12¢ each) | 60¢ | 83% |
| 50 more messages | $4 (8¢ each) | 75¢ | 81% |
| Another meeting hour | 80¢ | 12¢ | 85% |
| Another background job | $1.50 | 15¢ | 90% |

The checks that matter: extras must never be a cheaper way to buy a bigger plan. Starter to Neddy
as extras: 40 minutes + 500 messages + 2 hours + 3 jobs = $4.80 + $40 + $1.60 + $4.50 = $50.90
on top of $10, against $10 more for the plan. Neddy to Max: 240 minutes + 4,000 messages + 12
hours + 20 jobs = $28.80 + $320 + $9.60 + $30 on top of $20, against $80 more. Both plans win by far.

## Against Meta Muse

Muse sells tokens (500M a week on Power, 3B on Maximum). Apples to apples: a Neddy message was
~70k tokens (now ~45k), so our $20 plan's old 150 messages were ~2.5M tokens a week against Muse's
500M. For typed chat Muse is effectively unlimited. The owner's call (Oct 20) was to stop
competing on that axis: the pricing page no longer has a side-by-side table; it says what Neddy is
(by invite, asks first, memory you can read, a person who answers) and cites TIME (Oct 6, 2026)
on Muse's hourly profiles of you and the people you mention. The compare page keeps the honest
table, with "not described" wherever Meta's pages are silent.

## To do before the pricing page goes live

1. Deploy the leaner chat and read Railway's "Model call: chat" lines for a week: confirm ~45k
   tokens read, ~0.65¢ a follow-up and ~1.5¢ blended; correct this page if it is off.
2. Put the plans and caps into the server: calls and meetings already have monthly limits; add
   messages and jobs, three plans, and a kind "you've reached the edge" moment (say it, offer the
   next plan or extras, never a red error).
3. Billing: card payments, and the card fees above in the margins.
4. Read the first CopilotKit Cloud invoice and add its per-thread cost.
5. Decide on overage (card on file) or hard caps.
