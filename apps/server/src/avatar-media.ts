import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "./errors.ts";

/**
 * Animated avatars made from a photo: a still for the first moment and two short clips that
 * loop, one idle and one talking. The files are fetched once and kept with the server's data.
 */
export const avatarPresets: Record<string, Record<"poster" | "idle" | "talking", string>> = {
  todd: {
    poster:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3Gsk2DZG9U3IEagXO8Pr1iSOQPK/hf_20260927_033225_0136e55a-3b06-4024-a90f-af0a67686023_min.webp",
    idle: "https://d8j0ntlcm91z4.cloudfront.net/user_3Gsk2DZG9U3IEagXO8Pr1iSOQPK/hf_20260927_033424_ce7e6d11-d4b1-4a2f-9d99-8d8147900755.mp4",
    talking:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3Gsk2DZG9U3IEagXO8Pr1iSOQPK/hf_20260927_033424_cb821116-e040-41bd-a3dd-ab0331d139ba.mp4",
  },
};
const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
};
/** Larger downloads are refused. */
const MAX_BYTES = 25 * 1024 * 1024;

export class AvatarMedia {
  private readonly loading = new Map<string, Promise<string>>();
  constructor(
    private readonly dataDir: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly presets = avatarPresets,
  ) {}
  /** The local copy of one part of a preset, downloading it the first time. */
  async file(preset: string, part: string) {
    const source = this.presets[preset]?.[part as "poster" | "idle" | "talking"];
    if (!source) throw new AppError("Avatar not found", 404);
    const extension = /\.(\w+)(?:\?|$)/.exec(new URL(source).pathname)?.[1]?.toLowerCase() ?? "";
    const type = TYPES[extension];
    if (!type) throw new AppError("Avatar not found", 404);
    const path = join(this.dataDir, "avatar-media", `${preset}-${part}.${extension}`);
    const existing = await stat(path).catch(() => undefined);
    if (!existing) {
      let pending = this.loading.get(path);
      if (!pending) {
        pending = this.download(source, path).finally(() => this.loading.delete(path));
        this.loading.set(path, pending);
      }
      await pending;
    }
    return { path, type, size: (await stat(path)).size };
  }
  private async download(source: string, path: string) {
    const response = await this.fetcher(source, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new AppError("The avatar couldn't be loaded", 502);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES)
      throw new AppError("The avatar couldn't be loaded", 502);
    await mkdir(join(this.dataDir, "avatar-media"), { recursive: true });
    await writeFile(`${path}.part`, bytes);
    await rename(`${path}.part`, path);
    return path;
  }
  /** Bytes to send for an optional `Range: bytes=a-b` request (Safari needs ranges for video). */
  async read(path: string, size: number, range?: string) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
    const bytes = await readFile(path);
    if (!match || (!match[1] && !match[2])) return { status: 200 as const, bytes };
    let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    let end = match[1] && match[2] ? Number(match[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) return { status: 416 as const, bytes: new Uint8Array() };
    start = Math.max(0, start);
    return {
      status: 206 as const,
      bytes: bytes.subarray(start, end + 1),
      contentRange: `bytes ${start}-${end}/${size}`,
    };
  }
}
