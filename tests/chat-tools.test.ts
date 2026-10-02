import assert from "node:assert/strict";
import { test } from "node:test";
import { threadTitle, whenLabel } from "../apps/mobile/src/chat-names.ts";
import {
  type ChatDirectory,
  chatNameFrom,
  chatToolSpecs,
  matchChats,
} from "../apps/server/src/chat-tools.ts";

const directory: ChatDirectory = {
  current: "t-plumber",
  updatedAt: "2026-10-01T12:00:00Z",
  chats: [
    { id: "t-main", name: "Main chat", kind: "main" },
    { id: "t-health", name: "Health", kind: "space" },
    { id: "t-plumber", name: "Plumber for the upstairs bath", kind: "other" },
    { id: "t-car", name: "Car insurance renewal", kind: "other" },
    { id: "t-carloan", name: "Car loan options", kind: "older" },
    { id: "t-denver", name: "Denver trip ideas", kind: "other", archived: true },
  ],
};
const tool = (loaded: ChatDirectory | undefined = directory) =>
  chatToolSpecs("owner", async () => loaded)[0];
type Result = {
  action: string;
  chat?: { id: string; name: string };
  matches?: { id: string }[];
  chats?: { id: string }[];
  note?: string;
  shown: boolean;
  name?: string;
};
const run = async (input: Record<string, unknown>, loaded?: ChatDirectory) =>
  (await tool(loaded)?.execute(input as never)) as Result;

test("chats are found by the words people use", () => {
  assert.deepEqual(
    matchChats(directory, "my car insurance chat").map((chat) => chat.id),
    ["t-car"],
  );
  // Two fit equally: both, to choose from.
  assert.deepEqual(
    matchChats(directory, "the car one").map((chat) => chat.id),
    ["t-car", "t-carloan"],
  );
  assert.deepEqual(
    matchChats(directory, "this").map((chat) => chat.id),
    ["t-plumber"],
  );
  assert.deepEqual(
    matchChats(directory, undefined).map((chat) => chat.id),
    ["t-plumber"],
  );
  assert.deepEqual(
    matchChats(directory, "my main chat").map((chat) => chat.id),
    ["t-main"],
  );
  assert.deepEqual(
    matchChats(directory, "health").map((chat) => chat.id),
    ["t-health"],
  );
  // Archived chats only when bringing one back.
  assert.deepEqual(matchChats(directory, "denver"), []);
  assert.deepEqual(
    matchChats(directory, "denver", true).map((chat) => chat.id),
    ["t-denver"],
  );
  // "Bring back my archived chat" with one archived chat finds it.
  assert.deepEqual(
    matchChats(directory, "my archived chat", true).map((chat) => chat.id),
    ["t-denver"],
  );
});

test("manage_chats says what the app will do, and never deletes by itself", async () => {
  const opened = await run({ action: "open", chat: "car insurance" });
  assert.equal(opened.action, "open");
  assert.equal(opened.chat?.id, "t-car");
  assert.equal(opened.shown, true);
  const choose = await run({ action: "open", chat: "car" });
  assert.equal(choose.action, "choose");
  assert.equal(choose.matches?.length, 2);
  // Delete comes back as a card to tap, not done.
  const deleting = await run({ action: "delete", chat: "car insurance" });
  assert.equal(deleting.action, "delete");
  assert.equal(deleting.chat?.id, "t-car");
  // The main chat and a space's chat can't be deleted, archived or renamed.
  assert.equal((await run({ action: "delete", chat: "main" })).shown, false);
  assert.match((await run({ action: "delete", chat: "main" })).note ?? "", /cleared/);
  assert.equal((await run({ action: "archive", chat: "health" })).shown, false);
  // An older copy can only be opened or deleted.
  assert.equal((await run({ action: "rename", chat: "car loan", name: "Loans" })).shown, false);
  assert.equal((await run({ action: "delete", chat: "car loan" })).chat?.id, "t-carloan");
  // Rename needs the new name.
  assert.match((await run({ action: "rename", chat: "plumber" })).note ?? "", /what to call/);
  assert.equal((await run({ action: "rename", chat: "plumber", name: "Bath" })).name, "Bath");
  assert.equal((await run({ action: "restore", chat: "denver" })).chat?.id, "t-denver");
  // Nothing matches: it says so and names their chats, with no card.
  const none = await run({ action: "open", chat: "zebra" });
  assert.equal(none.shown, false);
  assert.match(none.note ?? "", /Car insurance renewal/);
  // Listing.
  assert.equal((await run({ action: "list" })).chats?.length, 5);
  assert.equal((await run({ action: "list", archived: true })).chats?.length, 1);
  assert.equal((await run({ action: "clear_main" })).chat?.id, "t-main");
  // Starting needs no list.
  const started = await run(
    { action: "start", name: "Kitchen", firstMessage: "Ideas?" },
    undefined,
  );
  assert.equal(started.shown, true);
  // Without the app's list, it asks them to open the app instead of guessing.
  assert.match(
    (await run({ action: "open", chat: "car" }, { chats: [], updatedAt: "" })).note ?? "",
    /open the app/,
  );
});

test("chat names and times read like a person would say them", () => {
  const now = new Date(2026, 9, 2, 1, 15);
  assert.equal(whenLabel(new Date(2026, 9, 2, 1, 14, 40).toISOString(), now), "Just now");
  assert.equal(whenLabel(new Date(2026, 9, 2, 0, 45).toISOString(), now), "30 minutes ago");
  // Two hours ago, even across midnight.
  assert.equal(whenLabel(new Date(2026, 9, 1, 23, 15).toISOString(), now), "2 hours ago");
  assert.equal(whenLabel(new Date(2026, 9, 1, 9, 0).toISOString(), now), "Yesterday");
  assert.equal(whenLabel(new Date(2026, 8, 27, 9, 0).toISOString(), now), "Sep 27");
  assert.equal(
    threadTitle({ name: "Kitchen quotes", createdAt: now.toISOString() }),
    "Kitchen quotes",
  );
  assert.match(
    threadTitle({ name: null, createdAt: new Date(2026, 8, 24, 15, 10).toISOString() }),
    /^Chat from Sep 24, 3:10\s?PM$/,
  );
  assert.match(
    threadTitle({ name: "Untitled conversation", createdAt: now.toISOString() }),
    /^Chat from /,
  );
});

test("a new chat is named from its first message, without the asking words", () => {
  assert.equal(
    chatNameFrom("Can you find a plumber for the upstairs bath this week?"),
    "Find a plumber for the upstairs bath",
  );
  assert.equal(chatNameFrom("Hey, help me plan the Denver trip"), "Plan the Denver trip");
  assert.equal(chatNameFrom("car insurance renewal?"), "Car insurance renewal");
  assert.equal(chatNameFrom("  "), undefined);
  assert.ok((chatNameFrom("a".repeat(80)) ?? "").length <= 48);
});
