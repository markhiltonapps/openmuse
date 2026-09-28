import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { ADMIN_OWNER, type Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { signInEmail } from "./sign-in-email.ts";

export interface Account {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  /** Local part of the person's agent address, e.g. "sarah" for sarah@neatoagent.com. */
  handle: string;
  status: "active" | "disabled";
  createdAt: string;
  lastSignInAt?: string;
}
interface LoginLink {
  id: string;
  accountId: string;
  expiresAt: number;
}
/** The 6-digit code sent with a sign-in link, for typing in instead of opening the link. */
interface LoginCode {
  /** The address, hashed: one code per address, the newest one. */
  id: string;
  accountId: string;
  code: string;
  linkId: string;
  expiresAt: number;
  tries: number;
}
/** Wrong guesses before a code stops working: 5 in a million. */
const CODE_TRIES = 5;
export interface Mailer {
  send(message: { to: string; subject: string; text: string; html: string }): Promise<void>;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalEmail = (email: string) => email.trim().toLowerCase();
const RESERVED = new Set([
  "admin",
  "abuse",
  "postmaster",
  "hostmaster",
  "webmaster",
  "mailer-daemon",
  "noreply",
  "no-reply",
  "signin",
  "security",
  "support",
  "root",
]);
export const inviteSchema = z.object({
  email: z.email().max(320),
  name: z.string().trim().min(1).max(80),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9.-]{0,28}[a-z0-9])?$/, "Use letters, numbers, dots or dashes")
    .optional(),
});
const LINK_TTL = 15 * 60 * 1000;
const INVITE_TTL = 72 * 60 * 60 * 1000;

/** Sends sign-in email through Resend from a verified domain. */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async send(message: { to: string; subject: string; text: string; html: string }) {
    const response = await this.fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, ...message, to: [message.to] }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new AppError(`Could not send the sign-in email (${response.status})`, 502);
  }
}

/**
 * People who can sign in. The admin account owns the original workspace (ADMIN_OWNER);
 * every member gets a separate workspace keyed by their account id.
 */
