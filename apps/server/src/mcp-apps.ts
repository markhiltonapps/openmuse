import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "../../../packages/integrations/src/vault.ts";
import { destructiveAction } from "./approval-rules.ts";
import {
  type AppConnection,
  type AppConnector,
  type AppSearch,
  type AppTool,
  readOnlyAction,
} from "./apps.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/**
 * "Your own apps": any app that offers an MCP server, connected by its web address. The agent
 * uses its actions like any connected app: look-ups run now, changes wait for the person.
 */

export type OwnAppStatus = "connected" | "needs_sign_in" | "needs_key" | "needs_confirm" | "error";
interface OwnTool {
  slug: string;
  /** The app's own name for the action, sent back when it runs. */
  name: string;
  title?: string;
  description: string;
  readOnly: boolean;
  destructive: boolean;
  parameters?: unknown;
}
interface OwnApp {
  /** Also its app slug: my_ and the name, so reviews read "My Todd Crm". */
  id: string;
  name: string;
  /** Shown to the person; the full address is kept encrypted because it can carry a key. */
  host: string;
  url: string;
  key?: string;
  oauth?: { client?: string; tokens?: string; discovery?: unknown };
  status: OwnAppStatus;
  error?: string;
  addedBy: "person" | "agent";
  tools: OwnTool[];
  toolsAt?: string;
  createdAt: string;
  updatedAt: string;
}
interface SignInState {
  id: string;
  owner: string;
  app: string;
  verifier: string;
  expiresAt: number;
}
export interface OwnAppView {
  id: string;
  name: string;
  host: string;
  status: OwnAppStatus;
  error?: string;
  addedBy: "person" | "agent";
  actions: number;
  hasKey: boolean;
  updatedAt: string;
}

const KIND = "mcp-servers";
const STATES = "mcp-oauth";
const MAX_APPS = 20;
const MAX_TOOLS = 200;
/** How long a sign-in page stays good for. */
const SIGN_IN_MINUTES = 10;
/** Words that say nothing about which action is wanted. */
const COMMON = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "all",
  "any",
  "my",
]);
/** Action lists older than this are read again before a search. */
const TOOLS_FRESH_MS = 6 * 60 * 60 * 1000;

export const ownAppSchema = z.object({
  name: z.string().trim().min(1, "Give the app a name").max(60),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => URL.canParse(value), "Enter the full web address, starting with https://"),
  key: z.string().trim().max(4000).optional(),
});

const blocked = new BlockList();
for (const [network, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(network, bits, "ipv4");
for (const [network, bits] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(network, bits, "ipv6");
/** Loopback, private, link-local and other addresses a server must not be sent to. */
export function privateAddress(address: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return blocked.check(mapped, "ipv4");
  if (isIP(address) === 4) return blocked.check(address, "ipv4");
  if (isIP(address) === 6) return blocked.check(address, "ipv6") || /^::ffff:/i.test(address);
  return true;
}

/**
 * Fetch for addresses the person typed: https only, never the server's own network, and each
 * redirect checked the same way. `allowPrivate` is for tests against a local server.
 */
export function guardedFetch(allowPrivate = false, base: typeof fetch = fetch): typeof fetch {
  const check = async (url: URL) => {
    if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:"))
      throw new AppError("Use a web address that starts with https://", 422);
    if (allowPrivate) return;
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (
      host === "localhost" ||
      /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host) ||
      (!isIP(host) && !host.includes("."))
    )
      throw new AppError("That address is on a private network, which can't be used.", 422);
    const addresses = isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true, verbatim: true }).catch(() => {
          throw new AppError(`Couldn't find ${host}. Check the address.`, 422);
        });
    if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
      throw new AppError("That address is on a private network, which can't be used.", 422);
  };
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const first = new URL(input instanceof Request ? input.url : String(input));
    let url = first;
    let options: RequestInit = { ...init };
    for (let hop = 0; ; hop++) {
      await check(url);
      const timeout = AbortSignal.timeout(120000);
      const response = await base(url, {
        ...options,
        redirect: "manual",
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) return response;
      if (hop >= 3)
        throw new AppError("The app redirected too many times. Check the address.", 502);
      url = new URL(location, url);
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && options.method === "POST")
      )
        options = { ...options, method: "GET", body: undefined };
      // Like a browser: a key for one site isn't passed on to another.
      if (url.origin !== first.origin) {
        const headers = new Headers(options.headers);
        headers.delete("authorization");
        options = { ...options, headers };
      }
    }
  }) as typeof fetch;
}

