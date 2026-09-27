import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserService, PageElement, PageStep } from "../apps/server/src/browser.ts";
import { browserToolSpecs, commits, runApprovedStep } from "../apps/server/src/browser-tools.ts";

function fakeBrowser(pages: { url: string; title: string; elements: PageElement[] }[]) {
  let current = 0;
  const acted: PageStep[] = [];
  const browser = {
    threadSession: async (_owner: string, threadId: string) =>
      threadId === "thread-1" ? { id: "11111111-1111-4111-8111-111111111111" } : undefined,
    elements: async () => pages[current],
    read: async () => ({ text: `Text of ${pages[current]?.title}`, truncated: false }),
    act: async (_owner: string, _id: string, step: PageStep) => {
      acted.push(step);
      current = Math.min(current + 1, pages.length - 1);
      return { title: pages[current]?.title ?? "" };
    },
  } as unknown as BrowserService;
  return { browser, acted };
}

const booking = {
  url: "https://www.example-bistro.com/book",
  title: "Book a table",
  elements: [
    { ref: "e1", role: "textbox", name: "Your name" },
    { ref: "e2", role: "select", name: "Party size", options: ["2", "4"] },
    { ref: "e3", role: "password", name: "Password" },
    { ref: "e4", role: "textbox", name: "Search the menu" },
    { ref: "e5", role: "button", name: "Reserve 7:15 PM" },
    { ref: "e6", role: "link", name: "See the menu" },
  ],
};

test("steps that commit to something need approval; getting there doesn't", () => {
  const el = (name: string, role = "button") => ({ ref: "e1", role, name });
  assert.equal(commits({ action: "click" }, el("Reserve 7:15 PM")), true);
  assert.equal(commits({ action: "click" }, el("Place your order")), true);
  assert.equal(commits({ action: "click" }, el("Cancel subscription")), true);
  assert.equal(commits({ action: "click" }, el("Send")), true);
  assert.equal(commits({ action: "click" }, el("See the menu", "link")), false);
  assert.equal(commits({ action: "click" }, el("Next")), false);
  assert.equal(commits({ action: "fill" }, el("Your name", "textbox")), false);
  assert.equal(commits({ action: "press", value: "Enter" }, el("Your name", "textbox")), true);
  assert.equal(commits({ action: "press", value: "Enter" }, el("Search", "textbox")), false);
});

test("the agent fills a form, and the final click waits for the person", async () => {
  const { browser, acted } = fakeBrowser([booking, booking]);
  const proposals: unknown[] = [];
  const [look, use] = browserToolSpecs(browser, "owner", "thread-1", async (step) => {
    proposals.push(step);
    return { id: "approval-1" };
  }) as unknown as { execute: (a: unknown) => Promise<Record<string, unknown>> }[];
  const page = await look?.execute({});
  assert.equal(((page?.elements ?? []) as PageElement[]).length, 6);
  await use?.execute({
    ref: "e1",
    action: "fill",
    value: "Mark",
    why: "Put my name on the booking",
  });
  assert.deepEqual(acted, [{ ref: "e1", action: "fill", value: "Mark" }]);
  const password = await use?.execute({ ref: "e3", action: "fill", value: "x", why: "Sign in" });
  assert.match(String(password?.error), /Passwords are never typed/);
  const card = await use?.execute({
    ref: "e1",
    action: "fill",
    value: "4242 4242 4242 4242",
    why: "Pay",
  });
  assert.match(String(card?.error), /Card numbers/);
  const booked = await use?.execute({
    ref: "e5",
    action: "click",
    why: "Book the 7:15 table for 4",
  });
  assert.equal(booked?.needsApproval, true);
  assert.equal(acted.length, 1, "the final click didn't run");
  assert.deepEqual(proposals[0], {
    sessionId: "11111111-1111-4111-8111-111111111111",
    url: "https://www.example-bistro.com/book",
    site: "example-bistro.com",
    pageTitle: "Book a table",
    ref: "e5",
    element: "Reserve 7:15 PM",
    action: "click",
    summary: "Book the 7:15 table for 4 (click “Reserve 7:15 PM” on example-bistro.com)",
  });
  const unknown = await use?.execute({ ref: "e99", action: "click", why: "Something" });
  assert.match(String(unknown?.error), /Look at the page first/);
  // Another chat has no page open.
  const [otherLook] = browserToolSpecs(browser, "owner", "thread-2", async () => ({
    id: "x",
  })) as unknown as {
    execute: (a: unknown) => Promise<unknown>;
  }[];
  await assert.rejects(otherLook?.execute({}) ?? Promise.resolve(), /browse_web first/);
});

test("an approved click runs only while the page still shows it", async () => {
  const step = {
    sessionId: "11111111-1111-4111-8111-111111111111",
    url: "https://www.example-bistro.com/book",
    site: "example-bistro.com",
    pageTitle: "Book a table",
    ref: "e5",
    element: "Reserve 7:15 PM",
    action: "click" as const,
    summary: "Book it",
  };
  // The page was re-listed since: the same button now has a different ref.
  const moved = {
    ...booking,
    elements: [{ ref: "e9", role: "button", name: "Reserve 7:15 PM" }],
  };
  const done = { url: booking.url, title: "You're booked!", elements: [] };
  const ok = fakeBrowser([moved, done]);
  assert.match(
    await runApprovedStep(ok.browser, "owner", step),
    /clicked “Reserve 7:15 PM”.*You're booked!/,
  );
  assert.deepEqual(ok.acted, [{ ref: "e9", action: "click" }]);
  const gone = fakeBrowser([
    { ...booking, elements: [{ ref: "e1", role: "button", name: "Reserve 8:30 PM" }] },
  ]);
  await assert.rejects(runApprovedStep(gone.browser, "owner", step), /isn't on the page anymore/);
  const elsewhere = fakeBrowser([{ ...moved, url: "https://evil.example/book" }]);
  await assert.rejects(
    runApprovedStep(elsewhere.browser, "owner", step),
    /no longer on example-bistro\.com/,
  );
  assert.equal(gone.acted.length + elsewhere.acted.length, 0);
});
