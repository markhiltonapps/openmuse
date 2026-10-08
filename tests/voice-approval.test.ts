import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  type CallEar,
  needsTap,
  saysYes,
  voiceApprovalTools,
} from "../apps/server/src/voice-approval.ts";
import type { ActionProposal } from "../packages/domain/src/index.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close?.();
});

const soon = () => new Date(Date.now() + 3_600_000).toISOString();
function action(id: string, kind: string, data: object, title = "Something"): ActionProposal {
  return {
    id,
    kind,
    data,
    title,
    status: "awaiting_review",
    hash: `hash-${id}`,
    createdAt: new Date(Date.now() - 1000 * Number(id.replace(/\D/g, "") || 1)).toISOString(),
    expiresAt: soon(),
  } as unknown as ActionProposal;
}

/** A call's ear the test speaks into: only what's said after the read-back counts. */
function fakeEar() {
  let mark: { ids: string[]; at: number; said: string[] } | undefined;
  const ear: CallEar & { say(words: string): void } = {
    readBack: (ids) => {
      mark = { ids, at: Date.now(), said: [] };
    },
    heard: () => mark,
    forget: () => {
      mark = undefined;
    },
    say: (words) => mark?.said.push(words),
  };
  return ear;
}

async function setUp(owner: string) {
  await db.put(
    owner,
    "actions",
    action("a1", "email.send", { to: ["bob@example.com"], subject: "Friday" }, "Email Bob"),
  );
  await db.put(
    owner,
    "actions",
    action(
      "a2",
      "calendar.create",
      { title: "Dentist", start: "2026-10-14T15:00:00", timeZone: "America/Chicago" },
      "Add Dentist",
    ),
  );
  await db.put(
    owner,
    "actions",
    action(
      "a3",
      "app.action",
      { app: "Amazon", tool: "AMAZON_PLACE_ORDER", amountUsd: 45, arguments: {} },
      "Order from Amazon",
    ),
  );
  const decided: [string, string][] = [];
  const decider = {
    decide: async (_owner: string, id: string, hash: string, decision: "approve" | "deny") => {
      assert.equal(hash, `hash-${id}`);
      decided.push([id, decision]);
      const found = await db.get<ActionProposal>(owner, "actions", id);
      return {
        ...(found as ActionProposal),
        status: decision === "approve" ? "executing" : "denied",
      };
    },
  };
  const ear = fakeEar();
  const [readBack, approveByVoice] = voiceApprovalTools(db, decider as never, owner, ear);
  assert.ok(readBack && approveByVoice);
  const read = () => (readBack.execute as (a: object) => Promise<Record<string, unknown>>)({});
  const approve = (args: { approve?: string[]; decline?: string[] }) =>
    (approveByVoice.execute as (a: object) => Promise<Record<string, unknown>>)({
      approve: [],
      decline: [],
      ...args,
    });
  return { decided, ear, read, approve };
}

test("money needs a tap; everything else can be approved by voice", () => {
  assert.equal(needsTap(action("x", "app.action", { tool: "AMAZON_PLACE_ORDER" })), true);
  assert.equal(needsTap(action("x", "app.action", { tool: "SLACK_SEND", arguments: {} })), false);
  assert.equal(needsTap(action("x", "browser.step", { element: "Pay now", summary: "" })), true);
  assert.equal(
    needsTap(action("x", "browser.step", { element: "Reserve 7:15 PM", summary: "" })),
    false,
  );
  assert.equal(needsTap(action("x", "email.send", { to: ["a@b.co"] })), false);
  assert.equal(saysYes("Yes, go ahead"), true);
  assert.equal(saysYes("hmm, what was that"), false);
});

test("Neddy reads back what's waiting, and money stays a tap", async () => {
  const { read, ear } = await setUp("voice-1");
  const result = await read();
  const say = String(result.say);
  assert.match(say, /2 things are waiting/);
  assert.match(say, /the email to bob@example.com about “Friday”/);
  assert.match(say, /adding “Dentist” to your calendar/);
  assert.match(say, /involves money, so it needs a tap/);
  assert.deepEqual(ear.heard()?.ids.sort(), ["a1", "a2"]);
  // All three cards go on the screen.
  assert.equal((result.approvals as unknown[]).length, 3);
});

test("nothing is approved without the person's own yes after the read-back", async () => {
  const { read, approve, ear, decided } = await setUp("voice-2");
  // No read-back yet.
  assert.match(String((await approve({ approve: ["a1"] })).error), /read_back_approvals first/);
  await read();
  // The agent can't approve before they answer.
  assert.match(String((await approve({ approve: ["a1"] })).error), /haven't answered/);
  // Something unclear isn't a yes.
  ear.say("hmm, what was the second one?");
  assert.match(String((await approve({ approve: ["a1"] })).error), /wasn't a clear yes/);
  // The purchase wasn't read back for voice, so it can't be approved this way.
  ear.say("yes approve all");
  assert.match(String((await approve({ approve: ["a3"] })).error), /Only what was just read back/);
  assert.deepEqual(decided, []);
});

test("“approve all” approves everything that was read back, once", async () => {
  const { read, approve, ear, decided } = await setUp("voice-3");
  await read();
  ear.say("Yes, approve all of them");
  const result = await approve({ approve: ["a1", "a2"] });
  assert.deepEqual(decided, [
    ["a1", "approve"],
    ["a2", "approve"],
  ]);
  assert.equal((result.approved as string[]).length, 2);
  // One read-back, one decision.
  assert.match(String((await approve({ approve: ["a1"] })).error), /read_back_approvals first/);
});

test("a plain yes to several needs “all”; choosing some and not others works", async () => {
  const { read, approve, ear, decided } = await setUp("voice-4");
  await read();
  ear.say("yes");
  assert.match(String((await approve({ approve: ["a1", "a2"] })).error), /didn't say all/);
  ear.say("send the email but not the dentist one, cancel that");
  const result = await approve({ approve: ["a1"], decline: ["a2"] });
  assert.deepEqual(decided, [
    ["a1", "approve"],
    ["a2", "deny"],
  ]);
  assert.equal((result.declined as string[]).length, 1);
});
