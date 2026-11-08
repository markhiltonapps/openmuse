import { WorkerError } from "./errors.ts";

/**
 * Renders a page Neddy built (its own HTML, nothing fetched) at one or more widths in a throwaway
 * browser with no network, and reports what it measured and a picture of each. The api uses the
 * measurements to make the model fix what's wrong before the person sees the page.
 */
export interface RenderMetrics {
  width: number;
  height: number;
  overflowX: number;
  fontsLoaded: boolean;
  smallTargets: string[];
  lowContrast: string[];
  clipped: string[];
}
export interface RenderedPage {
  metrics: RenderMetrics;
  /** A JPEG of the whole page (the first 7000 px of a very long one), base64. */
  jpeg: string;
}

const MAX_HEIGHT = 7000;
let queue: Promise<unknown> = Promise.resolve();
/** Renders waiting or running. Past this the worker says it is busy instead of piling up. */
let pending = 0;
const MAX_PENDING = 3;
/** The most one render may take: a page that hangs is cut off and its browser closed. */
const RENDER_MS = 25_000;
const within = <T>(work: Promise<T>, ms: number, what: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new WorkerError("RENDER_TIMEOUT", `${what} took too long.`, 504)),
      ms,
    );
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
};

/** Runs inside the page: measures what a reader would trip over. */
function measure(width: number) {
  const channel = (n: number) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const parse = (css: string) => {
    const m = css.match(/rgba?\(([^)]+)\)/);
    if (!m) return undefined;
    const [r = 0, g = 0, b = 0, a = 1] = (m[1] as string)
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r, g, b, a };
  };
  const lum = (c: { r: number; g: number; b: number }) =>
    0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const backgroundOf = (el: Element) => {
    let node: Element | null = el;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.6) return c;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const name = (el: Element) => {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
    return `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? `.${el.className.split(" ")[0]}` : ""} “${text}”`;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };

  const smallTargets: string[] = [];
  for (const el of Array.from(document.querySelectorAll(".btn, .links a, .brand"))) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (el.matches(".links a") && width >= 600) continue;
    if (Math.min(r.width, r.height) < 44) smallTargets.push(name(el));
  }
  const lowContrast: string[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (!visible(el)) continue;
    const own = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 1,
    );
    if (!own) continue;
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    if (!fg) continue;
    const bg = backgroundOf(el);
    const mixed = {
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
    };
    const [hi, lo] = [lum(mixed), lum(bg)].sort((a, b) => b - a) as [number, number];
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = Number.parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const key = name(el);
    if (ratio < (large ? 3 : 4.5) && !seen.has(key)) {
      seen.add(key);
      lowContrast.push(`${key} (${ratio.toFixed(1)}:1)`);
    }
  }
  const clipped: string[] = [];
  for (const el of Array.from(document.querySelectorAll("h1,h2,h3,.btn,.chip,.tag,.brand__name"))) {
    if (visible(el) && el.scrollWidth > el.clientWidth + 2) clipped.push(name(el));
  }
  return {
    width,
    height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    fontsLoaded: Array.from(document.fonts as unknown as Iterable<FontFace>).every(
      (f) => f.status === "loaded",
    ),
    smallTargets,
    lowContrast,
    clipped,
  };
}

export async function renderPage(html: string, widths: number[]): Promise<RenderedPage[]> {
  if (!html.trim() || html.length > 1_000_000)
    throw new WorkerError("INVALID_BODY", "A page of at most 1 MB is required.", 400);
  const sizes = widths.filter((w) => Number.isInteger(w) && w >= 280 && w <= 2000).slice(0, 3);
  if (!sizes.length)
    throw new WorkerError("INVALID_BODY", "Give 1 to 3 widths between 280 and 2000.", 400);
  if (pending >= MAX_PENDING)
    throw new WorkerError(
      "BUSY",
      "The browser is busy drawing other pages. Try again in a minute.",
      503,
    );
  pending++;
  // One at a time: a render is a whole browser.
  const run = queue
    .catch(() => undefined)
    .then(async () => {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({
        headless: true,
        timeout: 25_000,
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        env: {
          HOME: process.env.HOME ?? "/tmp",
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          LANG: "C.UTF-8",
        },
        args: ["--disable-extensions", "--disable-quic", "--host-resolver-rules=MAP * ~NOTFOUND"],
      });
      try {
        const draw = async () => {
          const out: RenderedPage[] = [];
          for (const width of sizes) {
            const context = await browser.newContext({
              viewport: { width, height: width < 600 ? 844 : 800 },
              serviceWorkers: "block",
              javaScriptEnabled: true,
            });
            // The page is its own world: anything that tries to leave it is refused.
            await context.route("**/*", (route) =>
              /^(data|about|blob):/.test(route.request().url()) ? route.continue() : route.abort(),
            );
            const page = await context.newPage();
            await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(150);
            // tsx's compiler wraps named functions in a helper the page doesn't have; give it a stand-in.
            await page.evaluate("globalThis.__name = (fn) => fn");
            const metrics = (await page.evaluate(measure, width)) as RenderMetrics;
            const jpeg = await page.screenshot({
              type: "jpeg",
              quality: 72,
              fullPage: true,
              clip: { x: 0, y: 0, width, height: Math.min(metrics.height, MAX_HEIGHT) },
            });
            out.push({ metrics, jpeg: jpeg.toString("base64") });
            await context.close();
          }
          return out;
        };
        return await within(draw(), RENDER_MS, "Drawing the page");
      } finally {
        await browser.close().catch(() => undefined);
      }
    })
    .finally(() => {
      pending--;
    });
  queue = run;
  return run;
}