export class AccountService {
  private requests = new Map<string, number[]>();
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly auth: Auth,
    private readonly mailer?: Mailer,
    private readonly now: () => number = Date.now,
  ) {}
  get emailSignIn() {
    return Boolean(this.mailer && this.config.mode === "live");
  }
  get domain() {
    return this.config.agentEmail?.split("@")[1];
  }
  /** The admin keeps the address from AGENT_EMAIL; members get handle@domain. */
  address(account: Pick<Account, "role" | "handle">) {
    if (!this.domain) return undefined;
    return account.role === "admin" ? this.config.agentEmail : `${account.handle}@${this.domain}`;
  }
  private adminHandle() {
    return this.config.agentEmail?.split("@")[0]?.toLowerCase() ?? "muse";
  }
  /** Creates the admin account for ADMIN_EMAIL on first start, keeping the existing workspace. */
  async bootstrap() {
    if (!this.config.adminEmail) return;
    const email = normalEmail(this.config.adminEmail);
    const existing = await this.db.get<Account>("system", "accounts", ADMIN_OWNER);
    if (existing?.email === email) return;
    if (existing) await this.db.remove("system", "account-emails", hash(existing.email));
    // The owner's email may already belong to a member account (say, one invited to try it).
    // That account is switched off, keeping its data, so the email opens the owner workspace.
    const taken = await this.byEmail(email);
    if (taken && taken.id !== ADMIN_OWNER)
      await this.db.put("system", "accounts", { ...taken, status: "disabled" });
    const admin: Account = {
      ...(existing ?? {
        id: ADMIN_OWNER,
        role: "admin",
        status: "active",
        createdAt: new Date(this.now()).toISOString(),
      }),
      id: ADMIN_OWNER,
      email,
      name: existing?.name ?? "Admin",
      role: "admin",
      status: "active",
      handle: this.adminHandle(),
    } as Account;
    await this.db.put("system", "accounts", admin);
    await this.db.put("system", "account-emails", { id: hash(email), accountId: ADMIN_OWNER });
  }
  async get(id: string) {
    return this.db.get<Account>("system", "accounts", id);
  }
  async byEmail(email: string) {
    const index = await this.db.get<{ accountId: string }>(
      "system",
      "account-emails",
      hash(normalEmail(email)),
    );
    return index ? this.get(index.accountId) : null;
  }
  /** Owner of an agent address's local part, or undefined when nobody uses it. */
  async ownerForHandle(handle: string) {
    const local = handle.toLowerCase();
    if (local === this.adminHandle()) return ADMIN_OWNER;
    const index = await this.db.get<{ accountId: string }>("system", "account-handles", local);
    const account = index ? await this.get(index.accountId) : null;
    return account?.status === "active" ? account.id : undefined;
  }
  async list() {
    const accounts = await this.db.list<Account>("system", "accounts");
    return accounts
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((a) => ({ ...a, agentEmail: this.address(a) }));
  }
  /** The signed-in person; the access key signs in as the admin workspace. */
  async me(owner: string) {
    const account = await this.get(owner);
    if (account) return { ...account, agentEmail: this.address(account) };
    return owner === ADMIN_OWNER
      ? {
          id: ADMIN_OWNER,
          role: "admin" as const,
          name: "Admin",
          agentEmail: this.config.agentEmail,
        }
      : null;
  }
  async isAdmin(owner: string) {
    if (owner === ADMIN_OWNER) return true;
    return (await this.get(owner))?.role === "admin";
  }
  private async requireAdmin(owner: string) {
    if (!(await this.isAdmin(owner))) throw new AppError("Only the admin can manage people", 403);
  }
  private async freeHandle(wanted: string) {
    const base =
      wanted
        .toLowerCase()
        .replace(/[^a-z0-9.-]+/g, "")
        .replace(/^[.-]+|[.-]+$/g, "")
        .slice(0, 24) || "member";
    for (let n = 1; n < 1000; n++) {
      const handle = n === 1 ? base : `${base}${n}`;
      if (RESERVED.has(handle) || handle === this.adminHandle()) continue;
      if (!(await this.db.get("system", "account-handles", handle))) return handle;
    }
    throw new AppError("Choose a different address name", 409);
  }
  async invite(owner: string, raw: unknown) {
    await this.requireAdmin(owner);
    const input = inviteSchema.parse(raw);
    const email = normalEmail(input.email);
    if (await this.byEmail(email)) throw new AppError("That email already has an account", 409);
    if (input.handle && (RESERVED.has(input.handle) || input.handle === this.adminHandle()))
      throw new AppError("That address name is reserved", 409);
    const handle = await this.freeHandle(input.handle ?? input.name.split(/\s+/)[0] ?? email);
    if (input.handle && handle !== input.handle)
      throw new AppError("That address name is taken", 409);
    const account: Account = {
      id: randomUUID(),
      email,
      name: input.name,
      role: "member",
      handle,
      status: "active",
      createdAt: new Date(this.now()).toISOString(),
    };
    if (
      !(await this.db.insertIfAbsent("system", "account-handles", {
        id: handle,
        accountId: account.id,
      }))
    )
      throw new AppError("That address name is taken", 409);
    await this.db.put("system", "accounts", account);
    await this.db.put("system", "account-emails", { id: hash(email), accountId: account.id });
    await this.sendLink(account, INVITE_TTL, true);
    return { ...account, agentEmail: this.address(account) };
  }
  async setStatus(owner: string, id: string, status: Account["status"]) {
    await this.requireAdmin(owner);
    if (id === ADMIN_OWNER) throw new AppError("The admin account can't be removed", 409);
    const account = await this.get(id);
    if (!account) throw new AppError("Account not found", 404);
    return this.db.put("system", "accounts", { ...account, status });
  }
  async resendInvite(owner: string, id: string) {
    await this.requireAdmin(owner);
    const account = await this.get(id);
    if (account?.status !== "active") throw new AppError("Account not found", 404);
    await this.sendLink(account, INVITE_TTL, true);
    return { ok: true };
  }
  /** Always answers the same way, so it never reveals who has an account. */
  async requestLink(email: string) {
    if (!this.emailSignIn) throw new AppError("Email sign-in isn't set up on this server", 404);
    const key = normalEmail(email);
    const now = this.now();
    if (this.requests.size > 5000)
      for (const [k, times] of this.requests)
        if (times.every((t) => now - t >= 15 * 60 * 1000)) this.requests.delete(k);
    const recent = (this.requests.get(key) ?? []).filter((t) => now - t < 15 * 60 * 1000);
    if (recent.length >= 5)
      throw new AppError("Too many sign-in emails. Try again in a few minutes.", 429);
    this.requests.set(key, [...recent, now]);
    const account = await this.byEmail(key);
    if (account?.status === "active") await this.sendLink(account, LINK_TTL, false);
    return { ok: true };
  }
  private async sendLink(account: Account, ttl: number, invite: boolean) {
    if (!this.mailer) throw new AppError("Email sign-in isn't set up on this server", 409);
    const token = randomBytes(32).toString("base64url");
    await this.db.put("system", "login-links", {
      id: hash(token),
      accountId: account.id,
      expiresAt: this.now() + ttl,
    } satisfies LoginLink);
    // Sign-ins also get a code to type, for the Home Screen app, where links open in the browser.
    const code = invite ? undefined : String(randomInt(0, 1_000_000)).padStart(6, "0");
    if (code)
      await this.db.put("system", "login-codes", {
        id: hash(normalEmail(account.email)),
        accountId: account.id,
        code: hash(`${account.id}:${code}`),
        linkId: hash(token),
        expiresAt: this.now() + ttl,
        tries: 0,
      } satisfies LoginCode);
    const appUrl = (this.config.appUrl ?? this.config.publicUrl).replace(/\/$/, "");
    const link = `${appUrl}/#login=${token}`;
    await this.mailer.send({
      to: account.email,
      ...signInEmail({
        invite,
        link,
        appUrl,
        expiry: invite ? "within 3 days" : "within 15 minutes",
        name: account.name,
        email: account.email,
        address: this.address(account),
        ...(code ? { code } : {}),
      }),
    });
  }
  /** Uses a typed sign-in code once and returns a session for its account. */
  async verifyCode(email: string, code: string) {
    const id = hash(normalEmail(email));
    const expired = new AppError("This code has expired. Request a new one.", 401);
    const record = await this.db.get<LoginCode>("system", "login-codes", id);
    if (!record || record.expiresAt < this.now()) throw expired;
    if (record.code !== hash(`${record.accountId}:${code.replace(/\D/g, "")}`)) {
      const tries = record.tries + 1;
      if (tries >= CODE_TRIES) {
        await this.db.remove("system", "login-codes", id);
        await this.db.remove("system", "login-links", record.linkId);
        throw new AppError("Too many wrong codes. Request a new one.", 401);
      }
      await this.db.put("system", "login-codes", { ...record, tries });
      throw new AppError("That code isn’t right. Check the email and try again.", 401);
    }
    // Taking the record is the atomic step: of two concurrent uses only one gets it back.
    const taken = await this.db.take<LoginCode>("system", "login-codes", id);
    if (!taken || taken.code !== record.code) throw expired;
    await this.db.remove("system", "login-links", record.linkId);
    return this.signInAs(record.accountId);
  }
  /** Uses a sign-in link once and returns a session for its account. */
  async verifyLink(token: string) {
    // Deleting the link is the atomic step: of two concurrent uses only one gets it back.
    const link = await this.db.take<LoginLink>("system", "login-links", hash(token));
    if (!link || link.expiresAt < this.now())
      throw new AppError("This sign-in link has expired. Request a new one.", 401);
    return this.signInAs(link.accountId, true);
  }
  private async signInAs(accountId: string, byLink = false) {
    const account = await this.get(accountId);
    if (account?.status !== "active") throw new AppError("This account no longer has access", 401);
    // A link used means its code is done with too.
    if (byLink) await this.db.remove("system", "login-codes", hash(normalEmail(account.email)));
    await this.db.put("system", "accounts", {
      ...account,
      lastSignInAt: new Date(this.now()).toISOString(),
    });
    return { account, session: await this.auth.sessionFor(account) };
  }
}
