import { z } from "zod";
import type { BrowserSignIn } from "../../../packages/domain/src/index.ts";
import type { BrowserService, PageElement } from "./browser.ts";
import { listings, look, site, typedSecret } from "./browser-tools.ts";
import { AppError } from "./errors.ts";
import { type Logins, type LoginView, sameSite } from "./sign-in.ts";

/**
 * Signing in on websites with the person's saved passwords, and entering one-time codes. The agent
 * asks; the server types the password or code into the page itself, so neither reaches the model.
 */
const USERNAME = /e-?mail|user|login|log in|sign in|phone|mobile|account|member|id\b/i;
const NEXT = /\b(next|continue|sign ?in|log ?in)\b/i;
const OTHER_WAY = /\b(with|google|apple|facebook|microsoft|sso|passkey|create|forgot|help)\b/i;

const passwordField = (elements: PageElement[]) =>
  elements.find((e) => e.role === "password" && !e.disabled);

/** The username box: one that says so, or else the text box just before the password. */
function usernameField(elements: PageElement[], password?: PageElement) {
  const boxes = elements.filter(
    (e) => e.role === "textbox" && !e.disabled && !/search|find/i.test(e.name),
  );
  const named = boxes.find((e) => USERNAME.test(e.name));
  if (named) return named;
  if (!password) return undefined;
  const at = elements.indexOf(password);
  return boxes.filter((e) => elements.indexOf(e) < at).at(-1);
}

const nextButton = (elements: PageElement[]) =>
  elements.find(
    (e) => e.role === "button" && !e.disabled && NEXT.test(e.name) && !OTHER_WAY.test(e.name),
  );

export const signInInstructions =
  " Saved sign-ins: sign_in_with_saved_login signs in on the page open in this chat's browser with a password the person saved in the app; you only ever see the site and username. If the page then asks for a verification or one-time code, call enter_sign_in_code with that field's ref. Never ask the person to type a password or code in chat.";

/** Types a saved sign-in into the page, following a two-step sign-in (username, then password). */
export async function fillSignIn(
  browser: BrowserService,
  logins: Logins,
  owner: string,
  sessionId: string,
  loginId: string,
) {
  const login = await logins.get(owner, loginId);
  if (!login) throw new AppError("That saved sign-in was deleted", 404);
  let page = await browser.elements(owner, sessionId);
  let password = passwordField(page.elements);
  const username = usernameField(page.elements, password);
  if (!password && !username)
    throw new AppError(
      "This page has no sign-in form. Open the site's Sign in page first, then try again.",
      409,
    );
  if (!sameSite(page.url, login.site))
    throw new AppError(
      `The browser is on ${site(page.url)}, not ${login.site}. Saved passwords are only typed on the site they were saved for.`,
      409,
    );
  if (username && username.value !== login.username)
    await browser.act(owner, sessionId, {
      ref: username.ref,
      action: "fill",
      value: login.username,
    });
  if (!password && username) {
    // Two-step sign-in: send the username, then find the password box on the next page.
    const next = nextButton(page.elements);
    await browser.act(
      owner,
      sessionId,
      next
        ? { ref: next.ref, action: "click" }
        : { ref: username.ref, action: "press", value: "Enter" },
    );
    page = await browser.elements(owner, sessionId);
    password = passwordField(page.elements);
    if (!password) {
      listings.delete(sessionId);
      return `Entered ${login.username} on ${login.site}, but the site hasn't asked for the password yet. Look at the page to see what it wants next.`;
    }
  }
  if (!password) throw new AppError("This page has no password box.", 409);
  // Checked against the page as it is now, right before the password goes in.
  const secret = await logins.password(owner, loginId, page.url);
  typedSecret(sessionId, secret);
  await browser.act(owner, sessionId, { ref: password.ref, action: "fill", value: secret });
  const after = await browser.act(owner, sessionId, {
    ref: password.ref,
    action: "press",
    value: "Enter",
  });
  listings.delete(sessionId);
  await logins.used(owner, loginId);
  return `Signed in to ${login.site} as ${login.username}. The page now shows “${after.title}”.`;
}

/** Types a one-time code into the field the agent picked, found again by its words. */
async function fillCode(
  browser: BrowserService,
  owner: string,
  step: Pick<BrowserSignIn, "sessionId" | "site" | "element" | "ref">,
  code: string,
) {
  const page = await browser.elements(owner, step.sessionId);
  if (!sameSite(page.url, step.site))
    throw new AppError(`The browser is no longer on ${step.site}, so no code was entered.`, 409);
  const field =
    page.elements.find((e) => e.name === step.element && e.role === "textbox" && !e.disabled) ??
    page.elements.find((e) => e.ref === step.ref && e.role === "textbox" && !e.disabled);
  if (!field)
    throw new AppError(
      "The code box isn't on the page anymore. Ask your agent to look again.",
      409,
    );
  typedSecret(step.sessionId, code);
  await browser.act(owner, step.sessionId, { ref: field.ref, action: "fill", value: code });
  const after = await browser.act(owner, step.sessionId, {
    ref: field.ref,
    action: "press",
    value: "Enter",
  });
  listings.delete(step.sessionId);
  return `Entered the code on ${step.site}. The page now shows “${after.title}”.`;
}

/** Codes people type: digits, sometimes letters, with the odd space or dash. */
export function cleanCode(code: string | undefined) {
  const clean = (code ?? "").replace(/[\s-]/g, "");
  return /^[A-Za-z0-9]{4,10}$/.test(clean) ? clean : undefined;
}

