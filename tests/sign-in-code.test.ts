import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Mailer } from "../apps/server/src/accounts.ts";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";

test("a 6-digit code from the sign-in email signs in, once, with few guesses", async () => {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-code-"));
  const sent: { to: string; subject: string; text: string; html: string }[] = [];
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  const config: Config = {
    mode: "live",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    accessKey: "a-private-test-key-with-enough-characters",
    agentBackend: "model",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
    appUrl: "https://app.test",
    adminEmail: "boss@example.com",
    resendApiKey: "re_test",
    agentEmail: "muse@agent.test",
  };
  const server = await createApp(db, config, { mailer });
  const call = (path: string, body: unknown) =>
    server.app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const codeOf = (mail?: { subject: string }) =>
    /^(\d{6}) is your/.exec(mail?.subject ?? "")?.[1] ?? "";
  try {
    await call("/api/auth/request", { email: "boss@example.com" });
    const first = codeOf(sent[0]);
    assert.match(first, /^\d{6}$/, "the code leads the subject");
    assert.match(sent[0]?.html ?? "", /Type this code in Neato_Muse/);
    assert.match(sent[0]?.text ?? "", /#login=/, "the link is still there");
    // A newer email replaces the older code.
    await call("/api/auth/request", { email: "boss@example.com" });
    const code = codeOf(sent[1]);
    const wrong = code === "000000" ? "111111" : "000000";
    const bad = await call("/api/auth/code", { email: "boss@example.com", code: wrong });
    assert.equal(bad.status, 401);
    assert.match(await bad.text(), /isn’t right/);
    if (first !== code) {
      const old = await call("/api/auth/code", { email: "boss@example.com", code: first });
      assert.equal(old.status, 401, "only the newest code works");
    }
    const ok = await call("/api/auth/code", {
      email: "Boss@Example.com",
      code: `${code.slice(0, 3)} ${code.slice(3)}`,
    });
    assert.equal(ok.status, 200);
    const { token } = (await ok.json()) as { token: string };
    const me = await server.app.request("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(((await me.json()) as { id: string }).id, "local-user");
    const again = await call("/api/auth/code", { email: "boss@example.com", code });
    assert.equal(again.status, 401, "a code works once");
    // The link from the same email is used up with it.
    const link = /#login=([\w-]+)/.exec(sent[1]?.text ?? "")?.[1];
    assert.equal((await call("/api/auth/verify", { token: link })).status, 401);
    // Five wrong guesses and the code is gone, even the right one.
    await call("/api/auth/request", { email: "boss@example.com" });
    const next = codeOf(sent[2]);
    const guess = next === "222222" ? "333333" : "222222";
    for (let i = 0; i < 5; i++)
      await call("/api/auth/code", { email: "boss@example.com", code: guess });
    assert.equal(
      (await call("/api/auth/code", { email: "boss@example.com", code: next })).status,
      401,
    );
    // Invites keep their link only.
    assert.equal(
      sent.every((m) => !/invited/.test(m.subject)),
      true,
    );
  } finally {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
