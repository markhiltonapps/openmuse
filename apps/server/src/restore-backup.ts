import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { readBackup } from "./backups.ts";
import { BucketBlobs } from "./blobs.ts";
import { bucketSettings } from "./config.ts";
import { createStore } from "./db.ts";

/**
 * Puts a nightly copy back into the database:
 *
 *   pnpm restore-backup backups/records-2026-09-29.jsonl.gz --yes
 *
 * The copy is a key in the bucket or a downloaded file. Every record in it replaces the current
 * one; records made since are kept. Uses DATABASE_URL and the S3_* settings, like the server.
 */
const [source, confirm] = process.argv.slice(2);
if (!source) {
  console.error("Usage: restore-backup <bucket key or file> --yes");
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("Set DATABASE_URL to the database to restore into.");
  process.exit(1);
}
let bytes: Uint8Array | null;
if (existsSync(source)) bytes = await readFile(source);
else {
  const bucket = bucketSettings();
  if (!bucket) {
    console.error(`${source} isn't a file here, and no bucket is set (S3_*).`);
    process.exit(1);
  }
  bytes = await new BucketBlobs(bucket).get(source);
}
if (!bytes) {
  console.error(`No backup at ${source}.`);
  process.exit(1);
}
const rows = readBackup(bytes);
if (confirm !== "--yes") {
  console.log(`${source} holds ${rows.length} records. Run again with --yes to restore them.`);
  process.exit(0);
}
const db = await createStore({ databaseUrl });
try {
  console.log(`Restored ${await db.load(rows, true)} records from ${source}.`);
} finally {
  await db.close();
}
