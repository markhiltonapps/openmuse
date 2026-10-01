import { randomUUID } from "node:crypto";
import { MessageSchema } from "@ag-ui/core";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";
import { ownWords } from "../../../packages/domain/src/chat-export.ts";
import { emailDraftSchema, proposalSchema } from "../../../packages/domain/src/index.ts";
import { AccessRequests } from "./access-requests.ts";
import { AccountService, type Mailer, ResendMailer } from "./accounts.ts";
import { ActionService } from "./actions.ts";
import { agentConfigured, makeRuntime } from "./agent.ts";
import { AppEvents } from "./app-events.ts";
import { ApprovalRules } from "./approval-rules.ts";
import { type AppConnector, ComposioConnector } from "./apps.ts";
import { Areas, nominatimPlaces } from "./area.ts";
import { ADMIN_OWNER, createAuth } from "./auth.ts";
import { AvatarMedia } from "./avatar-media.ts";
import { Backups } from "./backups.ts";
import { type Blobs, createBlobs } from "./blobs.ts";
import { BrowserService } from "./browser.ts";
import { runApprovedStep } from "./browser-tools.ts";
import { CalendarToday, MAX_RANGE_DAYS } from "./calendar-today.ts";
import { ChatArchive } from "./chat-archive.ts";
import { CodeSandbox } from "./code-sandbox.ts";
import { Commitments } from "./commitments.ts";
import { ComputerService, type DockerRunner } from "./computer.ts";
import { computerRoutes } from "./computer-routes.ts";
import { assertApiDeploymentConfig, type Config } from "./config.ts";
import { DataControls, type ThreadStore } from "./data-controls.ts";
import type { Store } from "./db.ts";
import { emojiPicture } from "./emoji.ts";
import { ConversationAgent, localNow } from "./engine/conversation.ts";
import { agentRoutes } from "./engine/routes.ts";
import { AgentService } from "./engine/service.ts";
import { AppError } from "./errors.ts";
import { FamilyWeeks } from "./family-weeks.ts";
import { FeedService } from "./feed.ts";
import { FileShares } from "./file-shares.ts";
import { Files } from "./files.ts";
import { GoogleAuth } from "./google-auth.ts";
import { HealthService } from "./health.ts";
import { AgentInbox } from "./inbound.ts";
import { backgroundFailure } from "./log.ts";
import { MAIL_APPS, MailAlerts } from "./mail-alerts.ts";
import { CombinedApps, McpApps, signedInPage, signInFailedPage } from "./mcp-apps.ts";
import { MealCheckIns } from "./meal-checkins.ts";
import {
  chatgptMessages,
  extractMemories,
  listedMemories,
  recentHistory,
} from "./memory-import.ts";
import { appDocument, goneDocument, MINI_APP_HEADER_POLICY } from "./mini-apps.ts";
import { monitorChecks } from "./monitor-history.ts";
import { PastChats } from "./past-chats.ts";
import { PushService } from "./push.ts";
import { RecipeKitchen, writeRecipes } from "./recipe-writer.ts";
import { ReminderService } from "./reminders.ts";
import { nominatim } from "./rich-cards.ts";
import { Logins } from "./sign-in.ts";
import { cleanCode, runApprovedSignIn } from "./sign-in-tools.ts";
import { SocialWeeks } from "./social-weeks.ts";
import { ScheduledPosts } from "./space-posts.ts";
import { spaceRoutes } from "./space-routes.ts";
import { Spaces } from "./spaces.ts";
import { isPurchase, SpendingService } from "./spending.ts";
import { UsageMeter } from "./usage.ts";
import { lookAtImage } from "./vision.ts";
import { type VoiceBrain, voiceAnswer, voiceToday } from "./voice-brain.ts";
import { LiveVoice, liveInstructions } from "./voice-live.ts";
import { WeatherService } from "./weather.ts";
import { downloadToFiles } from "./web-download.ts";
import { AnthropicWebSearch, type WebSearch } from "./web-search.ts";
import { WorkspaceService } from "./workspace.ts";

