import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AppConnector,
  appToolSpecs,
  findGmailIds,
  GMAIL_BATCH_LIMIT,
  gmailPage,
  runAppAction,
} from "../apps/server/src/apps.ts";
import type { AppAction } from "../packages/domain/src/index.ts";

/** A Gmail id: 16 hex characters, like Gmail's own. */
const gid = (n: number) => `18${n.toString(16).padStart(14, "0")}`;

/** A fake Gmail with `total` matching emails, served 500 a page, ids only. */
function fakeGmail(total: number, options: { rejectIdsOnly?: boolean } = {}) {
  const calls: Record<string, unknown>[] = [];
  const run = async (slug: string, args: Record<string, unknown>) => {
    if (slug !== "GMAIL_FETCH_EMAILS") throw new Error(`unexpected ${slug}`);
    calls.push(args);
    if (options.rejectIdsOnly && args.ids_only) throw new Error("Unknown parameter ids_only");
    const start = Number(args.page_token ?? 0);
    const size = Math.min(Number(args.max_results ?? 1), 500);
    const ids = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) =>
      gid(start + i + 1),
    );
    return {
      data: {
        messages: ids.map((id) =>
          args.ids_only
            ? { messageId: id, threadId: `t${id}` }
            : {
                messageId: id,
                threadId: `t${id}`,
                sender: "jobs@lever.co",
                subject: "Applied",
                messageText: "x",
                labelIds: ["INBOX"],
              },
        ),
        ...(start + size < total ? { nextPageToken: String(start + size) } : {}),
        resultSizeEstimate: total,
      },
    };
  };
  return { run, calls };
}

test("gmailPage finds message ids and the next page, not thread or label ids", () => {
  const page = gmailPage({
    data: {
      messages: [
        { messageId: gid(1), threadId: gid(99), labelIds: ["INBOX", "Label_4"] },
        { id: gid(2), threadId: gid(98) },
      ],
      nextPageToken: "tok",
    },
  });
  assert.deepEqual(page.ids, [gid(1), gid(2)]);
  assert.equal(page.next, "tok");
  assert.deepEqual(gmailPage({ messageIds: [gid(3), "not-an-id"] }).ids, [gid(3)]);
  assert.deepEqual(gmailPage(null), { ids: [] });
});

test("findGmailIds reads every page, ids only", async () => {
  const gmail = fakeGmail(1234);
  const found = await findGmailIds(gmail.run, "in:inbox from:lever.co");
  assert.equal(found.ids.length, 1234);
  assert.equal(new Set(found.ids).size, 1234);
  assert.equal(found.more, false);
  assert.equal(gmail.calls.length, 3);
  assert.equal(gmail.calls[0]?.ids_only, true);
  assert.equal(gmail.calls[0]?.query, "in:inbox from:lever.co");
  assert.equal(gmail.calls[2]?.page_token, "1000");
});

test("findGmailIds stops at the cap and says there are more", async () => {
  const gmail = fakeGmail(5000);
  const found = await findGmailIds(gmail.run, "label:old", 1200);
  assert.equal(found.ids.length, 1200);
  assert.equal(found.more, true);
});

test("findGmailIds asks again without ids_only when the action doesn't know it", async () => {
  const gmail = fakeGmail(700, { rejectIdsOnly: true });
  const found = await findGmailIds(gmail.run, "subject:invoice");
  assert.equal(found.ids.length, 700);
  assert.equal(gmail.calls.filter((call) => call.ids_only).length, 1);
});

test("runAppAction sends a big Gmail change in parts of 1,000", async () => {
  const sent: string[][] = [];
  const run = async (_slug: string, args: Record<string, unknown>) => {
    sent.push(args.messageIds as string[]);
    return {};
  };
  const ids = Array.from({ length: 2500 }, (_, i) => gid(i + 1));
  const result = await runAppAction(run, "GMAIL_BATCH_MODIFY_MESSAGES", {
    userId: "me",
    messageIds: ids,
    addLabelIds: ["Label_44"],
    removeLabelIds: ["INBOX"],
  });
  assert.deepEqual(
    sent.map((part) => part.length),
    [GMAIL_BATCH_LIMIT, GMAIL_BATCH_LIMIT, 500],
  );
  assert.deepEqual(sent.flat(), ids);
  assert.deepEqual(result, { emails: 2500, batches: 3 });
  // Small changes and other actions go through untouched.
  sent.length = 0;
  await runAppAction(run, "GMAIL_BATCH_MODIFY_MESSAGES", { messageIds: ids.slice(0, 3) });
  assert.equal(sent.length, 1);
});

