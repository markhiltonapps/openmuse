import { FONT_FILES, FONT_NOTES, ICON_SHAPES } from "./assets.ts";

/**
 * The house design kit for websites Neddy builds (owner, 2026-11-08: a quick model, free to improvise
 * layout and with its fonts blocked, once made a roofing site that looked like 2009). The model writes
 * the words and the markup; this file owns everything that makes a page look finished: type, spacing,
 * the grid, buttons, cards, reviews, hours, the footer, a call bar for phones, an icon set and fonts
 * embedded in the page itself (nothing is fetched, so nothing is blocked, slow or tracked).
 */

/** How each heading font wants its weight and tracking (a serif is not set like a geometric sans). */
const HEADING: Record<string, { w: number; t: string }> = {
  Outfit: { w: 800, t: "-.03em" },
  "Plus Jakarta Sans": { w: 800, t: "-.025em" },
  Inter: { w: 700, t: "-.02em" },
  Manrope: { w: 800, t: "-.025em" },
  "DM Sans": { w: 700, t: "-.02em" },
  Fraunces: { w: 600, t: "-.01em" },
};

export const FONT_FAMILIES = Object.keys(FONT_FILES);
export const ICON_NAMES = Object.keys(ICON_SHAPES);

export interface SiteStyle {
  /** The one accent colour, as #rrggbb. */
  accent: string;
  /** The dark colour of the hero, hours card and footer, as #rrggbb. */
  dark?: string;
  headFont: string;
  bodyFont: string;
  /** soft (rounded, friendly) or sharp (square, serious); soft unless given. */
  corners?: "soft" | "sharp";
}

