import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Card, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

interface UsageLine {
  kind: string;
  model: string;
  calls: number;
  input: number;
  cacheRead: number;
  output: number;
  searches: number;
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
  people: { id: string; name: string; email?: string; cost: number; calls: number }[];
  cost: number;
}
const KINDS: Record<string, string> = {
  chat: "Chat",
  background: "Background tasks and routines",
  search: "Web searches",
  feed: "Feed",
  pictures: "Looking at pictures",
  import: "Memory import",
  avatar: "Avatar design",
  ideas: "Ideas",
  summary: "Summarizing long chats",
  code: "Running code",
};
const dollars = (value: number) =>
  value > 0 && value < 0.01 ? "under $0.01" : `$${value.toFixed(2)}`;
const monthName = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
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
  const byKind = new Map<string, { cost: number; calls: number; priced: boolean }>();
  for (const line of usage.lines) {
    const entry = byKind.get(line.kind) ?? { cost: 0, calls: 0, priced: true };
    entry.cost += line.cost ?? 0;
    entry.calls += line.calls;
    entry.priced &&= line.cost !== undefined;
    byKind.set(line.kind, entry);
  }
  const earlier = usage.history.filter((m) => m.month !== usage.month).slice(0, 3);
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
            {KINDS[kind] ?? kind} · {entry.calls}
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
      {earlier.length > 0 && (
        <Text style={s.muted}>
          Earlier: {earlier.map((m) => `${monthName(m.month)} ${dollars(m.cost)}`).join(" · ")}
        </Text>
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
                <Text style={s.muted}>{dollars(person.cost)}</Text>
              </View>
            ))}
        </View>
      )}
    </Card>
  );
}
