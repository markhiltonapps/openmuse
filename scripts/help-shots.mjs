// Takes the help guide's screenshots (packages/domain/src/help.ts) from a local build of the app
// with sample data, light and dark, with numbered marks matching each topic's steps. Run it again
// whenever a screen in the guide changes (see CLAUDE.md).
//
// Before running:
//   1. The sample API on port 8787 (no personal data):
//        WORKSPACE_MODE=sample DATA_DIR=<scratch>/data PORT=8787 \
//        ALLOWED_ORIGINS=http://127.0.0.1:8081 npx tsx apps/server/src/index.ts
//   2. A web build pointed at it, served on port 8081:
//        cd apps/mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:8787 \
//          npx expo export --platform web --clear --output-dir <scratch>/web
//        python3 -m http.server 8081 --bind 127.0.0.1 --directory <scratch>/web
//   3. node scripts/help-shots.mjs            (all shots)
//      node scripts/help-shots.mjs home chat  (just these)
// Chromium comes from Playwright; set CHROMIUM_PATH to use another one. Python 3 with Pillow
// turns the pictures into WebP.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../apps/worker/node_modules/playwright/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/mobile/public/help/shots");
const SIZES = join(ROOT, "apps/mobile/src/help-shots.ts");
const APP = process.env.HELP_SHOTS_APP ?? "http://127.0.0.1:8081/";
const PORTHOLE = join(ROOT, "apps/mobile/public/home/neddy-wave-porthole.webp");
const WIDTH = 390;
const HEIGHT = 844;
/** The pictures are shown at most 360px wide: twice that for sharp phone screens. */
const PICTURE_WIDTH = 720;

// A live call without a microphone or OpenAI: a fake WebRTC whose data channel the script talks
// through (window.__channel.emit).
const fakeCall = () => {
  navigator.mediaDevices.getUserMedia = async () =>
    new AudioContext().createMediaStreamDestination().stream;
  class Channel {
    readyState = "open";
    onmessage = null;
    send() {}
    emit(event) {
      this.onmessage?.({ data: JSON.stringify(event) });
    }
  }
  window.RTCPeerConnection = class {
    connectionState = "connected";
    addTrack() {}
    createDataChannel() {
      this.channel = new Channel();
      window.__channel = this.channel;
      return this.channel;
    }
    async createOffer() {
      return { type: "offer", sdp: "v=0" };
    }
    async setLocalDescription() {}
    async setRemoteDescription() {
      setTimeout(() => this.channel.emit({ type: "session.started" }), 200);
    }
    close() {}
  };
};

