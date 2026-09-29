import { createHash } from "node:crypto";
import { z } from "zod";
import type { AccountService } from "./accounts.ts";
import { ADMIN_OWNER } from "./auth.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/** Someone who asked to join from the sign-in screen, waiting for the admin's answer. */
export interface AccessRequest {
  /** The address, hashed: one request per address. */
  id: string;
  email: string;
  name: string;
  /** What they'd use it for, in their own words. */
  note?: string;
  createdAt: string;
}

export const accessRequestSchema = z.object({
  email: z.email().max(320),
  name: z.string().trim().min(1).max(80),
  note: z.string().trim().max(300).optional(),
});

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalEmail = (email: string) => email.trim().toLowerCase();
/** Requests one address may make in a day, and everyone together in an hour. */
const PER_ADDRESS = 3;
const PER_HOUR = 20;
const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * "Request access" on the sign-in screen. The person leaves their name and address, the admin
 * gets a notification, and approving sends the usual invite. The person always gets the same
 * answer, whether or not their address already has an account, so nobody can use the button to
 * find out who does; an address that does have one gets its sign-in email instead.
 */
export class AccessRequests {
  private readonly recent = new Map<string, number[]>();
  private hourly: number[] = [];
  constructor(
    private readonly db: Store,
    private readonly accounts: Pick<
      AccountService,
      "emailSignIn" | "byEmail" | "requestLink" | "invite" | "isAdmin"
    >,
    private readonly notify: (
      owner: string,
      title: string,
      body: string,
      key: string,
    ) => Promise<unknown>,
    private readonly now: () => number = Date.now,
  ) {}
  async request(raw: unknown) {
    if (!this.accounts.emailSignIn)
      throw new AppError("Email sign-in isn't set up on this server", 404);
    const input = accessRequestSchema.parse(raw);
    const email = normalEmail(input.email);
    this.limit(email);
    const account = await this.accounts.byEmail(email);
    if (account) {
      // Their sign-in email's own limit must not show through: the answer never changes.
      if (account.status === "active")
        await this.accounts.requestLink(email).catch(() => undefined);
      return { ok: true as const };
    }
    const request: AccessRequest = {
      id: hash(email),
      email,
      name: input.name,
      ...(input.note ? { note: input.note } : {}),
      createdAt: new Date(this.now()).toISOString(),
    };
    // Asking again while the first request waits changes nothing.
    if (!(await this.db.insertIfAbsent("system", "access-requests", request)))
      return { ok: true as const };
    await this.notify(
      ADMIN_OWNER,
      `${request.name} asked to join`,
      `${email}${request.note ? ` — “${request.note}”` : ""}. Approve or decline under Apps & settings → Account → People.`,
      `access-request:${request.id}:${request.createdAt}`,
    );
    return { ok: true as const };
  }
  /** Requests still waiting; one whose address got an account some other way is dropped. */
  async list(owner: string) {
    await this.requireAdmin(owner);
    const waiting: AccessRequest[] = [];
    for (const request of await this.db.list<AccessRequest>("system", "access-requests")) {
      if (await this.accounts.byEmail(request.email))
        await this.db.remove("system", "access-requests", request.id);
      else waiting.push(request);
    }
    return waiting.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  /** Sends the invite with the name they gave, or the one the admin typed. */
  async approve(owner: string, id: string, raw: unknown) {
    await this.requireAdmin(owner);
    const request = await this.get(id);
    const input = z
      .object({ name: z.string().trim().min(1).max(80).optional(), handle: z.string().optional() })
      .parse(raw ?? {});
    const account = await this.accounts.invite(owner, {
      email: request.email,
      name: input.name ?? request.name,
      ...(input.handle ? { handle: input.handle } : {}),
    });
    await this.db.remove("system", "access-requests", id);
    return account;
  }
  /** Forgets the request; the person isn't told, and may ask again another day. */
  async decline(owner: string, id: string) {
    await this.requireAdmin(owner);
    await this.get(id);
    await this.db.remove("system", "access-requests", id);
    return { ok: true as const };
  }
  private limit(email: string) {
    const now = this.now();
    this.hourly = this.hourly.filter((t) => now - t < HOUR);
    if (this.hourly.length >= PER_HOUR)
      throw new AppError("Lots of people are asking right now. Try again in an hour.", 429);
    const mine = (this.recent.get(email) ?? []).filter((t) => now - t < DAY);
    if (mine.length >= PER_ADDRESS)
      throw new AppError("You've already asked today. No need to ask again.", 429);
    this.recent.set(email, [...mine, now]);
    this.hourly.push(now);
    if (this.recent.size > 5000)
      for (const [key, times] of this.recent)
        if (times.every((t) => now - t >= DAY)) this.recent.delete(key);
  }
  private async get(id: string) {
    const request = await this.db.get<AccessRequest>("system", "access-requests", id);
    if (!request) throw new AppError("Request not found", 404);
    return request;
  }
  private async requireAdmin(owner: string) {
    if (!(await this.accounts.isAdmin(owner)))
      throw new AppError("Only the admin can manage people", 403);
  }
}
