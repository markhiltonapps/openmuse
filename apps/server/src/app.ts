import { randomUUID } from "node:crypto";
import { MessageSchema } from "@ag-ui/core";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";
import { emailDraftSchema, proposalSchema } from "../../../packages/domain/src/index.ts";
import { AccountService, type Mailer, ResendMailer } from "./accounts.ts";
import { ActionService } from "./actions.ts";
import { agentConfigured, makeRuntime } from "./agent.ts";
import { type AppConnector, ComposioConnector } from "./apps.ts";
import { ADMIN_OWNER, createAuth } from "./auth.ts";
import { BrowserService } from "./browser.ts";
import { ComputerService, type DockerRunner } from "./computer.ts";
import { computerRoutes } from "./computer-routes.ts";
import { assertApiDeploymentConfig, type Config } from "./config.ts";
import type { Store } from "./db.ts";
import { agentRoutes } from "./engine/routes.ts";
import { AgentService } from "./engine/service.ts";
import { AppError } from "./errors.ts";
import { FeedService } from "./feed.ts";
import { Files } from "./files.ts";
import { GoogleAuth } from "./google-auth.ts";
import { AgentInbox } from "./inbound.ts";
import { PushService } from "./push.ts";
import { isPurchase, SpendingService } from "./spending.ts";
import { lookAtImage } from "./vision.ts";
import { AnthropicWebSearch, type WebSearch } from "./web-search.ts";
import { WorkspaceService } from "./workspace.ts";

