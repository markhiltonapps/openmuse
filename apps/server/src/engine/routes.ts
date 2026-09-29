import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import {
  type AgentIdentity,
  type AgentMemory,
  type AgentNotification,
  type AvatarImage,
  avatarCharacters,
  avatarColors,
} from "../../../../packages/domain/src/agent.ts";
import { designAvatar } from "../avatar-designer.ts";
import { AppError } from "../errors.ts";
import type { AgentService } from "./service.ts";

const text = z.string().trim().min(1).max(4000);
const memorySchema = z.object({ text, source: z.string().trim().min(1).max(200).optional() });
const goalPatchSchema = z.object({
  status: z.enum(["active", "paused", "completed"]).optional(),
  milestones: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        title: z.string().trim().min(1).max(200),
        done: z.boolean(),
      }),
    )
    .max(100)
    .optional(),
});

export function agentRoutes(service: AgentService): Hono<{ Variables: { owner: string } }> {
  const app = new Hono<{ Variables: { owner: string } }>();
  app.get("/", async (c) => c.json(await service.snapshot(c.get("owner"))));
  app.post("/tasks", async (c) =>
    c.json(await service.createTask(c.get("owner"), await c.req.json()), 201),
  );
  app.get("/tasks/:id", async (c) =>
    c.json(await service.detail(c.get("owner"), c.req.param("id"))),
  );
  app.post("/tasks/:id/control", async (c) => {
    const { action } = z
      .object({ action: z.enum(["pause", "resume", "cancel", "retry"]) })
      .parse(await c.req.json());
    return c.json(await service.control(c.get("owner"), c.req.param("id"), action));
  });
  app.post("/tasks/:id/input", async (c) => {
    const body = z
      .object({
        answer: z.string().trim().min(1).max(12000),
        fields: z
          .record(z.string().min(1).max(300), z.union([z.string().max(12000), z.boolean()]))
          .optional(),
      })
      .parse(await c.req.json());
    return c.json(
      await service.answer(c.get("owner"), c.req.param("id"), body.answer, body.fields),
    );
  });
  app.post("/goals", async (c) =>
    c.json(await service.createGoal(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/goals/:id", async (c) => {
    const body = goalPatchSchema.parse(await c.req.json());
    return c.json(await service.updateGoal(c.get("owner"), c.req.param("id"), body));
  });
  app.post("/monitors", async (c) =>
    c.json(await service.createMonitor(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/monitors/:id/control", async (c) => {
    const { action } = z
      .object({ action: z.enum(["pause", "resume", "stop", "check"]) })
      .parse(await c.req.json());
    return c.json(await service.controlMonitor(c.get("owner"), c.req.param("id"), action));
  });
  app.post("/ideas/refresh", async (c) => c.json(await service.refreshIdeas(c.get("owner"), true)));
  app.post("/ideas/:id", async (c) => {
    const body = z
      .object({
        action: z.enum(["accept", "dismiss"]),
        prompt: z.string().trim().min(1).max(12000).optional(),
      })
      .parse(await c.req.json());
    return c.json(
      await service.decideIdea(c.get("owner"), c.req.param("id"), body.action, body.prompt),
    );
  });
  app.post("/memories", async (c) => {
    const body = memorySchema.parse(await c.req.json());
    const memory: AgentMemory = {
      id: randomUUID(),
      text: body.text,
      source: body.source ?? "You",
      createdAt: new Date().toISOString(),
    };
    return c.json(await service.db.put(c.get("owner"), "memories", memory), 201);
  });
  app.post("/memories/:id", async (c) => {
    const body = memorySchema.parse(await c.req.json());
    const memory = await service.db.compareAndSwap<AgentMemory>(
      c.get("owner"),
      "memories",
      c.req.param("id"),
      {},
      body,
    );
    if (!memory) throw new AppError("Memory not found", 404);
    return c.json(memory);
  });
  app.post("/timezone", async (c) => {
    const body = z.object({ timeZone: z.string() }).parse(await c.req.json());
    return c.json(await service.setTimeZone(c.get("owner"), body.timeZone));
  });
  app.post("/routines", async (c) =>
    c.json(await service.createRoutine(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/routines/:id", async (c) =>
    c.json(await service.updateRoutine(c.get("owner"), c.req.param("id"), await c.req.json())),
  );
  app.post("/routines/:id/run", async (c) =>
    c.json(await service.runRoutine(c.get("owner"), c.req.param("id")), 201),
  );
  app.post("/routines/:id/delete", async (c) =>
    c.json(await service.deleteRoutine(c.get("owner"), c.req.param("id"))),
  );
  app.post("/memory-suggestions/:id", async (c) => {
    const body = z
      .object({
        action: z.enum(["keep", "dismiss"]),
        text: z.string().trim().min(1).max(500).optional(),
      })
      .parse(await c.req.json());
    return c.json(
      await service.decideMemory(c.get("owner"), c.req.param("id"), body.action, body.text),
    );
  });
  app.post("/memories/:id/forget", async (c) => {
    if (!(await service.db.take(c.get("owner"), "memories", c.req.param("id"))))
      throw new AppError("Memory not found", 404);
    return c.json({ ok: true });
  });
  // Only the fields given change, so the avatar picker can save a tap without touching the name.
  app.post("/identity", async (c) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        tone: z.enum(["warm", "concise", "thoughtful"]).optional(),
        avatar: z.enum(avatarColors).optional(),
        character: z.enum(avatarCharacters).optional(),
        showChatUpdates: z.boolean().optional(),
        updatesDisplay: z.enum(["popup", "bell", "chat"]).optional(),
      })
      .parse(await c.req.json());
    const owner = c.get("owner");
    if (
      body.character === "custom" &&
      !(await service.db.get(owner, "agent-settings", "avatar-image"))
    )
      throw new AppError("Upload or design your own avatar first", 409);
    await service.ensure(owner);
    const identity = await service.db.compareAndSwap<AgentIdentity>(
      owner,
      "agent-settings",
      "identity",
      {},
      body,
    );
    if (!identity) throw new AppError("Agent identity changed; refresh and try again", 409);
    return c.json(identity);
  });
  // A person's own avatar lives apart from the identity so every workspace poll stays small.
  app.get("/avatar-image", async (c) => {
    const image = await service.db.get<AvatarImage>(
      c.get("owner"),
      "agent-settings",
      "avatar-image",
    );
    return c.json({ image, designAvailable: Boolean(designer()) });
  });
  const saveAvatar = async (owner: string, kind: AvatarImage["kind"], data: string) => {
    const updatedAt = new Date().toISOString();
    await service.ensure(owner);
    await service.db.put(owner, "agent-settings", {
      id: "avatar-image",
      kind,
      data,
      updatedAt,
    } satisfies AvatarImage);
    return service.db.compareAndSwap<AgentIdentity>(
      owner,
      "agent-settings",
      "identity",
      {},
      {
        character: "custom",
        avatarImageVersion: updatedAt,
      },
    );
  };
  app.post("/avatar-image", async (c) => {
    const { data } = z
      .object({
        data: z
          .string()
          .max(400_000, "Choose a smaller picture")
          .regex(
            /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/,
            "Choose a PNG, JPEG or WebP picture",
          ),
      })
      .parse(await c.req.json());
    return c.json(await saveAvatar(c.get("owner"), "photo", data));
  });
  const designer = () => {
    const apiKey = service.config.anthropicApiKey;
    if (!apiKey || service.config.agentBackend !== "model") return undefined;
    const configured = /^anthropic[/:](.+)$/.exec(service.config.model ?? "")?.[1];
    return { apiKey, model: process.env.AVATAR_MODEL?.trim() || configured || "claude-sonnet-5" };
  };
  app.post("/avatar-design", async (c) => {
    const { description } = z
      .object({ description: z.string().trim().min(3).max(300) })
      .parse(await c.req.json());
    const options = designer();
    if (!options) throw new AppError("Designing avatars needs an Anthropic API key", 409);
    const svg = await designAvatar(description, {
      ...options,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      fetcher: service.avatarFetcher,
      onUsage: service.usage?.sink(c.get("owner"), "avatar"),
    });
    return c.json(await saveAvatar(c.get("owner"), "svg", svg));
  });
  app.get("/notifications", async (c) =>
    c.json((await service.snapshot(c.get("owner"))).notifications),
  );
  app.post("/notifications/read", async (c) => {
    const { taskId } = z.object({ taskId: z.string().min(1).max(200) }).parse(await c.req.json());
    return c.json({ read: await service.readTaskNotifications(c.get("owner"), taskId) });
  });
  app.post("/notifications/:id/read", async (c) => {
    const notification = await service.db.compareAndSwap<AgentNotification>(
      c.get("owner"),
      "notifications",
      c.req.param("id"),
      {},
      { read: true },
    );
    if (!notification) throw new AppError("Notification not found", 404);
    return c.json(notification);
  });
  app.post("/sample-page", async (c) => {
    if (service.config.mode !== "sample") throw new AppError("Not found", 404);
    const body = z.object({ text: z.string().max(100000) }).parse(await c.req.json());
    await service.db.put(c.get("owner"), "sample-pages", { id: "availability", text: body.text });
    return c.json({ ok: true });
  });
  return app;
}
