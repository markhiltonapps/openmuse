import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AppConnector } from "../apps/server/src/apps.ts";
import { Auth } from "../apps/server/src/auth.ts";
import { DiskBlobs } from "../apps/server/src/blobs.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { Files } from "../apps/server/src/files.ts";
import { Proactive } from "../apps/server/src/proactive.ts";
import { type BoxReceipt, ReceiptBox } from "../apps/server/src/receipt-box.ts";
import {
  alreadyHave,
  looksLikeReceiptEmail,
  merchantName,
  ReceiptNudges,
  restaurantCharges,
} from "../apps/server/src/receipt-nudges.ts";
import { ReminderService } from "../apps/server/src/reminders.ts";

const MINUTE = 60_000;
const charge = (id: string, mcc: string, cents: number, extra: Record<string, unknown> = {}) => ({
  id,
  amount: { amount: cents, currency: "USD" },
  merchant: { raw_descriptor: "SQ *MARLOWS TAVERN SAN FRANCISCO CA", mcc },
  initiated_at_date: "2026-11-26",
  type: "PURCHASE",
  ...extra,
});

test("restaurant charges are read from Brex's answer by business code, in dollars, purchases only", () => {
  const found = restaurantCharges({
    data: {
      response_data: {
        items: [
          charge("t1", "5812", 4820),
          charge("t2", "5411", 9000), // a grocery store
          charge("t3", "5814", 650, {
            merchant: { raw_descriptor: "STARBUCKS #1234", mcc: "5814" },
          }),
          charge("t4", "5812", 4820, { type: "REFUND" }),
          charge("t5", "5813", 0),
        ],
      },
    },
  });
  assert.deepEqual(
    found.map((c) => [c.id, c.merchant, c.amount]),
    [
      ["t1", "Marlows Tavern", 48.2],
      ["t3", "Starbucks", 6.5],
    ],
  );
  assert.equal(merchantName("TST* JOES PIZZA 415-555-1212 NY"), "Joes Pizza");
});

test("a receipt already in the box matches by day and name or amount, tips allowed", () => {
  const box = [{ merchant: "Marlow's Tavern", date: "2026-11-26", total: 40 }];
  assert.ok(alreadyHave(box, { merchant: "Marlows Tavern", day: "2026-11-26" }));
  assert.ok(
    alreadyHave(box, { merchant: "SQ 1234", day: "2026-11-27", amount: 48.2 }),
    "tip on top",
  );
  assert.ok(!alreadyHave(box, { merchant: "Other Place", day: "2026-11-26", amount: 90 }));
  assert.ok(!alreadyHave(box, { merchant: "Marlows", day: "2026-11-20" }), "a week apart");
});

test("receipt emails are picked by the real sender address and a receipt subject", () => {
  assert.ok(
    looksLikeReceiptEmail({
      from: "Uber Receipts <noreply@uber.com>",
      subject: "Your Thursday evening trip with Uber",
    }),
  );
  assert.ok(
    looksLikeReceiptEmail({
      from: "DoorDash <no-reply@doordash.com>",
      subject: "Order Confirmation for Alex from Thai Spice",
    }),
  );
  assert.ok(
    looksLikeReceiptEmail({
      from: "receipts@messaging.squareup.com",
      subject: "Receipt from Blue Bottle",
    }),
  );
  assert.ok(
    !looksLikeReceiptEmail({
      from: "Uber <noreply@uber.com.example.net>",
      subject: "Your receipt",
    }),
    "a look-alike domain",
  );
  assert.ok(
    !looksLikeReceiptEmail({
      from: "DoorDash <deals@doordash.com>",
      subject: "50% off this weekend",
    }),
  );
});

async function setup(options: { brex?: unknown; receipts?: BoxReceipt[]; place?: string } = {}) {
  const db = await createStore();
  let now = Date.parse("2026-11-26T20:00:00Z");
  const sent: { title: string; body: string; nudgeId: string }[] = [];
  const proactive = new Proactive(db, {
    timeZone: async () => "America/Los_Angeles",
    notify: async () => undefined,
    now: () => now,
  });
  const apps = {
    connections: async () => [{ app: "brex", name: "Brex", connected: true }],
    execute: async (_owner: string, slug: string) => {
      assert.equal(slug, "BREX_GET_CARD_TRANSACTIONS");
      return options.brex ?? { data: { items: [] } };
    },
  } as unknown as AppConnector;
  const nudges = new ReceiptNudges(db, {
    proactive,
    notify: async (_owner, note) => {
      sent.push(note);
    },
    timeZone: async () => "America/Los_Angeles",
    receipts: async () => options.receipts ?? [],
    apps,
    owners: async () => ["alex"],
    placeToEat: async () => (options.place ? { name: options.place } : undefined),
    now: () => now,
  });
  return {
    db,
    proactive,
    nudges,
    sent,
    advance: (ms: number) => {
      now += ms;
    },
    at: () => now,
  };
}

