import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import type { AppConnector } from "../apps/server/src/apps.ts";
import { ComposioConnector, mailTrigger } from "../apps/server/src/apps.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { emailFromEvent, MailAlerts, verifyWebhook } from "../apps/server/src/mail-alerts.ts";

const SECRET = "whsec_c2VjcmV0LWtleS1mb3ItdGVzdHM=";
function signed(body: string, secret = SECRET, at = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`msg_1.${at}.${body}`).digest("base64");
  return { id: "msg_1", timestamp: String(at), signature: `v1,${signature}` };
}

test("Composio webhooks are accepted only with a valid, recent signature", () => {
  const body = '{"data":{}}';
  assert.equal(verifyWebhook(SECRET, signed(body), body), true);
  // The secret without its prefix, and a plain-text secret.
  assert.equal(verifyWebhook(SECRET.slice(6), signed(body), body), true);
  const plain = createHmac("sha256", "plain secret").update(`msg_1.100.${body}`).digest("hex");
  assert.equal(
    verifyWebhook(
      "plain secret",
      { id: "msg_1", timestamp: "100", signature: plain },
      body,
      100_000,
    ),
    true,
  );
  assert.equal(verifyWebhook(SECRET, signed(body), '{"data":{"x":1}}'), false);
  assert.equal(verifyWebhook("whsec_b3RoZXI=", signed(body), body), false);
  assert.equal(verifyWebhook(SECRET, signed(body, SECRET, 1000), body), false);
  assert.equal(verifyWebhook(SECRET, { id: "msg_1" }, body), false);
});

