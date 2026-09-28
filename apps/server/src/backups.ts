import { gunzipSync, gzipSync } from "node:zlib";
import type { Blobs } from "./blobs.ts";
import type { Store, StoredRow } from "./db.ts";
import { backgroundFailure } from "./log.ts";

/** Nightly copies kept, and the hour (UTC) after which a day's copy is made: 3–4 am in the US. */
const KEEP_DAYS = 14;
const AFTER_HOUR_UTC = 9;
const RETRY_MS = 60 * 60_000;
const PREFIX = "backups/records-";

interface BackupRun {
  id: string;
  status: "running" | "done" | "failed";
  at: string;
  key?: string;
  records?: number;
  bytes?: number;
  error?: string;
}

/**
 * A copy of every record, once a night, saved to the bucket as gzipped JSON lines. The database
 * host's own backups need a paid plan; this keeps the last two weeks for pennies.
 */
export class Backups {
  constructor(
    private readonly db: Store,
    private readonly blobs: Blobs,
    private readonly now: () => number = Date.now,
  ) {}
  /** Makes today's copy if it's due. Returns its key, or null when nothing was due. */
  async runDue(): Promise<string | null> {
    if (this.blobs.where !== "bucket") return null;
    const now = new Date(this.now());
    if (now.getUTCHours() < AFTER_HOUR_UTC) return null;
    const day = now.toISOString().slice(0, 10);
    const last = await this.db.get<BackupRun>("system", "backups", day);
    if (last && (last.status === "done" || this.now() - Date.parse(last.at) < RETRY_MS))
      return null;
    const at = now.toISOString();
    await this.db.put<BackupRun>("system", "backups", { id: day, status: "running", at });
    try {
      const rows = await this.db.dump();
      const body = gzipSync(rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
      const key = `${PREFIX}${day}.jsonl.gz`;
      await this.blobs.put(key, body, "application/gzip");
      await this.db.put<BackupRun>("system", "backups", {
        id: day,
        status: "done",
        at,
        key,
        records: rows.length,
        bytes: body.length,
      });
      // Today's copy is safe either way; clearing old ones can wait for tomorrow.
      await this.prune(day).catch((error) => backgroundFailure("clearing old backups", error));
      return key;
    } catch (error) {
      await this.db.put<BackupRun>("system", "backups", {
        id: day,
        status: "failed",
        at,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  /** Copies older than two weeks are deleted. */
  private async prune(today: string) {
    const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - KEEP_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    for (const key of await this.blobs.list(PREFIX)) {
      const day = key.slice(PREFIX.length, PREFIX.length + 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < oldest) await this.blobs.remove(key);
    }
  }
}

/** The records in a nightly copy. */
export function readBackup(bytes: Uint8Array): StoredRow[] {
  return gunzipSync(bytes)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as StoredRow);
}
