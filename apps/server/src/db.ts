import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { backgroundFailure } from "./log.ts";

type Row = { data: Record<string, unknown> };
/** Text matched literally inside a LIKE pattern. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
/** One record as stored, for copying between databases. */
export interface StoredRow {
  owner: string;
  kind: string;
  id: string;
  data: Record<string, unknown>;
  updatedAt: string;
}
interface Database {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
  close: () => Promise<void>;
}

export class Store {
  constructor(private readonly db: Database) {}
  async get<T = Record<string, unknown>>(
    owner: string,
    kind: string,
    id: string,
  ): Promise<T | null> {
    const result = await this.db.query(
      "SELECT data FROM records WHERE owner=$1 AND kind=$2 AND id=$3",
      [owner, kind, id],
    );
    return (result.rows[0]?.data as T | undefined) ?? null;
  }
  async list<T = Record<string, unknown>>(owner: string, kind: string): Promise<T[]> {
    const result = await this.db.query(
      "SELECT data FROM records WHERE owner=$1 AND kind=$2 ORDER BY updated_at DESC,id",
      [owner, kind],
    );
    return result.rows.map((row) => row.data as T);
  }
  async put<T extends { id: string }>(owner: string, kind: string, value: T): Promise<T> {
    await this.db.query(
      "INSERT INTO records(owner,kind,id,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(owner,kind,id) DO UPDATE SET data=excluded.data,updated_at=now()",
      [owner, kind, value.id, JSON.stringify(value)],
    );
    return value;
  }
  async remove(owner: string, kind: string, id: string): Promise<void> {
    await this.db.query("DELETE FROM records WHERE owner=$1 AND kind=$2 AND id=$3", [
      owner,
      kind,
      id,
    ]);
  }
  async compareAndSwap<T>(
    owner: string,
    kind: string,
    id: string,
    expected: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<T | null> {
    const result = await this.db.query(
      "UPDATE records SET data=data || $5::jsonb,updated_at=now() WHERE owner=$1 AND kind=$2 AND id=$3 AND data @> $4::jsonb RETURNING data",
      [owner, kind, id, JSON.stringify(expected), JSON.stringify(patch)],
    );
    return (result.rows[0]?.data as T | undefined) ?? null;
  }
  async insertIfAbsent<T extends { id: string }>(
    owner: string,
    kind: string,
    value: T,
  ): Promise<T | null> {
    const result = await this.db.query(
      "INSERT INTO records(owner,kind,id,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING data",
      [owner, kind, value.id, JSON.stringify(value)],
    );
    return (result.rows[0]?.data as T | undefined) ?? null;
  }
  async scan<T>(kind: string): Promise<{ owner: string; value: T }[]> {
    const result = await this.db.query(
      "SELECT jsonb_build_object('owner',owner,'value',data) AS data FROM records WHERE kind=$1 ORDER BY updated_at ASC",
      [kind],
    );
    return result.rows.map((row) => row.data as { owner: string; value: T });
  }
  /** Every record one person owns, except the kinds in `except`. */
  async records(owner: string, except: string[] = []) {
    const result = await this.db.query(
      "SELECT jsonb_build_object('kind',kind,'value',data) AS data FROM records WHERE owner=$1 AND NOT (kind = ANY($2::text[])) ORDER BY kind,updated_at ASC",
      [owner, except],
    );
    return result.rows.map((row) => row.data as { kind: string; value: Record<string, unknown> });
  }
  /** Deletes every record one person owns, except the kinds in `keep`. */
  async removeAll(owner: string, keep: string[] = []) {
    await this.db.query("DELETE FROM records WHERE owner=$1 AND NOT (kind = ANY($2::text[]))", [
      owner,
      keep,
    ]);
  }
  async claim<T>(owner: string, id: string, status: string, now: string): Promise<T | null> {
    const result = await this.db.query(
      `UPDATE records AS action SET data=jsonb_set(data,'{status}',$4::jsonb),updated_at=now()
       WHERE owner=$1 AND kind='actions' AND id=$2 AND data->>'status'='awaiting_review'
       AND (data->>'expiresAt')::timestamptz>$3::timestamptz
       AND ($4::jsonb <> '"executing"'::jsonb OR data->>'taskId' IS NULL OR EXISTS (
         SELECT 1 FROM records task WHERE task.owner=action.owner AND task.kind='tasks'
         AND task.id=action.data->>'taskId' AND task.data->>'status' IN ('running','waiting_approval')
       )) RETURNING data`,
      [owner, id, now, JSON.stringify(status)],
    );
    return (result.rows[0]?.data as T | undefined) ?? null;
  }
  /**
   * Actions still "executing" long after they started were cut off by a restart. During an update
   * two copies of the server overlap, so a young one may still be finishing on the old copy.
   */
  async recoverInterruptedActions(olderThanMs = 15 * 60_000): Promise<void> {
    await this.db.query(
      `UPDATE records SET data=data || '{"status":"outcome_unknown","error":"Server restarted during execution. Check the provider before creating another action."}'::jsonb,updated_at=now() WHERE kind='actions' AND data->>'status'='executing' AND updated_at < now() - ($1::text || ' milliseconds')::interval`,
      [String(olderThanMs)],
    );
  }
  /**
   * Takes or renews a named lease for `holder`, so only one copy of the server does a job at a
   * time. Returns false while another holder's lease hasn't run out.
   */
  async lease(name: string, holder: string, ttlMs: number): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO records(owner,kind,id,data) VALUES('system','leases',$1,jsonb_build_object('id',$1::text,'holder',$2::text,'until',now() + ($3::text || ' milliseconds')::interval))
       ON CONFLICT(owner,kind,id) DO UPDATE SET data=excluded.data,updated_at=now()
       WHERE records.data->>'holder'=$2 OR (records.data->>'until')::timestamptz < now()
       RETURNING data`,
      [name, holder, String(ttlMs)],
    );
    return result.rows.length === 1;
  }
  async release(name: string, holder: string): Promise<void> {
    await this.db.query(
      "DELETE FROM records WHERE owner='system' AND kind='leases' AND id=$1 AND data->>'holder'=$2",
      [name, holder],
    );
  }
  /** Every record with when it last changed, for moving and backups (leases are left out). */
  async dump(): Promise<StoredRow[]> {
    const result = await this.db.query(
      "SELECT jsonb_build_object('owner',owner,'kind',kind,'id',id,'data',data,'updatedAt',updated_at) AS data FROM records WHERE NOT (owner='system' AND kind='leases') ORDER BY owner,kind,id",
    );
    return result.rows.map((row) => row.data as unknown as StoredRow);
  }
  /**
   * Adds records as they were, keeping when they last changed. Records that already exist are
   * left alone unless `replace` is set (restoring a backup). Returns how many were written.
   */
  async load(rows: StoredRow[], replace = false): Promise<number> {
    let written = 0;
    for (const row of rows) {
      const result = await this.db.query(
        `INSERT INTO records(owner,kind,id,data,updated_at) VALUES($1,$2,$3,$4::jsonb,$5::timestamptz)
         ON CONFLICT(owner,kind,id) DO ${replace ? "UPDATE SET data=excluded.data,updated_at=excluded.updated_at" : "NOTHING"}
         RETURNING id AS data`,
        [row.owner, row.kind, row.id, JSON.stringify(row.data), row.updatedAt],
      );
      written += result.rows.length;
    }
    return written;
  }
  /** Saves many records of one kind in one statement; a later copy of an id wins. */
  async putMany<T extends { id: string }>(owner: string, kind: string, values: T[]) {
    const unique = [...new Map(values.map((value) => [value.id, value])).values()];
    if (!unique.length) return;
    await this.db.query(
      "INSERT INTO records(owner,kind,id,data) SELECT $1,$2,item->>'id',item FROM jsonb_array_elements($3::jsonb) AS item ON CONFLICT(owner,kind,id) DO UPDATE SET data=excluded.data,updated_at=now()",
      [owner, kind, JSON.stringify(unique)],
    );
  }
  /**
   * Records of one kind whose text holds every word (matched in lower case), newest first by
   * their `updatedAt`, optionally only those whose id starts with `prefix`.
   */
  async matching<T>(owner: string, kind: string, words: string[], limit: number, prefix = "") {
    const result = await this.db.query(
      "SELECT data FROM records WHERE owner=$1 AND kind=$2 AND id LIKE $3 AND lower(data::text) LIKE ALL($4::text[]) ORDER BY data->>'updatedAt' DESC LIMIT $5",
      [
        owner,
        kind,
        `${escapeLike(prefix)}%`,
        words.map((w) => `%${escapeLike(w.toLowerCase())}%`),
        limit,
      ],
    );
    return result.rows.map((row) => row.data as T);
  }
  /** How many records of one kind have ids starting with `prefix`. */
  async count(owner: string, kind: string, prefix = "") {
    const result = await this.db.query(
      "SELECT count(*)::int AS data FROM records WHERE owner=$1 AND kind=$2 AND id LIKE $3",
      [owner, kind, `${escapeLike(prefix)}%`],
    );
    return Number(result.rows[0]?.data ?? 0);
  }
  /** Deletes the records of one kind whose ids start with `prefix`. */
  async removePrefix(owner: string, kind: string, prefix: string) {
    await this.db.query("DELETE FROM records WHERE owner=$1 AND kind=$2 AND id LIKE $3", [
      owner,
      kind,
      `${escapeLike(prefix)}%`,
    ]);
  }
  async take<T>(owner: string, kind: string, id: string): Promise<T | null> {
    const result = await this.db.query(
      "DELETE FROM records WHERE owner=$1 AND kind=$2 AND id=$3 RETURNING data",
      [owner, kind, id],
    );
    return (result.rows[0]?.data as T | undefined) ?? null;
  }
  close(): Promise<void> {
    return this.db.close();
  }
  async updateCredential(owner: string, connectionId: string, secret: string): Promise<boolean> {
    const result = await this.db.query(
      "UPDATE records SET data=jsonb_set(data,'{secret}',$3::jsonb),updated_at=now() WHERE owner=$1 AND kind='credentials' AND id='google' AND data->>'connectionId'=$2 RETURNING data",
      [owner, connectionId, JSON.stringify(secret)],
    );
    return result.rows.length === 1;
  }
}

/** Idle clients can be disconnected by a database restart; without a listener pg's `error` event crashes the process. */
export function createPool(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 5 });
  pool.on("error", (error) => backgroundFailure("postgres pool", error));
  return pool;
}

export async function createStore(
  options: { dataDir?: string; databaseUrl?: string } = {},
): Promise<Store> {
  let database: Database;
  if (options.databaseUrl) {
    const pool = createPool(options.databaseUrl);
    database = { query: async (sql, params) => pool.query(sql, params), close: () => pool.end() };
  } else {
    if (options.dataDir) await mkdir(dirname(options.dataDir), { recursive: true, mode: 0o700 });
    const embedded = new PGlite(options.dataDir);
    await embedded.waitReady;
    database = {
      query: (sql, params) => embedded.query<Row>(sql, params),
      close: () => embedded.close(),
    };
  }
  await database.query(
    "CREATE TABLE IF NOT EXISTS records(owner text NOT NULL,kind text NOT NULL,id text NOT NULL,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner,kind,id))",
  );
  return new Store(database);
}
