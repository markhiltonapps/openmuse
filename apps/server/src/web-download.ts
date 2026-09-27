import { type LookupAddress, lookup } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { FILE_KINDS, kindOfMime } from "../../../packages/integrations/src/documents.ts";
import { AppError } from "./errors.ts";
import type { Files } from "./files.ts";
import { publicAddress } from "./link-preview.ts";

/** Larger downloads are refused, like uploads. */
const MAX_BYTES = 10 * 1024 * 1024;

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;
/**
 * DNS for downloads: only public addresses. It runs as the connection is made, so a name can't
 * pass a check and then point somewhere private for the real request.
 */
export function publicLookup(
  hostname: string,
  options: { all?: boolean },
  callback: LookupCallback,
  resolve: typeof lookup = lookup,
) {
  resolve(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const list = addresses as LookupAddress[];
    if (!list.length || !list.every((a) => publicAddress(a.address)))
      return callback(
        Object.assign(new Error("That address isn't on the public internet"), {
          code: "EPRIVATE",
        }),
        [],
      );
    if (options.all) return callback(null, list);
    const first = list[0] as LookupAddress;
    callback(null, first.address, first.family);
  });
}

/** A public http(s) address on the standard port, or undefined. */
export function publicWebUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return undefined;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return publicAddress(host) ? url : undefined;
  if (!host.includes(".") || /\.(local|internal|localhost)$/i.test(host)) return undefined;
  return url;
}

type Get = (url: URL) => Promise<IncomingMessage>;
const get: Get = (url) =>
  new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        lookup: publicLookup as never,
        headers: { "user-agent": "Mozilla/5.0 (compatible; NeatoMuse/1.0; file download)" },
        timeout: 30000,
      },
      resolve,
    );
    request.on("timeout", () => request.destroy(new Error("The download timed out")));
    request.on("error", reject);
    request.end();
  });

/** The file name a server suggests, or the last part of the address. */
function fileName(response: IncomingMessage, url: URL) {
  const disposition = String(response.headers["content-disposition"] ?? "");
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  let name = "";
  try {
    name = decodeURIComponent((star ?? plain ?? url.pathname.split("/").at(-1) ?? "").trim());
  } catch {
    name = (plain ?? "").trim();
  }
  return name.replace(/[\\/]/g, "_").slice(0, 160);
}

/**
 * Saves a file from a public web page into the person's Files. Every hop of a redirect is checked,
 * private and internal addresses are refused when connecting, and the size is capped.
 */
export async function downloadToFiles(
  files: Files,
  owner: string,
  download: { url: string; name?: string },
  fetchOne: Get = get,
) {
  let url = publicWebUrl(download.url);
  if (!url) throw new AppError("Only files on public web pages can be saved", 422);
  let response: IncomingMessage | undefined;
  for (let hop = 0; hop < 5; hop++) {
    response = await fetchOne(url).catch((error: Error & { code?: string }) => {
      throw new AppError(
        error.code === "EPRIVATE"
          ? "Only files on public web pages can be saved"
          : "The file couldn't be downloaded",
        error.code === "EPRIVATE" ? 422 : 502,
      );
    });
    const location = response.headers.location;
    if (
      !response.statusCode ||
      response.statusCode < 300 ||
      response.statusCode >= 400 ||
      !location
    )
      break;
    response.resume();
    url = publicWebUrl(new URL(location, url).toString());
    if (!url) throw new AppError("The download went somewhere that isn't allowed", 422);
    response = undefined;
  }
  if (!response || !url) throw new AppError("The download redirected too many times", 502);
  if ((response.statusCode ?? 0) >= 400) {
    response.resume();
    throw new AppError(`The file couldn't be downloaded (${response.statusCode})`, 502);
  }
  if (Number(response.headers["content-length"] ?? 0) > MAX_BYTES) {
    response.destroy();
    throw new AppError("Files must be 10 MB or smaller", 413);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_BYTES) {
      response.destroy();
      throw new AppError("Files must be 10 MB or smaller", 413);
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  // Name it, with the extension its type calls for when the address had none.
  let name = (download.name?.trim() || fileName(response, url) || "download").slice(0, 160);
  const kind = kindOfMime(String(response.headers["content-type"] ?? "").split(";")[0] ?? "");
  if (kind && !/\.[a-z0-9]{2,5}$/i.test(name)) name = `${name}.${FILE_KINDS[kind].ext}`;
  const file = await files.import(owner, name, bytes, `Downloaded from ${url.hostname}`);
  return { id: file.id, name: file.name, pageCount: file.pageCount, mimeType: file.mimeType };
}
