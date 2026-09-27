import { Platform, Pressable, Text, View } from "react-native";
import { Emoji } from "./emoji";
import { Button, Card, colors, SectionHeading, s } from "./ui";

/** The picture guide the web app serves beside the app; only the web app has it. */
export const hasHelp = Platform.OS === "web" && typeof window !== "undefined";

/** Opens the guide in a new tab, at a topic when given. */
export function openHelp(topic?: string) {
  if (!hasHelp) return;
  window.open(`/help.html${topic ? `#${topic}` : ""}`, "_blank", "noopener");
}

const TOPICS = [
  { id: "start", label: "Get started", emoji: "👋" },
  { id: "tour", label: "Find your way", emoji: "🧩" },
  { id: "ask", label: "Things to ask", emoji: "💬" },
  { id: "safe", label: "You're in control", emoji: "🛡️" },
  { id: "tips", label: "Tips", emoji: "💡" },
  { id: "fix", label: "Fix a problem", emoji: "🧰" },
];

/** The Help tab on the Apps screen: the guide's topics as big, tappable tiles. */
export function HelpCard() {
  if (!hasHelp) return null;
  return (
    <Card style={{ gap: 14 }}>
      <SectionHeading title="Help & how-to" />
      <Text style={s.muted}>
        Pictures and simple steps for everything Neato_Meca does. It opens in a new tab.
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {TOPICS.map((topic) => (
          <Pressable
            key={topic.id}
            accessibilityRole="link"
            accessibilityLabel={`Help: ${topic.label}`}
            onPress={() => openHelp(topic.id)}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexBasis: "45%",
              alignItems: "center",
              gap: 6,
              paddingVertical: 14,
              paddingHorizontal: 8,
              borderRadius: 18,
              backgroundColor: colors.subtle,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Emoji char={topic.emoji} size={40} />
            <Text style={[s.text, { fontWeight: "600", textAlign: "center" }]}>{topic.label}</Text>
          </Pressable>
        ))}
      </View>
      <Button primary onPress={() => openHelp()}>
        Open the full guide
      </Button>
    </Card>
  );
}
