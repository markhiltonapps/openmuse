import assert from "node:assert/strict";
import { test } from "node:test";
import { contactCard, contactFileName } from "../src/agent-contact.ts";

test("the contact card carries the agent's name and address in vCard form", () => {
  const card = contactCard("Muse", "muse@neatoagent.com");
  assert.match(card, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
  assert.match(card, /FN:Muse\r\n/);
  assert.match(card, /EMAIL;TYPE=INTERNET:muse@neatoagent\.com\r\n/);
  assert.ok(card.endsWith("END:VCARD\r\n"));
});

test("a name can't break out of the card, and an empty one falls back to Neddy", () => {
  const card = contactCard("Evil\r\nEMAIL:x@y.z; ,", "muse@neatoagent.com");
  assert.equal(card.split("\r\n").filter((line) => line.startsWith("EMAIL")).length, 1);
  assert.match(contactCard("  ", "a@b.co"), /FN:Neddy\r\n/);
  assert.equal(contactFileName("Muse Agent!"), "muse-agent.vcf");
  assert.equal(contactFileName("???"), "neddy.vcf");
});
