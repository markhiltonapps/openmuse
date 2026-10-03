import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ActionService } from "../apps/server/src/actions.ts";
import { createApp } from "../apps/server/src/app.ts";
import { ApprovalRules, destructiveAction } from "../apps/server/src/approval-rules.ts";
import {
  type AppConnector,
  appToolSpecs,
  ComposioConnector,
  readOnlyAction,
} from "../apps/server/src/apps.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import type { AppAction } from "../packages/domain/src/index.ts";

let db: Store, directory: string;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-apps-"));
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});
const config = (): Config & { composioApiKey: string } => ({
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir: directory,
  agentBackend: "sample",
  intelligenceApiKey: "test-project-key-never-sent",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: ["http://localhost:8081"],
  composioApiKey: "test-composio-key",
  composioBaseUrl: "https://composio.test",
});

/** A scripted Composio: each path answers from `routes`, and every request is recorded. */
function fakeComposio(
  routes: Record<string, (body: unknown, url: URL) => Response | Promise<Response>>,
) {
  const calls: { method: string; path: string; body: unknown; key: string | null }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const { pathname, search } = new URL(String(url));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path: pathname + search,
      body,
      key: new Headers(init?.headers).get("x-api-key"),
    });
    const route = routes[`${method} ${pathname}`];
    if (!route) return Response.json({ error: { message: "Not found" } }, { status: 404 });
    return route(body, new URL(String(url)));
  }) as typeof fetch;
  return { fetcher, calls };
}
const tool = (slug: string, tags: string[] = []) =>
  Response.json({
    slug,
    name: slug.toLowerCase(),
    description: `${slug} description`,
    toolkit: { slug: "outlook", name: "Outlook" },
    input_parameters: { type: "object" },
    tags,
  });

test("only read-only actions skip review", () => {
  assert.equal(readOnlyAction("OUTLOOK_SEND_EMAIL", "outlook", ["readOnlyHint"]), true);
  assert.equal(
    readOnlyAction("OUTLOOK_LIST_MESSAGES", "outlook", ["readOnlyHint", "destructiveHint"]),
    false,
  );
  assert.equal(readOnlyAction("OUTLOOK_LIST_MESSAGES", "outlook", []), true);
  assert.equal(readOnlyAction("GOOGLEDRIVE_FIND_FILE", "googledrive", []), true);
  assert.equal(readOnlyAction("OUTLOOK_SEND_EMAIL", "outlook", []), false);
  assert.equal(readOnlyAction("SLACK_DELETE_MESSAGE", "slack", []), false);
  assert.equal(readOnlyAction("HUBSPOT_CREATE_CONTACT", "hubspot", ["openWorldHint"]), false);
});

test("Composio sessions are created once, reused, and recreated when unknown", async () => {
  let sessions = 0;
  let known = "";
  const { fetcher, calls } = fakeComposio({
    "POST /api/v3.1/tool_router/session": () => {
      known = `trs_${++sessions}`;
      return Response.json({ session_id: known }, { status: 201 });
    },
    "GET /api/v3.1/tools/OUTLOOK_LIST_MESSAGES": () => tool("OUTLOOK_LIST_MESSAGES"),
    "POST /api/v3.1/tool_router/session/trs_1/execute": () =>
      known === "trs_1"
        ? Response.json({ data: { messages: [] }, error: null, log_id: "log" })
        : Response.json({ error: { message: "Session not found" } }, { status: 404 }),
    "POST /api/v3.1/tool_router/session/trs_2/execute": () =>
      Response.json({ data: { messages: [1] }, error: null, log_id: "log" }),
  });
  const connector = new ComposioConnector(db, config(), fetcher);
  assert.deepEqual(await connector.execute("reuse", "OUTLOOK_LIST_MESSAGES", {}), {
    messages: [],
  });
  assert.deepEqual(await connector.execute("reuse", "OUTLOOK_LIST_MESSAGES", {}), {
    messages: [],
  });
  assert.equal(sessions, 1);
  known = "expired";
  assert.deepEqual(await connector.execute("reuse", "OUTLOOK_LIST_MESSAGES", {}), {
    messages: [1],
  });
  assert.equal(sessions, 2);
  const created = calls.find((c) => c.path === "/api/v3.1/tool_router/session");
  assert.deepEqual(created?.body, {
    user_id: "openmuse-reuse",
    manage_connections: { enable: false },
    workbench: { enable: false },
  });
  assert.ok(calls.every((c) => c.key === "test-composio-key"));
});