/** "Todd's CRM" → my_todd_s_crm, unique among the person's apps. */
function appId(name: string, taken: Set<string>) {
  const base = `my_${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^my_/, "")
      .slice(0, 30)
      .replace(/_+$/, "") || "app"
  }`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
}
/** createContact → CREATE_CONTACT, the way other apps' actions are named. */
function actionWord(name: string) {
  return (
    name
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 150) || "ACTION"
  );
}
interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean };
}
function toTools(app: string, listed: ListedTool[]): OwnTool[] {
  const prefix = app.toUpperCase();
  const seen = new Set<string>();
  return listed.slice(0, MAX_TOOLS).flatMap((tool) => {
    if (typeof tool.name !== "string" || !/^[\w.\-/]{1,128}$/.test(tool.name)) return [];
    const word = actionWord(tool.name);
    let slug = `${prefix}_${word}`;
    for (let n = 2; seen.has(slug); n++) slug = `${prefix}_${word}_${n}`;
    seen.add(slug);
    const hints = tool.annotations ?? {};
    // The app's own hints first; without them, the action's name decides, as for other apps.
    const readOnly =
      hints.readOnlyHint ?? (hints.destructiveHint !== true && readOnlyAction(slug, app, []));
    const schema = JSON.stringify(tool.inputSchema ?? {});
    return [
      {
        slug,
        name: tool.name,
        ...(tool.title || hints.title ? { title: String(tool.title || hints.title) } : {}),
        description: String(tool.description ?? "").slice(0, 1500),
        readOnly,
        destructive: !readOnly && (hints.destructiveHint ?? destructiveAction(slug, app)),
        parameters: schema.length <= 8000 ? tool.inputSchema : { type: "object" },
      },
    ];
  });
}
/** A tool result as data: its structured content, else its text (parsed when it is JSON). */
function resultData(result: {
  content?: { type: string; text?: string; uri?: string; name?: string; mimeType?: string }[];
  structuredContent?: unknown;
}) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const parts = (result.content ?? []).map((part) =>
    part.type === "text"
      ? (part.text ?? "")
      : part.type === "resource_link"
        ? { link: part.uri, name: part.name }
        : `[${part.mimeType ?? part.type}]`,
  );
  const text = parts.every((p) => typeof p === "string") ? parts.join("\n") : undefined;
  if (text === undefined) return parts;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 300);
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** Keeps an app's sign-in (client registration, tokens, the page to sign in on) with the app. */
class StoredProvider implements OAuthClientProvider {
  signInUrl?: URL;
  private state_?: string;
  private verifier_?: string;
  constructor(
    private readonly apps: McpApps,
    private readonly owner: string,
    private app: OwnApp,
    /** The code check from the sign-in being finished. */
    private readonly saved?: string,
  ) {}
  get redirectUrl() {
    return this.apps.redirectUrl;
  }
  get clientMetadataUrl() {
    return this.apps.clientMetadataUrl;
  }
  get clientMetadata(): OAuthClientMetadata {
    return this.apps.clientMetadata;
  }
  state() {
    this.state_ = randomBytes(32).toString("base64url");
    return this.state_;
  }
  clientInformation(): OAuthClientInformationMixed | undefined {
    const client = this.app.oauth?.client;
    return client ? JSON.parse(this.apps.open(client)) : undefined;
  }
  async saveClientInformation(info: OAuthClientInformationMixed) {
    await this.change((oauth) => ({ ...oauth, client: this.apps.seal(JSON.stringify(info)) }));
  }
  tokens(): OAuthTokens | undefined {
    const tokens = this.app.oauth?.tokens;
    return tokens ? JSON.parse(this.apps.open(tokens)) : undefined;
  }
  async saveTokens(tokens: OAuthTokens) {
    await this.change((oauth) => ({ ...oauth, tokens: this.apps.seal(JSON.stringify(tokens)) }));
  }
  saveCodeVerifier(verifier: string) {
    this.verifier_ = verifier;
  }
  codeVerifier() {
    if (!this.saved) throw new AppError("No sign-in is in progress", 409);
    return this.saved;
  }
  discoveryState() {
    return this.app.oauth?.discovery as OAuthDiscoveryState | undefined;
  }
  async saveDiscoveryState(discovery: OAuthDiscoveryState) {
    await this.change((oauth) => ({ ...oauth, discovery }));
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    await this.change((oauth) => {
      if (scope === "all") return {};
      const { client, tokens, discovery } = oauth;
      return {
        ...(scope === "client" ? {} : { client }),
        ...(scope === "tokens" ? {} : { tokens }),
        ...(scope === "discovery" ? {} : { discovery }),
      };
    });
  }
  /** Keeps the state and code check for the callback, and the page for the person. */
  async redirectToAuthorization(url: URL) {
    if (!this.state_ || !this.verifier_) throw new AppError("The sign-in couldn't start", 502);
    if (!["https:", ...(this.apps.allowPrivate ? ["http:"] : [])].includes(url.protocol))
      throw new AppError("The app's sign-in page isn't a secure web address", 502);
    // Sign-ins started and never finished don't pile up.
    for (const old of await this.apps.db.list<SignInState>("system", STATES))
      if (old.expiresAt < this.apps.now()) await this.apps.db.remove("system", STATES, old.id);
    await this.apps.db.put<SignInState>("system", STATES, {
      id: McpApps.stateId(this.state_),
      owner: this.owner,
      app: this.app.id,
      verifier: this.apps.seal(this.verifier_),
      expiresAt: this.apps.now() + SIGN_IN_MINUTES * 60 * 1000,
    });
    this.signInUrl = url;
  }
  private async change(
    update: (oauth: NonNullable<OwnApp["oauth"]>) => NonNullable<OwnApp["oauth"]>,
  ) {
    this.app = await this.apps.patch(this.owner, this.app.id, (app) => ({
      ...app,
      oauth: update(app.oauth ?? {}),
    }));
  }
}

