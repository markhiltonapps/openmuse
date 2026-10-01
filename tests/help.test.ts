import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { helpToolSpecs } from "../apps/server/src/help-tools.ts";
import { APP_PLACES } from "../packages/domain/src/app-places.ts";
import { HELP_GROUPS, HELP_TOPICS, helpText, searchHelp } from "../packages/domain/src/help.ts";
import { CALL_DETAIL_TOOLS } from "../packages/domain/src/voice.ts";

test("the help guide hangs together: unique topics, real groups, related topics and places", () => {
  const ids = HELP_TOPICS.map((topic) => topic.id);
  assert.equal(new Set(ids).size, ids.length, "topic ids are unique");
  const groups = new Set<string>(HELP_GROUPS.map((group) => group.id));
  for (const topic of HELP_TOPICS) {
    assert.ok(groups.has(topic.group), `${topic.id}: its group exists`);
    for (const related of topic.related ?? [])
      assert.ok(ids.includes(related), `${topic.id}: related ${related} exists`);
    // Admin topics sit in the admin group, and only there.
    assert.equal(!!topic.admin, topic.group === "admin", `${topic.id}: admin only in its group`);
    assert.ok(topic.steps?.length || topic.body?.length, `${topic.id}: says something`);
    assert.ok(!/\bhe\b|\bhis\b/i.test(JSON.stringify(topic)), `${topic.id}: no "he" for the agent`);
  }
  for (const group of HELP_GROUPS)
    assert.ok(
      HELP_TOPICS.some((topic) => topic.group === group.id),
      `${group.id} has topics`,
    );
});

test("every place in the app has a help topic, so a new screen gets one too", () => {
  // A job's own page and Help itself have nothing to explain on their own; Mail is the built-in
  // Google mailbox, which isn't set up for people (their email is under Apps).
  const exempt = new Set(["task", "help", "mail"]);
  for (const place of Object.keys(APP_PLACES)) {
    if (exempt.has(place)) continue;
    assert.ok(
      HELP_TOPICS.some((topic) => topic.place === place || topic.more?.includes(place as never)),
      `the place ${place} has a help topic (add one to packages/domain/src/help.ts)`,
    );
  }
});

test("every help screenshot is there, light and dark, with its size", async () => {
  const { HELP_SHOTS } = await import("../apps/mobile/src/help-shots.ts");
  const folder = join(import.meta.dirname, "../apps/mobile/public/help/shots");
  for (const topic of HELP_TOPICS) {
    if (!topic.shot) continue;
    assert.ok(HELP_SHOTS[topic.shot], `${topic.id}: ${topic.shot} has a size (take it again)`);
    for (const scheme of ["light", "dark"])
      assert.ok(
        existsSync(join(folder, `${topic.shot}-${scheme}.webp`)),
        `${topic.id}: ${topic.shot}-${scheme}.webp exists (run scripts/help-shots.mjs)`,
      );
  }
});

test("help search finds the right topic first, and keeps the admin's topics to the admin", () => {
  const first = (query: string, admin = false) => searchHelp(query, { admin })[0]?.id;
  assert.equal(first("connect gmail"), "connect-apps");
  assert.equal(first("dark mode"), "appearance");
  assert.equal(first("how do I log my weight"), "weight");
  assert.equal(first("talk live"), "live-call");
  assert.equal(first("sign in link expired"), "fix-sign-in-link");
  assert.equal(first("where are my reminders"), "reminders");
  // Everyday sign-in words, and questions made only of small words.
  assert.equal(first("log in"), "sign-in");
  assert.equal(first("can't sign in"), "sign-in");
  assert.equal(first("didn't get the email"), "fix-sign-in-link");
  assert.equal(first("what needs my OK"), "approvals");
  assert.equal(first("what can it do"), "welcome");
  assert.equal(first("kg"), "weight");
  assert.equal(first("where are my chats"), "side-chats");
  assert.deepEqual(searchHelp(""), []);
  assert.deepEqual(searchHelp("  ?! "), []);
  // Only the admin sees setup topics.
  assert.ok(!searchHelp("railway voice key").some((topic) => topic.admin));
  assert.equal(first("railway voice key", true), "admin-voice-key");
});

test("get_help answers from the guide with the agent's name, plain text, admin topics for the admin", async () => {
  const tool = (admin: boolean) =>
    helpToolSpecs("owner", {
      agentName: async () => "AI Todd",
      isAdmin: async () => admin,
    })[0];
  const found = (await tool(false)?.execute({ question: "How do I connect my Gmail?" })) as {
    topics: { id: string; title: string; steps?: string[]; where?: string }[];
  };
  assert.equal(found.topics[0]?.id, "connect-apps");
  assert.ok(found.topics.length <= 2);
  const text = JSON.stringify(found);
  assert.ok(!text.includes("{agent}") && !text.includes("**"), "the name is in, the marks are out");
  assert.match(found.topics[0]?.where ?? "", /Bottom bar › Apps/);
  // A topic id they named comes first.
  const named = (await tool(false)?.execute({ question: "this", topic: "weight" })) as {
    topics: { id: string }[];
  };
  assert.equal(named.topics[0]?.id, "weight");
  // The admin's topics only for the admin.
  const notAdmin = (await tool(false)?.execute({
    question: "turn on live talk voice key railway",
    topic: "admin-voice-key",
  })) as { topics: { id: string }[] };
  assert.ok(!notAdmin.topics.some((topic) => topic.id.startsWith("admin-")));
  const admin = (await tool(true)?.execute({
    question: "voice key",
    topic: "admin-voice-key",
  })) as { topics: { id: string; title: string }[] };
  assert.equal(admin.topics[0]?.title, "Turn on live talk");
  // Nothing fits: it says so instead of making steps up.
  const none = (await tool(false)?.execute({ question: "zzqx" })) as {
    topics: unknown[];
    note?: string;
  };
  assert.equal(none.topics.length, 0);
  assert.match(none.note ?? "", /nothing on that/);
  // A call shows the help it found on screen.
  assert.ok((CALL_DETAIL_TOOLS as readonly string[]).includes("get_help"));
});

test("say lines are safe to tap: only questions go in one tap, and “this” needs a place", () => {
  for (const topic of HELP_TOPICS)
    for (const line of topic.say ?? []) {
      const text = typeof line === "string" ? line : line.text;
      const where = typeof line === "object" && "where" in line;
      const send = typeof line === "object" && "send" in line;
      // A line sent in one tap changes nothing and makes nothing up.
      if (send)
        assert.ok(
          !/^(remember|remind|log|forget|add|make|move|follow|keep|plan|write|every|i |my |dana)/i.test(
            text,
          ),
          `${topic.id}: “${text}” would change something; leave it as an example`,
        );
      // “This photo”, “those”: only where there's something to point at.
      if (/\b(this|those|that again)\b/i.test(text) && !/this (week|morning|a job)/i.test(text))
        assert.ok(where, `${topic.id}: “${text}” needs a where (on a call, after a photo)`);
    }
});

test("the agent's name reads well, “your agent” included", () => {
  assert.equal(
    helpText("{agent} can help. Ask {agent}.", "your agent"),
    "Your agent can help. Ask your agent.",
  );
  assert.equal(helpText("**{agent}’s settings**", "AI Todd"), "**AI Todd’s settings**");
});
