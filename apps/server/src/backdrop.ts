import { z } from "zod";
import {
  BACKDROPS,
  backdropById,
  DEFAULT_BACKDROP,
  findBackdrop,
  NO_BACKDROP,
} from "../../../packages/domain/src/backdrops.ts";
import type { Store } from "./db.ts";

/**
 * The moving backdrop behind the app (owner, 2026-10-09): which scene, or none, and whether it
 * holds still. Saved per account so it follows the person to every device; a new account starts on
 * the beach.
 */
interface BackdropSettings {
  id: "backdrop";
  scene: string;
  still: boolean;
}
export interface BackdropView {
  scene: string;
  still: boolean;
}

export async function backdropView(db: Store, owner: string): Promise<BackdropView> {
  const saved = await db.get<BackdropSettings>(owner, "agent-settings", "backdrop");
  const scene =
    saved?.scene === NO_BACKDROP || backdropById(saved?.scene)
      ? (saved?.scene ?? DEFAULT_BACKDROP)
      : DEFAULT_BACKDROP;
  return { scene, still: saved?.still === true };
}

export const backdropChangeSchema = z.object({
  scene: z.string().trim().max(60).optional(),
  still: z.boolean().optional(),
});

export async function changeBackdrop(
  db: Store,
  owner: string,
  change: z.infer<typeof backdropChangeSchema>,
): Promise<BackdropView> {
  const now = await backdropView(db, owner);
  let scene = now.scene;
  if (change.scene !== undefined) {
    const found = findBackdrop(change.scene);
    if (!found) throw new Error(`There's no backdrop called “${change.scene}”.`);
    scene = found;
  }
  const next = { scene, still: change.still ?? now.still };
  await db.put<BackdropSettings>(owner, "agent-settings", { id: "backdrop", ...next });
  return next;
}

const sceneName = (scene: string) =>
  scene === NO_BACKDROP ? "no backdrop (the plain look)" : (backdropById(scene)?.name ?? scene);

/** "Change my backdrop to the city", "make it still", "turn the backdrop off": by voice or chat. */
export function backdropToolSpecs(db: Store, owner: string) {
  const choices = BACKDROPS.map((b) => `${b.name} (${b.group})`).join(", ");
  return [
    {
      name: "change_backdrop",
      description: `Change the moving picture behind the app, make it hold still, or turn it off. Scenes: ${choices}. "none" turns it off (the plain look). Pass what they said (e.g. "the city", "northern lights"); it finds the closest scene. still: true stops the movement (saves battery), false starts it again. A new scene shows in the app within a minute (after a call, if one is on); turning the backdrop off or on takes effect when the app reopens (the app offers a Reopen now button; if they ask to reopen, show_in_app the "backdrop" place, which has it).`,
      parameters: z.object({
        scene: z
          .string()
          .trim()
          .max(60)
          .optional()
          .describe('A scene name, what they said for it, or "none"'),
        still: z.boolean().optional(),
      }),
      execute: async (args: { scene?: string; still?: boolean }) => {
        try {
          const before = await backdropView(db, owner);
          const after = await changeBackdrop(db, owner, args);
          const switched = (before.scene === NO_BACKDROP) !== (after.scene === NO_BACKDROP);
          return {
            ...after,
            name: sceneName(after.scene),
            message: `Saved: ${sceneName(after.scene)}${after.still && after.scene !== NO_BACKDROP ? ", holding still" : ""}.${switched ? " Turning the backdrop on or off takes effect when the app reopens: they tap Reopen now (on the card in the chat, or on the app's screen after a call)." : " It shows in the app within a minute, or after the call if they're on one."} Say it in a few words, and don't say it's on their screen already.`,
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
            choices,
            message: "Say which scenes there are, briefly, and ask which one they'd like.",
          };
        }
      },
    },
  ];
}
