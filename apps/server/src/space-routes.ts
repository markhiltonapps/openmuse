import type { Context } from "hono";
import { Hono } from "hono";
import type { FamilyWeeks } from "./family-weeks.ts";
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
  family?: { weeks: FamilyWeeks; timeZone: (owner: string) => Promise<string> },
) {
  const app = new Hono<Env>();
  // A family space's week board: groceries ticked off, chores stamped, past weeks looked back on.
  if (family) {
    const { weeks, timeZone } = family;
    const space = async (c: Context<Env>) => {
      const found = await spaces.get(c.get("owner"), c.req.param("id") ?? "");
      return found.id;
    };
    app.get("/:id/weeks", async (c) =>
      c.json(await weeks.board(c.get("owner"), await space(c), await timeZone(c.get("owner")))),
    );
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
    await family?.weeks.removeSpace(c.get("owner"), c.req.param("id"));
    return c.json(removed);
  });
  return app;
}
