import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { AgentInbox } from "../apps/server/src/inbound.ts";
import type { AgentTask } from "../packages/domain/src/agent.ts";
import type { ActionProposal } from "../packages/domain/src/index.ts";

const secret = `whsec_${Buffer.from("agent-email-test-secret").toString("base64")}`;
let db: Store, directory: string, server: Awaited<ReturnType<typeof createApp>>, config: Config;
before(async () => {
  db = await createStore();
  directory = await mkdtemp(join(tmpdir(), "openmuse-agent-email-"));
  config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
    resendApiKey: "re_test",
    resendWebhookSecret: secret,
    agentEmail: "muse@agent.test",
    agentEmailAllowedSenders: ["owner@example.com"],
  };
  server = await createApp(db, config);
});
after(async () => {
  await server.agent.stop();
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

async function pdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 200]).drawText(text, { x: 20, y: 150, size: 12, font });
  return doc.save();
}

test("PDFs emailed to the agent are saved to Files for it to read", async () => {
  const invoice = await pdf("Invoice total $120");
  const calls: { url: string; auth?: string }[] = [];
  const inbox = new AgentInbox(db, config, server.agent, server.accounts, (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const href = String(url);
    calls.push({ url: href, auth: (init?.headers as Record<string, string>)?.Authorization });
    if (href.endsWith("/attachments"))
      return Response.json({
        data: [
          {
            filename: "invoice.pdf",
            content_type: "application/pdf",
            size: invoice.length,
            download_url: "https://files.resend.test/invoice.pdf?sig=1",
          },
          { filename: "song.mp3", content_type: "audio/mpeg", size: 10 },
        ],
      });
    if (href.startsWith("https://files.resend.test/")) return new Response(Buffer.from(invoice));
    return Response.json({
      from: "owner@example.com",
      subject: "Pay this",
      text: "Please pay the attached invoice.",
      headers: {
        "Message-ID": "<abc123@mail.example.com>",
        "authentication-results": "dmarc=pass",
      },
    });
  }) as typeof fetch);
  const body = JSON.stringify({
    type: "email.received",
    data: {
      email_id: "em_invoice",
      from: "owner@example.com",
      to: ["muse@agent.test"],
      subject: "Pay this",
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`msg_invoice.${timestamp}.${body}`)
    .digest("base64");
  const result = await inbox.receive(body, {
    id: "msg_invoice",
    timestamp,
    signature: `v1,${signature}`,
  });
  assert.equal(result.status, "task");
  const files = await server.files.list("local-user");
  const saved = files.find((f) => f.name === "invoice.pdf");
  assert.ok(saved);
  assert.equal(saved.source, "Email from owner@example.com");
  const task = await db.get<AgentTask>("local-user", "tasks", result.taskId ?? "");
  assert.match(
    task?.prompt ?? "",
    new RegExp(`invoice\\.pdf \\(saved to Files, file ID ${saved.id}\\)`),
  );
  assert.match(task?.prompt ?? "", /song\.mp3 \(not opened/);
  assert.match(task?.prompt ?? "", /email_from_agent using inReplyTo <abc123@mail\.example\.com>/);
  // The API key goes only to Resend's API, never to the file download host.
  assert.equal(calls.find((c) => c.url.startsWith("https://files.resend.test/"))?.auth, undefined);
});

test("the agent's emails wait for approval and go out from its own address", async () => {
  const draft = {
    from: "muse@agent.test",
    to: ["friend@example.com"],
    subject: "Re: Pay this",
    body: "Paid, thanks!",
    inReplyTo: "<abc123@mail.example.com>",
  };
  // No Google connection is needed to prepare it.
  const proposal = (await server.actions.propose("local-user", {
    kind: "agent_email.send",
    data: draft,
  })) as ActionProposal;
  assert.equal(proposal.status, "awaiting_review");
  assert.match(proposal.title, /^Email friend@example\.com from your agent/);

  const sent: RequestInit[] = [];
  const inbox = new AgentInbox(db, config, server.agent, server.accounts, (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    sent.push(init ?? {});
    return Response.json({ id: "re_sent_1" });
  }) as typeof fetch);
  assert.match(
    await inbox.send("local-user", draft),
    /^Sent from muse@agent\.test to friend@example\.com/,
  );
  const request = JSON.parse(String(sent[0]?.body));
  assert.equal(request.from, "Neddy <muse@agent.test>");
  assert.deepEqual(request.headers, {
    "In-Reply-To": "<abc123@mail.example.com>",
    References: "<abc123@mail.example.com>",
  });
  await assert.rejects(
    inbox.send("local-user", { ...draft, from: "someone-else@agent.test" }),
    /address changed/,
  );
});
