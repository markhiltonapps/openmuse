import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

const digest = (value: string) => createHash("sha256").update(value).digest();
/** Sign-ins last 30 days and renew while in use, so a device stays signed in. */
export const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
/** The workspace owner: the access key holder and the admin account share this data. */
export const ADMIN_OWNER = "local-user";
interface Session {
  owner: string;
  expiresAt: number;
  /** Digest of the access key that created it; changing the key signs every device out. */
  key?: string;
  /** Account that signed in by email; disabling the account ends its sessions. */
  account?: string;
}
export class Auth {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly signingKey: string,
  ) {}
  async session(accessKey?: string) {
    if (
      this.config.mode === "live" &&
      (!accessKey ||
        !this.config.accessKey ||
        !timingSafeEqual(digest(accessKey), digest(this.config.accessKey)))
    )
      throw new AppError("Access key is incorrect", 401);
    const token = randomBytes(32).toString("base64url");
    await this.db.put("system", "sessions", {
      id: digest(token).toString("hex"),
      owner: ADMIN_OWNER,
      expiresAt: Date.now() + SESSION_TTL,
      key: this.keyDigest(),
    });
    return { token, mode: this.config.mode };
  }
  /** A session for an account that proved its email address. */
  async sessionFor(account: { id: string }) {
    const token = randomBytes(32).toString("base64url");
    await this.db.put("system", "sessions", {
      id: digest(token).toString("hex"),
      owner: account.id,
      account: account.id,
      expiresAt: Date.now() + SESSION_TTL,
    });
    return { token, mode: this.config.mode };
  }
  async revoke(authorization?: string) {
    if (authorization?.startsWith("Bearer "))
      await this.db.remove("system", "sessions", digest(authorization.slice(7)).toString("hex"));
  }
  private keyDigest() {
    return this.config.accessKey
      ? digest(`openmuse-session:${this.config.accessKey}`).toString("hex")
      : undefined;
  }
  async owner(authorization?: string) {
    if (!authorization?.startsWith("Bearer ")) throw new AppError("Sign in to Neato_Muse", 401);
    const id = digest(authorization.slice(7)).toString("hex");
    const session = await this.db.get<Session>("system", "sessions", id);
    const now = Date.now();
    const valid =
      session &&
      session.expiresAt >= now &&
      (session.account
        ? (await this.db.get<{ status: string }>("system", "accounts", session.account))?.status ===
          "active"
        : session.key === this.keyDigest());
    if (!session || !valid) throw new AppError("Session expired. Sign in again.", 401);
    if (session.expiresAt - now < SESSION_TTL / 2)
      await this.db.put("system", "sessions", { ...session, id, expiresAt: now + SESSION_TTL });
    return session.owner;
  }
  sign(owner: string, path: string) {
    const expires = String(Date.now() + 15 * 60 * 1000);
    const signature = createHmac("sha256", this.signingKey)
      .update(`${owner}\n${path}\n${expires}`)
      .digest("hex");
    return `${this.config.publicUrl}${path}?owner=${encodeURIComponent(owner)}&expires=${expires}&signature=${signature}`;
  }
  verify(url: URL) {
    const owner = url.searchParams.get("owner") ?? "";
    const expires = url.searchParams.get("expires") ?? "";
    const signature = url.searchParams.get("signature") ?? "";
    if (
      !owner ||
      !/^\d+$/.test(expires) ||
      Number(expires) < Date.now() ||
      !/^\w{64}$/.test(signature)
    )
      throw new AppError("Document link expired; refresh the workspace", 401);
    const expected = createHmac("sha256", this.signingKey)
      .update(`${owner}\n${url.pathname}\n${expires}`)
      .digest("hex");
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature)))
      throw new AppError("Invalid access link", 403);
    return owner;
  }
}
export async function createAuth(db: Store, config: Config) {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const path = join(config.dataDir, "session-signing-key");
  let key: string;
  try {
    key = await readFile(path, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    key = randomBytes(32).toString("base64");
    await writeFile(path, key, { mode: 0o600, flag: "wx" });
  }
  return new Auth(db, config, key);
}
