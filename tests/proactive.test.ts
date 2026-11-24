import assert from "node:assert/strict";
import { test } from "node:test";
import { Commitments } from "../apps/server/src/commitments.ts";
import { createStore } from "../apps/server/src/db.ts";
import {
  type Feedback,
  isFlight,
  judge,
  type Moment,
  mutedByFeedback,
  Proactive,
  parseChief,
  planMoments,
  proactiveToolSpecs,
} from "../apps/server/src/proactive.ts";

const HOUR = 3_600_000;
const ZONE = "America/Chicago";
// December: Chicago is UTC-6. "Dec 9, 10:00 am" local is 16:00Z.
const local = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(2026, 11, day, (h as number) + 6, m as number);
};

async function setUp(start: number, options: { quiet?: string; buffer?: number } = {}) {
  const db = await createStore();
  let now = start;
  const sent: { title: string; body: string; key: string }[] = [];
  const notify = async (_owner: string, note: { title: string; body: string; key: string }) => {
    sent.push(note);
  };
  const proactive = new Proactive(db, {
    timeZone: async () => ZONE,
    quietHours: async () => options.quiet,
    notify,
    now: () => now,
  });
  const commitments = new Commitments(
    db,
    async () => ZONE,
    notify,
    () => now,
    proactive,
    async () => options.buffer ?? 30,
  );
  return {
    db,
    proactive,
    commitments,
    sent,
    at: (ms: number) => {
      now = ms;
    },
    tick: async (to: number) => {
      now = to;
      await commitments.nudgeDue();
    },
  };
}

test("the Cambodia week: nothing for days, then the day before with the gate, then time to leave", async () => {
  const w = await setUp(local(3, "09:00"));
  // The booking email arrives a week ahead; its confirmation number is tracked.
  await w.commitments.track(
    "o",
    {
      kind: "trip",
      title: "Flight to Phnom Penh (UA 837)",
      at: "2026-12-10T09:05",
      where: "IAH, Houston",
      reference: "K7QP2L",
    },
    "email",
    "mail-1",
  );
  for (const [day, time] of [
    [3, "12:00"],
    [6, "12:00"],
    [9, "08:00"],
  ] as const)
    await w.tick(local(day, time));
  assert.equal(w.sent.length, 0, "more than a day away: silence");

  // The day-before email adds the gate and terminal to the same booking.
  w.at(local(9, "10:00"));
  await w.commitments.track("o", {
    kind: "trip",
    title: "Flight to Phnom Penh (UA 837)",
    at: "2026-12-10T09:05",
    where: "IAH, Houston",
    reference: "K7QP2L",
    details: "Terminal C, gate C12",
  });
  await w.tick(local(9, "10:05"));
  await w.tick(local(9, "10:06"));
  assert.equal(w.sent.length, 1, "one day-before nudge, once");
  assert.match(w.sent[0]?.title ?? "", /^Coming up: Flight to Phnom Penh/);
  assert.match(w.sent[0]?.body ?? "", /Thu, Dec 10, 9:05 AM/);
  assert.match(w.sent[0]?.body ?? "", /Terminal C, gate C12/);
  assert.match(w.sent[0]?.body ?? "", /Check-in usually opens about 24 hours before/);
  assert.match(w.sent[0]?.body ?? "", /From a confirmation email you had on Dec 3/);

  await w.tick(local(10, "06:30"));
  assert.equal(
    w.sent.length,
    1,
    "9:05 minus two hours at the airport and 30 minutes to get there is 6:35",
  );
  await w.tick(local(10, "06:36"));
  assert.equal(w.sent.length, 2);
  assert.match(w.sent[1]?.title ?? "", /^Time to head to the airport: Flight to Phnom Penh/);
  assert.match(w.sent[1]?.body ?? "", /Airlines usually want you there about 2 hours before/);
  await w.tick(local(10, "07:30"));
  await w.tick(local(10, "08:30"));
  assert.equal(w.sent.length, 2, 'no extra "coming up soon" on top of the leave-by');
});

