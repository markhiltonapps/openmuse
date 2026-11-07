import assert from "node:assert/strict";
import { test } from "node:test";
import {
  focusFromSpeech,
  focusWords,
  knownLine,
  listWords,
  nameFrom,
  placeFrom,
  questionFor,
  readProgress,
  spokenCommand,
  stepAfter,
  stepBefore,
  stepLabel,
  tidyAnswer,
} from "../src/onboarding-steps.ts";

test("steps are numbered without hello, and move one at a time", () => {
  assert.equal(stepLabel("hello"), "");
  assert.equal(stepLabel("name"), "Step 1 of 8");
  assert.equal(stepLabel("done"), "Step 8 of 8");
  assert.equal(stepAfter("hello"), "name");
  assert.equal(stepAfter("done"), "done");
  assert.equal(stepBefore("name"), "hello");
  assert.equal(stepBefore("hello"), "hello");
});

test("a said name is tidied", () => {
  assert.equal(nameFrom("my name is mark."), "Mark");
  assert.equal(nameFrom("Call me Jo"), "Jo");
  assert.equal(nameFrom("I'm Mark Hilton"), "Mark Hilton");
  assert.equal(nameFrom("McKenzie"), "McKenzie");
  assert.equal(nameFrom("   "), "");
  assert.equal(tidyAnswer("  i run a   small company "), "I run a small company");
});

test("what they want help with, in one line", () => {
  assert.equal(listWords([]), "");
  assert.equal(listWords(["email"]), "email");
  assert.equal(listWords(["email", "calendar", "work"]), "email, calendar and work");
  assert.equal(focusWords(["email", "work"]), "Email and work projects");
  assert.equal(focusWords(["calendar"], "the garden"), "Calendar and the garden");
  assert.equal(focusWords([], ""), "");
  assert.equal(
    knownLine({
      name: "Mark",
      home: "Spring, Texas",
      work: "I run a small AI company",
      focus: ["email"],
    }),
    "Mark · Spring, Texas · I run a small AI company · wants help with email",
  );
  assert.equal(knownLine({}), "");
});

test("progress survives a reload and shrugs off bad data", () => {
  const fresh = readProgress(null);
  assert.equal(fresh.step, "hello");
  assert.equal(readProgress("not json").step, "hello");
  const kept = readProgress(
    JSON.stringify({
      step: "work",
      answers: { name: "Mark", focus: ["email", 3] },
      quiet: true,
      dismissed: 1,
    }),
  );
  assert.equal(kept.step, "work");
  assert.equal(kept.answers.name, "Mark");
  assert.deepEqual(kept.answers.focus, ["email"]);
  assert.equal(kept.quiet, true);
  assert.equal(kept.dismissed, 1);
  assert.equal(readProgress(JSON.stringify({ step: "nowhere" })).step, "hello");
});

test("questions use the name once it's known", () => {
  assert.equal(questionFor("home", {}), "Nice to meet you. Where’s home? The town is enough.");
  assert.equal(
    questionFor("home", { name: "Mark" }),
    "Nice to meet you, Mark. Where’s home? The town is enough.",
  );
  assert.match(questionFor("hello", {}, "Pip"), /^Hi, I’m Pip\./);
});

test("some spoken answers are really taps", () => {
  assert.equal(spokenCommand("Skip."), "skip");
  assert.equal(spokenCommand("nothing"), "skip");
  assert.equal(spokenCommand("go back"), "back");
  assert.equal(spokenCommand("That’s it!"), "yes");
  assert.equal(spokenCommand("Spring, Texas"), undefined);
  assert.equal(spokenCommand("no thanks, I'm fine"), undefined);
});

test("a said town and what they want help with are tidied", () => {
  assert.equal(placeFrom("I live in spring, texas."), "Spring, texas");
  assert.equal(placeFrom("Austin"), "Austin");
  assert.deepEqual(focusFromSpeech("my email and the calendar, mostly"), {
    ids: ["email", "calendar"],
    other: "",
  });
  assert.deepEqual(focusFromSpeech("help me with the garden"), { ids: [], other: "The garden" });
  assert.deepEqual(focusFromSpeech("work projects and money"), {
    ids: ["work", "money"],
    other: "",
  });
});
