import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { AccountService } from "../apps/server/src/accounts.ts";
import type { Auth } from "../apps/server/src/auth.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("making a member's email the owner's opens the owner workspace and retires the member", async () => {
  const db = await createStore();
  // Earlier, the owner invited this address to try the app, so it has its own member account.
  await db.put("system", "accounts", {
    id: "member-1",
    email: "mark@example.com",
    name: "Mark",
    role: "member",
    handle: "mark",
    status: "active",
    createdAt: "2026-09-01T00:00:00.000Z",
  });
  await db.put("system", "account-emails", { id: hash("mark@example.com"), accountId: "member-1" });
  const config = { adminEmail: "Mark@Example.com", agentEmail: "muse@agent.test" } as Config;
  const accounts = new AccountService(db, config, {} as Auth);
  await accounts.bootstrap();
  assert.equal((await accounts.byEmail("mark@example.com"))?.id, "local-user");
  assert.equal((await accounts.get("local-user"))?.role, "admin");
  // The member account and its workspace stay, switched off, so its sign-ins end.
  assert.equal((await accounts.get("member-1"))?.status, "disabled");
  // Starting again changes nothing.
  await accounts.bootstrap();
  assert.equal((await accounts.byEmail("mark@example.com"))?.id, "local-user");
  await db.close();
});
