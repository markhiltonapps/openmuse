import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { PushService } from "../apps/server/src/push.ts";

let db: Store, directory: string, config: Config;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-push-"));
  config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "https://openmuse.example",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "https://openmuse.example/api/google/callback",
    allowedOrigins: [],
  };
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

const subscription = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA", auth: "tBHItJI5svbpez7KI4CCXg" },
});

test("push keys persist, only real push services are accepted, and gone devices are removed", async () => {
  const sent: { endpoint: string; payload: string; subject?: string }[] = [];
  const send = (async (target: { endpoint: string }, payload: string, options: unknown) => {
    sent.push({
      endpoint: target.endpoint,
      payload,
      subject: (options as { vapidDetails?: { subject: string } }).vapidDetails?.subject,
    });
    if (target.endpoint.includes("gone"))
      throw Object.assign(new Error("Gone"), { statusCode: 410 });
    return { statusCode: 201, body: "", headers: {} };
  }) as unknown as Parameters<typeof PushService.create>[2];
  const push = await PushService.create(db, config, send);
  const again = await PushService.create(db, config, send);
  assert.equal(again.publicKey, push.publicKey);

  await assert.rejects(
    push.subscribe("push-owner", subscription("http://browser.railway.internal:8790/sessions")),
    /Unsupported push service/,
  );
  await assert.rejects(
    push.subscribe("push-owner", subscription("https://evil.example/fcm.googleapis.com")),
    /Unsupported push service/,
  );
  await push.subscribe("push-owner", subscription("https://fcm.googleapis.com/fcm/send/abc"));
  await push.subscribe("push-owner", subscription("https://web.push.apple.com/gone-device"));
  await push.notify("push-owner", { title: "Morning brief · Sep 28", body: "3 meetings today" });
  assert.equal(sent.length, 2);
  assert.deepEqual(JSON.parse(sent[0]?.payload ?? "{}"), {
    title: "Morning brief · Sep 28",
    body: "3 meetings today",
    url: "/",
  });
  assert.equal(sent[0]?.subject, "https://openmuse.example");
  const remaining = await db.list<{ endpoint: string }>("push-owner", "push-subscriptions");
  assert.deepEqual(
    remaining.map((s) => s.endpoint),
    ["https://fcm.googleapis.com/fcm/send/abc"],
  );
  await push.unsubscribe("push-owner", "https://fcm.googleapis.com/fcm/send/abc");
  assert.equal((await db.list("push-owner", "push-subscriptions")).length, 0);
});
