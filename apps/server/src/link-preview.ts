import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/** Addresses a public web page never has: this machine, private networks, link-local. */
const PRIVATE = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  PRIVATE.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 127],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["64:ff9b::", 96],
  ["2001:db8::", 32],
] as const)
  PRIVATE.addSubnet(address, prefix, "ipv6");

export function publicAddress(address: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return publicAddress(mapped);
  const family = isIP(address);
  if (!family) return false;
  return !PRIVATE.check(address, family === 4 ? "ipv4" : "ipv6");
}

type Lookup = (host: string) => Promise<{ address: string }[]>;
const resolveAll: Lookup = (host) => lookup(host, { all: true, verbatim: true });

/** An http(s) page on the public internet, on the standard port. */
async function publicUrl(value: string, resolve: Lookup) {
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
  const addresses = await resolve(host).catch(() => []);
  return addresses.length && addresses.every((a) => publicAddress(a.address)) ? url : undefined;
}

const decode = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
const IMAGE_KEYS = [
  "og:image:secure_url",
  "og:image:url",
  "og:image",
  "twitter:image",
  "twitter:image:src",
];
/** The share picture a page names for link previews (og:image or twitter:image). */
export function imageFromHtml(html: string, base: string) {
  const found = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attribute = (name: string) =>
      new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
    const key = attribute("property") ?? attribute("name");
    const content = attribute("content");
    const name = (key?.[2] ?? key?.[3] ?? key?.[4] ?? "").toLowerCase();
    const value = content?.[2] ?? content?.[3] ?? content?.[4];
    if (value && IMAGE_KEYS.includes(name) && !found.has(name)) found.set(name, decode(value));
  }
  for (const key of IMAGE_KEYS) {
    const value = found.get(key);
    if (!value) continue;
    try {
      const url = new URL(value, base);
      if (url.protocol === "https:" || url.protocol === "http:")
        return url.toString().replace(/^http:/, "https:");
    } catch {
      // Try the next one.
    }
  }
  return undefined;
}

/**
 * Finds the picture a news page shares with links to it. Only public pages are read (every
 * redirect is checked again), for at most five seconds and the first 512 KB.
 */
export async function previewImage(
  page: string,
  options: { fetcher?: typeof fetch; resolve?: Lookup } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  const resolve = options.resolve ?? resolveAll;
  let url = await publicUrl(page, resolve);
  const deadline = AbortSignal.timeout(5000);
  for (let hop = 0; url && hop < 4; hop++) {
    const response = await fetcher(url, {
      redirect: "manual",
      signal: deadline,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 (compatible; OpenMuse/1.0; link preview)",
      },
    }).catch(() => undefined);
    if (!response) return undefined;
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = await publicUrl(new URL(location, url).toString(), resolve);
      continue;
    }
    if (!response.ok || !/html/i.test(response.headers.get("content-type") ?? "html"))
      return undefined;
    const reader = response.body?.getReader();
    if (!reader) return undefined;
    const decoder = new TextDecoder();
    let html = "";
    try {
      while (html.length < 512 * 1024 && !/<\/head>/i.test(html)) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
      }
    } catch {
      // Use what arrived.
    } finally {
      void reader.cancel().catch(() => undefined);
    }
    return imageFromHtml(html, url.toString());
  }
  return undefined;
}
