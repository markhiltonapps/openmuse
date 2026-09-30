import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { ADMIN_OWNER } from "../apps/server/src/auth.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import type { AgentWorkspace } from "../packages/domain/src/agent.ts";

/**
 * The routes behind the app's full data views: Plans & bookings (upcoming and past), Reminders
 * (upcoming and sent) and Files & media's "Saved by" list.
 */
let db: Store, server: Awaited<ReturnType<typeof createApp>>, directory: string, token: string;
const call = async <T>(path: string, body?: unknown, status = 200): Promise<T> => {
  const response = await server.app.request(path, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
};

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-data-views-"));
  db = await createStore({ dataDir: join(directory, "db") });
  server = await createApp(db, {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "model",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  });
  const session = await server.app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  token = (await session.json()).token;
});
after(async () => {
  await server?.agent?.stop();
  await db?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("Plans & bookings lists past plans too, and a plan can be put back", async () => {
  const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const plan = (id: string, status: string, days: number) => ({
    id,
    kind: "reservation",
    title: `Plan ${id}`,
    at: at(days),
    timeZone: "America/Chicago",
    status,
    source: "chat",
    nudged: [],
    createdAt: at(-10),
    updatedAt: at(-1),
  });
  await db.put(ADMIN_OWNER, "commitments", plan("soon", "upcoming", 2));
  await db.put(ADMIN_OWNER, "commitments", plan("done", "done", -3));
  await db.put(ADMIN_OWNER, "commitments", plan("off", "cancelled", -5));
  await db.put("someone-else", "commitments", plan("theirs", "upcoming", 1));
  type List = { commitments: { id: string; status: string; when: string }[] };
  const upcoming = await call<List>("/api/commitments");
  assert.deepEqual(
    upcoming.commitments.map((c) => c.id),
    ["soon"],
  );
  const all = await call<List>("/api/commitments?all=1");
  assert.deepEqual(all.commitments.map((c) => c.id).sort(), ["done", "off", "soon"]);
  assert.ok(
    all.commitments.every((c) => c.when),
    "each says when, in words",
  );
  // Mark done, then Undo.
  assert.equal(
    (await call<{ status: string }>("/api/commitments/soon", { status: "done" })).status,
    "done",
  );
  assert.equal(
    (await call<{ status: string }>("/api/commitments/soon", { status: "upcoming" })).status,
    "upcoming",
  );
  assert.equal(
    (await call<{ status: string }>("/api/commitments/soon", { status: "cancelled" })).status,
    "cancelled",
  );
  await call("/api/commitments/theirs", { status: "done" }, 404);
});

test("Reminders lists upcoming and sent ones, and cancelling removes one", async () => {
  const reminder = (id: string, status: "upcoming" | "sent", minutes: number) => ({
    id,
    text: `Reminder ${id}`,
    dueAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    timeZone: "America/Chicago",
    status,
    createdAt: new Date().toISOString(),
    ...(status === "sent" ? { sentAt: new Date(Date.now() + minutes * 60_000).toISOString() } : {}),
  });
  await db.put(ADMIN_OWNER, "reminders", reminder("later", "upcoming", 120));
  await db.put(ADMIN_OWNER, "reminders", reminder("sooner", "upcoming", 30));
  await db.put(ADMIN_OWNER, "reminders", reminder("went-off", "sent", -60));
  type Lists = { upcoming: { id: string; when: string }[]; sent: { id: string }[] };
  const lists = await call<Lists>("/api/reminders");
  assert.deepEqual(
    lists.upcoming.map((r) => r.id),
    ["sooner", "later"],
  );
  assert.deepEqual(
    lists.sent.map((r) => r.id),
    ["went-off"],
  );
  await call("/api/reminders/sooner/cancel", {});
  assert.deepEqual(
    (await call<Lists>("/api/reminders")).upcoming.map((r) => r.id),
    ["later"],
  );
});

test("the agent's saved results come with the workspace, only the person's own", async () => {
  const artifact = (id: string, kind: string, createdAt: string) => ({
    id,
    taskId: `task-${id}`,
    kind,
    title: `Result ${id}`,
    summary: "A short summary",
    data: { rows: [1, 2] },
    createdAt,
  });
  await db.put(
    ADMIN_OWNER,
    "agent-artifacts",
    artifact("report", "report", "2026-09-28T10:00:00Z"),
  );
  await db.put(
    ADMIN_OWNER,
    "agent-artifacts",
    artifact("money", "finance", "2026-09-29T10:00:00Z"),
  );
  await db.put(
    "someone-else",
    "agent-artifacts",
    artifact("private", "plan", "2026-09-29T11:00:00Z"),
  );
  const workspace = await call<AgentWorkspace>("/api/agent");
  const mine = workspace.artifacts.map((a) => a.id).sort();
  assert.deepEqual(mine, ["money", "report"]);
  const money = workspace.artifacts.find((a) => a.id === "money");
  assert.deepEqual(money?.data, { rows: [1, 2] }, "with what the result needs to be drawn");
});