export async function createApp(
  db: Store,
  config: Config,
  options: {
    docker?: DockerRunner;
    apps?: AppConnector;
    /** The person's own apps (MCP servers); tests pass one that may reach a local server. */
    mcp?: McpApps;
    mailer?: Mailer;
    search?: WebSearch;
    intelligence?: Pick<CopilotKitIntelligence, "getOrCreateThread" | "deleteThread"> & ThreadStore;
    /** Where file contents live; the bucket when configured, else the data folder. */
    blobs?: Blobs;
  } = {},
) {
  assertApiDeploymentConfig(config);
  const blobs = options.blobs ?? createBlobs(config);
  const auth = await createAuth(db, config);
  const mailer =
    options.mailer ??
    (config.resendApiKey && config.authEmailFrom
      ? new ResendMailer(config.resendApiKey, config.authEmailFrom)
      : undefined);
  const accounts = new AccountService(db, config, auth, mailer);
  await accounts.bootstrap();
  const files = new Files(db, config, auth, blobs),
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
  // The person's own apps join Composio's for the agent, approvals and the Apps list.
  const mcp = options.mcp ?? new McpApps(db, config);
  const connected: AppConnector | undefined =
    apps || options.mcp || config.encryptionKey ? new CombinedApps(apps, mcp) : undefined;
  const spending = new SpendingService(db);
  const logins = new Logins(db, config.encryptionKey);
  const actions = new ActionService(db, {
    authorize: async (owner, input, approval) => {
      // A code the person types is checked before the approval is used up.
      if (
        input.kind === "browser.signin" &&
        input.data.step === "code" &&
        !input.data.savedCode &&
        !cleanCode(approval?.code)
      )
        throw new AppError(
          "That code doesn’t look right. Check the code the site sent you and type it again.",
          400,
        );
      if (input.kind !== "app.action" || !isPurchase(input.data.tool)) return;
      const problem = await spending.check(owner, input.data.amountUsd);
      if (problem) throw new AppError(problem, 409);
    },
    execute: async (
      owner,
      input,
      connectionId,
      targetVersion,
      approval,
      actionId,
    ): Promise<string> => {
      if (input.kind === "agent_email.send") return inbox.send(owner, input.data);
      if (input.kind === "browser.step") return runApprovedStep(browser, owner, input.data);
      if (input.kind === "browser.signin")
        return runApprovedSignIn(browser, logins, owner, input.data, approval?.code);
      if (input.kind !== "app.action")
        return workspace.execute(owner, input, connectionId, targetVersion);
      if (!connected) throw new AppError("Connected apps are not configured on this server", 409);
      const data = await connected.execute(owner, input.data.tool, input.data.arguments);
      // A meeting added or moved shows on the Feed's day card straight away.
      if (/calendar|outlook/i.test(input.data.app)) calendarToday.forget(owner);
      if (isPurchase(input.data.tool) && input.data.amountUsd)
        await spending.record(owner, actionId ?? "", input.data.amountUsd);
      const detail = data === undefined ? "" : JSON.stringify(data).slice(0, 300);
      return `Done in ${input.data.app} · ${input.data.tool}${detail ? ` · ${detail}` : ""}`;
    },
    prepare: (owner, input, connectionId) => workspace.prepare(owner, input, connectionId),
    connected: (owner) => workspace.connected(owner),
    connection: (owner) => workspace.connection(owner),
  });
  const browser = new BrowserService(db, config, auth, files);
  const computer = new ComputerService(db, config, options.docker);
  const agent = new AgentService(
    db,
    config,
    workspace,
    files,
    actions,
    browser,
    computer,
    connected,
  );
  const push = await PushService.create(db, config);
  agent.push = push;
  // Emails about jobs a person handed off go to their account's own address.
  if (mailer)
    agent.jobMail = {
      send: (message) => mailer.send(message),
      appUrl: (config.appUrl ?? config.publicUrl).replace(/\/$/, ""),
      to: async (owner) => (await accounts.get(owner))?.email,
    };
  agent.spending = spending;
  // Direct Claude calls for pictures and for reading imported history.
  const claude =
    config.agentBackend === "model" && config.anthropicApiKey
      ? {
          apiKey: config.anthropicApiKey,
          model:
            process.env.VISION_MODEL?.trim() ||
            /^anthropic[/:](.+)$/.exec(config.model ?? "")?.[1] ||
            "claude-sonnet-5",
          baseUrl: process.env.ANTHROPIC_BASE_URL,
        }
      : undefined;
  const usage = new UsageMeter(db);
  agent.usage = usage;
  if (claude)
    agent.look = (image, question, owner) =>
      lookAtImage(image, question, {
        ...claude,
        onUsage: owner ? usage.sink(owner, "pictures") : undefined,
      });
  agent.search =
    options.search ??
    (config.agentBackend === "model" && config.anthropicApiKey
      ? new AnthropicWebSearch(config.anthropicApiKey, {
          model: config.webSearchModel,
          baseUrl: process.env.ANTHROPIC_BASE_URL,
        })
      : undefined);
  // A private sandbox for code and file work, on the same Anthropic key as web search.
  if (config.agentBackend === "model" && config.anthropicApiKey)
    agent.sandbox = new CodeSandbox(db, files, config.anthropicApiKey, {
      model: config.codeModel,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
    });
  const mailAlerts = apps
    ? new MailAlerts(db, apps, config.composioWebhookSecret, agent, {
        url: `${config.publicUrl.replace(/\/+$/, "")}/api/webhooks/composio`,
        encryptionKey: config.encryptionKey,
      })
    : undefined;
  agent.mailAlerts = mailAlerts;
  const appEvents = new AppEvents(
    db,
    apps,
    agent,
    () => mailAlerts?.ready() ?? Promise.resolve(false),
  );
  if (mailAlerts) mailAlerts.others = (id, data, key) => appEvents.handle(id, data, key);
  agent.appEvents = appEvents;
  // A live server tells Composio where to send new-email events as soon as it starts.
  if (mailAlerts && config.mode === "live" && /^https:/.test(config.publicUrl))
    void mailAlerts.setUp();
  // The family board's recipes, written on their own after a week is planned.
  if (claude)
    agent.recipes = new RecipeKitchen(
      db,
      (request, onUsage) => writeRecipes(request, { ...claude, search: agent.search, onUsage }),
      (owner) => usage.sink(owner, "recipes"),
    );
  const feed = new FeedService(db, agent.search, (owner) => agent.timeZone(owner));
  const calendarToday = new CalendarToday(apps, (owner) => agent.timeZone(owner));
  agent.persona.accountName = async (owner) => (await accounts.get(owner))?.name;
  // Live voice: the admin only, while it's being tried out.
  // Live voice's brain: the same chat agent and tools answer what the voice hands over.
  const canLookUp = config.agentBackend !== "agui";
  const voiceBrain: VoiceBrain = {
    db,
    run: (owner, input) => new ConversationAgent(config, agent, owner).run(input),
    timeZone: (owner) => agent.timeZone(owner),
    name: async (owner) =>
      (
        await db.get<{ name?: string }>(owner, "agent-settings", "identity").catch(() => null)
      )?.name?.trim() || "Neddy",
    health: async (owner) => (await health.summary(owner)).entries,
    calendar: async (owner) => (await calendarToday.today(owner)).events,
    reminders: async (owner) => (await reminders.list(owner)).upcoming,
    // The main chat as the app last saved it (or the older single conversation).
    chat: async (owner) => {
      const main = await db.get<{ threadId: string }>(owner, "conversation-settings", "main");
      if (main?.threadId) return archive.messages(owner, main.threadId);
      return (
        (await db.get<{ messages?: unknown[] }>(owner, "conversations", "default"))?.messages ?? []
      );
    },
    notify: (owner, title, body, key, actionId) =>
      agent.notify(owner, title, body, undefined, key, actionId ? { actionId } : {}),
  };
  const liveVoice = new LiveVoice(
    db,
    async (owner) => {
      const [identity, timeZone, about, memories, today] = await Promise.all([
        db
          .get<{ name?: string; tone?: string }>(owner, "agent-settings", "identity")
          .catch(() => null),
        agent.timeZone(owner).catch(() => "UTC"),
        agent.persona.context(owner).catch(() => ""),
        agent.memoryContext(owner).catch(() => [] as string[]),
        voiceToday(voiceBrain, owner).catch(() => ""),
      ]);
      return {
        instructions: liveInstructions({
          name: identity?.name?.trim() || "Neddy",
          tone: identity?.tone?.trim() || "warm",
          now: localNow(timeZone),
          about,
          memories: memories.slice(0, 30),
          today,
          canLookUp,
        }),
      };
    },
    (owner) => accounts.isAdmin(owner),
    usage,
    {
      apiKey: config.voiceApiKey,
      model: config.voiceModel,
      voice: config.voiceName,
      idleSeconds: config.voiceIdleSeconds,
      setupUrl: config.railwayVariablesUrl,
      ...(canLookUp ? { answer: voiceAnswer(voiceBrain) } : {}),
      tell: (owner, title, body, key) => agent.notify(owner, title, body, undefined, key),
    },
  );
  agent.areas = new Areas(
    db,
    config.mode === "live"
      ? nominatimPlaces(
          `Neato_Muse/1.0 (+${config.publicUrl.replace(/\/+$/, "")}; home area for local news)`,
        )
      : undefined,
  );
  feed.where = (owner) => agent.searchPlace(owner);
  // A new area means new local news: look it up now rather than tomorrow morning.
  agent.areaChanged = (owner) => void feed.refresh(owner).catch(() => undefined);
  feed.usage = (owner) => usage.sink(owner, "feed");
  agent.feed = feed;
  const health = new HealthService(db, (owner) => agent.timeZone(owner));
  agent.health = health;
  const checkIns = new MealCheckIns(
    db,
    health,
    (owner) => agent.timeZone(owner),
    async (owner, note) => {
      await agent.notify(owner, note.title, note.body, undefined, note.key, { checkInId: note.id });
    },
  );
  health.onMeal = (owner, entry) => checkIns.mealLogged(owner, entry);
  agent.checkIns = checkIns;
  agent.backups = new Backups(db, blobs);
  void checkIns
    .adoptMealRoutines()
    // Their old questions still waiting for an answer are closed: check-ins ask now.
    .then(() => checkIns.replacedAsks())
    .then(async (asks) => {
      for (const { owner, taskId } of asks)
        await agent
          .control(owner, taskId, "cancel")
          .catch((error) => backgroundFailure("closing a replaced meal question", error));
    })
    .catch((error) => backgroundFailure("meal check-ins from routines", error));
  const reminders = new ReminderService(
    db,
    (owner) => agent.timeZone(owner),
    async (owner, reminder) => {
      await agent.notify(owner, reminder.title, reminder.body, undefined, reminder.key, {
        reminderId: reminder.id,
      });
    },
  );
  agent.reminders = reminders;
  const spacePosts = new ScheduledPosts(db, connected, (owner, title, body, key) =>
    agent.notify(owner, title, body, undefined, key),
  );
  agent.spacePosts = spacePosts;
  // "Request access" on the sign-in screen; the admin hears about it and decides.
  const accessRequests = new AccessRequests(db, accounts, (owner, title, body, key) =>
    agent.notify(owner, title, body, undefined, key),
  );
  const commitments = new Commitments(
    db,
    (owner) => agent.timeZone(owner),
    (owner, note) => agent.notify(owner, note.title, note.body, undefined, note.key),
  );
  agent.commitments = commitments;
  const approvals = new ApprovalRules(db);
  agent.approvals = approvals;
  agent.logins = logins;
  if (config.mode === "live")
    agent.geocode = nominatim(
      db,
      `Neato_Muse/1.0 (+${config.publicUrl.replace(/\/+$/, "")}; personal assistant maps)`,
    );
  // The home city's weather on the Feed and for the agent (US cities only).
  if (agent.areas)
    agent.weather = new WeatherService({
      areas: agent.areas,
      geocode: agent.geocode,
      userAgent: `Neato_Muse/1.0 (+${config.publicUrl.replace(/\/+$/, "")}; home city weather)`,
    });
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
  app.post("/api/auth/request-access", async (c) =>
    c.json(await accessRequests.request(await c.req.json())),
  );
  // The 6-digit code from the same email, typed in instead of opening the link.
  app.post("/api/auth/code", async (c) => {
    if (Date.now() - loginWindow > 60000) {
      loginWindow = Date.now();
      loginAttempts = 0;
    }
    if (++loginAttempts > 30)
      throw new AppError("Too many sign-in attempts. Try again in a minute.", 429);
    const { email, code } = z
      .object({ email: z.email().max(320), code: z.string().trim().min(6).max(12) })
      .parse(await c.req.json());
    const { account, session } = await accounts.verifyCode(email, code);
    await agent.ensure(account.id);
    return c.json(session);
  });
  // Composio reports new email here; its webhook signature, not a session, authenticates it.
  app.post("/api/webhooks/composio", async (c) => {
    if (!mailAlerts) throw new AppError("Connected apps aren't set up", 503);
    return c.json(
      await mailAlerts.receive(await c.req.text(), {
        id: c.req.header("webhook-id") ?? c.req.header("svix-id"),
        timestamp: c.req.header("webhook-timestamp") ?? c.req.header("svix-timestamp"),
        signature: c.req.header("webhook-signature") ?? c.req.header("svix-signature"),
      }),
    );
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
      return c.html(
        "<h1>Google connection cancelled</h1><p>You can return to Neato_Muse.</p>",
        400,
      );
    const state = c.req.query("state"),
      code = c.req.query("code");
    if (!state || !code) throw new AppError("Google callback is incomplete");
    await google.callback(state, code);
    return c.html(
      "<h1>Google is connected</h1><p>Return to Neato_Muse and refresh your workspace.</p>",
    );
  });
  // The person's own apps send them back here after they sign in on the app's own page.
  app.get("/api/mcp/callback", async (c) => {
    const state = c.req.query("state"),
      code = c.req.query("code");
    if (c.req.query("error") || !state || !code)
      return c.html(
        signInFailedPage(
          (c.req.query("error_description") ?? "The sign-in was cancelled.").slice(0, 200),
        ),
        400,
      );
    try {
      return c.html(signedInPage((await mcp.finish(state, code)).name));
    } catch (error) {
      console.warn(
        `[OpenMuse] Own app sign-in failed: ${error instanceof Error ? error.message : error}`,
      );
      return c.html(
        signInFailedPage(
          error instanceof AppError ? error.message : "The app didn't accept the sign-in.",
        ),
        400,
      );
    }
  });
  // Sign-in servers that take a published client description read it here.
  app.get("/api/mcp/client", (c) => c.json(mcp.clientDocument()));
  // 3D emoji pictures, shared by everyone and loaded by <img> without a sign-in header.
  app.get("/api/emoji/:code", async (c) => {
    const bytes = await emojiPicture(c.req.param("code").replace(/\.webp$/, ""));
    if (!bytes) throw new AppError("Emoji not found", 404);
    return c.body(new Uint8Array(bytes).buffer as ArrayBuffer, 200, {
      "content-type": "image/webp",
      "cache-control": "public, max-age=2592000, immutable",
    });
  });
  // Share links: anyone with the link opens that one file until the link expires or is stopped.
  const shares = new FileShares(db, files, config.publicUrl);
  app.get("/api/share/:token", async (c) => {
    const opened = await shares.open(c.req.param("token")).catch((error: unknown) => error);
    if (opened instanceof AppError)
      return c.html(goneDocument(opened.message), 404, { "x-robots-tag": "noindex, nofollow" });
    if (opened instanceof Error) throw opened;
    const { file, bytes } = opened as Awaited<ReturnType<typeof shares.open>>;
    const inline = /^(application\/pdf|image\/)/.test(file.mimeType);
    return c.body(new Uint8Array(bytes).buffer as ArrayBuffer, 200, {
      "content-type": file.mimeType,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    });
  });
  // Mini apps opened from a link: sandboxed, no network requests, the latest version.
  app.get("/api/mini/:token", async (c) => {
    const found = await agent.miniApps.open(c.req.param("token")).catch((error: unknown) => error);
    if (found instanceof AppError)
      return c.html(goneDocument(found.message), 404, { "x-robots-tag": "noindex, nofollow" });
    if (found instanceof Error) throw found;
    return c.html(appDocument(found as Awaited<ReturnType<typeof agent.miniApps.open>>), 200, {
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
      "content-security-policy": MINI_APP_HEADER_POLICY,
    });
  });
  // Animated avatars are shared pictures and clips, loaded by <video> without a sign-in header.
  const avatarMedia = new AvatarMedia(blobs);
  app.get("/api/avatar-media/:preset/:part", async (c) => {
    const file = await avatarMedia.file(c.req.param("preset"), c.req.param("part"));
    const { status, bytes, contentRange } = await avatarMedia.read(
      file.key,
      file.size,
      c.req.header("range"),
    );
    return c.body(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer,
      status,
      {
        "content-type": file.type,
        "accept-ranges": "bytes",
        "cache-control": "public, max-age=86400",
        ...(contentRange ? { "content-range": contentRange } : {}),
        ...(status === 416 ? { "content-range": `bytes */${file.size}` } : {}),
      },
    );
  });
  app.use("/api/*", async (c, next) => {
    const signedRoute =
      /^\/api\/files\/[^/]+\/content$|^\/api\/browsers\/[^/]+\/(?:preview|console)$|^\/api\/account\/export$/.test(
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
  // New-email alerts and "when X emails me, do Y" rules.
  const alerts = () => {
    if (!mailAlerts) throw new AppError("Connected apps aren't set up on the server", 503);
    return mailAlerts;
  };
  app.get("/api/mail-alerts", async (c) => c.json(await alerts().status(c.get("owner"))));
  app.post("/api/mail-alerts/watch", async (c) => {
    const { app: mail, enabled } = z
      .object({ app: z.enum(MAIL_APPS), enabled: z.boolean() })
      .parse(await c.req.json());
    return c.json(await alerts().watch(c.get("owner"), mail, enabled));
  });
  app.post("/api/mail-alerts/notify", async (c) => {
    const { notify } = z.object({ notify: z.unknown() }).parse(await c.req.json());
    return c.json(await alerts().setNotify(c.get("owner"), notify));
  });
  app.post("/api/mail-alerts/rules", async (c) =>
    c.json(await alerts().addRule(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/api/mail-alerts/rules/:id/delete", async (c) =>
    c.json(await alerts().removeRule(c.get("owner"), c.req.param("id"))),
  );
  // Model usage and its estimated cost: your own, and everyone's for the admin.
  app.get("/api/usage", async (c) => {
    const owner = c.get("owner");
    const month = z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .parse(c.req.query("month"));
    return c.json({
      ...(await usage.month(owner, month)),
      history: await usage.history(owner),
      models: { chat: config.model, background: config.workerModel ?? config.model },
    });
  });
  app.get("/api/usage/people", async (c) => {
    if (!(await accounts.isAdmin(c.get("owner"))))
      throw new AppError("Only the admin can see everyone's usage", 403);
    const month = z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .parse(c.req.query("month"));
    const listed = (await accounts.list()).map((account) => ({
      id: account.id,
      name: account.name,
      email: account.email as string | undefined,
    }));
    // The access key signs in as the admin workspace, which has no account without ADMIN_EMAIL.
    const people = listed.some((person) => person.id === ADMIN_OWNER)
      ? listed
      : [{ id: ADMIN_OWNER, name: "Admin", email: undefined }, ...listed];
    const rows = await Promise.all(
      people.map(async (person) => {
        const { month: shown, cost, calls, voiceMinutes } = await usage.month(person.id, month);
        return { ...person, month: shown, cost, calls, voiceMinutes };
      }),
    );
    return c.json({
      month: rows[0]?.month,
      people: rows.filter((row) => row.calls > 0 || row.id !== ADMIN_OWNER),
      cost: rows.reduce((sum, row) => sum + row.cost, 0),
    });
  });
  app.get("/api/accounts", async (c) => {
    if (!(await accounts.isAdmin(c.get("owner"))))
      throw new AppError("Only the admin can manage people", 403);
    return c.json({
      emailSignIn: accounts.emailSignIn,
      accounts: await accounts.list(),
      requests: await accessRequests.list(c.get("owner")),
    });
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
  app.post("/api/accounts/requests/:id/approve", async (c) =>
    c.json(
      await accessRequests.approve(
        c.get("owner"),
        c.req.param("id"),
        await c.req.json().catch(() => ({})),
      ),
      201,
    ),
  );
  app.post("/api/accounts/requests/:id/decline", async (c) =>
    c.json(await accessRequests.decline(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/workspace", async (c) => {
    const [snapshot, reachable] = await Promise.all([
      workspace.snapshot(c.get("owner"), c.req.query("q")),
      browser.reachable(),
    ]);
    snapshot.browsers = snapshot.browsers.map((s) => browser.decorate(c.get("owner"), s));
    // A configured worker that does not answer is offline, not ready.
    snapshot.connections = snapshot.connections.map((connection) =>
      connection.id === "browser" && connection.status === "connected" && !reachable
        ? { ...connection, status: "unavailable" }
        : connection,
    );
    return c.json(snapshot);
  });
  app.route("/api/agent", agentRoutes(agent));
  // A watched page's last checks, for its chart and table.
  app.get("/api/monitors/:id/checks", async (c) =>
    c.json({ checks: await monitorChecks(db, c.get("owner"), c.req.param("id")) }),
  );
  app.route(
    "/api/spaces",
    spaceRoutes(
      new Spaces(db),
      agent,
      spacePosts,
      {
        deleteThread: async (owner, threadId) => {
          await db.remove(owner, "chat-archive", threadId);
          await threads.deleteThread({ threadId, userId: owner, agentId: "default" });
        },
      },
      {
        weeks: new FamilyWeeks(db),
        results: new SocialWeeks(db),
        recipes: () => agent.recipes,
        timeZone: (owner) => agent.timeZone(owner),
        health,
      },
    ),
  );
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
      .object({
        hash: z.string(),
        decision: z.enum(["approve", "deny"]),
        code: z.string().max(40).optional(),
      })
      .parse(await c.req.json());
    return c.json(
      await actions.decide(c.get("owner"), c.req.param("id"), body.hash, body.decision, {
        ...(body.code ? { code: body.code } : {}),
      }),
    );
  });
  app.get("/api/spending", async (c) => c.json(await spending.settings(c.get("owner"))));
  app.post("/api/spending", async (c) =>
    c.json(await spending.update(c.get("owner"), await c.req.json())),
  );
  app.get("/api/spending/purchases", async (c) => c.json(await spending.purchases(c.get("owner"))));
  app.get("/api/health-log", async (c) => c.json(await health.summary(c.get("owner"))));
  app.post("/api/health-log/meals", async (c) =>
    c.json(await health.logMeal(c.get("owner"), await c.req.json()), 201),
  );
  app.get("/api/approval-rules", async (c) => c.json(await approvals.list(c.get("owner"))));
  app.post("/api/approval-rules", async (c) =>
    c.json(await approvals.add(c.get("owner"), await c.req.json()), 201),
  );
  app.get("/api/app-permissions", async (c) =>
    c.json({ readOnly: await approvals.readOnlyApps(c.get("owner")) }),
  );
  app.post("/api/app-permissions", async (c) =>
    c.json(await approvals.setReadOnly(c.get("owner"), await c.req.json())),
  );
  app.post("/api/approval-rules/:id/delete", async (c) =>
    c.json(await approvals.remove(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/reminders", async (c) => c.json(await reminders.list(c.get("owner"))));
  app.get("/api/commitments", async (c) =>
    c.json({ commitments: await commitments.list(c.get("owner"), c.req.query("all") === "1") }),
  );
  app.post("/api/commitments/:id", async (c) =>
    c.json(
      await commitments.change(c.get("owner"), {
        ...(await c.req.json()),
        id: c.req.param("id"),
      }),
    ),
  );
  app.post("/api/commitments/:id/delete", async (c) =>
    c.json(await commitments.remove(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/reminders/:id/cancel", async (c) =>
    c.json(await reminders.cancel(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/reminders/:id/snooze", async (c) => {
    const { minutes } = z
      .object({ minutes: z.number().int().min(1).max(1440).default(10) })
      .parse(await c.req.json().catch(() => ({})));
    return c.json(await reminders.snooze(c.get("owner"), c.req.param("id"), minutes));
  });
  app.post("/api/health-log/:id/delete", async (c) =>
    c.json(await health.remove(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/health-log/:id", async (c) =>
    c.json(await health.changeMeal(c.get("owner"), c.req.param("id"), await c.req.json())),
  );
  app.get("/api/food-log", async (c) => {
    const days = z.coerce.number().int().min(1).max(366).catch(30).parse(c.req.query("days"));
    return c.json(await health.history(c.get("owner"), days));
  });
  app.get("/api/meal-checkins", async (c) => {
    const owner = c.get("owner");
    return c.json({
      settings: await checkIns.settings(owner),
      replaced: await checkIns.replaced(owner),
      ...(await checkIns.current(owner)),
    });
  });
  app.post("/api/meal-checkins/settings", async (c) =>
    c.json(await checkIns.update(c.get("owner"), await c.req.json())),
  );
  const checkInId = (id: string) =>
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}:(breakfast|lunch|dinner)$/)
      .parse(id);
  app.post("/api/meal-checkins/:id/answer", async (c) =>
    c.json(await checkIns.answer(c.get("owner"), checkInId(c.req.param("id")))),
  );
  app.post("/api/meal-checkins/:id/skip", async (c) =>
    c.json(await checkIns.skip(c.get("owner"), checkInId(c.req.param("id")))),
  );
  app.post("/api/meal-checkins/:id/snooze", async (c) =>
    c.json(await checkIns.snooze(c.get("owner"), checkInId(c.req.param("id")))),
  );
  app.post("/api/meal-checkins/:id/same", async (c) =>
    c.json(await checkIns.sameAsYesterday(c.get("owner"), checkInId(c.req.param("id"))), 201),
  );
  app.post("/api/workouts/:id/complete", async (c) => {
    const { seconds } = z
      .object({
        seconds: z
          .number()
          .int()
          .min(0)
          .max(4 * 3600),
      })
      .parse(await c.req.json());
    return c.json(await health.completeWorkout(c.get("owner"), c.req.param("id"), seconds), 201);
  });
  app.get("/api/feed", async (c) => c.json(await feed.get(c.get("owner"))));
  app.post("/api/sandbox/clear", async (c) => {
    const owner = c.get("owner");
    if (!agent.sandbox) return c.json({ cleared: true });
    return c.json(await agent.sandbox.clear(owner, usage.sink(owner, "code")));
  });
  app.get("/api/calendar/today", async (c) =>
    c.json(await calendarToday.today(c.get("owner"), c.req.query("fresh") === "1")),
  );
  // Events from connected calendar apps for the Calendar screen's day, week or next 30 days.
  app.get("/api/calendar/apps", async (c) => {
    const query = z
      .object({
        timeMin: z.iso.datetime({ offset: true }),
        timeMax: z.iso.datetime({ offset: true }),
      })
      .parse(c.req.query());
    const from = Date.parse(query.timeMin);
    const to = Date.parse(query.timeMax);
    if (to <= from || to - from > MAX_RANGE_DAYS * 86_400_000)
      throw new AppError(
        `Choose a calendar range between one moment and ${MAX_RANGE_DAYS} days`,
        422,
      );
    return c.json(
      await calendarToday.between(
        c.get("owner"),
        new Date(from).toISOString(),
        new Date(to).toISOString(),
        c.req.query("fresh") === "1",
      ),
    );
  });
  app.get("/api/weather", async (c) =>
    c.json(agent.weather ? await agent.weather.forOwner(c.get("owner")) : { unavailable: "off" }),
  );
  app.get("/api/area", async (c) =>
    c.json({ area: (await agent.areas?.get(c.get("owner"))) ?? null }),
  );
  app.post("/api/area", async (c) => {
    const owner = c.get("owner");
    const area = await agent.areas?.set(owner, await c.req.json());
    agent.areaChanged?.(owner);
    return c.json({ area });
  });
  app.post("/api/area/clear", async (c) => {
    const owner = c.get("owner");
    await agent.areas?.clear(owner);
    agent.areaChanged?.(owner);
    return c.json({ ok: true });
  });
  app.post("/api/feed/topics", async (c) =>
    c.json(await feed.setTopics(c.get("owner"), await c.req.json())),
  );
  app.post("/api/feed/refresh", async (c) => c.json(await feed.refreshNow(c.get("owner"))));
  app.post("/api/feed/feedback", async (c) =>
    c.json(await feed.feedback(c.get("owner"), await c.req.json())),
  );
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
      connected
        ? { configured: true, apps: await connected.connections(c.get("owner")) }
        : { configured: false, apps: [] },
    ),
  );
  // "Your own apps": add one by its address, sign in or add its key, check it again, remove it.
  app.get("/api/mcp", async (c) => c.json({ apps: await mcp.list(c.get("owner")) }));
  app.post("/api/mcp", async (c) => c.json(await mcp.add(c.get("owner"), await c.req.json()), 201));
  app.post("/api/mcp/:id/connect", async (c) =>
    c.json(await mcp.connect(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/mcp/:id/key", async (c) =>
    c.json(await mcp.setKey(c.get("owner"), c.req.param("id"), await c.req.json())),
  );
  app.post("/api/mcp/:id/delete", async (c) =>
    c.json(await mcp.remove(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/apps/directory", async (c) => {
    if (!apps) return c.json({ configured: false, apps: [] });
    return c.json({
      configured: true,
      apps: await apps.directory(c.get("owner"), c.req.query("q")),
    });
  });
  app.post("/api/apps/disconnect", async (c) => {
    if (!connected) throw new AppError("Connected apps are not configured on this server", 409);
    const { app: slug } = z
      .object({ app: z.string().trim().min(1).max(100) })
      .parse(await c.req.json());
    await connected.disconnect(c.get("owner"), slug);
    calendarToday.forget(c.get("owner"));
    return c.json({ ok: true });
  });
  app.post("/api/apps/connect", async (c) => {
    if (!connected) throw new AppError("Connected apps are not configured on this server", 409);
    const { app: slug } = z
      .object({ app: z.string().trim().min(1).max(100) })
      .parse(await c.req.json());
    calendarToday.forget(c.get("owner"));
    return c.json(await connected.connect(c.get("owner"), slug));
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
    if (old) await db.remove(owner, "chat-archive", old.threadId);
    if (old)
      await threads
        .deleteThread({ threadId: old.threadId, userId: owner, agentId: "default" })
        .catch(() => console.warn("[OpenMuse] Could not delete the previous main conversation"));
    return c.json({ ok: true });
  });
  const data = new DataControls(db, files, threads);
  const archive = new ChatArchive(db);
  app.get("/api/threads/archive", async (c) => c.json(await archive.list(c.get("owner"))));
  app.get("/api/threads/:threadId/archive", async (c) =>
    c.json({ messages: await archive.messages(c.get("owner"), c.req.param("threadId")) }),
  );
  app.put("/api/threads/:threadId/archive", async (c) =>
    c.json(await archive.save(c.get("owner"), c.req.param("threadId"), await c.req.json())),
  );
  app.post("/api/threads/:threadId/archive/delete", async (c) =>
    c.json(await archive.remove(c.get("owner"), c.req.param("threadId"))),
  );
  app.get("/api/threads/:threadId/hidden", async (c) =>
    c.json({ messageIds: await data.hidden(c.get("owner"), c.req.param("threadId")) }),
  );
  app.post("/api/threads/:threadId/messages/:messageId/delete", async (c) =>
    c.json(await data.hide(c.get("owner"), c.req.param("threadId"), c.req.param("messageId"))),
  );
  // A signed link, so the browser can download the export as a file.
  app.post("/api/account/export-link", (c) =>
    c.json({ url: auth.sign(c.get("owner"), "/api/account/export") }),
  );
  app.get("/api/account/export", async (c) => {
    const zip = await data.export(c.get("owner"));
    const day = new Date().toISOString().slice(0, 10);
    return c.body(zip.buffer as ArrayBuffer, 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="openmuse-export-${day}.zip"`,
      "cache-control": "no-store",
    });
  });
  app.post("/api/account/reset", async (c) => {
    z.object({ confirm: z.literal("RESET") }).parse(await c.req.json());
    return c.json(await data.reset(c.get("owner")));
  });
  // Memories from ChatGPT: its data export, or a pasted list. Each one waits for approval.
  app.post("/api/memories/import", async (c) => {
    const owner = c.get("owner");
    const read = (text: string) => {
      if (!claude)
        throw new AppError(
          "Reading ChatGPT history needs the Anthropic API key on the server",
          503,
        );
      return extractMemories(text, { ...claude, onUsage: usage.sink(owner, "import") });
    };
    let memories: string[];
    if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
      const file = (await c.req.parseBody()).file;
      if (!(file instanceof File)) throw new AppError("Choose your ChatGPT export");
      if (file.size > 150 * 1024 * 1024)
        throw new AppError(
          "This export is too large. Open the .zip and upload conversations.json from inside it.",
          413,
        );
      const history = recentHistory(chatgptMessages(new Uint8Array(await file.arrayBuffer())));
      if (!history) throw new AppError("No conversations were found in this export", 422);
      memories = await read(history);
    } else {
      const { text } = z
        .object({ text: z.string().trim().min(3).max(100000) })
        .parse(await c.req.json());
      memories = listedMemories(text) ?? (await read(text));
    }
    const suggested = await suggestMemories(owner, memories, "ChatGPT");
    return c.json({ found: memories.length, suggested });
  });
  /** Memories found in another assistant's history, each waiting for the person to keep it. */
  async function suggestMemories(owner: string, memories: string[], from: string) {
    let suggested = 0;
    for (const text of memories) {
      const result = await agent
        .suggestMemory(
          owner,
          { text: text.slice(0, 500), reason: `From your ${from} history` },
          `${from} import`,
          { quiet: true },
        )
        .catch(() => undefined);
      if (result?.status === "suggested") suggested++;
    }
    if (suggested)
      await agent.notify(
        owner,
        `Memories from ${from} to review`,
        `${suggested} ${suggested === 1 ? "thing" : "things"} to keep or dismiss under Memory.`,
        undefined,
        `memory-import:${randomUUID()}`,
      );
    return suggested;
  }
  // Past chats from ChatGPT and Claude: big exports are read on the device and sent in batches,
  // small ones (from the phone app) as the file. What the person wrote there suggests memories.
  const pastChats = new PastChats(db);
  const suggestFrom = (owner: string, from: string, history: string) => {
    if (!claude || !history.trim()) return false;
    void extractMemories(history, { ...claude, onUsage: usage.sink(owner, "import") })
      .then((memories) => suggestMemories(owner, memories, from))
      .catch((error) => backgroundFailure(`memories from ${from}`, error));
    return true;
  };
  app.get("/api/past-chats", async (c) =>
    c.json({ sources: await pastChats.sources(c.get("owner")) }),
  );
  app.post("/api/past-chats/batch", async (c) =>
    c.json(await pastChats.save(c.get("owner"), await c.req.json())),
  );
  app.post("/api/past-chats/finish", async (c) => {
    const owner = c.get("owner");
    const { source, history } = z
      .object({ source: z.unknown(), history: z.string().max(70000).optional() })
      .parse(await c.req.json());
    const summary = await pastChats.finish(owner, source);
    const suggesting = suggestFrom(owner, summary.name, history ?? "");
    return c.json({ summary, sources: await pastChats.sources(owner), suggesting });
  });
  app.post("/api/past-chats/upload", async (c) => {
    const owner = c.get("owner");
    const file = (await c.req.parseBody()).file;
    if (!(file instanceof File)) throw new AppError("Choose your ChatGPT or Claude export");
    const { summary, chats } = await pastChats.importFile(
      owner,
      new Uint8Array(await file.arrayBuffer()),
    );
    const suggesting = suggestFrom(owner, summary.name, ownWords(chats));
    return c.json({ summary, sources: await pastChats.sources(owner), suggesting });
  });
  app.post("/api/past-chats/remove", async (c) =>
    c.json(await pastChats.remove(c.get("owner"), (await c.req.json()).source)),
  );
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
  // One file, with a fresh signed link (links from earlier expire).
  app.get("/api/files/:id", async (c) => {
    const owner = c.get("owner");
    return c.json(files.signed(owner, await files.get(owner, c.req.param("id"))));
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
  app.get("/api/app-alerts", async (c) =>
    c.json({
      available: appEvents.available && !!mailAlerts,
      alerts: await appEvents.list(c.get("owner")),
    }),
  );
  app.post("/api/app-alerts/:id/stop", async (c) =>
    c.json(await appEvents.stop(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/mini-apps", async (c) =>
    c.json({ apps: await agent.miniApps.list(c.get("owner")) }),
  );
  app.get("/api/mini-apps/:id", async (c) => {
    const found = await agent.miniApps.get(c.get("owner"), c.req.param("id"));
    const { html: _html, ...view } = found;
    return c.json({ ...view, document: appDocument(found) });
  });
  app.post("/api/mini-apps/:id/delete", async (c) =>
    c.json(await agent.miniApps.remove(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/mini-apps/:id/share", async (c) =>
    c.json({ links: await agent.miniApps.links(c.get("owner"), c.req.param("id")) }),
  );
  app.post("/api/mini-apps/:id/share", async (c) => {
    const body = z
      .object({ days: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(7) })
      .parse(await c.req.json().catch(() => ({})));
    return c.json(await agent.miniApps.share(c.get("owner"), c.req.param("id"), body.days), 201);
  });
  app.post("/api/mini-apps/:id/unshare", async (c) =>
    c.json(await agent.miniApps.unshare(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/logins", async (c) =>
    c.json({ available: logins.available, logins: await logins.list(c.get("owner")) }),
  );
  app.post("/api/logins", async (c) =>
    c.json(await logins.save(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/api/logins/:id", async (c) =>
    c.json(await logins.change(c.get("owner"), c.req.param("id"), await c.req.json())),
  );
  app.post("/api/logins/:id/delete", async (c) =>
    c.json(await logins.remove(c.get("owner"), c.req.param("id"))),
  );
  // Live voice: talk with the agent in real time (the browser connects to OpenAI over WebRTC).
  app.get("/api/voice/live", async (c) => {
    const owner = c.get("owner");
    return c.json({
      ...(await liveVoice.status(owner)),
      minutesThisMonth: (await usage.month(owner)).voiceMinutes,
    });
  });
  app.post("/api/voice/live", async (c) => {
    const { sdp } = z.object({ sdp: z.string().min(10).max(100_000) }).parse(await c.req.json());
    return c.json(await liveVoice.start(c.get("owner"), sdp));
  });
  app.post("/api/voice/live/:id/end", async (c) => {
    await liveVoice.end(c.get("owner"), c.req.param("id"));
    return c.json({ ok: true });
  });
  app.get("/api/voice/live/recent", async (c) =>
    c.json({ sessions: await liveVoice.recent(c.get("owner")) }),
  );
  // What a call showed on screen instead of reading it out (during the call and after).
  app.get("/api/voice/live/:id/details", async (c) =>
    c.json({ details: await liveVoice.details(c.get("owner"), c.req.param("id")) }),
  );
  app.get("/api/persona", async (c) => c.json({ facts: await agent.persona.list(c.get("owner")) }));
  app.post("/api/persona/:key", async (c) =>
    c.json(await agent.persona.edit(c.get("owner"), c.req.param("key"), await c.req.json())),
  );
  app.post("/api/persona/:key/confirm", async (c) =>
    c.json(await agent.persona.confirm(c.get("owner"), c.req.param("key"))),
  );
  app.post("/api/persona/:key/forget", async (c) =>
    c.json(await agent.persona.forget(c.get("owner"), c.req.param("key"))),
  );
  app.post("/api/persona/:key/restore", async (c) =>
    c.json(await agent.persona.restore(c.get("owner"), c.req.param("key"), await c.req.json())),
  );
  app.get("/api/people", async (c) => c.json({ people: await agent.people.list(c.get("owner")) }));
  app.post("/api/people", async (c) =>
    c.json(await agent.people.note(c.get("owner"), await c.req.json()), 201),
  );
  app.post("/api/people/:id", async (c) =>
    c.json(await agent.people.edit(c.get("owner"), c.req.param("id"), await c.req.json())),
  );
  app.post("/api/people/:id/delete", async (c) =>
    c.json(await agent.people.remove(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/files/:id/share", async (c) =>
    c.json({ links: await shares.list(c.get("owner"), c.req.param("id")) }),
  );
  app.post("/api/files/:id/share", async (c) => {
    const body = z
      .object({ days: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(7) })
      .parse(await c.req.json().catch(() => ({})));
    return c.json(await shares.create(c.get("owner"), c.req.param("id"), body.days), 201);
  });
  app.post("/api/files/:id/unshare", async (c) =>
    c.json(await shares.stop(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/files/download", async (c) => {
    const body = z
      .object({ url: z.url().max(4000), name: z.string().trim().max(180).optional() })
      .parse(await c.req.json());
    return c.json(await downloadToFiles(files, c.get("owner"), body), 201);
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
  return { app, auth, accounts, files, actions, workspace, agent, computer, liveVoice };
}