test("a failed part says how many were changed and that approving again is safe", async () => {
  let calls = 0;
  const run = async () => {
    if (++calls === 2) throw new Error("Gmail is busy");
    return {};
  };
  const ids = Array.from({ length: 2100 }, (_, i) => gid(i + 1));
  await assert.rejects(
    runAppAction(run, "GMAIL_BATCH_MODIFY_MESSAGES", { messageIds: ids }),
    /Changed 1000 of 2100 emails.*Gmail is busy.*Approving it again is safe/,
  );
});

test("find_gmail_matching then move_gmail_to_folder moves every match in one Approve card", async () => {
  const gmail = fakeGmail(1800);
  const apps: AppConnector = {
    search: async () => ({ tools: [], apps: [], guidance: [] }),
    tool: async (_owner, slug) => ({
      slug,
      name: slug,
      description: "",
      app: "gmail",
      readOnly: false,
    }),
    execute: async (_owner, slug, args) =>
      slug === "GMAIL_LIST_LABELS"
        ? {
            data: {
              labels: [
                { id: "INBOX", name: "INBOX" },
                { id: "Label_44", name: "Jobs" },
              ],
            },
          }
        : gmail.run(slug, args),
    connect: async () => ({ connected: true }),
    connections: async () => [],
    directory: async () => [],
    disconnect: async () => {},
  };
  const proposed: AppAction[] = [];
  const specs = appToolSpecs(apps, "bulk-owner", async (action) => {
    proposed.push(action);
    return { id: "a1", title: action.summary, hash: "h" };
  });
  const call = (name: string) =>
    specs.find((spec) => spec.name === name)?.execute as (
      args: unknown,
    ) => Promise<Record<string, unknown>>;
  const found = await call("find_gmail_matching")({ query: "in:inbox from:lever.co" });
  assert.equal(found.count, 1800);
  assert.match(String(found.selection), /^sel_/);
  assert.equal((found.examples as unknown[]).length, 5);
  const moved = await call("move_gmail_to_folder")({ selection: found.selection, folder: "jobs" });
  assert.equal(moved.status, "awaiting_review");
  assert.equal(moved.count, 1800);
  assert.equal(proposed.length, 1);
  const action = proposed[0] as AppAction;
  assert.equal(action.summary, "Move 1,800 Gmail emails to Jobs");
  assert.equal((action.arguments.messageIds as string[]).length, 1800);
  assert.deepEqual(action.arguments.removeLabelIds, ["INBOX"]);
  // The ids fit in one saved action (the action's size limit is 100,000 characters).
  assert.ok(JSON.stringify(action.arguments).length < 100000);
  // Someone else's selection, or a made-up one, moves nothing.
  const other = appToolSpecs(apps, "someone-else", async () => ({ id: "x", title: "x" }));
  const moveTheirs = other.find((spec) => spec.name === "move_gmail_to_folder");
  assert.ok(moveTheirs);
  const theirs = (moveTheirs.execute as (args: unknown) => Promise<Record<string, unknown>>)({
    selection: found.selection,
    folder: "jobs",
  });
  assert.match(String((await theirs).error), /expired or isn't this person's/);
  const none = await call("move_gmail_to_folder")({ folder: "jobs" });
  assert.match(String(none.error), /No emails to move/);
});

test("the largest selection still fits in one saved action", () => {
  const ids = Array.from({ length: 4000 }, (_, i) => gid(i + 1));
  const args = {
    userId: "me",
    messageIds: ids,
    addLabelIds: ["Label_44"],
    removeLabelIds: ["INBOX"],
  };
  assert.ok(JSON.stringify(args).length < 100000);
});
