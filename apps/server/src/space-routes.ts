import type { Context } from "hono";
import { Hono } from "hono";
import { AppError } from "./errors.ts";
import type { FamilyWeeks } from "./family-weeks.ts";
import type { RecipeKitchen } from "./recipe-writer.ts";
import type { SocialWeeks } from "./social-weeks.ts";
import type { ScheduledPosts } from "./space-posts.ts";
import type { ChatCalls, RoutineCalls, Spaces } from "./spaces.ts";

type Env = { Variables: { owner: string } };
const body = async (c: Context<Env>) =>
  (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

/** /api/spaces: the person's spaces, their playbooks, prompts and weekly digest. */
export function spaceRoutes(
  spaces: Spaces,
  routines: RoutineCalls,
  posts: ScheduledPosts,
  chats?: ChatCalls,
  boards?: {
    weeks: FamilyWeeks;
    results: SocialWeeks;
    /** Writes dinner recipes; undefined when the Anthropic API isn't configured. */
    recipes: () => RecipeKitchen | undefined;
    timeZone: (owner: string) => Promise<string>;
  },
) {
  const app = new Hono<Env>();
  // A family space's week board: groceries ticked off, chores stamped, past weeks looked back on.
  if (boards) {
    const { weeks, results, timeZone } = boards;
    const space = async (c: Context<Env>) => {
      const found = await spaces.get(c.get("owner"), c.req.param("id") ?? "");
      return found.id;
    };
    app.get("/:id/weeks", async (c) => {
      const owner = c.get("owner");
      const board = await weeks.board(owner, await space(c), await timeZone(owner));
      // The nights whose recipes are on the way, so the board can say so and look again.
      const writing = board.week ? (boards.recipes()?.pending(owner, board.week.id) ?? []) : [];
      return c.json({ ...board, recipesWriting: writing });
    });
    app.get("/:id/weeks/:week", async (c) =>
      c.json(await weeks.get(c.get("owner"), await space(c), c.req.param("week"))),
    );
    app.post("/:id/weeks/:week/groceries", async (c) =>
      c.json(
        await weeks.addGrocery(c.get("owner"), await space(c), c.req.param("week"), await body(c)),
      ),
    );
    app.post("/:id/weeks/:week/groceries/:item", async (c) =>
      c.json(
        await weeks.setGrocery(
          c.get("owner"),
          await space(c),
          c.req.param("week"),
          c.req.param("item"),
          await body(c),
        ),
      ),
    );
    app.post("/:id/weeks/:week/chores/:chore", async (c) =>
      c.json(
        await weeks.stamp(
          c.get("owner"),
          await space(c),
          c.req.param("week"),
          c.req.param("chore"),
          await body(c),
        ),
      ),
    );
    // A night's recipes written now, when the family asks on the board (or the ones missing).
    app.post("/:id/weeks/:week/recipes", async (c) => {
      const kitchen = boards.recipes();
      if (!kitchen)
        throw new AppError(
          "Recipes can’t be written yet: the server needs an Anthropic API key.",
          503,
        );
      const found = await spaces.get(c.get("owner"), c.req.param("id") ?? "");
      if (found.kind !== "family") throw new AppError("Only a family space has dinners", 404);
      const night = Number((await body(c)).day);
      const result = await kitchen.fill(
        c.get("owner"),
        found,
        c.req.param("week"),
        Number.isInteger(night)
          ? { nights: [night] }
          : { timeZone: await timeZone(c.get("owner")) },
      );
      return c.json({
        ...result,
        week: await weeks.get(c.get("owner"), found.id, c.req.param("week")),
      });
    });
    // A night's recipe: pick one (its ingredients replace the last pick's), or put back what's missing.
    app.post("/:id/weeks/:week/dinners/:day/choose", async (c) =>
      c.json(
        await weeks.chooseRecipe(
          c.get("owner"),
          await space(c),
          c.req.param("week"),
          Number(c.req.param("day")),
          await body(c),
        ),
      ),
    );
    app.post("/:id/weeks/:week/dinners/:day/groceries", async (c) =>
      c.json(
        await weeks.addRecipeGroceries(
          c.get("owner"),
          await space(c),
          c.req.param("week"),
          Number(c.req.param("day")),
        ),
      ),
    );
    // A social media space's weekly results, oldest first, for its Results tab.
    app.get("/:id/results", async (c) =>
      c.json({ weeks: await results.all(c.get("owner"), await space(c)) }),
    );
    app.post("/:id/weeks/:week/reuse-groceries", async (c) => {
      const { to } = await body(c);
      return c.json(
        await weeks.reuseGroceries(
          c.get("owner"),
          await space(c),
          c.req.param("week"),
          typeof to === "string" ? to : "",
        ),
      );
    });
  }
  app.get("/", async (c) => c.json(await spaces.list(c.get("owner"))));
  // The app's own post scheduler: the person approves or cancels queued posts.
  app.get("/posts", async (c) => c.json(await posts.list(c.get("owner"))));
  app.post("/posts/:postId/approve", async (c) =>
    c.json(await posts.approve(c.get("owner"), c.req.param("postId"), (await body(c)).hash)),
  );
  app.post("/posts/:postId/cancel", async (c) =>
    c.json(await posts.cancel(c.get("owner"), c.req.param("postId"))),
  );
  app.post("/", async (c) => c.json(await spaces.create(c.get("owner"), await body(c)), 201));
  app.post("/:id/playbook", async (c) => {
    const { setupDone, ...patch } = await body(c);
    return c.json(
      await spaces.update(
        c.get("owner"),
        c.req.param("id"),
        patch,
        typeof setupDone === "boolean" ? setupDone : undefined,
      ),
    );
  });
  app.post("/:id/name", async (c) =>
    c.json(await spaces.rename(c.get("owner"), c.req.param("id"), (await body(c)).name)),
  );
  app.post("/:id/prompts", async (c) =>
    c.json(await spaces.addPrompt(c.get("owner"), c.req.param("id"), (await body(c)).text)),
  );
  app.post("/:id/prompts/:promptId/delete", async (c) =>
    c.json(await spaces.removePrompt(c.get("owner"), c.req.param("id"), c.req.param("promptId"))),
  );
  app.post("/:id/digest", async (c) =>
    c.json(await spaces.setDigest(c.get("owner"), c.req.param("id"), await body(c), routines)),
  );
  app.post("/:id/delete", async (c) => {
    const { deleteChat } = await body(c);
    const removed = await spaces.remove(
      c.get("owner"),
      c.req.param("id"),
      routines,
      chats,
      deleteChat === true,
    );
    await posts.cancelSpace(c.get("owner"), c.req.param("id"));
    await boards?.weeks.removeSpace(c.get("owner"), c.req.param("id"));
    await boards?.results.removeSpace(c.get("owner"), c.req.param("id"));
    return c.json(removed);
  });
  return app;
}
