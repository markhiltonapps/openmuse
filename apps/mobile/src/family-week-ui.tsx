import { Check, Plus, RotateCcw, Search, Share2, Star } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  dishEmoji,
  type FamilyWeek,
  type GroceryItem,
  WEEKDAYS,
  type WeekDinner,
  type WeekSummary,
} from "../../../packages/domain/src/family-week";
import type { FamilySpace } from "../../../packages/domain/src/spaces";
import { Emoji } from "./emoji";
import { DinnerRecipes } from "./recipe-ui";
import { heading, replace, useOpenChat } from "./spaces";
import { dark } from "./theme";
import { Button, Card, colors, ErrorNotice, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * A family space's week as a board (dinners, groceries to tick off, chore stars, ideas) and
 * "Our weeks", the weeks before it.
 */

export interface Board {
  /** The week on the board: this one, or next week's on a weekend once it's planned. */
  week: FamilyWeek | null;
  /** This week, for today's timeline. */
  current: FamilyWeek | null;
  /** Today, Monday 0 to Sunday 6. */
  today: number;
  thisWeek: string;
  nextWeek: string;
  nextPlanned: boolean;
  past: WeekSummary[];
  /** The nights (Monday 0) whose recipes are being written now. */
  recipesWriting?: number[];
}
/** Tonight's place on the board, when the board shows this week. */
export const tonight = (board: Board) =>
  board.week && board.week.weekStart === board.thisWeek ? board.today : undefined;

const noon = (date: string) => new Date(`${date}T12:00:00`);
const monthDay = (date: string) =>
  noon(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** "Sep 28 – Oct 4". */
export { monthDay };
export function weekRange(weekStart: string) {
  const end = noon(weekStart);
  end.setDate(end.getDate() + 6);
  // The end day from the device's own calendar: toISOString would give UTC's, a day off east of it.
  const day = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return `${monthDay(weekStart)} – ${monthDay(day)}`;
}
const plannedOn = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "long" });

/** Each person's colours: a strong one for their avatar and stars, a light one behind them. */
const PEOPLE = dark
  ? [
      { strong: "#55AAFF", soft: "#0E2130" },
      { strong: "#2BD46E", soft: "#0F2619" },
      { strong: "#F0A35E", soft: "#2B2012" },
      { strong: "#B69CFF", soft: "#1C1930" },
    ]
  : [
      { strong: "#1473C8", soft: "#EDF7FD" },
      { strong: "#147A45", soft: "#E3F3E8" },
      { strong: "#A5540A", soft: "#FDF0DF" },
      { strong: "#6B46C1", soft: "#F0EEFA" },
    ];
