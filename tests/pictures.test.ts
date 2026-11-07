import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Auth } from "../apps/server/src/auth.ts";
import { DiskBlobs } from "../apps/server/src/blobs.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { Files } from "../apps/server/src/files.ts";
import { pictureToolSpecs } from "../apps/server/src/picture-tools.ts";
import { Pictures } from "../apps/server/src/pictures.ts";
import { Plans } from "../apps/server/src/plans.ts";
import { UsageMeter } from "../apps/server/src/usage.ts";
import { goodPictures, PLANS } from "../packages/domain/src/plans.ts";

// A 1×1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "pictures-"));
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: dir,
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  const db = await createStore();
  const files = new Files(db, config, new Auth(db, config, "test-signing-key"), new DiskBlobs(dir));
  const blobs = new DiskBlobs(dir);
  const plans = new Plans(db, { early: { callMinutes: 200, meetingHours: 10 } });
  const usage = new UsageMeter(db);
  const calls: { model: string; body: Record<string, unknown> }[] = [];
  let answer: (body: Record<string, unknown>) => Response = () =>
    Response.json({ data: [{ b64_json: PNG, media_type: "image/png" }], usage: { cost: 0.009 } });
  const fetcher = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ model: String(body.model), body });
    return answer(body);
  }) as unknown as typeof fetch;
  const pictures = new Pictures(db, files, blobs, {
    key: () => "test-key-never-sent",
    base: "http://openrouter.test",
    fetcher,
    usage,
    plans,
    depth: {
      // A fake depth map: the test doesn't run the model.
      map: async () => new Uint8Array(Buffer.from(PNG, "base64")),
    } as never,
    agentName: async () => "Neddy",
  });
  return {
    db,
    files,
    blobs,
    plans,
    usage,
    pictures,
    calls,
    setAnswer: (next: typeof answer) => {
      answer = next;
    },
    close: async () => {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("a picture is made, saved to Files with its depth map, priced and counted", async () => {
  const t = await setup();
  await t.plans.setPlan("sam", "free");
  const made = await t.pictures.make("sam", {
    prompt: "A poodle astronaut, wide shot",
    aspect: "wide",
  });
  assert.equal(made.quality, "draft");
  assert.equal(made.model, "black-forest-labs/flux-3-image-klein");
  assert.equal(t.calls[0]?.body.aspect_ratio, "16:9");
  assert.equal(made.file.name, "a-poodle-astronaut-wide-shot.png");
  assert.equal(made.file.source, "Made by Neddy");
  assert.ok(made.file.url.includes(`/api/files/${made.file.id}/content`), "a signed link");
  assert.equal(made.depth, true);
  assert.ok(await t.pictures.depth("sam", made.file.id), "the depth map is kept beside it");
  assert.equal((await t.files.list("sam")).length, 1, "it's in Files already");
  assert.deepEqual(
    (await t.pictures.about("sam", made.file.id))?.prompt,
    "A poodle astronaut, wide shot",
  );
  assert.equal((await t.plans.view("sam")).pictures, 1);
  const good = await t.pictures.make("sam", { prompt: "A lighthouse at dusk", quality: "good" });
  assert.equal(good.model, "bytedance-seed/seedream-5-0-flash");
  assert.equal((await t.plans.view("sam")).goodPictures, 1);
  await t.close();
});

test("the month's pictures stop at the plan's number, and Good ones at a fifth of it", async () => {
  const t = await setup();
  await t.plans.setPlan("sam", "free");
  const limit = PLANS.free.pictures as number;
  const goodCap = goodPictures(limit);
  for (let i = 0; i < goodCap; i++)
    await t.pictures.make("sam", { prompt: `Good ${i}`, quality: "good" });
  await assert.rejects(
    t.pictures.make("sam", { prompt: "One more good", quality: "good" }),
    /good picture/,
  );
  for (let i = goodCap; i < limit; i++) await t.pictures.make("sam", { prompt: `Draft ${i}` });
  await assert.rejects(t.pictures.make("sam", { prompt: "One more" }), /You’ve used this month’s/);
  assert.equal(t.calls.length, limit, "nothing is asked for past the limit");
  // A retry with the same id isn't counted twice.
  const t2 = await setup();
  await t2.plans.setPlan("kim", "free");
  await t2.pictures.make("kim", { prompt: "Twice", id: "p1" });
  await t2.pictures.make("kim", { prompt: "Twice", id: "p1" });
  assert.equal((await t2.plans.view("kim")).pictures, 1);
  await t.close();
  await t2.close();
});

test("the standard limits turn a prompt down before anything is paid for", async () => {
  const t = await setup();
  await assert.rejects(
    t.pictures.make("sam", { prompt: "a naked woman on a beach" }),
    /no-go list/,
  );
  // Words that are usually innocent pass: the provider's own checks still apply.
  for (const fine of ["a blood orange cocktail", "a murder of crows at dusk", "a topless jeep"])
    assert.equal(Pictures.refused(fine), undefined, fine);
  await assert.rejects(t.pictures.make("sam", { prompt: "   " }), /what the picture should show/);
  assert.equal(t.calls.length, 0);
  assert.equal((await t.plans.view("sam")).pictures, 0);
  await t.close();
});

test("the provider's refusals and outages are said plainly, and the admin can turn pictures off", async () => {
  const t = await setup();
  t.setAnswer(() =>
    Response.json({ error: { message: "content policy violation" } }, { status: 400 }),
  );
  await assert.rejects(
    t.pictures.make("sam", { prompt: "A dragon" }),
    /turned down by the picture service/,
  );
  t.setAnswer(() => Response.json({ error: { message: "insufficient credits" } }, { status: 402 }));
  await assert.rejects(t.pictures.make("sam", { prompt: "A dragon" }), /run out of credit/);
  t.setAnswer(() => {
    throw new Error("connection reset");
  });
  await assert.rejects(t.pictures.make("sam", { prompt: "A dragon" }), /Try again in a minute/);
  await t.pictures.save({ enabled: false });
  assert.equal(await t.pictures.available(), false);
  await assert.rejects(t.pictures.make("sam", { prompt: "A dragon" }), /turned off/);
  await assert.rejects(t.pictures.save({ draft: "not a model id" }), /company, a slash/);
  assert.equal(
    (await t.pictures.save({ enabled: true, good: "" })).good,
    "bytedance-seed/seedream-5-0-flash",
  );
  await t.close();
});

test("the chat tool returns the card and says on-screen only off a call", async () => {
  const t = await setup();
  await t.plans.setPlan("sam", "free");
  const [tool] = pictureToolSpecs(t.pictures, "sam");
  const result = (await tool?.execute({ prompt: "A red bicycle" })) as Record<string, unknown>;
  const picture = result.picture as Record<string, unknown>;
  assert.equal(picture.prompt, "A red bicycle");
  assert.equal(picture.moving, true);
  assert.match(String(result.shown), /On their screen/);
  const [onCall] = pictureToolSpecs(t.pictures, "sam", { onCall: true });
  const said = (await onCall?.execute({ prompt: "A blue bicycle" })) as Record<string, unknown>;
  assert.equal(said.shown, undefined);
  const [off] = pictureToolSpecs(undefined, "sam");
  assert.match(
    String(
      ((await (off as NonNullable<typeof off>).execute({ prompt: "x" })) as { error: string })
        .error,
    ),
    /aren’t set up/,
  );
  await t.close();
});
