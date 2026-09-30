import { useState } from "react";
import { type LayoutChangeEvent, Pressable, ScrollView, Text, View } from "react-native";
import type { AgentArtifact } from "../../../packages/domain/src/agent";
import { useAgentWorkspace } from "./agent-workspace";
import { PlaceAnchor } from "./app-places-ui";
import { type Column, DataTable, Segmented } from "./charts";
import { artifactKind, choiceFits, savedDate, savedResults } from "./plans";
import { Button, Card, colors, InfoTip, s } from "./ui";
import { useWorkspace } from "./workspace";

/** How many show before "Show all". */
const FIRST = 8;
const cellText = [s.text, { fontSize: 14, lineHeight: 20 }];
/** Below this width Type and Saved join the title's button as a line under it, as DataTable folds. */
const NARROW = 360;

/**
 * Reports, comparisons, plans and trackers the agent saved while working on something, newest
 * first. Each title opens the result in a sheet.
 */
export function SavedResults() {
  const { open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const [kind, setKind] = useState<"all" | AgentArtifact["kind"]>("all");
  const [all, setAll] = useState(false);
  const [width, setWidth] = useState(0);
  if (!data) return null;
  const agent = data.identity.name || "your agent";
  const { rows, kinds } = savedResults(data.artifacts);
  // A kind that's no longer there (its results were cleared) shows everything again.
  const chosen = kind !== "all" && kinds.includes(kind) ? kind : "all";
  const shown = rows.filter((row) => chosen === "all" || row.kind === chosen);
  const visible = all ? shown : shown.slice(0, FIRST);
  const narrow = width < NARROW;
  const wide = width >= 520;
  const columns: Column<AgentArtifact>[] = [
    {
      title: "Title",
      flex: 1,
      render: (row) => (
        // The title is the row's button, 44px tall and reaching the row's edges. On a narrow
        // screen its type and date are a line inside it, so the whole thing is one target.
        <Pressable
          role="button"
          aria-label={`Open ${row.title}`}
          onPress={() => open({ type: "saved", artifact: row })}
          style={({ pressed }) => ({
            minHeight: 44,
            marginVertical: -9,
            paddingVertical: 9,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={[cellText, { fontWeight: "600", color: colors.blueText }]}>{row.title}</Text>
          {narrow && (
            <Text style={[s.small, { fontSize: 12, lineHeight: 17, color: colors.mutedStrong }]}>
              {artifactKind(row.kind).label} · {savedDate(row.createdAt)}
            </Text>
          )}
        </Pressable>
      ),
    },
    ...(narrow
      ? []
      : [
          {
            title: "Type",
            flex: 0,
            minWidth: wide ? 150 : 112,
            render: (row: AgentArtifact) => {
              const about = artifactKind(row.kind);
              return wide ? `${about.emoji} ${about.label}` : about.label;
            },
          },
          {
            title: "Saved",
            flex: 0,
            minWidth: wide ? 100 : 64,
            render: (row: AgentArtifact) => savedDate(row.createdAt),
          },
        ]),
  ];
  const choices = [
    { id: "all" as const, label: "All" },
    ...kinds.map((id) => ({ id, label: artifactKind(id).plural })),
  ];
  const filter = (
    <Segmented
      label="Show saved results"
      value={chosen}
      onChange={(next) => {
        setKind(next);
        setAll(false);
      }}
      options={choices}
    />
  );
  return (
    <PlaceAnchor id="saved" label={`Saved by ${agent}`} radius={23}>
      <Card style={{ gap: 14 }}>
        <View style={[s.row, { gap: 6 }]}>
          <Text role="heading" aria-level={2} style={s.heading}>
            Saved by {agent}
          </Text>
          <InfoTip
            term={`Saved by ${agent}`}
            text={`Reports, comparisons, plans and trackers ${agent} saves while working on something for you.`}
          />
        </View>
        {rows.length === 0 ? (
          <Text style={s.muted}>
            Reports, comparisons, plans and trackers {agent} makes for you will show up here. Ask
            for one in chat, like “Compare the best family SUVs under $40k.”
          </Text>
        ) : (
          <>
            <View
              style={{ gap: 14 }}
              onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
            >
              {kinds.length > 1 &&
                width > 0 &&
                (choiceFits(
                  choices.map((choice) => choice.label),
                  width,
                ) ? (
                  filter
                ) : (
                  // Too many to share the width without cutting words: they keep their own size
                  // and scroll sideways, out to the card's edges.
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginHorizontal: -20 }}
                    contentContainerStyle={{ paddingHorizontal: 20 }}
                  >
                    <View style={{ minWidth: 420 }}>{filter}</View>
                  </ScrollView>
                ))}
              {width > 0 && (
                <DataTable
                  label="Saved results"
                  columns={columns}
                  rows={visible}
                  rowKey={(row) => row.id}
                />
              )}
            </View>
            {shown.length > FIRST && (
              <Button small style={{ alignSelf: "flex-start" }} onPress={() => setAll(!all)}>
                {all ? "Show fewer" : `Show all ${shown.length}`}
              </Button>
            )}
          </>
        )}
      </Card>
    </PlaceAnchor>
  );
}