test("Composio search, connection links and provider errors", async () => {
  const { fetcher } = fakeComposio({
    "POST /api/v3.1/tool_router/session": () =>
      Response.json({ session_id: "trs_search" }, { status: 201 }),
    "POST /api/v3.1/tool_router/session/trs_search/search": () =>
      Response.json({
        success: true,
        error: null,
        results: [
          {
            primary_tool_slugs: ["OUTLOOK_SEND_EMAIL", "OUTLOOK_LIST_MESSAGES"],
            related_tool_slugs: [],
            execution_guidance: "Send with OUTLOOK_SEND_EMAIL.",
          },
        ],
        toolkit_connection_statuses: [
          { toolkit: "outlook", has_active_connection: false, status_message: "Not connected" },
        ],
      }),
    "GET /api/v3.1/tools/OUTLOOK_SEND_EMAIL": () => tool("OUTLOOK_SEND_EMAIL"),
    "GET /api/v3.1/tools/OUTLOOK_LIST_MESSAGES": () =>
      tool("OUTLOOK_LIST_MESSAGES", ["readOnlyHint"]),
    "GET /api/v3.1/tool_router/session/trs_search/toolkits": () =>
      Response.json({
        items: [
          { name: "Slack", slug: "slack", connected_account: { status: "ACTIVE" } },
          { name: "Notion", slug: "notion", connected_account: { status: "EXPIRED" } },
        ],
      }),
    "POST /api/v3.1/tool_router/session/trs_search/link": (body) =>
      Response.json(
        {
          link_token: "t",
          redirect_url: `https://connect.test/${(body as { toolkit: string }).toolkit}`,
          connected_account_id: "ca",
        },
        { status: 201 },
      ),
    "POST /api/v3.1/tool_router/session/trs_search/execute": () =>
      Response.json({ data: {}, error: "Recipient mailbox not found", log_id: "log" }),
  });
  const connector = new ComposioConnector(db, config(), fetcher);
  const found = await connector.search("search", "email Dana about Friday");
  assert.deepEqual(
    found.tools.map((t) => [t.slug, t.readOnly]),
    [
      ["OUTLOOK_SEND_EMAIL", false],
      ["OUTLOOK_LIST_MESSAGES", true],
    ],
  );
  assert.deepEqual(found.apps, [{ app: "outlook", connected: false, status: "Not connected" }]);
  assert.deepEqual(found.guidance, ["Send with OUTLOOK_SEND_EMAIL."]);
  assert.deepEqual(await connector.connect("search", "Slack"), { connected: true });
  assert.deepEqual(await connector.connect("search", "Google Drive"), {
    connected: false,
    url: "https://connect.test/googledrive",
  });
  assert.deepEqual(
    (await connector.connections("search")).map((c) => [c.app, c.connected, c.needsReconnect]),
    [
      ["slack", true, undefined],
      ["notion", false, true],
    ],
  );
  await assert.rejects(
    connector.execute("search", "OUTLOOK_SEND_EMAIL", {}),
    /Recipient mailbox not found/,
  );
  await assert.rejects(connector.tool("search", "COMPOSIO_REMOTE_BASH_TOOL"), /Unknown app action/);
  await assert.rejects(connector.connect("search", "../admin"), /Unknown app/);
});

test("a failed write connection is reported as an unknown outcome", async () => {
  const { fetcher } = fakeComposio({
    "POST /api/v3.1/tool_router/session": () =>
      Response.json({ session_id: "trs_net" }, { status: 201 }),
    "GET /api/v3.1/tools/OUTLOOK_SEND_EMAIL": () => tool("OUTLOOK_SEND_EMAIL"),
    "POST /api/v3.1/tool_router/session/trs_net/execute": () => {
      throw new TypeError("socket hang up");
    },
  });
  const connector = new ComposioConnector(db, config(), fetcher);
  await assert.rejects(connector.execute("net", "OUTLOOK_SEND_EMAIL", {}), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { outcomeUnknown?: boolean }).outcomeUnknown, true);
    return true;
  });
});

