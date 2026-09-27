import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Commitments,
  commitmentToolSpecs,
  looksLikeConfirmation,
  parseCommitment,
} from "../apps/server/src/commitments.ts";
import { createStore } from "../apps/server/src/db.ts";

const HOUR = 3_600_000;

async function setup(start: string) {
  const db = await createStore();
  let now = Date.parse(start);
  const sent: { title: string; body: string; key: string }[] = [];
  const commitments = new Commitments(
    db,
    async () => "America/Chicago",
    async (_owner, note) => {
      sent.push(note);
    },
    () => now,
  );
  return { db, commitments, sent, advance: (ms: number) => (now += ms) };
}

test("a dinner is nudged the day before and shortly before, then closed after", async () => {
  const { commitments, sent, advance } = await setup("2026-09-27T15:00:00Z");
  const [track] = commitmentToolSpecs(commitments, "o") as unknown as {
    execute: (a: unknown) => Promise<{ id: string; when: string }>;
  }[];
  const dinner = await track?.execute({
    kind: "reservation",
    title: "Dinner at Nobu for 4",
    at: "2026-09-29T19:30",
    where: "Nobu Houston",
    reference: "OT-4471",
  });
  assert.equal(dinner?.when, "Tue, Sep 29, 7:30 PM");
  await commitments.nudgeDue();
  assert.equal(sent.length, 0, "more than a day away");
  advance(34 * HOUR); // Sep 28, 8pm Central: under a day to go
  await commitments.nudgeDue();
  await commitments.nudgeDue();
  assert.equal(sent.length, 1, "one day-before nudge, sent once");
  assert.equal(sent[0]?.title, "Coming up: Dinner at Nobu for 4");
  assert.match(sent[0]?.body ?? "", /Tue, Sep 29, 7:30 PM · Nobu Houston · Ref OT-4471/);
  advance(22 * HOUR); // 6pm on the day
  await commitments.nudgeDue();
  assert.equal(sent[1]?.title, "Coming up soon: Dinner at Nobu for 4");
  advance(26 * HOUR);
  await commitments.nudgeDue();
  assert.deepEqual(await commitments.list("o"), [], "closed once it's well past");
  assert.equal((await commitments.list("o", true))[0]?.status, "done");
});

test("a later email with the same tracking number updates the delivery instead of adding one", async () => {
  const { commitments } = await setup("2026-09-27T15:00:00Z");
  await commitments.track(
    "o",
    { kind: "delivery", title: "Grinder from Best Buy", at: "2026-10-02", reference: "1Z999" },
    "email",
    "mail-1",
  );
  // The same email again (a retried webhook) is ignored.
  await commitments.track(
    "o",
    { kind: "delivery", title: "Other", reference: "X" },
    "email",
    "mail-1",
  );
  await commitments.track(
    "o",
    { kind: "delivery", title: "Grinder out for delivery", at: "2026-09-29", reference: "1z999" },
    "email",
    "mail-2",
  );
  const list = await commitments.list("o");
  assert.equal(list.length, 1);
  assert.equal(list[0]?.title, "Grinder out for delivery");
  assert.equal(list[0]?.when, "Tue, Sep 29, 9:00 AM");
  assert.deepEqual(await commitments.list("someone-else"), []);
});

test("only likely emails are checked, and the model's answer is parsed defensively", () => {
  assert.ok(looksLikeConfirmation("Your reservation is confirmed", ""));
  assert.ok(looksLikeConfirmation("Your order has shipped", "Tracking number 1Z999"));
  assert.ok(!looksLikeConfirmation("50% off everything this weekend", "Shop now"));
  const found = parseCommitment(
    'Sure: {"commitment":{"kind":"trip","title":"Flight UA 1402 to Denver","at":"2026-10-04T07:15","where":"IAH","reference":"K7Q2PL","link":"javascript:alert(1)","details":null}}',
  );
  assert.deepEqual(found, {
    kind: "trip",
    title: "Flight UA 1402 to Denver",
    at: "2026-10-04T07:15",
    where: "IAH",
    reference: "K7Q2PL",
  });
  assert.equal(parseCommitment('{"commitment":null}'), null);
  assert.equal(parseCommitment("not json"), null);
  assert.equal(parseCommitment('{"commitment":{"kind":"spaceship","title":"x y"}}'), null);
});
