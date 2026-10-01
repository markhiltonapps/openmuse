import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

/**
 * Mini apps: small single-page tools and dashboards Neddy builds for the person (a trip planner,
 * a tip splitter, a spending dashboard), opened in the app and shareable by link. Each page runs
 * sandboxed: its own scripts only, no network, nothing from the app it's shown in.
 */
interface MiniApp {
  id: string;
  title: string;
  description?: string;
  html: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
interface SharedApp {
  /** The link's code, hashed. */
  id: string;
  owner: string;
  appId: string;
  expiresAt: string;
}
interface OwnShare {
  id: string;
  appId: string;
  url: string;
  expiresAt: string;
  createdAt: string;
}
export type MiniAppView = Omit<MiniApp, "html">;

const MAX_HTML = 200_000;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** What a mini app may do: run its own inline code and styles; no network, no outside files. */
export const MINI_APP_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";
/** Served on its own: sandboxed away from the app's origin as well. */
export const MINI_APP_HEADER_POLICY = `sandbox allow-scripts allow-popups allow-modals; ${MINI_APP_POLICY}`;

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

/**
 * The page as it's shown: the policy comes first, before anything the page itself says, then a
 * title and a phone-friendly viewport, then the page.
 */
export function appDocument(app: Pick<MiniApp, "title" | "html">) {
  const body = app.html.replace(/^\s*<!doctype[^>]*>/i, "");
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${MINI_APP_POLICY}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(app.title)}</title>${body}`;
}

/** What someone opening a dead share link sees: a plain page, not an error in code. */
export function goneDocument(message: string) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Link not available</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;font:17px/1.5 system-ui,-apple-system,sans-serif;background:#FCFCFC;color:#11191C}@media (prefers-color-scheme:dark){body{background:#000;color:#F3F3F5}}main{max-width:26rem}h1{font-size:1.4rem;margin:0 0 .4rem}p{margin:0;color:inherit;opacity:.8}</style><main><h1>This link isn’t available</h1><p>${escapeHtml(message)}</p></main>`;
}

/**
 * Mini apps never collect secrets: a page asking for a password or card could pass for a real
 * sign-in inside the app, or be shared to others as one.
 */
const ASKS_FOR_SECRETS =
  /<input\b[^>]*\btype\s*=\s*["']?password|autocomplete\s*=\s*["']?(current-password|new-password|one-time-code|cc-(number|csc|exp))/i;

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
  html: z
    .string()
    .min(20)
    .max(MAX_HTML, "Keep the page under 200 KB")
    .refine(
      (html) => !ASKS_FOR_SECRETS.test(html),
      "Mini apps can’t ask for passwords, sign-in codes or card numbers.",
    ),
});

export class MiniApps {
  constructor(
    private readonly db: Store,
    private readonly publicUrl: string,
    private readonly now: () => number = Date.now,
  ) {}
  private view({ html: _html, ...app }: MiniApp): MiniAppView {
    return app;
  }
  async list(owner: string) {
    return (await this.db.list<MiniApp>(owner, "mini-apps"))
      .map((a) => this.view(a))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(owner: string, id: string) {
    const app = await this.db.get<MiniApp>(owner, "mini-apps", id);
    if (!app)
      throw new AppError(
        "That mini app was deleted. Ask your agent to build it again if you still need it.",
        404,
      );
    return app;
  }
  /** Makes a new mini app, or a new version of one when its id is given. */
  async save(owner: string, raw: unknown) {
    const input = saveSchema.parse(raw);
    const at = new Date(this.now()).toISOString();
    const existing = input.id ? await this.get(owner, input.id) : undefined;
    const app: MiniApp = {
      id: existing?.id ?? randomUUID(),
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      html: input.html,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    await this.db.put(owner, "mini-apps", app);
    return this.view(app);
  }
  async remove(owner: string, id: string) {
    await this.unshare(owner, id);
    await this.db.remove(owner, "mini-apps", id);
    return { ok: true };
  }
  async share(owner: string, id: string, days: 1 | 7 | 30 = 7) {
    const app = await this.get(owner, id);
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(this.now() + days * 86_400_000).toISOString();
    const shareId = hash(token);
    await this.db.put("system", "mini-app-shares", {
      id: shareId,
      owner,
      appId: app.id,
      expiresAt,
    } satisfies SharedApp);
    const url = `${this.publicUrl.replace(/\/$/, "")}/api/mini/${token}`;
    await this.db.put(owner, "mini-app-shares", {
      id: shareId,
      appId: app.id,
      url,
      expiresAt,
      createdAt: new Date(this.now()).toISOString(),
    } satisfies OwnShare);
    return { url, expiresAt, title: app.title };
  }
  async links(owner: string, id: string) {
    const now = new Date(this.now()).toISOString();
    return (await this.db.list<OwnShare>(owner, "mini-app-shares"))
      .filter((s) => s.appId === id && s.expiresAt > now)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ url, expiresAt }) => ({ url, expiresAt }));
  }
  async unshare(owner: string, id: string) {
    for (const share of await this.db.list<OwnShare>(owner, "mini-app-shares"))
      if (share.appId === id) {
        await this.db.remove("system", "mini-app-shares", share.id);
        await this.db.remove(owner, "mini-app-shares", share.id);
      }
    return { ok: true };
  }
  /** The mini app a link opens, while the link works; always its latest version. */
  async open(token: string) {
    const gone = new AppError(
      "This link has expired or was turned off. Ask the person who sent it for a new one.",
      404,
    );
    if (!/^[\w-]{20,64}$/.test(token)) throw gone;
    const share = await this.db.get<SharedApp>("system", "mini-app-shares", hash(token));
    if (!share || share.expiresAt <= new Date(this.now()).toISOString()) throw gone;
    const app = await this.db.get<MiniApp>(share.owner, "mini-apps", share.appId);
    if (!app) throw gone;
    return app;
  }
}

