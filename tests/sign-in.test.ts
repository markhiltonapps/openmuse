import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { BrowserService, PageElement, PageStep } from "../apps/server/src/browser.ts";
import { browserToolSpecs } from "../apps/server/src/browser-tools.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { authenticatorFrom, Logins, sameSite, siteOf, totp } from "../apps/server/src/sign-in.ts";
import { runApprovedSignIn, signInToolSpecs } from "../apps/server/src/sign-in-tools.ts";
import type { BrowserSignIn } from "../packages/domain/src/index.ts";

const KEY = randomBytes(32).toString("base64");
const SESSION = "11111111-1111-4111-8111-111111111111";

test("one-time codes match the standard's test values", () => {
  // RFC 6238: the ASCII key "12345678901234567890".
  const auth = authenticatorFrom("GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ");
  assert.equal(totp(auth, 59_000), "287082");
  assert.equal(totp(auth, 1_111_111_109_000), "081804");
  const eight = authenticatorFrom(
    "otpauth://totp/Example:me?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8&issuer=Example",
  );
  assert.equal(totp(eight, 59_000), "94287082");
  assert.throws(() => authenticatorFrom("not a key!"), /doesn’t look right/);
  assert.throws(
    () => authenticatorFrom("otpauth://hotp/x?secret=GEZDGNBVGY3TQOJQ"),
    /isn’t supported/,
  );
});

test("a saved password is only for its own site", () => {
  assert.equal(siteOf("https://www.Amazon.com/ap/signin?x=1"), "amazon.com");
  assert.equal(siteOf("chase.com"), "chase.com");
  assert.throws(() => siteOf("not a site"), /doesn’t look like a website/);
  assert.equal(sameSite("https://www.amazon.com/ap/signin", "amazon.com"), true);
  assert.equal(sameSite("https://signin.aws.amazon.com/", "amazon.com"), true);
  assert.equal(sameSite("https://amazon.com.evil.example/", "amazon.com"), false);
  assert.equal(sameSite("https://evilamazon.com/", "amazon.com"), false);
  assert.equal(sameSite("http://amazon.com/", "amazon.com"), false, "never over plain http");
});

test("passwords are stored encrypted and never listed", async () => {
  const db = await createStore();
  const logins = new Logins(db, KEY);
  const saved = await logins.save("owner", {
    site: "www.bistro.example.com",
    username: "mark@example.com",
    password: "correct horse battery",
  });
  assert.deepEqual(Object.keys(saved).sort(), [
    "askFirst",
    "createdAt",
    "hasAuthenticator",
    "id",
    "replaced",
    "site",
    "username",
  ]);
  assert.equal(saved.replaced, false);
  assert.equal(saved.askFirst, true, "asks before each use unless turned off");
  const raw = JSON.stringify(await db.list("owner", "logins"));
  assert.doesNotMatch(raw, /correct horse/);
  assert.doesNotMatch(JSON.stringify(await logins.list("owner")), /correct horse|secret/);
  assert.equal(
    await logins.password("owner", saved.id, "https://bistro.example.com/login"),
    "correct horse battery",
  );
  await assert.rejects(
    logins.password("owner", saved.id, "https://bistro-example.com/login"),
    /only typed on the site they were saved for/,
  );
  // Someone else can't use it.
  await assert.rejects(
    logins.password("other", saved.id, "https://bistro.example.com/"),
    /deleted/,
  );
  // Saving the same site and username again replaces it.
  const again = await logins.save("owner", {
    site: "bistro.example.com",
    username: "MARK@example.com",
    password: "new one",
    askFirst: false,
  });
  assert.equal(again.id, saved.id);
  assert.equal(again.replaced, true);
  assert.equal((await logins.list("owner")).length, 1);
  await logins.remove("owner", saved.id);
  assert.deepEqual(await logins.list("owner"), []);
  await assert.rejects(new Logins(db, undefined).save("owner", {}), /encryption/);
});

function fakeBrowser(pages: { url: string; title: string; elements: PageElement[] }[]) {
  let current = 0;
  const acted: PageStep[] = [];
  const browser = {
    threadSession: async () => ({ id: SESSION }),
    elements: async () => pages[current],
    read: async () => ({ text: `Hello ${acted.map((a) => a.value).join(" ")}`, truncated: false }),
    act: async (_owner: string, _id: string, step: PageStep) => {
      acted.push(step);
      if (step.action !== "fill") current = Math.min(current + 1, pages.length - 1);
      return { title: pages[current]?.title ?? "" };
    },
  } as unknown as BrowserService;
  return { browser, acted };
}

