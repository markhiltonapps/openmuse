import type { Context } from "hono";
import { Hono } from "hono";
import type { RoutineCalls, Spaces } from "./spaces.ts";

type Env = { Variables: { owner: string } };
const body = async (c: Context<Env>) =>
  (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

/** /api/spaces: the person's spaces, their playbooks, prompts and weekly digest. */
export function spaceRoutes(spaces: Spaces, routines: RoutineCalls) {
  const app = new Hono<Env>();
  app.get("/", async (c) => c.json(await spaces.list(c.get("owner"))));
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
  app.post("/:id/delete", async (c) =>
    c.json(await spaces.remove(c.get("owner"), c.req.param("id"), routines)),
  );
  return app;
}
