import assert from "node:assert/strict";
import { test } from "node:test";
import { jobEmail, plainLines } from "../apps/server/src/job-email.ts";

test("a finished job's email says it's done, shows the summary and opens the job", () => {
  const email = jobEmail({
    outcome: "done",
    title: "Compare the three best-reviewed robot vacuums on amazon.com",
    body: "**Top pick:** the Roborock Q5 — 4.4★ from 12,000 reviews.\n\n- [Roborock Q5](https://www.amazon.com/dp/B0) $199",
    agentName: "Neddy",
    appUrl: "https://muse.example.com/",
    taskId: "task 1",
    files: ["Robot vacuums.pdf"],
  });
  assert.equal(email.subject, "Done: Compare the three best-reviewed robot vacuums on amazon.com");
  assert.match(email.text, /Top pick: the Roborock Q5/);
  assert.match(email.text, /• Roborock Q5 \(https:\/\/www\.amazon\.com\/dp\/B0\) \$199/);
  assert.match(email.text, /Open in Neato_Muse: https:\/\/muse\.example\.com\/\?task=task%201/);
  assert.match(email.html, /I saved Robot vacuums\.pdf in your Files\./);
  assert.match(email.html, /href="https:\/\/muse\.example\.com\/\?task=task%201"/);
  assert.doesNotMatch(email.html, /\*\*/);
  // In the HTML, links are links and bold is bold.
  assert.match(email.html, /<a href="https:\/\/www\.amazon\.com\/dp\/B0"[^>]*>Roborock Q5<\/a>/);
  assert.match(email.html, /<b>Top pick:<\/b>/);
});

test("a question or a failure says so, and long summaries are cut with a pointer to the app", () => {
  const question = jobEmail({
    outcome: "question",
    title: "Check my order",
    body: "Which site did you order from?",
    agentName: "AI Todd",
    appUrl: "https://muse.example.com",
    taskId: "t",
  });
  assert.equal(question.subject, "AI Todd needs your answer: Check my order");
  assert.match(question.html, /Answer in Neato_Muse/);
  assert.match(question.text, /Replies to this email don’t reach me/);
  const failed = jobEmail({
    outcome: "failed",
    title: "x".repeat(90),
    body: "Line. ".repeat(400),
    agentName: "Neddy",
    appUrl: "https://muse.example.com",
    taskId: "t",
  });
  assert.equal(failed.subject, `Couldn’t finish: ${"x".repeat(69)}…`);
  // A failure never emails the raw error, only what to do next.
  assert.doesNotMatch(failed.text, /Line\./);
  assert.match(failed.text, /You can ask me to try again from the app\./);
  const long = jobEmail({
    outcome: "done",
    title: "Long",
    body: "Line. ".repeat(400),
    agentName: "Neddy",
    appUrl: "https://muse.example.com",
    taskId: "t",
  });
  assert.match(long.text, /There’s more in the app\./);
  assert.ok(long.text.length < 1500);
  // Nothing from the job is taken as HTML.
  const unsafe = jobEmail({
    outcome: "done",
    title: "<b>t</b>",
    body: "<script>alert(1)</script>",
    agentName: "Neddy",
    appUrl: "https://muse.example.com",
    taskId: "t",
  });
  assert.doesNotMatch(unsafe.html, /<script>/);
  assert.match(unsafe.html, /&lt;script&gt;/);
});

test("Markdown is flattened to plain lines", () => {
  assert.equal(
    plainLines("# Title\n\n- **one**\n* two\n\n\n\nend"),
    "Title\n\n• one\n• two\n\nend",
  );
});