const loginPage = {
  url: "https://bistro.example.com/login",
  title: "Sign in",
  elements: [
    { ref: "e1", role: "textbox", name: "Search" },
    { ref: "e2", role: "textbox", name: "Email address" },
    { ref: "e3", role: "password", name: "Password", value: "" },
    { ref: "e4", role: "button", name: "Sign in" },
  ],
};
const home = { url: "https://bistro.example.com/account", title: "Your account", elements: [] };

type Tool = { execute: (a: unknown) => Promise<Record<string, unknown>> };

test("the agent signs in without ever seeing the password", async () => {
  const db = await createStore();
  const logins = new Logins(db, KEY);
  const saved = await logins.save("owner", {
    site: "bistro.example.com",
    username: "mark@example.com",
    password: "s3cret-pass",
  });
  const proposals: BrowserSignIn[] = [];
  const propose = async (step: BrowserSignIn) => {
    proposals.push(step);
    return { id: "approval-1" };
  };
  const asking = fakeBrowser([loginPage, home]);
  const [signIn] = signInToolSpecs(
    asking.browser,
    logins,
    "owner",
    "t",
    propose,
  ) as unknown as Tool[];
  const waiting = await signIn?.execute({ why: "Check my booking" });
  assert.equal(waiting?.needsApproval, true);
  assert.equal(asking.acted.length, 0, "nothing typed before the person says OK");
  assert.equal(proposals[0]?.username, "mark@example.com");
  assert.doesNotMatch(JSON.stringify(proposals), /s3cret/);
  // Approved: the server types it in.
  const done = await runApprovedSignIn(
    asking.browser,
    logins,
    "owner",
    proposals[0] as BrowserSignIn,
  );
  assert.match(done, /Signed in to bistro\.example\.com as mark@example\.com/);
  assert.deepEqual(asking.acted, [
    { ref: "e2", action: "fill", value: "mark@example.com" },
    { ref: "e3", action: "fill", value: "s3cret-pass" },
    { ref: "e3", action: "press", value: "Enter" },
  ]);
  assert.doesNotMatch(done, /s3cret/);

  // Asking turned off: it signs in straight away, and the page it reads back hides the password.
  await logins.change("owner", saved.id, { askFirst: false });
  const direct = fakeBrowser([loginPage, home]);
  const [now] = signInToolSpecs(direct.browser, logins, "owner", "t", propose) as unknown as Tool[];
  const result = await now?.execute({ why: "Check my booking" });
  assert.match(String(result?.done), /Signed in/);
  assert.doesNotMatch(JSON.stringify(result), /s3cret/);
  assert.match(JSON.stringify(result), /Hello mark@example\.com ••••/);

  // A look-alike site gets nothing.
  const fake = fakeBrowser([{ ...loginPage, url: "https://bistro-example.com/login" }]);
  const [lookAlike] = signInToolSpecs(
    fake.browser,
    logins,
    "owner",
    "t",
    propose,
  ) as unknown as Tool[];
  assert.match(String((await lookAlike?.execute({ why: "Sign in" }))?.error), /No saved password/);
  await assert.rejects(
    runApprovedSignIn(fake.browser, logins, "owner", {
      ...(proposals[0] as BrowserSignIn),
      url: "https://bistro-example.com/login",
    }),
    /Saved passwords are only typed on the site they were saved for/,
  );
  assert.equal(fake.acted.length, 0);
});

test("two-step sign-in: the username first, then the password page", async () => {
  const db = await createStore();
  const logins = new Logins(db, KEY);
  const saved = await logins.save("owner", {
    site: "mail.example.org",
    username: "mark",
    password: "pw-12345",
    askFirst: false,
  });
  const first = {
    url: "https://mail.example.org/signin",
    title: "Sign in",
    elements: [
      { ref: "e1", role: "button", name: "Sign in with Google" },
      { ref: "e2", role: "textbox", name: "Username" },
      { ref: "e3", role: "button", name: "Next" },
    ],
  };
  const second = {
    url: "https://mail.example.org/signin/password",
    title: "Enter your password",
    elements: [{ ref: "e1", role: "password", name: "Password" }],
  };
  const { browser, acted } = fakeBrowser([first, second, home]);
  const [signIn] = signInToolSpecs(browser, logins, "owner", "t", async () => ({
    id: "x",
  })) as unknown as Tool[];
  await signIn?.execute({ why: "Read my mail" });
  assert.deepEqual(acted, [
    { ref: "e2", action: "fill", value: "mark" },
    { ref: "e3", action: "click" },
    { ref: "e1", action: "fill", value: "pw-12345" },
    { ref: "e1", action: "press", value: "Enter" },
  ]);
  assert.ok((await logins.get("owner", saved.id))?.lastUsedAt);
});