export class McpApps {
  readonly redirectUrl: string;
  readonly clientMetadataUrl?: string;
  readonly allowPrivate: boolean;
  private readonly fetch: typeof fetch;
  constructor(
    readonly db: Store,
    private readonly config: { publicUrl: string; encryptionKey?: string },
    options: { allowPrivate?: boolean; fetch?: typeof fetch; now?: () => number } = {},
  ) {
    const base = config.publicUrl.replace(/\/+$/, "");
    this.redirectUrl = `${base}/api/mcp/callback`;
    // Sign-in servers that accept a published client description use this instead of registering.
    this.clientMetadataUrl = base.startsWith("https://") ? `${base}/api/mcp/client` : undefined;
    this.allowPrivate = options.allowPrivate === true;
    this.fetch = guardedFetch(this.allowPrivate, options.fetch);
    if (options.now) this.now = options.now;
  }
  now = () => Date.now();
  static stateId(state: string) {
    return createHash("sha256").update(state).digest("hex");
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Neato_Muse",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  /** The published client description, for sign-in servers that fetch it. */
  clientDocument() {
    return { client_id: this.clientMetadataUrl, ...this.clientMetadata };
  }
  private key() {
    if (!this.config.encryptionKey)
      throw new AppError(
        "Connecting your own apps needs TOKEN_ENCRYPTION_KEY set on the server.",
        503,
      );
    return this.config.encryptionKey;
  }
  seal(text: string) {
    return encryptSecret(text, this.key());
  }
  open(sealed: string) {
    return decryptSecret(sealed, this.key());
  }
  private view(app: OwnApp): OwnAppView {
    return {
      id: app.id,
      name: app.name,
      host: app.host,
      status: app.status,
      ...(app.error ? { error: app.error } : {}),
      addedBy: app.addedBy,
      actions: app.tools.length,
      hasKey: Boolean(app.key),
      updatedAt: app.updatedAt,
    };
  }
  private async all(owner: string) {
    return this.db.list<OwnApp>(owner, KIND);
  }
  private async get(owner: string, id: string) {
    const app = /^my_[a-z0-9_]{1,40}$/.test(id) ? await this.db.get<OwnApp>(owner, KIND, id) : null;
    if (!app) throw new AppError("That app isn't connected", 404);
    return app;
  }
  async patch(owner: string, id: string, update: (app: OwnApp) => OwnApp) {
    const next = {
      ...update(await this.get(owner, id)),
      updatedAt: new Date(this.now()).toISOString(),
    };
    await this.db.put(owner, KIND, next);
    return next;
  }
  async list(owner: string) {
    return (await this.all(owner))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((app) => this.view(app));
  }
  /**
   * Adds an app by its address. The person's own add connects straight away; one the agent adds
   * waits until the person checks the address and connects it, so a page can't slip one in.
   */
  async add(owner: string, raw: unknown, addedBy: "person" | "agent" = "person") {
    const input = ownAppSchema.parse(raw);
    const url = new URL(input.url);
    if (url.protocol !== "https:" && !(this.allowPrivate && url.protocol === "http:"))
      throw new AppError("Use a web address that starts with https://", 422);
    if (url.username || url.password)
      throw new AppError("Leave the sign-in out of the address; add a key instead.", 422);
    url.hash = "";
    const existing = await this.all(owner);
    if (existing.length >= MAX_APPS)
      throw new AppError(`You can connect up to ${MAX_APPS} of your own apps.`, 409);
    const now = new Date(this.now()).toISOString();
    const app: OwnApp = {
      id: appId(input.name, new Set(existing.map((a) => a.id))),
      name: input.name,
      host: url.host,
      url: this.seal(url.toString()),
      ...(input.key && addedBy === "person" ? { key: this.seal(input.key) } : {}),
      status: addedBy === "agent" ? "needs_confirm" : "error",
      addedBy,
      tools: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.db.put(owner, KIND, app);
    if (addedBy === "agent") return { connected: false, app: this.view(app) };
    let result: Awaited<ReturnType<McpApps["connect"]>>;
    try {
      result = await this.connect(owner, app.id);
    } catch (error) {
      // A refused address isn't kept: the person fixes it and adds it again.
      await this.db.remove(owner, KIND, app.id);
      throw error;
    }
    if (result.connected || result.url || result.app.status !== "error") return result;
    // Nothing answered at that address (often it's missing the /mcp at the end): not kept either.
    await this.db.remove(owner, KIND, app.id);
    throw new AppError(
      "Couldn't reach an app at that address. Check the full address (it usually ends in /mcp).",
      422,
    );
  }
  /**
   * Connecting on the agent's behalf. An app the agent added stays off until the person checks its
   * address and connects it; that, a sign-in page or an access key all happen on its Connect card.
   */
  async reconnect(owner: string, id: string) {
    const app = await this.get(owner, id);
    if (app.status === "connected") return { connected: true };
    if (app.status === "needs_confirm") return { connected: false, own: true };
    const result = await this.connect(owner, id);
    if (result.connected) return { connected: true };
    return { connected: false, own: true, ...(result.url ? { url: result.url } : {}) };
  }
  /** A new access key, or none to sign in on the app's own page instead. */
  async setKey(owner: string, id: string, raw: unknown) {
    const { key } = z.object({ key: z.string().trim().max(4000).optional() }).parse(raw);
    await this.patch(owner, id, ({ key: _old, oauth: _oauth, ...app }) => ({
      ...app,
      ...(key ? { key: this.seal(key) } : {}),
    }));
    return this.connect(owner, id);
  }
  /**
   * Opens the app and reads its actions. Returns the page to sign in on when the app has one and
   * the person hasn't signed in yet.
   */
  async connect(
    owner: string,
    id: string,
  ): Promise<{ connected: boolean; url?: string; app: OwnAppView }> {
    const app = await this.get(owner, id);
    const provider = app.key ? undefined : new StoredProvider(this, owner, app);
    const settle = async (change: Partial<OwnApp>) => {
      const next = await this.patch(owner, id, ({ error: _error, ...current }) => ({
        ...current,
        ...change,
      }));
      return this.view(next);
    };
    try {
      const tools = await this.session(owner, app, (client) => this.listTools(client), provider);
      return {
        connected: true,
        app: await settle({
          status: "connected",
          tools: toTools(app.id, tools),
          toolsAt: new Date(this.now()).toISOString(),
        }),
      };
    } catch (error) {
      if (provider?.signInUrl)
        return {
          connected: false,
          url: provider.signInUrl.toString(),
          app: await settle({ status: "needs_sign_in" }),
        };
      if (error instanceof AppError && error.status === 422) {
        await settle({ status: "error", error: error.message });
        throw error;
      }
      const refused = error instanceof UnauthorizedError || unauthorized(error);
      if (refused || (!app.key && isSignInFailure(error)))
        return {
          connected: false,
          app: await settle({
            status: "needs_key",
            error: app.key
              ? "The app didn’t accept that access key."
              : "This app didn’t offer a sign-in page. Add the access key it gave you.",
          }),
        };
      return {
        connected: false,
        app: await settle({ status: "error", error: `Couldn't connect: ${errorText(error)}` }),
      };
    }
  }
  /** Finishes a sign-in on the app's page: keeps the tokens and reads the app's actions. */
  async finish(state: string, code: string) {
    const saved = await this.db.take<SignInState>("system", STATES, McpApps.stateId(state));
    if (!saved || saved.expiresAt < this.now())
      throw new AppError("This sign-in has expired.", 400);
    const app = await this.get(saved.owner, saved.app);
    const provider = new StoredProvider(this, saved.owner, app, this.open(saved.verifier));
    await auth(provider, {
      serverUrl: this.open(app.url),
      authorizationCode: code,
      fetchFn: this.fetch,
    });
    const result = await this.connect(saved.owner, app.id);
    return { name: app.name, connected: result.connected };
  }
  async remove(owner: string, id: string) {
    const app = await this.get(owner, id);
    await this.db.remove(owner, KIND, app.id);
    // Grants for this app don't carry over to another app added later under the same name.
    for (const rule of await this.db.list<{ id: string; app: string }>(owner, "approval-rules"))
      if (rule.app === app.id) await this.db.remove(owner, "approval-rules", rule.id);
    await this.db.remove(owner, "app-permissions", app.id);
    return { ok: true };
  }
  /** An app's actions, read again when the list is old. */
  private async fresh(owner: string, app: OwnApp) {
    if (app.status !== "connected") return app;
    if (app.toolsAt && this.now() - Date.parse(app.toolsAt) < TOOLS_FRESH_MS) return app;
    await this.connect(owner, app.id).catch(() => undefined);
    return this.get(owner, app.id);
  }
  owns(slug: string) {
    return /^MY_[A-Z0-9_]+$/i.test(slug.trim());
  }
  async connections(owner: string): Promise<AppConnection[]> {
    return (await this.all(owner)).map((app) => ({
      app: app.id,
      name: app.name,
      connected: app.status === "connected",
      ...(app.status === "needs_sign_in" ? { needsReconnect: true } : {}),
      description: `Your own app at ${app.host}`,
    }));
  }
  async search(owner: string, query: string): Promise<AppSearch> {
    const apps = await Promise.all((await this.all(owner)).map((app) => this.fresh(owner, app)));
    const words = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !COMMON.has(w));
    const scored = apps.flatMap((app) => {
      const named = words.some((w) => app.name.toLowerCase().includes(w));
      return app.tools.map((tool) => {
        const text = `${tool.name} ${tool.title ?? ""} ${tool.description}`.toLowerCase();
        return {
          tool: this.appTool(app, tool),
          score: words.filter((w) => text.includes(w)).length + (named ? 0.5 : 0),
        };
      });
    });
    return {
      tools: scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map((s) => s.tool),
      apps: apps.map((app) => ({
        app: app.id,
        connected: app.status === "connected",
        status:
          app.status === "connected"
            ? `${app.name} (your own app) is connected`
            : app.status === "needs_confirm"
              ? `${app.name} is waiting for the person to check it and connect it under Apps → Your own apps`
              : `${app.name} needs the person to sign in or add its key under Apps → Your own apps`,
      })),
      guidance: [],
    };
  }
  private appTool(app: OwnApp, tool: OwnTool): AppTool {
    return {
      slug: tool.slug,
      name: tool.title ?? tool.name,
      description: tool.description,
      app: app.id,
      readOnly: tool.readOnly,
      destructive: tool.destructive,
      parameters: tool.parameters,
    };
  }
  private async find(owner: string, slug: string) {
    const key = slug.trim().toUpperCase();
    for (const app of await this.all(owner)) {
      const tool = app.tools.find((t) => t.slug === key);
      if (tool) return { app, tool };
    }
    throw new AppError(`Unknown app action ${slug}`, 404);
  }
  async tool(owner: string, slug: string) {
    const { app, tool } = await this.find(owner, slug);
    return this.appTool(app, tool);
  }
  async execute(owner: string, slug: string, args: Record<string, unknown>) {
    const { app, tool } = await this.find(owner, slug);
    if (app.status !== "connected")
      throw new AppError(
        `${app.name} isn't connected right now. Call connect_app so the person can connect it again, then try again.`,
        409,
      );
    const provider = app.key ? undefined : new StoredProvider(this, owner, app);
    let result: Awaited<ReturnType<Client["callTool"]>>;
    try {
      result = await this.session(
        owner,
        app,
        (client) =>
          client.callTool({ name: tool.name, arguments: args }, undefined, { timeout: 100000 }),
        provider,
      );
    } catch (error) {
      if (provider?.signInUrl || error instanceof UnauthorizedError || unauthorized(error)) {
        await this.patch(owner, app.id, (current) => ({
          ...current,
          status: app.key ? "needs_key" : "needs_sign_in",
        }));
        throw new AppError(
          app.key
            ? `${app.name} didn't accept its access key. Call connect_app so the person can add a new one, then try again.`
            : `The sign-in to ${app.name} has expired. Call connect_app so the person can sign in again, then try again.`,
          409,
        );
      }
      if (error instanceof AppError) throw error;
      const lost =
        !(error instanceof McpError) ||
        error.code === ErrorCode.RequestTimeout ||
        error.code === ErrorCode.ConnectionClosed;
      if (!lost) throw new AppError(`${app.name}: ${errorText(error)}`, 502);
      // A change that never got an answer may still have happened in the app.
      const failure = new AppError(`${app.name} didn't answer: ${errorText(error)}`, 502);
      if (!tool.readOnly) Object.assign(failure, { outcomeUnknown: true });
      throw failure;
    }
    if (result.isError) {
      const detail = resultData(result as Parameters<typeof resultData>[0]);
      throw new AppError(
        (typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 2000) ||
          `${app.name} reported a problem`,
        502,
      );
    }
    return resultData(result as Parameters<typeof resultData>[0]);
  }
  private async listTools(client: Client) {
    const tools: ListedTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5 && tools.length < MAX_TOOLS; page++) {
      const listed = await client.listTools(cursor ? { cursor } : undefined, { timeout: 30000 });
      tools.push(...(listed.tools as ListedTool[]));
      cursor = listed.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }
  /** One conversation with the app: newer apps over streamable HTTP, older ones over SSE. */
  private async session<T>(
    _owner: string,
    app: OwnApp,
    run: (client: Client) => Promise<T>,
    provider?: StoredProvider,
  ): Promise<T> {
    const url = new URL(this.open(app.url));
    const requestInit = app.key
      ? { headers: { authorization: `Bearer ${this.open(app.key)}` } }
      : undefined;
    const attempt = async (transport: Transport) => {
      const client = new Client({ name: "Neato_Muse", version: "1.0.0" });
      try {
        await client.connect(transport, { timeout: 30000 });
        return await run(client);
      } finally {
        await client.close().catch(() => undefined);
      }
    };
    const options = { authProvider: provider, requestInit, fetch: this.fetch };
    try {
      return await attempt(new StreamableHTTPClientTransport(url, options));
    } catch (error) {
      if (!(error instanceof StreamableHTTPError) || ![404, 405].includes(error.code ?? 0))
        throw error;
      return attempt(new SSEClientTransport(url, options));
    }
  }
}

const unauthorized = (error: unknown) =>
  (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403)) ||
  /\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(errorText(error));
