import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "../../../packages/integrations/src/vault.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/**
 * Saved sign-ins: a site, a username and an encrypted password, typed by the person in the app and
 * never in chat. The agent sees only the site and username; the server types the password into the
 * sign-in form itself, and only on the site it was saved for. An optional authenticator key lets
 * the server make the site's one-time codes the same way.
 */
interface SavedLogin {
  id: string;
  site: string;
  username: string;
  /** Encrypted password. */
  secret: string;
  /** Encrypted authenticator settings (JSON of Authenticator). */
  authenticator?: string;
  /** Ask the person before each use; on by default. */
  askFirst: boolean;
  createdAt: string;
  lastUsedAt?: string;
}
export interface LoginView {
  id: string;
  site: string;
  username: string;
  hasAuthenticator: boolean;
  askFirst: boolean;
  createdAt: string;
  lastUsedAt?: string;
}
interface Authenticator {
  secret: string;
  digits: number;
  period: number;
  algorithm: "sha1" | "sha256" | "sha512";
}

/** "https://www.amazon.com/ap/signin" or "Amazon.com" → "amazon.com". */
export function siteOf(input: string) {
  const text = input.trim().toLowerCase();
  let host = text;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`).hostname;
  } catch {
    throw new AppError("Enter the website, like amazon.com", 400);
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^(?=.{3,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(host))
    throw new AppError("Enter the website, like amazon.com", 400);
  return host;
}

/** Whether a page's address belongs to the saved site: the site itself or one of its subdomains. */
export function sameSite(url: string, site: string) {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  return host === site || host.endsWith(`.${site}`);
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(text: string) {
  const clean = text.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!clean || /[^A-Z2-7]/.test(clean))
    throw new AppError("That authenticator key isn't valid", 400);
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  if (bytes.length < 10) throw new AppError("That authenticator key is too short", 400);
  return Buffer.from(bytes);
}

/** The key from a site's "can't scan the code?" text, or the otpauth:// link inside its QR code. */
export function authenticatorFrom(input: string): Authenticator {
  const text = input.trim();
  if (/^otpauth:\/\//i.test(text)) {
    const url = new URL(text);
    if (url.hostname !== "totp")
      throw new AppError("Only time-based authenticator codes are supported", 400);
    const algorithm = (url.searchParams.get("algorithm") ?? "SHA1").toLowerCase();
    const digits = Number(url.searchParams.get("digits") ?? 6);
    const period = Number(url.searchParams.get("period") ?? 30);
    if (!["sha1", "sha256", "sha512"].includes(algorithm) || ![6, 7, 8].includes(digits))
      throw new AppError("That authenticator link isn't supported", 400);
    if (!Number.isInteger(period) || period < 15 || period > 120)
      throw new AppError("That authenticator link isn't supported", 400);
    const secret = url.searchParams.get("secret") ?? "";
    base32(secret);
    return {
      secret: secret.toUpperCase().replace(/[\s-]/g, ""),
      digits,
      period,
      algorithm: algorithm as Authenticator["algorithm"],
    };
  }
  base32(text);
  return {
    secret: text.toUpperCase().replace(/[\s-]/g, ""),
    digits: 6,
    period: 30,
    algorithm: "sha1",
  };
}

/** RFC 6238 time-based one-time code. */
export function totp(auth: Authenticator, at: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / auth.period)));
  const mac = createHmac(auth.algorithm, base32(auth.secret)).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 15;
  const number = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(number % 10 ** auth.digits).padStart(auth.digits, "0");
}

const saveSchema = z.object({
  site: z.string().trim().min(3).max(300),
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(500),
  authenticator: z.string().trim().max(1000).optional(),
  askFirst: z.boolean().default(true),
});
const changeSchema = z.object({
  password: z.string().min(1).max(500).optional(),
  /** Empty removes the authenticator key. */
  authenticator: z.string().trim().max(1000).optional(),
  askFirst: z.boolean().optional(),
});

export class Logins {
  constructor(
    private readonly db: Store,
    private readonly key: string | undefined,
    private readonly now: () => number = Date.now,
  ) {}
  get available() {
    return !!this.key;
  }
  private secretKey() {
    if (!this.key) throw new AppError("Saved passwords need encryption set up on the server", 503);
    return this.key;
  }
  private view(login: SavedLogin): LoginView {
    return {
      id: login.id,
      site: login.site,
      username: login.username,
      hasAuthenticator: !!login.authenticator,
      askFirst: login.askFirst,
      createdAt: login.createdAt,
      ...(login.lastUsedAt ? { lastUsedAt: login.lastUsedAt } : {}),
    };
  }
  async list(owner: string) {
    const logins = await this.db.list<SavedLogin>(owner, "logins");
    return logins.map((l) => this.view(l)).sort((a, b) => a.site.localeCompare(b.site));
  }
  async save(owner: string, raw: unknown) {
    const key = this.secretKey();
    const input = saveSchema.parse(raw);
    const site = siteOf(input.site);
    const existing = (await this.db.list<SavedLogin>(owner, "logins")).find(
      (l) => l.site === site && l.username.toLowerCase() === input.username.toLowerCase(),
    );
    const auth = input.authenticator ? authenticatorFrom(input.authenticator) : undefined;
    const login: SavedLogin = {
      id: existing?.id ?? randomUUID(),
      site,
      username: input.username,
      secret: encryptSecret(input.password, key),
      ...(auth ? { authenticator: encryptSecret(JSON.stringify(auth), key) } : {}),
      askFirst: input.askFirst,
      createdAt: existing?.createdAt ?? new Date(this.now()).toISOString(),
    };
    await this.db.put(owner, "logins", login);
    return this.view(login);
  }
  async change(owner: string, id: string, raw: unknown) {
    const key = this.secretKey();
    const input = changeSchema.parse(raw);
    const login = await this.db.get<SavedLogin>(owner, "logins", id);
    if (!login) throw new AppError("Saved sign-in not found", 404);
    const next: SavedLogin = { ...login };
    if (input.password !== undefined) next.secret = encryptSecret(input.password, key);
    if (input.askFirst !== undefined) next.askFirst = input.askFirst;
    if (input.authenticator === "") delete next.authenticator;
    else if (input.authenticator !== undefined)
      next.authenticator = encryptSecret(
        JSON.stringify(authenticatorFrom(input.authenticator)),
        key,
      );
    await this.db.put(owner, "logins", next);
    return this.view(next);
  }
  async remove(owner: string, id: string) {
    await this.db.remove(owner, "logins", id);
    return { ok: true };
  }
  /** Saved sign-ins that may be used on this page. */
  async forPage(owner: string, url: string) {
    return (await this.list(owner)).filter((l) => sameSite(url, l.site));
  }
  async get(owner: string, id: string) {
    const login = await this.db.get<SavedLogin>(owner, "logins", id);
    return login ? this.view(login) : undefined;
  }
  /**
   * The password, only for a page on the site it was saved for. Server side only: it goes straight
   * into the browser and never into the agent's context.
   */
  async password(owner: string, id: string, url: string) {
    const login = await this.db.get<SavedLogin>(owner, "logins", id);
    if (!login) throw new AppError("That saved sign-in was deleted", 404);
    if (!sameSite(url, login.site))
      throw new AppError(
        `This page isn't on ${login.site}, so its saved password wasn't used. Saved passwords are only typed on the site they were saved for.`,
        409,
      );
    return decryptSecret(login.secret, this.secretKey());
  }
  /** The current one-time code, from the saved authenticator key, for a page on its site. */
  async code(owner: string, id: string, url: string) {
    const login = await this.db.get<SavedLogin>(owner, "logins", id);
    if (!login?.authenticator)
      throw new AppError("No authenticator key is saved for this sign-in", 409);
    if (!sameSite(url, login.site))
      throw new AppError(`This page isn't on ${login.site}, so no code was entered.`, 409);
    const auth = JSON.parse(decryptSecret(login.authenticator, this.secretKey())) as Authenticator;
    return totp(auth, this.now());
  }
  async used(owner: string, id: string) {
    const login = await this.db.get<SavedLogin>(owner, "logins", id);
    if (login)
      await this.db.put(owner, "logins", {
        ...login,
        lastUsedAt: new Date(this.now()).toISOString(),
      });
  }
}
