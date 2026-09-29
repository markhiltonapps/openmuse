import {
  Check,
  ChefHat,
  Clock,
  ExternalLink,
  MessageCircle,
  Plus,
  Users,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Linking,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  cooked,
  type FamilyWeek,
  type GroceryItem,
  WEEKDAYS,
  type WeekDinner,
} from "../../../packages/domain/src/family-week";
import { heading } from "./spaces";
import { Button, colors, ErrorNotice, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * A dinner's recipes in its sheet: pick one of two or three (the grocery list follows the pick),
 * its ingredients and whether they're on the list, the steps, and real recipe pages to open. A
 * night without recipes can have them written; a night with nothing to cook says so. Toasts sit
 * under the sheet, so what a tap did is said in the sheet itself.
 */

type Change = (
  path: string,
  body: unknown,
  optimistic?: (week: FamilyWeek) => FamilyWeek,
  options?: { quiet?: boolean },
) => Promise<FamilyWeek | undefined>;

const key = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
/** The server's rule for the same grocery: "Lime" and "limes", "Tomato" and "tomatoes". */
function same(a: string, b: string) {
  const [x, y] = [key(a), key(b)];
  return x === y || `${x}s` === y || `${y}s` === x || `${x}es` === y || `${y}es` === x;
}
const onList = (groceries: GroceryItem[], item: string) =>
  groceries.find((g) => same(g.item, item));
/** "25 min", "1 hr 10 min" */
const minutes = (n: number) =>
  n >= 60 ? `${Math.floor(n / 60)} hr${n % 60 ? ` ${n % 60} min` : ""}` : `${n} min`;
const site = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
/** "bell peppers, red onion and 2 more" */
function names(items: string[]) {
  const shown = items.slice(0, 3).map((i) => i.toLowerCase());
  const more = items.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0];
}
/** The items a change put on the list. */
const addedTo = (before: GroceryItem[], after: GroceryItem[]) =>
  after.filter((a) => !before.some((b) => same(b.item, a.item))).map((a) => a.item);
