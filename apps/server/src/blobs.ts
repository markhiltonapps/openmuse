import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

/**
 * Where file contents live: on the server's own disk, or in an S3-compatible bucket (Railway
 * Buckets) so any copy of the server can reach them and an update never waits on a disk.
 * Keys are paths like `files/<id>.pdf`; the disk layout is the same, so moving is a plain copy.
 */
export interface Blobs {
  readonly where: "disk" | "bucket";
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Keys that start with `prefix`. */
  list(prefix: string): Promise<string[]>;
}

const KEY = /^[\w-]+(\/[\w.-]+)+$/;
function checkKey(key: string) {
  if (!KEY.test(key) || key.split("/").some((part) => part === "." || part === ".."))
    throw new Error(`Invalid storage key: ${key}`);
}

export class DiskBlobs implements Blobs {
  readonly where = "disk" as const;
  constructor(private readonly root: string) {}
  private path(key: string) {
    checkKey(key);
    return join(this.root, ...key.split("/"));
  }
  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }
  async put(key: string, bytes: Uint8Array) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // Written aside and renamed, so a reader never sees half a file.
    const part = `${path}.${randomUUID()}.part`;
    await writeFile(part, bytes, { mode: 0o600 });
    await rename(part, path);
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
  async list(prefix: string) {
    const found: string[] = [];
    const walk = async (directory: string) => {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && !entry.name.endsWith(".part"))
          found.push(relative(this.root, path).split(sep).join("/"));
      }
    };
    // Only the folder the prefix names is walked, not everything in the data folder.
    const folder = prefix.slice(0, prefix.lastIndexOf("/") + 1);
    await walk(join(this.root, ...folder.split("/").filter(Boolean)));
    return found.filter((key) => key.startsWith(prefix)).sort();
  }
}

export interface BucketSettings {
  bucket: string;
  /** For example `https://t3.storageapi.dev`. */
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Older buckets want `https://endpoint/bucket/key` instead of `https://bucket.endpoint/key`. */
  pathStyle?: boolean;
}

/** RFC 3986 encoding, as AWS Signature Version 4 requires. */
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) =>
  createHmac("sha256", key).update(data).digest();

/**
 * Signs an S3 request (AWS Signature Version 4) and returns the headers to send. `path` is the
 * request path before encoding (`/bucket/key` or `/key`); `query` holds unencoded pairs.
 */
export function signS3(request: {
  method: string;
  host: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
}): Record<string, string> {
  const amzDate = request.date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(request.headers ?? {}).map(([name, value]) => [
        name.toLowerCase(),
        value.trim(),
      ]),
    ),
    host: request.host,
    "x-amz-content-sha256": request.payloadHash,
    "x-amz-date": amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalQuery = Object.entries(request.query ?? {})
    .map(([name, value]) => [encode(name), encode(value)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  const canonical = [
    request.method,
    request.path.split("/").map(encode).join("/"),
    canonicalQuery,
    names.map((name) => `${name}:${headers[name]}\n`).join(""),
    names.join(";"),
    request.payloadHash,
  ].join("\n");
  const scope = `${day}/${request.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(
    hmac(hmac(hmac(`AWS4${request.secretAccessKey}`, day), request.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const { host: _host, ...sent } = headers;
  return {
    ...sent,
    authorization: `AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${scope},SignedHeaders=${names.join(";")},Signature=${signature}`,
  };
}

const unescapeXml = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

export class BucketBlobs implements Blobs {
  readonly where = "bucket" as const;
  private readonly base: URL;
  constructor(
    private readonly settings: BucketSettings,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.base = new URL(settings.endpoint);
  }
  private async send(
    method: string,
    key: string,
    options: {
      query?: Record<string, string>;
      body?: Uint8Array;
      headers?: Record<string, string>;
    } = {},
  ) {
    const host = this.settings.pathStyle
      ? this.base.host
      : `${this.settings.bucket}.${this.base.host}`;
    const path = this.settings.pathStyle
      ? `/${this.settings.bucket}${key ? `/${key}` : ""}`
      : `/${key}`;
    const headers = signS3({
      method,
      host,
      path,
      query: options.query,
      headers: options.headers,
      payloadHash: sha256(options.body ?? ""),
      region: this.settings.region,
      accessKeyId: this.settings.accessKeyId,
      secretAccessKey: this.settings.secretAccessKey,
      date: this.now(),
    });
    // Encoded exactly as signed: URLSearchParams would write spaces as "+".
    const search = Object.entries(options.query ?? {})
      .map(([name, value]) => `${encode(name)}=${encode(value)}`)
      .join("&");
    const url = `${this.base.protocol}//${host}${path.split("/").map(encode).join("/")}${search ? `?${search}` : ""}`;
    return this.fetcher(url, {
      method,
      headers,
      ...(options.body ? { body: Buffer.from(options.body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
  }
  private async fail(action: string, response: Response): Promise<never> {
    const text = await response.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    throw new Error(
      `The file bucket refused to ${action} (${response.status}${code ? ` ${code}` : ""})`,
    );
  }
  async get(key: string) {
    checkKey(key);
    const response = await this.send("GET", key);
    if (response.status === 404) return null;
    if (!response.ok) return this.fail("read a file", response);
    return new Uint8Array(await response.arrayBuffer());
  }
  async put(key: string, bytes: Uint8Array, contentType = "application/octet-stream") {
    checkKey(key);
    const response = await this.send("PUT", key, {
      body: bytes,
      headers: { "content-type": contentType },
    });
    if (!response.ok) await this.fail("save a file", response);
  }
  async remove(key: string) {
    checkKey(key);
    const response = await this.send("DELETE", key);
    if (!response.ok && response.status !== 404) await this.fail("delete a file", response);
  }
  async list(prefix: string) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const response = await this.send("GET", "", {
        query: {
          "list-type": "2",
          prefix,
          ...(token ? { "continuation-token": token } : {}),
        },
      });
      if (!response.ok) await this.fail("list files", response);
      const xml = await response.text();
      for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g))
        keys.push(unescapeXml(match[1] ?? ""));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? unescapeXml(
            /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "",
          )
        : undefined;
    } while (token);
    return keys.sort();
  }
}

/** Saves, reads back and deletes a small file, so a wrong bucket setting shows at startup. */
export async function checkBlobs(blobs: Blobs) {
  const key = `health/${randomUUID()}.txt`;
  const bytes = new TextEncoder().encode("ok");
  await blobs.put(key, bytes, "text/plain");
  const back = await blobs.get(key);
  await blobs.remove(key);
  if (!back || Buffer.compare(Buffer.from(back), Buffer.from(bytes)) !== 0)
    throw new Error("The file bucket didn't return what was saved");
}

/** The bucket when one is configured, else the data folder on disk. */
export function createBlobs(config: { dataDir: string; bucket?: BucketSettings }): Blobs {
  return config.bucket ? new BucketBlobs(config.bucket) : new DiskBlobs(config.dataDir);
}