/* ---- colour ---------------------------------------------------------------------------------- */
const parseHex = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number];
};
const toHex = ([r, g, b]: number[]) =>
  `#${[r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const luminance = ([r, g, b]: number[]) => {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r as number) + 0.7152 * lin(g as number) + 0.0722 * lin(b as number);
};
export const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a: number[], b: number[], t: number) =>
  a.map((v, i) => v + ((b[i] as number) - v) * t);
const WHITE = [255, 255, 255];
const INK = [16, 21, 28];

const toHsl = ([r, g, b]: number[]) => {
  const [x, y, z] = [(r as number) / 255, (g as number) / 255, (b as number) / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l] as [number, number, number];
  const d = max - min;
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === x ? (y - z) / d + (y < z ? 6 : 0) : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return [h * 60, sat, l] as [number, number, number];
};
const fromHsl = (h: number, sat: number, l: number) => {
  const a = sat * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
};
/** The accent made lighter or darker with its hue kept (mixing toward black or white makes mud). */
const toLightness = (color: number[], enough: (c: number[]) => boolean, step: number) => {
  const [h, sat, l] = toHsl(color);
  let c = color;
  for (let i = 1; i <= 30 && !enough(c); i++)
    c = fromHsl(h, sat, Math.max(0.02, Math.min(0.98, l + step * i)));
  return c;
};

/** The colours a page needs, worked out from one accent so contrast is always enough. */
export function palette(style: Pick<SiteStyle, "accent" | "dark">) {
  const accent: number[] = parseHex(style.accent) ?? [194, 65, 12];
  // Text on the accent: white unless the accent is light.
  const ink = contrast(accent, WHITE) >= 4.5 ? WHITE : INK;
  // The accent as text on white, darkened with its hue kept until it reads (5.4:1).
  const deep = toLightness(accent, (c) => contrast(c, WHITE) >= 5.4, -0.02);
  // With no dark colour given, one that carries the accent's hue (never the same charcoal for everyone).
  const [h, sat] = toHsl(accent);
  const dark = parseHex(style.dark ?? "") ?? fromHsl(h, Math.min(sat, 0.4), 0.09);
  // The accent as it must look on the dark colour: a button or an icon that is seen (3:1), text that reads (4.5:1).
  const lift = toLightness(accent, (c) => contrast(c, dark) >= 3, 0.03);
  const onDark = toLightness(accent, (c) => contrast(c, dark) >= 4.5, 0.03);
  return {
    accent: toHex(accent),
    ink: toHex(ink),
    deep: toHex(deep),
    soft: toHex(mix(accent, WHITE, 0.9)),
    glow: `rgba(${accent.map(Math.round).join(",")},0.32)`,
    dark: toHex(dark),
    darker: toHex(mix(dark, [0, 0, 0], 0.35)),
    onDark: toHex(onDark),
    lift: toHex(lift),
    liftInk: toHex(contrast(lift, WHITE) >= 4.5 ? WHITE : INK),
    // Neutrals that belong to this palette (a dentist's aren't a roofer's beige).
    surface: toHex(mix(WHITE, dark, 0.045)),
    line: toHex(mix(WHITE, dark, 0.14)),
    line2: toHex(mix(WHITE, dark, 0.24)),
    muted: toHex(mix(dark, WHITE, 0.3)),
    dim: toHex(mix(WHITE, dark, 0.2)),
    dim2: toHex(mix(WHITE, dark, 0.42)),
    ink2: toHex(mix(dark, WHITE, 0.12)),
  };
}

/* ---- the CSS --------------------------------------------------------------------------------- */
export const KIT_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:5rem}
body{margin:0;font:400 1rem/1.6 var(--font-body);color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
h1,h2,h3,h4{font-family:var(--font-head);line-height:1.12;letter-spacing:var(--ht);margin:0;text-wrap:balance}
p{margin:0}
a{color:inherit}
img,svg{max-width:100%}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px;border-radius:.35rem}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:1rem;top:-4rem;background:#fff;color:var(--ink);padding:.7rem 1rem;border-radius:.5rem;z-index:100;font-weight:700}
.skip:focus{top:1rem}
.container{width:min(100% - 2.5rem,72rem);margin-inline:auto}
.section{padding:clamp(3.5rem,8vw,6.25rem) 0}
.section--alt{background:var(--surface);border-block:1px solid var(--line)}
.eyebrow{font-size:.78rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--deep);margin-bottom:.9rem}
.hero .eyebrow,.hours .eyebrow,.footer .eyebrow,.section--dark .eyebrow{color:var(--on-dark)}
.title{font-size:clamp(1.95rem,4.2vw,2.9rem);font-weight:var(--hw)}
.lead{font-size:clamp(1.05rem,1.5vw,1.2rem);color:var(--muted);max-width:44rem;margin-top:1rem;line-height:1.65}
.head{margin-bottom:clamp(2rem,4vw,3rem)}
.head--split{display:flex;justify-content:space-between;align-items:flex-end;gap:1.5rem;flex-wrap:wrap}
.icon{width:1.25rem;height:1.25rem;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}

/* top notice and navigation */
.banner{background:var(--darker);color:#fff;font-size:.875rem;line-height:1.5}
.banner .container{padding:.65rem 0;display:flex;gap:.35rem 1.25rem;flex-wrap:wrap;align-items:center;justify-content:space-between}
.banner b{color:var(--on-dark);font-weight:700}
.banner .dot{display:inline-block;width:.5rem;height:.5rem;border-radius:50%;background:var(--on-dark);margin-right:.6rem;vertical-align:middle}
.nav{position:sticky;top:0;z-index:30;background:rgba(255,255,255,.94);-webkit-backdrop-filter:saturate(1.4) blur(12px);backdrop-filter:saturate(1.4) blur(12px);border-bottom:1px solid var(--line)}
.nav .container{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:4.25rem}
.brand{display:flex;align-items:center;gap:.8rem;text-decoration:none;min-width:0;min-height:2.75rem}
.brand__mark{width:2.6rem;height:2.6rem;border-radius:.7rem;background:var(--dark);color:#fff;display:grid;place-items:center;flex:none}
.brand__mark .icon{width:1.35rem;height:1.35rem}
.brand__name{overflow-wrap:normal;hyphens:none;font:800 1.08rem/1.15 var(--font-head);letter-spacing:-.01em;display:block}
.brand__tag{font-size:.78rem;color:var(--muted);display:block;line-height:1.3}
a[href^="tel:"]{white-space:nowrap}
.links{display:none;gap:2rem;font-size:.92rem;font-weight:600}
.links a{text-decoration:none;color:var(--ink2);padding:.5rem 0}
.links a:hover{color:var(--deep)}
@media(min-width:900px){.links{display:flex}}
@media(max-width:520px){.brand__tag{display:none}.nav .container{gap:.6rem}.brand{gap:.6rem}.brand__mark{width:2.25rem;height:2.25rem}.brand__name{font-size:1rem}.nav .btn{padding:.55rem .85rem;font-size:.9rem;gap:.4rem}}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.6rem;min-height:3rem;padding:.75rem 1.35rem;border-radius:var(--rb);font:700 1rem/1.2 var(--font-body);text-decoration:none;border:1px solid transparent;cursor:pointer;transition:transform .15s ease,filter .15s ease,background .15s ease}
.btn:hover{transform:translateY(-1px);filter:brightness(1.06)}
.btn:active{transform:none}
.btn--primary{background:var(--accent);color:var(--accent-ink);box-shadow:0 6px 18px -6px var(--glow)}
.hero .btn--primary,.hours .btn--primary,.section--dark .btn--primary{background:var(--lift);color:var(--lift-ink);box-shadow:0 0 0 1px rgba(255,255,255,.18),0 8px 22px -8px var(--glow)}
.btn--ghost{background:rgba(255,255,255,.07);color:#fff;border-color:rgba(255,255,255,.28)}
.btn--dark{background:var(--dark);color:#fff}
.btn--outline{background:#fff;color:var(--ink);border-color:var(--line2)}
.btn--lg{min-height:3.4rem;padding:.9rem 1.7rem;font-size:1.05rem}
.btn--block{width:100%}
@media(prefers-reduced-motion:reduce){.btn,.btn:hover{transition:none;transform:none}html{scroll-behavior:auto}}

/* hero */
.hero{position:relative;color:#fff;background:var(--dark);overflow:hidden;isolation:isolate}
.hero::before{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(48rem 26rem at 88% -8%,var(--glow),transparent 70%),linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px) 0 0/44px 44px,linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px) 0 0/44px 44px}
.hero .container{display:grid;gap:2.75rem;align-items:center;padding:clamp(3rem,7vw,5.5rem) 0}
@media(min-width:960px){.hero .container{grid-template-columns:1.2fr .8fr;gap:4rem}}
.hero h1{font-size:clamp(2.35rem,6vw,4.1rem);font-weight:var(--hw);line-height:1.03}
.hero .lead{color:var(--dim);margin-top:1.4rem}
.actions{display:flex;flex-wrap:wrap;gap:.8rem;margin-top:2rem}
.actions .btn{flex:0 1 auto}
@media(max-width:520px){.actions .btn{flex:1 1 100%}}
.proof{display:flex;flex-direction:column;gap:.7rem;margin-top:2.25rem;padding-top:1.5rem;border-top:1px solid rgba(255,255,255,.14);font-size:.95rem;color:var(--dim)}
.proof div{display:flex;gap:.7rem;align-items:center}
.proof .icon{color:var(--on-dark)}
.proof b{color:#fff}
.stars{display:inline-flex;gap:2px;color:#f5b301}
.stars .icon{fill:currentColor;stroke:none;width:1.05rem;height:1.05rem}

.hero--light{background:var(--soft);color:var(--ink)}
.hero--light::before{background:radial-gradient(40rem 22rem at 90% -10%,var(--glow),transparent 70%)}
.hero--light .lead,.hero--light .proof{color:var(--muted)}
.hero--light .proof b{color:var(--ink)}
.hero--light .proof .icon{color:var(--deep)}
.hero--light .eyebrow{color:var(--deep)}
.hero--light .btn--primary{background:var(--accent);color:var(--accent-ink);box-shadow:0 6px 18px -6px var(--glow)}
.hero--light .btn--ghost{color:var(--ink);background:#fff;border-color:var(--line2)}
.hero--light .panel{background:#fff;border-color:var(--line);box-shadow:0 24px 50px -28px rgba(16,21,28,.3)}
.hero--light .facts dt{color:var(--muted)}
.hero--light .facts div{border-color:var(--line)}
.hero--light .panel__art{border-color:var(--line);background:radial-gradient(14rem 8rem at 50% 50%,var(--glow),transparent 70%),repeating-radial-gradient(circle at 50% 50%,transparent 0 2.2rem,rgba(16,21,28,.06) 2.2rem calc(2.2rem + 1px))}
.hero--light .panel__stat{color:var(--ink)}
.hero--light .panel__stat span{color:var(--muted)}
.hero--center .container{grid-template-columns:1fr;text-align:center;justify-items:center}
.hero--center .lead{margin-inline:auto}
.hero--center .actions,.hero--center .proof{justify-content:center}
.hero--center .proof{align-items:center}
.section--dark{background:var(--dark);color:#fff}
.section--dark .lead{color:var(--dim)}
.section--dark .card,.section--dark .review{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.14);box-shadow:none}
.section--dark .card p,.section--dark .review footer span{color:var(--dim)}
.section--dark .review footer{border-color:rgba(255,255,255,.14)}
.section--dark .title,.section--dark h3{color:#fff}

/* the facts panel beside the hero */
.panel{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:var(--rl);padding:1.1rem;box-shadow:0 30px 60px -30px rgba(0,0,0,.6)}
.panel__art{position:relative;border-radius:calc(var(--rl) - .5rem);border:1px solid rgba(255,255,255,.1);aspect-ratio:2.3/1;display:grid;place-items:center;color:var(--accent-ink);background:radial-gradient(14rem 8rem at 50% 50%,var(--glow),transparent 70%),repeating-radial-gradient(circle at 50% 50%,transparent 0 2.2rem,rgba(255,255,255,.06) 2.2rem calc(2.2rem + 1px))}
.panel__art .icon{box-sizing:content-box;width:2.4rem;height:2.4rem;padding:1.3rem;border-radius:1.4rem;background:var(--lift);color:var(--lift-ink);stroke-width:1.8;box-shadow:0 18px 40px -12px var(--glow)}
.panel__stat{display:grid;place-items:center;text-align:center;color:#fff;line-height:1.1}
.panel__stat strong{font:var(--hw) 3.2rem/1 var(--font-head);letter-spacing:var(--ht)}
.panel__stat span{display:block;margin-top:.45rem;font-size:.92rem;color:var(--dim)}
@media(max-width:520px){.panel__art{aspect-ratio:2.6/1}.facts div{flex-direction:column;gap:.15rem;padding:.7rem 0}.facts dd{text-align:left}.facts dt{white-space:normal;font-size:.8rem}.banner{font-size:.8rem}.banner .container{padding:.5rem 0}}
@media(max-width:380px){.nav .btn{padding:.55rem .8rem;font-size:.9rem}.brand__mark{width:2.25rem;height:2.25rem}}
.facts{margin:0;padding:.6rem .5rem .3rem}
.facts div{display:flex;justify-content:space-between;gap:1.5rem;padding:.8rem 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:.93rem}
.facts div:last-child{border-bottom:0}
.facts dt{color:var(--dim2);white-space:nowrap}
.facts dd{margin:0;font-weight:600;text-align:right}
.facts a{text-decoration-thickness:1px;text-underline-offset:3px}

/* cards and grids */
.grid{display:grid;gap:1.25rem}
@media(min-width:640px){.grid--2,.grid--3,.grid--4{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1024px){.grid--3{grid-template-columns:repeat(3,1fr)}.grid--4{grid-template-columns:repeat(4,1fr)}}
.card{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:1.5rem;box-shadow:0 1px 2px rgba(16,21,28,.04);transition:box-shadow .2s ease,transform .2s ease}
.card:hover{box-shadow:0 14px 30px -16px rgba(16,21,28,.25);transform:translateY(-2px)}
.card h3{font-size:1.12rem;font-weight:700;margin:1.1rem 0 .45rem}
.card p{color:var(--muted);font-size:.96rem;line-height:1.6}
.card--row{display:flex;gap:1rem;align-items:flex-start}
.card--row h3{margin-top:0}
.card--row .chip{margin-top:.1rem}
@media(prefers-reduced-motion:reduce){.card,.card:hover{transition:none;transform:none}}
.chip{width:2.9rem;height:2.9rem;border-radius:.8rem;display:grid;place-items:center;background:var(--soft);color:var(--deep);flex:none}
.chip .icon{width:1.45rem;height:1.45rem}
.chip--dark{background:var(--dark);color:#fff}
.chip--sm{width:2.5rem;height:2.5rem}
.group{display:flex;justify-content:space-between;align-items:center;gap:.75rem 1rem;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:.8rem;margin:0 0 1.25rem}
.group:not(:first-child){margin-top:3.25rem}
.head+.group{margin-top:0}
.group h3{font-size:1.15rem;font-weight:700}
.tag{font-size:.72rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:.35rem .75rem;border-radius:999px;background:var(--soft);color:var(--deep);white-space:nowrap}
.tag--quiet{background:var(--surface);color:var(--muted);border:1px solid var(--line)}
.strip{display:flex;justify-content:space-between;align-items:center;gap:1rem 2rem;flex-wrap:wrap;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:1.3rem 1.6rem;margin-top:3rem}
.strip p{font-weight:600;max-width:36rem}
.section--alt .strip{background:#fff}

/* reviews */
.score{display:inline-flex;align-items:center;gap:.9rem;background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:.85rem 1.2rem;box-shadow:0 1px 2px rgba(16,21,28,.04)}
.score strong{font:800 2.1rem/1 var(--font-head)}
.score small{display:block;font-size:.86rem;color:var(--muted);margin-top:.2rem}
.review{margin:0;background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:3.1rem 1.75rem 1.75rem;display:flex;flex-direction:column;gap:1.3rem;position:relative}
.review::before{content:"";position:absolute;left:1.75rem;top:1.6rem;width:2.25rem;height:.28rem;border-radius:9px;background:var(--accent)}
.review p{font-size:1.02rem;line-height:1.7;position:relative}
.review footer{margin-top:auto;border-top:1px solid var(--line);padding-top:1rem;display:flex;justify-content:space-between;align-items:center;gap:.75rem;flex-wrap:wrap;font-size:.92rem}
.review footer b{font-weight:700}
.review footer span{color:var(--muted)}

/* find us */
.find{display:grid;gap:1.5rem;align-items:stretch}
@media(min-width:960px){.find{grid-template-columns:1.25fr .75fr}}
.contact{background:#fff;border:1px solid var(--line);border-radius:var(--rl);padding:.5rem 1.75rem 1.75rem;box-shadow:0 1px 2px rgba(16,21,28,.04)}
.row{display:flex;gap:1rem;align-items:flex-start;padding:1.25rem 0;border-bottom:1px solid var(--line)}
.row small{display:block;font-size:.74rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:.25rem}
.row strong{font-size:1.12rem;font-weight:600;line-height:1.4}
.row p{color:var(--muted);font-size:.93rem;margin-top:.2rem}
.row a,.footer a[href^="tel:"]{display:inline-block;padding:.45rem 0;text-underline-offset:3px}
.contact .actions{margin-top:1.5rem}
.hours{display:flex;flex-direction:column;background:var(--dark);color:#fff;border-radius:var(--rl);padding:1.75rem}
.hours h3 .chip{background:var(--lift);color:var(--lift-ink)}
.hours h3{display:flex;align-items:center;gap:.8rem;font-size:1.3rem}
.hours dl{margin:1.1rem 0 0;flex:1;display:flex;flex-direction:column;justify-content:space-between}
.hours dl div{display:flex;justify-content:space-between;gap:1rem;padding:.95rem 0;border-bottom:1px solid rgba(255,255,255,.12)}
.hours dl div:last-child{border-bottom:0;padding-bottom:0}
.hours dt{color:var(--dim)}
.hours dd{margin:0;font-weight:700;text-align:right}
.hours .off{color:var(--on-dark)}

/* footer and call bar */
.footer{background:var(--darker);color:var(--dim);font-size:.93rem}
.footer .container{display:flex;flex-wrap:wrap;justify-content:space-between;gap:1.5rem 3rem;padding:2.5rem 0}
.footer b{color:#fff;font:700 1.05rem var(--font-head);display:block;margin-bottom:.35rem}
.footer a{text-underline-offset:3px}
.notice{border:1px solid rgba(255,255,255,.16);border-radius:.9rem;padding:1rem 1.25rem;max-width:30rem;line-height:1.55}
.notice strong{color:#fff}
.callbar{position:fixed;left:0;right:0;bottom:0;z-index:40;display:none;padding:.65rem 1rem calc(.65rem + env(safe-area-inset-bottom));background:rgba(255,255,255,.96);border-top:1px solid var(--line);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
@media(max-width:767px){.callbar{display:block}body{padding-bottom:4.9rem}}
@supports(animation-timeline:scroll()){@media(max-width:767px){.callbar{animation:cb-in linear both;animation-timeline:scroll(root);animation-range:0 26rem}@keyframes cb-in{from{transform:translateY(110%);visibility:hidden}to{transform:none;visibility:visible}}}}
`;

