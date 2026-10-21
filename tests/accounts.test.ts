import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { AccessRequest } from "../apps/server/src/access-requests.ts";
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

test("people can ask to join from the sign-in screen; the admin approves or declines", async () => {
  await call("/api/auth/request", { email: "boss@example.com" });
  const admin = await signIn(sent.at(-1)?.text);
  const ask = (email: string, name: string, note?: string) =>
    call("/api/auth/request-access", { email, name, ...(note ? { note } : {}) });
  const before = sent.length;
  const notified = async () =>
    (await db.list<{ title: string; body: string }>("local-user", "notifications")).filter((n) =>
      n.title.endsWith("asked to join"),
    );
  assert.deepEqual(
    await (await ask("Mike@Example.com", "Mike Hilton", "Planning the family week")).json(),
    { ok: true },
  );
  assert.deepEqual(await (await ask("nadia@example.com", "Nadia")).json(), { ok: true });
  // The people asking get no email yet. The admin gets a notification and an email at their own
  // address, one for each new request (asking again below sends nothing more).
  assert.equal(sent.length, before + 2);
  const adminMail = sent.slice(before);
  assert.ok(adminMail.every((m) => m.to === "boss@example.com"));
  const mikeMail = adminMail.find((m) => m.subject === "Mike Hilton asked to join Neddy");
  assert.match(mikeMail?.text ?? "", /Email: mike@example\.com/);
  assert.match(mikeMail?.text ?? "", /Note: Planning the family week/);
  assert.doesNotMatch(mikeMail?.text ?? "", /waiting in all/);
  const nadiaMail = adminMail.find((m) => m.subject === "Nadia asked to join Neddy");
  assert.match(
    nadiaMail?.text ?? "",
    /Apps & settings › Account › People\. 2 people are waiting for an answer in all/,
  );
  const notes = await notified();
  assert.equal(notes.length, 2);
  assert.match(
    notes.find((n) => n.title === "Mike Hilton asked to join")?.body ?? "",
    /^mike@example\.com — “Planning the family week”\. Approve or decline/,
  );
  // Asking again while it waits changes nothing, and tells them nothing.
  const afterAsks = sent.length;
  assert.deepEqual(await (await ask("mike@example.com", "Mike H")).json(), { ok: true });
  assert.equal((await notified()).length, 2);
  assert.equal(sent.length, afterAsks);
  // Someone who already has an account gets their sign-in email instead, with the same answer.
  assert.deepEqual(await (await ask("boss@example.com", "Boss")).json(), { ok: true });
  assert.equal(sent.at(-1)?.to, "boss@example.com");
  assert.match(sent.at(-1)?.subject ?? "", /sign-in code/);
  assert.equal((await notified()).length, 2);
  // Even once their sign-in emails are rate-limited: the answer never changes.
  for (let n = 0; n < 5; n++) await call("/api/auth/request", { email: "boss@example.com" });
  assert.equal((await call("/api/auth/request", { email: "boss@example.com" })).status, 429);
  assert.deepEqual(await (await ask("boss@example.com", "Boss")).json(), { ok: true });

  const people = await (await call("/api/accounts", undefined, admin)).json();
  assert.deepEqual(
    people.requests.map((r: AccessRequest) => [r.email, r.name, r.note]),
    [
      ["mike@example.com", "Mike Hilton", "Planning the family week"],
      ["nadia@example.com", "Nadia", undefined],
    ],
  );
  const [mike, nadia] = people.requests as AccessRequest[];
  // Only the admin decides.
  const invited = await call("/api/accounts", { email: "pat@example.com", name: "Pat" }, admin);
  assert.equal(invited.status, 201);
  const member = await signIn(sent.at(-1)?.text);
  assert.equal((await call(`/api/accounts/requests/${mike?.id}/approve`, {}, member)).status, 403);
  // Approving sends the invite with the name they gave; declining is quiet.
  const approved = await call(`/api/accounts/requests/${mike?.id}/approve`, {}, admin);
  assert.equal(approved.status, 201);
  assert.equal((await approved.json()).name, "Mike Hilton");
  assert.equal(sent.at(-1)?.to, "mike@example.com");
  assert.match(sent.at(-1)?.subject ?? "", /invited/);
  const mails = sent.length;
  assert.equal((await call(`/api/accounts/requests/${nadia?.id}/decline`, {}, admin)).status, 200);
  assert.equal(sent.length, mails);
  assert.deepEqual((await (await call("/api/accounts", undefined, admin)).json()).requests, []);
  assert.equal((await call(`/api/accounts/requests/${nadia?.id}/decline`, {}, admin)).status, 404);
  // Mike signs in with the invite; asking now sends a sign-in email, not a request.
  await signIn(sent.at(-1)?.text);
  await ask("mike@example.com", "Mike Hilton");
  assert.equal(sent.at(-1)?.to, "mike@example.com");
  assert.match(sent.at(-1)?.subject ?? "", /sign-in code/);
  // One address gets three tries a day.
  for (let n = 0; n < 3; n++) assert.equal((await ask("many@example.com", "Many")).status, 200);
  assert.equal((await ask("many@example.com", "Many")).status, 429);
});

