import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { MiniApps } from "../apps/server/src/mini-apps.ts";
import { buildWebsite, type RenderedPage } from "../apps/server/src/website/builder.ts";
import {
  BUILDS_PER_DAY,
  WebsiteBuilds,
  websiteToolSpecs,
} from "../apps/server/src/website/builds.ts";
import {
  checkSite,
  type Problem,
  pageText,
  renderProblems,
} from "../apps/server/src/website/checks.ts";
import {
  EXAMPLE_BODY,
  EXAMPLE_DESCRIPTION,
  EXAMPLE_STYLE,
  EXAMPLE_TITLE,
} from "../apps/server/src/website/example.ts";
import { assembleSite, contrast, ICON_NAMES, palette } from "../apps/server/src/website/kit.ts";
import { parseReply } from "../apps/server/src/website/prompt.ts";

const brief = readFileSync(new URL("./fixtures/maveric-brief.txt", import.meta.url), "utf8");
const example = {
  ...EXAMPLE_STYLE,
  title: EXAMPLE_TITLE,
  description: EXAMPLE_DESCRIPTION,
  body: EXAMPLE_BODY,
};
const reply = (parts: typeof example) =>
  `<<<META>>>\n${JSON.stringify({ title: parts.title, description: parts.description, accent: parts.accent, dark: parts.dark, headFont: parts.headFont, bodyFont: parts.bodyFont })}\n<<<BODY>>>\n${parts.body}\n<<<CSS>>>\n`;
const errors = (problems: Problem[]) =>
  problems.filter((p) => p.level === "error").map((p) => p.message);

let db: Store;
before(async () => {
  db = await createStore();
});
after(async () => {
  await db.close?.();
});