test("too many requests are tried again after a pause; expired sign-ins say to reconnect", async () => {
  let sessions = 0;
  let executes = 0;
  const { fetcher } = fakeComposio({
    "POST /api/v3.1/tool_router/session": () => {
      // The connector itself is busy the first time.
      if (++sessions === 1)
        return Response.json(
          { error: { message: "Rate limit exceeded" } },
          { status: 429, headers: { "retry-after": "2" } },
        );
      return Response.json({ session_id: "trs_busy" }, { status: 201 });
    },
    "GET /api/v3.1/tools/OUTLOOK_SEND_EMAIL": () => tool("OUTLOOK_SEND_EMAIL"),
    "GET /api/v3.1/tools/OUTLOOK_LIST_MESSAGES": () =>
      tool("OUTLOOK_LIST_MESSAGES", ["readOnlyHint"]),
    "POST /api/v3.1/tool_router/session/trs_busy/execute": (body) => {
      executes++;
      if ((body as { tool_slug: string }).tool_slug === "OUTLOOK_LIST_MESSAGES")
        return Response.json({
          data: {},
          error: "Error 401: invalid_grant, the refresh token has expired",
        });
      // The app is busy the first time.
      return Response.json(
        executes === 1
          ? { data: {}, error: "429 Too Many Requests" }
          : { data: { sent: true }, error: null },
      );
    },
  });
  const waits: number[] = [];
  const connector = new ComposioConnector(db, config(), fetcher, async (ms) => {
    waits.push(ms);
  });
  assert.deepEqual(await connector.execute("busy", "OUTLOOK_SEND_EMAIL", {}), { sent: true });
  assert.deepEqual(waits, [2000, 1000]);
  assert.equal(executes, 2);
  await assert.rejects(
    connector.execute("busy", "OUTLOOK_LIST_MESSAGES", {}),
    /sign-in to outlook has expired. Call connect_app so the person can sign in again/,
  );
  // Always busy: gives up after three tries.
  const { fetcher: busy } = fakeComposio({
    "POST /api/v3.1/tool_router/session": () =>
      Response.json({ error: { message: "Rate limit exceeded" } }, { status: 429 }),
  });
  waits.length = 0;
  const gaveUp = new ComposioConnector(db, config(), busy, async (ms) => {
    waits.push(ms);
  });
  await assert.rejects(gaveUp.search("always-busy", "email"), /Rate limit exceeded/);
  assert.deepEqual(waits, [1000, 2000]);
});

function fakeApps(overrides: Partial<AppConnector> = {}) {
  const executed: { slug: string; args: Record<string, unknown> }[] = [];
  const apps: AppConnector = {
    search: async () => ({ tools: [], apps: [], guidance: [] }),
    tool: async (_owner, slug) => ({
      slug,
      name: slug,
      description: "",
      app: slug.split("_")[0]?.toLowerCase() ?? "",
      readOnly: /_LIST_/.test(slug),
    }),
    execute: async (_owner, slug, args) => {
      executed.push({ slug, args });
      return { ok: true };
    },
    connect: async () => ({ connected: false, url: "https://connect.test/outlook" }),
    connections: async () => [{ app: "slack", name: "Slack", connected: true }],
    directory: async (_owner, search) => [
      { app: "slack", name: "Slack", connected: true },
      ...(search ? [] : [{ app: "outlook", name: "Outlook", connected: false }]),
    ],
    disconnect: async () => {},
    ...overrides,
  };
  return { apps, executed };
}

test("use_app runs look-ups now and saves everything else for review", async () => {
  const { apps, executed } = fakeApps();
  const proposed: AppAction[] = [];
  const specs = appToolSpecs(apps, "owner", async (action) => {
    proposed.push(action);
    return { id: "action-1", title: action.summary };
  });
  const useApp = specs.find((s) => s.name === "use_app");
  assert.ok(useApp);
  const run = useApp.execute as (args: unknown) => Promise<Record<string, unknown>>;
  const read = await run({
    tool: "OUTLOOK_LIST_MESSAGES",
    arguments: { top: 5 },
    summary: "List recent Outlook email",
  });
  assert.deepEqual(read, { result: { data: { ok: true } } });
  const write = await run({
    tool: "OUTLOOK_SEND_EMAIL",
    arguments: { to: "dana@example.com", subject: "Friday" },
    summary: "Send an Outlook email to Dana about Friday",
  });
  assert.equal(write.status, "awaiting_review");
  assert.deepEqual(executed, [{ slug: "OUTLOOK_LIST_MESSAGES", args: { top: 5 } }]);
  assert.deepEqual(proposed, [
    {
      app: "outlook",
      tool: "OUTLOOK_SEND_EMAIL",
      summary: "Send an Outlook email to Dana about Friday",
      arguments: { to: "dana@example.com", subject: "Friday" },
    },
  ]);
});

