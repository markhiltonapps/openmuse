import assert from "node:assert/strict";
import { test } from "node:test";
import { recentUpdates } from "../apps/server/src/engine/service.ts";
import type { AgentNotification, AgentTask } from "../packages/domain/src/agent.ts";

const now = Date.parse("2026-10-11T12:00:00Z");
const update = (id: string, daysAgo: number, extra: Partial<AgentNotification> = {}) =>
  ({
    id,
    title: id,
    body: "",
    createdAt: new Date(now - daysAgo * 86_400_000).toISOString(),
    read: false,
    ...extra,
  }) as AgentNotification;

test("the bell keeps the last week's updates, and older ones that still need the person", () => {
  const tasks = [
    { id: "asks", status: "waiting_input" },
    { id: "done", status: "succeeded" },
  ] as Pick<AgentTask, "id" | "status">[];
  const shown = recentUpdates(
    [
      update("new", 1),
      update("old email", 30),
      update("old job done", 10, { taskId: "done" }),
      update("old question", 10, { taskId: "asks" }),
      update("old question, read", 10, { taskId: "asks", read: true }),
    ],
    tasks,
    now,
  ).map((item) => item.id);
  // A job still waiting on them stays, read or not (Mark all read doesn't make it go away).
  assert.deepEqual(shown, ["new", "old question", "old question, read"]);
});