test("a verification code goes from the person's app straight into the page", async () => {
  const db = await createStore();
  const logins = new Logins(db, KEY);
  const codePage = {
    url: "https://bank.example.com/verify",
    title: "Verify it's you",
    elements: [
      { ref: "e1", role: "textbox", name: "6-digit code" },
      { ref: "e2", role: "button", name: "Verify" },
    ],
  };
  const { browser, acted } = fakeBrowser([codePage, home]);
  const proposals: BrowserSignIn[] = [];
  const [, enterCode] = signInToolSpecs(browser, logins, "owner", "t", async (step) => {
    proposals.push(step);
    return { id: "approval-2" };
  }) as unknown as Tool[];
  // The agent looks first, like any page step.
  const [look] = browserToolSpecs(browser, "owner", "t", async () => ({
    id: "x",
  })) as unknown as Tool[];
  await look?.execute({});
  const waiting = await enterCode?.execute({ ref: "e1", why: "Finish signing in" });
  assert.equal(waiting?.needsApproval, true);
  assert.match(String(waiting?.next), /type the code .* not in chat/);
  const step = proposals[0] as BrowserSignIn;
  assert.equal(step.step, "code");
  await assert.rejects(
    runApprovedSignIn(browser, logins, "owner", step),
    /That code doesn’t look right/,
  );
  assert.match(
    await runApprovedSignIn(browser, logins, "owner", step, "482 913"),
    /Entered the code/,
  );
  assert.deepEqual(acted, [
    { ref: "e1", action: "fill", value: "482913" },
    { ref: "e1", action: "press", value: "Enter" },
  ]);
});

test("a saved authenticator key makes the code itself", async () => {
  const db = await createStore();
  const logins = new Logins(db, KEY, () => 59_000);
  await logins.save("owner", {
    site: "bank.example.com",
    username: "mark",
    password: "pw",
    authenticator: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    askFirst: false,
  });
  // Saving the password again doesn't lose the authenticator key.
  const again = await logins.save("owner", {
    site: "bank.example.com",
    username: "mark",
    password: "pw2",
    askFirst: false,
  });
  assert.equal(again.hasAuthenticator, true);
  const codePage = {
    url: "https://bank.example.com/verify",
    title: "Verify",
    elements: [{ ref: "e1", role: "textbox", name: "Authenticator code" }],
  };
  const { browser, acted } = fakeBrowser([codePage, home]);
  const tools = signInToolSpecs(browser, logins, "owner", "t", async () => ({
    id: "x",
  })) as unknown as Tool[];
  const [look] = browserToolSpecs(browser, "owner", "t", async () => ({
    id: "x",
  })) as unknown as Tool[];
  await look?.execute({});
  const result = await tools[1]?.execute({ ref: "e1", why: "Finish signing in" });
  assert.match(String(result?.done), /Entered the code/);
  assert.deepEqual(acted[0], { ref: "e1", action: "fill", value: "287082" });
  assert.doesNotMatch(JSON.stringify(result), /287082/, "the agent doesn't see the code");
});

test("approving a code step needs the code, and it's never stored", async () => {
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-signin-"));
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
    encryptionKey: KEY,
  };
  const server = await createApp(db, config);
  try {
    const signIn = await server.app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const { token } = (await signIn.json()) as { token: string };
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const saved = await server.app.request("/api/logins", {
      method: "POST",
      headers,
      body: JSON.stringify({ site: "bank.example.com", username: "mark", password: "hunter22" }),
    });
    assert.equal(saved.status, 201);
    const listed = await (await server.app.request("/api/logins", { headers })).text();
    assert.match(listed, /"available":true/);
    assert.doesNotMatch(listed, /hunter22/);
    const proposal = await server.actions.propose("local-user", {
      kind: "browser.signin",
      data: {
        sessionId: SESSION,
        url: "https://bank.example.com/verify",
        site: "bank.example.com",
        pageTitle: "Verify",
        step: "code",
        ref: "e1",
        element: "Code",
        summary: "Enter the verification code on bank.example.com",
      },
    });
    const decide = (body: object) =>
      server.app.request(`/api/actions/${proposal.id}/decide`, {
        method: "POST",
        headers,
        body: JSON.stringify({ hash: proposal.hash, decision: "approve", ...body }),
      });
    const missing = await decide({});
    assert.equal(missing.status, 400);
    assert.match(await missing.text(), /That code doesn’t look right/);
    const still = (await db.get("local-user", "actions", proposal.id)) as { status: string };
    assert.equal(still.status, "awaiting_review", "a missing code doesn't use up the approval");
    // With the code it runs (and fails here only because sample mode has no browser).
    const ran = (await (await decide({ code: "123456" })).json()) as { status: string };
    assert.notEqual(ran.status, "awaiting_review");
    assert.doesNotMatch(JSON.stringify(await db.list("local-user", "actions")), /123456/);
  } finally {
    await server.agent.stop();
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
