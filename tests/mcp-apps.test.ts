import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { createApp } from "../apps/server/src/app.ts";
import { ApprovalRules } from "../apps/server/src/approval-rules.ts";
import { appToolSpecs } from "../apps/server/src/apps.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  CombinedApps,
  guardedFetch,
  McpApps,
  ownAppToolSpecs,
  privateAddress,
} from "../apps/server/src/mcp-apps.ts";

let db: Store, directory: string;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-mcp-"));
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});
const encryptionKey = randomBytes(32).toString("base64");
const config = (): Config => ({
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir: directory,
  agentBackend: "sample",
  intelligenceApiKey: "test-project-key-never-sent",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: ["http://localhost:8081"],
  encryptionKey,
});

/**
 * Todd's CRM as an MCP server, answered in memory. It takes an access key, or a sign-in on its own
 * page (OAuth with registration and PKCE), or nothing.
 */
function toddCrm(options: { key?: string; oauth?: boolean } = {}) {
  const base = "https://todd.test";
  const created: string[] = [];
  const seen: string[] = [];
  let challenge = "";
  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    seen.push(`${request.method} ${url.pathname}`);
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
      return options.oauth
        ? Response.json({ resource: `${base}/mcp`, authorization_servers: [base] })
        : new Response("Not found", { status: 404 });
    if (url.pathname.startsWith("/.well-known/"))
      return options.oauth && url.pathname.includes("oauth-authorization-server")
        ? Response.json({
            issuer: base,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/token`,
            registration_endpoint: `${base}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
          })
        : new Response("Not found", { status: 404 });
    if (url.pathname === "/register" && options.oauth) {
      const body = (await request.json()) as Record<string, unknown>;
      return Response.json({ ...body, client_id: "client-1" }, { status: 201 });
    }
    if (url.pathname === "/token" && options.oauth) {
      const form = new URLSearchParams(await request.text());
      const verifier = form.get("code_verifier") ?? "";
      if (
        form.get("code") !== "code-1" ||
        createHash("sha256").update(verifier).digest("base64url") !== challenge
      )
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({
        access_token: "token-1",
        token_type: "Bearer",
        refresh_token: "refresh-1",
        expires_in: 3600,
      });
    }
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    const expected = options.key
      ? `Bearer ${options.key}`
      : options.oauth
        ? "Bearer token-1"
        : undefined;
    if (expected && request.headers.get("authorization") !== expected)
      return new Response("Unauthorized", {
        status: 401,
        headers: options.oauth
          ? {
              "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
            }
          : {},
      });
    const server = new McpServer({ name: "todd-crm", version: "1.0.0" });
    server.registerTool(
      "listContacts",
      { description: "List the contacts in Todd's CRM", annotations: { readOnlyHint: true } },
      async () => ({ content: [{ type: "text", text: JSON.stringify([{ name: "Dana" }]) }] }),
    );
    server.registerTool(
      "create_contact",
      { description: "Create a contact in the CRM", inputSchema: { name: z.string() } },
      async ({ name }) => {
        created.push(name);
        return { content: [{ type: "text", text: `Created ${name}` }] };
      },
    );
    server.registerTool(
      "delete_contact",
      { description: "Delete a contact from the CRM", inputSchema: { name: z.string() } },
      async () => ({ content: [{ type: "text", text: "Deleted" }] }),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  };
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) =>
    handle(new Request(input instanceof Request ? input : String(input), init))) as typeof fetch;
  return {
    url: `${base}/mcp`,
    fetcher,
    created,
    seen,
    challengeFrom(signIn: string) {
      challenge = new URL(signIn).searchParams.get("code_challenge") ?? "";
      return new URL(signIn).searchParams.get("state") ?? "";
    },
  };
}
const mcpFor = (app: ReturnType<typeof toddCrm>) =>
  new McpApps(
    db,
    { publicUrl: "http://localhost:8787", encryptionKey },
    {
      allowPrivate: true,
      fetch: app.fetcher,
    },
  );

test("private and local addresses are never fetched, even after a redirect", async () => {
  for (const address of [
    "127.0.0.1",
    "10.2.3.4",
    "169.254.169.254",
    "::1",
    "fd12::1",
    "::ffff:192.168.1.5",
  ])
    assert.equal(privateAddress(address), true, address);
  for (const address of ["93.184.216.34", "2606:4700::1111"])
    assert.equal(privateAddress(address), false, address);
  const reached: string[] = [];
  const base = (async (url: string | URL) => {
    reached.push(String(url));
    return new Response("", {
      status: 302,
      headers: { location: "https://169.254.169.254/latest" },
    });
  }) as typeof fetch;
  const guarded = guardedFetch(false, base);
  for (const address of [
    "http://93.184.216.34/mcp",
    "https://localhost/mcp",
    "https://printer.local/mcp",
    "https://10.0.0.8/mcp",
    "https://[::1]/mcp",
  ])
    await assert.rejects(guarded(address), /https:\/\/|private network/, address);
  assert.deepEqual(reached, []);
  await assert.rejects(guarded("https://93.184.216.34/mcp"), /private network/);
  assert.deepEqual(reached, ["https://93.184.216.34/mcp"]);
});

