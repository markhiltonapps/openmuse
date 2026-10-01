import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import { EmailViews, emailsIn } from "../apps/server/src/email-views.ts";

test("emails in a Gmail or Outlook answer are found however they're wrapped, with a link back", () => {
  const gmail = emailsIn(
    {
      data: {
        messages: [
          {
            messageId: "18f1",
            threadId: "t9",
            sender: "Dan Smith <dan@example.com>",
            to: "me@example.com",
            subject: "Q3 numbers",
            messageText: "Here are the numbers.",
            messageTimestamp: "2026-10-01T14:00:00Z",
          },
        ],
      },
    },
    "gmail",
  );
  assert.equal(gmail.length, 1);
  assert.equal(gmail[0]?.subject, "Q3 numbers");
  assert.equal(gmail[0]?.body, "Here are the numbers.");
  assert.equal(gmail[0]?.link, "https://mail.google.com/mail/u/0/#all/t9");
  assert.equal(gmail[0]?.date, "2026-10-01T14:00:00.000Z");
  const outlook = emailsIn(
    {
      value: [
        {
          id: "AAMk1",
          subject: "Lunch?",
          from: { emailAddress: { name: "Lee", address: "lee@example.com" } },
          toRecipients: [{ emailAddress: { address: "me@example.com" } }],
          body: { contentType: "html", content: "<p>Free at <b>noon</b>?</p><br>Lee &amp; co" },
          receivedDateTime: "2026-10-01T15:00:00Z",
          webLink: "https://outlook.office.com/mail/id/AAMk1",
        },
      ],
    },
    "outlook",
  );
  assert.equal(outlook[0]?.body, "Free at noon?\n\nLee & co");
  assert.equal(outlook[0]?.to, "me@example.com");
  assert.equal(outlook[0]?.link, "https://outlook.office.com/mail/id/AAMk1");
  // Not an email: nothing.
  assert.deepEqual(emailsIn({ labels: [{ id: "INBOX", name: "Inbox" }] }, "gmail"), []);
});

test("emails read are kept a week for their cards, each person's to themselves", async () => {
  const db = await createStore();
  let now = Date.parse("2026-10-01T12:00:00Z");
  const views = new EmailViews(db, () => now);
  const [card] = await views.save("owner", [
    {
      app: "gmail",
      messageId: "18f1",
      from: "Dan",
      subject: "Q3",
      body: "Line one\n\nline two",
    },
  ]);
  assert.equal(card?.preview, "Line one line two");
  assert.equal((await views.get("owner", card?.id ?? ""))?.body, "Line one\n\nline two");
  assert.equal(await views.get("someone-else", card?.id ?? ""), null);
  // Eight days later, saving another clears the old one away.
  now += 8 * 86_400_000;
  await views.save("owner", [
    { app: "gmail", messageId: "18f2", from: "Lee", subject: "Hi", body: "Hello" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await views.get("owner", card?.id ?? ""), null);
  await db.close();
});
