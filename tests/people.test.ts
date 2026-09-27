import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import { People, peopleToolSpecs } from "../apps/server/src/people.ts";

test("notes build a dated page per person, found by name, first name or email", async () => {
  const db = await createStore();
  let now = new Date("2026-09-27T10:00:00Z");
  const people = new People(db, () => now);
  const [lookUp, note] = peopleToolSpecs(people, "owner") as unknown as {
    execute: (args: unknown) => Promise<Record<string, unknown>>;
  }[];
  await note?.execute({ name: "Dana Ruiz", relation: "client at Acme", email: "Dana@Acme.com" });
  now = new Date("2026-09-28T10:00:00Z");
  await note?.execute({ name: "dana ruiz", note: "Prefers calls before 10am" });
  const page = await lookUp?.execute({ name: "Dana" });
  assert.equal(page?.name, "Dana Ruiz");
  assert.equal(page?.relation, "client at Acme");
  assert.deepEqual(page?.emails, ["dana@acme.com"]);
  assert.equal(page?.notes, "2026-09-28: Prefers calls before 10am");
  assert.equal((await lookUp?.execute({ name: "dana@acme.com" }))?.name, "Dana Ruiz");
  assert.equal((await lookUp?.execute({ name: "Zed" }))?.found, false);
  assert.equal(await people.index("owner"), "- Dana Ruiz (client at Acme)");
  // Someone else's pages are separate.
  assert.equal(await people.index("other"), "");
});

test("the person can correct or delete a page", async () => {
  const db = await createStore();
  const people = new People(db);
  const added = await people.note("owner", {
    name: "Book club",
    kind: "group",
    note: "Meets Tuesdays",
  });
  const edited = await people.edit("owner", added.id, {
    name: "Book club",
    kind: "group",
    relation: "",
    emails: ["club@example.com"],
    notes: "Meets Wednesdays now",
  });
  assert.equal(edited.notes, "Meets Wednesdays now");
  assert.equal(edited.relation, undefined);
  await people.remove("owner", added.id);
  assert.deepEqual(await people.list("owner"), []);
  await assert.rejects(people.edit("owner", "missing", {}), /not found/);
});