/* ---- the page -------------------------------------------------------------------------------- */
const esc = (v: string) =>
  v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** The @font-face rules for just the families a page uses. */
export function fontFaces(families: string[]) {
  return [...new Set(families)]
    .filter((f) => f in FONT_FILES)
    .map(
      (family) =>
        `@font-face{font-family:"${family}";font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,${FONT_FILES[family]}) format("woff2")}`,
    )
    .join("");
}

/** The icon sprite, with only the icons the markup asks for (<use href="#i-phone">). */
export function iconSprite(markup: string) {
  const wanted = new Set([...markup.matchAll(/#i-([a-z0-9-]+)/g)].map((m) => m[1] as string));
  const symbols = [...wanted]
    .filter((name) => name in ICON_SHAPES)
    .map((name) => `<symbol id="i-${name}" viewBox="0 0 24 24">${ICON_SHAPES[name]}</symbol>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${symbols}</svg>`;
}

/** Page CSS made safe in code (not left to a check): nothing that closes the style tag, loads or runs. */
export function cleanCss(css: string) {
  return css
    .replace(/[<>]/g, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/expression\s*\([^)]*\)/gi, "none")
    .replace(/behavior\s*:[^;}]*/gi, "")
    .replace(/-moz-binding\s*:[^;}]*/gi, "")
    .replace(/\\/g, "");
}

const FALLBACK = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

export interface SiteInput extends Omit<SiteStyle, "corners"> {
  /** soft or sharp; anything else is taken as soft (the checks say so). */
  corners?: string;
  title: string;
  description?: string;
  /** What goes inside <body>: markup using the kit's classes, and no scripts. */
  body: string;
  /** A little CSS of the page's own, if the kit lacks something (kept short). */
  extraCss?: string;
  lang?: string;
}

/** A complete, self-contained page: fonts, kit, icons and the model's markup. */
export function assembleSite(input: SiteInput) {
  const p = palette(input);
  const head = FONT_FAMILIES.includes(input.headFont) ? input.headFont : "Outfit";
  const body = FONT_FAMILIES.includes(input.bodyFont) ? input.bodyFont : "Plus Jakarta Sans";
  const sharp = input.corners === "sharp";
  const weight = HEADING[head] ?? { w: 800, t: "-.025em" };
  const tokens = `:root{--accent:${p.accent};--accent-ink:${p.ink};--deep:${p.deep};--soft:${p.soft};--glow:${p.glow};--dark:${p.dark};--darker:${p.darker};--on-dark:${p.onDark};--ink:#10151c;--muted:${p.muted};--bg:#fff;--surface:${p.surface};--line:${p.line};--line2:${p.line2};--dim:${p.dim};--dim2:${p.dim2};--ink2:${p.ink2};--lift:${p.lift};--lift-ink:${p.liftInk};--r:${sharp ? ".4rem" : "1.1rem"};--rb:${sharp ? ".35rem" : ".8rem"};--rl:${sharp ? ".5rem" : "1.25rem"};--hw:${weight.w};--ht:${weight.t};--font-head:"${head}",${FALLBACK};--font-body:"${body}",${FALLBACK}}`;
  return `<!doctype html><html lang="${esc(input.lang ?? "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="${p.dark}"><title>${esc(input.title)}</title>${input.description ? `<meta name="description" content="${esc(input.description)}">` : ""}<style>${fontFaces([head, body])}${tokens}${KIT_CSS}${cleanCss(input.extraCss ?? "")}</style></head><body><a class="skip" href="#main">Skip to the content</a>${iconSprite(input.body)}${input.body}</body></html>`;
}

/** The kit's classes and icons, written for the model that builds the page. */
export function kitGuide() {
  const fonts = Object.entries(FONT_NOTES)
    .map(([name, note]) => `${name} (${note.role}: ${note.about})`)
    .join("; ");
  return `FONTS (embedded in the page; use only these names): ${fonts}.
ICONS: <svg class="icon" aria-hidden="true"><use href="#i-NAME"/></svg>, NAME one of: ${ICON_NAMES.join(", ")}.

KIT CLASSES (the page's CSS is added for you; write only markup):
- Layout: .container (centred, max 72rem), .section, .section--alt (tinted band), .head (+ .head--split) holding .eyebrow, h2.title and p.lead.
- Top: .banner > .container (a thin notice bar; use <span class="dot"></span> and <b>). Then header.nav > .container with a.brand (span.brand__mark holding an icon, span.brand__name, span.brand__tag), nav.links with a few in-page links, and a.btn.btn--primary call button.
- Hero: section.hero (add hero--light for a bright, airy hero (bakeries, dentists, salons, boutiques, anything friendly), or hero--center for one centred column with no panel; the default dark hero suits trades, law, finance and tech) > .container with a text column (p.eyebrow, h1, p.lead, .actions of a.btn.btn--primary.btn--lg and a.btn.btn--ghost.btn--lg, .proof with div rows of an icon and a line; .stars is a row of five <svg class="icon"><use href="#i-star"/></svg>) and aside.panel (div.panel__art with one big icon, dl.facts of div > dt + dd rows). Instead of an icon the panel__art can show real data: div.panel__stat > strong ("5.0 ★") + span ("46 Google reviews").
- A dark band mid-page for a testimonial or call to action: section.section.section--dark (its .eyebrow, .title, cards and reviews restyle themselves).
- Cards: .grid.grid--2 / .grid--3 / .grid--4 of .card (div.chip with an icon, h3, p) or .card.card--row (chip beside text). .chip--dark, .chip--sm. A heading row for a group of cards: div.group > h3 and span.tag (or .tag--quiet). A call strip under cards: div.strip > p and a.btn.btn--dark.
- Reviews: div.score (stars, strong, small), then .grid.grid--3 of blockquote.review > p + footer (b name, span detail).
- Find us: .find > div.contact (div.row with a chip, then small label, strong value and p note) and div.hours (h3, dl of div > dt + dd; add class off on dd for Closed).
- Footer: footer.footer > .container with the business block (b name, address) and div.notice. Last: div.callbar with one a.btn.btn--primary.btn--block (shown on phones only).
- Buttons: .btn plus .btn--primary, .btn--ghost (on dark), .btn--dark, .btn--outline, .btn--lg, .btn--block.
- The main content wrapper must be <main id="main">.`;
}