const weather = () => {
  const day = (n) => {
    const d = new Date(Date.now() + n * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  return {
    weather: {
      place: "Austin, Texas",
      timeZone: "America/Chicago",
      now: { temp: 78, feelsLike: 80, sky: "Mostly sunny", emoji: "🌤️" },
      today: { high: 84, low: 66, rain: 10 },
      hours: [],
      days: [0, 1, 2, 3, 4, 5, 6].map((n) => ({
        date: day(n),
        high: 84 - n,
        low: 66,
        sky: "Mostly sunny",
        emoji: "🌤️",
      })),
      alerts: [],
      updatedAt: new Date().toISOString(),
    },
  };
};

/** A fresh page, signed in to the sample workspace, with the network the screens need. */
async function open(context, state, height = HEIGHT, backdrop = "none", start = "chat") {
  const page = await context.newPage();
  await page.setViewportSize({ width: WIDTH, height });
  page.on("pageerror", (error) => console.warn(`  page error: ${error.message}`));
  await page.addInitScript(fakeCall);
  // The pictures show each screen on the plain page, light and dark; only the Backdrop topic's
  // shows a scene (its still frame: this Chromium can't play the clips).
  await page.addInitScript((scene) => localStorage.setItem("openmuse.backdrop", scene), backdrop);
  await page.route(/\/api\/backdrop$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { scene: backdrop, still: false } })
      : route.fallback(),
  );
  await page.route(/\/api\/avatar-media\//, (route) =>
    /poster/.test(route.request().url())
      ? route.fulfill({ path: PORTHOLE, contentType: "image/webp" })
      : route.fulfill({ status: 404, body: "" }),
  );
  // Everyone sees these pictures: what the agent knows about "you" uses a made-up name, whatever
  // the sample server was given while testing.
  await page.route(/\/api\/persona$/, async (route) => {
    const real = await (await route.fetch()).json();
    const named = (fact) =>
      /call you|name/i.test(`${fact.key ?? ""} ${fact.label ?? ""}`)
        ? { ...fact, value: "Sam" }
        : fact;
    await route.fulfill({ json: { ...real, facts: (real.facts ?? []).map(named) } });
  });
  await page.route(/\/api\/copilotkit\/info/, async (route) => {
    const real = await (await route.fetch()).json();
    const { intelligence: _i, threadEndpoints: _t, ...rest } = real;
    await route.fulfill({ json: { ...rest, mode: "sse" } });
  });
  await page.route(/\/api\/workspace$/, async (route) => {
    const real = await (await route.fetch()).json();
    // The sample's approvals expired long ago; keep them waiting for the pictures.
    const later = new Date(Date.now() + 36e5).toISOString();
    state.actions = (real.actions ?? []).map((action) =>
      action.status === "awaiting_review" ? { ...action, expiresAt: later } : action,
    );
    await route.fulfill({
      json: {
        ...real,
        actions: state.actions,
        runtime: { ...real.runtime, richThreads: true },
      },
    });
  });
  // Chats as on the real app (CopilotKit's list): a few made-up ones, and a short made-up
  // exchange in the main chat.
  {
    const ago = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();
    const chat = (id, name, hours, archived = false) => ({
      id,
      agentId: "default",
      name,
      archived,
      createdAt: ago(hours + 5),
      updatedAt: ago(hours),
      lastRunAt: ago(hours),
    });
    const threads = [
      chat("t-plumber", "Plumber for the upstairs bath", 2),
      chat("t-car", "Car insurance renewal", 30),
      chat("t-kitchen", "Kitchen remodel quotes", 100),
      chat("t-denver", "Denver trip ideas", 300, true),
    ];
    await page.route(/\/api\/copilotkit\/threads/, (route) =>
      route.request().method() === "GET" && !/subscribe/.test(route.request().url())
        ? route.fulfill({ json: { threads, nextCursor: null } })
        : route.fulfill({ status: 404, json: {} }),
    );
    const exchange = [
      { id: "help-u1", role: "user", content: "What’s on my calendar today?" },
      {
        id: "help-a1",
        role: "assistant",
        content: "You have a dentist visit at 9:30 and lunch with Alex at noon.",
      },
    ];
    await page.route(/\/api\/copilotkit\/agent\/default\/connect$/, (route) => {
      const { threadId, runId } = JSON.parse(route.request().postData() || "{}");
      const events = [
        { type: "RUN_STARTED", threadId, runId },
        { type: "MESSAGES_SNAPSHOT", messages: threadId === "t-main" ? exchange : [] },
        { type: "RUN_FINISHED", threadId, runId },
      ];
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
      });
    });
    await page.route(/\/api\/main-thread$/, (route) =>
      route.fulfill({ json: { threadId: "t-main", existing: true } }),
    );
    await page.route(/\/api\/threads\/archive$/, (route) => route.fulfill({ json: [] }));
    await page.route(/\/api\/chats\/(known|name)$/, (route) =>
      route.fulfill({ json: { ok: true, named: {} } }),
    );
  }
  await page.route(/\/api\/weather/, (route) => route.fulfill({ json: weather() }));
  await page.route(/\/api\/voice\/live$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { available: true, minutesThisMonth: 12 } })
      : route.fulfill({ json: { sdp: "v=0", sessionId: "live_help" } }),
  );
  await page.route(/\/api\/voice\/live\/live_help\/details$/, (route) =>
    route.fulfill({ json: { details: state.details ?? [] } }),
  );
  await page.route(/\/api\/voice\/live\/live_help\/(view|end)$/, (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route(/\/api\/voice\/live\/recent$/, (route) =>
    route.fulfill({ json: { sessions: [] } }),
  );
  await page.goto(APP);
  await page.waitForTimeout(3500);
  // The app opens on Home; most pictures start from the chat.
  if (start === "chat") {
    await page.getByRole("tab", { name: "Chat", exact: true }).first().click();
    await page.waitForTimeout(1200);
  }
  return page;
}

// A tab's name can carry a count after a comma ("Activity, 2 need you").
const tab = (page, name) =>
  page.getByRole("tab", { name: new RegExp(`^${name}(,|$)`) }).first();
const button = (page, name) => page.getByRole("button", { name }).first();
const say = (page, event) => page.evaluate((e) => window.__channel?.emit(e), event);
async function startCall(page) {
  await button(page, /^Talk live with/).click();
  await page.waitForTimeout(1500);
  await say(page, {
    type: "session.output_transcript.delta",
    delta: "You have a dentist visit at 9:30 and lunch with Alex at noon.",
  });
  await page.waitForTimeout(800);
}
/** Scrolls the app's own page so `target` sits below the floating header. */
async function reveal(target, gap = 150) {
  await target.evaluate((node, gap) => {
    node.scrollIntoView({ block: "start" });
    let parent = node.parentElement;
    while (parent && parent.scrollHeight <= parent.clientHeight) parent = parent.parentElement;
    parent?.scrollBy(0, -gap);
  }, gap);
  await target.page().waitForTimeout(500);
}
/** Something saved for their OK during the call, as Neddy puts it on screen. */
async function showApproval(page, state) {
  const waiting = state.actions.find((action) => action.status === "awaiting_review");
  state.details = [
    {
      id: "help-d1",
      at: new Date().toISOString(),
      question: "Clear out the junk email from this week",
      title: "Junk email from this week",
      items: [
        {
          tool: "approval",
          result: {
            actionId: waiting?.id ?? "a1",
            title: waiting?.title ?? "Move 9 emails to the trash",
          },
        },
      ],
    },
  ];
  await say(page, { type: "session.delegation.created" });
  await say(page, { type: "session.commentary.appended" });
  await page.waitForTimeout(1800);
}
async function appsTab(page, name) {
  await tab(page, "Apps").click();
  await page.waitForTimeout(1200);
  await page.getByRole("tab", { name }).first().click();
  await page.waitForTimeout(1500);
}

/**
 * Each shot: the screen to show and the marks to put on it, numbered like the topic's steps
 * (a mark for each step that's on this screen). `clip` limits the picture to one part.
 */
const SHOTS = [
  {
    id: "greet",
    start: "home",
    marks: {
      1: (p) => p.getByText("Needs you", { exact: true }).first(),
      2: (p) => button(p, /^Today:/),
      3: (p) => button(p, /^Working on|^Give .* a job/),
      4: (p) => button(p, /^Talk to /),
    },
  },
  {
    id: "home",
    showNewJob: true,
    marks: {
      1: (p) => p.getByRole("button", { name: "Menu", exact: true }),
      2: {
        find: (p) => p.getByRole("button", { name: /^Neddy|^Open Neddy/ }).first(),
        also: (p) => p.locator("#chat-button"),
        side: "corner",
      },
      3: (p) => button(p, /^New job for/),
      4: (p) => p.getByRole("tablist", { name: "Sections" }),
    },
  },
  {
    id: "chats",
    go: async (p) => {
      await p.locator("#chat-button").click();
      await p.waitForTimeout(1500);
    },
    marks: {
      2: { find: (p) => button(p, "New chat"), side: "inside-right" },
      3: (p) => p.getByRole("button", { name: "Options for Car insurance renewal" }),
      4: (p) => p.getByRole("button", { name: "Hide other chats" }),
    },
  },
  {
    id: "chat",
    marks: {
      1: (p) => button(p, "Attach a document"),
      2: (p) => p.getByPlaceholder("Message…").first(),
      3: (p) => button(p, /^Talk live with/),
      4: (p) => button(p, "Send message"),
    },
  },
  {
    id: "call",
    go: startCall,
    marks: {
      3: (p) => button(p, /^Mute/),
      4: (p) => button(p, /^End/),
    },
  },
  {
    id: "callbar",
    go: async (p) => {
      await startCall(p);
      await button(p, "Shrink the call. It keeps going.").click();
      await p.waitForTimeout(700);
      await tab(p, "Feed").click();
      await p.waitForTimeout(1500);
    },
    marks: {
      2: (p) => p.getByRole("button", { name: /Go back to the call/ }).first(),
      3: (p) => button(p, /^Mute/),
    },
  },
  {
    id: "seeit",
    go: async (p, state) => {
      await startCall(p);
      await button(p, "Shrink the call. It keeps going.").click();
      await p.waitForTimeout(700);
      await showApproval(p, state);
    },
    marks: { 1: words((p) => p.getByText("See it", { exact: true }).first()) },
  },
  {
    id: "approve",
    go: async (p, state) => {
      await startCall(p);
      await showApproval(p, state);
    },
    marks: {
      1: (p) => p.getByRole("group", { name: /Needs your OK/ }).first(),
      2: (p) => p.getByRole("button", { name: /^See details/ }).first(),
      3: (p) => p.getByRole("button", { name: /^Approve/ }).first(),
    },
  },
  {
    id: "feed",
    go: async (p) => {
      await tab(p, "Feed").click();
      await p.waitForTimeout(2500);
    },
    marks: {
      1: (p) => p.getByPlaceholder(/Make me a feed about/).first(),
      2: (p) => p.getByRole("button", { name: /°|weather|Mostly sunny/i }).first(),
      3: words((p) => p.getByText(/on your calendar|Nothing else on your calendar/i).first()),
      4: { find: (p) => button(p, "Log a meal"), side: "left" },
    },
  },
  {
    id: "spaces",
    go: async (p) => {
      await tab(p, "Spaces").click();
      await p.waitForTimeout(2000);
    },
    marks: {
      2: (p) => p.getByRole("button", { name: /^Health/ }).first(),
      3: (p) => button(p, /^Start a/),
    },
  },
  {
    id: "health",
    go: async (p) => {
      await tab(p, "Spaces").click();
      await p.waitForTimeout(1500);
      await p.getByText("Health", { exact: true }).first().click();
      await p.waitForTimeout(2500);
    },
    marks: {
      2: (p) => p.getByRole("tab", { name: "Overview" }).first(),
      3: (p) => p.getByRole("tab", { name: "Food log" }).first(),
      4: (p) => p.getByRole("tab", { name: "Playbook" }).first(),
    },
  },
  {
    id: "weight",
    go: async (p) => {
      await tab(p, "Spaces").click();
      await p.waitForTimeout(1500);
      await p.getByText("Health", { exact: true }).first().click();
      await p.waitForTimeout(2500);
      await reveal(p.getByRole("heading", { name: "Weight", exact: true }), 160);
    },
    clip: (p) =>
      p
        .locator("div")
        .filter({ has: p.getByRole("heading", { name: "Weight", exact: true }) })
        .last(),
    marks: {
      1: words((p) => p.getByRole("heading", { name: "Weight", exact: true })),
      2: { find: (p) => p.getByLabel("Today’s weight (lb)"), side: "inside-right" },
      3: { find: (p) => p.getByRole("img", { name: /^Weight over/ }), side: "top-right" },
      4: (p) => p.getByRole("button", { name: /^Remove the weigh-in for/ }).first(),
    },
  },
  {
    id: "family",
    go: async (p) => {
      await tab(p, "Spaces").click();
      await p.waitForTimeout(1500);
      await p.getByText("Family", { exact: true }).first().click();
      await p.waitForTimeout(2500);
    },
    marks: {
      2: (p) => p.getByRole("tab", { name: "Overview" }).first(),
      4: (p) => p.getByRole("tab", { name: "Our weeks" }).first(),
    },
  },
  {
    id: "activity",
    height: 1150,
    go: async (p) => {
      await tab(p, "Activity").click();
      await p.waitForTimeout(2000);
    },
    marks: {
      1: (p) => tab(p, "Activity"),
      2: words((p) => p.getByText(/Waiting for your OK|Wait for your OK/).first()),
      3: words((p) => p.getByText(/Done ·/).first()),
      4: words((p) => p.getByText("Reviews & receipts").first()),
    },
  },
  {
    id: "newjob",
    showNewJob: true,
    go: async (p) => {
      await button(p, /^New job for/).click();
      await p.waitForTimeout(1500);
    },
    marks: {
      2: { find: (p) => p.getByLabel("What would you like done?").first(), side: "inside-right" },
      3: (p) => button(p, /^Start job/),
    },
  },
  {
    id: "job",
    go: async (p) => {
      await tab(p, "Activity").click();
      await p.waitForTimeout(1500);
      await p.getByText("Morning brief", { exact: true }).first().click();
      await p.waitForTimeout(2000);
    },
    marks: {
      3: words((p) => p.getByText(/^Done ·/).last()),
    },
  },
  {
    id: "apps",
    go: async (p) => {
      await tab(p, "Apps").click();
      await p.waitForTimeout(2000);
    },
    marks: {
      1: (p) => tab(p, "Apps"),
      2: { find: (p) => p.getByLabel("Search apps"), side: "inside-right" },
      3: words((p) => p.getByText("Gmail", { exact: true }).first()),
    },
  },
  {
    id: "about",
    height: 1300,
    go: (p) => appsTab(p, /About you/),
    marks: {
      2: words((p) => p.getByText("You", { exact: true }).first()),
      3: words((p) => p.getByText("What I call you", { exact: true }).first()),
      4: (p) => button(p, "Answer a few questions"),
    },
  },
  {
    id: "money",
    go: (p) => appsTab(p, /Money/),
    marks: {
      2: (p) => button(p, "Turn on purchases"),
    },
  },
  {
    id: "urgent",
    go: async (p) => {
      await appsTab(p, /Alerts/);
      await reveal(p.getByText("Urgent alerts on calls", { exact: true }).first());
    },
    marks: {
      2: (p) => p.getByRole("checkbox", { name: /^Time to leave/ }),
      3: { find: (p) => p.getByLabel(/^Add someone/).first(), side: "inside-right" },
    },
  },
  {
    id: "location",
    go: async (p) => {
      await appsTab(p, /Account/);
      await reveal(p.getByText("Your location", { exact: true }).first());
    },
    marks: {
      1: (p) => p.getByRole("checkbox", { name: /^Share where I am/ }),
    },
  },
  {
    id: "backdrop",
    // Tall enough to show every group down to No backdrop: marks never scroll.
    height: 2300,
    backdrop: "beach-sunset",
    go: async (p) => {
      await button(p, "Menu").click();
      await p.waitForTimeout(1200);
      await p.getByRole("button", { name: /^Backdrop/ }).click();
      await p.waitForTimeout(2500);
    },
    marks: {
      2: (p) => p.getByRole("radio", { name: "City lights" }),
      3: (p) => p.getByRole("checkbox", { name: /^Hold still/ }),
      4: (p) => p.getByRole("radio", { name: "No backdrop" }),
    },
  },
  {
    id: "models",
    height: 1300,
    go: async (p) => {
      // The admin's card: shown as on a server with OpenRouter set up.
      await p.route(/\/api\/me$/, async (route) => {
        const real = await (await route.fetch()).json();
        await route.fulfill({ json: { ...real, role: "admin" } });
      });
      const pick = (model, effort) => ({ model, effort });
      const sol = "openrouter/openai/gpt-6.1-sol";
      const flash = "openrouter/deepseek/deepseek-v4.1-flash";
      const row = (job, choice, serverModel) => ({
        job,
        choice,
        saved: false,
        recommended: choice,
        serverModel,
        using: choice.model,
        lastCall: { ok: true, at: new Date(Date.now() - 300_000).toISOString() },
      });
      await p.route(/\/api\/models$/, (route) =>
        route.fulfill({
          json: {
            ready: true,
            jobs: [
              row("chat", pick(sol, "high"), "anthropic/claude-sonnet-5"),
              row("background", pick(sol, "medium"), "anthropic/claude-haiku-4-5-20251001"),
              row("simple", pick(flash, "low"), "anthropic/claude-haiku-4-5-20251001"),
            ],
          },
        }),
      );
      await p.reload();
      await p.waitForTimeout(3500);
      await appsTab(p, /Money/);
      await reveal(p.getByText("AI models", { exact: true }).first());
    },
    marks: {
      2: (p) => button(p, "Change the model for Chat"),
      3: (p) => button(p, "Put everything back on Claude"),
    },
  },
  {
    id: "agent",
    height: 1640,
    go: (p) => appsTab(p, /Agent/),
    marks: {
      2: (p) => p.getByRole("radiogroup", { name: "Character" }),
      3: { find: (p) => p.getByLabel("Name"), side: "inside-right" },
      4: { find: (p) => button(p, "Save name and settings"), side: "inside-right" },
    },
  },
  {
    id: "files",
    go: async (p) => {
      await tab(p, "Files & media").click();
      await p.waitForTimeout(2000);
    },
    marks: {
      1: (p) => tab(p, "Files & media"),
      2: (p) => button(p, /^List/),
      3: words((p) => p.getByText(/^Saved by/).first()),
    },
  },
];

/**
 * A mark on words rather than a control: the ring fits the words themselves (not the whole row
 * they sit in) and the number goes beside them, so it never covers them.
 */
function words(find) {
  return { find, side: "left", tight: true };
}

/** The box around an element's words, or the element's own box. */
async function boxOf(locator, tight) {
  if (!tight) return locator.boundingBox({ timeout: 2000 });
  await locator.waitFor({ timeout: 2000 });
  return locator.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const { x, y, width, height } = range.getBoundingClientRect();
    return { x, y, width, height };
  });
}

