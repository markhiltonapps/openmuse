import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalToolSpec } from "../apps/server/src/approval-tools.ts";
import { createStore } from "../apps/server/src/db.ts";

const NOW = Date.parse("2026-10-01T15:00:00Z");

test("show_approvals brings back what's waiting, newest first, narrowed by words, never expired ones", async () => {
  const db = await createStore();
  const action = (id: string, title: string, at: string, extra = {}) => ({
    id,
    title,
    kind: "app.action",
    data: { app: "gmail", tool: `GMAIL_${id}`, arguments: { ref: id }, summary: title },
    status: "awaiting_review",
    hash: `hash-${id}`,
    createdAt: at,
    expiresAt: "2026-10-01T23:00:00Z",
    ...extra,
  });
  await db.put(
    "owner",
    "actions",
    action("a1", "Send draft “Q3 numbers” to Dan", "2026-10-01T14:00:00Z"),
  );
  await db.put("owner", "actions", action("a2", "Book a table at Uchi", "2026-10-01T14:30:00Z"));
  await db.put(
    "owner",
    "actions",
    action("a3", "Old one", "2026-10-01T09:00:00Z", { expiresAt: "2026-10-01T10:00:00Z" }),
  );
  await db.put(
    "owner",
    "actions",
    action("a4", "Done one", "2026-10-01T14:40:00Z", { status: "succeeded" }),
  );
  const tool = approvalToolSpec(db, "owner", () => NOW);
  const all = await tool.execute({});
  assert.deepEqual(
    all.approvals.map((a) => a.actionId),
    ["a2", "a1"],
  );
  const dan = await tool.execute({ about: "dan" });
  assert.deepEqual(dan.approvals, [{ actionId: "a1", title: "Send draft “Q3 numbers” to Dan" }]);
  assert.match(dan.message, /Approve cards are on the person's screen/);
  // Nothing matched: what's waiting is shown instead, and the agent asks which.
  const none = await tool.execute({ about: "passport" });
  assert.equal(none.approvals.length, 2);
  assert.match(none.message, /Ask if it's one of these/);
  // "Send the draft I approved" after it expired: its details come back, to set it up again.
  const old = await tool.execute({ about: "the old one" });
  assert.deepEqual(old.approvals, []);
  const expired = ("expired" in old ? old.expired : undefined) ?? [];
  assert.equal(expired[0]?.title, "Old one");
  assert.deepEqual(expired[0]?.details, {
    app: "gmail",
    tool: "GMAIL_a3",
    arguments: { ref: "a3" },
  });
  assert.match(old.message, /Set it up again with the same details/);
  // Short words don't count: "to" and "the" match everything.
  const vague = await tool.execute({ about: "to the" });
  assert.equal(vague.approvals.length, 2);
  // Expired, then set up again (Neddy words it afresh, so its title and hash differ) and sent: it's
  // already done, never set up a second time.
  const draft = { app: "gmail", tool: "GMAIL_SEND_DRAFT", arguments: { draft_id: "r-77" } };
  await db.put(
    "owner",
    "actions",
    action("a5", "Send the budget to Lee", "2026-10-01T08:00:00Z", {
      data: { ...draft, summary: "Send the budget to Lee" },
      expiresAt: "2026-10-01T08:30:00Z",
      status: "expired",
    }),
  );
  await db.put(
    "owner",
    "actions",
    action("a6", "Email Lee the budget draft", "2026-10-01T09:00:00Z", {
      data: { ...draft, summary: "Email Lee the budget draft" },
      status: "succeeded",
      result: "Sent to lee@example.com",
    }),
  );
  const sent = await tool.execute({ about: "budget lee" });
  assert.deepEqual(sent.approvals, []);
  assert.ok(!("expired" in sent));
  const done = ("alreadyDone" in sent ? sent.alreadyDone : undefined) ?? [];
  assert.equal(done[0]?.status, "succeeded");
  assert.equal(done[0]?.result, "Sent to lee@example.com");
  assert.match(sent.message, /already done.*Don't set it up again/);
  // Approved in time, asked about later ("did it go? send it if not"): already done too.
  await db.put(
    "owner",
    "actions",
    action("a7", "Pay the water bill", "2026-10-01T11:00:00Z", {
      status: "succeeded",
      result: "Paid $48.20",
    }),
  );
  const water = await tool.execute({ about: "water bill" });
  const paid = ("alreadyDone" in water ? water.alreadyDone : undefined) ?? [];
  assert.equal(paid[0]?.result, "Paid $48.20");
  // Someone else sees nothing of this.
  const other = await approvalToolSpec(db, "someone-else", () => NOW).execute({});
  assert.deepEqual(other.approvals, []);
  await db.close();
});