test("an app with an access key connects, lists its actions and keeps the key sealed", async () => {
  const crm = toddCrm({ key: "todd-key-123" });
  const mcp = mcpFor(crm);
  const without = await mcp.add("kay", { name: "Todd CRM", url: crm.url });
  assert.equal(without.connected, false);
  assert.equal(without.app.status, "needs_key");
  assert.match(without.app.error ?? "", /access key/);
  const wrong = await mcp.setKey("kay", "my_todd_crm", { key: "nope" });
  assert.equal(wrong.app.status, "needs_key");
  assert.match(wrong.app.error ?? "", /didn't accept/);
  const right = await mcp.setKey("kay", "my_todd_crm", { key: "todd-key-123" });
  assert.equal(right.connected, true);
  assert.deepEqual(
    { ...right.app, updatedAt: undefined },
    {
      id: "my_todd_crm",
      name: "Todd CRM",
      host: "todd.test",
      status: "connected",
      addedBy: "person",
      actions: 3,
      hasKey: true,
      updatedAt: undefined,
    },
  );
  const stored = JSON.stringify(await db.list("kay", "mcp-servers"));
  assert.ok(!stored.includes("todd-key-123"), "the key is encrypted");
  assert.ok(!stored.includes("https://todd.test/mcp"), "the address is encrypted");
  // Nothing answering at the address: not kept, and the person is told to check it.
  await assert.rejects(
    mcp.add("kay", { name: "Todd CRM", url: "https://todd.test/", key: "todd-key-123" }),
    /Check the full address/,
  );
  assert.equal((await mcp.list("kay")).length, 1);
  // A second app with the same name gets its own slug.
  const again = await mcp.add("kay", { name: "Todd CRM", url: crm.url, key: "todd-key-123" });
  assert.equal(again.app.id, "my_todd_crm_2");
  await mcp.remove("kay", "my_todd_crm_2");
});

test("own-app look-ups run now, changes wait for review, and deletes never ride an app-wide grant", async () => {
  const crm = toddCrm({ key: "k-1" });
  const mcp = mcpFor(crm);
  await mcp.add("lee", { name: "Todd CRM", url: crm.url, key: "k-1" });
  const apps = new CombinedApps(undefined, mcp);
  const proposed: unknown[] = [];
  const specs = appToolSpecs(apps, "lee", async (action) => {
    proposed.push(action);
    return { id: "action-1", title: action.summary };
  });
  const run = (name: string) =>
    specs.find((s) => s.name === name)?.execute as (
      args: unknown,
    ) => Promise<Record<string, unknown>>;
  const found = (await run("find_app_actions")({ query: "contacts in the CRM" })) as {
    actions: { slug: string; needsApproval: boolean; destructive?: boolean; app: string }[];
  };
  assert.deepEqual(
    found.actions
      .map((a) => ({ slug: a.slug, needsApproval: a.needsApproval, destructive: a.destructive }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
    [
      { slug: "MY_TODD_CRM_CREATE_CONTACT", needsApproval: true, destructive: false },
      { slug: "MY_TODD_CRM_DELETE_CONTACT", needsApproval: true, destructive: true },
      { slug: "MY_TODD_CRM_LIST_CONTACTS", needsApproval: false, destructive: false },
    ],
  );
  const read = await run("use_app")({
    tool: "MY_TODD_CRM_LIST_CONTACTS",
    arguments: {},
    summary: "List contacts in Todd CRM",
  });
  assert.deepEqual(read, { result: { data: [{ name: "Dana" }] } });
  const write = await run("use_app")({
    tool: "MY_TODD_CRM_CREATE_CONTACT",
    arguments: { name: "Dana" },
    summary: "Add Dana to Todd CRM",
  });
  assert.equal(write.status, "awaiting_review");
  assert.deepEqual(crm.created, []);
  assert.deepEqual(proposed, [
    {
      app: "my_todd_crm",
      tool: "MY_TODD_CRM_CREATE_CONTACT",
      summary: "Add Dana to Todd CRM",
      arguments: { name: "Dana" },
    },
  ]);
  // Approved, it runs in the app itself.
  assert.equal(
    await apps.execute("lee", "MY_TODD_CRM_CREATE_CONTACT", { name: "Dana" }),
    "Created Dana",
  );
  assert.deepEqual(crm.created, ["Dana"]);
  const rules = new ApprovalRules(db);
  await rules.add("lee", { app: "my_todd_crm" });
  await rules.add("lee", { app: "my_todd_crm", tool: "MY_TODD_CRM_CREATE_CONTACT" });
  assert.ok(await rules.allows("lee", await apps.tool("lee", "MY_TODD_CRM_CREATE_CONTACT")));
  assert.equal(
    await rules.allows("lee", await apps.tool("lee", "MY_TODD_CRM_DELETE_CONTACT")),
    undefined,
  );
  assert.deepEqual(await apps.connections("lee"), [
    {
      app: "my_todd_crm",
      name: "Todd CRM",
      connected: true,
      description: "Your own app at todd.test",
    },
  ]);
  // Removing the app takes its grants with it.
  await apps.disconnect("lee", "my_todd_crm");
  assert.deepEqual(await rules.list("lee"), []);
  await assert.rejects(apps.tool("lee", "MY_TODD_CRM_CREATE_CONTACT"), /Unknown app action/);
});

test("an app with its own sign-in page: register, sign in, and come back connected", async () => {
  const crm = toddCrm({ oauth: true });
  const mcp = mcpFor(crm);
  const server = await createApp(db, config(), { mcp });
  const session = await server.app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const headers = {
    Authorization: `Bearer ${(await session.json()).token}`,
    "Content-Type": "application/json",
  };
  const added = await server.app.request("/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Todd CRM", url: crm.url }),
  });
  assert.equal(added.status, 201);
  const { connected, url, app } = (await added.json()) as {
    connected: boolean;
    url: string;
    app: { status: string };
  };
  assert.equal(connected, false);
  assert.equal(app.status, "needs_sign_in");
  const signIn = new URL(url);
  assert.equal(signIn.origin + signIn.pathname, "https://todd.test/authorize");
  assert.equal(signIn.searchParams.get("client_id"), "client-1");
  assert.equal(signIn.searchParams.get("redirect_uri"), "http://localhost:8787/api/mcp/callback");
  const state = crm.challengeFrom(url);
  // A made-up state is turned away; the real one finishes the sign-in once.
  const forged = await server.app.request("/api/mcp/callback?state=forged&code=code-1");
  assert.equal(forged.status, 400);
  assert.match(await forged.text(), /expired/);
  const back = await server.app.request(
    `/api/mcp/callback?state=${encodeURIComponent(state)}&code=code-1`,
  );
  assert.equal(back.status, 200);
  assert.match(await back.text(), /Signed in to Todd CRM/);
  const replay = await server.app.request(
    `/api/mcp/callback?state=${encodeURIComponent(state)}&code=code-1`,
  );
  assert.equal(replay.status, 400);
  const list = (await (await server.app.request("/api/mcp", { headers })).json()) as {
    apps: { id: string; status: string; actions: number }[];
  };
  assert.deepEqual(
    list.apps.map((a) => ({ id: a.id, status: a.status, actions: a.actions })),
    [{ id: "my_todd_crm", status: "connected", actions: 3 }],
  );
  const stored = JSON.stringify(await db.list("local-user", "mcp-servers"));
  assert.ok(!stored.includes("token-1") && !stored.includes("refresh-1"), "tokens are encrypted");
  const everything = (await (await server.app.request("/api/apps", { headers })).json()) as {
    apps: { app: string; connected: boolean }[];
  };
  assert.ok(everything.apps.some((a) => a.app === "my_todd_crm" && a.connected));
  const removed = await server.app.request("/api/mcp/my_todd_crm/delete", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(removed.status, 200);
});

test("an app the agent adds stays off until the person connects it", async () => {
  const crm = toddCrm();
  const mcp = mcpFor(crm);
  const apps = new CombinedApps(undefined, mcp);
  const [add] = ownAppToolSpecs(apps, "max");
  assert.ok(add);
  const saved = (await add.execute({ name: "Todd CRM", url: crm.url })) as {
    saved: { status: string };
  };
  assert.equal(saved.saved.status, "needs_confirm");
  assert.deepEqual(crm.seen, [], "nothing is sent to the app before the person connects it");
  await assert.rejects(apps.connect("max", "my_todd_crm"), /waiting for the person/);
  const connected = await mcp.connect("max", "my_todd_crm");
  assert.equal(connected.connected, true);
  assert.deepEqual(await apps.connect("max", "my_todd_crm"), { connected: true });
  assert.deepEqual(ownAppToolSpecs(undefined, "max"), []);
});