/** Rings and numbered marks on the controls a topic's steps name. */
async function mark(page, marks) {
  const boxes = [];
  for (const [number, mark] of Object.entries(marks)) {
    const { find, side, tight, also } =
      typeof mark === "function" ? { find: mark, side: "corner", tight: false } : mark;
    try {
      // Never scrolls: each shot's own steps put the screen where it should be, and a scroll
      // here would move the marks already placed.
      let box = await boxOf(find(page), tight);
      // `also`: one ring around two things that belong together (the agent and the chat button).
      const other = also && box ? await boxOf(also(page), tight) : undefined;
      if (box && other) {
        const x = Math.min(box.x, other.x);
        const y = Math.min(box.y, other.y);
        box = {
          x,
          y,
          width: Math.max(box.x + box.width, other.x + other.width) - x,
          height: Math.max(box.y + box.height, other.y + other.height) - y,
        };
      }
      const height = page.viewportSize()?.height ?? HEIGHT;
      if (box && box.y + box.height > 0 && box.y < height) boxes.push({ number, side, ...box });
      else console.warn(`  mark ${number}: not on screen`);
    } catch (error) {
      console.warn(`  mark ${number}: ${error.message.split("\n")[0]}`);
    }
  }
  await page.evaluate((boxes) => {
    for (const node of document.querySelectorAll("[data-help-mark]")) node.remove();
    const width = window.innerWidth;
    for (const box of boxes) {
      const ring = document.createElement("div");
      ring.dataset.helpMark = "";
      Object.assign(ring.style, {
        position: "fixed",
        left: `${box.x - 4}px`,
        top: `${box.y - 4}px`,
        width: `${box.width + 8}px`,
        height: `${box.height + 8}px`,
        border: "2.5px solid #1473C8",
        borderRadius: "14px",
        boxShadow: "0 0 0 2px rgba(255,255,255,0.85)",
        zIndex: 2147483646,
        pointerEvents: "none",
      });
      const badge = document.createElement("div");
      badge.dataset.helpMark = "";
      badge.textContent = box.number;
      // Outside the ring's top-left corner (only the number's corner touches it); beside words
      // ("left", or after them when there's no room before); inside a box's empty right end
      // ("inside-right", for a field with its label just above); or off its top-right corner
      // ("top-right", when words sit at its top-left). Never over what it points at.
      const middle = box.y + box.height / 2 - 14;
      const [left, top] =
        box.side === "inside-right"
          ? [box.x + box.width - 36, middle]
          : box.side === "top-right"
            ? [box.x + box.width - 4, box.y - 28]
            : box.side === "left"
              ? [box.x > 40 ? box.x - 38 : box.x + box.width + 10, middle]
              : [box.x - 28, box.y - 28];
      Object.assign(badge.style, {
        position: "fixed",
        left: `${Math.min(Math.max(left, 2), width - 32)}px`,
        top: `${Math.max(top, 2)}px`,
        width: "28px",
        height: "28px",
        borderRadius: "14px",
        background: "#1473C8",
        color: "#FFFFFF",
        font: "800 15px/24px system-ui, sans-serif",
        textAlign: "center",
        border: "2px solid #FFFFFF",
        boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        zIndex: 2147483647,
        pointerEvents: "none",
      });
      document.body.append(ring, badge);
    }
  }, boxes);
}

