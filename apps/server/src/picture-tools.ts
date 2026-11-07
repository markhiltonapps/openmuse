import { z } from "zod";
import { PictureLimit, type Pictures, PROMPT_LIMIT } from "./pictures.ts";

/**
 * "Make me a picture of…" in the chat or on a call: one tool that makes the picture, saves it to
 * Files and shows its card (the app's living photo, with Try another and Make it better).
 */
export const pictureToolInstructions =
  ' When the person asks for a picture, image, drawing, illustration, poster or logo of something, call make_picture with a clear one-or-two-sentence description (what, where, style, mood; keep their own words). Make a draft unless they ask for a better one ("make it better", "a good one", "higher quality"): then quality "good". Pick the shape: "wide" for scenes and banners, "tall" for phone wallpapers and posters, else "square". Its card shows the picture, moving, and it\'s already in their Files: don\'t offer to save it. Never make pictures of real, named people, of anyone who looks under 18, or anything sexual or violent: say so kindly and offer something else. You can\'t change an existing picture yet; "try another" makes a new one. When the result says the month\'s pictures are used up, say so in its words and don\'t try again.';

export function pictureToolSpecs(
  pictures: Pictures | undefined,
  owner: string,
  options: { onCall?: boolean } = {},
) {
  return [
    {
      name: "make_picture",
      description:
        "Make a picture from a description (a draft by default, or a good one), save it to the person's Files and show it. New pictures only; it can't edit one.",
      parameters: z.object({
        prompt: z
          .string()
          .trim()
          .min(3)
          .max(PROMPT_LIMIT)
          .describe("What the picture shows, in one or two sentences, in the person's words"),
        quality: z
          .enum(["draft", "good"])
          .optional()
          .describe("draft (quick, the default) or good (better, only when asked)"),
        aspect: z
          .enum(["square", "wide", "tall"])
          .optional()
          .describe("The picture's shape: square, wide (16:9) or tall (9:16)"),
      }),
      execute: async ({
        prompt,
        quality,
        aspect,
      }: {
        prompt: string;
        quality?: "draft" | "good";
        aspect?: "square" | "wide" | "tall";
      }) => {
        if (!pictures || !(await pictures.available()))
          return { error: "Pictures aren’t set up here yet, so I can’t make one." };
        try {
          const made = await pictures.make(owner, { prompt, quality, aspect });
          return {
            picture: {
              fileId: made.file.id,
              name: made.file.name,
              url: made.file.url,
              prompt: made.prompt,
              quality: made.quality,
              aspect: made.aspect,
              moving: made.depth,
            },
            // On a call the card is on the call screen; in the chat, right there.
            ...(options.onCall ? {} : { shown: "On their screen, moving, and in their Files." }),
            note:
              made.quality === "draft"
                ? "A draft. If they want it better, make_picture again with quality good."
                : "The good kind.",
          };
        } catch (error) {
          if (error instanceof PictureLimit)
            return {
              limit: error.message,
              goodOnly: error.goodOnly,
              note: error.goodOnly
                ? "Only the good kind is used up: offer a draft."
                : "Say this in their words; don't try again.",
            };
          return {
            error: error instanceof Error ? error.message : "The picture couldn’t be made.",
          };
        }
      },
    },
  ];
}
