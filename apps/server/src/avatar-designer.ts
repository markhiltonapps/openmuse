import { AppError } from "./errors.ts";

const ALLOWED = new Set([
  "svg",
  "g",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "clippath",
  "title",
  "desc",
]);

/**
 * Keeps only plain vector shapes: no scripts, styles, event handlers, links, embedded images or
 * external references. Returns undefined when the markup isn't a safe, self-contained SVG.
 */
export function sanitizeSvg(raw: string): string | undefined {
  const svg = raw
    .trim()
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .trim();
  if (svg.length > 20000 || !/^<svg[\s>][\s\S]*<\/svg>$/i.test(svg)) return undefined;
  if (/<!|javascript:|data:|@import|\bhref\b|\son[a-z]+\s*=|url\(\s*['"]?(?!#)/i.test(svg))
    return undefined;
  for (const [, tag] of svg.matchAll(/<\/?\s*([a-zA-Z][\w:-]*)/g))
    if (!ALLOWED.has(tag?.toLowerCase() ?? "")) return undefined;
  return svg;
}

/** Draws an avatar from a description with Claude, as a small blinking-ready SVG. */
export async function designAvatar(
  description: string,
  options: { apiKey: string; model: string; baseUrl?: string; fetcher?: typeof fetch },
) {
  const base = (options.baseUrl ?? "https://api.anthropic.com")
    .replace(/\/$/, "")
    .replace(/\/v1$/, "");
  const response = await (options.fetcher ?? fetch)(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": options.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: 6000,
      messages: [
        {
          role: "user",
          content: `Design a cute, friendly mascot avatar for a personal assistant app. The person describes it as: "${description}"

Reply with only one SVG and nothing else:
- viewBox="0 0 100 100", a head-and-shoulders character centered and filling about 85% of the box, transparent background.
- Soft, rounded, kawaii style with flat shapes and at most three simple gradients; it must read clearly at 48 pixels.
- Wrap each eye (its shape and highlight) in <g class="eye"> so it can blink.
- Use only svg, g, defs, linearGradient, radialGradient, stop, path, circle, ellipse, rect, line, polyline and polygon. No text, images, style, script, filters, masks, links or external references.
- Keep it under 8,000 characters.`,
        },
      ],
    }),
    signal: AbortSignal.timeout(90000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    content?: { type: string; text?: string }[];
    error?: { message?: string };
  };
  if (!response.ok)
    throw new AppError(
      `Could not design the avatar: ${payload.error?.message ?? `status ${response.status}`}`,
      502,
    );
  const text = (payload.content ?? []).map((block) => block.text ?? "").join("");
  const svg = sanitizeSvg(/<svg[\s\S]*<\/svg>/i.exec(text)?.[0] ?? "");
  if (!svg) throw new AppError("That design didn't come out right. Try describing it again.", 502);
  return svg;
}
