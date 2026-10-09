import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { backdropToolSpecs, backdropView, changeBackdrop } from "../apps/server/src/backdrop.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  BACKDROPS,
  backdropGroups,
  DEFAULT_BACKDROP,
  findBackdrop,
  NO_BACKDROP,
} from "../packages/domain/src/backdrops.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close?.();
});

test("what people say finds the scene they mean", () => {
  assert.equal(findBackdrop("the city"), "city-lights");
  assert.equal(findBackdrop("Northern lights"), "northern-lights");
  assert.equal(findBackdrop("something with rain"), "forest-rain");
  assert.equal(findBackdrop("the beach"), "beach-sunset");
  assert.equal(findBackdrop("snowy mountains"), "alps");
  assert.equal(findBackdrop("Milky Way"), "milky-way");
  assert.equal(findBackdrop("none"), NO_BACKDROP);
  assert.equal(findBackdrop("turn it off"), NO_BACKDROP);
  assert.equal(findBackdrop("a purple elephant"), undefined);
});

test("every scene has its clip, still and thumbnail, and the picker shows them all", () => {
  const folder = join(import.meta.dirname, "../apps/mobile/public/backdrops");
  for (const { id } of BACKDROPS)
    for (const file of [`${id}.mp4`, `${id}.jpg`, `${id}-thumb.jpg`])
      assert.ok(existsSync(join(folder, file)), `missing ${file}`);
  assert.equal(
    backdropGroups().reduce((count, group) => count + group.items.length, 0),
    BACKDROPS.length,
  );
});

test("a new account starts on the beach; changes are saved and the agent can make them", async () => {
  const owner = "backdrop-1";
  assert.deepEqual(await backdropView(db, owner), { scene: DEFAULT_BACKDROP, still: false });
  assert.deepEqual(await changeBackdrop(db, owner, { scene: "city lights" }), {
    scene: "city-lights",
    still: false,
  });
  assert.deepEqual(await changeBackdrop(db, owner, { still: true }), {
    scene: "city-lights",
    still: true,
  });
  await assert.rejects(changeBackdrop(db, owner, { scene: "a purple elephant" }));

  const [tool] = backdropToolSpecs(db, owner);
  const result = (await tool.execute({ scene: "the northern lights" })) as {
    scene: string;
    name: string;
    message: string;
  };
  assert.equal(result.scene, "northern-lights");
  assert.equal(result.name, "Northern lights");
  // Turning it off says when it shows.
  const off = (await tool.execute({ scene: "none" })) as { scene: string; message: string };
  assert.equal(off.scene, NO_BACKDROP);
  assert.match(off.message, /takes effect when the app reopens/);
  // A scene that doesn't exist gets the list, not a guess.
  const unknown = (await tool.execute({ scene: "a purple elephant" })) as { error?: string };
  assert.ok(unknown.error);
  assert.deepEqual(await backdropView(db, owner), { scene: NO_BACKDROP, still: true });
});