test("leaving for a flight is urgent: it is said in quiet hours and ignores the daily limit", async () => {
  const w = await setUp(local(8, "12:00"));
  await w.proactive.update("o", { dailyCap: 1 });
  await w.commitments.track("o", {
    kind: "trip",
    title: "Flight to Denver (DL 1180)",
    at: "2026-12-10T05:55",
    reference: "DEN1",
  });
  await w.commitments.track("o", {
    kind: "reservation",
    title: "Dinner at Nobu",
    at: "2026-12-10T19:00",
  });
  // Both day-before nudges are due on the evening of the 9th; the limit of one a day lets only one through.
  await w.tick(local(9, "20:00"));
  assert.equal(w.sent.length, 1);
  // The leave-by is 5:55 - 2:30 = 3:25 am: quiet hours, and the day's limit is used, and it is said anyway.
  await w.tick(local(10, "03:24"));
  assert.equal(w.sent.length, 1);
  await w.tick(local(10, "03:26"));
  assert.deepEqual(
    w.sent.map((s) => s.title.split(":")[0]),
    ["Coming up", "Time to head to the airport"],
  );
});

test("a non-urgent nudge in quiet hours waits for morning and is then said once", async () => {
  const w = await setUp(local(8, "12:00"));
  await w.commitments.track("o", {
    kind: "reservation",
    title: "Breakfast at Elmer's",
    at: "2026-12-10T06:00",
    where: "Elmer's",
  });
  // The day-before window opens at 6 am on Dec 9, inside quiet hours (10 pm to 7 am).
  await w.tick(local(9, "06:10"));
  assert.equal(w.sent.length, 0, "held, not claimed");
  await w.tick(local(9, "07:01"));
  assert.equal(w.sent.length, 1);
  await w.tick(local(9, "07:02"));
  assert.equal(w.sent.length, 1);
});

test("quiet hours the person set are used", async () => {
  const w = await setUp(local(8, "12:00"), { quiet: "11 pm to 10 am" });
  await w.commitments.track("o", {
    kind: "appointment",
    title: "Dentist",
    at: "2026-12-10T09:00",
  });
  await w.tick(local(9, "09:30"));
  assert.equal(w.sent.length, 0, "9:30 is still quiet for this person");
  await w.tick(local(9, "10:05"));
  assert.equal(w.sent.length, 1);
});

test("the daily limit holds the extra ones until tomorrow, if they are still worth saying", async () => {
  const w = await setUp(local(8, "12:00"));
  await w.proactive.update("o", { dailyCap: 1 });
  for (const [title, at] of [
    ["Dinner at Nobu", "2026-12-10T19:00"],
    ["Dentist", "2026-12-10T19:30"],
  ] as const)
    await w.commitments.track("o", { kind: "reservation", title, at });
  await w.tick(local(9, "20:00"));
  assert.equal(w.sent.length, 1, "one a day");
  await w.tick(local(10, "08:00"));
  assert.equal(w.sent.length, 2, "the held one goes out the next day, while it still matters");
});

test("'less of this' stops that area for a month and nothing else", async () => {
  const w = await setUp(local(8, "12:00"));
  await w.commitments.track("o", { kind: "bill", title: "Electric bill", at: "2026-12-10" });
  await w.commitments.track("o", {
    kind: "reservation",
    title: "Lunch at Marlow's",
    at: "2026-12-10T12:00",
  });
  await w.tick(local(9, "13:00"));
  assert.deepEqual(w.sent.map((s) => s.title.split(":")[0]).sort(), ["Coming up", "Due"]);
  // "Less of this" is about the last thing said, which was the lunch.
  const last = await w.proactive.status("o");
  assert.ok(last.lastNotice);
  const result = await w.proactive.feedback("o", { verdict: "less_of_this", area: "bills" });
  assert.equal(result.muted, true);
  await w.commitments.track("o", { kind: "bill", title: "Water bill", at: "2026-12-12" });
  await w.commitments.track("o", {
    kind: "delivery",
    title: "Parcel from Best Buy",
    at: "2026-12-12",
  });
  await w.tick(local(11, "10:00"));
  assert.deepEqual(
    w.sent.map((s) => s.title),
    [...w.sent.slice(0, 2).map((s) => s.title), "Arriving: Parcel from Best Buy"],
    "the bill is not mentioned; the delivery still is",
  );
  const status = await w.proactive.status("o");
  assert.deepEqual(status.paused, ["Bills"]);
  // Saying "turn bills back on" restores it.
  await w.proactive.update("o", { unmute: "bills" });
  assert.deepEqual((await w.proactive.status("o")).paused, []);
});

