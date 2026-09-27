import { AppError } from "./errors.ts";
import type { Files } from "./files.ts";

/** Files larger than this are refused, like uploads. */
const MAX_BYTES = 10 * 1024 * 1024;
/**
 * Where connected apps hand over downloaded files: the app connector's storage and the drives'
 * own download hosts. Nothing else is fetched, so a link can't reach the server's own network.
 */
const HOSTS =
  /(^|\.)(composio\.dev|composio\.io|googleusercontent\.com|dropboxusercontent\.com|dropbox\.com|sharepoint\.com|1drv\.com|1drv\.ms|onedrive\.live\.com|livefilestore\.com|r2\.cloudflarestorage\.com)$|^(storage|www)\.googleapis\.com$/i;
/** Amazon S3 storage only: other amazonaws.com names can point at private addresses. */
const S3 = /^([a-z0-9.-]+\.)?s3([.-][a-z0-9-]+)?\.amazonaws\.com$/i;

export function allowedDownload(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (HOSTS.test(url.hostname) || S3.test(url.hostname))
    );
  } catch {
    return false;
  }
}

/** Download links in an app's answer, such as `{ file: { name, mimetype, s3url } }`. */
export function fileLinks(value: unknown, found: { name: string; url: string }[] = [], depth = 0) {
  if (!value || typeof value !== "object" || depth > 6 || found.length >= 10) return found;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) fileLinks(item, found, depth + 1);
    return found;
  }
  const record = value as Record<string, unknown>;
  const url = [record.s3url, record.s3_url, record.downloadUrl, record.download_url].find(
    (item): item is string => typeof item === "string" && allowedDownload(item),
  );
  if (url) {
    const name = [record.name, record.file_name, record.fileName, record.title].find(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    found.push({ name: name?.trim() ?? "document", url });
  }
  for (const item of Object.values(record)) fileLinks(item, found, depth + 1);
  return found;
}

/** Saves a file a connected app downloaded into the person's Files. */
export async function saveDownload(
  files: Files,
  owner: string,
  download: { url: string; name: string; source?: string },
  fetcher: typeof fetch = fetch,
) {
  if (!allowedDownload(download.url))
    throw new AppError(
      "Only download links returned by a connected app (Google Drive, OneDrive, Dropbox) can be saved",
      422,
    );
  // Redirects are followed by hand so each hop is checked too (Dropbox links redirect).
  let url = download.url;
  let response: Response | undefined;
  for (let hop = 0; hop < 4; hop++) {
    response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(60000) }).catch(
      () => {
        throw new AppError("The file couldn't be downloaded", 502);
      },
    );
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) break;
    url = new URL(location, url).toString();
    if (!allowedDownload(url))
      throw new AppError("The download link went somewhere that isn't allowed", 422);
    response = undefined;
  }
  if (!response?.ok)
    throw new AppError(`The file couldn't be downloaded (${response?.status ?? "redirects"})`, 502);
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES)
    throw new AppError("Files must be 10 MB or smaller", 413);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new AppError("Files must be 10 MB or smaller", 413);
  const file = await files.import(
    owner,
    download.name,
    bytes,
    download.source?.slice(0, 80) || "Connected app",
  );
  return { id: file.id, name: file.name, pageCount: file.pageCount, mimeType: file.mimeType };
}
