import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ActionService } from "../apps/server/src/actions.ts";
import { createApp } from "../apps/server/src/app.ts";
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
    (await connector.connections("search")).map((c) => [c.app, c.connected]),
    [
      ["slack", true],
      ["notion", false],
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
      assert.match(error.message, /Brex needs to be set up in Composio.*Auth Configs.*API Key/);
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
