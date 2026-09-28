import { type Blobs, DiskBlobs } from "./blobs.ts";
import { AppError } from "./errors.ts";

/**
 * Animated avatars made from a photo: a still for the first moment and two short clips that
 * loop, one idle and one talking. The files are fetched once and kept with the server's files.
 */
export const avatarPresets: Record<string, Record<"poster" | "idle" | "talking", string>> = {
  // Neddy, the Neato_Muse mascot: he looks around and blinks, and his eyes glow as he talks.
  neddy: {
    poster:
      "https://d2ol7oe51mr4n9.cloudfront.net/user_3Gsk2DZG9U3IEagXO8Pr1iSOQPK/3d7842c2-486b-40f7-84e5-e2bafb5ac2f4.webp",
    idle: "https://d8j0ntlcm91z4.cloudfront.net/user_3Gsk2DZG9U3IEagXO8Pr1iSOQPK/hf_20260927_142255_89a9c4d3-7692-4cd1-b143-54d661652bcb.mp4",
    talking:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3Gsk2DZG9U3IEagXO8Pr1iSOQPK/hf_20260927_142255_c95d4580-3360-4f63-a3e5-de126b97b233.mp4",
  },
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
  private readonly loading = new Map<string, Promise<Uint8Array>>();
  /** Clips are small and asked for in many byte ranges: kept in memory once loaded. */
  private readonly kept = new Map<string, Uint8Array>();
  private readonly blobs: Blobs;
  constructor(
    storage: Blobs | string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly presets = avatarPresets,
  ) {
    this.blobs = typeof storage === "string" ? new DiskBlobs(storage) : storage;
  }
  /** One part of a preset, downloading it and saving a copy the first time. */
  async file(preset: string, part: string) {
    const source = this.presets[preset]?.[part as "poster" | "idle" | "talking"];
    if (!source) throw new AppError("Avatar not found", 404);
    const extension = /\.(\w+)(?:\?|$)/.exec(new URL(source).pathname)?.[1]?.toLowerCase() ?? "";
    const type = TYPES[extension];
    if (!type) throw new AppError("Avatar not found", 404);
    const key = `avatar-media/${preset}-${part}.${extension}`;
    let bytes = this.kept.get(key);
    if (!bytes) {
      let pending = this.loading.get(key);
      if (!pending) {
        pending = this.load(source, key, type).finally(() => this.loading.delete(key));
        this.loading.set(key, pending);
      }
      bytes = await pending;
    }
    return { key, type, size: bytes.length };
  }
  private async load(source: string, key: string, type: string) {
    const bytes = (await this.blobs.get(key)) ?? (await this.download(source, key, type));
    this.kept.set(key, bytes);
    return bytes;
  }
  private async download(source: string, key: string, type: string) {
    const response = await this.fetcher(source, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new AppError("The avatar couldn't be loaded", 502);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES)
      throw new AppError("The avatar couldn't be loaded", 502);
    await this.blobs.put(key, bytes, type);
    return bytes;
  }
  /** Bytes to send for an optional `Range: bytes=a-b` request (Safari needs ranges for video). */
  async read(key: string, size: number, range?: string) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
    const bytes = this.kept.get(key) ?? (await this.blobs.get(key)) ?? new Uint8Array();
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