test("new email notifies the person and runs their rules once", async () => {
  const db = await createStore();
  const watched: string[] = [];
  const apps = {
    connections: async () => [
      { app: "gmail", name: "Gmail", connected: true },
      { app: "outlook", name: "Outlook", connected: false },
    ],
    watchMail: async (_owner: string, app: string) => {
      watched.push(app);
      return { triggerId: `ti_${app}`, trigger: "GMAIL_NEW_GMAIL_MESSAGE" };
    },
    unwatchMail: async (_owner: string, id: string) => {
      watched.push(`off:${id}`);
    },
  } as unknown as AppConnector;
  const notices: { owner: string; title: string; body: string; key?: string }[] = [];
  const tasks = new Map<string, { owner: string; input: { title: string; prompt: string } }>();
  const alerts = new MailAlerts(db, apps, SECRET, {
    notify: (owner, title, body, _task, key) => {
      if (!notices.some((n) => n.key === key)) notices.push({ owner, title, body, key });
    },
    createTask: async (owner, input, key) => {
      tasks.set(key ?? "", { owner, input: input as { title: string; prompt: string } });
      return { id: key ?? "" };
    },
  });
  // A rule watches the connected inbox by itself.
  const added = await alerts.addRule("sam", {
    from: "dana@acme.com",
    instruction: "Summarize it and draft a reply",
  });
  assert.deepEqual(added.watching, ["Gmail"]);
  assert.deepEqual(watched, ["gmail"]);
  const event = (data: Record<string, unknown>, trigger = "ti_gmail") =>
    JSON.stringify({
      type: "composio.trigger.message",
      metadata: { trigger_id: trigger, trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE" },
      data,
    });
  const fromDana = event({
    message_id: "m1",
    sender: "Dana Lee <dana@acme.com>",
    subject: "Contract",
    preview: { subject: "Contract", body: "Can you sign by Friday?" },
    label_ids: ["INBOX", "CATEGORY_PERSONAL"],
  });
  assert.deepEqual(await alerts.receive(fromDana, signed(fromDana)), {
    ok: true,
    rules: 1,
    notified: true,
  });
  // Delivered twice: still one task and one notification.
  await alerts.receive(fromDana, signed(fromDana));
  assert.equal(tasks.size, 1);
  assert.equal(notices.length, 1);
  const [task] = tasks.values();
  assert.equal(task?.owner, "sam");
  assert.match(task?.input.prompt ?? "", /Summarize it and draft a reply/);
  assert.match(task?.input.prompt ?? "", /untrusted data/);
  assert.equal(notices[0]?.title, "New email from Dana Lee");
  assert.match(notices[0]?.body ?? "", /Contract — Can you sign by Friday\?/);
  // Unimportant email without a rule is quiet; important email notifies.
  const newsletter = event({ message_id: "m2", sender: "news@shop.test", label_ids: ["INBOX"] });
  assert.equal((await alerts.receive(newsletter, signed(newsletter))).notified, false);
  const boss = event({ message_id: "m3", sender: "boss@acme.com", label_ids: ["IMPORTANT"] });
  assert.equal((await alerts.receive(boss, signed(boss))).notified, true);
  // Other triggers on the same Composio project are ignored, and bad signatures refused.
  const stranger = event({ message_id: "m4" }, "ti_someone_else");
  assert.deepEqual(await alerts.receive(stranger, signed(stranger)), { ignored: true });
  await assert.rejects(alerts.receive(fromDana, signed("{}")), /Invalid signature/);
  // Turned off: events stop.
  await alerts.watch("sam", "gmail", false);
  assert.deepEqual(watched, ["gmail", "off:ti_gmail"]);
  const late = event({ message_id: "m5", sender: "dana@acme.com" });
  assert.deepEqual(await alerts.receive(late, signed(late)), { ignored: true });
  await db.close();
});

test("Outlook's message shape and the new-email trigger are recognized", () => {
  assert.deepEqual(
    emailFromEvent("outlook", {
      id: "AAMk1",
      from: { emailAddress: { name: "Dana Lee", address: "dana@acme.com" } },
      subject: "Lunch?",
      bodyPreview: "Are you free   Thursday?",
      inferenceClassification: "focused",
    }),
    {
      app: "outlook",
      messageId: "AAMk1",
      from: "Dana Lee <dana@acme.com>",
      subject: "Lunch?",
      preview: "Are you free Thursday?",
      important: true,
    },
  );
  assert.equal(
    mailTrigger([{ slug: "OUTLOOK_SENT_MESSAGE_TRIGGER" }, { slug: "OUTLOOK_MESSAGE_TRIGGER" }])
      ?.slug,
    "OUTLOOK_MESSAGE_TRIGGER",
  );
  assert.equal(mailTrigger([{ slug: "GMAIL_NEW_LABEL_ADDED" }]), undefined);
});

test("watching a mailbox creates a Composio trigger with its defaults", async () => {
  const db = await createStore();
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const { pathname, search } = new URL(String(url));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: pathname + search, body });
    if (pathname === "/api/v3.1/tool_router/session")
      return Response.json({ session_id: "trs_mail" }, { status: 201 });
    if (pathname.endsWith("/toolkits"))
      return Response.json({
        items: [
          { name: "Gmail", slug: "gmail", connected_account: { id: "ca_1", status: "ACTIVE" } },
        ],
      });
    if (pathname === "/api/v3/triggers_types")
      return Response.json({
        items: [
          {
            slug: "GMAIL_NEW_GMAIL_MESSAGE",
            config: { properties: { interval: { default: 1 }, labelIds: { default: "INBOX" } } },
          },
        ],
      });
    if (pathname === "/api/v3/trigger_instances/GMAIL_NEW_GMAIL_MESSAGE/upsert")
      return Response.json({ trigger_id: "ti_new" });
    if (pathname === "/api/v3/trigger_instances/manage/ti_new")
      return Response.json({}, { status: 404 });
    return Response.json({ error: { message: "Not found" } }, { status: 404 });
  }) as typeof fetch;
  const connector = new ComposioConnector(
    db,
    {
      composioApiKey: "test-composio-key",
      composioBaseUrl: "https://composio.test",
    } as Config & { composioApiKey: string },
    fetcher,
  );
  assert.deepEqual(await connector.watchMail("sam", "gmail"), {
    triggerId: "ti_new",
    trigger: "GMAIL_NEW_GMAIL_MESSAGE",
  });
  assert.deepEqual(calls.find((c) => c.path.includes("/upsert"))?.body, {
    connected_account_id: "ca_1",
    trigger_config: { interval: 1, labelIds: "INBOX" },
  });
  // Already gone is fine.
  await connector.unwatchMail("sam", "ti_new");
  await assert.rejects(connector.watchMail("sam", "outlook"), /Connect outlook in Apps first/);
  await db.close();
});
