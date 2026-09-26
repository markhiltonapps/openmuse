import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { AccountService, type Mailer } from "../apps/server/src/accounts.ts";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { AgentInbox } from "../apps/server/src/inbound.ts";
import type { AgentTask } from "../packages/domain/src/agent.ts";

const secret = `whsec_${Buffer.from("an-accounts-webhook-secret").toString("base64")}`;
const sent: { to: string; subject: string; text: string }[] = [];
const mailer: Mailer = {
  send: async (message) => {
    sent.push(message);
  },
};
const loginToken = (text = "") => /#login=([\w-]+)/.exec(text)?.[1] ?? "";

let db: Store, directory: string, server: Awaited<ReturnType<typeof createApp>>, config: Config;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-accounts-"));
  config = {
    mode: "live",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    accessKey: "a-private-test-key-with-enough-characters",
    agentBackend: "model",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
    appUrl: "https://app.test/",
    adminEmail: "boss@example.com",
    resendApiKey: "re_test",
    resendWebhookSecret: secret,
    agentEmail: "muse@agent.test",
    agentEmailAllowedSenders: ["boss@example.com"],
  };
  server = await createApp(db, config, { mailer });
});
after(async () => {
  await server.agent.stop();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

function call(path: string, body?: unknown, token?: string) {
  return server.app.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function signIn(text?: string) {
  const response = await call("/api/auth/verify", { token: loginToken(text) });
  assert.equal(response.status, 200);
  return ((await response.json()) as { token: string }).token;
}

let sarahId = "";
test("the admin invites people, who sign in with one-time email links", async () => {
  assert.equal((await (await call("/api/health")).json()).emailSignIn, true);
  assert.deepEqual(await (await call("/api/auth/request", { email: "Boss@Example.com" })).json(), {
    ok: true,
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.to, "boss@example.com");
  assert.match(sent[0]?.text ?? "", /https:\/\/app\.test\/#login=/);
  const admin = await signIn(sent[0]?.text);
  const me = await (await call("/api/me", undefined, admin)).json();
  assert.equal(me.id, "local-user");
  assert.equal(me.role, "admin");
  assert.equal(me.agentEmail, "muse@agent.test");

  // The answer never reveals whether an address has an account.
  assert.deepEqual(
    await (await call("/api/auth/request", { email: "nobody@example.com" })).json(),
    { ok: true },
  );
  assert.equal(sent.length, 1);

  const invited = await call(
    "/api/accounts",
    { email: "Sarah@Example.com", name: "Sarah Jones" },
    admin,
  );
  assert.equal(invited.status, 201);
  const sarah = await invited.json();
  sarahId = sarah.id;
  assert.equal(sarah.handle, "sarah");
  assert.equal(sarah.agentEmail, "sarah@agent.test");
  assert.equal(sent.at(-1)?.to, "sarah@example.com");
  assert.match(sent.at(-1)?.text ?? "", /sarah@agent\.test/);
  const invite = sent.at(-1)?.text;
  for (const body of [
    { email: "sarah@example.com", name: "Sarah Again" },
    { email: "other@example.com", name: "Other", handle: "muse" },
    { email: "other@example.com", name: "Other", handle: "admin" },
    { email: "other@example.com", name: "Other", handle: "sarah" },
  ])
    assert.equal((await call("/api/accounts", body, admin)).status, 409);

  const member = await signIn(invite);
  // Each link works once.
  assert.equal((await call("/api/auth/verify", { token: loginToken(invite) })).status, 401);
  const mine = await (await call("/api/me", undefined, member)).json();
  assert.equal(mine.role, "member");
  assert.equal(mine.agentEmail, "sarah@agent.test");
  assert.equal((await call("/api/accounts", undefined, member)).status, 403);
  assert.equal(
    (await call("/api/accounts", { email: "x@example.com", name: "X" }, member)).status,
    403,
  );
  assert.equal((await call(`/api/accounts/local-user/disable`, {}, member)).status, 403);

  // Workspaces are separate: each person starts with only their own address approved.
  const memberEmail = await (await call("/api/agent-email", undefined, member)).json();
  assert.equal(memberEmail.address, "sarah@agent.test");
  assert.deepEqual(memberEmail.allowedSenders, ["sarah@example.com"]);
  const adminEmail = await (await call("/api/agent-email", undefined, admin)).json();
  assert.equal(adminEmail.address, "muse@agent.test");
  assert.deepEqual(adminEmail.allowedSenders, ["boss@example.com"]);

  const people = await (await call("/api/accounts", undefined, admin)).json();
  assert.deepEqual(
    people.accounts.map((a: { email: string }) => a.email),
    ["boss@example.com", "sarah@example.com"],
  );

  // Removing someone ends their sessions and stops their sign-in emails.
  assert.equal((await call("/api/accounts/local-user/disable", {}, admin)).status, 409);
  assert.equal((await call(`/api/accounts/${sarahId}/disable`, {}, admin)).status, 200);
  assert.equal((await call("/api/me", undefined, member)).status, 401);
  const before = sent.length;
  await call("/api/auth/request", { email: "sarah@example.com" });
  assert.equal(sent.length, before);
  assert.equal((await call(`/api/accounts/${sarahId}/enable`, {}, admin)).status, 200);

  // Signing out ends only that device's session.
  const again = await signIn(
    (await call(`/api/accounts/${sarahId}/invite`, {}, admin)).ok ? sent.at(-1)?.text : "",
  );
  assert.equal((await call("/api/auth/signout", {}, again)).status, 200);
  assert.equal((await call("/api/me", undefined, again)).status, 401);
  assert.equal((await call("/api/me", undefined, admin)).status, 200);
  // The access key still signs in to the admin workspace.
  const key = await call("/api/session", { accessKey: config.accessKey });
  const keyMe = await (await call("/api/me", undefined, (await key.json()).token)).json();
  assert.equal(keyMe.id, "local-user");
});

test("sign-in links expire", async () => {
  let now = Date.now();
  const clock = new AccountService(db, config, server.auth, mailer, () => now);
  await clock.requestLink("boss@example.com");
  now += 16 * 60 * 1000;
  await assert.rejects(clock.verifyLink(loginToken(sent.at(-1)?.text)), /expired/);
});

test("email to a person's agent address goes to their workspace", async () => {
  const from: Record<string, string> = {
    em_sarah: "Sarah <sarah@example.com>",
    em_boss: "boss@example.com",
    em_alias: "boss@example.com",
    em_nobody: "boss@example.com",
  };
  const inbox = new AgentInbox(db, config, server.agent, server.accounts, (async (
    url: string | URL | Request,
  ) => {
    const id = String(url).split("/").pop() ?? "";
    return Response.json({
      from: from[id],
      subject: id,
      text: "Please help",
      headers: { "authentication-results": "dmarc=pass" },
    });
  }) as typeof fetch);
  const deliver = (id: string, to: string[]) => {
    const body = JSON.stringify({
      type: "email.received",
      data: { email_id: id, from: from[id], to, subject: id },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
      .update(`msg_${id}.${timestamp}.${body}`)
      .digest("base64");
    return inbox.receive(body, { id: `msg_${id}`, timestamp, signature: `v1,${signature}` });
  };
  const sarah = await deliver("em_sarah", ["Sarah's Agent <Sarah+Trips@agent.test>"]);
  assert.equal(sarah.status, "task");
  assert.equal(
    (await db.get<AgentTask>(sarahId, "tasks", sarah.taskId ?? ""))?.title,
    "Email: em_sarah",
  );
  const boss = await deliver("em_boss", ["muse@agent.test"]);
  assert.ok(await db.get<AgentTask>("local-user", "tasks", boss.taskId ?? ""));
  // Mail forwarded from another address (an alias) belongs to the admin.
  assert.equal((await deliver("em_alias", ["muse@company.test"])).status, "task");
  assert.equal((await deliver("em_nobody", ["nobody@agent.test"])).status, "ignored");
  // A removed person's address stops taking work.
  await server.accounts.setStatus("local-user", sarahId, "disabled");
  assert.equal((await deliver("em_sarah2", ["sarah@agent.test"])).status, "ignored");
});