test("app actions are reviewed without a Google connection and run once on approval", async () => {
  let runs = 0;
  const service = new ActionService(db, {
    execute: async (_owner, input) => {
      runs++;
      assert.equal(input.kind, "app.action");
      return "Done in outlook · OUTLOOK_SEND_EMAIL";
    },
    connected: async () => false,
    connection: async () => null,
  });
  const proposal = await service.propose("apps-owner", {
    kind: "app.action",
    data: {
      app: "outlook",
      tool: "OUTLOOK_SEND_EMAIL",
      summary: "Send an Outlook email to Dana about Friday",
      arguments: { to: "dana@example.com" },
    },
  });
  assert.equal(proposal.status, "awaiting_review");
  assert.equal(proposal.title, "Send an Outlook email to Dana about Friday");
  assert.equal(runs, 0);
  const done = await service.decide("apps-owner", proposal.id, proposal.hash, "approve");
  assert.equal(done.status, "succeeded");
  assert.equal(runs, 1);
  const again = await service.decide("apps-owner", proposal.id, proposal.hash, "approve");
  assert.equal(again.status, "succeeded");
  assert.equal(runs, 1);
  await assert.rejects(
    service.propose("apps-owner", {
      kind: "app.action",
      data: { app: "x", tool: "../../etc", summary: "s", arguments: {} },
    }),
    /Unknown action/,
  );
});