/** What a pick did to the grocery list, in a sentence. */
function listChange(before: GroceryItem[], after: GroceryItem[]) {
  const added = addedTo(before, after);
  const removed = addedTo(after, before);
  const parts = [
    added.length ? `Added ${names(added)} to the list` : "",
    removed.length
      ? added.length
        ? `took ${names(removed)} off`
        : `Took ${names(removed)} off the list`
      : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join("; ")}.` : "The grocery list already had everything.";
}
/** Moves the keyboard's and a screen reader's place to `target`, e.g. once recipes arrive. */
function focusOn(target: View | Text | null) {
  if (!target) return;
  if (Platform.OS === "web") {
    const node = target as unknown as HTMLElement;
    node.setAttribute?.("tabindex", "-1");
    node.focus?.();
    return;
  }
  const handle = findNodeHandle(target);
  if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
}
/** A failed call's reason, or plain words when the connection dropped. */
const reason = (e: unknown, fallback: string) =>
  e instanceof TypeError || !(e instanceof Error) ? fallback : e.message;
/** "27 min (15 prep, 12 cook)" */
function timing(prep?: number, cook?: number) {
  if (prep === undefined && cook === undefined) return undefined;
  const total = (prep ?? 0) + (cook ?? 0);
  const parts = [
    prep !== undefined ? (prep ? `${prep} prep` : "no prep") : "",
    cook !== undefined ? (cook ? `${cook} cook` : "no cooking") : "",
  ].filter(Boolean);
  return `${minutes(total)} (${parts.join(", ")})`;
}

export function DinnerRecipes({
  spaceId,
  agentName,
  week,
  dinner,
  writing,
  change,
  reload,
  onSwap,
}: {
  spaceId: string;
  agentName: string;
  week: FamilyWeek;
  dinner: WeekDinner;
  /** The night's recipes are being written now, after the week was planned. */
  writing?: boolean;
  change: Change;
  /** Fetches the board again, after recipes are written. */
  reload: () => Promise<unknown>;
  /** Asks the agent in chat for a different dinner that night. */
  onSwap: () => void;
}) {
  const { api } = useWorkspace();
  const [busy, setBusy] = useState("");
  // What went wrong, shown next to what was tapped.
  const [problem, setProblem] = useState<{ at: "write" | "pick" | "add"; text: string }>();
  // What the last pick and the last add did to the list, said where the tap was.
  const [picked, setPicked] = useState("");
  const [added, setAdded] = useState("");
  const top = useRef<Text>(null);
  const listNote = useRef<Text>(null);
  const arrived = useRef(false);
  const recipes = dinner.recipes ?? [];
  const chosen = Math.min(Math.max(dinner.chosen ?? 0, 0), Math.max(recipes.length - 1, 0));
  const recipe = recipes[chosen];
  const night = WEEKDAYS[dinner.day] ?? "";
  const waiting = busy === "write" || !!writing;
  // Recipes that arrive while the sheet waits for them replace the button that was focused, so
  // the place moves to them.
  useEffect(() => {
    if (!recipe && waiting) arrived.current = true;
    if (recipe && arrived.current) {
      arrived.current = false;
      focusOn(top.current);
    }
  }, [recipe, waiting]);
  const swap = (
    <Button icon={MessageCircle} disabled={!!busy} onPress={onSwap}>
      Ask {agentName} for a different dinner
    </Button>
  );
  async function write() {
    const failed = "Couldn’t write recipes just now. Try again in a minute.";
    setBusy("write");
    setProblem(undefined);
    try {
      const result = await api.request<{ written: string[] }>(
        `/api/spaces/${spaceId}/weeks/${week.weekStart}/recipes`,
        { day: dinner.day },
      );
      await reload();
      if (!result.written.length) setProblem({ at: "write", text: failed });
    } catch (e) {
      setProblem({ at: "write", text: reason(e, failed) });
    } finally {
      setBusy("");
    }
  }
  if (!recipe)
    return (
      <View style={{ gap: 12 }}>
        {/* One line that's always there, so a screen reader hears it change. */}
        <Text role="status" aria-live="polite" style={[s.text, { color: colors.mutedStrong }]}>
          {waiting
            ? "Writing recipes. This can take up to a minute."
            : cooked(dinner)
              ? "No recipes for this night yet."
              : "Nothing to cook this night, so there are no recipes."}
        </Text>
        <ErrorNotice error={problem?.at === "write" ? problem.text : ""} />
        <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
          {cooked(dinner) && (
            <Button
              primary
              icon={ChefHat}
              busy={waiting}
              disabled={!!busy || writing}
              onPress={() => void write()}
            >
              Get recipes
            </Button>
          )}
          {swap}
        </View>
      </View>
    );
  const missing = recipe.ingredients.filter((i) => !i.have && !onList(week.groceries, i.item));
  async function pick(index: number) {
    if (index === chosen || busy) return;
    setBusy(`pick-${index}`);
    setProblem(undefined);
    setAdded("");
    const before = week.groceries;
    // The sheet says what went wrong itself, so no toast (it would sit under the sheet).
    const saved = await change(
      `/dinners/${dinner.day}/choose`,
      { recipe: index },
      (w) => ({
        ...w,
        dinners: w.dinners.map((d) => (d.day === dinner.day ? { ...d, chosen: index } : d)),
      }),
      { quiet: true },
    );
    setBusy("");
    if (saved) setPicked(`Cooking ${recipes[index]?.name}. ${listChange(before, saved.groceries)}`);
    else setProblem({ at: "pick", text: "Couldn’t switch recipes. Try again." });
  }
  /** Puts the recipe's missing items on the list, or one it expects the family to have. */
  async function add(what: "missing" | { item: string; qty?: string; aisle?: string }) {
    setBusy(what === "missing" ? "add" : `add-${what.item}`);
    setProblem(undefined);
    const before = week.groceries;
    const saved = await change(
      what === "missing" ? `/dinners/${dinner.day}/groceries` : "/groceries",
      what === "missing" ? {} : what,
      undefined,
      { quiet: true },
    );
    setBusy("");
    if (!saved) {
      setProblem({ at: "add", text: "Couldn’t add that to the grocery list. Try again." });
      return;
    }
    const items = addedTo(before, saved.groceries);
    const done = what === "missing" ? " Everything to buy is on it now." : "";
    setAdded(items.length ? `Added ${names(items)} to the list.${done}` : "");
    // The button that was pressed is gone now, so the place moves to what happened.
    focusOn(listNote.current);
  }
  const time = timing(recipe.prepMinutes, recipe.cookMinutes);
  const listNoteText = missing.length
    ? added
    : added || "Everything to buy is on the grocery list.";
  const picking = busy.startsWith("pick");
  return (
    <View style={{ gap: 22 }}>
      {recipes.length > 1 && (
        <View style={{ gap: 10 }}>
          <View style={{ gap: 2 }}>
            <Text {...heading(3)} ref={top} style={s.heading}>
              Pick a recipe
            </Text>
            <Text role="status" aria-live="polite" style={[s.muted, { color: colors.mutedStrong }]}>
              {picked || "Your pick’s ingredients go on the grocery list."}
            </Text>
          </View>
          <View role="radiogroup" aria-label={`Recipes for ${night}`} style={{ gap: 8 }}>
            {recipes.map((r, i) => {
              const on = i === chosen;
              const total = (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);
              return (
                <Pressable
                  // biome-ignore lint/suspicious/noArrayIndexKey: the recipes keep their order.
                  key={i}
                  role="radio"
                  aria-checked={on}
                  aria-label={`${r.name}${total ? `, ${minutes(total)} in all` : ""}${r.about ? `. ${r.about}` : ""}`}
                  disabled={!!busy}
                  onPress={() => void pick(i)}
                  style={({ pressed }) => [
                    s.row,
                    {
                      gap: 12,
                      minHeight: 56,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 16,
                      borderWidth: 2,
                      borderColor: on ? colors.blueDark : colors.line,
                      backgroundColor: on ? colors.sky : pressed ? colors.subtle : colors.surface,
                    },
                  ]}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      borderWidth: 2,
                      borderColor: on ? colors.blueDark : colors.muted,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {on && (
                      <View
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: colors.blueDark,
                        }}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[s.text, { fontWeight: "600" }]}>{r.name}</Text>
                    {!!r.about && (
                      <Text numberOfLines={2} style={[s.muted, { color: colors.mutedStrong }]}>
                        {r.about}
                      </Text>
                    )}
                  </View>
                  {total > 0 && (
                    <Text
                      style={[
                        s.muted,
                        {
                          fontSize: 13,
                          lineHeight: 18,
                          fontWeight: "600",
                          color: colors.mutedStrong,
                        },
                      ]}
                    >
                      {minutes(total)}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
          <ErrorNotice error={problem?.at === "pick" ? problem.text : ""} />
        </View>
      )}

      <View style={{ gap: 8 }}>
        <Text
          {...heading(3)}
          ref={recipes.length > 1 ? undefined : top}
          style={[s.heading, { fontSize: 19, lineHeight: 25, letterSpacing: -0.4 }]}
        >
          {recipe.name}
        </Text>
        {!!recipe.about && recipes.length === 1 && (
          <Text style={[s.text, { color: colors.mutedStrong }]}>{recipe.about}</Text>
        )}
        <View style={[s.row, { columnGap: 14, rowGap: 4, flexWrap: "wrap" }]}>
          {!!recipe.serves && (
            <View style={[s.row, { gap: 6 }]}>
              <Users size={15} color={colors.mutedStrong} />
              <Text style={[s.muted, { color: colors.mutedStrong }]}>Serves {recipe.serves}</Text>
            </View>
          )}
          {!!time && (
            <View style={[s.row, { gap: 6 }]}>
              <Clock size={15} color={colors.mutedStrong} />
              <Text style={[s.muted, { color: colors.mutedStrong }]}>{time}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <Text {...heading(3)} style={s.heading}>
          Ingredients
        </Text>
        {/* Dimmed while a pick saves, since the list below is about to change. */}
        <View style={{ opacity: picking ? 0.5 : 1 }}>
          {recipe.ingredients.map((ingredient, i) => {
            const listed = onList(week.groceries, ingredient.item);
            const status = listed
              ? listed.done
                ? "In the cart"
                : "On the list"
              : ingredient.have
                ? "At home"
                : "Not on the list";
            return (
              <View
                // biome-ignore lint/suspicious/noArrayIndexKey: a recipe's ingredients never reorder.
                key={i}
                style={[
                  s.row,
                  {
                    gap: 10,
                    alignItems: "flex-start",
                    paddingVertical: 8,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: colors.line,
                  },
                ]}
              >
                <View
                  style={{ width: 18, height: 23, alignItems: "center", justifyContent: "center" }}
                >
                  {listed || ingredient.have ? (
                    <Check size={16} color={listed ? colors.greenText : colors.muted} />
                  ) : (
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: colors.muted,
                      }}
                    />
                  )}
                </View>
                <Text style={[s.text, { flex: 1 }]}>
                  {!!ingredient.qty && <Text style={{ fontWeight: "600" }}>{ingredient.qty} </Text>}
                  {ingredient.item}
                </Text>
                <Text
                  style={[
                    s.small,
                    {
                      fontSize: 12,
                      lineHeight: 23,
                      color: listed ? colors.greenText : colors.mutedStrong,
                    },
                  ]}
                >
                  {status}
                </Text>
                {!listed && ingredient.have && (
                  // Something the recipe expects at home can still go on the list if it's run out.
                  <Pressable
                    role="button"
                    aria-label={`Add ${ingredient.item} to groceries`}
                    disabled={!!busy}
                    onPress={() =>
                      void add({
                        item: ingredient.item,
                        ...(ingredient.qty ? { qty: ingredient.qty } : {}),
                        ...(ingredient.aisle ? { aisle: ingredient.aisle } : {}),
                      })
                    }
                    // A full-size target around a small pill, without making the row taller.
                    style={{
                      minHeight: 44,
                      minWidth: 44,
                      marginVertical: -10.5,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {({ pressed }) => (
                      <View
                        style={[
                          s.row,
                          {
                            gap: 3,
                            height: 23,
                            paddingHorizontal: 8,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: colors.line,
                            backgroundColor: pressed ? colors.subtle : colors.surface,
                            opacity: busy && busy !== `add-${ingredient.item}` ? 0.5 : 1,
                          },
                        ]}
                      >
                        <Plus size={13} color={colors.blueDark} />
                        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.blueDark }}>
                          Add
                        </Text>
                      </View>
                    )}
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
        {missing.length > 0 && (
          <Button
            icon={Plus}
            busy={busy === "add"}
            disabled={!!busy}
            style={{ alignSelf: "flex-start" }}
            onPress={() => void add("missing")}
          >
            {missing.length === 1
              ? "Add the missing item to groceries"
              : `Add ${missing.length} missing items to groceries`}
          </Button>
        )}
        <ErrorNotice error={problem?.at === "add" ? problem.text : ""} />
        {/* Always there, so what an add did is read out; it says so when nothing's missing. */}
        {/* Empty until something's added; it takes no room then, but a screen reader keeps it. */}
        <View
          style={[s.row, { gap: 6, alignItems: "flex-start" }, !listNoteText && { marginTop: -10 }]}
        >
          {!missing.length && (
            <View style={{ height: 21, justifyContent: "center" }}>
              <Check size={15} color={colors.greenText} />
            </View>
          )}
          <Text
            ref={listNote}
            role="status"
            aria-live="polite"
            style={[s.muted, { flex: 1, color: colors.mutedStrong }]}
          >
            {listNoteText}
          </Text>
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <Text {...heading(3)} style={s.heading}>
          Steps
        </Text>
        {recipe.steps.map((step, i) => (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: steps are numbered by their place.
            key={i}
            style={[s.row, { gap: 12, alignItems: "flex-start" }]}
          >
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: colors.subtle,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>{i + 1}</Text>
            </View>
            <Text style={[s.text, { flex: 1, paddingTop: 1 }]}>{step}</Text>
          </View>
        ))}
      </View>

      {!!dinner.links?.length && (
        <View style={{ gap: 6 }}>
          <Text {...heading(3)} style={s.heading}>
            More recipes online
          </Text>
          {dinner.links.map((link) => (
            <Pressable
              key={link.url}
              role="link"
              aria-label={`${link.title}, on ${site(link.url)}, opens in your browser`}
              onPress={() => void Linking.openURL(link.url)}
              style={({ pressed }) => [
                s.row,
                {
                  gap: 12,
                  minHeight: 52,
                  paddingHorizontal: 12,
                  marginHorizontal: -12,
                  borderRadius: 14,
                  backgroundColor: pressed ? colors.subtle : "transparent",
                },
              ]}
            >
              <ExternalLink size={16} color={colors.blueDark} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2} style={[s.text, { fontWeight: "500" }]}>
                  {link.title}
                </Text>
                <Text style={[s.small, { color: colors.mutedStrong }]}>{site(link.url)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <View style={{ alignItems: "flex-start" }}>{swap}</View>
    </View>
  );
}
