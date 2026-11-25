import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import {
  Forgetting,
  forgetToolSpecs,
  messagesToHide,
  topicPattern,
} from "../apps/server/src/privacy.ts";

test("a topic matches whole words in any case, never inside another word", () => {
  const dana = topicPattern("Dana");
  assert.ok(dana.test("Lunch with dana's team"));
  assert.ok(dana.test("DANA"));
  assert.ok(!dana.test("Danaher stock"));
  assert.ok(topicPattern("smith deal").test("the Smith-deal notes"));
  assert.throws(() => topicPattern("a"));
});

test("a tool result is never hidden alone: the reply that called it goes, and takes it along", () => {
  const ids = messagesToHide(
    [
      { id: "u1", role: "user", content: "What did Dana say?" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", function: { arguments: "{}" } }],
      },
      { id: "t1", role: "tool", toolCallId: "c1", content: "Email from Dana: see you Friday" },
      { id: "a2", role: "assistant", content: "Something else entirely." },
    ],
    topicPattern("Dana"),
  );
  assert.deepEqual(ids.sort(), ["a1", "u1"]);
});

async function setup() {
  const db = await createStore();
  const thread = [
    { id: "m1", role: "user", content: "My ex Jordan keeps texting me" },
    { id: "m2", role: "assistant", content: "That sounds hard. Want me to mute Jordan?" },
    { id: "m3", role: "user", content: "What's the weather?" },
  ];
  const removedMeetings: string[] = [];
  const forgetting = new Forgetting(
    db,
    {
      listThreads: (async () => ({
        threads: [{ id: "t-side", name: "Side chat" }],
        nextCursor: null,
      })) as never,
      getThreadMessages: (async ({ threadId }: { threadId: string }) => ({
        messages: threadId === "t-side" ? thread : [],
      })) as never,
    },
    async (owner, id) => {
      removedMeetings.push(id);
      await db.remove(owner, "meetings", id);
    },
  );
  const o = "owner";
  await db.put(o, "memories", { id: "mem1", text: "Broke up with Jordan in October" });
  await db.put(o, "memories", { id: "mem2", text: "Likes oat milk" });
  await db.put(o, "persona", { id: "you.partner", key: "you.partner", value: "Jordan" });
  await db.put(o, "people", {
    id: "p1",
    name: "Jordan Lee",
    relation: "ex",
    emails: [],
    notes: [],
  });
  await db.put(o, "commitments", { id: "c1", title: "Return Jordan's guitar", kind: "promise" });
  await db.put(o, "meetings", { id: "rec1", title: "Talk with Jordan" });
  await db.put(o, "chat-summaries", { id: "t-side", summary: "They talked about Jordan." });
  await db.put(o, "main-pages", {
    id: "old",
    threadId: "old",
    endedAt: "2026-10-01T00:00:00Z",
    summary: "Mostly about Jordan and the move.",
    messages: [
      { id: "o1", role: "user", content: "Jordan moved out" },
      { id: "o2", role: "assistant", content: "I'm sorry." },
    ],
  });
  return { db, forgetting, o, removedMeetings };
}