function personColor(space: FamilySpace, name: string) {
  const first =
    name
      .trim()
      .split(/[\s,(]/)[0]
      ?.toLowerCase() ?? "";
  const index = space.playbook.family.findIndex((m) => m.name.toLowerCase() === first);
  const at = index >= 0 ? index : [...first].reduce((n, c) => n + c.charCodeAt(0), 0);
  return PEOPLE[at % PEOPLE.length] as (typeof PEOPLE)[number];
}
function Avatar({ name, color, size = 30 }: { name: string; color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{ color: dark ? "#000000" : "#FFFFFF", fontSize: size * 0.42, fontWeight: "700" }}
      >
        {name.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

/** The board and the calls that change it, refreshed when the app comes back to the front. */
export function useWeekBoard(space: FamilySpace) {
  const { api, notify } = useWorkspace();
  const [board, setBoard] = useState<Board>();
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api.request<Board>(`/api/spaces/${space.id}/weeks`).then(
        (value) => {
          setBoard(value);
          setError("");
        },
        (e) => setError(e instanceof Error ? e.message : String(e)),
      ),
    [api, space.id],
  );
  useEffect(() => {
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => listener.remove();
  }, [load]);
  // While recipes are on the way, look again every so often so they show up on their own.
  const waiting = Boolean(board?.recipesWriting?.length);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 12000);
    return () => clearInterval(timer);
  }, [waiting, load]);
  /**
   * A change on the board's week, shown at once and undone if it doesn't save. Resolves with the
   * saved week, or undefined when it didn't save; `quiet` leaves saying so to the caller.
   */
  const change = useCallback(
    async (
      path: string,
      body: unknown,
      optimistic?: (week: FamilyWeek) => FamilyWeek,
      options: { quiet?: boolean } = {},
    ): Promise<FamilyWeek | undefined> => {
      const week = board?.week;
      if (!week) return undefined;
      if (optimistic) setBoard((b) => (b?.week ? { ...b, week: optimistic(b.week) } : b));
      try {
        const saved = await api.request<FamilyWeek>(
          `/api/spaces/${space.id}/weeks/${week.weekStart}${path}`,
          body,
        );
        setBoard((b) =>
          b ? { ...b, week: saved, current: b.current?.id === saved.id ? saved : b.current } : b,
        );
        return saved;
      } catch {
        setBoard((b) => (b ? { ...b, week } : b));
        if (!options.quiet) notify("Couldn’t save that. Try again.");
        // The week may have changed underneath (a recipe rewritten, say): show it as it is.
        void load();
        return undefined;
      }
    },
    [api, board?.week, notify, space.id, load],
  );
  return { board, error, load, change };
}