test("the kit makes a whole page: its own fonts and icons, nothing fetched, nothing that runs", () => {
  const html = assembleSite(example);
  assert.match(html, /^<!doctype html><html lang="en">/);
  // Only the two fonts it uses are carried.
  assert.equal((html.match(/@font-face/g) ?? []).length, 2);
  assert.match(html, /font-family:"Outfit"/);
  assert.match(html, /font-family:"Plus Jakarta Sans"/);
  assert.ok(html.length < 400_000);
  assert.doesNotMatch(html, /<script|<img|@import|url\(https?:|src="https?:/);
  // Every icon the page uses is in its sprite.
  const used = new Set([...html.matchAll(/<use href="#i-([a-z0-9-]+)"/g)].map((m) => m[1]));
  assert.ok(used.size >= 10);
  for (const name of used) assert.match(html, new RegExp(`<symbol id="i-${name}"`), `icon ${name}`);
  assert.ok(ICON_NAMES.length >= 100);
});

test("whatever accent is chosen, the text on it and the accent as text stay readable", () => {
  for (const accent of [
    "#c2410c",
    "#f5b301",
    "#0ea5e9",
    "#16a34a",
    "#7c3aed",
    "#e11d48",
    "#fde047",
    "#0f172a",
  ]) {
    const p = palette({ accent });
    const hex = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
    assert.ok(contrast(hex(p.accent), hex(p.ink)) >= 4.5, `${accent}: text on the accent`);
    assert.ok(
      contrast(hex(p.deep), [255, 255, 255]) >= 4.5,
      `${accent}: the accent as text on white`,
    );
    assert.ok(
      contrast(hex(p.lift), hex(p.dark)) >= 3,
      `${accent}: the accent as a button on the dark colour`,
    );
    assert.ok(
      contrast(hex(p.onDark), hex(p.dark)) >= 4.5,
      `${accent}: the accent as text on the dark colour`,
    );
  }
});

test("the finished example passes every check against the real brief", () => {
  const problems = checkSite(example, brief, assembleSite(example));
  assert.deepEqual(errors(problems), []);
});

test("checks catch invented facts, altered reviews, wrong numbers and broken markup", () => {
  const run = (body: string, patch: Partial<Record<keyof typeof example, string>> = {}) => {
    const parts = { ...example, ...patch, body };
    return errors(checkSite(parts, brief, assembleSite(parts))).join(" | ");
  };
  // Invented: years, claims, figures.
  assert.match(
    run(
      EXAMPLE_BODY.replace(
        "Roofing &amp; repair services",
        "Licensed and insured roofers since 2005",
      ),
    ),
    /licensed.*insured|since 2005|2005/,
  );
  assert.match(
    run(EXAMPLE_BODY.replace("Visit or call", "Over 500 roofs, 100% satisfaction")),
    /500|100%|satisfaction/i,
  );
  // A review changed by one word.
  assert.match(
    run(EXAMPLE_BODY.replace("seamless and professional", "seamless and very professional")),
    /quotation from the brief/,
  );
  // A different phone number.
  assert.match(run(EXAMPLE_BODY.replaceAll("+18322814674", "+18325550100")), /dials/);
  // Markup problems.
  assert.match(run(`${EXAMPLE_BODY}<script>alert(1)</script>`), /No scripts/);
  assert.match(run(EXAMPLE_BODY.replace('class="hero"', 'class="heroo"')), /heroo/);
  assert.match(
    run(EXAMPLE_BODY.replace("#i-phone", "#i-telephone")),
    /icons don't exist: telephone/,
  );
  assert.match(run(EXAMPLE_BODY.replace("<h1>", "<h1>One</h1><h1>")), /exactly one <h1>/);
  assert.match(run(EXAMPLE_BODY.replace('href="#reviews"', 'href="#nowhere"')), /doesn't exist/);
  assert.match(run(`${EXAMPLE_BODY}<img src="https://example.com/a.jpg" alt="">`), /No images/);
  assert.match(run(EXAMPLE_BODY, { headFont: "Comic Sans" }), /headFont/);
  assert.match(run(`${EXAMPLE_BODY}<p>Lorem ipsum dolor</p>`), /Placeholder/);
  // The brief's own placeholders are fine; ones it never mentioned aren't.
  assert.match(run(EXAMPLE_BODY.replace("Visit or call", "Hi [CITY NAME]")), /\[CITY NAME\]/);
});

test("things the brief only says NOT to invent don't count as allowed", () => {
  // The brief lists "awards, guarantees" under what not to invent; the page may not use them.
  const parts = {
    ...example,
    body: EXAMPLE_BODY.replace("Visit or call", "Award-winning, with a lifetime guarantee"),
  };
  assert.match(errors(checkSite(parts, brief, assembleSite(parts))).join(" "), /award|guarantee/i);
});

test("a model's reply is read in three parts, and a bad one says what's wrong", () => {
  const ok = parseReply(reply(example));
  assert.ok("parts" in ok);
  assert.equal((ok as { parts: { accent: string } }).parts.accent, "#c2410c");
  assert.equal((ok as { parts: { body: string } }).parts.body.slice(0, 8), "<!-- Cho");
  assert.match((parseReply("here is your site") as { error: string }).error, /three-part/);
  assert.match(
    (parseReply("<<<META>>>{nope<<<BODY>>><main>x</main>") as { error: string }).error,
    /JSON/,
  );
  assert.match(
    (parseReply('<<<META>>>{"title":"t"}<<<BODY>>><p>short</p>') as { error: string }).error,
    /too short/,
  );
  // A fenced reply is still readable.
  const fenced = parseReply(
    `<<<META>>>\n\`\`\`json\n${JSON.stringify({ title: "T", accent: "#112233", headFont: "Outfit", bodyFont: "Inter" })}\n\`\`\`\n<<<BODY>>>\n${EXAMPLE_BODY}\n<<<CSS>>>\n.x{color:red}`,
  );
  assert.ok("parts" in fenced);
  assert.equal((fenced as { parts: { extraCss: string } }).parts.extraCss, ".x{color:red}");
});

const clean = (width: number): RenderedPage => ({
  jpeg: "AAAA",
  metrics: {
    width,
    height: 3000,
    overflowX: 0,
    fontsLoaded: true,
    smallTargets: [],
    lowContrast: [],
    clipped: [],
  },
});

test("the builder fixes what the checks find, keeps the best page, and says if it was drawn", async () => {
  const prompts: string[] = [];
  const bad = {
    ...example,
    body: EXAMPLE_BODY.replace("Visit or call", "Trusted since 2001 · licensed and insured"),
  };
  const replies = [reply(bad), reply(example)];
  const site = await buildWebsite(brief, {
    complete: async (_system, prompt) => {
      prompts.push(prompt);
      return replies.shift() as string;
    },
    render: async () => [clean(390), clean(1280)],
  });
  assert.equal(site.rounds, 2);
  assert.deepEqual(errors(site.problems), []);
  assert.ok(site.measured);
  assert.match(prompts[1] as string, /claims aren't in the brief/);
  assert.match(prompts[1] as string, /You built this/);

  // A page that scrolls sideways is sent back, then fixed.
  const wide: RenderedPage = { ...clean(390), metrics: { ...clean(390).metrics, overflowX: 40 } };
  let drawn = 0;
  const fixed = await buildWebsite(brief, {
    complete: async () => reply(example),
    render: async () => (++drawn === 1 ? [wide, clean(1280)] : [clean(390), clean(1280)]),
  });
  assert.equal(fixed.rounds, 2);
  assert.ok(fixed.measured);
  assert.deepEqual(errors(fixed.problems), []);

  // No browser: only the code checks ran, and that is said.
  const blind = await buildWebsite(brief, { complete: async () => reply(example) });
  assert.equal(blind.measured, false);

  // Never fixed: the best page is still returned, with its problems.
  const stubborn = await buildWebsite(brief, { complete: async () => reply(bad), rounds: 2 });
  assert.ok(errors(stubborn.problems).length > 0);
  assert.equal(stubborn.rounds, 2);

  // A reply that is nothing like the format, every time: it fails plainly.
  await assert.rejects(
    buildWebsite(brief, { complete: async () => "no", rounds: 2 }),
    /right format/,
  );
});

test("render measurements become fixes, said once", () => {
  const m = (width: number, patch = {}) => ({ ...clean(width).metrics, ...patch });
  const problems = renderProblems([
    m(390, { overflowX: 30, lowContrast: ["p.lead (3.1:1)"] }),
    m(1280, { overflowX: 30, fontsLoaded: false }),
  ]);
  const text = problems.map((p) => p.message).join(" | ");
  assert.match(text, /scrolls sideways at 390px/);
  assert.match(text, /font didn't load at 1280px/);
  assert.match(text, /hard to read at 390px/);
  assert.equal(renderProblems([m(390), m(1280)]).length, 0);
});

test("a build runs in the background, is saved as a website, tells the person, and is limited", async () => {
  const owner = "site-1";
  const miniApps = new MiniApps(db, "https://neddy.test");
  const told: string[] = [];
  let calls = 0;
  const builds = new WebsiteBuilds(db, {
    plan: () => ({ model: "anthropic/strong" }),
    complete: async (options) => {
      calls++;
      assert.equal(options.model, "anthropic/strong");
      assert.match(options.system, /FINISHED PAGE FOR A DIFFERENT BRIEF/);
      return reply(example);
    },
    render: async () => [clean(390), clean(1280)],
    miniApps,
    notify: async (_owner, title, body, key) => {
      told.push(`${title} | ${key}`);
      assert.ok(body);
    },
    ready: () => true,
  });
  const started = await builds.start(owner, { brief, name: "Maveric Construction" });
  assert.ok("build" in started);
  const id = (started as { build: { id: string } }).build.id;
  // Returned at once, while it works.
  assert.equal((await builds.get(owner, id))?.status, "working");
  await builds.settled();
  const done = await builds.get(owner, id);
  assert.equal(done?.status, "done");
  assert.equal(done?.measured, true);
  assert.deepEqual(done?.problems, []);
  assert.equal(told.length, 1);
  assert.match(told[0] as string, /^Your website for Maveric Construction is ready \| website:/);
  const apps = await miniApps.list(owner);
  assert.equal(apps.length, 1);
  assert.equal(apps[0]?.kind, "website");
  // It opens like any mini app, and is a whole page.
  const html = (await miniApps.get(owner, apps[0]?.id as string)).html;
  assert.ok(
    html.length > 100_000,
    "a website carries its fonts and may be over a tool's 200 KB cap only if it is a website",
  );

  // The tools speak for it.
  const tools = Object.fromEntries(
    websiteToolSpecs(builds, owner).map((t) => [t.name, t.execute]),
  ) as Record<string, (args: unknown) => Promise<Record<string, unknown>>>;
  const check = (await (
    tools.check_website_build as (a: unknown) => Promise<Record<string, unknown>>
  )({})) as {
    ready?: boolean;
    kind?: string;
    id?: string;
  };
  assert.equal(check.ready, true);
  assert.equal(check.kind, "website");
  assert.equal(check.id, apps[0]?.id);
  // Too little to build from is turned away before any money is spent.
  const thin = await (
    tools.build_website as (a: unknown) => Promise<{ started: boolean; message: string }>
  )({
    brief: "Make me a website for my shop please".padEnd(45, "!"),
  });
  assert.equal(thin.started, false);
  assert.match(thin.message, /isn’t enough/);
  assert.equal(calls, 1);

  // A day's limit.
  for (let i = 1; i < BUILDS_PER_DAY; i++) {
    const again = await builds.start(owner, { brief });
    assert.ok("build" in again, `build ${i + 1}`);
    await builds.settled();
  }
  assert.deepEqual(await builds.start(owner, { brief }), { reason: "limit" });
});

test("a build that fails says so and tells the person; no model means no tool", async () => {
  const owner = "site-2";
  const told: string[] = [];
  const builds = new WebsiteBuilds(db, {
    plan: () => ({ model: "anthropic/strong" }),
    complete: async () => {
      throw new Error("the model is down");
    },
    miniApps: new MiniApps(db, "https://neddy.test"),
    notify: async (_o, title) => {
      told.push(title);
    },
    ready: () => true,
  });
  const started = await builds.start(owner, { brief });
  await builds.settled();
  assert.ok("build" in started);
  const record = await builds.get(owner);
  assert.equal(record?.status, "failed");
  assert.match(record?.error ?? "", /model is down/);
  assert.match(told[0] ?? "", /didn’t get built/);
  const off = new WebsiteBuilds(db, {
    plan: () => ({ model: "" }),
    complete: async () => "",
    miniApps: new MiniApps(db, "https://neddy.test"),
    notify: async () => {},
    ready: () => false,
  });
  assert.deepEqual(await off.start(owner, { brief }), { reason: "no-model" });
});

test("a website may be big; a tool may not, and a website can't ask for passwords", async () => {
  const apps = new MiniApps(db, "https://neddy.test");
  const big = `<!doctype html><title>x</title><p>${"a".repeat(250_000)}</p>`;
  await assert.rejects(apps.save("site-3", { title: "Big tool", html: big }), /200 KB/);
  const site = await apps.save("site-3", { title: "Big site", kind: "website", html: big });
  assert.equal(site.kind, "website");
  // A new version of a website stays a website.
  const again = await apps.save("site-3", { id: site.id, title: "Big site", html: big });
  assert.equal(again.kind, "website");
  await assert.rejects(
    apps.save("site-3", {
      title: "Login",
      kind: "website",
      html: `<p>x</p><input type="password">${"b".repeat(40)}`,
    }),
    /passwords/,
  );
});

// The kit, drawn in a real browser at phone and desktop width: no sideways scroll, fonts loaded,
// readable text. Skipped where no Chromium is installed.
const chromium =
  process.env.CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
test("the example, drawn in a real browser, has nothing for the checks to fix", {
  skip: !chromium,
}, async () => {
  process.env.CHROMIUM_PATH = chromium;
  const { renderPage } = await import("../apps/worker/src/render.ts");
  const pages = await renderPage(assembleSite(example), [390, 1280]);
  assert.equal(pages.length, 2);
  for (const page of pages) {
    assert.equal(page.metrics.overflowX, 0, `${page.metrics.width}px: sideways scroll`);
    assert.ok(page.metrics.fontsLoaded, `${page.metrics.width}px: fonts`);
    assert.deepEqual(page.metrics.lowContrast, [], `${page.metrics.width}px: contrast`);
    assert.deepEqual(page.metrics.clipped, [], `${page.metrics.width}px: clipped`);
    assert.deepEqual(page.metrics.smallTargets, [], `${page.metrics.width}px: tap targets`);
    assert.ok(page.jpeg.length > 10_000);
  }
  assert.deepEqual(errors(renderProblems(pages.map((p) => p.metrics))), []);
  assert.ok(pageText(EXAMPLE_BODY).includes("Call Now: (832) 281-4674"));
});

test("safety: nothing that runs, redirects, loads or sends gets through, however it is written", () => {
  const unsafe = (extra: string, css?: string) => {
    const parts = {
      ...example,
      body: `${EXAMPLE_BODY}${extra}`,
      ...(css ? { extraCss: css } : {}),
    };
    return checkSite(parts, brief, assembleSite(parts)).some((p) => p.safety);
  };
  for (const payload of [
    "<script>alert(1)</script>",
    "<SCRIPT SRC=//evil></SCRIPT>",
    "<svg/onload=alert(1)>",
    '<a href="#"onclick=alert(1)>x</a>',
    '<meta http-equiv=refresh content="0;url=https://evil.example">',
    '<link rel=dns-prefetch href="//evil.example">',
    '<base href="https://evil.example/">',
    '<a href=" javascript:alert(1)">x</a>',
    '<a href="&#106;avascript:alert(1)">x</a>',
    "<a href=javascript:alert(1)>x</a>",
    '<a href="jav&#x09;ascript:alert(1)">x</a>',
    '<a href="data:text/html,<p>x">x</a>',
    '<svg><image href="https://evil.example/a.png"/></svg>',
    '<div style="background:url(//evil.example/a.png)">x</div>',
    '<style>@import "//evil.example/a.css"</style>',
    '<object data="x"></object>',
    "<img src=//evil.example/a.png>",
  ])
    assert.ok(unsafe(payload), payload);
  // CSS from the model can't close the style tag, load or run anything.
  for (const css of [
    "</style><script>alert(1)</script><style>",
    "@import url(//evil.example/x.css);",
    "a{background:url(https://evil.example/a)}",
    "a{width:expression(alert(1))}",
  ])
    assert.ok(unsafe("", css), css);
  // …and whatever is left of it is made harmless in code, so a missed check can't ship it.
  const page = assembleSite({
    ...example,
    extraCss: "</style><script>alert(1)</script>a{b:url(//x)}@import 'y';",
  });
  assert.doesNotMatch(page, /<script|@import|url\(\/\/x/);
  // The page's own links are fine.
  assert.ok(!unsafe('<a href="https://www.google.com/maps/search/?api=1&query=x">map</a>'));
  assert.ok(!unsafe('<a href="mailto:hi@example.com">mail</a>'));
});

test("a page that stays unsafe is thrown away, never saved", async () => {
  const bad = reply({ ...example, body: `${EXAMPLE_BODY}<script>alert(1)</script>` });
  await assert.rejects(buildWebsite(brief, { complete: async () => bad, rounds: 2 }), /unsafe/);
  // A later clean round wins over an unsafe first one.
  const replies = [bad, reply(example)];
  const site = await buildWebsite(brief, { complete: async () => replies.shift() as string });
  assert.equal(
    site.problems.some((p) => p.safety),
    false,
  );
});

test("builds: a restart doesn't leave a slot stuck, the same request isn't built twice, a change rebuilds the same page", async () => {
  const owner = "site-4";
  const miniApps = new MiniApps(db, "https://neddy.test");
  let now = Date.parse("2026-11-08T12:00:00Z");
  let release: (() => void) | undefined;
  let held = true;
  const seen: string[] = [];
  const told: string[] = [];
  const builds = new WebsiteBuilds(db, {
    plan: () => ({ model: "anthropic/strong" }),
    complete: async (options) => {
      // Held until the test lets go, so the first build is "in flight".
      if (held) await new Promise<void>((resolve) => (release = resolve));
      seen.push(options.prompt);
      return reply(example);
    },
    miniApps,
    notify: async (_o, title) => {
      told.push(title);
    },
    ready: () => true,
    now: () => now,
  });
  const first = await builds.start(owner, { brief });
  const twin = await builds.start(owner, { brief });
  assert.equal(
    (twin as { build: { id: string } }).build.id,
    (first as { build: { id: string } }).build.id,
    "same request, same build",
  );
  await new Promise((r) => setTimeout(r, 20));
  held = false;
  release?.();
  await builds.settled();
  assert.equal((await builds.list(owner)).length, 1);

  // A record nobody is running (the server restarted) is closed as interrupted after a minute.
  await db.put(owner, "website-builds", {
    id: "orphan",
    name: "Old",
    status: "working",
    stage: "Writing the page",
    startedAt: new Date(now - 5 * 60_000).toISOString(),
  });
  const listed = await builds.list(owner);
  assert.equal(listed.find((b) => b.id === "orphan")?.status, "failed");
  assert.match(listed.find((b) => b.id === "orphan")?.error ?? "", /restarted/);

  // A change rebuilds from the same facts and replaces the same page.
  const appId = (await builds.list(owner)).find((b) => b.appId)?.appId as string;
  assert.ok(appId);
  const changed = await builds.start(owner, {
    brief: "a few words",
    of: appId,
    change: "Make the headline shorter",
  });
  assert.ok("build" in changed);
  await builds.settled();
  assert.match(
    seen.at(-1) as string,
    /THE PERSON NOW ASKS FOR THIS CHANGE[\s\S]*Make the headline shorter/,
  );
  assert.match(seen.at(-1) as string, /Maveric Construction/);
  const apps = await miniApps.list(owner);
  assert.equal(apps.length, 1, "replaced, not a second page");
  assert.equal(apps[0]?.version, 2);
  assert.deepEqual(await builds.start(owner, { brief: "x", of: "not-a-website", change: "y" }), {
    reason: "no-original",
  });

  // The limit is any 24 hours, not a calendar day.
  let reached = false;
  for (let i = 0; i < BUILDS_PER_DAY + 2; i++) {
    now += 60_000;
    const r = await builds.start(owner, { brief: `${brief} variation ${i}` });
    if ("reason" in r) {
      assert.equal(r.reason, "limit");
      reached = true;
      break;
    }
    await builds.settled();
  }
  assert.ok(reached, "the limit was reached");
  now += 25 * 60 * 60_000;
  assert.ok("build" in (await builds.start(owner, { brief: `${brief} the next day` })));
  await builds.settled();
  assert.ok(told.length >= 3);
});

test("builds: a failing notice doesn't undo a saved page", async () => {
  const owner = "site-5";
  const miniApps = new MiniApps(db, "https://neddy.test");
  const builds = new WebsiteBuilds(db, {
    plan: () => ({ model: "anthropic/strong" }),
    complete: async () => reply(example),
    miniApps,
    notify: async () => {
      throw new Error("push is down");
    },
    ready: () => true,
  });
  await builds.start(owner, { brief });
  await builds.settled();
  assert.equal((await builds.get(owner))?.status, "done");
  assert.equal((await miniApps.list(owner)).length, 1);
});

test("a background job can look at a website build but not start one", () => {
  const stub = { get: async () => undefined } as never;
  assert.deepEqual(
    websiteToolSpecs(stub, "o", { check: true }).map((t) => t.name),
    ["check_website_build"],
  );
  assert.deepEqual(
    websiteToolSpecs(stub, "o").map((t) => t.name),
    ["build_website", "check_website_build"],
  );
});