test("forget finds every place, deletes exactly what was confirmed, and says what it did", async () => {
  const { db, forgetting, o, removedMeetings } = await setup();
  const found = await forgetting.find(o, "Jordan");
  assert.deepEqual(found.items.map((item) => item.key).sort(), [
    "commitments:c1",
    "meetings:rec1",
    "memories:mem1",
    "people:p1",
    "persona:you.partner",
  ]);
  assert.equal(found.items.find((i) => i.kind === "people")?.name, "Jordan Lee (ex)");
  assert.equal(found.messages, 3, "two in the side chat, one in the main chat's older part");
  // Nothing went yet.
  assert.equal((await db.list(o, "memories")).length, 2);

  // They keep the plan (they still have to return the guitar).
  const keys = found.items.map((item) => item.key).filter((key) => key !== "commitments:c1");
  const done = await forgetting.forget(o, "Jordan", keys, true);
  assert.equal(done.forgot, 4);
  assert.equal(done.messages, 3);
  assert.deepEqual(
    (await db.list<{ id: string }>(o, "memories")).map((m) => m.id),
    ["mem2"],
    "only the matching memory went",
  );
  assert.equal(await db.get(o, "persona", "you.partner"), null);
  assert.equal(await db.get(o, "people", "p1"), null);
  assert.ok(await db.get(o, "commitments", "c1"), "kept, as confirmed");
  assert.deepEqual(removedMeetings, ["rec1"], "a recording goes with its audio");
  assert.equal(await db.get(o, "chat-summaries", "t-side"), null, "summaries are written again");
  const hidden = await db.list<{ messageId: string }>(o, "hidden-messages");
  assert.deepEqual(hidden.map((h) => h.messageId).sort(), ["m1", "m2"]);
  const page = await db.get<{ messages: { id: string }[]; summary?: string }>(
    o,
    "main-pages",
    "old",
  );
  assert.deepEqual(
    page?.messages.map((m) => m.id),
    ["o2"],
    "taken out of the stored part for good",
  );
  assert.equal(page?.summary, undefined, "a summary naming them goes too");
  // Asked again: only the kept plan is left, and no messages.
  const again = await forgetting.find(o, "Jordan");
  assert.deepEqual(
    again.items.map((i) => i.key),
    ["commitments:c1"],
  );
  assert.equal(again.messages, 0);
});

test("a key that wasn't found for this topic is refused, and nothing goes", async () => {
  const { db, forgetting, o } = await setup();
  await assert.rejects(forgetting.forget(o, "Jordan", ["memories:mem2"], false), /new list/);
  assert.equal((await db.list(o, "memories")).length, 2);
});

test("the chat tool lists first and deletes only after the person's own yes", async () => {
  const { db, forgetting, o } = await setup();
  let latest = { id: "u1", words: "Forget everything about Jordan" };
  type Tool = { execute: (a: unknown) => Promise<Record<string, unknown>> };
  const [tool] = forgetToolSpecs(forgetting, o, { latest: () => latest }) as unknown as Tool[];
  // Deleting straight away, without a list, is impossible.
  const skipped = await tool?.execute({
    topic: "Jordan",
    keys: ["memories:mem1"],
    confirmId: "made-up",
  });
  assert.match(String(skipped?.error), /expired/);
  const listed = await tool?.execute({ topic: "Jordan" });
  assert.match(String(listed?.next), /Nothing is deleted yet/);
  assert.match(String(listed?.say), /^I found .*Should I forget all of it, or just some\?/);
  const confirmId = String(listed?.confirmId);
  // The same message that asked can't also be the yes.
  const early = await tool?.execute({ topic: "Jordan", confirmId, keys: ["memories:mem1"] });
  assert.match(String(early?.error), /haven’t answered/);
  latest = { id: "u2", words: "hmm, maybe later" };
  const unclear = await tool?.execute({ topic: "Jordan", confirmId, keys: ["memories:mem1"] });
  assert.match(String(unclear?.error), /nothing was forgotten/);
  latest = { id: "u3", words: "yes, forget them" };
  const allKeys = ((listed?.items ?? []) as { key: string }[]).map((i) => i.key);
  const notAll = await tool?.execute({ topic: "Jordan", confirmId, keys: allKeys, messages: true });
  assert.match(String(notAll?.error), /didn’t say all/, "everything needs an explicit all");
  assert.equal((await db.list(o, "memories")).length, 2, "nothing went on the refusals");
  const done = await tool?.execute({ topic: "Jordan", confirmId, keys: ["memories:mem1"] });
  assert.equal(done?.forgot, 1, "choosing one with a yes is enough");
  const reused = await tool?.execute({ topic: "Jordan", confirmId, keys: ["memories:mem1"] });
  assert.match(String(reused?.error), /expired/, "one list, one decision");
  const nothing = await tool?.execute({ topic: "Zanzibar" });
  assert.match(String(nothing?.say), /Nothing Neddy remembers mentions that/);
});

