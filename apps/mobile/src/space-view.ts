import type { SpaceKind } from "../../../packages/domain/src/spaces";

/** A space's tabs; each kind shows Overview, its own one or two, and Playbook. */
export type SpaceTab = "overview" | "weeks" | "results" | "food" | "plan" | "playbook";

/**
 * The space shown when Spaces opens (or the list, when asked for), and its tab; kept across visits.
 * `kind` opens that kind of space when no id is known, e.g. "View food log" on the Feed.
 */
export const spacesView: {
  shown?: string;
  kind?: SpaceKind;
  list?: boolean;
  tab: SpaceTab;
} = {
  tab: "overview",
};

/** Sets Spaces to open a kind of space on one of its tabs; then navigate to "spaces". */
export function showSpace(kind: SpaceKind, tab: SpaceTab = "overview") {
  spacesView.shown = undefined;
  spacesView.kind = kind;
  spacesView.list = false;
  spacesView.tab = tab;
}
