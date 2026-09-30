import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Emoji } from "./emoji";
import { colors } from "./ui";

export type AppsTab = "apps" | "agent" | "about" | "alerts" | "money" | "account" | "help";
const TABS: { id: AppsTab; label: string; emoji: string }[] = [
  { id: "apps", label: "Apps", emoji: "🧩" },
  { id: "agent", label: "Agent", emoji: "🤖" },
  { id: "about", label: "About you", emoji: "🙂" },
  { id: "alerts", label: "Alerts", emoji: "🔔" },
  { id: "money", label: "Money", emoji: "💳" },
  { id: "account", label: "Account", emoji: "🔑" },
  { id: "help", label: "Help", emoji: "🙋" },
];
/** The last tab opened, so coming back to Apps (from Mail or Files, say) lands where you were. */
let lastTab: AppsTab = "apps";
/** Sets the tab the Apps screen opens on next, e.g. Money from a button in chat. */
export function showAppsTab(tab: AppsTab) {
  lastTab = tab;
}

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
    <View role="tablist" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {TABS.map((item) => {
        const selected = item.id === tab;
        const badge = badges[item.id] ?? 0;
        return (
          <Pressable
            key={item.id}
            // react-native-web reads role and aria-*, not accessibilityState.
            role="tab"
            aria-selected={selected}
            aria-label={badge ? `${item.label}, ${badge} to review` : item.label}
            onPress={() => onTab(item.id)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingLeft: 8,
              paddingRight: 10,
              height: 40,
              borderRadius: 20,
              backgroundColor: selected ? colors.inverse : colors.subtle,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Emoji char={item.emoji} size={20} />
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: selected ? colors.onInverse : colors.text,
              }}
            >
              {item.label}
            </Text>
            {/* On the pill's corner, so a badge never makes the row wrap. */}
            {badge > 0 && (
              <View
                style={{
                  position: "absolute",
                  top: -5,
                  right: -5,
                  borderWidth: 2,
                  borderColor: colors.canvas,
                  minWidth: 20,
                  height: 20,
                  borderRadius: 10,
                  paddingHorizontal: 4,
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