function toWebp(png, file) {
  execFileSync("python3", [
    "-c",
    [
      "import sys",
      "from PIL import Image",
      "im = Image.open(sys.argv[1]).convert('RGB')",
      `w = ${PICTURE_WIDTH}`,
      "im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)",
      "im.save(sys.argv[2], 'WEBP', quality=74, method=6)",
      "print(im.width, im.height)",
    ].join("\n"),
    png,
    file,
  ]);
  const [width, height] = execFileSync("python3", [
    "-c",
    "import sys\nfrom PIL import Image\nprint(*Image.open(sys.argv[1]).size)",
    file,
  ])
    .toString()
    .trim()
    .split(" ")
    .map(Number);
  return { width, height };
}

const only = process.argv.slice(2);
const shots = only.length ? SHOTS.filter((shot) => only.includes(shot.id)) : SHOTS;
mkdirSync(OUT, { recursive: true });
const sizes = (() => {
  try {
    // One "  id: { width: 720, height: 1558 }," a line, as written below (not JSON).
    const text = readFileSync(SIZES, "utf8");
    return Object.fromEntries(
      [...text.matchAll(/^\s+([\w-]+): \{ width: (\d+), height: (\d+) \},$/gm)].map(
        ([, id, width, height]) => [id, { width: Number(width), height: Number(height) }],
      ),
    );
  } catch {
    return {};
  }
})();
const executablePath =
  process.env.CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch({ executablePath });
