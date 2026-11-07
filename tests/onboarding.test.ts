import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { historyStepsEmail } from "../apps/server/src/onboarding.ts";
import type { AgentWorkspace } from "../packages/domain/src/agent.ts";
import type { PersonaFact } from "../packages/domain/src/persona.ts";

let db: Store, server: Awaited<ReturnType<typeof createApp>>, directory: string, token: string;
const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const request = (path: string, body?: unknown) =>
  server.app.request(path, {
    headers: headers(),
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-onboarding-"));
  db = await createStore({ dataDir: join(directory, "db") });
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "model",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  };
  server = await createApp(db, config);
  const session = await server.app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(session.status, 200);
  token = (await session.json()).token;
});
after(async () => {
  await server?.agent?.stop();
  await db?.close();
  await rm(directory, { recursive: true, force: true });
});

test("answers given during setup land on About you, marked as said during setup", async () => {
  const response = await request("/api/onboarding/facts", {
    facts: [
      { key: "you.name", value: "Mark" },
      { key: "work.occupation", value: "I run a small AI company" },
    ],
  });
  assert.equal(response.status, 200, await response.clone().text());
  const { facts } = (await response.json()) as { facts: PersonaFact[] };
  assert.equal(facts.length, 2);
  assert.equal(facts[0]?.source, "interview");
  assert.equal(facts[0]?.confidence, "told");
  const listed = (await (await request("/api/persona")).json()) as { facts: PersonaFact[] };
  assert.equal(listed.facts.find((f) => f.key === "you.name")?.value, "Mark");
  // Only About you's own keys are accepted.
  const bad = await request("/api/onboarding/facts", { facts: [{ key: "secret", value: "x" }] });
  assert.equal(bad.status, 422);
});

test("finishing setup is remembered on the agent's identity", async () => {
  const before = (await (await request("/api/agent")).json()) as AgentWorkspace;
  assert.equal(before.identity.onboardedAt, undefined);
  const done = await request("/api/onboarding/done", {});
  assert.equal(done.status, 200);
  const { onboardedAt } = (await done.json()) as { onboardedAt: string };
  assert.ok(Date.parse(onboardedAt) > 0);
  const after = (await (await request("/api/agent")).json()) as AgentWorkspace;
  assert.equal(after.identity.onboardedAt, onboardedAt);
  assert.equal(after.identity.name, "Neddy", "the rest of the identity is untouched");
});

test("the history steps can't be emailed without a mailer or an address", async () => {
  // The test server has no mailer set up.
  const response = await request("/api/onboarding/history-steps", {});
  assert.equal(response.status, 503);
});

test("the history email carries the Help topic's steps, in the agent's name", () => {
  const email = historyStepsEmail("Pip", "https://neddy.example");
  assert.match(email.subject, /ChatGPT or Claude history to Pip/);
  assert.match(email.text, /1\. In ChatGPT or Claude, ask for a data export/);
  assert.match(email.text, /Apps › About you/);
  assert.doesNotMatch(email.text, /\*\*|\{agent\}/);
  assert.match(email.html, /<ol><li>/);
  assert.match(email.html, /<b>Apps › About you<\/b>/);
  assert.match(email.html, /href="https:\/\/neddy\.example"/);
  const plain = historyStepsEmail("Pip");
  assert.doesNotMatch(plain.text, /Open Pip:/);
});
