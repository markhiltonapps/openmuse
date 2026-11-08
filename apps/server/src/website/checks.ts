import { FONT_FAMILIES, ICON_NAMES, KIT_CSS } from "./kit.ts";

/** One thing wrong with a page, in words the model can act on. */
export interface Problem {
  /** error: must be fixed; note: worth fixing if it's easy. */
  level: "error" | "note";
  message: string;
  /** Something that could run code or send the viewer away: a page with one is never saved. */
  safety?: boolean;
}

export interface Parts {
  title: string;
  description?: string;
  accent: string;
  dark?: string;
  headFont: string;
  bodyFont: string;
  corners?: string;
  body: string;
  extraCss?: string;
}

const KIT_CLASSES = new Set(
  [...KIT_CSS.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1] as string),
);

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  middot: "·",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
};

/** What a person reads on the page: tags, comments, scripts and styles gone, entities decoded. */
export function pageText(html: string) {
  return (
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      // Words inside an inline tag stay joined to the punctuation beside them; any other tag is a break.
      .replace(/<\/?(?:b|strong|em|i|span|a|small|u|mark|sup|sub|abbr|cite|q|time)\b[^>]*>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
        if (name.startsWith("#")) {
          const code =
            name[1]?.toLowerCase() === "x"
              ? Number.parseInt(name.slice(2), 16)
              : Number(name.slice(1));
          return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        return ENTITIES[name.toLowerCase()] ?? whole;
      })
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Quotes, dashes and spaces made alike, so a curly quote isn't a different word. */
export const plain = (text: string) =>
  text
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Words that sound like facts. If the brief doesn't say them, the page mustn't either. */
const CLAIMS =
  /\b(licensed|insured|bonded|certified|accredited|award[- ]winning|awards?|guarantees?d?|warrant(?:y|ies)|family[- ]owned|locally[- ]owned|veteran[- ]owned|years of experience|decades|since (?:19|20)\d\d|#1|number one|best in|top[- ]rated|free (?:estimates?|quotes?|consultations?)|24\/7|same[- ]day|emergency service|satisfaction)\b/gi;

export function checkSite(parts: Parts, brief: string, assembled: string): Problem[] {
  const problems: Problem[] = [];
  const error = (message: string) => problems.push({ level: "error", message });
  const unsafe = (message: string) => problems.push({ level: "error", message, safety: true });
  const note = (message: string) => problems.push({ level: "note", message });
  const { body } = parts;
  const text = pageText(body);
  // What the brief says is allowed, not what it says to avoid ("don't invent awards, guarantees…").
  const facts = brief.replace(
    /(?:do not|don't|never)\s+(?:invent|make up|fabricate)[^.\n]*[.\n]/gi,
    " ",
  );
  const briefPlain = plain(pageText(facts) || facts);
  const rawBrief = plain(facts);

  if (!parts.title.trim()) error("The title is empty.");
  if (parts.title.length > 70)
    note("The title is long (over 70 characters); search results cut it off.");
  if (!FONT_FAMILIES.includes(parts.headFont))
    error(`headFont "${parts.headFont}" isn't available. Use one of: ${FONT_FAMILIES.join(", ")}.`);
  if (!FONT_FAMILIES.includes(parts.bodyFont))
    error(`bodyFont "${parts.bodyFont}" isn't available. Use one of: ${FONT_FAMILIES.join(", ")}.`);
  if (!/^#[0-9a-f]{6}$/i.test(parts.accent)) error("accent must be a #rrggbb colour.");
  if (parts.corners && !["soft", "sharp"].includes(parts.corners))
    error('corners must be "soft" or "sharp".');
  if (parts.dark && !/^#[0-9a-f]{6}$/i.test(parts.dark)) error("dark must be a #rrggbb colour.");

  // Structure.
  const h1 = (body.match(/<h1\b/gi) ?? []).length;
  if (h1 !== 1) error(`The page needs exactly one <h1> (it has ${h1}).`);
  if (!/<main\b[^>]*\bid=["']main["']/i.test(body))
    error('Wrap the main content in <main id="main">.');
  if (!/<header\b/i.test(body)) note("There is no <header> with the navigation.");
  if (!/<footer\b[^>]*\bclass\s*=\s*["'][^"']*\bfooter\b/i.test(body))
    error('There is no page footer: use <footer class="footer"> with a .container.');
  if (/<(html|head|body)\b/i.test(body))
    error("Write only what goes inside <body>, not <html>, <head> or <body>.");
  if (/<img\b/i.test(body)) error("No images: use the icons and shapes (this page has none).");
  if (
    /<(iframe|form|input|button|textarea|select|video|audio|canvas|dialog|template)\b/i.test(body)
  )
    error(
      "No iframes, forms, buttons, media or canvas: this page is plain markup and styles. Use <a> for anything that can be tapped.",
    );

  // Safety: nothing that runs, redirects, loads or sends. An allow-list, not a list of known bad things.
  if (/<\s*script\b/i.test(body)) unsafe("No scripts: this page is plain markup and styles.");
  if (
    /<\s*(meta|link|base|style|object|embed|applet|frame|frameset|noscript|foreignobject|animate|animatetransform|set|handler|listener|image|portal)\b/i.test(
      body,
    )
  )
    unsafe(
      "Tags like <meta>, <link>, <base>, <style>, <object>, <embed> and svg <image>/<animate> aren't allowed in the body. Put any extra CSS in the <<<CSS>>> part.",
    );
  if (/[\s"'/]on[a-z]+\s*=/i.test(body))
    unsafe("No inline event handlers (onclick, onload and the like).");
  const swallowed = (value: string) =>
    value
      .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) =>
        String.fromCodePoint(Number.parseInt(h, 16)),
      )
      .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(Number(d)))
      .replace(
        /&(colon|tab|newline);/gi,
        (_m, n: string) => ({ colon: ":", tab: "", newline: "" })[n.toLowerCase() as "colon"] ?? "",
      )
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters hidden inside a link are exactly what this strips
      .replace(/[\u0000-\u0020\u007f-\u009f]+/g, "")
      .toLowerCase();
  for (const match of body.matchAll(
    /\b(?:xlink:)?(?:href|src|srcset|action|formaction|poster|data|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
  )) {
    const value = swallowed((match[1] ?? match[2] ?? match[3] ?? "") as string);
    if (value === "" || value === "#") {
      error(
        `A link with nothing to go to (href="${match[1] ?? match[2] ?? match[3] ?? ""}"). Point it at a section id, a tel: number or the brief's map link.`,
      );
      continue;
    }
    if (/^(?:#|tel:|mailto:|sms:|https?:\/\/)/.test(value)) continue;
    unsafe(
      `A link or source that isn't a page section, tel:, mailto:, sms: or https: address: "${String(match[1] ?? match[2] ?? match[3]).slice(0, 60)}".`,
    );
  }
  if (/\bstyle\s*=\s*(?:"[^"]*"|'[^']*')/i.test(body))
    for (const m of body.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi))
      if (/url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding/i.test(`${m[1] ?? m[2]}`))
        unsafe("A style attribute loads or runs something (url(), expression()).");
  const css = parts.extraCss ?? "";
  if (/[<>]|@import|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding|\\/i.test(css))
    unsafe(
      "The <<<CSS>>> part may not contain < or >, @import, url(), expression() or backslash escapes.",
    );
  // Nothing fetched: everything is inside the page.
  if (/\b(?:src|srcset)\s*=\s*["']?(?:https?:)?\/\//i.test(body))
    unsafe("Nothing may be loaded from outside the page (no src to a website).");

  // The kit: only its classes and icons, so nothing is left unstyled.
  const own = new Set(
    [...(parts.extraCss ?? "").matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1] as string),
  );
  const unknown = new Set<string>();
  for (const match of body.matchAll(/\bclass\s*=\s*["']([^"']*)["']/gi))
    for (const name of (match[1] as string).split(/\s+/).filter(Boolean))
      if (!KIT_CLASSES.has(name) && !own.has(name)) unknown.add(name);
  if (unknown.size)
    error(
      `These classes don't exist, so they have no styling: ${[...unknown].slice(0, 12).join(", ")}. Use the kit's classes, or define them in the <<<CSS>>> part.`,
    );
  const badIcons = new Set<string>();
  for (const match of body.matchAll(/#i-([a-z0-9-]+)/g))
    if (!ICON_NAMES.includes(match[1] as string)) badIcons.add(match[1] as string);
  if (badIcons.size)
    error(`These icons don't exist: ${[...badIcons].join(", ")}. Pick from the ICONS list.`);
  if ((parts.extraCss ?? "").length > 6000)
    note("The <<<CSS>>> part is long; the kit should cover most of it.");

  // In-page links must go to a section that exists.
  for (const match of body.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']#([^"']+)["']/gi)) {
    const target = match[1] as string;
    const exists = body
      .split(/\bid\s*=\s*["']/i)
      .slice(1)
      .some((chunk) => chunk.startsWith(`${target}"`) || chunk.startsWith(`${target}'`));
    if (!exists)
      error(
        `The link #${target} goes to a section that doesn't exist. Give that section id="${target}" or change the link.`,
      );
  }

  // Placeholders the brief didn't ask for.
  for (const placeholder of new Set(
    text.match(/lorem ipsum|\bTODO\b|\bTBD\b|your (?:text|company|business) here|\bxxx+\b/gi) ?? [],
  ))
    error(`Placeholder text: "${placeholder}".`);
  for (const bracket of new Set(text.match(/\[[A-Z][A-Z ]{2,}\]/g) ?? []))
    if (!rawBrief.includes(plain(bracket)))
      error(
        `Placeholder ${bracket} wasn't in the brief. Remove it, or use only a bracket the brief itself uses.`,
      );

  // Facts: only what the brief says.
  const visible = plain(text);
  const claims = new Set<string>();
  for (const match of visible.matchAll(CLAIMS)) {
    const word = match[0] as string;
    if (!briefPlain.includes(word) && !rawBrief.includes(word)) claims.add(word);
  }
  if (claims.size)
    error(
      `These claims aren't in the brief, so they would be invented: ${[...claims].join(", ")}. Take them out.`,
    );
  const figures = new Set<string>();
  for (const match of visible.matchAll(/\b(?:19|20)\d\d\b|\d+\s?%|\$\s?\d[\d,.]*|\b\d+\+/g)) {
    const figure = (match[0] as string).trim();
    if (!briefPlain.includes(figure) && !briefPlain.includes(figure.replace(/\s+/g, "")))
      figures.add(figure);
  }
  if (figures.size)
    error(
      `These figures aren't in the brief: ${[...figures].join(", ")}. Don't add years, percentages, prices or counts that weren't given (no copyright year either).`,
    );

  // Reviews or other quotes the brief gave: word for word.
  const given = [...brief.matchAll(/“([^”]{45,})”|"([^"\n]{45,})"/g)].map((m) =>
    plain((m[1] ?? m[2]) as string),
  );
  for (const quote of new Set(given))
    if (!visible.includes(quote))
      error(
        `A quotation from the brief isn't on the page word for word: "${quote.slice(0, 70)}…". Quote each one exactly as written.`,
      );

  // The phone number the page dials must be the brief's.
  const phones = new Set(
    [...brief.matchAll(/\(?\b(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})\b/g)].map(
      (m) => `${m[1]}${m[2]}${m[3]}`,
    ),
  );
  if (phones.size)
    for (const match of body.matchAll(/href\s*=\s*["']tel:([^"']*)["']/gi)) {
      const digits = (match[1] as string).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      if (!phones.has(digits))
        error(`A call link dials ${match[1]}, which isn't a number from the brief.`);
    }
  if (phones.size && !/href\s*=\s*["']tel:/i.test(body))
    error("There is no tel: call button. Add one with the brief's number.");

  if (assembled.length > 400_000) error("The page is too big (over 400 KB). Say it with less.");
  return problems;
}

/** What the browser measured on the rendered page (see apps/worker/src/render.ts). */
export interface RenderMetrics {
  width: number;
  height: number;
  /** Pixels the page is wider than the screen (0 when it fits). */
  overflowX: number;
  fontsLoaded: boolean;
  /** Links and buttons smaller than 44 px in either direction. */
  smallTargets: string[];
  /** Text whose colour is too close to its background. */
  lowContrast: string[];
  /** Headings or text cut off by their box. */
  clipped: string[];
}

export function renderProblems(metrics: RenderMetrics[]): Problem[] {
  const out: Problem[] = [];
  for (const m of metrics) {
    const at = `at ${m.width}px wide`;
    if (m.overflowX > 1)
      out.push({
        level: "error",
        message: `The page scrolls sideways ${at} (${m.overflowX}px too wide). Usually a long unbroken line, a fixed width or a nowrap row: let it wrap or narrow it.`,
      });
    if (!m.fontsLoaded)
      out.push({
        level: "error",
        message: `A font didn't load ${at}. Use only the listed fonts and don't set other font-family values.`,
      });
    if (m.smallTargets.length)
      out.push({
        level: "note",
        message: `Tap targets under 44px ${at} (make them at least 44px tall): ${m.smallTargets.slice(0, 4).join("; ")}.`,
      });
    if (m.lowContrast.length)
      out.push({
        level: "error",
        message: `Text that's hard to read ${at} (needs 4.5:1, or 3:1 for large text): ${m.lowContrast.slice(0, 4).join("; ")}.`,
      });
    if (m.clipped.length)
      out.push({
        level: "error",
        message: `Text cut off ${at}: ${m.clipped.slice(0, 3).join("; ")}. Shorten the words or let them wrap.`,
      });
  }
  // The same problem at two widths is said once.
  const seen = new Set<string>();
  return out.filter((p) => {
    const key = p.message.replace(/ at \d+px wide/, "");
    return seen.has(key) ? false : (seen.add(key), true);
  });
}
