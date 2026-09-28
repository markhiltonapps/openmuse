import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decryptSecret, encryptSecret } from "../../../packages/integrations/src/vault.ts";
import type { Store } from "./db.ts";

interface KeptSecret {
  id: string;
  secret: string;
  createdAt: string;
}

/**
 * A secret the server makes once and keeps for good, such as the key that signs sign-ins.
 *
 * With TOKEN_ENCRYPTION_KEY set it lives in the database, encrypted, so every copy of the server
 * shares it and an update never signs anyone out. A copy left in the data folder by an older
 * version is adopted rather than replaced. Without the key (a local sample workspace) it stays
 * a file in the data folder, as before.
 */
export async function keptSecret(
  db: Store,
  options: { name: string; dataDir: string; encryptionKey?: string; make: () => string },
): Promise<string> {
  const file = join(options.dataDir, options.name);
  const fromFile = () =>
    readFile(file, "utf8").catch((error) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    });
  const { encryptionKey } = options;
  if (!encryptionKey) {
    const existing = await fromFile();
    if (existing) return existing;
    await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
    const made = options.make();
    // Another copy starting at the same moment may have written it first: use theirs.
    await writeFile(file, made, { mode: 0o600, flag: "wx" }).catch(() => undefined);
    return (await fromFile()) ?? made;
  }
  const kept = await db.get<KeptSecret>("system", "server-keys", options.name);
  if (kept) return decryptSecret(kept.secret, encryptionKey);
  const value = (await fromFile()) ?? options.make();
  const inserted = await db.insertIfAbsent<KeptSecret>("system", "server-keys", {
    id: options.name,
    secret: encryptSecret(value, encryptionKey),
    createdAt: new Date().toISOString(),
  });
  if (inserted) return value;
  // Someone else saved one first; everyone uses the same.
  const winner = await db.get<KeptSecret>("system", "server-keys", options.name);
  if (!winner) throw new Error(`The ${options.name} couldn't be saved`);
  return decryptSecret(winner.secret, encryptionKey);
}