/** Runs an approved sign-in or code step. The code, when the person typed one, is used once. */
export async function runApprovedSignIn(
  browser: BrowserService,
  logins: Logins | undefined,
  owner: string,
  step: BrowserSignIn,
  typedCode?: string,
) {
  if (!logins?.available) throw new AppError("Saved sign-ins aren't set up on this server", 503);
  if (step.step === "password") {
    if (!step.loginId) throw new AppError("No saved sign-in was chosen", 409);
    return fillSignIn(browser, logins, owner, step.sessionId, step.loginId);
  }
  if (step.savedCode && step.loginId) {
    const page = await browser.elements(owner, step.sessionId);
    return fillCode(browser, owner, step, await logins.code(owner, step.loginId, page.url));
  }
  const code = cleanCode(typedCode);
  if (!code) throw new AppError("Type the code from your text message or authenticator app.", 400);
  return fillCode(browser, owner, step, code);
}

export function signInToolSpecs(
  browser: BrowserService,
  logins: Logins,
  owner: string,
  threadId: string,
  propose: (step: BrowserSignIn) => Promise<{ id: string }>,
) {
  const session = async () => {
    const found = await browser.threadSession(owner, threadId);
    if (!found) throw new AppError("Open the page with browse_web first", 409);
    return found.id;
  };
  const choose = (saved: LoginView[], username?: string) =>
    username
      ? saved.find((l) => l.username.toLowerCase() === username.toLowerCase())
      : saved.length === 1
        ? saved[0]
        : undefined;
  return [
    {
      name: "sign_in_with_saved_login",
      description:
        "Sign in on the page open in this chat's browser with a sign-in the person saved in the app. You never see the password: the server types it in, only on the site it was saved for. Asks the person first unless they turned that off for this site.",
      parameters: z.object({
        username: z
          .string()
          .max(200)
          .optional()
          .describe("Which saved username, when the person saved more than one for this site"),
        why: z.string().trim().min(3).max(300).describe("What signing in is for"),
      }),
      execute: async (input: { username?: string; why: string }) => {
        const id = await session();
        const page = await browser.elements(owner, id);
        const saved = await logins.forPage(owner, page.url);
        if (!saved.length)
          return {
            error: `No saved sign-in for ${site(page.url)}. Ask the person to save one in the app (Apps → Account → Passwords), never in chat, or to sign in with Take control on the browser card.`,
          };
        const login = choose(saved, input.username);
        if (!login)
          return {
            error: "More than one sign-in is saved for this site: say which username.",
            usernames: saved.map((l) => l.username),
          };
        if (!passwordField(page.elements) && !usernameField(page.elements))
          return {
            error:
              "This page has no sign-in form. Find and open the site's Sign in link first (look_at_page).",
          };
        if (login.askFirst) {
          const proposal = await propose({
            sessionId: id,
            url: page.url,
            site: login.site,
            pageTitle: page.title.slice(0, 300),
            step: "password",
            loginId: login.id,
            username: login.username,
            summary: `Sign in to ${login.site} as ${login.username}: ${input.why}`.slice(0, 500),
          });
          return {
            needsApproval: true,
            approvalId: proposal.id,
            next: "Signing in is waiting for the person's OK in the app. Tell them; don't say you're signed in yet.",
          };
        }
        return {
          done: await fillSignIn(browser, logins, owner, id, login.id),
          page: await look(browser, owner, id),
        };
      },
    },
    {
      name: "enter_sign_in_code",
      description:
        "When a site asks for a verification or one-time code, have it entered in the code box (by ref from look_at_page). The code comes from the person's saved authenticator key, or the person types it into the app; never ask for it in chat.",
      parameters: z.object({
        ref: z.string().regex(/^e\d{1,4}$/),
        why: z.string().trim().min(3).max(300),
      }),
      execute: async (input: { ref: string; why: string }) => {
        const id = await session();
        const listing = listings.get(id);
        const field = listing?.elements.find((e) => e.ref === input.ref);
        if (!listing || !field)
          return { error: "Look at the page first (look_at_page) and use a ref from that list." };
        if (field.role !== "textbox") return { error: `"${field.name}" isn't a text box.` };
        const saved = (await logins.forPage(owner, listing.url)).find((l) => l.hasAuthenticator);
        if (saved && !saved.askFirst)
          return {
            done: await runApprovedSignIn(browser, logins, owner, {
              sessionId: id,
              url: listing.url,
              site: saved.site,
              pageTitle: listing.title,
              step: "code",
              loginId: saved.id,
              ref: field.ref,
              element: field.name,
              savedCode: true,
              summary: input.why,
            }),
            page: await look(browser, owner, id),
          };
        const proposal = await propose({
          sessionId: id,
          url: listing.url,
          site: site(listing.url),
          pageTitle: listing.title.slice(0, 300),
          step: "code",
          ...(saved ? { loginId: saved.id, username: saved.username, savedCode: true } : {}),
          ref: field.ref,
          element: field.name.slice(0, 200),
          summary:
            `Enter the ${saved ? "authenticator" : "verification"} code on ${site(listing.url)}: ${input.why}`.slice(
              0,
              500,
            ),
        });
        return {
          needsApproval: true,
          approvalId: proposal.id,
          next: saved
            ? "The code comes from their saved authenticator key once they approve in the app. Tell them it's waiting for their OK."
            : "Tell the person to open the approval in the app and type the code the site sent them there, not in chat.",
        };
      },
    },
  ];
}
