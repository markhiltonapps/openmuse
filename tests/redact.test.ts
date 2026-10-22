import assert from "node:assert/strict";
import { test } from "node:test";
import { hasSensitive, hiddenNames, redact, redactDeep } from "../packages/domain/src/redact.ts";

const kinds = (text: string) => redact(text).found.map((f) => f.kind);

test("card numbers: real shapes that pass the check are hidden, keeping the last four", () => {
  const r = redact("Charge my Visa 4111 1111 1111 1111 for the deposit");
  assert.equal(r.text, "Charge my Visa [card ending 1111] for the deposit");
  assert.deepEqual(kinds(r.text), []);
  assert.deepEqual(r.found, [{ kind: "card", length: 19 }]);
  assert.equal(redact("amex 3782-822463-10005").text, "amex [card ending 0005]");
  assert.equal(redact("mc 5555555555554444.").text, "mc [card ending 4444].");
});

test("card numbers: phone, order, tracking and date numbers are left alone", () => {
  for (const text of [
    "Call +1 (415) 555-0132 tomorrow",
    "Order 1234567890123 shipped",
    "Tracking 1Z999AA10123456784",
    "Invoice 2026-10-22 total 1,234.56",
    "ZIP 94107-1234",
    "4111 1111 1111 1112", // fails the check digit
    "1234 5678 9012 3456", // a shape no card starts with
  ])
    assert.equal(redact(text).text, text, text);
});

test("Social Security numbers need their dashes or spaces and a possible shape", () => {
  assert.equal(
    redact("SSN 078-05-1120 on the form").text,
    "SSN [Social Security number ending 1120] on the form",
  );
  assert.equal(redact("my number 123 45 6789").found[0]?.kind, "ssn");
  for (const text of [
    "000-12-3456",
    "666-12-3456",
    "900-12-3456",
    "123-00-4567",
    "123-45-0000",
    "123456789",
  ])
    assert.equal(redact(text).text, text, text);
});

test("a number next to the word that names it: bank, routing, passport, licence", () => {
  assert.equal(
    redact("Routing number: 021000021, account number 123456789012.").text,
    "Routing number: [hidden, ending 0021], account number [hidden, ending 9012].",
  );
  assert.equal(redact("passport no. X1234567 expires").found[0]?.kind, "id");
  assert.equal(redact("driver's license: D1234567").found[0]?.kind, "id");
  assert.equal(redact("IBAN GB82 WEST 1234 5698 7654 32").text, "IBAN [IBAN ending 5432]");
  assert.equal(redact("code AB12 CDEF 1234 5678 9012").text, "code AB12 CDEF 1234 5678 9012");
  // Words near those labels that aren't numbers stay.
  for (const text of [
    "Your account is overdue by 3 days",
    "account 2 of 3",
    "routing 100 miles",
    "License required",
  ])
    assert.equal(redact(text).text, text, text);
});

test("passwords and PINs said out loud or written down", () => {
  assert.equal(redact("my password is hunter2!").text, "my password is [hidden]");
  assert.equal(redact("Password: correct-horse-battery").text, "Password: [hidden]");
  assert.equal(redact("pin: 4829").text, "pin: [hidden]");
  assert.equal(redact("the CVV is 123").found[0]?.kind, "pin");
  // A sentence about passwords is not a password.
  for (const text of ["Your password is required.", "password is incorrect", "Reset your password"])
    assert.equal(redact(text).text, text, text);
});

test("API keys, tokens and private keys", () => {
  const key = `sk-ant-${"a1B2c3D4".repeat(5)}`;
  assert.equal(redact(`key ${key} here`).text, "key [secret key hidden] here");
  assert.equal(redact("AKIAIOSFODNN7EXAMPLE").found[0]?.kind, "secret");
  assert.equal(redact(`token ghp_${"x".repeat(36)}`).found[0]?.kind, "secret");
  assert.equal(
    redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789").found[0]?.kind,
    "secret",
  );
  assert.equal(
    redact("-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----").text,
    "[secret key hidden]",
  );
  assert.equal(redact("see sk-learn for details").text, "see sk-learn for details");
});

test("hiding is idempotent and says what it found in plain words", () => {
  const once = redact("card 4111111111111111 and password: swordfish7");
  assert.equal(redact(once.text).text, once.text);
  assert.equal(redact(once.text).found.length, 0);
  assert.equal(hiddenNames(once.found), "a card number and a password");
  assert.equal(hiddenNames([]), "");
  assert.equal(hasSensitive("hello"), false);
  assert.equal(hasSensitive("pin: 12345"), true);
});

test("deep values: every string is cleaned, keys and numbers are not touched", () => {
  const { value, found } = redactDeep({
    id: "m1",
    count: 3,
    messages: [{ body: "pay with 4111-1111-1111-1111", from: "bank@example.com" }, null, 7],
  });
  assert.deepEqual(value, {
    id: "m1",
    count: 3,
    messages: [{ body: "pay with [card ending 1111]", from: "bank@example.com" }, null, 7],
  });
  assert.equal(found.length, 1);
});

test("ordinary text is returned as it came", () => {
  const text =
    "Dinner at 7:30 on 10/22 at 412 Main St, table for 4. Confirmation ABC123. Call 415-555-0132.";
  assert.equal(redact(text).text, text);
  assert.equal(redact("").text, "");
});
