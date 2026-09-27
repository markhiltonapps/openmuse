import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Emoji } from "./emoji";
import { colors } from "./ui";

export type AppsTab = "apps" | "agent" | "alerts" | "money" | "account" | "help";
const TABS: { id: AppsTab; label: string; emoji: string }[] = [
  { id: "apps", label: "Apps", emoji: "🧩" },
  { id: "agent", label: "Agent", emoji: "🤖" },
  { id: "alerts", label: "Alerts", emoji: "🔔" },
  { id: "money", label: "Money", emoji: "💳" },
  { id: "account", label: "Account", emoji: "🔑" },
  { id: "help", label: "Help", emoji: "🙋" },
];
/** The last tab opened, so coming back to Apps (from Mail or Files, say) lands where you were. */
let lastTab: AppsTab = "apps";

export function useAppsTab() {
  const [tab, setTab] = useState<AppsTab>(lastTab);
  return [
    tab,
    (next: AppsTab) => {
      lastTab = next;
      setTab(next);
    },
  ] as const;
}

/** The row of tabs on the Apps screen, each showing one group of settings. */
export function AppsTabs({
  tab,
  onTab,
  badges = {},
}: {
  tab: AppsTab;
  onTab: (tab: AppsTab) => void;
  /** Counts shown on a tab, like memories waiting for review. */
  badges?: Partial<Record<AppsTab, number>>;
}) {
  return (
    // Wraps onto a second row on a phone, so every tab is in view.
    <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {TABS.map((item) => {
        const selected = item.id === tab;
        const badge = badges[item.id] ?? 0;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={badge ? `${item.label}, ${badge} to review` : item.label}
            onPress={() => onTab(item.id)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingLeft: 10,
              paddingRight: 14,
              height: 40,
              borderRadius: 20,
              backgroundColor: selected ? colors.inverse : colors.subtle,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Emoji char={item.emoji} size={22} />
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: selected ? colors.onInverse : colors.text,
              }}
            >
              {item.label}
            </Text>
            {badge > 0 && (
              <View
                style={{
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  paddingHorizontal: 5,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.danger,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "700", color: colors.onInverse }}>
                  {badge}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
