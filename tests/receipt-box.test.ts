import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Auth } from "../apps/server/src/auth.ts";
import { DiskBlobs } from "../apps/server/src/blobs.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { Files } from "../apps/server/src/files.ts";
import { GOOD_STREAK, ReceiptBox } from "../apps/server/src/receipt-box.ts";
import { receiptToolSpec } from "../apps/server/src/receipt-tools.ts";
import { ReminderService } from "../apps/server/src/reminders.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const target = {
  isReceipt: true,
  merchant: "Target",
  date: "2026-11-11",
  currency: "USD",
  total: 61.27,
  subtotal: 56.5,
  tax: 4.77,
  paymentLast4: "4821",
  category: "Home",
  returnDays: 30,
  items: [],
  unclear: [],
};

async function setup(answer: () => unknown) {
  const dir = await mkdtemp(join(tmpdir(), "receipt-box-"));
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: dir,
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  const db = await createStore();
  const files = new Files(db, config, new Auth(db, config, "test-signing-key"), new DiskBlobs(dir));
  let now = Date.parse("2026-11-11T18:00:00Z");
  const sent: string[] = [];
  const reminders = new ReminderService(
    db,
    async () => "America/Chicago",
    async (_owner, reminder) => {
      sent.push(reminder.title);
    },
    () => now,
  );
  let reads = 0;
  const box = new ReceiptBox(
    db,
    files,
    async () => "America/Chicago",
    () => async () => {
      reads += 1;
      return JSON.stringify(answer());
    },
    reminders,
    () => now,
  );
  const photo = { bytes: new Uint8Array(PNG), name: "receipt.png", mimeType: "image/png" };
  return {
    db,
    box,
    files,
    reminders,
    photo,
    reads: () => reads,
    advance: (ms: number) => {
      now += ms;
    },
    done: async () => {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("a clear receipt lands in To check with its return date, nothing filed until the person says", async () => {
  const t = await setup(() => target);
  const owner = "alex";
  const snap = await t.box.snap(owner, t.photo);
  assert.equal(snap.outcome, "to-check");
  assert.equal(snap.receipt?.status, "to-check");
  assert.equal(snap.receipt?.returnBy, "2026-12-11");
  assert.deepEqual(snap.receipt?.keepFor, ["Return window"]);
  assert.equal(snap.receipt?.paidLast4, "4821");
  assert.equal((await t.box.summary(owner)).toCheck, 1);
  await t.done();
});

test("filing sets a return reminder three days ahead; marking it returned clears it", async () => {
  const t = await setup(() => target);
  const owner = "alex";
  const { receipt } = await t.box.snap(owner, t.photo);
  const filed = await t.box.file(owner, receipt?.id as string);
  assert.equal(filed.status, "filed");
  assert.ok(filed.reminderId);
  const { upcoming } = await t.reminders.list(owner);
  assert.equal(upcoming.length, 1);
  assert.ok(upcoming[0]?.dueAt.startsWith("2026-12-08"));
  const summary = await t.box.summary(owner);
  assert.equal(summary.filedThisMonth, 1);
  assert.equal(summary.monthTotal, 61.27);
  await t.box.setReturn(owner, filed.id, "returned");
  assert.equal((await t.reminders.list(owner)).upcoming.length, 0);
  assert.equal((await t.box.get(owner, filed.id)).returnState, "returned");
  await t.done();
});

test("a total that is only a guess between two readings has to be chosen before filing", async () => {
  const t = await setup(() => ({
    ...target,
    subtotal: null,
    tax: null,
    total: 61.27,
    totalOtherReadings: [67.27],
    unclear: ["total"],
  }));
  const owner = "alex";
  const { receipt } = await t.box.snap(owner, t.photo);
  assert.deepEqual([...(receipt?.candidates ?? [])].sort(), [61.27, 67.27]);
  await assert.rejects(t.box.file(owner, receipt?.id as string), /Choose which total/);
  // Changing something else doesn't lift the block; confirming the total does.
  await t.box.update(owner, receipt?.id as string, { category: "Dining" });
  await assert.rejects(t.box.file(owner, receipt?.id as string), /Choose which total/);
  await t.box.update(owner, receipt?.id as string, { total: 61.27 });
  assert.equal((await t.box.file(owner, receipt?.id as string)).status, "filed");
  await t.done();
});

test("not a receipt and several receipts are never filed, and their photos are removed", async () => {
  let reply: unknown = { ...target, isReceipt: false };
  const t = await setup(() => reply);
  const owner = "alex";
  assert.equal((await t.box.snap(owner, t.photo)).outcome, "not-a-receipt");
  reply = { ...target, multipleReceipts: true };
  assert.equal((await t.box.snap(owner, t.photo)).outcome, "several");
  assert.equal((await t.box.list(owner)).length, 0);
  assert.equal((await t.files.list(owner)).length, 0);
  await t.done();
});

test("an unreadable answer keeps the photo and files nothing", async () => {
  const t = await setup(() => "garbage");
  const snap = await t.box.snap("alex", t.photo);
  assert.equal(snap.outcome, "unreadable");
  assert.ok(snap.fileId);
  assert.equal((await t.box.list("alex")).length, 0);
  await t.done();
});

test("the same store, day and total again is flagged as a duplicate, not dropped", async () => {
  const t = await setup(() => target);
  const owner = "alex";
  const first = await t.box.snap(owner, t.photo);
  const second = await t.box.snap(owner, t.photo);
  assert.equal(second.outcome, "duplicate");
  assert.equal(second.receipt?.duplicateOf, first.receipt?.id);
  assert.equal((await t.box.list(owner)).length, 2);
  await t.done();
});

test("after ten unchanged checks auto-filing is offered; once on, only sure receipts file themselves", async () => {
  let n = 0;
  const t = await setup(() => ({
    ...target,
    date: `2026-10-${String(1 + (n++ % 28)).padStart(2, "0")}`,
    returnDays: null,
  }));
  const owner = "alex";
  for (let i = 0; i < GOOD_STREAK; i++) {
    const { receipt } = await t.box.snap(owner, t.photo);
    assert.equal((await t.box.summary(owner)).autoFile.offer, false);
    await t.box.file(owner, receipt?.id as string);
  }
  assert.equal((await t.box.summary(owner)).autoFile.offer, true);
  await t.box.setAutoFile(owner, true);
  assert.equal((await t.box.summary(owner)).autoFile.offer, false);
  const auto = await t.box.snap(owner, t.photo);
  assert.equal(auto.outcome, "filed");
  assert.equal(auto.receipt?.autoFiled, true);
  // Taking it back resets the streak and returns it to To check.
  const back = await t.box.unfile(owner, auto.receipt?.id as string);
  assert.equal(back.status, "to-check");
  assert.equal(back.autoFiled, false);
  await t.done();
});

test("an unsure read stops at Check it even with auto-filing on", async () => {
  let unsure = false;
  const t = await setup(() => ({
    ...target,
    unclear: unsure ? ["date"] : [],
    date: unsure ? null : "2026-11-11",
  }));
  const owner = "alex";
  await t.box.setAutoFile(owner, true);
  unsure = true;
  const snap = await t.box.snap(owner, t.photo);
  assert.equal(snap.outcome, "to-check");
  assert.ok(snap.receipt?.unsure.includes("date"));
  await t.done();
});

test("fixing a field removes the doubt about it, and a date change moves the return date", async () => {
  const t = await setup(() => ({ ...target, unclear: ["total"] }));
  const owner = "alex";
  const { receipt } = await t.box.snap(owner, t.photo);
  const fixed = await t.box.update(owner, receipt?.id as string, {
    total: 61.21,
    category: "Dining",
    returnBy: "2026-12-20",
  });
  assert.equal(fixed.total, 61.21);
  assert.equal(fixed.category, "Dining");
  assert.ok(!fixed.unsure.includes("total"));
  assert.equal(fixed.returnBy, "2026-12-20");
  await t.done();
});

test("find searches by store, month and text; delete removes photo, record and reminder", async () => {
  const t = await setup(() => target);
  const owner = "alex";
  const { receipt } = await t.box.snap(owner, t.photo);
  await t.box.file(owner, receipt?.id as string);
  assert.equal((await t.box.list(owner, { merchant: "targ" })).length, 1);
  assert.equal((await t.box.list(owner, { month: "2026-10" })).length, 0);
  assert.equal((await t.box.list(owner, { keepFor: "return window" })).length, 1);
  await t.box.remove(owner, receipt?.id as string);
  assert.equal((await t.box.list(owner)).length, 0);
  assert.equal((await t.files.list(owner)).length, 0);
  assert.equal((await t.reminders.list(owner)).upcoming.length, 0);
  await t.done();
});

test("one person's receipts are never another's", async () => {
  const t = await setup(() => target);
  const { receipt } = await t.box.snap("alex", t.photo);
  await assert.rejects(t.box.get("sam", receipt?.id as string), /isn’t in your Receipt box/);
  assert.equal((await t.box.list("sam")).length, 0);
  await t.done();
});

test("reads are capped per hour so a stuck loop can't run up cost", async () => {
  const t = await setup(() => ({ ...target, isReceipt: false }));
  for (let i = 0; i < 30; i++) await t.box.snap("alex", t.photo);
  await assert.rejects(t.box.snap("alex", t.photo), /lot of receipts/);
  assert.equal(t.reads(), 30);
  t.advance(61 * 60 * 1000);
  assert.equal((await t.box.snap("alex", t.photo)).outcome, "not-a-receipt");
  await t.done();
});

test("the agent's tool reads a photo already in Files and claims a card only in the chat", async () => {
  const t = await setup(() => target);
  const owner = "alex";
  const file = await t.files.import(owner, "photo.png", new Uint8Array(PNG), "Uploaded by you");
  const chat = receiptToolSpec(t.box, owner);
  const read = (await chat.execute({ do: "read", fileId: file.id })) as {
    outcome: string;
    shown?: string;
    receipt: { id: string };
  };
  assert.equal(read.outcome, "ready to check");
  assert.ok(read.shown);
  // The same photo is not read twice.
  const again = (await chat.execute({ do: "read", fileId: file.id })) as {
    receipt: { id: string };
  };
  assert.equal(again.receipt.id, read.receipt.id);
  assert.equal(t.reads(), 1);
  const filed = (await chat.execute({ do: "file" })) as {
    receipt: { status: string };
    reminder?: string;
  };
  assert.equal(filed.receipt.status, "filed");
  assert.ok(filed.reminder);
  const onCall = receiptToolSpec(t.box, owner, { onCall: true });
  const found = (await onCall.execute({ do: "find", text: "target" })) as {
    count: number;
    shown?: string;
  };
  assert.equal(found.count, 1);
  assert.equal(found.shown, undefined);
  await t.done();
});
