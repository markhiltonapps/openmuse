/**
 * Which link a Feed story opens: one news article, never a site's home page, a section, a topic
 * page or a live-updates hub. Web search often finds those listing pages, and the model can
 * shorten or make up an address, so a story's link is checked against the search results and
 * the page itself.
 */

export type LinkKind = "article" | "listing" | "maybe";

/** Path parts that mark a page listing many stories. */
const LISTING_PART =
  /^(tag|tags|topic|topics|hub|hubs|section|sections|category|categories|search|author|authors|people|profile|live-news|livecoverage|collections?)$/i;
/** A section's name as the whole address: "/world", "/us/politics", "/sports". */
const SECTION =
  /^(news|latest|world|us|u-s|national|local|politics|business|economy|markets|money|tech|technology|science|health|sports?|entertainment|lifestyle|opinion|weather|traffic|video|videos|live|index|home|homepage|rss|feed|feeds|podcasts?|newsletters?|games|shopping|deals|travel|food|style|arts|culture|education|crime|region|regions|state|metro|nation)$/i;
/** Path parts that come just before an article's id. */
const ARTICLE_PART = /^(article|articles|story|stories|news-story|a|p|amp|content)$/i;

export function linkKind(value: string): LinkKind {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "listing";
  }
  if (url.protocol !== "https:") return "listing";
  const parts = url.pathname.split("/").filter(Boolean);
  if (!parts.length) return "listing";
  if (parts.some((part) => LISTING_PART.test(part))) return "listing";
  const last = (parts.at(-1) ?? "").toLowerCase().replace(/\.(s?html?|php|aspx?|cms)$/, "");
  if (parts.length <= 2 && parts.every((part) => SECTION.test(part.replace(/\.s?html?$/, ""))))
    return "listing";
  // A section and a subject in single words: "/politics/congress", "/sports/texans".
  if (parts.length <= 3 && SECTION.test(parts[0] ?? "") && parts.every((p) => /^[a-z]+$/i.test(p)))
    return "listing";
  const path = url.pathname.toLowerCase();
  // A date, a long number, a headline in the address, or an article id after "article/".
  if (/\/(19|20)\d{2}\/\d{1,2}\//.test(path) || /(19|20)\d{2}-\d{2}-\d{2}/.test(path))
    return "article";
  if (/\d{5,}/.test(path)) return "article";
  if (last.split(/[-_]+/).filter((word) => /[a-z]/.test(word)).length >= 4) return "article";
  const before = parts.findIndex((part) => ARTICLE_PART.test(part));
  if (before >= 0 && before < parts.length - 1) return "article";
  return "maybe";
}

/** A link to compare: no tracking parameters, fragment, "www." or trailing slash. */
export function sameLink(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|fbclid|gclid|ocid|cmpid|smid|at_|mc_)/i.test(key)) url.searchParams.delete(key);
    url.hash = "";
    const search = url.searchParams.toString();
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/+$/, "")}${search ? `?${search}` : ""}`;
  } catch {
    return value;
  }
}

/** Sites that usually ask readers to subscribe before they can read. */
const PAYWALLED = [
  "wsj.com",
  "nytimes.com",
  "bloomberg.com",
  "ft.com",
  "washingtonpost.com",
  "economist.com",
  "theatlantic.com",
  "newyorker.com",
  "barrons.com",
  "latimes.com",
  "bostonglobe.com",
  "theinformation.com",
  "seekingalpha.com",
  "telegraph.co.uk",
  "thetimes.co.uk",
  "thetimes.com",
  "hbr.org",
  "foreignpolicy.com",
  "businessinsider.com",
  "wired.com",
  "chron.com",
  "houstonchronicle.com",
  "sfchronicle.com",
  "dallasnews.com",
  "startribune.com",
  "seattletimes.com",
  "inquirer.com",
  "newsday.com",
  "theathletic.com",
  "nymag.com",
  "vanityfair.com",
  "forbes.com",
];
export function paywalled(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return PAYWALLED.some((site) => host === site || host.endsWith(`.${site}`));
  } catch {
    return false;
  }
}

const SKIP = new Set(
  "the a an and or of to in on for with from at by as is are was were be been its it this that these those after before over under into about amid says said new news update updates latest live more than will has have had not but who what when where why how".split(
    " ",
  ),
);
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[’']/g, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !SKIP.has(word)),
  );
/** How much a result's title shares with a headline: the share of the headline's words. */
export function overlap(headline: string, title: string) {
  const [a, b] = [words(headline), words(title)];
  if (!a.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared >= 2 ? shared / a.size : 0;
}

/**
 * The links worth checking for a story, best first: the one the model gave when the search
 * found it, then search results whose titles match the headline. Listing pages never; a free
 * site before one that asks readers to subscribe.
 */
export function articleCandidates(
  story: { headline: string; url?: string },
  sources: { url: string; title: string }[],
  /** Any result will do, in the search's order: for a summary with no headline of its own. */
  anyResult = false,
) {
  const found = new Map(sources.map((s) => [sameLink(s.url), s]));
  const picked: { url: string; fromSearch: boolean }[] = [];
  const add = (url: string, fromSearch: boolean) => {
    if (linkKind(url) === "listing") return;
    if (picked.some((p) => sameLink(p.url) === sameLink(url))) return;
    picked.push({ url, fromSearch });
  };
  if (story.url) add(story.url, found.has(sameLink(story.url)));
  const matches = sources
    .map((source) => ({ source, score: overlap(story.headline, source.title) }))
    .filter((match) => anyResult || match.score >= 0.3)
    .sort((a, b) => (anyResult ? 0 : b.score - a.score));
  for (const match of matches) add(match.source.url, true);
  // Free first, keeping the order otherwise.
  return [...picked.filter((p) => !paywalled(p.url)), ...picked.filter((p) => paywalled(p.url))];
}
