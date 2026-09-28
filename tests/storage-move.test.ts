import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Backups, readBackup } from "../apps/server/src/backups.ts";
import {
  type Blobs,
  BucketBlobs,
  checkBlobs,
  DiskBlobs,
  signS3,
} from "../apps/server/src/blobs.ts";
import { bucketSettings } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { moveFromVolume } from "../apps/server/src/move-from-volume.ts";
import { keptSecret } from "../apps/server/src/server-keys.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");

/** A bucket in memory. */
class MemoryBlobs implements Blobs {
  readonly where = "bucket" as const;
  readonly items = new Map<string, Uint8Array>();
  async get(key: string) {
    return this.items.get(key) ?? null;
  }
  async put(key: string, bytes: Uint8Array) {
    this.items.set(key, Uint8Array.from(bytes));
  }
  async remove(key: string) {
    this.items.delete(key);
  }
  async list(prefix: string) {
    return [...this.items.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}

test("requests to the bucket are signed exactly as AWS documents", () => {
  // The example request from the S3 Signature Version 4 documentation.
  const headers = signS3({
    method: "GET",
    host: "examplebucket.s3.amazonaws.com",
    path: "/test.txt",
    headers: { Range: "bytes=0-9" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    date: new Date("2013-05-24T00:00:00Z"),
  });
  assert.equal(
    headers.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
  assert.equal(headers["x-amz-date"], "20130524T000000Z");
});

test("the bucket saves, reads, lists page by page and deletes over S3", async () => {
  const stored = new Map<string, Uint8Array>();
  const seen: { method: string; url: string; auth: string }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const address = new URL(url);
    const headers = init.headers as Record<string, string>;
    seen.push({ method: init.method ?? "GET", url, auth: headers.authorization ?? "" });
    const key = decodeURIComponent(address.pathname.slice(1));
    if (init.method === "PUT") {
      stored.set(key, new Uint8Array(init.body as Buffer));
      return new Response(null, { status: 200 });
    }
    if (init.method === "DELETE") {
      stored.delete(key);
      return new Response(null, { status: 204 });
    }
    if (address.searchParams.get("list-type") === "2") {
      const keys = [...stored.keys()].filter((k) =>
        k.startsWith(address.searchParams.get("prefix") ?? ""),
      );
      const first = !address.searchParams.get("continuation-token");
      const page = first ? keys.slice(0, 1) : keys.slice(1);
      return new Response(
        `<ListBucketResult>${page.map((k) => `<Contents><Key>${k.replace("&", "&amp;")}</Key></Contents>`).join("")}<IsTruncated>${first && keys.length > 1}</IsTruncated>${first ? "<NextContinuationToken>next page</NextContinuationToken>" : ""}</ListBucketResult>`,
      );
    }
    const bytes = stored.get(key);
    return bytes
      ? new Response(Buffer.from(bytes))
      : new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
  }) as unknown as typeof fetch;
  const bucket = new BucketBlobs(
    {
      bucket: "reserved-safe-abc123",
      endpoint: "https://t3.storageapi.dev",
      region: "auto",
      accessKeyId: "tid_test",
      secretAccessKey: "tsec_test",
    },
    fetcher,
  );
  await bucket.put("files/a.pdf", new TextEncoder().encode("%PDF"));
  await bucket.put("files/b.pdf", new TextEncoder().encode("second"));
  assert.equal(seen[0]?.url, "https://reserved-safe-abc123.t3.storageapi.dev/files/a.pdf");
  assert.match(seen[0]?.auth ?? "", /^AWS4-HMAC-SHA256 Credential=tid_test\/\d{8}\/auto\/s3\//);
  assert.equal(Buffer.from((await bucket.get("files/a.pdf")) ?? []).toString(), "%PDF");
  assert.equal(await bucket.get("files/missing.pdf"), null);
  assert.deepEqual(await bucket.list("files/"), ["files/a.pdf", "files/b.pdf"]);
  assert.ok(
    seen.some((r) => r.url.includes("continuation-token=next%20page")),
    "the next page is asked for, encoded as it was signed",
  );
  await bucket.remove("files/a.pdf");
  assert.deepEqual(await bucket.list("files/"), ["files/b.pdf"]);
  await checkBlobs(bucket);
  assert.deepEqual([...stored.keys()], ["files/b.pdf"], "the startup check cleans up after itself");
  await assert.rejects(bucket.get("../secrets"), /Invalid storage key/);
  // Older buckets use path-style addresses.
  const old = new BucketBlobs(
    {
      bucket: "legacy",
      endpoint: "https://t3.storageapi.dev",
      region: "auto",
      accessKeyId: "a",
      secretAccessKey: "b",
      pathStyle: true,
    },
    fetcher,
  );
  await old.put("files/c.pdf", new Uint8Array([1]));
  assert.equal(seen.at(-1)?.url, "https://t3.storageapi.dev/legacy/files/c.pdf");
  const refusing = new BucketBlobs(
    {
      bucket: "x",
      endpoint: "https://t3.storageapi.dev",
      region: "auto",
      accessKeyId: "a",
      secretAccessKey: "b",
    },
    (async () =>
      new Response("<Error><Code>SignatureDoesNotMatch</Code></Error>", {
        status: 403,
      })) as unknown as typeof fetch,
  );
  await assert.rejects(
    checkBlobs(refusing),
    /refused to save a file \(403 SignatureDoesNotMatch\)/,
  );
});

test("bucket settings come all together or not at all", () => {
  assert.equal(bucketSettings({}), undefined);
  assert.throws(() => bucketSettings({ S3_BUCKET: "b" }), /also needs S3_ENDPOINT/);
  assert.deepEqual(
    bucketSettings({
      S3_BUCKET: "b",
      S3_ENDPOINT: "https://t3.storageapi.dev",
      S3_ACCESS_KEY_ID: "id",
      S3_SECRET_ACCESS_KEY: "secret",
    }),
    {
      bucket: "b",
      endpoint: "https://t3.storageapi.dev",
      region: "auto",
      accessKeyId: "id",
      secretAccessKey: "secret",
      pathStyle: false,
    },
  );
});

test("files on disk keep today's layout, and only real keys are allowed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-blobs-"));
  try {
    const disk = new DiskBlobs(directory);
    await disk.put("files/one.pdf", new Uint8Array([1, 2]));
    await disk.put("avatar-media/neddy-idle.mp4", new Uint8Array([3]));
    assert.deepEqual([...(await readFile(join(directory, "files", "one.pdf")))], [1, 2]);
    assert.deepEqual(await disk.list("files/"), ["files/one.pdf"]);
    assert.equal(await disk.get("files/none.pdf"), null);
    await disk.remove("files/one.pdf");
    assert.deepEqual(await disk.list("files/"), []);
    await assert.rejects(disk.put("files/../../etc.pdf", new Uint8Array()), /Invalid storage key/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("server keys move into the database, encrypted, and every copy of the server shares them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-keys-"));
  const db = await createStore();
  try {
    // An older version left the signing key in the data folder.
    await writeFile(join(directory, "session-signing-key"), "old-key-value");
    const options = {
      name: "session-signing-key",
      dataDir: directory,
      encryptionKey: KEY,
      make: () => "brand-new",
    };
    assert.equal(await keptSecret(db, options), "old-key-value", "people stay signed in");
    const stored = await db.get<{ secret: string }>("system", "server-keys", "session-signing-key");
    assert.ok(stored && !stored.secret.includes("old-key-value"), "kept encrypted");
    // A copy of the server without the old folder (after the move) gets the same key.
    assert.equal(
      await keptSecret(db, { ...options, dataDir: join(directory, "gone") }),
      "old-key-value",
    );
    // Two fresh copies starting at once agree on one new key.
    const [a, b] = await Promise.all([
      keptSecret(db, { ...options, name: "vapid.json", make: () => "first" }),
      keptSecret(db, { ...options, name: "vapid.json", make: () => "second" }),
    ]);
    assert.equal(a, b);
    // Without an encryption key (a local sample workspace) it stays a file, as before.
    const local = await keptSecret(db, { ...options, name: "local-key", encryptionKey: undefined });
    assert.equal(local, "brand-new");
    assert.equal(await readFile(join(directory, "local-key"), "utf8"), "brand-new");
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the move copies every record and file off the disk once, keeping when each last changed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-move-"));
  const target = await createStore();
  try {
    const old = await createStore({ dataDir: join(directory, "postgres") });
    await old.put("me", "notes", { id: "n1", text: "Buy milk" });
    await old.put("me", "files", { id: "f1", name: "lease.pdf" });
    await old.put("system", "accounts", { id: "me", status: "active" });
    const before = await old.dump();
    await old.close();
    await mkdir(join(directory, "files"), { recursive: true });
    await writeFile(join(directory, "files", "f1.pdf"), "%PDF-1.7");
    await writeFile(join(directory, "files", "f1.text.json"), '["page one"]');
    await mkdir(join(directory, "avatar-media"), { recursive: true });
    await writeFile(join(directory, "avatar-media", "neddy-idle.mp4"), "clip");
    await writeFile(join(directory, "session-signing-key"), "not a file to move");
    // The new database already has something newer for one record: it's kept.
    await target.put("me", "notes", { id: "n1", text: "Buy oat milk" });
    const bucket = new MemoryBlobs();
    const lines: string[] = [];
    const result = await moveFromVolume(target, directory, bucket, {
      database: true,
      log: (line) => lines.push(line),
    });
    assert.deepEqual(result, { records: 3, alreadyThere: 1, files: 3 });
    assert.equal((await target.get<{ text: string }>("me", "notes", "n1"))?.text, "Buy oat milk");
    assert.equal((await target.get<{ name: string }>("me", "files", "f1"))?.name, "lease.pdf");
    const moved = (await target.dump()).find((row) => row.kind === "files");
    assert.equal(
      moved?.updatedAt,
      before.find((row) => row.kind === "files")?.updatedAt,
      "when it last changed is kept",
    );
    assert.deepEqual(await bucket.list(""), [
      "avatar-media/neddy-idle.mp4",
      "files/f1.pdf",
      "files/f1.text.json",
    ]);
    assert.match(lines[0] ?? "", /3 records \(1 were already there\) and 3 files/);
    // Done once: the next start doesn't move anything again.
    assert.equal(await moveFromVolume(target, directory, bucket, { database: true }), null);
    // A brand-new server with nothing on disk has nothing to move.
    const fresh = await createStore();
    assert.equal(
      await moveFromVolume(fresh, join(directory, "empty"), new MemoryBlobs(), { database: true }),
      null,
    );
    await fresh.close();
  } finally {
    await target.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a copy of every record is made each night, kept two weeks, and can be put back", async () => {
  const db = await createStore();
  const bucket = new MemoryBlobs();
  let now = Date.parse("2026-09-29T08:00:00Z");
  const backups = new Backups(db, bucket, () => now);
  try {
    await db.put("me", "notes", { id: "n1", text: "Buy milk" });
    await db.put("me", "health-log", { id: "h1", kind: "meal", title: "Tacos" });
    await bucket.put("backups/records-2026-09-01.jsonl.gz", new Uint8Array([1]));
    await bucket.put("backups/records-2026-09-20.jsonl.gz", new Uint8Array([1]));
    assert.equal(await backups.runDue(), null, "not before the quiet hours");
    now = Date.parse("2026-09-29T09:30:00Z");
    assert.equal(await backups.runDue(), "backups/records-2026-09-29.jsonl.gz");
    assert.equal(await backups.runDue(), null, "once a day");
    assert.deepEqual(await bucket.list("backups/"), [
      "backups/records-2026-09-20.jsonl.gz",
      "backups/records-2026-09-29.jsonl.gz",
    ]);
    const rows = readBackup(
      (await bucket.get("backups/records-2026-09-29.jsonl.gz")) ?? new Uint8Array(),
    );
    assert.deepEqual(
      rows
        .filter((row) => row.owner === "me")
        .map((row) => row.id)
        .sort(),
      ["h1", "n1"],
    );
    // Something goes wrong later; the copy puts it back.
    await db.put("me", "notes", { id: "n1", text: "garbled" });
    await db.remove("me", "health-log", "h1");
    await db.load(rows, true);
    assert.equal((await db.get<{ text: string }>("me", "notes", "n1"))?.text, "Buy milk");
    assert.equal((await db.get<{ title: string }>("me", "health-log", "h1"))?.title, "Tacos");
    // A copy that saved counts as done even if clearing old ones fails.
    const flaky = new MemoryBlobs();
    flaky.list = async () => {
      throw new Error("list refused");
    };
    now = Date.parse("2026-09-30T10:00:00Z");
    assert.equal(
      await new Backups(db, flaky, () => now).runDue(),
      "backups/records-2026-09-30.jsonl.gz",
    );
    assert.equal(
      (await db.get<{ status: string }>("system", "backups", "2026-09-30"))?.status,
      "done",
    );
    // Without a bucket there's nowhere safe to put copies.
    assert.equal(await new Backups(db, new DiskBlobs(tmpdir()), () => now).runDue(), null);
  } finally {
    await db.close();
  }
});

test("only one copy of the server does background work, and cut-off actions are recovered later", async () => {
  const db = await createStore();
  try {
    assert.equal(await db.lease("maintenance", "old", 60_000), true);
    assert.equal(await db.lease("maintenance", "new", 60_000), false, "the new copy waits");
    assert.equal(await db.lease("maintenance", "old", 60_000), true, "the holder renews");
    await db.release("maintenance", "old");
    assert.equal(await db.lease("maintenance", "new", 60_000), true, "handed over on stop");
    assert.ok(
      !(await db.dump()).some((row) => row.kind === "leases"),
      "leases aren't copied into backups",
    );
    await db.put("me", "actions", { id: "a1", status: "executing" });
    await db.recoverInterruptedActions();
    assert.equal(
      (await db.get<{ status: string }>("me", "actions", "a1"))?.status,
      "executing",
      "an action that just started may still be finishing on the other copy",
    );
    await db.recoverInterruptedActions(0);
    assert.equal(
      (await db.get<{ status: string }>("me", "actions", "a1"))?.status,
      "outcome_unknown",
    );
  } finally {
    await db.close();
  }
});