/** The app answered "sign in first" but its sign-in couldn't be found or registered with. */
const isSignInFailure = (error: unknown) =>
  /oauth|authori[sz]ation server|registration|metadata|invalid_client|HTTP 40\d/i.test(
    errorText(error),
  );

/** The sign-in page's return address; outside the session check, like Google's. */
export function signedInPage(name: string) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signed in</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 24px;line-height:1.5;color:#11191C"><h1 style="font-size:1.5rem">Signed in to ${escapeHtml(name)}</h1><p>You can close this tab and go back to Neato_Muse.</p></body>`;
}
export function signInFailedPage(message: string) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in didn't finish</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 24px;line-height:1.5;color:#11191C"><h1 style="font-size:1.5rem">The sign-in didn't finish</h1><p>${escapeHtml(message)}</p><p>Go back to Neato_Muse and tap Sign in to try again.</p></body>`;
}

/**
 * Composio's apps and the person's own apps as one connector. Own-app actions (MY_…) go to the
 * app itself; everything else to Composio. Mail and calendar features stay with Composio.
 */
export class CombinedApps implements AppConnector {
  watchMail?: AppConnector["watchMail"];
  unwatchMail?: AppConnector["unwatchMail"];
  eventTypes?: AppConnector["eventTypes"];
  watchEvent?: AppConnector["watchEvent"];
  ensureWebhook?: AppConnector["ensureWebhook"];
  constructor(
    private readonly composio: AppConnector | undefined,
    readonly mine: McpApps,
  ) {
    if (composio) {
      this.watchMail = composio.watchMail?.bind(composio);
      this.unwatchMail = composio.unwatchMail?.bind(composio);
      this.eventTypes = composio.eventTypes?.bind(composio);
      this.watchEvent = composio.watchEvent?.bind(composio);
      this.ensureWebhook = composio.ensureWebhook?.bind(composio);
    }
  }
  private others() {
    if (!this.composio)
      throw new AppError(
        "Only your own apps can be connected on this server. Add one under Apps → Your own apps.",
        409,
      );
    return this.composio;
  }
  async search(owner: string, query: string): Promise<AppSearch> {
    const [mine, others] = await Promise.all([
      this.mine.search(owner, query).catch(() => undefined),
      this.composio?.search(owner, query).catch((error: unknown) => error as Error),
    ]);
    // Composio being down doesn't hide the person's own apps.
    if (others instanceof Error) {
      if (!mine?.tools.length) throw others;
      return mine;
    }
    return {
      tools: [...(mine?.tools ?? []), ...(others?.tools ?? [])].slice(0, 8),
      apps: [...(mine?.apps ?? []), ...(others?.apps ?? [])],
      guidance: others?.guidance ?? [],
    };
  }
  tool(owner: string, slug: string) {
    return this.mine.owns(slug) ? this.mine.tool(owner, slug) : this.others().tool(owner, slug);
  }
  execute(owner: string, slug: string, args: Record<string, unknown>) {
    return this.mine.owns(slug)
      ? this.mine.execute(owner, slug, args)
      : this.others().execute(owner, slug, args);
  }
  async connect(owner: string, app: string) {
    if (!/^my_/i.test(app.trim())) return this.others().connect(owner, app);
    return this.mine.reconnect(owner, app.trim().toLowerCase());
  }
  async connections(owner: string) {
    const [mine, others] = await Promise.all([
      this.mine.connections(owner).catch(() => []),
      this.composio?.connections(owner) ?? [],
    ]);
    return [...others, ...mine];
  }
  directory(owner: string, search?: string) {
    return this.composio ? this.composio.directory(owner, search) : Promise.resolve([]);
  }
  async disconnect(owner: string, app: string) {
    if (/^my_/i.test(app.trim())) {
      await this.mine.remove(owner, app.trim().toLowerCase());
      return;
    }
    await this.others().disconnect(owner, app);
  }
}

/** Chat can add the person's own app; it stays off until they check it and connect it. */
export function ownAppToolSpecs(apps: AppConnector | undefined, owner: string) {
  if (!(apps instanceof CombinedApps)) return [];
  return [
    {
      name: "add_own_app",
      description:
        "Add the person's own app that offers an MCP server, by a short name and its web address (https://…), when they ask you to connect it. It is saved switched off until the person checks the address and taps Connect on the Connect card that appears right where they are (in the chat or on a call); there they sign in on the app's page or add its access key. Never ask for keys, tokens or passwords in chat. Once connected, its actions show up in find_app_actions like any connected app.",
      parameters: z.object({
        name: z.string().trim().min(1).max(60),
        url: z.string().trim().min(1).max(2000),
      }),
      execute: async (input: { name: string; url: string }) => {
        const { app } = await apps.mine.add(owner, input, "agent");
        return {
          saved: { id: app.id, name: app.name, address: app.host, status: app.status },
          next: "Its Connect card is on their screen now. Say the address in saved.address (the site's name, not the full link) so they can check it, and that it stays off until they tap Connect on the card.",
        };
      },
    },
  ];
}