const failed = [];
for (const scheme of ["light", "dark"]) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    colorScheme: scheme,
  });
  for (const shot of shots) {
    console.log(`${shot.id} (${scheme})`);
    const state = {};
    const page = await open(context, state, shot.height, shot.backdrop, shot.start);
    try {
      await shot.go?.(page, state);
      // The floating New job button covers the bottom of most screens; only the shots about
      // it keep it.
      if (!shot.showNewJob)
        await page.evaluate(() => {
          for (const node of document.querySelectorAll('[aria-label="New job"]'))
            node.style.visibility = "hidden";
        });
      await mark(page, shot.marks ?? {});
      await page.waitForTimeout(300);
      const png = join(tmpdir(), `help-${shot.id}-${scheme}.png`);
      // A clipped picture takes in the numbers too, which can sit just outside what it shows.
      const part = shot.clip ? await shot.clip(page).boundingBox() : undefined;
      const area =
        part &&
        (await page.evaluate((part) => {
          let [left, top, right, bottom] = [
            part.x,
            part.y,
            part.x + part.width,
            part.y + part.height,
          ];
          for (const node of document.querySelectorAll("[data-help-mark]")) {
            const box = node.getBoundingClientRect();
            [left, top] = [Math.min(left, box.left), Math.min(top, box.top)];
            [right, bottom] = [Math.max(right, box.right), Math.max(bottom, box.bottom)];
          }
          return { x: left, y: top, width: right - left, height: bottom - top };
        }, part));
      await page.screenshot({
        path: png,
        ...(area
          ? {
              clip: {
                x: Math.max(area.x - 12, 0),
                y: Math.max(area.y - 12, 0),
                width: Math.min(area.width + 24, WIDTH),
                height: Math.min(area.height + 24, page.viewportSize()?.height ?? HEIGHT),
              },
            }
          : {}),
      });
      sizes[shot.id] = toWebp(png, join(OUT, `${shot.id}-${scheme}.webp`));
    } catch (error) {
      console.warn(`  failed: ${error.message.split("\n")[0]}`);
      failed.push(`${shot.id} (${scheme})`);
    } finally {
      await page.close();
    }
  }
  await context.close();
}
await browser.close();
const sorted = Object.fromEntries(Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b)));
// One shot a line, as Biome formats it, so lint stays clean after a retake.
const lines = Object.entries(sorted).map(
  ([id, size]) => `  ${id}: { width: ${size.width}, height: ${size.height} },`,
);
writeFileSync(
  SIZES,
  `// Written by scripts/help-shots.mjs: each help screenshot's size, for its shape on the page.\nexport const HELP_SHOTS: Record<string, { width: number; height: number }> = {\n${lines.join("\n")}\n};\n`,
);
console.log(failed.length ? `Failed: ${failed.join(", ")}` : "All shots taken.");
