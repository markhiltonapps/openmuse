/**
 * Moving backdrops behind the app (owner, 2026-10-09): short looping clips from Mixkit (free
 * licence, apps/mobile/public/backdrops/CREDITS.txt), each with a still frame. Shared by the app
 * (picker, video layer) and the server (the setting and the agent's change_backdrop tool).
 *
 * `focus` is where a phone's tall screen crops the landscape clip; `bright` scenes get a deeper
 * shade so white text stays readable.
 */
export interface Backdrop {
  id: string;
  name: string;
  group: string;
  focus: string;
  bright?: boolean;
  /** Extra words people may say for it ("the city", "aurora"). */
  words: string[];
}

export const BACKDROPS: Backdrop[] = [
  {
    id: "beach-sunset",
    name: "Beach at sunset",
    group: "Beach",
    focus: "62% 50%",
    words: ["beach", "sunset", "ocean", "sea"],
  },
  {
    id: "waves-close",
    name: "Waves up close",
    group: "Beach",
    focus: "55% 50%",
    words: ["waves", "shore", "sand"],
  },
  {
    id: "above-clouds",
    name: "Above the clouds",
    group: "Mountains",
    focus: "42% 50%",
    words: ["clouds", "peak", "dusk"],
  },
  {
    id: "alps",
    name: "Snowy peaks",
    group: "Mountains",
    focus: "74% 50%",
    bright: true,
    words: ["mountains", "alps", "snow"],
  },
  {
    id: "city-lights",
    name: "City lights",
    group: "City at night",
    focus: "50% 50%",
    words: ["city", "lights", "skyline"],
  },
  {
    id: "downtown",
    name: "Downtown at night",
    group: "City at night",
    focus: "45% 50%",
    words: ["downtown", "buildings"],
  },
  {
    id: "night-avenue",
    name: "Busy street",
    group: "City at night",
    focus: "50% 50%",
    words: ["street", "avenue", "traffic"],
  },
  {
    id: "forest-rain",
    name: "Rain in the forest",
    group: "Rain",
    focus: "45% 50%",
    words: ["rain", "rainy"],
  },
  {
    id: "pine-drops",
    name: "Raindrops on pine",
    group: "Rain",
    focus: "40% 50%",
    words: ["raindrops", "drops", "pine"],
  },
  {
    id: "misty-forest",
    name: "Misty forest",
    group: "Forest",
    focus: "62% 50%",
    bright: true,
    words: ["forest", "mist", "fog", "trees"],
  },
  {
    id: "forest-stream",
    name: "Forest stream",
    group: "Forest",
    focus: "55% 50%",
    words: ["stream", "creek", "river", "woods"],
  },
  {
    id: "northern-lights",
    name: "Northern lights",
    group: "Night sky",
    focus: "45% 50%",
    words: ["northern", "aurora", "lights"],
  },
  {
    id: "aurora-dawn",
    name: "Aurora at dawn",
    group: "Night sky",
    focus: "64% 50%",
    words: ["aurora", "dawn"],
  },
  {
    id: "starry-lake",
    name: "Starry lake",
    group: "Night sky",
    focus: "50% 50%",
    words: ["stars", "lake", "night"],
  },
  {
    id: "milky-way",
    name: "Milky Way",
    group: "Night sky",
    focus: "50% 50%",
    words: ["milky", "galaxy", "stars", "space"],
  },
];

/** What a new account starts with (owner, 2026-10-09). */
export const DEFAULT_BACKDROP = "beach-sunset";
/** The plain look, with no backdrop. */
export const NO_BACKDROP = "none";

export function backdropById(id: string | undefined): Backdrop | undefined {
  return BACKDROPS.find((b) => b.id === id);
}

/** The groups in picker order, each with its scenes. */
export function backdropGroups(): { group: string; items: Backdrop[] }[] {
  const groups: { group: string; items: Backdrop[] }[] = [];
  for (const backdrop of BACKDROPS) {
    const group = groups.find((g) => g.group === backdrop.group);
    if (group) group.items.push(backdrop);
    else groups.push({ group: backdrop.group, items: [backdrop] });
  }
  return groups;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(
      (w) => w.length > 2 && !["the", "and", "with", "backdrop", "background", "one"].includes(w),
    );

/**
 * The scene someone means: "the city", "northern lights", "rain", or "none" / "plain" for no
 * backdrop. An exact name or id wins, then the most matching words; ties go to the first in the
 * list, so "the city" is City lights. Undefined when nothing matches.
 */
export function findBackdrop(said: string): string | undefined {
  const text = said.trim().toLowerCase();
  if (!text) return undefined;
  if (/^(none|no backdrop|off|plain|nothing|turn (it )?off)\b/.test(text)) return NO_BACKDROP;
  const exact = BACKDROPS.find((b) => b.id === text || b.name.toLowerCase() === text);
  if (exact) return exact.id;
  const asked = words(text);
  let best: Backdrop | undefined;
  let bestScore = 0;
  for (const backdrop of BACKDROPS) {
    const own = new Set([...words(backdrop.name), ...words(backdrop.group), ...backdrop.words]);
    // "snowy" finds "snow", "mountain" finds "mountains".
    const near = (w: string) =>
      [...own].some(
        (o) => Math.min(o.length, w.length) >= 4 && (w.startsWith(o) || o.startsWith(w)),
      );
    const score = asked.filter((w) => own.has(w) || near(w)).length;
    if (score > bestScore) {
      best = backdrop;
      bestScore = score;
    }
  }
  return best?.id;
}
