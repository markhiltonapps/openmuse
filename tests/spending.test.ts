import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { type AppConnector, appToolSpecs } from "../apps/server/src/apps.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { isPurchase, SpendingService, statedAmount } from "../apps/server/src/spending.ts";
import type { ActionProposal, AppAction } from "../packages/domain/src/index.ts";

test("purchases are recognized by the action and totals by the inputs", () => {
  assert.equal(isPurchase("SHOPIFY_CREATE_ORDER"), true);
  assert.equal(isPurchase("STRIPE_CREATE_PAYMENT_INTENT"), true);
  assert.equal(isPurchase("INSTACART_CHECKOUT"), true);
  assert.equal(isPurchase("OUTLOOK_SEND_EMAIL"), false);
  assert.equal(isPurchase("NOTION_CREATE_PAGE"), false);
  assert.equal(statedAmount({ amount_cents: 4599, currency: "usd" }), 45.99);
  assert.equal(statedAmount({ order: { line_items: [{ price: "$12.50" }], total: "30" } }), 30);
  assert.equal(statedAmount({ quantity: 3, title: "Socks" }), 0);
});

let db: Store, directory: string;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-spending-"));
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("spending is off by default and capped per purchase and per month", async () => {
  let now = Date.parse("2026-09-10T12:00:00Z");
  const spending = new SpendingService(db, () => now);
  assert.match((await spending.check("spend", 20)) ?? "", /turned off/);
  await spending.update("spend", { enabled: true, perPurchaseLimit: 50, monthlyLimit: 80 });
  assert.match((await spending.check("spend", undefined)) ?? "", /amountUsd/);
  assert.match((await spending.check("spend", 60)) ?? "", /per-purchase limit/);
  assert.equal(await spending.check("spend", 45), undefined);
  await spending.record("spend", "a1", 45);
  assert.match((await spending.check("spend", 40)) ?? "", /monthly limit/);
  now = Date.parse("2026-10-01T12:00:00Z");
  assert.equal(await spending.check("spend", 40), undefined);
});

test("purchases through connected apps need a total, the limits and approval", async () => {
  const executed: string[] = [];
  const apps: AppConnector = {
    search: async () => ({ tools: [], apps: [], guidance: [] }),
    tool: async (_owner, slug) => ({
      slug,
      name: slug,
      description: "",
      app: "shopify",
      readOnly: false,
    }),
    execute: async (_owner, slug) => {
      executed.push(slug);
      return { id: "order_1" };
    },
    connect: async () => ({ connected: true }),
    connections: async () => [],
    directory: async () => [],
    disconnect: async () => {},
  };
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  const server = await createApp(db, config, { apps });
  try {
    const owner = "shopper";
    const proposed: AppAction[] = [];
    const useApp = appToolSpecs(
      apps,
      owner,
      async (action) => {
        proposed.push(action);
        return server.actions.propose(owner, { kind: "app.action", data: action });
      },
      server.agent.spending,
    ).find((s) => s.name === "use_app");
    assert.ok(useApp);
    const run = useApp.execute as (args: unknown) => Promise<Record<string, unknown>>;
    const order = {
      tool: "SHOPIFY_CREATE_ORDER",
      arguments: { line_items: [{ variant_id: 1, quantity: 2 }], total_price: "38.00" },
      summary: "Order two packs of coffee filters",
    };
    assert.match(String((await run(order)).error), /turned off/);
    const spending = new SpendingService(db);
    await spending.update(owner, { enabled: true, perPurchaseLimit: 50, monthlyLimit: 100 });
    const saved = await run({ ...order, amountUsd: 20 });
    assert.equal(saved.status, "awaiting_review");
    assert.equal(proposed[0]?.amountUsd, 38);
    assert.deepEqual(executed, []);

    await spending.update(owner, { enabled: true, perPurchaseLimit: 30, monthlyLimit: 100 });
    const proposal = (await db.get<ActionProposal>(
      owner,
      "actions",
      String(saved.actionId),
    )) as ActionProposal;
    await assert.rejects(
      server.actions.decide(owner, proposal.id, proposal.hash, "approve"),
      /per-purchase limit/,
    );
    assert.deepEqual(executed, []);
    await spending.update(owner, { enabled: true, perPurchaseLimit: 50, monthlyLimit: 100 });
    const done = await server.actions.decide(owner, proposal.id, proposal.hash, "approve");
    assert.equal(done.status, "succeeded");
    assert.deepEqual(executed, ["SHOPIFY_CREATE_ORDER"]);
    assert.equal((await spending.settings(owner)).spentThisMonth, 38);
  } finally {
    await server.agent.stop();
  }
});