test("two 'not useful' in two weeks pause an area; a 'useful' afterwards gives it another chance", () => {
  const at = (days: number) => new Date(Date.UTC(2026, 11, 1) + days * 24 * HOUR).toISOString();
  const f = (verdict: Feedback["verdict"], days: number): Feedback => ({
    id: `${verdict}${days}`,
    key: "k",
    area: "plans",
    verdict,
    at: at(days),
  });
  const now = Date.UTC(2026, 11, 10);
  assert.equal(mutedByFeedback("plans", [f("not_useful", 2)], now), false, "one is not enough");
  assert.equal(mutedByFeedback("plans", [f("not_useful", 2), f("not_useful", 5)], now), true);
  assert.equal(
    mutedByFeedback("plans", [f("not_useful", 2), f("not_useful", 5), f("useful", 7)], now),
    false,
  );
  assert.equal(
    mutedByFeedback("plans", [f("not_useful", -9), f("not_useful", -8)], now),
    false,
    "old ones don't count",
  );
  assert.equal(mutedByFeedback("travel", [f("not_useful", 2), f("not_useful", 5)], now), false);
});

test("turned off means silent, and the plan is not lost: turning it on again says it while it still matters", async () => {
  const w = await setUp(local(8, "12:00"));
  await w.proactive.update("o", { on: false });
  await w.commitments.track("o", { kind: "event", title: "Concert", at: "2026-12-10T20:00" });
  await w.tick(local(9, "21:00"));
  assert.equal(w.sent.length, 0);
  await w.proactive.update("o", { on: true });
  await w.tick(local(10, "08:00"));
  assert.equal(w.sent.length, 1);
});

test("a plan added in its last day is not nudged (they just heard about it); a train is not an airport trip", async () => {
  const w = await setUp(local(9, "20:00"));
  await w.commitments.track("o", {
    kind: "trip",
    title: "Train to Austin",
    at: "2026-12-10T08:00",
    where: "Union Station",
  });
  assert.equal(isFlight({ kind: "trip", title: "Train to Austin" }), false);
  await w.tick(local(9, "20:05"));
  assert.equal(w.sent.length, 0, "added within its last day");
  await w.tick(local(10, "06:30"));
  assert.equal(w.sent.length, 0, "6:30 is quiet hours; it waits");
  await w.tick(local(10, "07:10"));
  assert.match(
    w.sent[0]?.title ?? "",
    /^Coming up soon: Train to Austin/,
    "a train gets the ordinary one",
  );
});

test("the judge explains every refusal", () => {
  const base = {
    now: local(9, "12:00"),
    timeZone: ZONE,
    settings: { on: true, dailyCap: 2, dailyCheck: true, muted: {} },
    sentToday: 0,
    feedback: [] as Feedback[],
  };
  const m: Moment = {
    key: "k",
    area: "plans",
    detector: "t",
    title: "t",
    body: "b",
    why: "w",
    urgency: "normal",
    expires: local(9, "18:00"),
  };
  assert.deepEqual(judge(m, base), { action: "send" });
  assert.match(
    (judge(m, { ...base, settings: { ...base.settings, on: false } }) as { reason: string }).reason,
    /turned off/,
  );
  assert.match(
    (judge(m, { ...base, now: local(9, "19:00") }) as { reason: string }).reason,
    /too late/,
  );
  assert.deepEqual(judge(m, { ...base, sentToday: 2 }), {
    action: "hold",
    reason: "today's limit is used",
  });
  const late = { ...base, now: local(9, "23:00") };
  assert.equal(judge({ ...m, expires: local(10, "12:00") }, late).action, "hold");
  assert.equal(judge({ ...m, expires: local(10, "03:00") }, late).action, "drop");
  assert.equal(
    judge({ ...m, urgency: "now", expires: local(10, "12:00") }, { ...late, sentToday: 9 }).action,
    "send",
  );
  assert.equal(
    judge({ ...m, area: "chief" }, { ...base, settings: { ...base.settings, dailyCheck: false } })
      .action,
    "drop",
  );
});

