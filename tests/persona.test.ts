import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import { Persona, personaInstructions, personaToolSpecs } from "../apps/server/src/persona.ts";
import { personaSourceLabel } from "../packages/domain/src/persona.ts";

test("facts the person says are saved by key, in the page's order, and read back", async () => {
  const db = await createStore();
  const persona = new Persona(db, () => new Date("2026-09-30T10:00:00Z"));
  const [save, , read] = personaToolSpecs(persona, "owner") as unknown as {
    execute: (args: unknown) => Promise<Record<string, unknown>>;
  }[];
  await save?.execute({
    facts: [
      { key: "prefs.briefTime", value: "7:00 every day" },
      { key: "you.name", value: "Mark" },
    ],
  });
  const facts = (await read?.execute({}))?.facts as { key: string; confidence: string }[];
  assert.deepEqual(
    facts.map((fact) => fact.key),
    ["you.name", "prefs.briefTime"],
  );
  assert.equal(facts[0]?.confidence, "told");
  assert.equal(await persona.context("other"), "");
  assert.match(
    await persona.context("owner"),
    /Call them: Mark\n- When they.d like a morning brief: 7:00 every day/,
  );
  // Only keys on the allowlist.
  await assert.rejects(save?.execute({ facts: [{ key: "health.condition", value: "x" }] }));
});

test("a guess never replaces what the person said, and is marked in the agent's context", async () => {
  const db = await createStore();
  const persona = new Persona(db);
  await persona.save("owner", { facts: [{ key: "comms.email", value: "Outlook" }] });
  await persona.save(
    "owner",
    { facts: [{ key: "comms.email", value: "Gmail" }] },
    "email",
    "guessed",
  );
  assert.equal((await persona.get("owner", "comms.email"))?.value, "Outlook");
  await persona.save(
    "owner",
    { facts: [{ key: "comms.calendar", value: "Google Calendar" }] },
    "email",
    "guessed",
  );
  const guess = await persona.get("owner", "comms.calendar");
  assert.equal(guess?.confidence, "guessed");
  assert.equal(guess && personaSourceLabel(guess), "From your email");
  assert.match(await persona.context("owner"), /Google Calendar \(your guess, not confirmed/);
  const confirmed = await persona.confirm("owner", "comms.calendar");
  assert.equal(confirmed.confidence, "confirmed");
  assert.equal(personaSourceLabel(confirmed), "You confirmed this");
  assert.doesNotMatch(await persona.context("owner"), /your guess/);
});

test("the person edits and forgets facts; the account name stands in until a name is set", async () => {
  const db = await createStore();
  const persona = new Persona(db);
  persona.accountName = async () => "Mark Hilton";
  assert.match(await persona.context("owner"), /name on their account: Mark Hilton/);
  const edited = await persona.edit("owner", "you.name", { value: "  Mark  " });
  assert.equal(edited?.value, "Mark");
  assert.equal(edited?.source, "you");
  assert.equal(
    personaSourceLabel(edited ?? { source: "chat", confidence: "told" }),
    "You set this",
  );
  assert.doesNotMatch(await persona.context("owner"), /name on their account/);
  await persona.forget("owner", "you.name");
  assert.deepEqual(await persona.list("owner"), []);
  await assert.rejects(persona.edit("owner", "nope", { value: "x" }), /isn't something/);
  await assert.rejects(persona.confirm("owner", "you.name"), /isn't there/);
});

test("the agent's context stays short", async () => {
  const db = await createStore();
  const persona = new Persona(db);
  const long = "x".repeat(300);
  await persona.save("owner", {
    facts: [
      "you.focus",
      "work.occupation",
      "work.hours",
      "business.what",
      "business.team",
      "business.tools",
      "household.people",
    ].map((key) => ({ key, value: long })),
  });
  const context = await persona.context("owner");
  assert.ok(context.length <= 1500);
  assert.match(context, /^- They want help with/);
});

test("Undo puts a forgotten fact back as it was; the agent can forget facts too", async () => {
  const db = await createStore();
  const persona = new Persona(db);
  const [saved] = await persona.save(
    "owner",
    { facts: [{ key: "household.home", value: "Rent" }] },
    "interview",
  );
  const [, forget] = personaToolSpecs(persona, "owner") as unknown as {
    execute: (args: unknown) => Promise<Record<string, unknown>>;
  }[];
  assert.deepEqual(await forget?.execute({ keys: ["household.home"] }), {
    forgotten: ["household.home"],
  });
  assert.equal(await persona.get("owner", "household.home"), null);
  const back = await persona.restore("owner", "household.home", saved);
  assert.equal(back.value, "Rent");
  assert.equal(back.source, "interview");
  assert.equal(back.createdAt, saved?.createdAt);
  await assert.rejects(
    persona.restore("owner", "household.home", { ...saved, confidence: "certain" }),
  );
});

test("their full home address is kept on About you, and the agent is told to use it", async () => {
  const db = await createStore();
  const persona = new Persona(db);
  await persona.save("owner", {
    facts: [{ key: "household.address", value: "123 Oak St, Houston, TX 77002" }],
  });
  assert.match(await persona.context("owner"), /Their home address: 123 Oak St, Houston, TX 77002/);
  // The whole address goes on the page; the town still sets the home area.
  assert.match(personaInstructions, /save the whole address as household\.address/);
  assert.match(personaInstructions, /also call set_home_area with its town or ZIP/);
  await db.close();
});