test("the apps API reports configuration and returns sign-in links", async () => {
  const signIn = async (app: Awaited<ReturnType<typeof createApp>>["app"]) => {
    const response = await app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const { token } = await response.json();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
  const { composioApiKey: _unused, ...plain } = config();
  const without = await createApp(db, plain);
  const headers = await signIn(without.app);
  assert.deepEqual(await (await without.app.request("/api/apps", { headers })).json(), {
    configured: false,
    apps: [],
  });
  assert.equal(
    (
      await without.app.request("/api/apps/connect", {
        method: "POST",
        headers,
        body: JSON.stringify({ app: "outlook" }),
      })
    ).status,
    409,
  );
  const { apps } = fakeApps();
  const withApps = await createApp(db, plain, { apps });
  const appHeaders = await signIn(withApps.app);
  assert.deepEqual(
    await (await withApps.app.request("/api/apps", { headers: appHeaders })).json(),
    {
      configured: true,
      apps: [{ app: "slack", name: "Slack", connected: true }],
    },
  );
  const link = await withApps.app.request("/api/apps/connect", {
    method: "POST",
    headers: appHeaders,
    body: JSON.stringify({ app: "outlook" }),
  });
  assert.deepEqual(await link.json(), {
    connected: false,
    url: "https://connect.test/outlook",
  });
});

test("sign-ins renew while used and end when the access key changes", async () => {
  const { Auth, SESSION_TTL } = await import("../apps/server/src/auth.ts");
  const { composioApiKey: _unused, ...plain } = config();
  const live = { ...plain, mode: "live" as const, accessKey: "first-access-key-at-least-24-chars" };
  const auth = new Auth(db, live, "signing-key");
  await assert.rejects(auth.session("wrong-key"), /incorrect/);
  const { token } = await auth.session(live.accessKey);
  assert.equal(await auth.owner(`Bearer ${token}`), "local-user");
  const id = (await import("node:crypto")).createHash("sha256").update(token).digest("hex");
  const stored = await db.get<{ expiresAt: number }>("system", "sessions", id);
  assert.ok(stored && stored.expiresAt > Date.now() + SESSION_TTL - 60000);
  await db.put("system", "sessions", { ...stored, id, expiresAt: Date.now() + 1000 });
  await auth.owner(`Bearer ${token}`);
  const renewed = await db.get<{ expiresAt: number }>("system", "sessions", id);
  assert.ok(renewed && renewed.expiresAt > Date.now() + SESSION_TTL - 60000);
  const rotated = new Auth(db, { ...live, accessKey: "second-access-key-at-least-24-chars" }, "k");
  await assert.rejects(rotated.owner(`Bearer ${token}`), /Session expired/);
});

test("the app directory lists connected apps first, then featured apps, with safe logos", async () => {
  const kit = (
    slug: string,
    connected: string | null,
    logo = `https://logos.test/${slug}.png`,
  ) => ({
    name: slug.toUpperCase(),
    slug,
    meta: { logo, description: `${slug} app` },
    connected_account: connected ? { id: `ca_${slug}`, status: connected } : null,
  });
  const { fetcher, calls } = fakeComposio({
    "POST /api/v3.1/tool_router/session": () =>
      Response.json({ session_id: "trs_dir" }, { status: 201 }),
    "GET /api/v3.1/tool_router/session/trs_dir/toolkits": (_body, url) => {
      if (url.searchParams.get("is_connected") === "true")
        return Response.json({ items: [kit("jira", "ACTIVE")] });
      if (url.searchParams.get("search"))
        return Response.json({ items: [kit("salesforce", null, "javascript:alert(1)")] });
      return Response.json({ items: [kit("slack", null), kit("outlook", null)] });
    },
    "DELETE /api/v3.1/connected_accounts/ca_jira": () => Response.json({ success: true }),
  });
  const connector = new ComposioConnector(db, config(), fetcher);
  const featured = await connector.directory("dir");
  assert.deepEqual(
    featured.map((a) => [a.app, a.connected]),
    [
      ["jira", true],
      ["outlook", false],
      ["slack", false],
    ],
  );
  assert.equal(featured[0]?.logo, "https://logos.test/jira.png");
  const found = await connector.directory("dir", "sales");
  assert.deepEqual(found, [
    {
      app: "salesforce",
      name: "SALESFORCE",
      connected: false,
      logo: undefined,
      description: "salesforce app",
    },
  ]);
  await connector.disconnect("dir", "Jira");
  assert.ok(
    calls.some((c) => c.method === "DELETE" && c.path === "/api/v3.1/connected_accounts/ca_jira"),
  );
});

test("apps Composio can't sign in to itself use the sign-in set up in its dashboard", async () => {
  let sessions = 0;
  let configured = false;
  const { fetcher, calls } = fakeComposio({
    "POST /api/v3.1/tool_router/session": () =>
      Response.json({ session_id: `trs_brex_${++sessions}` }, { status: 201 }),
    "GET /api/v3.1/tool_router/session/trs_brex_1/toolkits": () => Response.json({ items: [] }),
    "GET /api/v3.1/tool_router/session/trs_brex_2/toolkits": () => Response.json({ items: [] }),
    "POST /api/v3.1/tool_router/session/trs_brex_1/link": () =>
      Response.json(
        {
          error: {
            message:
              "Composio does not manage auth for toolkit brex and no auth config without required fields is available. Please create an auth config manually or specify one in auth_config_override.",
          },
        },
        { status: 400 },
      ),
    "POST /api/v3.1/tool_router/session/trs_brex_2/link": () =>
      Response.json({ redirect_url: "https://connect.composio.test/brex" }),
    // Composio ignores the toolkit filter here and pages the list, with Brex on the second page.
    "GET /api/v3/auth_configs": (_body, url) =>
      url.searchParams.get("cursor") === "page-2"
        ? Response.json({
            items: configured
              ? [
                  { id: "ac_off", toolkit: { slug: "brex" }, status: "DISABLED" },
                  { id: "ac_brex", toolkit: { slug: "brex" }, status: "ENABLED" },
                ]
              : [],
            next_cursor: null,
          })
        : Response.json({
            items: [
              { id: "ac_managed", toolkit: { slug: "gmail" }, is_composio_managed: true },
              { id: "ac_posthog", toolkit: { slug: "posthog" }, is_composio_managed: false },
            ],
            next_cursor: "page-2",
          }),
  });
  const connector = new ComposioConnector(db, config(), fetcher);
  await assert.rejects(
    connector.connect("brex-owner", "Brex"),
    (error: Error & { status?: number }) => {
      assert.equal(error.status, 409);
      assert.match(
        error.message,
        /Brex needs its own sign-in set up in Composio.*Auth Configs.*API Key/,
      );
      return true;
    },
  );
  assert.equal(sessions, 1);
  configured = true;
  assert.deepEqual(await connector.connect("brex-owner", "brex"), {
    connected: false,
    url: "https://connect.composio.test/brex",
  });
  const created = calls.filter((c) => c.path === "/api/v3.1/tool_router/session");
  assert.equal(created.length, 2);
  assert.deepEqual((created[1]?.body as { auth_configs?: unknown } | undefined)?.auth_configs, {
    brex: "ac_brex",
  });
});

test("an auth config named in the settings is used without looking it up", async () => {
  const { fetcher, calls } = fakeComposio({
    "POST /api/v3.1/tool_router/session": () =>
      Response.json({ session_id: "trs_named" }, { status: 201 }),
    "GET /api/v3.1/tool_router/session/trs_named/toolkits": () => Response.json({ items: [] }),
    "POST /api/v3.1/tool_router/session/trs_named/link": (body) =>
      calls.filter((c) => c.path.endsWith("/link")).length === 1
        ? Response.json(
            { error: { message: "Composio does not manage auth for toolkit brex." } },
            { status: 400 },
          )
        : Response.json({
            redirect_url: `https://connect.composio.test/${(body as { toolkit: string }).toolkit}`,
          }),
  });
  const connector = new ComposioConnector(
    db,
    { ...config(), composioAuthConfigs: { brex: "ac_named" } },
    fetcher,
  );
  assert.deepEqual(await connector.connect("named-owner", "brex"), {
    connected: false,
    url: "https://connect.composio.test/brex",
  });
  assert.ok(!calls.some((c) => c.path.startsWith("/api/v3/auth_configs")));
  const sessions = calls.filter((c) => c.path === "/api/v3.1/tool_router/session");
  assert.deepEqual(
    (sessions.at(-1)?.body as { auth_configs?: unknown } | undefined)?.auth_configs,
    {
      brex: "ac_named",
    },
  );
});

test("Connect sets up an API-key sign-in in this Composio project when there's none", async () => {
  let sessions = 0;
  const { fetcher, calls } = fakeComposio({
    "POST /api/v3.1/tool_router/session": (body) => {
      // A setting names an auth config from another Composio project.
      if ((body as { auth_configs?: { brex?: string } }).auth_configs?.brex === "ac_elsewhere")
        return Response.json(
          { error: { message: "Invalid auth config IDs: ac_elsewhere (for toolkit: brex)." } },
          { status: 400 },
        );
      return Response.json({ session_id: `trs_made_${++sessions}` }, { status: 201 });
    },
    "GET /api/v3.1/tool_router/session/trs_made_1/toolkits": () => Response.json({ items: [] }),
    "POST /api/v3.1/tool_router/session/trs_made_1/link": () =>
      Response.json(
        { error: { message: "Composio does not manage auth for toolkit brex." } },
        { status: 400 },
      ),
    "POST /api/v3.1/tool_router/session/trs_made_2/link": () =>
      Response.json({ redirect_url: "https://connect.composio.test/brex-key" }),
    // The first shape isn't accepted; the second is.
    "POST /api/v3/auth_configs": (body) =>
      "authScheme" in ((body as { auth_config: object }).auth_config ?? {})
        ? Response.json({ error: { message: "auth_scheme is required" } }, { status: 400 })
        : Response.json({ toolkit: { slug: "brex" }, auth_config: { id: "ac_made" } }),
  });
  const connector = new ComposioConnector(
    db,
    { ...config(), composioAuthConfigs: { brex: "ac_elsewhere" } },
    fetcher,
  );
  assert.deepEqual(await connector.connect("made-owner", "brex"), {
    connected: false,
    url: "https://connect.composio.test/brex-key",
  });
  const created = calls.filter((c) => c.method === "POST" && c.path === "/api/v3/auth_configs");
  assert.deepEqual(created.at(-1)?.body, {
    toolkit: { slug: "brex" },
    auth_config: {
      type: "use_custom_auth",
      auth_scheme: "API_KEY",
      name: "OpenMuse brex",
      credentials: {},
    },
  });
  const sessions_ = calls.filter((c) => c.path === "/api/v3.1/tool_router/session");
  assert.deepEqual(
    (sessions_.at(-1)?.body as { auth_configs?: unknown } | undefined)?.auth_configs,
    { brex: "ac_made" },
  );
});

test("actions the person always allows run straight away; purchases and deletes still ask", async () => {
  assert.equal(destructiveAction("OUTLOOK_DELETE_MESSAGE", "outlook"), true);
  assert.equal(destructiveAction("STRIPE_CANCEL_SUBSCRIPTION", "stripe"), true);
  assert.equal(destructiveAction("GOOGLECALENDAR_CREATE_EVENT", "googlecalendar"), false);
  assert.equal(destructiveAction("SLACK_SEND_MESSAGE", "slack", ["destructiveHint"]), true);

  const rules = new ApprovalRules(db);
  const owner = "allower";
  await rules.add(owner, { app: "GoogleCalendar" });
  await rules.add(owner, { app: "outlook", tool: "outlook_delete_message" });
  assert.deepEqual(
    (await rules.list(owner)).map((r) => r.id),
    ["app:googlecalendar", "tool:OUTLOOK_DELETE_MESSAGE"],
  );
  const destructive = (slug: string) => ({
    slug,
    app: slug.split("_")[0]?.toLowerCase() ?? "",
    destructive: destructiveAction(slug, slug.split("_")[0] ?? ""),
  });
  assert.equal(
    await rules.allows(owner, destructive("GOOGLECALENDAR_CREATE_EVENT")),
    "Googlecalendar actions",
  );
  assert.equal(await rules.allows(owner, destructive("GOOGLECALENDAR_DELETE_EVENT")), undefined);
  assert.match(
    (await rules.allows(owner, destructive("OUTLOOK_DELETE_MESSAGE"))) ?? "",
    /OUTLOOK_DELETE_MESSAGE/,
  );
  assert.equal(await rules.allows(owner, destructive("OUTLOOK_SEND_EMAIL")), undefined);
  assert.equal(
    await rules.allows("someone-else", destructive("GOOGLECALENDAR_CREATE_EVENT")),
    undefined,
  );

  const { apps } = fakeApps({
    tool: async (_owner, slug) => ({
      slug,
      name: slug,
      description: "",
      app: slug.split("_")[0]?.toLowerCase() ?? "",
      readOnly: false,
      destructive: destructiveAction(slug, slug.split("_")[0] ?? ""),
    }),
  });
  const approved: string[] = [];
  const specs = appToolSpecs(
    apps,
    owner,
    async (action) => ({ id: `action-${action.tool}`, title: action.summary, hash: "h" }),
    { check: async () => undefined },
    {
      allowed: (tool) => rules.allows(owner, tool),
      approve: async ({ id }) => {
        approved.push(id);
        return { status: "succeeded", result: "Event created" };
      },
    },
  );
  const run = specs.find((s) => s.name === "use_app")?.execute as (
    args: unknown,
  ) => Promise<Record<string, unknown>>;
  const created = await run({
    tool: "GOOGLECALENDAR_CREATE_EVENT",
    arguments: { title: "Dentist" },
    summary: "Add the dentist to the calendar",
  });
  assert.equal(created.status, "done");
  assert.match(String(created.message), /the person allowed Googlecalendar actions/);
  const removed = await run({
    tool: "GOOGLECALENDAR_DELETE_EVENT",
    arguments: { id: "e1" },
    summary: "Delete the dentist event",
  });
  assert.equal(removed.status, "awaiting_review");
  await rules.add(owner, { app: "shopify" });
  const bought = await run({
    tool: "SHOPIFY_CREATE_ORDER",
    arguments: { item: "mug" },
    summary: "Order a mug",
    amountUsd: 12,
  });
  assert.equal(bought.status, "awaiting_review", "purchases always ask");
  assert.deepEqual(approved, ["action-GOOGLECALENDAR_CREATE_EVENT"]);
});

test("a read-only app never changes anything, and an hour's grant runs out", async () => {
  const db = await createStore();
  let now = Date.parse("2026-09-27T12:00:00Z");
  const rules = new ApprovalRules(db, () => now);
  const owner = "careful";
  await rules.setReadOnly(owner, { app: "slack", readOnly: true });
  assert.deepEqual(await rules.readOnlyApps(owner), ["slack"]);
  assert.match(
    (await rules.blocked(owner, { app: "slack", readOnly: false })) ?? "",
    /Slack is set to read-only/,
  );
  assert.equal(await rules.blocked(owner, { app: "slack", readOnly: true }), undefined);
  assert.equal(await rules.blocked(owner, { app: "outlook", readOnly: false }), undefined);
  assert.equal(await rules.blocked("someone-else", { app: "slack", readOnly: false }), undefined);

  const { apps } = fakeApps({
    tool: async (_owner, slug) => ({
      slug,
      name: slug,
      description: "",
      app: "slack",
      readOnly: slug.includes("LIST"),
      destructive: false,
    }),
    execute: async () => ({ channels: ["general"] }),
  });
  const proposed: string[] = [];
  const specs = appToolSpecs(
    apps,
    owner,
    async (action) => {
      proposed.push(action.tool);
      return { id: "a1", title: action.summary, hash: "h" };
    },
    { check: async () => undefined },
    {
      allowed: (tool) => rules.allows(owner, tool),
      blocked: (tool) => rules.blocked(owner, tool),
      approve: async () => ({ status: "succeeded" }),
    },
  );
  const run = specs.find((s) => s.name === "use_app")?.execute as (
    args: unknown,
  ) => Promise<Record<string, unknown>>;
  const sent = await run({
    tool: "SLACK_SEND_MESSAGE",
    arguments: { text: "hi" },
    summary: "Say hi in #general",
  });
  assert.match(String(sent.error), /read-only/);
  assert.deepEqual(proposed, [], "nothing even goes to review");
  assert.ok((await run({ tool: "SLACK_LIST_CHANNELS", arguments: {}, summary: "List" })).result);
  await rules.setReadOnly(owner, { app: "slack", readOnly: false });
  assert.deepEqual(await rules.readOnlyApps(owner), []);

  await rules.add(owner, { app: "outlook", tool: "OUTLOOK_SEND_EMAIL", hours: 1 });
  const send = { slug: "OUTLOOK_SEND_EMAIL", app: "outlook" };
  assert.match((await rules.allows(owner, send)) ?? "", /OUTLOOK_SEND_EMAIL/);
  now += 61 * 60_000;
  assert.equal(await rules.allows(owner, send), undefined, "the hour is up");
  assert.deepEqual(await rules.list(owner), []);
});

test("emails a Gmail look-up reads come back as cards to open, and connect_app names its app", async () => {
  const { apps } = fakeApps({
    tool: async (_owner, slug) => ({
      slug,
      name: slug,
      description: "",
      app: "gmail",
      readOnly: true,
    }),
    execute: async () => ({
      data: {
        messages: [
          { messageId: "m1", sender: "Dan", subject: "Q3", messageText: "Numbers attached." },
        ],
      },
    }),
  });
  const saved: unknown[] = [];
  const specs = appToolSpecs(
    apps,
    "owner",
    async () => ({ id: "x", title: "x" }),
    undefined,
    undefined,
    {
      save: async (_owner, emails) => {
        saved.push(...emails);
        return emails.map((email, index) => ({
          id: `v${index}`,
          app: email.app,
          from: email.from,
          subject: email.subject,
          preview: email.body,
        }));
      },
    },
  );
  const run = specs.find((s) => s.name === "use_app")?.execute as (
    args: unknown,
  ) => Promise<Record<string, unknown>>;
  const read = await run({ tool: "GMAIL_FETCH_EMAILS", arguments: {}, summary: "Read Gmail" });
  assert.deepEqual(read.emails, [
    { id: "v0", app: "gmail", from: "Dan", subject: "Q3", preview: "Numbers attached." },
  ]);
  assert.match(String(read.shown), /on the person's screen as cards/);
  assert.equal(saved.length, 1);
  const connect = specs.find((s) => s.name === "connect_app")?.execute as (
    args: unknown,
  ) => Promise<Record<string, unknown>>;
  const link = await connect({ app: "gmail" });
  assert.equal(link.app, "gmail");
  assert.equal(link.connected, false);
  assert.equal(link.url, "https://connect.test/outlook");
});

test("connect_app on an app that's already connected says to go ahead and use it", async () => {
  const { apps } = fakeApps({ connect: async () => ({ connected: true }) });
  const specs = appToolSpecs(apps, "owner", async () => ({ id: "x", title: "x" }));
  const connect = specs.find((s) => s.name === "connect_app")?.execute as (
    args: unknown,
  ) => Promise<Record<string, unknown>>;
  const result = await connect({ app: "gmail" });
  assert.equal(result.connected, true);
  assert.equal(result.url, undefined);
  assert.match(String(result.next), /use it now with find_app_actions and use_app/);
  assert.match(String(result.next), /Don't ask them to connect it again/);
});