test("a restaurant charge on the card is asked about once, with the amount", async () => {
  const t = await setup({ brex: { data: { items: [charge("t1", "5812", 4820)] } } });
  await t.nudges.tick();
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0]?.title, "Add the receipt for Marlows Tavern?");
  assert.match(t.sent[0]?.body ?? "", /\$48\.20 on your card/);
  assert.equal(t.sent[0]?.nudgeId, "card:t1");
  t.advance(40 * MINUTE);
  await t.nudges.tick();
  assert.equal(t.sent.length, 1, "never twice");
  const closed = await t.nudges.close("alex", "card:t1", "dismissed");
  assert.equal(closed?.status, "dismissed");
  await t.db.close();
});

test("no question when the receipt is already in the box, or receipts are muted", async () => {
  const have = { merchant: "Marlow's Tavern", date: "2026-11-26", total: 42 } as BoxReceipt;
  const t = await setup({
    brex: { data: { items: [charge("t1", "5812", 4820)] } },
    receipts: [have],
  });
  await t.nudges.tick();
  assert.equal(t.sent.length, 0);
  assert.equal((await t.nudges.get("alex", "card:t1"))?.status, "done");
  await t.db.close();

  const m = await setup({ brex: { data: { items: [charge("t2", "5812", 4820)] } } });
  await m.db.put("alex", "proactive", {
    id: "settings",
    on: true,
    dailyCap: 8,
    dailyCheck: true,
    muted: { receipts: m.at() + 30 * 24 * 60 * MINUTE },
  });
  await m.nudges.tick();
  assert.equal(m.sent.length, 0, "the Receipts switch is off");
  assert.equal((await m.nudges.get("alex", "card:t2"))?.status, "dismissed");
  await m.db.close();
});

test("a charge more than three days old isn't asked about", async () => {
  const t = await setup({
    brex: { data: { items: [charge("old", "5812", 2000, { initiated_at_date: "2026-11-20" })] } },
  });
  await t.nudges.tick();
  assert.equal(t.sent.length, 0);
  await t.db.close();
});

/** Reports every five minutes at one spot, then one from somewhere else. */
async function stay(t: Awaited<ReturnType<typeof setup>>, minutes: number, away = 400) {
  const spot = { lat: 37.7749, lng: -122.4194 };
  for (let m = 0; m <= minutes; m += 5) {
    await t.nudges.seen({ owner: "alex", ...spot, accuracy: 15, at: t.at(), first: m === 0 });
    t.advance(5 * MINUTE);
  }
  await t.nudges.seen({
    owner: "alex",
    lat: spot.lat + away / 111_000,
    lng: spot.lng,
    accuracy: 15,
    at: t.at(),
    first: false,
  });
}

test("twenty minutes at a place to eat, then leaving, asks once", async () => {
  const t = await setup({ place: "Marlow's Tavern" });
  await stay(t, 45);
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0]?.title, "Add the receipt for Marlow's Tavern?");
  assert.match(t.sent[0]?.body ?? "", /spent a while there/);
  await t.db.close();
});

test("a short stop, a place that isn't for eating, or staying put never asks", async () => {
  const short = await setup({ place: "Marlow's Tavern" });
  await stay(short, 10);
  assert.equal(short.sent.length, 0, "ten minutes is passing by");
  await short.db.close();

  const office = await setup({});
  await stay(office, 60);
  assert.equal(office.sent.length, 0, "no place to eat there");
  await office.db.close();

  const still = await setup({ place: "Marlow's Tavern" });
  await stay(still, 60, 30);
  assert.equal(still.sent.length, 0, "a wobble of 30 m is still there");
  await still.db.close();
});

