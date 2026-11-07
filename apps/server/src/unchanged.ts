import { createHash } from "node:crypto";
import type { Context } from "hono";

/**
 * Answers a GET with its JSON and a tag made from it (ETag). When the app asks again with that
 * tag (If-None-Match) and nothing has changed, the answer is 304 with no body: a few bytes
 * instead of the whole list, and the app keeps what it has without redrawing. The app asks for
 * its workspace every 3 seconds, so almost every answer is "nothing changed".
 *
 * `key` is what the tag is made from when part of the answer changes every time (the worker's
 * heartbeat), so that part doesn't defeat the check. The browser's own cache is kept out of it
 * (no-store), so native and web behave the same and the app sees the 304 itself.
 */
export function jsonUnlessUnchanged(c: Context, data: unknown, key: unknown = data) {
  const tag = `"${createHash("sha256").update(JSON.stringify(key)).digest("base64url").slice(0, 27)}"`;
  const headers = { ETag: tag, "Cache-Control": "no-store" };
  if (c.req.header("if-none-match") === tag) return c.body(null, 304, headers);
  return c.json(data, 200, headers);
}
