import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

let db: Store, directory: string, app: Awaited<ReturnType<typeof createApp>>["app"], token: string;
let agent: Awaited<ReturnType<typeof createApp>>["agent"];
const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-headsups-"));
  db = await createStore();
  ({ app, agent } = await createApp(db, {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  }));
  const response = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  token = (await response.json()).token;
});
after(async () => {
  await agent.stop();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("Heads-ups are on for a new person, the intro shows once, settings save and refuse nonsense", async () => {
  const first = await (await app.request("/api/heads-ups", { headers: headers() })).json();
  assert.equal(first.settings.on, true);
  assert.equal(first.settings.travelBuffer, 30);
  assert.equal(first.intro, true);
  assert.deepEqual(first.open, []);
  assert.equal(first.kinds.length, 6);

  const saved = await app.request("/api/heads-ups/settings", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ introSeen: true, travelBuffer: 45, chatty: "important" }),
  });
  assert.equal(saved.status, 200);
  const after = await (await app.request("/api/heads-ups", { headers: headers() })).json();
  assert.equal(after.intro, false);
  assert.equal(after.settings.travelBuffer, 45);
  // "Important" says only what can go wrong.
  assert.deepEqual(
    after.kinds.filter((k: { on: boolean }) => k.on).map((k: { kind: string }) => k.kind),
    ["leave_by", "tight_gap", "overlap"],
  );

  const bad = await app.request("/api/heads-ups/settings", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ travelBuffer: 20 }),
  });
  assert.ok(bad.status >= 400 && bad.status < 500);
  const missing = await app.request(`/api/heads-ups/${"a".repeat(32)}/done`, {
    method: "POST",
    headers: headers(),
    body: "{}",
  });
  assert.equal(missing.status, 404);
  const malformed = await app.request("/api/heads-ups/nope/done", {
    method: "POST",
    headers: headers(),
    body: "{}",
  });
  assert.ok(malformed.status >= 400 && malformed.status < 500);
  assert.equal((await app.request("/api/heads-ups")).status, 401);
});
