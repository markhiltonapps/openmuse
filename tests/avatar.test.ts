import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { sanitizeSvg } from "../apps/server/src/avatar-designer.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

const drawing =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="a"><stop offset="0" stop-color="#fa0"/></linearGradient></defs><circle cx="50" cy="50" r="40" fill="url(#a)"/><g class="eye"><ellipse cx="40" cy="45" rx="4" ry="5"/></g></svg>';

test("designed avatars keep only plain shapes", () => {
  assert.equal(sanitizeSvg(drawing), drawing);
  assert.equal(
    sanitizeSvg(
      `<?xml version="1.0"?><!-- hi -->${drawing.replace("<defs>", "<style>*{}</style><defs>")}`,
    ),
    drawing,
  );
  for (const unsafe of [
    drawing.replace("<circle", "<script>alert(1)</script><circle"),
    drawing.replace("<circle", '<circle onload="alert(1)"'),
    drawing.replace("<circle", '<image href="https://x.test/a.png"/><circle'),
    drawing.replace('fill="url(#a)"', 'fill="url(https://x.test/a)"'),
    drawing.replace(
      "<circle",
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"/></foreignObject><circle',
    ),
    drawing.replace("<circle", '<a xlink:href="javascript:alert(1)"><circle'),
    "<div>not an svg</div>",
    `${drawing}<script/>`,
  ])
    assert.equal(sanitizeSvg(unsafe), undefined, unsafe);
});

let db: Store, directory: string, server: Awaited<ReturnType<typeof createApp>>;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-avatar-"));
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "model",
    model: "anthropic/claude-test",
    anthropicApiKey: "sk-test",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  server = await createApp(db, config, {
    search: { search: async () => ({ answer: "", sources: [] }) },
  });
});
after(async () => {
  await server.agent.stop();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("people can upload a picture or have an avatar designed", async () => {
  const { token } = await (
    await server.app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  ).json();
  const call = (path: string, body?: unknown) =>
    server.app.request(`/api/agent${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const identity = { name: "Muse", tone: "warm" };
  assert.equal((await call("/identity", { ...identity, character: "custom" })).status, 409);
  assert.equal(
    (await call("/identity", { ...identity, character: "fox", avatar: "mint" })).status,
    200,
  );
  assert.equal((await (await call("")).json()).identity.character, "fox");
  // A tap in the picker sends just the avatar; the name and tone stay as they are.
  assert.equal((await call("/identity", { character: "owl" })).status, 200);
  const after = (await (await call("")).json()).identity;
  assert.deepEqual(
    [after.name, after.tone, after.character, after.avatar],
    ["Muse", "warm", "owl", "mint"],
  );

  assert.equal(
    (await call("/avatar-image", { data: "data:image/svg+xml;base64,PHN2Zz4=" })).status,
    422,
  );
  const photo = await call("/avatar-image", { data: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" });
  assert.equal(photo.status, 200);
  const saved = await (await call("")).json();
  assert.equal(saved.identity.character, "custom");
  assert.ok(saved.identity.avatarImageVersion);
  const image = await (await call("/avatar-image")).json();
  assert.equal(image.image.kind, "photo");
  assert.equal(image.designAvailable, true);

  const prompts: string[] = [];
  server.agent.avatarFetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    prompts.push(`${body.model} ${body.messages[0].content}`);
    return Response.json({ content: [{ type: "text", text: `Here you go:\n${drawing}` }] });
  }) as typeof fetch;
  const designed = await call("/avatar-design", { description: "a sleepy blue whale" });
  assert.equal(designed.status, 200);
  assert.match(prompts[0] ?? "", /^claude-test .*a sleepy blue whale/s);
  const svg = await (await call("/avatar-image")).json();
  assert.deepEqual([svg.image.kind, svg.image.data], ["svg", drawing]);
  assert.notEqual(
    (await (await call("")).json()).identity.avatarImageVersion,
    saved.identity.avatarImageVersion,
  );

  server.agent.avatarFetcher = (async () =>
    Response.json({
      content: [{ type: "text", text: "<svg><script>x</script></svg>" }],
    })) as typeof fetch;
  assert.equal((await call("/avatar-design", { description: "a sneaky one" })).status, 502);
  // The earlier design is kept when a new one fails.
  assert.equal((await (await call("/avatar-image")).json()).image.data, drawing);
});
