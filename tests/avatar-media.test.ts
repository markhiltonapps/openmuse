import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AvatarMedia, avatarPresets } from "../apps/server/src/avatar-media.ts";

test("avatar clips are fetched once, kept, and served in byte ranges for Safari", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-avatar-"));
  let fetched = 0;
  const media = new AvatarMedia(
    directory,
    (async () => {
      fetched++;
      return new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    }) as unknown as typeof fetch,
    {
      dog: { poster: "https://cdn.test/dog.webp", idle: "https://cdn.test/idle.mp4", talking: "" },
    },
  );
  try {
    const [first, second] = await Promise.all([
      media.file("dog", "idle"),
      media.file("dog", "idle"),
    ]);
    assert.equal(first.type, "video/mp4");
    assert.equal(second.size, 10);
    await media.file("dog", "idle");
    assert.equal(fetched, 1, "downloaded once, even when asked twice at the same time");
    assert.equal((await media.file("dog", "poster")).type, "image/webp");
    await assert.rejects(media.file("dog", "talking"), /not found/);
    await assert.rejects(media.file("cat", "idle"), /not found/);

    const whole = await media.read(first.path, first.size);
    assert.equal(whole.status, 200);
    const part = await media.read(first.path, first.size, "bytes=2-5");
    assert.equal(part.status, 206);
    assert.deepEqual([...part.bytes], [2, 3, 4, 5]);
    assert.equal(part.contentRange, "bytes 2-5/10");
    assert.deepEqual([...(await media.read(first.path, first.size, "bytes=8-")).bytes], [8, 9]);
    assert.deepEqual([...(await media.read(first.path, first.size, "bytes=-3")).bytes], [7, 8, 9]);
    assert.equal((await media.read(first.path, first.size, "bytes=20-")).status, 416);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  assert.ok(Object.values(avatarPresets.todd ?? {}).every((url) => url.startsWith("https://")));
});