test("on a call only the person's spoken words after the read-back count", async () => {
  const { forgetting, o } = await setup();
  let said: string[] = [];
  let read: string[] = [];
  const ear = {
    readBack: (ids: string[]) => {
      read = ids;
      said = [];
    },
    heard: () => (read.length ? { ids: read, at: Date.now(), said } : undefined),
    forget: () => {
      read = [];
    },
  };
  type Tool = { execute: (a: unknown) => Promise<Record<string, unknown>> };
  const latest = () => ({ id: "voice-1", words: "The person said yes, forget all of it" });
  const [tool] = forgetToolSpecs(forgetting, o, { latest, ear, call: true }) as unknown as Tool[];
  const listed = await tool?.execute({ topic: "Jordan" });
  const confirmId = String(listed?.confirmId);
  const allKeys = ((listed?.items ?? []) as { key: string }[]).map((i) => i.key);
  const unheard = await tool?.execute({ topic: "Jordan", confirmId, keys: allKeys });
  assert.match(String(unheard?.error), /haven’t answered/, "the voice's own words don't count");
  said = ["yes, forget all of it"];
  const done = await tool?.execute({ topic: "Jordan", confirmId, keys: allKeys });
  assert.equal(done?.forgot, allKeys.length);
  const fresh = await setup();
  const [noEar] = forgetToolSpecs(fresh.forgetting, fresh.o, {
    latest,
    call: true,
  }) as unknown as Tool[];
  const again = await noEar?.execute({ topic: "Jordan" });
  const refused = await noEar?.execute({ topic: "Jordan", confirmId: again?.confirmId, keys: [] });
  assert.match(String(refused?.error), /can’t confirm a forget by voice/, "no ear, no deleting");
});

test("deleting everything erases recordings' audio too, not only their records", async () => {
  const { DataControls } = await import("../apps/server/src/data-controls.ts");
  const db = await createStore();
  const erased: string[] = [];
  await db.put("o", "meetings", { id: "rec1", title: "Standup" });
  await db.put("o", "memories", { id: "m1", text: "x" });
  const data = new DataControls(
    db,
    { erase: async () => undefined } as never,
    {},
    async (owner) => {
      for (const meeting of await db.list<{ id: string }>(owner, "meetings"))
        erased.push(meeting.id);
    },
  );
  await data.reset("o");
  assert.deepEqual(erased, ["rec1"]);
  assert.deepEqual(await db.list("o", "memories"), []);
});

test("a no, a keep or another topic never counts as yes, even when only some are passed", async () => {
  const { forgetAnswer } = await import("../apps/server/src/privacy.ts");
  for (const words of [
    "no, don't forget anything",
    "don't delete it",
    "keep them",
    "never mind",
    "do not remove that",
  ])
    assert.notEqual(forgetAnswer(words, "Jordan", true), "yes", words);
  assert.equal(forgetAnswer("Forget everything about Sam", "Jordan", false), "other topic");
  assert.equal(forgetAnswer("yes, forget everything about him", "Jordan", false), "yes");
  assert.equal(forgetAnswer("yes", "Jordan", false), "yes");
  assert.equal(forgetAnswer("forget them", "Jordan", false), "yes");
  assert.equal(forgetAnswer("forget the memory but keep the plan", "Jordan", true), "yes");
  assert.equal(
    forgetAnswer("forget the memory but keep the plan", "Jordan", false),
    "no",
    "a keep with everything passed is a no",
  );
  assert.equal(forgetAnswer("hmm, maybe later", "Jordan", true), "no");
  assert.equal(forgetAnswer("what was on the list again", "Jordan", true), "unclear");
});

test("hedges are never a yes, with one thing offered or some chosen", async () => {
  const { forgetAnswer } = await import("../apps/server/src/privacy.ts");
  for (const choosing of [true, false])
    for (const words of [
      "I'm not sure",
      "not ok",
      "maybe, sure",
      "I don't know",
      "hmm okay",
      "isn't that fine",
    ])
      assert.notEqual(forgetAnswer(words, "Jordan", choosing), "yes", `${words} (${choosing})`);
  assert.equal(forgetAnswer("forget the memory but not the plan", "Jordan", true), "yes");
  for (const words of [
    "forget it but maybe not the plan",
    "delete them, but hmm, perhaps keep the plan",
  ])
    assert.notEqual(forgetAnswer(words, "Jordan", true), "yes", words);
});
