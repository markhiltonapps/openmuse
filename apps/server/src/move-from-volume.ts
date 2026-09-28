import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Blobs, DiskBlobs } from "./blobs.ts";
import { createStore, type Store } from "./db.ts";

export interface MoveResult {
  records: number;
  /** Records the new database already had, left as they were. */
  alreadyThere: number;
  files: number;
}

/**
 * The one-time move off the server's own disk: records from the embedded database in the data
 * folder into Postgres, and saved files into the bucket. Nothing already moved is overwritten, so
 * a move cut short can simply run again; once it finishes, a marker stops it running again.
 */
export async function moveFromVolume(
  db: Store,
  dataDir: string,
  blobs: Blobs,
  options: { database: boolean; log?: (line: string) => void },
): Promise<MoveResult | null> {
  if (await db.get("system", "migrations", "volume")) return null;
  const embedded = join(dataDir, "postgres");
  const oldDatabase = options.database && existsSync(join(embedded, "PG_VERSION"));
  const oldFiles =
    blobs.where === "bucket" &&
    (existsSync(join(dataDir, "files")) || existsSync(join(dataDir, "avatar-media")));
  if (!oldDatabase && !oldFiles) return null;
  let records = 0;
  let written = 0;
  if (oldDatabase) {
    const old = await createStore({ dataDir: embedded });
    try {
      const rows = await old.dump();
      records = rows.length;
      written = await db.load(rows);
    } finally {
      await old.close();
    }
  }
  let files = 0;
  if (blobs.where === "bucket") {
    const disk = new DiskBlobs(dataDir);
    // Avatar clips too: the addresses they were first downloaded from may not last.
    for (const key of [...(await disk.list("files/")), ...(await disk.list("avatar-media/"))]) {
      const bytes = await disk.get(key);
      if (!bytes) continue;
      await blobs.put(key, bytes);
      files++;
    }
  }
  const result = { records, alreadyThere: records - written, files };
  await db.insertIfAbsent("system", "migrations", {
    id: "volume",
    movedAt: new Date().toISOString(),
    ...result,
  });
  options.log?.(
    `Moved off the server's disk: ${records} records (${result.alreadyThere} were already there) and ${files} files.`,
  );
  return result;
}
