import { Platform, Text } from "react-native";
import { setThemeChoice, type ThemeChoice, themeChoice } from "./theme";
import { Card, CheckRow, SectionHeading, s } from "./ui";

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "Automatic, like this device" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

/** Light or dark, or following the device. The app reopens to switch. */
export function AppearanceCard() {
  if (Platform.OS !== "web") return null;
  const current = themeChoice();
  return (
    <Card style={{ gap: 4 }}>
      <SectionHeading title="Appearance" />
      {CHOICES.map((choice) => (
        <CheckRow
          key={choice.value}
          label={choice.label}
          checked={current === choice.value}
          onPress={() => current !== choice.value && setThemeChoice(choice.value)}
        />
      ))}
      <Text style={s.small}>The app reloads to switch.</Text>
    </Card>
  );
}
