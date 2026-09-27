import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { WorkerError } from "./errors.ts";

// Conservative global-unicast allowlist: transition, documentation, private,
// loopback, multicast and reserved networks are never browser destinations.
export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family !== 6 || address.includes(".") || address.includes("%")) return false;
  const halves = address.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const words =
    halves.length === 1
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  const first = Number.parseInt(words[0] ?? "0", 16);
  const second = Number.parseInt(words[1] ?? "0", 16);
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
    first !== 0x2002 &&
    !(first === 0x3fff && second < 0x1000)
  );
}

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

// A page loads hundreds of files from a few hosts; looking each one up again queues on Node's
// four DNS threads and can stall a big page. Answers are kept for a minute: every socket still
// connects to the exact address that was checked, so a cached answer can't reach a private one.
const answers = new Map<string, { addresses: LookupAddress[]; until: number }>();
const systemResolver: Resolver = async (hostname) => {
  const cached = answers.get(hostname);
  if (cached && cached.until > Date.now()) return cached.addresses;
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (answers.size > 500) answers.clear();
  answers.set(hostname, { addresses, until: Date.now() + 60_000 });
  return addresses;
};

export async function validatePublicUrl(value: string, resolve: Resolver = systemResolver) {
  const blocked = () =>
    new WorkerError(
      "BLOCKED_URL",
      "Only public HTTP(S) destinations on ports 80 and 443 are allowed.",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw blocked();
  }
  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "80" && url.port !== "443") ||
    !hostname ||
    /(^|\.)(localhost|local|internal|home|lan)$/.test(hostname)
  )
    throw blocked();
  let addresses: LookupAddress[];
  if (isIP(hostname)) addresses = [{ address: hostname, family: isIP(hostname) }];
  else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      addresses = await Promise.race([
        resolve(hostname),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("DNS timeout")), 5000);
        }),
      ]);
    } catch {
      throw new WorkerError("DNS_UNAVAILABLE", "The destination could not be resolved.", 502);
    } finally {
      clearTimeout(timer);
    }
  }
  if (addresses.length === 0 || addresses.some((entry) => !isPublicIp(entry.address)))
    throw blocked();
  const selected = addresses.find((entry) => entry.family === 4) ?? addresses[0];
  if (!selected) throw blocked();
  return { url, address: selected.address, family: selected.family };
}
