import { useEffect, useState } from "react";
import { Text, View } from "react-native";
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
interface Usage {
  month: string;
  cost: number;
  calls: number;
  unpriced: string[];
  lines: UsageLine[];
  history: { month: string; cost: number; calls: number }[];
  models: { chat?: string; background?: string };
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
}
const KINDS: Record<string, string> = {
  chat: "Chat",
  background: "Background jobs and routines",
  search: "Web searches",
  feed: "Feed",
  pictures: "Looking at pictures",
  import: "Memory import",
  avatar: "Avatar design",
  ideas: "Ideas",
  summary: "Summarizing long chats",
  code: "Running code",
  recipes: "Dinner recipes",
  voice: "Live voice",
};
/** "under 1 min", "12 min", "1 hr", "1 hr 5 min". */
const minutesLabel = (minutes: number) => {
  if (minutes < 1) return "under\u00a01\u00a0min";
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${total}\u00a0min`;
  return rest ? `${hours}\u00a0hr ${rest}\u00a0min` : `${hours}\u00a0hr`;
};
const dollars = (value: number) =>
  value > 0 && value < 0.01 ? "under $0.01" : `$${value.toFixed(2)}`;
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
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1000
      ? `${Math.round(value / 1000)}K`
      : String(value);

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
      <Text style={s.text}>
        {monthName(usage.month)}: about {dollars(usage.cost)} in AI costs, {usage.calls}{" "}
        {usage.calls === 1 ? "model call" : "model calls"}.
      </Text>
      {[...byKind.entries()].map(([kind, entry]) => (
        <View key={kind} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={[s.muted, { flex: 1 }]}>
            {KINDS[kind] ?? kind} ·{" "}
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
                ? `${monthName(m.month)}: about ${dollars(m.cost)}, ${m.calls.toLocaleString()} ${m.calls === 1 ? "model call" : "model calls"}`
                : `${monthName(m.month)}: no AI use`,
              strong: m.month === usage.month,
            }))}
            format={dollars}
            short={shortDollars}
          />
        </View>
      )}
      <Text style={s.muted}>
        Chat uses {usage.models.chat ?? "no model"}
        {usage.models.background && usage.models.background !== usage.models.chat
          ? `; background work uses ${usage.models.background}`
          : ""}
        . Costs are estimates from list prices
        {usage.unpriced.length ? ` (no price yet for ${usage.unpriced.join(", ")})` : ""}; your
        provider's bill is the final word.
      </Text>
      {people && people.people.length > 1 && (
        <View style={{ gap: 6 }}>
          <Text style={s.text}>Everyone this month: about {dollars(people.cost)}</Text>
          {people.people
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
