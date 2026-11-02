import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clock,
  missedLength,
  speakerName,
  spokenLength,
  transcriptFileName,
  transcriptText,
} from "../src/meeting-text.ts";

const meeting = {
  title: "Kitchen remodel kickoff",
  summary: "They agreed the budget\nand a start date.",
  decisions: ["Start on March 3", "Budget capped at $38,000"],
  actionItems: [
    { text: "Send the press kit", who: "Dana", due: "Friday" },
    { text: "Book the venue" },
  ],
  speakers: { "1": "Sarah" },
  segments: [
    { speaker: "1", start: 0, end: 2000, text: "I’m Sarah.  Let’s plan the launch." },
    { speaker: "2", start: 3000, end: 5000, text: "November works." },
    { speaker: "2:1", start: 600_500, end: 603_000, text: "Dana sends the press kit." },
    { speaker: "1", start: 3_725_000, end: 3_728_000, text: "Thanks, everyone." },
  ],
  gaps: [{ at: 600_000, seconds: 180 }],
};

test("the shared words about time and who said what are what the screen says", () => {
  assert.equal(clock(65), "1:05");
  assert.equal(clock(3725), "1:02:05");
  assert.equal(spokenLength(60), "1 minute");
  assert.equal(spokenLength(3900), "1 hour 5 minutes");
  assert.equal(missedLength(40), "40 seconds");
  assert.equal(missedLength(180), "about 3 minutes");
  assert.equal(speakerName({ "1": "Sarah" }, "1"), "Sarah");
  assert.equal(speakerName({}, "2"), "Speaker 2");
  assert.equal(speakerName({}, "2:1"), "Speaker 1 (after pause)");
  assert.equal(speakerName({}, "3:1"), "Speaker 1 (after pause 2)");
  assert.equal(speakerName({ "2:1": " Dana " }, "2:1"), "Dana");
});

test("the transcript file has the notes, then every word with who and when, and the pauses", () => {
  const text = transcriptText(meeting, "Sun, Nov 1 · 2:08 PM · 48 min");
  assert.equal(
    text,
    [
      "Kitchen remodel kickoff",
      "Sun, Nov 1 · 2:08 PM · 48 min",
      "",
      "SUMMARY",
      "They agreed the budget and a start date.",
      "",
      "DECISIONS",
      "- Start on March 3",
      "- Budget capped at $38,000",
      "",
      "ACTION ITEMS",
      "- Dana: Send the press kit (due Friday)",
      "- Book the venue",
      "",
      "EVERY WORD",
      "[0:00] Sarah: I’m Sarah. Let’s plan the launch.",
      "[0:03] Speaker 2: November works.",
      "--- Paused: about 3 minutes not recorded ---",
      "[10:00] Speaker 1 (after pause): Dana sends the press kit.",
      "[1:02:05] Sarah: Thanks, everyone.",
      "",
    ].join("\n"),
  );
});

test("sections with nothing in them are left out, and a nameless meeting still has a title", () => {
  const text = transcriptText(
    {
      title: "  ",
      decisions: [],
      actionItems: [],
      speakers: {},
      segments: [{ speaker: "1", start: 1500, end: 2500, text: "Hello." }],
    },
    "Mon · 9:00 AM · 1 min",
  );
  assert.equal(
    text,
    ["Meeting", "Mon · 9:00 AM · 1 min", "", "EVERY WORD", "[0:01] Speaker 1: Hello.", ""].join(
      "\n",
    ),
  );
  assert.ok(!text.includes("SUMMARY") && !text.includes("DECISIONS") && !text.includes("ACTION"));
});

test("a pause before the first words is marked, and one after the last turn is not", () => {
  const text = transcriptText(
    {
      title: "Call",
      decisions: [],
      actionItems: [],
      speakers: {},
      segments: [{ speaker: "1", start: 10_000, end: 11_000, text: "Back." }],
      gaps: [
        { at: 5000, seconds: 40 },
        { at: 99_000, seconds: 60 },
      ],
    },
    "x",
  );
  assert.match(text, /--- Paused: 40 seconds not recorded ---\n\[0:10\] Speaker 1: Back\./);
  assert.ok(!text.includes("1 minute not recorded"));
});

test("the file is named after the meeting without what phones and computers refuse", () => {
  assert.equal(transcriptFileName("Kickoff: Q4 / plan?"), "Kickoff Q4 plan transcript.txt");
  assert.equal(
    transcriptFileName('  "Budget" <review> | 2026...  '),
    "Budget review 2026 transcript.txt",
  );
  assert.equal(transcriptFileName("Standup\u0000\u001f"), "Standup transcript.txt");
  assert.equal(transcriptFileName("???"), "Meeting transcript.txt");
  assert.ok(transcriptFileName("é".repeat(200)).length <= 80 + " transcript.txt".length);
});