test("the admin's access-request email escapes what people typed, and a failing mailer never stops a request", async () => {
  const { accessRequestEmail } = await import("../apps/server/src/access-request-email.ts");
  const mail = accessRequestEmail({
    name: "Eve\nBcc: x@evil.example <b>",
    email: "eve@example.com",
    note: '<img src=x onerror="alert(1)"> hi',
    appUrl: "https://app.test/",
  });
  assert.ok(!/[\r\n]/.test(mail.subject), "no line breaks in the subject");
  assert.ok(!mail.html.includes("<img"), "the note can't add markup");
  assert.ok(!mail.html.includes("<b>"), "the name can't add markup");
  assert.match(mail.html, /&lt;img src=x/);
  assert.match(mail.html, /href="https:\/\/app\.test"/);
  // A mailer that is down doesn't stop the request from being saved or answered.
  const { AccessRequests } = await import("../apps/server/src/access-requests.ts");
  const failing = new AccessRequests(
    db,
    {
      emailSignIn: true,
      byEmail: async () => null,
      requestLink: async () => undefined,
      invite: async () => ({}) as never,
      isAdmin: async () => true,
    } as never,
    async () => undefined,
    undefined,
    {
      send: async () => {
        throw new Error("the mail service is down");
      },
      to: async () => "boss@example.com",
      appUrl: "https://app.test",
    },
  );
  assert.deepEqual(await failing.request({ email: "zed@example.com", name: "Zed" }), { ok: true });
  assert.equal(
    (await failing.list("local-user")).some((r) => r.email === "zed@example.com"),
    true,
  );
});

test("the admin can list, approve and decline access requests by voice or chat", async () => {
  const tools = server.agent.accessTools;
  assert.ok(tools);
  await call("/api/auth/request-access", { email: "olga@example.com", name: "Olga Petrova" });
  await call("/api/auth/request-access", { email: "pablo@example.com", name: "Pablo Ruiz" });
  const listed = (await tools.list("local-user")) as {
    waiting: number;
    requests: { name: string }[];
  };
  assert.ok(listed.requests.some((r) => r.name === "Olga Petrova"));
  // Approving by first name sends the usual invite and starts them on Free.
  const before = sent.length;
  assert.deepEqual(await tools.approve("local-user", "olga"), {
    approved: "Olga Petrova (olga@example.com)",
    note: "They were sent the usual invite and start on the Free plan.",
  });
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1)?.to, "olga@example.com");
  assert.equal(
    (
      await db.get(
        "system",
        "plans",
        (
          await db.list<{ id: string; email: string }>("system", "accounts")
        ).find((a) => a.email === "olga@example.com")?.id ?? "",
      )
    )?.plan,
    "free",
  );
  // Declining forgets the request without an email; an unknown name asks again.
  const afterApprove = sent.length;
  assert.deepEqual(await tools.decline("local-user", "pablo@example.com"), {
    declined: "Pablo Ruiz (pablo@example.com)",
    note: "They weren’t emailed.",
  });
  assert.equal(sent.length, afterApprove);
  assert.ok("error" in ((await tools.approve("local-user", "nobody")) as object));
  // Two requests that fit one name aren't guessed between: the email settles it.
  await call("/api/auth/request-access", { email: "ann@example.com", name: "Ann" });
  await call("/api/auth/request-access", { email: "ann.lee@example.com", name: "Ann Lee" });
  const both = (await tools.approve("local-user", "ann")) as { error?: string };
  assert.match(
    both.error ?? "",
    /More than one waiting request matches “ann”.*ann@example\.com.*ann\.lee@example\.com/,
  );
  assert.deepEqual(await tools.decline("local-user", "ann.lee@example.com"), {
    declined: "Ann Lee (ann.lee@example.com)",
    note: "They weren’t emailed.",
  });
});

test("approving still tells the admin the truth when only the invite email fails", async () => {
  const { AccessRequests } = await import("../apps/server/src/access-requests.ts");
  let made = false;
  const requests = new AccessRequests(
    db,
    {
      emailSignIn: true,
      byEmail: async (email: string) =>
        made && email === "kit@example.com" ? ({} as never) : null,
      requestLink: async () => undefined,
      invite: async () => {
        made = true;
        throw new Error("Resend answered 500");
      },
      isAdmin: async () => true,
    } as never,
    async () => undefined,
  );
  await requests.request({ email: "kit@example.com", name: "Kit Marlow" });
  const waiting = await requests.list("local-user");
  const id = waiting.find((r) => r.email === "kit@example.com")?.id ?? "";
  await assert.rejects(
    requests.approve("local-user", id, {}),
    /Kit Marlow’s account was made, but the invite email didn’t send\. Open them under Invited and tap Send new invite/,
  );
});
