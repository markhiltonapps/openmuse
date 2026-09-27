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

test("pictures, Word, Excel and text files can be saved and read", async () => {
  const { readFile } = await import("node:fs/promises");
  const owner = "mixed";
  const docx = await server.files.import(
    owner,
    "brief.docx",
    new Uint8Array(await readFile(new URL("./fixtures/brief.docx", import.meta.url))),
    "Uploaded by you",
  );
  assert.equal(
    docx.mimeType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.match(
    (await server.files.read(owner, docx.id)).text,
    /Answers calls in under two rings\./,
  );
  const xlsx = await server.files.import(
    owner,
    "pricing.xlsx",
    new Uint8Array(await readFile(new URL("./fixtures/pricing.xlsx", import.meta.url))),
    "Uploaded by you",
  );
  assert.match(
    (await server.files.read(owner, xlsx.id)).text,
    /Sheet: Pricing\n\nPlan \| Monthly\nStarter \| 49/,
  );
  const notes = await server.files.import(
    owner,
    "notes.md",
    new TextEncoder().encode("# Call list\n\nRing Sam."),
    "Uploaded by you",
  );
  assert.equal(notes.mimeType, "text/plain");
  assert.match((await server.files.read(owner, notes.id)).text, /Ring Sam\./);

  // A tiny PNG: signature plus enough bytes to store.
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const picture = await server.files.import(owner, "receipt.png", png, "Uploaded by you");
  assert.equal(picture.mimeType, "image/png");
  assert.match((await server.files.read(owner, picture.id)).text, /look_at_image/);
  assert.deepEqual(new Uint8Array(await server.files.bytes(owner, picture.id)), png);
  await assert.rejects(server.files.fill(owner, picture.id, {}), /Only PDF forms/);

  // Content decides the type, not the name.
  await assert.rejects(
    server.files.import(
      owner,
      "fake.pdf",
      new TextEncoder().encode("not a pdf"),
      "Uploaded by you",
    ),
    /Files can be PDFs, pictures/,
  );
  await assert.rejects(
    server.files.import(owner, "tool.exe", new Uint8Array([0x4d, 0x5a, 0, 0]), "Uploaded by you"),
    /Files can be/,
  );

  const questions: string[] = [];
  const specs = fileToolSpecs(server.files, owner, async (image, question) => {
    questions.push(`${image.mimeType} ${image.bytes.length} ${question}`);
    return "A receipt for $12.50 from Luigi's.";
  }) as unknown as { name: string; execute: (args: unknown) => Promise<unknown> }[];
  const look = specs.find((s) => s.name === "look_at_image");
  assert.deepEqual(await look?.execute({ fileId: picture.id, question: "What is the total?" }), {
    id: picture.id,
    name: "receipt.png",
    answer: "A receipt for $12.50 from Luigi's.",
  });
  assert.deepEqual(questions, ["image/png 12 What is the total?"]);
  assert.ok(look);
  const notPicture = (await look.execute({ fileId: docx.id, question: "What is it?" })) as {
    error: string;
  };
  assert.match(notPicture.error, /isn't a picture/);
});

test("the agent writes documents to Files as PDF or Word", async () => {
  const owner = "writer";
  const create = (
    fileToolSpecs(server.files, owner) as unknown as {
      name: string;
      execute: (args: unknown) => Promise<{ id: string; name: string }>;
    }[]
  ).find((s) => s.name === "create_document");
  assert.ok(create);
  const content = `# Weekend in Austin

A **two-day** plan for Oct 4–5 — with “good” food 🍜.

## Saturday
- Breakfast at Paperboy
- Barton Springs

1. Book the hotel
2. Pack sunscreen

${"A long paragraph that keeps going to test wrapping across the page width. ".repeat(40)}`;
  const pdf = await create.execute({ title: "Austin trip", content });
  assert.equal(pdf.name, "Austin trip.pdf");
  const pdfText = (await server.files.read(owner, pdf.id)).text;
  assert.match(pdfText, /Austin trip/);
  assert.match(pdfText, /two-day/);
  assert.match(pdfText, /Breakfast at Paperboy/);
  assert.match(pdfText, /2\.\s*Pack sunscreen/);
  assert.doesNotMatch(pdfText, /\*\*/);
  const docx = await create.execute({ title: "Austin trip", content, format: "docx" });
  assert.equal(docx.name, "Austin trip.docx");
  const docText = (await server.files.read(owner, docx.id)).text;
  assert.match(docText, /Weekend in Austin/);
  assert.match(docText, /Barton Springs/);
  assert.match(docText, /good.*food/);
});

test("documents from Google Drive, OneDrive or Dropbox are saved to Files to read", async () => {
  const owner = "drive";
  const pdf = await brochure(["Q3 plan: grow Frontline to 400 customers."]);
  const fetched: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    fetched.push(String(url));
    if (String(url).startsWith("https://www.dropbox.com/evil"))
      return new Response(null, { status: 302, headers: { location: "http://10.0.0.1/" } });
    if (String(url).startsWith("https://www.dropbox.com/"))
      return new Response(null, {
        status: 302,
        headers: { location: "https://dl.dropboxusercontent.com/s/q3.pdf" },
      });
    return new Response(Buffer.from(pdf), { headers: { "content-type": "application/pdf" } });
  }) as typeof fetch;
  const specs = fileToolSpecs(server.files, owner, undefined, fetcher) as unknown as {
    name: string;
    execute: (args: unknown) => Promise<unknown>;
  }[];
  const save = specs.find((s) => s.name === "save_to_files");
  const read = specs.find((s) => s.name === "read_file");
  const saved = (await save?.execute({
    url: "https://composio-files.s3.us-east-1.amazonaws.com/abc/Q3.pdf?X-Amz-Signature=1",
    name: "Q3 plan.pdf",
    app: "Google Drive",
  })) as { id: string; name: string; pageCount: number };
  assert.equal(saved.name, "Q3 plan.pdf");
  const text = (await read?.execute({ fileId: saved.id })) as { text: string };
  assert.match(text.text, /grow Frontline to 400 customers/);
  // Dropbox links redirect to its download host.
  await save?.execute({ url: "https://www.dropbox.com/s/q3.pdf?dl=1", name: "Q3 copy.pdf" });
  assert.equal(fetched.at(-1), "https://dl.dropboxusercontent.com/s/q3.pdf");
  // Only a connected app's download hosts, never the server's own network.
  await assert.rejects(
    save?.execute({ url: "https://169.254.169.254/latest", name: "x.pdf" }) ?? Promise.resolve(),
    /Only download links/,
  );
  await assert.rejects(
    save?.execute({ url: "https://ec2-10-0-0-1.compute-1.amazonaws.com/", name: "x.pdf" }) ??
      Promise.resolve(),
    /Only download links/,
  );
  await assert.rejects(
    save?.execute({ url: "http://files.composio.dev/a.pdf", name: "x.pdf" }) ?? Promise.resolve(),
    /Only download links/,
  );
  await assert.rejects(
    save?.execute({ url: "https://www.dropbox.com/evil", name: "x.pdf" }) ?? Promise.resolve(),
    /isn't allowed/,
  );
});

test("download links in an app's answer are found for the agent", async () => {
  const { fileLinks } = await import("../apps/server/src/cloud-import.ts");
  assert.deepEqual(
    fileLinks({
      data: {
        downloaded_file_content: {
          name: "Budget.xlsx",
          mimetype: "application/vnd.ms-excel",
          s3url: "https://bucket.s3.amazonaws.com/Budget.xlsx",
        },
        other: { s3url: "https://attacker.test/x" },
      },
    }),
    [{ name: "Budget.xlsx", url: "https://bucket.s3.amazonaws.com/Budget.xlsx" }],
  );
});
