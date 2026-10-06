import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { modelLabel, USAGE_KINDS } from "../../../packages/domain/src/model-names";
import { BarChart } from "./charts";
import { Card, colors, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

interface UsageLine {
  kind: string;
  model: string;
  calls: number;
  input: number;
  cacheRead: number;
  output: number;
  searches: number;
  /** Seconds of live voice. */
  seconds?: number;
  cost?: number;
}
interface Totals {
  cost: number;
  calls: number;
  tokens: number;
}
interface Periods {
  today: Totals;
  week: Totals;
  all: Totals;
}
interface Usage {
  month: string;
  cost: number;
  calls: number;
  unpriced: string[];
  lines: UsageLine[];
  history: { month: string; cost: number; calls: number }[];
  /** Today and the last 7 days are counted from `since` (the day this started). */
  periods?: Periods & { since: string };
  models: { chat?: string; background?: string; simple?: string };
}
interface PeopleUsage {
  people: {
    id: string;
    name: string;
    email?: string;
    cost: number;
    calls: number;
    voiceMinutes?: number;
  }[];
  cost: number;
  periods?: Periods;
}
/** "under 1 min", "12 min", "1 hr", "1 hr 5 min". */
const minutesLabel = (minutes: number) => {
  if (minutes < 1) return "under\u00a01\u00a0min";
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${total}\u00a0min`;
  return rest ? `${hours}\u00a0hr ${rest}\u00a0min` : `${hours}\u00a0hr`;
};
/** "$0.84", "$1,234.56", or "under $0.01". */
const dollars = (value: number) =>
  value > 0 && value < 0.01
    ? "under $0.01"
    : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "about $0.84", or "under $0.01" (never "about under $0.01"). */
const about = (value: number) =>
  value > 0 && value < 0.01 ? "under $0.01" : `about ${dollars(value)}`;
/** "63 AI calls" ("calls" alone would read as voice calls). */
const aiCalls = (count: number) =>
  `${count.toLocaleString()} ${count === 1 ? "AI call" : "AI calls"}`;
const monthName = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
/** "2026-09" as "Sep". */
/** A compact amount for a chart's scale and narrow bars: "$12", "$2.5", "$0.60". */
const shortDollars = (value: number) =>
  value >= 10 || Number.isInteger(value)
    ? `$${Math.round(value).toLocaleString("en-US")}`
    : `$${value.toFixed(value < 1 ? 2 : 1)}`;
const shortMonth = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: "short" });
/** Every month from the oldest with usage (at most a year back) to this one, oldest first. */
function monthsTo(current: string, history: Usage["history"]) {
  const [year, month] = current.split("-").map(Number) as [number, number];
  const months = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 12 + i, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const known = new Set(history.map((h) => h.month));
  const first = months.findIndex((m) => known.has(m));
  return months.slice(first < 0 ? 11 : first).map((m) => {
    const found = history.find((h) => h.month === m);
    return { month: m, cost: found?.cost ?? 0, calls: found?.calls ?? 0 };
  });
}
const tokens = (value: number) =>
  value >= 1_000_000_000
    ? `${(value / 1_000_000_000).toFixed(1)}B`
    : value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)}M`
      : value >= 1000
        ? `${Math.round(value / 1000)}K`
        : String(value);
/** The same, as a screen reader should say it: "412 thousand", "3.9 million". */
const spokenTokens = (value: number) =>
  value >= 1_000_000_000
    ? `${(value / 1_000_000_000).toFixed(1)} billion`
    : value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)} million`
      : value >= 1000
        ? `${Math.round(value / 1000)} thousand`
        : String(value);

/** Tile figures: the amount never shortens, so a long one gets a little smaller. */
const tileDollars = (cost: number) => (cost > 0 && cost < 0.01 ? "<$0.01" : dollars(cost));
const tileSize = (text: string) => (text.length >= 9 ? 16 : text.length >= 7 ? 18 : 20);
const detail = [s.small, { color: colors.mutedStrong, fontSize: 12, lineHeight: 17 }];
/**
 * Today, the last 7 days and all time: three tiles side by side, or on a narrow card (a phone)
 * one row each, so the amounts always have room.
 */
function PeriodTiles({ periods, label }: { periods: Periods; label: string }) {
  const [width, setWidth] = useState(0);
  const narrow = width > 0 && width < 420;
  const tiles: [string, Totals][] = [
    ["Today", periods.today],
    ["Last 7 days", periods.week],
    ["All time", periods.all],
  ];
  return (
    <View
      role="list"
      aria-label={label}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ flexDirection: narrow ? "column" : "row", gap: 8 }}
    >
      {tiles.map(([name, totals]) => {
        const value = tileDollars(totals.cost);
        const figure = (
          <Text style={[s.text, { fontWeight: "700", fontSize: narrow ? 18 : tileSize(value) }]}>
            {value}
          </Text>
        );
        return (
          <View
            key={name}
            role="listitem"
            aria-label={`${name}: ${about(totals.cost)}, ${spokenTokens(totals.tokens)} tokens, ${aiCalls(totals.calls)}`}
            style={{
              flex: narrow ? undefined : 1,
              minWidth: 0,
              gap: 2,
              paddingVertical: 10,
              paddingHorizontal: narrow ? 12 : 8,
              borderRadius: 14,
              backgroundColor: colors.subtle,
            }}
          >
            {narrow ? (
              <>
                <View style={[s.row, { justifyContent: "space-between", gap: 8 }]}>
                  <Text style={[s.text, { fontWeight: "600", flexShrink: 1 }]}>{name}</Text>
                  {figure}
                </View>
                <Text style={detail}>
                  {tokens(totals.tokens)} tokens · {aiCalls(totals.calls)}
                </Text>
              </>
            ) : (
              <>
                <Text style={detail} numberOfLines={1}>
                  {name}
                </Text>
                {figure}
                {/* Detail lines wrap rather than clip, at big numbers or a large font. */}
                <Text style={detail}>{tokens(totals.tokens)} tokens</Text>
                <Text style={detail}>{aiCalls(totals.calls)}</Text>
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}
/** "Oct 6". */
const dayName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
/** Today in the person's own calendar, as YYYY-MM-DD. */
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** What the agent's model calls cost this month, and for the admin, what each person costs. */
export function UsageCard() {
  const { api } = useWorkspace();
  const [usage, setUsage] = useState<Usage>();
  const [people, setPeople] = useState<PeopleUsage>();
  useEffect(() => {
    void api.request<Usage>("/api/usage").then(setUsage, () => undefined);
    void api
      .request<{ role?: string }>("/api/me")
      .then((me) =>
        me.role === "admin" ? api.request<PeopleUsage>("/api/usage/people") : undefined,
      )
      .then(setPeople, () => undefined);
  }, [api]);
  if (!usage) return null;
  const everyone = people && people.people.length > 1 ? people : undefined;
  const byKind = new Map<
    string,
    { cost: number; calls: number; seconds: number; priced: boolean }
  >();
  for (const line of usage.lines) {
    const entry = byKind.get(line.kind) ?? { cost: 0, calls: 0, seconds: 0, priced: true };
    entry.cost += line.cost ?? 0;
    entry.calls += line.calls;
    entry.seconds += line.seconds ?? 0;
    entry.priced &&= line.cost !== undefined;
    byKind.set(line.kind, entry);
  }
  const months = monthsTo(usage.month, usage.history);
  const totals = usage.lines.reduce(
    (sum, line) => ({
      read: sum.read + line.input + line.cacheRead,
      cached: sum.cached + line.cacheRead,
      written: sum.written + line.output,
    }),
    { read: 0, cached: 0, written: 0 },
  );
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="Usage" />
      {usage.periods && (
        <View style={{ gap: 10 }}>
          {everyone && <Text style={[s.label, { color: colors.mutedStrong }]}>Just you</Text>}
          <PeriodTiles periods={usage.periods} label="Your AI costs" />
          {/* Days are counted from the day this started; all time goes back to the start. */}
          {Date.parse(usage.periods.since) > Date.now() - 6 * 86_400_000 && (
            <Text style={s.muted}>
              {usage.periods.since === localToday()
                ? "Day-by-day counting began today, so Today and Last 7 days only include use since then. All time includes everything."
                : `Day-by-day counting began on ${dayName(usage.periods.since)}, so Today and Last 7 days only include use since then. All time includes everything.`}
            </Text>
          )}
          <Text style={s.muted}>
            Costs are estimates from each model’s published prices, so the AI provider’s actual bill
            may differ a little.
            {usage.unpriced.length ? ` No price yet for ${usage.unpriced.join(", ")}.` : ""}
          </Text>
        </View>
      )}
      <Text style={s.text}>
        {monthName(usage.month)}: {about(usage.cost)} in AI costs, {aiCalls(usage.calls)}.
      </Text>
      {[...byKind.entries()].map(([kind, entry]) => (
        <View key={kind} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={[s.muted, { flex: 1 }]}>
            {USAGE_KINDS[kind] ?? kind} ·{" "}
            {kind === "voice" ? minutesLabel(entry.seconds / 60) : entry.calls}
          </Text>
          <Text style={s.muted}>{entry.priced ? dollars(entry.cost) : "price unknown"}</Text>
        </View>
      ))}
      {totals.read > 0 && (
        <Text style={s.muted}>
          Read {tokens(totals.read)} tokens ({Math.round((totals.cached / totals.read) * 100)}% from
          the cache) and wrote {tokens(totals.written)}.
        </Text>
      )}
      {months.length > 1 && (
        <View style={{ gap: 10, marginTop: 6 }}>
          <Text style={[s.label, { color: colors.mutedStrong }]}>By month</Text>
          <BarChart
            label="AI costs by month"
            bars={months.map((m) => ({
              key: m.month,
              label: shortMonth(m.month),
              name: monthName(m.month),
              value: m.cost,
              tip: m.calls
                ? `${monthName(m.month)}: ${about(m.cost)}, ${aiCalls(m.calls)}`
                : `${monthName(m.month)}: no AI use`,
              strong: m.month === usage.month,
            }))}
            format={dollars}
            short={shortDollars}
          />
        </View>
      )}
      <Text style={s.muted}>
        Chat uses {modelLabel(usage.models.chat) || "no model yet"}. Background jobs and routines
        use {modelLabel(usage.models.background) || "no model yet"}. Simple jobs use{" "}
        {modelLabel(usage.models.simple) || "no model yet"}.
      </Text>
      {everyone && (
        <View
          style={{
            gap: 10,
            marginTop: 10,
            paddingTop: 16,
            borderTopWidth: 1,
            borderTopColor: colors.line,
          }}
        >
          <Text role="heading" aria-level={4} style={[s.label, { color: colors.mutedStrong }]}>
            Everyone together
          </Text>
          {everyone.periods && (
            <PeriodTiles periods={everyone.periods} label="Everyone’s AI costs together" />
          )}
          <Text style={s.text}>Everyone this month: {about(everyone.cost)}</Text>
          {everyone.people
            .slice()
            .sort((a, b) => b.cost - a.cost)
            .map((person) => (
              <View
                key={person.id}
                style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}
              >
                <Text style={[s.muted, { flex: 1 }]} numberOfLines={1}>
                  {person.name}
                  {person.email ? ` · ${person.email}` : ""}
                </Text>
                <Text style={s.muted}>
                  {person.voiceMinutes ? `${minutesLabel(person.voiceMinutes)} live · ` : ""}
                  {dollars(person.cost)}
                </Text>
              </View>
            ))}
        </View>
      )}
    </Card>
  );
}
