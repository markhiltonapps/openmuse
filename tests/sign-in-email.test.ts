import assert from "node:assert/strict";
import { test } from "node:test";
import { signInEmail } from "../apps/server/src/sign-in-email.ts";

const base = {
  link: "https://app.test/#login=abc123",
  appUrl: "https://app.test/",
  email: "sarah@example.com",
};

test("the invite email shows Neddy, the button, the tour and the agent's address", () => {
  const mail = signInEmail({
    ...base,
    invite: true,
    expiry: "within 3 days",
    name: "Sarah Jones",
    address: "sarah@agent.test",
  });
  assert.equal(mail.subject, "You're invited to Neato_Muse");
  assert.match(mail.html, /Hi Sarah, you're invited!/);
  assert.match(mail.html, /href="https:\/\/app\.test\/#login=abc123"/);
  assert.match(mail.html, /src="https:\/\/app\.test\/email\/neddy\.png"/);
  assert.match(mail.html, /What I can do for you/);
  assert.match(mail.html, /sarah@agent\.test/);
  assert.match(mail.html, /https:\/\/app\.test\/help\.html/);
  // Plain-text readers get the link first, then the address and the guide.
  assert.match(mail.text, /^You've been invited[\s\S]*Sign in: https:\/\/app\.test\/#login=abc123/);
  assert.match(mail.text, /sarah@agent\.test[\s\S]*help\.html/);
});

test("names from the invite form can't add markup to the email", () => {
  const mail = signInEmail({
    ...base,
    invite: true,
    expiry: "within 3 days",
    name: '<img src=x onerror="alert(1)">',
  });
  assert.doesNotMatch(mail.html, /<img src=x/);
  assert.match(mail.html, /&lt;img/);
});

test("the sign-in email stays short, without the tour", () => {
  const mail = signInEmail({ ...base, invite: false, expiry: "within 15 minutes" });
  assert.equal(mail.subject, "Your Neato_Muse sign-in link");
  assert.match(mail.html, /Here's your sign-in link/);
  assert.match(mail.html, /expires within 15 minutes/);
  assert.doesNotMatch(mail.html, /What I can do for you/);
  assert.doesNotMatch(mail.text, /help\.html/);
});