/** Today's plan from the week, as a timeline. */
export function TodayTimeline({
  space,
  week,
  today,
}: {
  space: FamilySpace;
  week: FamilyWeek;
  today: number;
}) {
  const events = week.schedule.filter((e) => e.day === today);
  const dinner = week.dinners.find((d) => d.day === today);
  if (!events.length && !dinner) return null;
  const rows = [
    ...events.map((e) => ({ time: e.time ?? "", title: e.title, who: e.who ?? "" })),
    ...(dinner
      ? [{ time: "", title: `Dinner: ${dinner.dish}`, who: dinner.note ?? "", dinner: true }]
      : []),
  ];
  return (
    <Card style={{ gap: 4, backgroundColor: colors.sky, borderColor: colors.sky }}>
      <Text style={[s.small, { color: colors.mutedStrong, fontWeight: "700", marginBottom: 6 }]}>
        {WEEKDAYS[today]?.toUpperCase()}
      </Text>
      {rows.map((row, i) => {
        const who = personColor(space, row.who || row.title);
        return (
          <View
            key={`${row.time}-${row.title}`}
            style={{ flexDirection: "row", gap: 10, minHeight: 46 }}
          >
            <Text
              style={{
                width: 64,
                fontSize: 13,
                fontWeight: "600",
                color: colors.mutedStrong,
                paddingTop: 1,
              }}
            >
              {row.time}
            </Text>
            <View style={{ alignItems: "center", width: 14 }}>
              <View
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  marginTop: 4,
                  backgroundColor: "dinner" in row ? colors.text : who.strong,
                }}
              />
              {i < rows.length - 1 && (
                <View style={{ width: 2, flex: 1, backgroundColor: colors.blue }} />
              )}
            </View>
            <View style={{ flex: 1, gap: 2, paddingBottom: 12 }}>
              <Text style={[s.text, { fontWeight: "600" }]}>{row.title}</Text>
              {!!row.who && (
                <Text style={[s.muted, { fontSize: 13, color: colors.mutedStrong }]}>
                  {row.who}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

/** This week on the board: dinners, groceries, chores and ideas. */
export function WeekBoard({
  space,
  agentName,
  board,
  change,
  reload,
}: {
  space: FamilySpace;
  agentName: string;
  board: Board & { week: FamilyWeek };
  change: ReturnType<typeof useWeekBoard>["change"];
  /** Fetches the board again, e.g. once a night's recipes are written. */
  reload: () => Promise<unknown>;
}) {
  const { week } = board;
  const today = tonight(board);
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  return (
    <View style={{ gap: 22 }}>
      <View style={[s.between, { gap: 12, flexWrap: "wrap" }]}>
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text {...heading(3)} style={s.heading}>
            Week of {monthDay(week.weekStart)}
          </Text>
          <Text style={s.muted}>
            {week.summary ? `${week.summary} · ` : ""}Planned by {agentName} on{" "}
            {plannedOn(week.plannedAt)}
          </Text>
        </View>
        {space.playbook.family.length > 0 && (
          <View
            accessibilityLabel={space.playbook.family.map((m) => m.name).join(", ")}
            style={s.row}
          >
            {space.playbook.family.slice(0, 6).map((member, i) => (
              <View
                key={member.name}
                style={{
                  marginLeft: i ? -8 : 0,
                  borderWidth: 2,
                  borderColor: colors.canvas,
                  borderRadius: 17,
                }}
              >
                <Avatar name={member.name} color={personColor(space, member.name).strong} />
              </View>
            ))}
          </View>
        )}
      </View>
      <Dinners
        space={space}
        agentName={agentName}
        week={week}
        today={today}
        writing={board.recipesWriting ?? []}
        change={change}
        reload={reload}
      />
      <View
        style={wide ? { flexDirection: "row", gap: 16, alignItems: "flex-start" } : { gap: 22 }}
      >
        <View style={wide ? { flex: 1 } : undefined}>
          <Groceries week={week} change={change} />
        </View>
        <View style={wide ? { flex: 1, gap: 22 } : { gap: 22 }}>
          <Chores space={space} week={week} today={today} change={change} />
          <Ideas week={week} />
        </View>
      </View>
    </View>
  );
}

function Plate({ dinner, size = 64 }: { dinner?: WeekDinner; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.subtle,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {dinner ? (
        <Emoji char={dishEmoji(dinner)} size={size * 0.62} />
      ) : (
        <View
          style={{
            width: size * 0.5,
            height: size * 0.5,
            borderRadius: size / 4,
            borderWidth: 1.5,
            borderStyle: "dashed",
            borderColor: colors.muted,
          }}
        />
      )}
    </View>
  );
}

function Dinners({
  space,
  agentName,
  week,
  today,
  writing,
  change,
  reload,
}: {
  space: FamilySpace;
  agentName: string;
  week: FamilyWeek;
  today?: number;
  /** Nights whose recipes are being written now. */
  writing: number[];
  change: ReturnType<typeof useWeekBoard>["change"];
  reload: () => Promise<unknown>;
}) {
  const openChat = useOpenChat();
  const [shown, setShown] = useState<number>();
  const strip = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  // On a wide screen the whole week fits; on a phone the strip opens at tonight.
  const wide = width >= 1000;
  const dinner = shown === undefined ? undefined : week.dinners.find((d) => d.day === shown);
  const tiles = WEEKDAYS.map((day, i) => {
    const planned = week.dinners.find((d) => d.day === i);
    const tonight = today === i;
    return (
      <Pressable
        key={day}
        accessibilityRole="button"
        accessibilityLabel={`${tonight ? "Tonight" : day}: ${planned ? `${planned.dish}${planned.note ? `, ${planned.note}` : ""}` : "nothing planned"}`}
        onPress={() => setShown(i)}
        style={({ pressed }) => ({
          ...(wide ? { flex: 1, minWidth: 0 } : { width: 112 }),
          paddingVertical: 12,
          paddingHorizontal: wide ? 4 : 8,
          borderRadius: 22,
          alignItems: "center",
          gap: 6,
          backgroundColor: pressed ? colors.subtle : colors.surface,
          borderWidth: tonight ? 2 : 1,
          borderColor: tonight ? colors.blueDark : colors.line,
        })}
      >
        <Text
          style={{
            fontSize: 12,
            fontWeight: "700",
            color: tonight ? colors.blueDark : colors.mutedStrong,
          }}
        >
          {tonight ? "Tonight" : day.slice(0, 3)}
        </Text>
        <Plate dinner={planned} size={wide ? 56 : 64} />
        <Text
          numberOfLines={2}
          style={{
            fontSize: wide ? 13 : 14,
            lineHeight: wide ? 17 : 18,
            fontWeight: "600",
            textAlign: "center",
            color: planned ? colors.text : colors.mutedStrong,
          }}
        >
          {planned?.dish ?? "Not planned"}
        </Text>
        {!!planned?.note && (
          <Text numberOfLines={1} style={{ fontSize: 12, color: colors.mutedStrong }}>
            {planned.note}
          </Text>
        )}
      </Pressable>
    );
  });
  return (
    <View style={{ gap: 10 }}>
      <Text {...heading(3)} style={s.heading}>
        Dinners
      </Text>
      {wide ? (
        <View style={{ flexDirection: "row", gap: 8 }}>{tiles}</View>
      ) : (
        <ScrollView
          ref={strip}
          horizontal
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={() =>
            strip.current?.scrollTo({ x: Math.max(0, (today ?? 0) - 1) * 122, animated: false })
          }
          contentContainerStyle={{ gap: 10, paddingVertical: 4, paddingRight: 4 }}
        >
          {tiles}
        </ScrollView>
      )}
      {shown !== undefined && (
        <Sheet
          title={`${WEEKDAYS[shown]}: ${dinner?.dish ?? "Nothing planned"}`}
          subtitle={dinner?.note}
          onClose={() => setShown(undefined)}
        >
          <View style={{ gap: 22 }}>
            {/* The plate stands in until there are recipes; then they fill the sheet. */}
            {!dinner?.recipes?.length && <Plate dinner={dinner} size={96} />}
            {dinner ? (
              <DinnerRecipes
                key={dinner.day}
                spaceId={space.id}
                agentName={agentName}
                week={week}
                dinner={dinner}
                writing={writing.includes(dinner.day)}
                change={change}
                reload={reload}
                onSwap={() => {
                  setShown(undefined);
                  openChat(
                    space,
                    `Please swap ${dinner.dish} on ${WEEKDAYS[shown]} (week of ${monthDay(week.weekStart)}) for something else.`,
                  );
                }}
              />
            ) : (
              <Button
                primary
                style={{ alignSelf: "flex-start" }}
                onPress={() => {
                  setShown(undefined);
                  openChat(
                    space,
                    `Please plan a dinner for ${WEEKDAYS[shown]} (week of ${monthDay(week.weekStart)}).`,
                  );
                }}
              >
                Ask {agentName} to plan it
              </Button>
            )}
          </View>
        </Sheet>
      )}
    </View>
  );
}

const AISLES = [
  "Fruit and vegetables",
  "Meat and fish",
  "Dairy and eggs",
  "Bread",
  "Pantry",
  "Frozen",
  "Household",
];
function aisleGroups(items: GroceryItem[]) {
  const groups = new Map<string, GroceryItem[]>();
  for (const item of items) {
    const aisle = item.aisle?.trim() || "Other";
    groups.set(aisle, [...(groups.get(aisle) ?? []), item]);
  }
  const rank = (name: string) => {
    const at = AISLES.findIndex((a) => a.toLowerCase() === name.toLowerCase());
    return at >= 0 ? at : name === "Other" ? 99 : 50;
  };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}

function Groceries({
  week,
  change,
}: {
  week: FamilyWeek;
  change: ReturnType<typeof useWeekBoard>["change"];
}) {
  const { notify } = useWorkspace();
  const [adding, setAdding] = useState("");
  const total = week.groceries.length;
  async function add() {
    const item = adding.trim();
    if (!item) return;
    setAdding("");
    // Kept in the box when it doesn't save, so nothing typed is lost.
    if (!(await change("/groceries", { item }))) setAdding(item);
  }
  const inCart = week.groceries.filter((g) => g.done).length;
  async function share() {
    const text = aisleGroups(week.groceries.filter((g) => !g.done))
      .map(([aisle, items]) =>
        [aisle, ...items.map((g) => `- ${g.item}${g.qty ? ` (${g.qty})` : ""}`)].join("\n"),
      )
      .join("\n\n");
    const message = `Groceries for the week of ${monthDay(week.weekStart)}\n\n${text}`;
    try {
      if (Platform.OS !== "web") await Share.share({ message });
      else if (typeof navigator.share === "function") await navigator.share({ text: message });
      else {
        await navigator.clipboard.writeText(message);
        notify("Grocery list copied.");
      }
    } catch {
      // The person closed the share sheet.
    }
  }
  return (
    <Card style={{ gap: 14 }}>
      <View style={[s.between, { gap: 10 }]}>
        <Text {...heading(3)} style={s.heading}>
          Groceries
        </Text>
        {total > 0 && (
          <Text style={[s.muted, { fontSize: 13, fontWeight: "600" }]}>
            {inCart} of {total} in the cart
          </Text>
        )}
      </View>
      {total > 0 && (
        <View
          accessible={false}
          style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden" }}
        >
          <View
            style={{
              height: 6,
              width: `${Math.round((inCart / total) * 100)}%`,
              backgroundColor: colors.greenDark,
            }}
          />
        </View>
      )}
      {total === 0 && <Text style={s.muted}>Nothing on the list yet.</Text>}
      {aisleGroups(week.groceries).map(([aisle, items]) => (
        <View key={aisle} style={{ gap: 2 }}>
          <Text style={[s.small, { fontWeight: "700", color: colors.mutedStrong }]}>{aisle}</Text>
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.done }}
              aria-checked={item.done}
              accessibilityLabel={`${item.item}${item.qty ? `, ${item.qty}` : ""}`}
              onPress={() =>
                void change(`/groceries/${item.id}`, { done: !item.done }, (w) => ({
                  ...w,
                  groceries: w.groceries.map((g) =>
                    g.id === item.id ? { ...g, done: !item.done } : g,
                  ),
                }))
              }
              style={[s.row, { gap: 12, minHeight: 44 }]}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  borderWidth: 1.5,
                  borderColor: item.done ? colors.greenDark : colors.muted,
                  backgroundColor: item.done ? colors.greenDark : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {item.done && <Check size={15} strokeWidth={3} color={colors.surface} />}
              </View>
              <Text
                style={[
                  s.text,
                  { flex: 1 },
                  item.done && { color: colors.muted, textDecorationLine: "line-through" },
                ]}
              >
                {item.item}
              </Text>
              {!!item.qty && <Text style={[s.muted, { fontSize: 13 }]}>{item.qty}</Text>}
            </Pressable>
          ))}
        </View>
      ))}
      <View style={[s.row, { gap: 8 }]}>
        <TextInput
          value={adding}
          onChangeText={setAdding}
          placeholder="Add an item"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Add an item to the grocery list"
          onSubmitEditing={() => void add()}
          style={[s.input, { flex: 1, minWidth: 0 }]}
        />
        <Button
          icon={Plus}
          disabled={!adding.trim()}
          accessibilityLabel="Add to the grocery list"
          onPress={() => void add()}
        >
          Add
        </Button>
      </View>
      {total > inCart && (
        <Button icon={Share2} onPress={() => void share()} style={{ alignSelf: "flex-start" }}>
          Share the list
        </Button>
      )}
    </Card>
  );
}

function Chores({
  space,
  week,
  today,
  change,
}: {
  space: FamilySpace;
  week: FamilyWeek;
  today?: number;
  change: ReturnType<typeof useWeekBoard>["change"];
}) {
  if (!week.chores.length) return null;
  return (
    <Card style={{ gap: 12 }}>
      <View style={[s.between, { gap: 10, flexWrap: "wrap" }]}>
        <Text {...heading(3)} style={s.heading}>
          Chores
        </Text>
        <Text style={[s.muted, { fontSize: 13 }]}>Tap a day to give a star</Text>
      </View>
      {week.chores.map((chore) => {
        const color = personColor(space, chore.who);
        const stars = chore.stamps.filter(Boolean).length;
        return (
          <View
            key={chore.id}
            style={{ gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line }}
          >
            <View style={[s.row, { gap: 10 }]}>
              <Avatar name={chore.who} color={color.strong} size={28} />
              <View style={{ flex: 1 }}>
                <Text style={[s.text, { fontWeight: "600" }]}>{chore.who}</Text>
                <Text style={[s.muted, { fontSize: 13 }]}>{chore.task}</Text>
              </View>
              <Text style={{ fontSize: 13, fontWeight: "700", color: color.strong }}>
                {stars} {stars === 1 ? "star" : "stars"}
              </Text>
            </View>
            <View style={[s.row, { justifyContent: "space-between", marginHorizontal: -4 }]}>
              {chore.stamps.map((done, i) => (
                <Pressable
                  key={WEEKDAYS[i]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done }}
                  aria-checked={done}
                  accessibilityLabel={`${chore.who}, ${chore.task}, ${WEEKDAYS[i]}`}
                  onPress={() =>
                    void change(`/chores/${chore.id}`, { day: i, done: !done }, (w) => ({
                      ...w,
                      chores: w.chores.map((c) =>
                        c.id === chore.id
                          ? { ...c, stamps: c.stamps.map((v, j) => (j === i ? !done : v)) }
                          : c,
                      ),
                    }))
                  }
                  style={{
                    flex: 1,
                    maxWidth: 48,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: done ? color.soft : "transparent",
                      borderWidth: done ? 0 : today === i ? 2 : 1,
                      borderStyle: today === i && !done ? "dashed" : "solid",
                      borderColor: today === i ? color.strong : colors.line,
                    }}
                  >
                    {done ? (
                      <Star size={20} color={color.strong} fill={color.strong} />
                    ) : (
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "700",
                          color: today === i ? color.strong : colors.mutedStrong,
                        }}
                      >
                        {WEEKDAYS[i]?.charAt(0)}
                      </Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

function Ideas({ week }: { week: FamilyWeek }) {
  if (!week.ideas.length) return null;
  const tints = [colors.green, colors.lavender, colors.orange, colors.sky];
  return (
    <View style={{ gap: 10 }}>
      <Text {...heading(3)} style={s.heading}>
        Ideas for free time
      </Text>
      {week.ideas.map((idea, i) => (
        <View
          key={idea.title}
          style={[
            s.row,
            { gap: 14, padding: 14, borderRadius: 20, backgroundColor: tints[i % tints.length] },
          ]}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: colors.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Emoji char={idea.emoji || "✨"} size={28} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.text, { fontWeight: "600" }]}>{idea.title}</Text>
            {!!(idea.for || idea.when) && (
              <Text style={[s.muted, { fontSize: 13, color: colors.mutedStrong }]}>
                {[idea.for && `For ${idea.for}`, idea.when].filter(Boolean).join(" · ")}
              </Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

/** "Our weeks": past weeks with their dinners and how chores went, and one opened up. */
export function OurWeeks({ space, agentName }: { space: FamilySpace; agentName: string }) {
  const { api, notify } = useWorkspace();
  const openChat = useOpenChat();
  const { board, error, load } = useWeekBoard(space);
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<FamilyWeek>();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const past = board?.past ?? [];
  const favorites = useMemo(() => {
    const counts = new Map<string, { dinner: WeekDinner; times: number }>();
    for (const week of past)
      for (const dinner of week.dinners) {
        const key = dinner.dish.trim().toLowerCase();
        counts.set(key, { dinner, times: (counts.get(key)?.times ?? 0) + 1 });
      }
    return [...counts.values()]
      .filter((f) => f.times > 1)
      .sort((a, b) => b.times - a.times)
      .slice(0, 3);
  }, [past]);
  const words = query.trim().toLowerCase();
  const shown = past.filter(
    (week) =>
      !words ||
      [week.summary, week.recap, weekRange(week.weekStart), ...week.dinners.map((d) => d.dish)]
        .join(" ")
        .toLowerCase()
        .includes(words),
  );
  async function run(name: string, work: () => Promise<void>) {
    setBusy(name);
    setProblem("");
    try {
      await work();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  const open = (weekStart: string) =>
    run(`open-${weekStart}`, async () => {
      const week = await api.request<FamilyWeek | null>(
        `/api/spaces/${space.id}/weeks/${weekStart}`,
      );
      if (week) setOpened(week);
    });
  const cookAgain = (dish: string) =>
    run(`again-${dish}`, async () => {
      const favoritesNow = space.playbook.favorites;
      if (!favoritesNow.some((f) => f.toLowerCase() === dish.toLowerCase()))
        replace(
          await api.request<FamilySpace>(`/api/spaces/${space.id}/playbook`, {
            favorites: [...favoritesNow, dish].slice(-30),
          }),
        );
      notify(`${dish} is in your favorites, so ${agentName} will plan it again.`);
    });
  const reuse = (from: FamilyWeek) =>
    run("reuse", async () => {
      const to = board?.week?.weekStart ?? board?.thisWeek ?? "";
      await api.request(`/api/spaces/${space.id}/weeks/${from.weekStart}/reuse-groceries`, { to });
      await load();
      setOpened(undefined);
      notify(`Those groceries are on the list for the week of ${monthDay(to)}.`);
    });
  if (!board && !error) return <Text style={s.muted}>Loading your weeks…</Text>;
  if (!board)
    return (
      <View style={{ gap: 10 }}>
        <ErrorNotice error={error} />
        <Button onPress={() => void load()} style={{ alignSelf: "flex-start" }}>
          Try again
        </Button>
      </View>
    );
  return (
    <View style={{ gap: 22 }}>
      <ErrorNotice error={error || problem} />
      {past.length === 0 ? (
        <Card style={{ gap: 8 }}>
          <Text style={s.text}>
            Each week {agentName} plans shows up here once it's over, so you can look back at
            dinners, the grocery list and how chores went.
          </Text>
        </Card>
      ) : (
        <>
          <View
            style={[
              s.row,
              {
                gap: 10,
                minHeight: 48,
                paddingHorizontal: 16,
                borderRadius: 24,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.surface,
              },
            ]}
          >
            <Search size={18} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Find a week or a dish"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Search past weeks"
              style={[s.text, { flex: 1, paddingVertical: 10 }]}
            />
          </View>
          {favorites.length > 0 && !words && (
            <View style={{ gap: 10 }}>
              <Text {...heading(3)} style={s.heading}>
                Cooked most
              </Text>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "stretch" }}>
                {favorites.map(({ dinner, times }) => (
                  <View
                    key={dinner.dish}
                    accessible
                    accessibilityLabel={`${dinner.dish}, ${times} times`}
                    style={{
                      flex: 1,
                      alignItems: "center",
                      gap: 4,
                      paddingVertical: 12,
                      paddingHorizontal: 6,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: colors.line,
                      backgroundColor: colors.surface,
                    }}
                  >
                    <Plate dinner={dinner} size={52} />
                    <Text
                      numberOfLines={2}
                      style={[
                        s.text,
                        {
                          fontSize: 14,
                          lineHeight: 18,
                          minHeight: 36,
                          fontWeight: "600",
                          textAlign: "center",
                        },
                      ]}
                    >
                      {dinner.dish}
                    </Text>
                    <Text style={[s.muted, { fontSize: 12 }]}>{times} times</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          <View style={{ gap: 12 }}>
            <Text {...heading(3)} style={s.heading}>
              Past weeks
            </Text>
            {shown.length === 0 && <Text style={s.muted}>No week matches “{query.trim()}”.</Text>}
            {shown.map((week) => (
              <Pressable
                key={week.weekStart}
                accessibilityRole="button"
                accessibilityLabel={`Open the week of ${weekRange(week.weekStart)}`}
                onPress={() => void open(week.weekStart)}
                style={({ pressed }) => ({
                  gap: 12,
                  padding: 16,
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: pressed ? colors.subtle : colors.surface,
                })}
              >
                <Text style={[s.text, { fontWeight: "700" }]}>{weekRange(week.weekStart)}</Text>
                <View style={[s.between, { gap: 2 }]}>
                  {WEEKDAYS.map((day, i) => (
                    <Plate key={day} dinner={week.dinners.find((d) => d.day === i)} size={38} />
                  ))}
                </View>
                {!!(week.recap || week.summary) && (
                  <Text style={s.text}>{week.recap || week.summary}</Text>
                )}
                <Text style={[s.muted, { fontSize: 13 }]}>
                  {week.dinners.length} {week.dinners.length === 1 ? "dinner" : "dinners"} planned
                  {week.chores.total
                    ? ` · ${week.chores.stamped} of ${week.chores.total} chore stars`
                    : ""}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      {opened && (
        <Sheet
          title={`Week of ${monthDay(opened.weekStart)}`}
          subtitle={opened.recap || opened.summary}
          onClose={() => setOpened(undefined)}
        >
          <View style={{ gap: 4 }}>
            {opened.dinners.map((dinner) => (
              <View
                key={`${dinner.day}-${dinner.dish}`}
                style={[
                  s.row,
                  { gap: 12, minHeight: 56, borderTopWidth: 1, borderTopColor: colors.line },
                ]}
              >
                <Text
                  style={[s.small, { width: 36, fontWeight: "700", color: colors.mutedStrong }]}
                >
                  {WEEKDAYS[dinner.day]?.slice(0, 3)}
                </Text>
                <Plate dinner={dinner} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.text, { fontWeight: "600" }]}>{dinner.dish}</Text>
                  {!!dinner.note && <Text style={[s.muted, { fontSize: 13 }]}>{dinner.note}</Text>}
                </View>
                <Button
                  icon={RotateCcw}
                  busy={busy === `again-${dinner.dish}`}
                  accessibilityLabel={`Cook ${dinner.dish} again`}
                  onPress={() => void cookAgain(dinner.dish)}
                >
                  Cook again
                </Button>
              </View>
            ))}
            <Text style={[s.muted, { marginTop: 12 }]}>
              {[
                opened.groceries.length
                  ? `${opened.groceries.length} grocery ${opened.groceries.length === 1 ? "item" : "items"}: ${opened.groceries
                      .slice(0, 3)
                      .map((g) => g.item)
                      .join(", ")}${opened.groceries.length > 3 ? "…" : ""}`
                  : "No grocery list",
                opened.chores.length
                  ? `${opened.chores.reduce((n, c) => n + c.stamps.filter(Boolean).length, 0)} of ${opened.chores.length * 7} chore stars`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            <ErrorNotice error={problem} />
            <View style={{ gap: 8, marginTop: 14 }}>
              <Button
                primary
                onPress={() => {
                  setOpened(undefined);
                  openChat(
                    space,
                    `Please plan next week like the week of ${weekRange(opened.weekStart)}: similar dinners and the same rhythm.`,
                  );
                }}
              >
                Plan next week like this one
              </Button>
              {opened.groceries.length > 0 && (
                <Button busy={busy === "reuse"} onPress={() => void reuse(opened)}>
                  Reuse this grocery list
                </Button>
              )}
            </View>
          </View>
        </Sheet>
      )}
    </View>
  );
}