test("the visit and the card charge for the same meal are one question", async () => {
  const t = await setup({
    place: "Marlows Tavern",
    brex: { data: { items: [charge("t1", "5812", 4820)] } },
  });
  await stay(t, 45);
  assert.equal(t.sent.length, 1);
  t.advance(40 * MINUTE);
  await t.nudges.tick();
  assert.equal(t.sent.length, 1, "the charge is the same meal");
  assert.equal((await t.nudges.get("alex", "card:t1"))?.status, "dismissed");
  await t.db.close();
});

test("a receipt email is read, kept as text and filed on its own; each email once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "receipt-email-"));
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
  const now = Date.parse("2026-11-26T20:00:00Z");
  const reminders = new ReminderService(
    db,
    async () => "America/Chicago",
    async () => undefined,
    () => now,
  );
  const box = new ReceiptBox(
    db,
    files,
    async () => "America/Chicago",
    () => undefined,
    reminders,
    () => now,
  );
  const prompts: string[] = [];
  const ask = async (prompt: string) => {
    prompts.push(prompt);
    return JSON.stringify({
      isReceipt: true,
      merchant: "Thai Spice",
      date: "2026-11-25",
      currency: "USD",
      total: 32.4,
      subtotal: 28,
      tax: 2.4,
      tip: 2,
      paymentLast4: "4821",
      category: "Food",
      returnDays: null,
      items: [],
      unclear: [],
    });
  };
  const email = {
    app: "gmail",
    messageId: "m-1",
    from: "DoorDash <no-reply@doordash.com>",
    subject: "Order Confirmation from Thai Spice",
    body: "Subtotal $28.00 Tax $2.40 Dasher tip $2.00 Total $32.40 Card 4111 1111 1111 1111",
  };
  const snap = await box.fromEmail("alex", email, ask);
  assert.ok(snap && "receipt" in snap && snap.receipt, "filed");
  const receipt = (snap as { receipt: BoxReceipt }).receipt;
  assert.equal(receipt.source, "email");
  assert.equal(receipt.status, "filed", "sure, so it files without a check");
  assert.equal(receipt.email?.subject, "Order Confirmation from Thai Spice");
  assert.equal(await box.photoUrl("alex", receipt), null, "an email has no photo");
  assert.ok(
    !prompts[0]?.includes("4111 1111 1111 1111"),
    "the card number is hidden from the model",
  );
  assert.equal(await box.fromEmail("alex", email, ask), undefined, "the same email again");
  assert.equal(prompts.length, 1);
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

test("Later asks once more after three hours; a second Later leaves it", async () => {
  const t = await setup({ brex: { data: { items: [charge("t1", "5812", 4820)] } } });
  await t.nudges.tick();
  assert.equal(t.sent.length, 1);
  assert.equal((await t.nudges.close("alex", "card:t1", "later"))?.status, "waiting");
  t.advance(2 * 60 * MINUTE);
  await t.nudges.tick();
  assert.equal(t.sent.length, 1, "not before three hours");
  t.advance(70 * MINUTE);
  await t.nudges.tick();
  assert.equal(t.sent.length, 2, "asked again");
  assert.equal(
    (await t.nudges.close("alex", "card:t1", "later"))?.status,
    "asked",
    "only once more",
  );
  t.advance(4 * 60 * MINUTE);
  await t.nudges.tick();
  assert.equal(t.sent.length, 2);
  await t.db.close();
});

test("by voice: the open question is found by name and answered none or later", async () => {
  const { receiptToolSpec } = await import("../apps/server/src/receipt-tools.ts");
  const t = await setup({ brex: { data: { items: [charge("t1", "5812", 4820)] } } });
  await t.nudges.tick();
  const box = { available: true } as unknown as ReceiptBox;
  const tool = receiptToolSpec(box, "alex", { nudges: t.nudges });
  const open = (await tool.execute({ do: "question" })) as { open: { merchant: string }[] };
  assert.deepEqual(
    open.open.map((n) => n.merchant),
    ["Marlows Tavern"],
  );
  const answered = (await tool.execute({ do: "question", answer: "none", merchant: "marlow" })) as {
    done: string;
  };
  assert.match(answered.done, /Won’t ask about Marlows Tavern again/);
  assert.equal((await t.nudges.get("alex", "card:t1"))?.status, "dismissed");
  assert.ok(
    "none" in ((await tool.execute({ do: "question" })) as object),
    "nothing open any more",
  );
  await t.db.close();
});