test("planMoments never repeats a stage that went out", () => {
  const plan = {
    id: "p",
    kind: "reservation" as const,
    title: "Dinner",
    at: new Date(local(10, "19:00")).toISOString(),
    timeZone: ZONE,
    source: "chat" as const,
    nudged: ["day" as const],
    createdAt: new Date(local(1, "10:00")).toISOString(),
  };
  assert.equal(planMoments(plan, local(10, "08:00")).length, 0);
  assert.equal(planMoments(plan, local(10, "17:30"))[0]?.stage, "soon");
  assert.equal(planMoments({ ...plan, nudged: ["day", "soon"] }, local(10, "17:30")).length, 0);
});

test("the daily check: once a day after 7, three at most, through the judge; a wish is kept and read", async () => {
  const w = await setUp(local(9, "06:00"));
  const calls: string[] = [];
  const run = (reply: string) => ({
    snapshot: async () => "Calendar: Dentist tomorrow 9 am",
    ask: async (prompt: string) => {
      calls.push(prompt);
      return reply;
    },
  });
  const reply = JSON.stringify({
    moments: [1, 2, 3, 4].map((n) => ({
      title: `Thing ${n}`,
      body: `Body ${n}`,
      why: "calendar",
    })),
  });
  assert.equal(await w.proactive.dailyCheck("o", run(reply)), 0, "before 7 am: not yet");
  assert.equal(calls.length, 0);
  w.at(local(9, "07:30"));
  assert.equal(await w.proactive.dailyCheck("o", run(reply)), 3, "at most three");
  assert.equal(await w.proactive.dailyCheck("o", run(reply)), 0, "once a day");
  assert.equal(calls.length, 1);
  assert.match(w.sent[0]?.body ?? "", /Why: calendar/);
  w.at(local(10, "07:30"));
  assert.equal(
    await w.proactive.dailyCheck("o", run("not json at all")),
    0,
    "a bad reply is just silence",
  );
  w.at(local(11, "07:30"));
  await w.proactive.update("o", { dailyCheck: false });
  assert.equal(await w.proactive.dailyCheck("o", run(reply)), 0, "off means no call at all");
  assert.equal(calls.length, 2);
  assert.deepEqual(parseChief('{"moments":[{"title":"x"}]}'), [], "incomplete items are refused");
});

test("the chat tool: feedback about the last notice, a wish saved where it can be seen, settings changed by saying so", async () => {
  const w = await setUp(local(8, "12:00"));
  const [tune] = proactiveToolSpecs(w.proactive, "o") as unknown as {
    execute: (a: unknown) => Promise<Record<string, unknown>>;
  }[];
  const nothing = await tune?.execute({ action: "not_useful" });
  assert.equal(nothing?.saved, false, "nothing was said, so nothing to rate");
  await w.commitments.track("o", { kind: "bill", title: "Phone bill", at: "2026-12-10" });
  await w.tick(local(9, "09:30"));
  assert.equal(w.sent.length, 1);
  const first = await tune?.execute({ action: "not_useful" });
  assert.equal(first?.saved, true);
  assert.equal(first?.muted, false);
  const wish = await tune?.execute({ action: "wish", note: "my passport expires in March" });
  assert.equal(wish?.saved, true);
  const memories = await w.db.list<{ text: string }>("o", "memories");
  assert.match(memories[0]?.text ?? "", /I wish Neddy had told me: my passport expires in March/);
  const noNote = await tune?.execute({ action: "wish" });
  assert.equal(noNote?.saved, false);
  const changed = await tune?.execute({
    action: "settings",
    dailyLimit: 3,
    pause: "deliveries",
    dailyCheck: false,
  });
  assert.equal(changed?.dailyLimit, 3);
  assert.deepEqual(changed?.paused, ["Deliveries"]);
  assert.equal(changed?.dailyCheck, false);
  const back = await tune?.execute({ action: "settings", resume: "deliveries" });
  assert.deepEqual(back?.paused, []);
});
