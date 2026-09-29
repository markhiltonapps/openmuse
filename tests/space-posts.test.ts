import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { ScheduledPosts } from "../apps/server/src/space-posts.ts";
import { spaceToolSpecs } from "../apps/server/src/space-tools.ts";
import { Spaces } from "../apps/server/src/spaces.ts";
import type { ScheduledPost } from "../packages/domain/src/spaces.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close();
});

const TOOLS: Record<string, { app: string; readOnly?: boolean; destructive?: boolean }> = {
  INSTAGRAM_CREATE_POST: { app: "instagram" },
  INSTAGRAM_GET_INSIGHTS: { app: "instagram", readOnly: true },
  FACEBOOK_DELETE_POST: { app: "facebook", destructive: true },
  GMAIL_SEND_EMAIL: { app: "gmail" },
};
function setup(fail?: string) {
  let now = Date.parse("2026-10-05T12:00:00Z");
  const posted: { owner: string; slug: string; args: Record<string, unknown> }[] = [];
  const notes: { owner: string; title: string }[] = [];
  const apps = {
    tool: async (_owner: string, slug: string) => {
      const found = TOOLS[slug];
      if (!found) throw new Error(`Unknown app action ${slug}`);
      return { slug, name: slug, description: "", readOnly: false, ...found };
    },
    execute: async (owner: string, slug: string, args: Record<string, unknown>) => {
      if (fail) throw new Error(fail);
      posted.push({ owner, slug, args });
      return { id: "post-1" };
    },
  };
  const posts = new ScheduledPosts(
    db,
    apps,
    async (owner, title) => {
      notes.push({ owner, title });
    },
    () => now,
  );
  return {
    posts,
    posted,
    notes,
    at: (iso: string) => {
      now = Date.parse(iso);
    },
  };
}
const post = {
  tool: "INSTAGRAM_CREATE_POST",
  arguments: {
    caption: "The new frame color, three angles",
    image_url: "https://example.com/a.jpg",
  },
  summary: "Instagram carousel: the new frame color, three angles",
  postAt: "2026-10-07T10:00:00-05:00",
};

test("a queued post only goes out once approved, at its time, exactly once", async () => {
  const { posts, posted, notes, at } = setup();
  const queued = await posts.propose("ana", "space-1", post);
  assert.equal(queued.status, "awaiting_review");
  assert.equal(queued.app, "instagram");
  assert.equal(queued.postAt, "2026-10-07T15:00:00.000Z");

  // Waiting for approval: never posted, even when its time comes.
  at("2026-10-07T15:05:00Z");
  await posts.publishDue();
  assert.equal(posted.length, 0);

  at("2026-10-06T12:00:00Z");
  await assert.rejects(posts.approve("ana", queued.id, "not-the-hash"), /changed/);
  const approved = await posts.approve("ana", queued.id, queued.hash);
  assert.equal(approved.status, "scheduled");

  // Not yet.
  await posts.publishDue();
  assert.equal(posted.length, 0);

  // Two copies of the server check at once: one post.
  at("2026-10-07T15:00:30Z");
  await Promise.all([posts.publishDue(), posts.publishDue()]);
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0], {
    owner: "ana",
    slug: "INSTAGRAM_CREATE_POST",
    args: post.arguments,
  });
  const done = (await posts.list("ana")).find((p) => p.id === queued.id) as ScheduledPost;
  assert.equal(done.status, "posted");
  assert.deepEqual(notes.at(-1), { owner: "ana", title: "Posted to Instagram" });
  await posts.publishDue();
  assert.equal(posted.length, 1);
});

test("only social posts can be queued, in the future and within 60 days", async () => {
  const { posts } = setup();
  await assert.rejects(
    posts.propose("ben", "s", { ...post, tool: "GMAIL_SEND_EMAIL" }),
    /Only social media/,
  );
  await assert.rejects(
    posts.propose("ben", "s", { ...post, tool: "INSTAGRAM_GET_INSIGHTS" }),
    /isn't a post/,
  );
  await assert.rejects(
    posts.propose("ben", "s", { ...post, tool: "FACEBOOK_DELETE_POST" }),
    /isn't a post/,
  );
  await assert.rejects(
    posts.propose("ben", "s", { ...post, postAt: "2026-10-05T11:00:00Z" }),
    /a minute from now/,
  );
  await assert.rejects(
    posts.propose("ben", "s", { ...post, postAt: "2027-01-05T11:00:00Z" }),
    /60 days/,
  );
  await assert.rejects(posts.propose("ben", "s", { ...post, postAt: "next tuesday" }));
  await assert.rejects(
    new ScheduledPosts(db, undefined, async () => {}).propose("ben", "s", post),
    /not configured/,
  );
});

test("a failed or missed post says so, and a cancelled one never goes out", async () => {
  const failing = setup("The sign-in to instagram has expired.");
  const one = await failing.posts.propose("cam", "space-2", post);
  await failing.posts.approve("cam", one.id, one.hash);
  failing.at("2026-10-07T15:01:00Z");
  await failing.posts.publishDue();
  const failed = (await failing.posts.list("cam")).find((p) => p.id === one.id);
  assert.equal(failed?.status, "failed");
  assert.match(failed?.error ?? "", /expired/);
  assert.equal(failing.notes.at(-1)?.title, "Couldn’t post to Instagram");
  // Once dealt with, the person clears it from the space.
  assert.equal((await failing.posts.cancel("cam", one.id)).status, "cancelled");

  const late = setup();
  const two = await late.posts.propose("dee", "space-3", post);
  await late.posts.approve("dee", two.id, two.hash);
  late.at("2026-10-08T15:00:00Z"); // A day late: the server was down.
  await late.posts.publishDue();
  assert.equal(late.posted.length, 0);
  assert.equal((await late.posts.list("dee"))[0]?.status, "failed");
  assert.equal(late.notes.at(-1)?.title, "A post to Instagram missed its time");

  const kept = setup();
  const three = await kept.posts.propose("eve", "space-4", post);
  await kept.posts.approve("eve", three.id, three.hash);
  const four = await kept.posts.propose("eve", "space-4", { ...post, summary: "Another" });
  await kept.posts.cancelSpace("eve", "space-4");
  kept.at("2026-10-07T15:01:00Z");
  await kept.posts.publishDue();
  assert.equal(kept.posted.length, 0);
  assert.deepEqual(
    (await kept.posts.list("eve")).map((p) => p.status),
    ["cancelled", "cancelled"],
  );
  assert.ok(four);
});

type Spec = { name: string; execute: (args: never) => Promise<unknown> };
test("the agent queues posts for approval; the digest can queue but not cancel", async () => {
  const { posts } = setup();
  const spaces = new Spaces(db);
  const space = await spaces.create("fay", {});
  const chat = spaceToolSpecs(spaces, "fay", { threadId: space.threadId, posts }) as Spec[];
  const schedule = chat.find((spec) => spec.name === "schedule_post") as Spec;
  const queued = (await schedule.execute(post as never)) as { id: string; status: string };
  assert.match(queued.status, /waiting for the person's approval/);
  const list = chat.find((spec) => spec.name === "list_scheduled_posts") as Spec;
  assert.equal(((await list.execute({} as never)) as unknown[]).length, 1);
  const worker = spaceToolSpecs(spaces, "fay", { readOnly: true, posts }) as Spec[];
  assert.deepEqual(
    worker.map((spec) => spec.name),
    ["get_space_playbook", "save_week_plan", "schedule_post", "list_scheduled_posts"],
  );
  // No tool approves: only the person can, in the app.
  assert.equal(
    chat.some((spec) => /approve/.test(spec.name)),
    false,
  );
});
