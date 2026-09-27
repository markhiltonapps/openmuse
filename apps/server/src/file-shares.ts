import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import type { Files } from "./files.ts";

/** How long a share link can work for. */
export const SHARE_DAYS = [1, 7, 30] as const;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

interface SharedFile {
  /** The link's code, hashed: the lookup from a link. */
  id: string;
  owner: string;
  fileId: string;
  expiresAt: string;
}
interface OwnShare {
  id: string;
  fileId: string;
  url: string;
  expiresAt: string;
  createdAt: string;
}

/**
 * Links that let anyone with them open one file until they expire, like Muse's file sharing. Each
 * link carries its own random code, so it says nothing about the account, and it can be stopped.
 */
export class FileShares {
  constructor(
    private readonly db: Store,
    private readonly files: Files,
    private readonly publicUrl: string,
    private readonly now: () => number = () => Date.now(),
  ) {}
  async create(owner: string, fileId: string, days: (typeof SHARE_DAYS)[number] = 7) {
    const file = await this.files.get(owner, fileId);
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(this.now() + days * 86_400_000).toISOString();
    const id = hash(token);
    await this.db.put("system", "file-shares", {
      id,
      owner,
      fileId: file.id,
      expiresAt,
    } satisfies SharedFile);
    const share: OwnShare = {
      id,
      fileId: file.id,
      url: `${this.publicUrl.replace(/\/$/, "")}/api/share/${token}`,
      expiresAt,
      createdAt: new Date(this.now()).toISOString(),
    };
    await this.db.put(owner, "file-shares", share);
    return { url: share.url, expiresAt, name: file.name };
  }
  /** A file's links that still work, newest first. */
  async list(owner: string, fileId: string) {
    const now = new Date(this.now()).toISOString();
    return (await this.db.list<OwnShare>(owner, "file-shares"))
      .filter((s) => s.fileId === fileId && s.expiresAt > now)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ url, expiresAt }) => ({ url, expiresAt }));
  }
  /** Stops every link to a file. */
  async stop(owner: string, fileId: string) {
    for (const share of await this.db.list<OwnShare>(owner, "file-shares"))
      if (share.fileId === fileId) {
        await this.db.remove("system", "file-shares", share.id);
        await this.db.remove(owner, "file-shares", share.id);
      }
    return { ok: true };
  }
  /** The file a link opens, while the link works and the file still exists. */
  async open(token: string) {
    const gone = new AppError("This link has expired or was turned off", 404);
    if (!/^[\w-]{20,64}$/.test(token)) throw gone;
    const share = await this.db.get<SharedFile>("system", "file-shares", hash(token));
    if (!share || share.expiresAt <= new Date(this.now()).toISOString()) throw gone;
    const file = await this.files.get(share.owner, share.fileId).catch(() => {
      throw gone;
    });
    return { file, bytes: await this.files.bytes(share.owner, file.id) };
  }
}

/** share_file: a link the person can send to anyone, working for 1, 7 or 30 days. */
export function shareToolSpecs(shares: FileShares, owner: string) {
  return [
    {
      name: "share_file",
      description:
        "Make a link to one of the person's Files that anyone with it can open, for 1, 7 (default) or 30 days. Use list_files for the id. Give the person the link and when it stops working; they can turn it off in Files. Only share a file the person asked to share.",
      parameters: z.object({
        id: z.string().min(1).max(100),
        days: z.union([z.literal(1), z.literal(7), z.literal(30)]).optional(),
      }),
      execute: async ({ id, days }: { id: string; days?: 1 | 7 | 30 }) =>
        shares.create(owner, id, days ?? 7),
    },
  ];
}
