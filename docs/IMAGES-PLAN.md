# Pictures in Neddy (plan)

Status: proposal only, nothing built. Written 2026-10-27 after the owner asked about Meta Muse's images.

## What Meta actually does

- **Muse Image is Meta's own model**, launched 2026-07-07 by Meta Superintelligence Labs (Meta's announcement,
  CNBC, Quartz). It is not a third party's. Before it, Meta used outside models, **Midjourney** and
  **Black Forest Labs** (the makers of Flux), for pictures and video in Meta AI. If the video named a company, it
  is most likely one of those two (check the exact name in the video).
- Meta also sells Muse Image to developers on its own Model API as `muse-image-1.0`: a flat **$0.01 per picture
  returned**, search and reasoning included, with generate, edit and combine-several-pictures calls and 150
  requests a minute per team (figures from Meta's developer blog and third-party write-ups; Meta's own pages
  could not be read from here, so check its terms before relying on them).
- In Muse the free allowance is counted in Muse tokens a week (pictures, video and chat share it); Power ($20) and
  Maximum ($100) raise it. Meta pulled the Muse Image feature from Instagram after a backlash in July 2026.
  Allowances beyond that are not published.

## What it costs to make a picture (per picture, 1024×1024, prices as found 2026-10-27; check before building)

| Model (how we'd reach it) | Price | Notes |
|---|---|---|
| Flux Schnell-class on cheap hosts (Together, fal, Pixazo) | about $0.001–0.003 | Fast drafts. Plain text-to-picture. A host per model. |
| OpenAI GPT Image 2 (OpenRouter, low quality) | about $0.006 measured | Good at lettering. One key we already have. |
| Meta Muse Image (Meta Model API) | $0.01 flat | Edit and combine included. Needs Meta's developer account and terms. |
| Flux.2 Klein 4B (OpenRouter) | about $0.014 | |
| Riverflow v2.5 fast (OpenRouter) | about $0.018 | |
| Flux.2 Pro, Qwen Image 3, Krea 2 (OpenRouter) | about $0.03 | Better looking. |
| Gemini 3 Pro image | about $0.13 | Top end. |

## The idea: pictures that cost a fraction of a cent, with allowances nobody has to watch

- **Say it, see it.** "Make me a picture of a poodle astronaut" (voice or chat) makes a card in the chat with the
  picture and buttons: **Save to Files**, **Share**, **Change it**, **Try another**. "Make the sky purple" edits the
  last one. On a call the card appears on the call screen (never read out), like other cards.
- **Two quality levels, picked by Neddy:** **Draft** (a Flux Schnell-class model, about 0.2–0.3¢) and **Good**
  (GPT Image 2 or Muse Image, about 0.6–1¢). Draft by default, "make it better" re-does it as Good.
- **A monthly allowance per plan,** counted like messages (`Plans.claim`, once per picture, one person at a time):
  for example Free 10 drafts, Starter 50, Neddy 150, Max 600, of which a fifth may be Good. Worst case cost per
  person per month: Neddy 150 × 1¢ = $1.50 against a $20 plan; Max 600 × 1¢ = $6 against $100.
- **Extras when the allowance runs out:** a pack of 100 pictures for $1 (1¢ each), still about 50% over the
  worst-case cost and under Meta's published developer price plus our overhead. Never "unlimited".
- **Nothing to set up for the person.** Pictures are saved in their Files (the same store as other files), kept
  until deleted, and sent through the same redaction as everything else that reaches a model (a prompt is text).

## How it would be built

- A small `images.ts` in `apps/server/src`: `generate(owner, prompt, quality)` and `edit(owner, imageId,
  prompt)`, one provider at first (**OpenRouter**, which the server already uses with one key and which reports
  each call's cost), a second provider (Meta's API, or a Flux host) only if the first is too dear. Provider and
  model chosen on the admin's AI models card like other jobs (`images` as a kind of work, with its price in
  `usage.ts` so cost shows).
- A chat tool `make_picture` (and `change_picture`), a result card with the buttons above, a count in "Your plan",
  a Help topic with a picture, and the website.
- Limits: a content check by the provider plus ours (no real people's likeness requests, no minors, nothing
  sexual or violent), a per-minute limit per person, and an admin switch to turn the feature off.

## Risks and unknowns

- **Prices move**: the figures above are from one day's search and two of them are the sellers' own marketing.
- **Meta's terms** for reselling Muse Image inside another app could not be read here; treat it as unconfirmed.
- **Backlash and rules**: pictures of real people, style copying and watermarks (some regions now ask for a
  label that a picture is AI-made). The cards should say "Made with AI".
- **Quality**: a $0.003 model is a sketch, not a poster. The Draft / Good split is for that.

## Decisions needed from the owner

1. Include pictures at all in the free plan, and how many?
2. Draft quality from a cheap host (an extra account and key) or only OpenRouter (nothing to set up, a bit dearer)?
3. Editing ("change it") in the first version, or only making new ones?
4. Anything off limits beyond the standard list above?
