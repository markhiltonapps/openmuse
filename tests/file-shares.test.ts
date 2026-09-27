import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { FileShares } from "../apps/server/src/file-shares.ts";
import { downloadToFiles, publicLookup, publicWebUrl } from "../apps/server/src/web-download.ts";

let db: Store, directory: string, server: Awaited<ReturnType<typeof createApp>>;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-shares-"));
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
  server = await createApp(db, config);
});
after(async () => {
  await server.agent.stop();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

const csv = new TextEncoder().encode("item,price\ncoffee,4\n");

test("a share link opens one file for anyone until it expires or is stopped", async () => {
  const files = server.files;
  const file = await files.import("local-user", "prices.csv", csv, "Uploaded by you");
  let now = Date.parse("2026-09-27T12:00:00Z");
  const shares = new FileShares(db, files, "https://api.test", () => now);
  const link = await shares.create("local-user", file.id, 1);
  assert.match(link.url, /^https:\/\/api\.test\/api\/share\/[\w-]{32}$/);
  assert.doesNotMatch(link.url, /local-user/, "the link says nothing about the account");
  const token = link.url.split("/").at(-1) ?? "";
  const opened = await shares.open(token);
  assert.equal(opened.file.name, "prices.csv");
  assert.deepEqual(await shares.list("local-user", file.id), [
    { url: link.url, expiresAt: link.expiresAt },
  ]);
  // Another person can't list or stop it.
  assert.deepEqual(await shares.list("someone-else", file.id), []);
  now += 2 * 86_400_000;
  await assert.rejects(shares.open(token), /expired or was turned off/);
  now -= 2 * 86_400_000;
  await shares.stop("local-user", file.id);
  await assert.rejects(shares.open(token), /expired or was turned off/);
  await assert.rejects(shares.open("../../etc/passwd"), /expired or was turned off/);
});

test("the share route serves the file without signing in, sandboxed and unindexed", async () => {
  const signIn = await server.app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const { token } = (await signIn.json().catch(() => ({}))) as { token?: string };
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const upload = new FormData();
  upload.set("file", new File([csv], "menu.csv", { type: "text/csv" }));
  const file = (await (
    await server.app.request("/api/files", {
      method: "POST",
      headers: { authorization: headers.authorization },
      body: upload,
    })
  ).json()) as { id: string };
  const made = (await (
    await server.app.request(`/api/files/${file.id}/share`, {
      method: "POST",
      headers,
      body: JSON.stringify({ days: 7 }),
    })
  ).json()) as { url: string };
  const path = new URL(made.url).pathname;
  const open = await server.app.request(path);
  assert.equal(open.status, 200);
  assert.equal(await open.text(), "item,price\ncoffee,4\n");
  assert.match(open.headers.get("content-disposition") ?? "", /attachment/);
  assert.match(open.headers.get("x-robots-tag") ?? "", /noindex/);
  assert.match(open.headers.get("content-security-policy") ?? "", /sandbox/);
  await server.app.request(`/api/files/${file.id}/unshare`, {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal((await server.app.request(path)).status, 404);
});

test("downloads only reach public addresses, checked again when connecting", async () => {
  assert.equal(publicWebUrl("http://localhost/x"), undefined);
  assert.equal(publicWebUrl("http://10.0.0.5/x"), undefined);
  assert.equal(publicWebUrl("http://169.254.169.254/latest"), undefined);
  assert.equal(publicWebUrl("https://user:pw@example.com/x"), undefined);
  assert.equal(publicWebUrl("https://example.com:8443/x"), undefined);
  assert.equal(publicWebUrl("file:///etc/passwd"), undefined);
  assert.ok(publicWebUrl("https://example.com/menu.pdf"));
  // A name that resolves to a private address is refused at connection time.
  const refused = await new Promise<string | undefined>((resolve) =>
    publicLookup(
      "rebind.example",
      { all: true },
      (error) => resolve((error as { code?: string } | null)?.code),
      ((
        _host: string,
        _options: unknown,
        cb: (e: null, a: { address: string; family: number }[]) => void,
      ) => cb(null, [{ address: "10.1.2.3", family: 4 }])) as never,
    ),
  );
  assert.equal(refused, "EPRIVATE");
});

function reply(status: number, headers: Record<string, string>, body = "") {
  const stream = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;
  return Object.assign(stream, { statusCode: status, headers });
}

test("a web download follows public redirects, names the file and saves it to Files", async () => {
  const files = server.files;
  const hops: string[] = [];
  const saved = await downloadToFiles(
    files,
    "local-user",
    { url: "https://example.com/get?id=7" },
    async (url) => {
      hops.push(url.toString());
      return hops.length === 1
        ? reply(302, { location: "https://cdn.example.com/files/price-list" })
        : reply(200, { "content-type": "text/csv" }, "item,price\ntea,3\n");
    },
  );
  assert.deepEqual(hops, [
    "https://example.com/get?id=7",
    "https://cdn.example.com/files/price-list",
  ]);
  assert.equal(saved.name, "price-list.csv");
  // A redirect to a private address stops the download.
  await assert.rejects(
    downloadToFiles(files, "local-user", { url: "https://example.com/a" }, async () =>
      reply(302, { location: "http://192.168.1.1/admin" }),
    ),
    /isn't allowed/,
  );
});
