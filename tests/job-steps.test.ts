import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ActionService } from "../apps/server/src/actions.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  appActionKey,
  findDone,
  rememberStep,
  stepIdentity,
} from "../apps/server/src/engine/job-steps.ts";
import { readLastWords } from "../apps/server/src/engine/job-words.ts";
import { appToConnect, asksToConnect, connectLink } from "../packages/domain/src/app-names.ts";

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close?.();
});

const sheet = (rows: string) => ({
  file_name: "Wearable Glasses Vendor Pipeline",
  mime_type: "application/vnd.google-apps.spreadsheet",
  text_content: `Vendor Name\tContact\tCurrent Status\n${rows}`.padEnd(400, " "),
});

test("the same step written again (other contents, other summary) is found as done", () => {
  const first = sheet("YuanFeng Tech\t\tActive Engagement");
  const again = sheet("YuanFeng Tech\t—\tActive engagement (SDK)");
  assert.equal(
    stepIdentity("googledrive", "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT", first),
    stepIdentity("googledrive", "googledrive_create_file_from_text", again),
  );
  const state = rememberStep(
    {},
    {
      app: "googledrive",
      tool: "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT",
      title: "Create a Google Drive spreadsheet",
      args: first,
      result: { id: "f1", webViewLink: "https://docs.google.com/spreadsheets/d/f1" },
    },
  );
  const done = findDone(state, "googledrive", "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT", again);
  assert.ok(done);
  assert.match(done.result ?? "", /f1/);
  // A different file, recipient or time is a different step.
  assert.equal(
    findDone(state, "googledrive", "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT", {
      ...again,
      file_name: "Another tracker",
    }),
    undefined,
  );
  // Remembering it again keeps one entry.
  const twice = rememberStep(state, {
    app: "googledrive",
    tool: "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT",
    title: "Create a Google Drive spreadsheet",
    args: again,
  });
  assert.equal((twice.done as unknown[]).length, 1);
});

test("a review's key leaves out the agent's own summary", () => {
  const args = { file_name: "Tracker" };
  assert.equal(
    appActionKey({
      app: "googledrive",
      tool: "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT",
      arguments: args,
    }),
    appActionKey({
      app: "GoogleDrive",
      tool: "googledrive_create_file_from_text",
      arguments: args,
      summary: "Reworded",
    } as never),
  );
});

test("asking to connect an app first is a question, never the job's result", () => {
  const words =
    "I need you to connect Google Sheets first. Please visit this link to authorize the connection:\n\n**https://connect.composio.dev/link/lk_abc**\n\nOnce you've connected Google Sheets, I'll create the spreadsheet.";
  assert.equal(asksToConnect(words), true);
  assert.equal(readLastWords(words).kind, "question");
  assert.equal(asksToConnect("Here's your vendor tracker: https://docs.google.com/x"), false);
  // The job page offers the link and names the app on its button.
  assert.equal(connectLink(words), "https://connect.composio.dev/link/lk_abc");
  assert.equal(appToConnect(words), "Google Sheets");
  assert.equal(connectLink("Connect Gmail first, under Apps."), undefined);
  assert.equal(appToConnect("Connect Gmail first, under Apps."), "Gmail");
});

test("approving with 'the rest of this job' lets that job's later steps in that app go ahead", async () => {
  const service = new ActionService(db, { execute: async () => "ok", connected: async () => true });
  const step = (ref: string) => ({
    kind: "app.action" as const,
    data: {
      app: "googledrive",
      tool: "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT",
      arguments: { ref },
      summary: "Create a file",
    },
  });
  const proposal = await service.propose("rest-user", step("a"), "job-1:a", "job-1");
  assert.equal(await service.jobAllows("rest-user", "job-1", "googledrive"), false);
  // A stale hash changes nothing.
  await service.allowRestOfJob("rest-user", proposal.id, "wrong");
  assert.equal(await service.jobAllows("rest-user", "job-1", "googledrive"), false);
  await service.allowRestOfJob("rest-user", proposal.id, proposal.hash);
  assert.equal(await service.jobAllows("rest-user", "job-1", "GoogleDrive"), true);
  // Only that job, only that app.
  assert.equal(await service.jobAllows("rest-user", "job-2", "googledrive"), false);
  assert.equal(await service.jobAllows("rest-user", "job-1", "gmail"), false);
  assert.deepEqual(await service.jobAllowances("rest-user", "job-1"), ["googledrive"]);
  // "Ask me each time" on the job's page undoes it.
  await service.stopJobAllowances("rest-user", "job-1");
  assert.equal(await service.jobAllows("rest-user", "job-1", "googledrive"), false);
});