export async function createApp(
  db: Store,
  config: Config,
  options: {
    docker?: DockerRunner;
    apps?: AppConnector;
    mailer?: Mailer;
    search?: WebSearch;
    intelligence?: Pick<CopilotKitIntelligence, "getOrCreateThread" | "deleteThread">;
  } = {},
) {
  assertApiDeploymentConfig(config);
  const auth = await createAuth(db, config);
  const mailer =
    options.mailer ??
    (config.resendApiKey && config.authEmailFrom
      ? new ResendMailer(config.resendApiKey, config.authEmailFrom)
      : undefined);
  const accounts = new AccountService(db, config, auth, mailer);
  await accounts.bootstrap();
  const files = new Files(db, config, auth),
    google = new GoogleAuth(db, config),
    workspace = new WorkspaceService(db, config, files, google);
  let apps = options.apps;
  if (!apps && config.composioApiKey) {
    const composio = new ComposioConnector(db, {
      ...config,
      composioApiKey: config.composioApiKey,
    });
    void composio.check().then(
      () => console.log("Connected apps ready (Composio)"),
      (error) =>
        console.warn(
          `Connected apps unavailable: ${error instanceof Error ? error.message : "check failed"}`,
        ),
    );
    apps = composio;
  }
  const spending = new SpendingService(db);
  const actions = new ActionService(db, {
    authorize: async (owner, input) => {
      if (input.kind !== "app.action" || !isPurchase(input.data.tool)) return;
      const problem = await spending.check(owner, input.data.amountUsd);
      if (problem) throw new AppError(problem, 409);
    },
    execute: async (owner, input, connectionId, targetVersion): Promise<string> => {
      if (input.kind === "agent_email.send") return inbox.send(owner, input.data);
      if (input.kind !== "app.action")
        return workspace.execute(owner, input, connectionId, targetVersion);
      if (!apps) throw new AppError("Connected apps are not configured on this server", 409);
      const data = await apps.execute(owner, input.data.tool, input.data.arguments);
      if (isPurchase(input.data.tool) && input.data.amountUsd)
        await spending.record(owner, "", input.data.amountUsd);
      const detail = data === undefined ? "" : JSON.stringify(data).slice(0, 300);
      return `Done in ${input.data.app} · ${input.data.tool}${detail ? ` · ${detail}` : ""}`;
    },
    prepare: (owner, input, connectionId) => workspace.prepare(owner, input, connectionId),
    connected: (owner) => workspace.connected(owner),
    connection: (owner) => workspace.connection(owner),
  });
  const browser = new BrowserService(db, config, auth, files);
  const computer = new ComputerService(db, config, options.docker);
  const agent = new AgentService(db, config, workspace, files, actions, browser, computer, apps);
  const push = await PushService.create(db, config);
  agent.push = push;
  agent.spending = spending;
  if (config.agentBackend === "model" && config.anthropicApiKey) {
    const apiKey = config.anthropicApiKey;
    const model =
      process.env.VISION_MODEL?.trim() ||
      /^anthropic[/:](.+)$/.exec(config.model ?? "")?.[1] ||
      "claude-sonnet-5";
    agent.look = (image, question) =>
      lookAtImage(image, question, { apiKey, model, baseUrl: process.env.ANTHROPIC_BASE_URL });
  }
  agent.search =
    options.search ??
    (config.agentBackend === "model" && config.anthropicApiKey
      ? new AnthropicWebSearch(config.anthropicApiKey, {
          model: config.webSearchModel,
          baseUrl: process.env.ANTHROPIC_BASE_URL,
        })
      : undefined);
  const feed = new FeedService(db, agent.search, (owner) => agent.timeZone(owner));
  agent.feed = feed;
  const inbox = new AgentInbox(db, config, agent, accounts);
  if (inbox.configured) agent.mail = inbox;
  const intelligence = new CopilotKitIntelligence({ apiKey: config.intelligenceApiKey });
  const threads = options.intelligence ?? intelligence;
  const runtime = makeRuntime(config, agent, auth, intelligence);
  const app = new Hono<{ Variables: { owner: string } }>();
  const origins = new Set([...config.allowedOrigins, new URL(config.publicUrl).origin]);
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && !origins.has(origin)) return c.json({ error: "Origin is not allowed" }, 403);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use(
    "*",
    cors({
      origin: (origin) => (origins.has(origin) ? origin : undefined),
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 12 * 1024 * 1024,
      onError: (c) => c.json({ error: "Request is too large; PDFs must be 10 MB or smaller" }, 413),
    }),
  );
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ error: error.issues.map((i) => i.message).join("; ") }, 422);
    if (error instanceof AppError) return c.json({ error: error.message }, error.status);
    if (error.name === "PdfError" || error.name === "RecurringEventError")
      return c.json({ error: error.message }, 422);
    if (error instanceof SyntaxError) return c.json({ error: "Invalid request data" }, 400);
    // Provider and document errors are useful, but raw stack traces and token-bearing responses are not.
    console.error(`[OpenMuse] ${error.name}`);
    return c.json(
      {
        error:
          error.name === "PdfError" || error.name === "GoogleApiError"
            ? error.message
            : "Request failed. Check the server setup and try again.",
      },
      502,
    );
  });
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      mode: config.mode,
      agentConfigured: agentConfigured(config),
      browserConfigured: Boolean(config.workerUrl && config.workerToken),
      emailSignIn: accounts.emailSignIn,
    }),
  );
  let loginWindow = 0,
    loginAttempts = 0;
  app.post("/api/session", async (c) => {
    if (Date.now() - loginWindow > 60000) {
      loginWindow = Date.now();
      loginAttempts = 0;
    }
    if (++loginAttempts > 30)
      throw new AppError("Too many sign-in attempts. Try again in a minute.", 429);
    const body = z.object({ accessKey: z.string().optional() }).parse(await c.req.json());
    const session = await auth.session(body.accessKey);
    await workspace.ensureSample(ADMIN_OWNER, actions);
    await agent.ensure(ADMIN_OWNER);
    if (config.mode === "sample") await agent.refreshIdeas(ADMIN_OWNER);
    return c.json(session);
  });
  // Email sign-in: the answer is the same whether or not the address has an account.
  app.post("/api/auth/request", async (c) => {
    const { email } = z.object({ email: z.email().max(320) }).parse(await c.req.json());
    return c.json(await accounts.requestLink(email));
  });
  app.post("/api/auth/verify", async (c) => {
    if (Date.now() - loginWindow > 60000) {
      loginWindow = Date.now();
      loginAttempts = 0;
    }
    if (++loginAttempts > 30)
      throw new AppError("Too many sign-in attempts. Try again in a minute.", 429);
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(await c.req.json());
    const { account, session } = await accounts.verifyLink(token);
    await agent.ensure(account.id);
    return c.json(session);
  });
  // Resend calls this directly; the Svix signature, not a session, authenticates it.
  app.post("/api/inbound/resend", async (c) =>
    c.json(
      await inbox.receive(await c.req.text(), {
        id: c.req.header("svix-id"),
        timestamp: c.req.header("svix-timestamp"),
        signature: c.req.header("svix-signature"),
      }),
    ),
  );
  app.get("/api/google/callback", async (c) => {
    if (c.req.query("error"))
      return c.html("<h1>Google connection cancelled</h1><p>You can return to OpenMuse.</p>", 400);
    const state = c.req.query("state"),
      code = c.req.query("code");
    if (!state || !code) throw new AppError("Google callback is incomplete");
    await google.callback(state, code);
    return c.html(
      "<h1>Google is connected</h1><p>Return to OpenMuse and refresh your workspace.</p>",
    );
  });
  app.use("/api/*", async (c, next) => {
    const signedRoute =
      /^\/api\/files\/[^/]+\/content$|^\/api\/browsers\/[^/]+\/(?:preview|console)$/.test(
        c.req.path,
      );
    const owner =
      signedRoute && c.req.query("signature")
        ? auth.verify(new URL(c.req.url))
        : await auth.owner(c.req.header("authorization"));
    c.set("owner", owner);
    await next();
  });
  app.get("/api/session", (c) => c.json({ mode: config.mode }));
  app.post("/api/auth/signout", async (c) => {
    await auth.revoke(c.req.header("authorization"));
    return c.json({ ok: true });
  });
  app.get("/api/me", async (c) => {
    const me = await accounts.me(c.get("owner"));
    if (!me) throw new AppError("Account not found", 404);
    return c.json({ ...me, emailSignIn: accounts.emailSignIn });
  });
  app.get("/api/accounts", async (c) => {
    if (!(await accounts.isAdmin(c.get("owner"))))
      throw new AppError("Only the admin can manage people", 403);
    return c.json({ emailSignIn: accounts.emailSignIn, accounts: await accounts.list() });
  });
  app.post("/api/accounts", async (c) =>
    c.json(await accounts.invite(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/api/accounts/:id/disable", async (c) =>
    c.json(await accounts.setStatus(c.get("owner"), c.req.param("id"), "disabled")),
  );
  app.post("/api/accounts/:id/enable", async (c) =>
    c.json(await accounts.setStatus(c.get("owner"), c.req.param("id"), "active")),
  );
  app.post("/api/accounts/:id/invite", async (c) =>
    c.json(await accounts.resendInvite(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/workspace", async (c) => {
    const snapshot = await workspace.snapshot(c.get("owner"), c.req.query("q"));
    snapshot.browsers = snapshot.browsers.map((s) => browser.decorate(c.get("owner"), s));
    return c.json(snapshot);
  });
  app.route("/api/agent", agentRoutes(agent));
  app.route("/api/computer", computerRoutes(computer, files));
  app.get("/api/calendars", async (c) => c.json(await workspace.calendars(c.get("owner"))));
  app.get("/api/calendar/events", async (c) => {
    const query = z
      .object({
        calendarId: z.string().min(1).max(1024).optional(),
        timeMin: z.iso.datetime({ offset: true }).optional(),
        timeMax: z.iso.datetime({ offset: true }).optional(),
      })
      .parse(c.req.query());
    if (
      query.timeMin &&
      query.timeMax &&
      (Date.parse(query.timeMax) <= Date.parse(query.timeMin) ||
        Date.parse(query.timeMax) - Date.parse(query.timeMin) > 366 * 86400000)
    )
      throw new AppError("Choose a calendar range between one moment and 366 days", 422);
    return c.json(await workspace.events(c.get("owner"), query));
  });
  app.get("/api/mail/threads/:id", async (c) =>
    c.json(await workspace.thread(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/actions", async (c) => {
    const input = proposalSchema.parse(await c.req.json());
    if (input.kind === "email.send")
      for (const id of input.data.attachmentIds) await files.get(c.get("owner"), id);
    return c.json(await actions.propose(c.get("owner"), input), 201);
  });
  app.post("/api/actions/:id/decide", async (c) => {
    const body = z
      .object({ hash: z.string(), decision: z.enum(["approve", "deny"]) })
      .parse(await c.req.json());
    return c.json(
      await actions.decide(c.get("owner"), c.req.param("id"), body.hash, body.decision),
    );
  });
  app.get("/api/spending", async (c) => c.json(await spending.settings(c.get("owner"))));
  app.post("/api/spending", async (c) =>
    c.json(await spending.update(c.get("owner"), await c.req.json())),
  );
  app.get("/api/feed", async (c) => c.json(await feed.get(c.get("owner"))));
  app.post("/api/feed/topics", async (c) =>
    c.json(await feed.setTopics(c.get("owner"), await c.req.json())),
  );
  app.post("/api/feed/refresh", async (c) => c.json(await feed.refreshNow(c.get("owner"))));
  app.get("/api/agent-email", async (c) => c.json(await inbox.settings(c.get("owner"))));
  app.post("/api/agent-email", async (c) =>
    c.json(await inbox.updateSettings(c.get("owner"), await c.req.json())),
  );
  app.get("/api/push/key", (c) => c.json({ publicKey: push.publicKey }));
  app.post("/api/push/subscribe", async (c) =>
    c.json(await push.subscribe(c.get("owner"), await c.req.json())),
  );
  app.post("/api/push/unsubscribe", async (c) => {
    const { endpoint } = z.object({ endpoint: z.string().max(2048) }).parse(await c.req.json());
    return c.json(await push.unsubscribe(c.get("owner"), endpoint));
  });
  app.get("/api/apps", async (c) =>
    c.json(
      apps
        ? { configured: true, apps: await apps.connections(c.get("owner")) }
        : { configured: false, apps: [] },
    ),
  );
  app.get("/api/apps/directory", async (c) => {
    if (!apps) return c.json({ configured: false, apps: [] });
    return c.json({
      configured: true,
      apps: await apps.directory(c.get("owner"), c.req.query("q")),
    });
  });
  app.post("/api/apps/disconnect", async (c) => {
    if (!apps) throw new AppError("Connected apps are not configured on this server", 409);
    const { app: slug } = z
      .object({ app: z.string().trim().min(1).max(100) })
      .parse(await c.req.json());
    await apps.disconnect(c.get("owner"), slug);
    return c.json({ ok: true });
  });
  app.post("/api/apps/connect", async (c) => {
    if (!apps) throw new AppError("Connected apps are not configured on this server", 409);
    const { app: slug } = z
      .object({ app: z.string().trim().min(1).max(100) })
      .parse(await c.req.json());
    return c.json(await apps.connect(c.get("owner"), slug));
  });
  app.get("/api/drafts", async (c) => c.json(await db.list(c.get("owner"), "drafts")));
  app.post("/api/drafts", async (c) => {
    const body = emailDraftSchema.extend({ id: z.string().optional() }).parse(await c.req.json());
    const existing = body.id
      ? await db.get<{ createdAt: string }>(c.get("owner"), "drafts", body.id)
      : null;
    if (body.id && !existing) throw new AppError("Draft not found", 404);
    return c.json(
      await db.put(c.get("owner"), "drafts", {
        ...body,
        id: body.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      }),
      201,
    );
  });
  app.get("/api/main-thread", async (c) => {
    const owner = c.get("owner");
    await db.insertIfAbsent(owner, "conversation-settings", {
      id: "main",
      threadId: randomUUID(),
      existing: false,
    });
    const main = await db.get<{ threadId: string }>(owner, "conversation-settings", "main");
    if (!main) throw new AppError("Main conversation could not be loaded", 503);
    try {
      await threads.getOrCreateThread({
        threadId: main.threadId,
        userId: owner,
        agentId: "default",
      });
    } catch {
      throw new AppError(
        "Main conversation is unavailable. Check the Rich Threads connection and try again.",
        502,
      );
    }
    return c.json({ threadId: main.threadId, existing: true });
  });
  // Starts the main chat over; the old conversation is deleted.
  app.post("/api/main-thread/reset", async (c) => {
    const owner = c.get("owner");
    const old = await db.get<{ threadId: string }>(owner, "conversation-settings", "main");
    await db.put(owner, "conversation-settings", {
      id: "main",
      threadId: randomUUID(),
      existing: false,
    });
    await db.put(owner, "conversations", { id: "default", messages: [] });
    if (old)
      await threads
        .deleteThread({ threadId: old.threadId, userId: owner, agentId: "default" })
        .catch(() => console.warn("[OpenMuse] Could not delete the previous main conversation"));
    return c.json({ ok: true });
  });
  app.get("/api/conversation", async (c) =>
    c.json((await db.get(c.get("owner"), "conversations", "default")) ?? { messages: [] }),
  );
  app.put("/api/conversation", async (c) => {
    const body = await c.req.json();
    const messages = z.array(z.unknown()).max(1000).parse(body.messages);
    for (const message of messages) MessageSchema.parse(message);
    await db.put(c.get("owner"), "conversations", { id: "default", messages });
    return c.json({ ok: true });
  });
  app.post("/api/files", async (c) => {
    const data = await c.req.parseBody();
    const file = data.file;
    if (!(file instanceof File)) throw new AppError("Choose a file");
    return c.json(
      await files.import(
        c.get("owner"),
        file.name,
        new Uint8Array(await file.arrayBuffer()),
        "Uploaded by you",
      ),
      201,
    );
  });
  app.get("/api/files/:id/content", async (c) => {
    const file = await files.get(c.get("owner"), c.req.param("id"));
    // PDFs and pictures open in the browser; Office, CSV and text files download.
    const inline = /^(application\/pdf|image\/)/.test(file.mimeType);
    c.header("Content-Type", file.mimeType);
    c.header(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    return c.body(await files.bytes(c.get("owner"), file.id));
  });
  app.get("/api/files/:id/text", async (c) =>
    c.json(await files.read(c.get("owner"), c.req.param("id"), 1, 20000)),
  );
  app.post("/api/files/:id/fill", async (c) => {
    const body = z
      .object({ fields: z.record(z.string(), z.union([z.string(), z.boolean()])) })
      .parse(await c.req.json());
    return c.json(await files.fill(c.get("owner"), c.req.param("id"), body.fields), 201);
  });
  app.post("/api/mail/import-attachment", async (c) => {
    const body = z.object({ reference: z.string() }).parse(await c.req.json());
    return c.json(await workspace.importAttachment(c.get("owner"), body.reference), 201);
  });
  app.post("/api/google/connect", async (c) => {
    const body = z.object({ capability: z.enum(["read", "write"]) }).parse(await c.req.json());
    if (config.mode === "sample") {
      await db.put(c.get("owner"), "settings", {
        id: "google",
        enabled: true,
        connectionId: randomUUID(),
      });
      return c.json({ url: null, connected: true });
    }
    return c.json(await google.connect(c.get("owner"), body.capability === "write"));
  });
  app.post("/api/google/disconnect", async (c) => {
    if (config.mode === "sample")
      await db.put(c.get("owner"), "settings", { id: "google", enabled: false });
    else await google.disconnect(c.get("owner"));
    return c.json({ ok: true });
  });
  app.post("/api/browsers", async (c) => {
    const body = z.object({ url: z.url().max(4096) }).parse(await c.req.json());
    return c.json(await browser.create(c.get("owner"), body.url), 201);
  });
  app.get("/api/browsers/:id", async (c) => {
    const owner = c.get("owner");
    return c.json(browser.decorate(owner, await browser.get(owner, c.req.param("id"))));
  });
  app.post("/api/browsers/:id/navigate", async (c) => {
    const body = z.object({ url: z.url().max(4096) }).parse(await c.req.json());
    return c.json(await browser.navigate(c.get("owner"), c.req.param("id"), body.url));
  });
  app.post("/api/browsers/:id/close", async (c) =>
    c.json(await browser.close(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/browsers/:id/read", async (c) =>
    c.json(await browser.read(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/browsers/:id/reopen", async (c) => {
    const raw = await c.req.text();
    const body = z.object({ url: z.url().max(4096).optional() }).parse(raw ? JSON.parse(raw) : {});
    return c.json(await browser.reopen(c.get("owner"), c.req.param("id"), body.url));
  });
  app.post("/api/browsers/:id/import-downloads", async (c) =>
    c.json(await browser.imports(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/browsers/:id/preview", async (c) => {
    const response = await browser.preview(c.get("owner"), c.req.param("id"));
    c.header("Content-Type", "image/png");
    return c.body(await response.arrayBuffer());
  });
  app.get("/api/browsers/:id/console", async (c) => {
    await browser.get(c.get("owner"), c.req.param("id"));
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
    );
    return c.html(browser.console(c.get("owner"), c.req.param("id")));
  });
  app.post("/api/browsers/:id/console", async (c) => {
    await browser.input(c.get("owner"), c.req.param("id"), await c.req.json());
    return c.json({ ok: true });
  });
  app.all("/api/copilotkit/*", async (c) => {
    if (!agentConfigured(config))
      throw new AppError(
        "Configure a model and provider API key, or a valid AG-UI endpoint, to start chat",
        503,
      );
    const response = await runtime.fetch(c.req.raw);
    // Runtime 1.70 emits SSE strings; a WHATWG Response body requires byte chunks.
    const encoder = new TextEncoder();
    const body = response.body?.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        },
      }),
    );
    return new Response(body, { status: response.status, headers: response.headers });
  });
  app.get("/", (c) =>
    c.json({ name: "OpenMuse", app: "http://localhost:8081", health: "/api/health" }),
  );
  return { app, auth, accounts, files, actions, workspace, agent, computer };
}
