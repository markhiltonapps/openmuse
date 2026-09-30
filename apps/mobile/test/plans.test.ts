import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentArtifact } from "../../../packages/domain/src/agent.ts";
import {
  type Commitment,
  choiceFits,
  commitmentStatus,
  dayIn,
  localWhen,
  onPlansChanged,
  plansChanged,
  savedDate,
  savedResults,
  splitCommitments,
  whenLine,
} from "../src/plans.ts";

const CHICAGO = "America/Chicago";
const plan = (id: string, fields: Partial<Commitment>): Commitment => ({
  id,
  kind: "reservation",
  title: id,
  status: "upcoming",
  when: "",
  timeZone: CHICAGO,
  ...fields,
});

test("times read in the person's own day, not UTC's", () => {
  const now = new Date("2026-09-29T15:00:00Z");
  // 00:30 UTC on the 30th is 7:30 the evening before in Chicago.
  assert.deepEqual(localWhen("2026-09-30T00:30:00Z", CHICAGO, now), {
    day: "Tue, Sep 29",
    time: "7:30 PM",
  });
  assert.equal(dayIn(new Date("2026-09-30T00:30:00Z"), CHICAGO), "2026-09-29");
  assert.equal(localWhen("2027-01-04T15:00:00Z", CHICAGO, now)?.day, "Mon, Jan 4, 2027");
  assert.equal(localWhen(undefined, CHICAGO), undefined);
  assert.equal(whenLine("2026-09-30T00:30:00Z", CHICAGO, now), "Tue, Sep 29 · 7:30 PM");
  assert.equal(whenLine(undefined, CHICAGO, now), "No date yet");
  assert.equal(localWhen("not a date", CHICAGO), undefined);
  // A time zone the device doesn't know falls back to the device's.
  assert.ok(localWhen("2026-09-30T00:30:00Z", "Not/AZone", now)?.day);
});

test("plans split into upcoming, soonest first, and past, latest first", () => {
  const { upcoming, past } = splitCommitments([
    plan("later", { at: "2026-10-09T00:00:00Z" }),
    plan("no date", {}),
    plan("soon", { at: "2026-10-01T00:00:00Z" }),
    plan("done", { at: "2026-09-20T00:00:00Z", status: "done" }),
    plan("cancelled", { at: "2026-09-25T00:00:00Z", status: "cancelled" }),
    plan("undated done", { status: "done", updatedAt: "2026-09-22T00:00:00Z" }),
  ]);
  assert.deepEqual(
    upcoming.map((p) => p.id),
    ["soon", "later", "no date"],
  );
  assert.deepEqual(
    past.map((p) => p.id),
    ["cancelled", "undated done", "done"],
  );
});

test("a plan's status says today, tomorrow or just passed in the person's day", () => {
  const now = new Date("2026-09-29T15:00:00Z"); // 10am in Chicago
  const at = (iso: string) => commitmentStatus(plan("x", { at: iso }), now);
  assert.equal(at("2026-09-30T02:00:00Z"), "Today", "9pm Chicago, the 30th in UTC");
  assert.equal(at("2026-09-30T18:00:00Z"), "Tomorrow");
  assert.equal(at("2026-10-03T18:00:00Z"), "Coming up");
  assert.equal(at("2026-09-29T14:00:00Z"), "Just passed");
  assert.equal(commitmentStatus(plan("x", { status: "done" }), now), "Done");
  assert.equal(commitmentStatus(plan("x", { status: "cancelled" }), now), "Cancelled");
  assert.equal(commitmentStatus(plan("x", {}), now), "Coming up");
});

test("saved results list newest first, with their kinds in a steady order", () => {
  const artifact = (id: string, kind: AgentArtifact["kind"], createdAt: string) =>
    ({ id, taskId: "t", kind, title: id, summary: "", data: {}, createdAt }) as AgentArtifact;
  const { rows, kinds } = savedResults([
    artifact("a", "finance", "2026-09-01T10:00:00Z"),
    artifact("b", "report", "2026-09-28T10:00:00Z"),
    artifact("c", "plan", "2026-09-15T10:00:00Z"),
    artifact("d", "report", "2026-09-29T10:00:00Z"),
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["d", "b", "c", "a"],
  );
  assert.deepEqual(kinds, ["report", "plan", "finance"]);
  const now = new Date("2026-09-30T12:00:00");
  assert.equal(savedDate("2026-09-29T12:00:00", now), "Sep 29");
  assert.equal(savedDate("2025-12-29T12:00:00", now), "Dec 29, 2025");
});

test("a kind filter shares a narrow width only when no label would be cut", () => {
  const kinds = ["All", "Reports", "Comparisons", "Plans", "Finance trackers"];
  assert.equal(choiceFits(kinds, 700), true, "side by side on a computer");
  assert.equal(choiceFits(kinds, 306), false, "a phone scrolls them instead");
  assert.equal(choiceFits(["All", "Reports", "Plans"], 236), true, "three short ones share 320px");
  assert.equal(choiceFits(["All", "Reports", "Finance trackers"], 236), false);
});

test("the Feed hears when a sheet changes plans or reminders", () => {
  let heard = 0;
  const stop = onPlansChanged(() => heard++);
  plansChanged();
  stop();
  plansChanged();
  assert.equal(heard, 1);
});
