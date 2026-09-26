import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { fileToolSpecs } from "../apps/server/src/file-tools.ts";

let db: Store, directory: string, server: Awaited<ReturnType<typeof createApp>>;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-files-"));
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

async function brochure(pages: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of pages)
    doc.addPage([400, 300]).drawText(line, { x: 30, y: 250, size: 12, font });
  return doc.save();
}

test("agents find PDFs in Files and read their text", async () => {
  const owner = "reader";
  const file = await server.files.import(
    owner,
    "Frontline Brochure.pdf",
    await brochure(["Frontline answers calls 24/7.", "Plans start at $49 per month."]),
    "Uploaded by you",
  );
  await server.files.import(owner, "Other.pdf", await brochure(["Unrelated"]), "Uploaded by you");
  const [list, read] = fileToolSpecs(server.files, owner) as unknown as {
    execute: (args: unknown) => Promise<unknown>;
  }[];
  const found = (await list?.execute({ query: "frontline" })) as { id: string; name: string }[];
  assert.deepEqual(
    found.map((f) => f.name),
    ["Frontline Brochure.pdf"],
  );
  const text = (await read?.execute({ fileId: file.id })) as {
    pageCount: number;
    text: string;
    more?: string;
  };
  assert.equal(text.pageCount, 2);
  assert.match(text.text, /--- Page 1 ---\nFrontline answers calls 24\/7\./);
  assert.match(text.text, /Plans start at \$49 per month\./);
  assert.equal(text.more, undefined);
  // The second read comes from the saved text.
  const page2 = (await read?.execute({ fileId: file.id, fromPage: 2 })) as { text: string };
  assert.doesNotMatch(page2.text, /Page 1/);
  await assert.rejects(read?.execute({ fileId: "missing" }) ?? Promise.resolve(), /File not found/);
  // Another person's files are out of reach.
  const [, otherRead] = fileToolSpecs(server.files, "someone-else") as unknown as {
    execute: (args: unknown) => Promise<unknown>;
  }[];
  await assert.rejects(
    otherRead?.execute({ fileId: file.id }) ?? Promise.resolve(),
    /File not found/,
  );
});

test("long documents are read in parts", async () => {
  const file = await server.files.import(
    "reader",
    "Manual.pdf",
    await brochure(Array.from({ length: 6 }, (_, i) => `Section ${i + 1} ${"x".repeat(40)}`)),
    "Uploaded by you",
  );
  const part = await server.files.read("reader", file.id, 1, 150);
  assert.ok(part.toPage < 6);
  assert.match(part.more ?? "", new RegExp(`page ${part.toPage + 1}`));
});

test("monitor tasks come only from watches", async () => {
  await assert.rejects(
    server.agent.createTask("reader", { kind: "monitor", prompt: "Check Outlook every 4 hours" }),
    /create a routine/,
  );
});