export const miniAppInstructions =
  " When a small interactive tool or a visual summary would help more than text (a trip planner, a packing checklist, a tip or loan calculator, a budget or habit dashboard, a comparison table), build a mini app with make_mini_app: one self-contained HTML page. It appears in chat for the person to open, and they can share it by link. To change one, call make_mini_app again with its id.";
/** For a background job, whose mini apps are found in Files rather than in a chat. */
export const miniAppJobInstructions =
  " When the job asks for a small interactive tool or a visual summary (a trip planner, a checklist, a calculator, a budget or habit dashboard), build it with make_mini_app: one self-contained HTML page. It's kept in Files & media for the person to open, and they can share it by link. To change one, call make_mini_app again with its id.";

export function miniAppToolSpecs(apps: MiniApps, owner: string) {
  return [
    {
      name: "make_mini_app",
      description:
        "Build (or, with id, update) a mini app: one self-contained HTML page with inline <style> and <script>. It runs sandboxed with NO network and no outside files: no CDN scripts, web fonts, remote images or fetch calls (they're blocked), and no localStorage. Draw charts with inline SVG or canvas; put any data the page needs right in it. Design mobile-first (it opens on a phone), readable in light and dark (prefers-color-scheme), with clear labels, large tap targets and real content, never placeholder text. Never make a sign-in form or ask for passwords, codes, card numbers or other personal details, and don't send the page anywhere else. Under 200 KB.",
      parameters: z.object({
        id: z.string().uuid().optional().describe("To update an existing mini app"),
        title: z.string().trim().min(1).max(80),
        description: z.string().trim().max(240).optional().describe("One line on what it's for"),
        html: z.string().min(20).max(MAX_HTML),
      }),
      execute: async (input: {
        id?: string;
        title: string;
        description?: string;
        html: string;
      }) => {
        const app = await apps.save(owner, input);
        return {
          ...app,
          next: "It’s in the chat for the person to open. If it has a share link, that link now shows this version too, so tell them. Offer to change anything.",
        };
      },
    },
    {
      name: "list_mini_apps",
      description: "The mini apps you've built for the person, newest first, with their ids.",
      parameters: z.object({}),
      execute: async () => ({ apps: await apps.list(owner) }),
    },
    {
      name: "share_mini_app",
      description:
        "Make a link to a mini app that anyone with it can open, for 1, 7 (default) or 30 days. Only when the person asks to share it. The link always shows the latest version.",
      parameters: z.object({
        id: z.string().uuid(),
        days: z.union([z.literal(1), z.literal(7), z.literal(30)]).optional(),
      }),
      execute: async ({ id, days }: { id: string; days?: 1 | 7 | 30 }) => ({
        ...(await apps.share(owner, id, days ?? 7)),
        next: "Give the person the link and when it stops working. Tell them anyone with it sees everything in the mini app, including later changes, and they can turn it off with Stop sharing when they open it.",
      }),
    },
  ];
}
