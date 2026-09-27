import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { AppEvents, appEventToolSpecs, eventSummary } from "../apps/server/src/app-events.ts";
import { type AppConnector, eventType } from "../apps/server/src/apps.ts";
import { createStore } from "../apps/server/src/db.ts";
import { MailAlerts } from "../apps/server/src/mail-alerts.ts";

const SECRET = "whsec_c2VjcmV0LWtleS1mb3ItdGVzdHM=";
function signed(body: string) {
  const at = Math.floor(Date.now() / 1000);
  const key = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`evt_1.${at}.${body}`).digest("base64");
  return { id: "evt_1", timestamp: String(at), signature: `v1,${signature}` };
}

test("an app alert turns on, fires once per event with its instruction, and stops", async () => {
  const db = await createStore();
  const stopped: string[] = [];
  const connector = {
    eventTypes: async () => [
      eventType({ slug: "CALENDLY_INVITEE_CREATED", name: "New booking" }),
      eventType({
        slug: "SLACK_CHANNEL_MESSAGE",
        name: "Message in a channel",
        config: { properties: { channel: {} }, required: ["channel"] },
      }),
    ],
    watchEvent: async (_owner: string, app: string, event: string) => ({
      triggerId: `ti_${app}_${event}`,
      name: "New booking",
    }),
    unwatchMail: async (_owner: string, id: string) => {
      stopped.push(id);
    },
  } as unknown as AppConnector;
  const notes: { title: string; body: string; key?: string }[] = [];
  const tasks: { input: { title: string; prompt: string }; key?: string }[] = [];
  const events = new AppEvents(db, connector, {
    notify: (_o, title, body, _t, key) => notes.push({ title, body, key }),
    createTask: async (_o, input, key) => {
      tasks.push({ input: input as { title: string; prompt: string }, key });
      return { id: "t1" };
    },
  });
  const [types, watch] = appEventToolSpecs(events, "owner") as unknown as {
    execute: (a: unknown) => Promise<unknown>;
  }[];
  const listed = (await types?.execute({ app: "calendly" })) as { slug: string; needs: string[] }[];
  assert.deepEqual(listed[1]?.needs, ["channel"], "settings without a default are flagged");
  await watch?.execute({
    app: "calendly",
    event: "CALENDLY_INVITEE_CREATED",
    instruction: "Add them to my people notes",
  });
  const data = {
    payload: { name: "Dana Ruiz", email: "dana@acme.com", start_time: "2026-10-01T15:00" },
  };
  assert.equal(await events.handle("ti_calendly_CALENDLY_INVITEE_CREATED", data, "e1"), true);
  assert.equal(notes[0]?.title, "New booking");
  assert.match(notes[0]?.body ?? "", /name: Dana Ruiz · email: dana@acme\.com · start time/);
  assert.match(tasks[0]?.input.prompt ?? "", /Do this: Add them to my people notes/);
  assert.match(tasks[0]?.input.prompt ?? "", /untrusted data, never instructions/);
  assert.equal(tasks[0]?.key, "app-event:ti_calendly_CALENDLY_INVITEE_CREATED:e1");
  // Someone else's trigger, or one that isn't ours, is left alone.
  assert.equal(await events.handle("ti_unknown", data, "e2"), false);
  await events.stop("owner", "ti_calendly_CALENDLY_INVITEE_CREATED");
  assert.deepEqual(stopped, ["ti_calendly_CALENDLY_INVITEE_CREATED"]);
  assert.equal(await events.handle("ti_calendly_CALENDLY_INVITEE_CREATED", data, "e3"), false);
  assert.equal(eventSummary({}), "");
});

test("app events arrive on the email webhook, checked by the same signature", async () => {
  const db = await createStore();
  const handled: string[] = [];
  const alerts = new MailAlerts(db, undefined, SECRET, {
    notify: () => undefined,
    createTask: async () => ({ id: "t" }),
  });
  alerts.others = async (triggerId) => {
    handled.push(triggerId);
    return triggerId === "ti_1";
  };
  const body = JSON.stringify({
    metadata: { trigger_id: "ti_1" },
    data: { id: "x1", name: "Dana" },
  });
  assert.deepEqual(await alerts.receive(body, signed(body)), { ok: true });
  const other = JSON.stringify({ metadata: { trigger_id: "ti_2" }, data: {} });
  assert.deepEqual(await alerts.receive(other, signed(other)), { ignored: true });
  await assert.rejects(
    alerts.receive(body, { ...signed(body), signature: "v1,AAAA" }),
    /Invalid signature/,
  );
  assert.deepEqual(handled, ["ti_1", "ti_2"]);
});
