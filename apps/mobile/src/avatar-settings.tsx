import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { AvatarImage } from "../../../packages/domain/src/agent";
import { useAgentWorkspace } from "./agent-workspace";
import { AVATAR_COLORS, type AvatarColor, Mascot } from "./avatar";
import { CHARACTERS, type CharacterId } from "./avatar-art";
import { Button, colors, ErrorNotice, Field, s } from "./ui";
import { pickImage } from "./web-app";
import { useWorkspace } from "./workspace";

type Character = CharacterId | "custom";

/** Choose a character and background, upload a picture, or describe one to be drawn. */
export function AvatarPicker({
  character,
  color,
  onCharacter,
  onColor,
}: {
  character: Character;
  color: AvatarColor;
  onCharacter: (value: Character) => void;
  onColor: (value: AvatarColor) => void;
}) {
  const { api, notify } = useWorkspace();
  const { mutate } = useAgentWorkspace();
  const [own, setOwn] = useState<{ image: AvatarImage | null; designAvailable: boolean }>();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<"upload" | "design">();
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api
        .request<{ image: AvatarImage | null; designAvailable: boolean }>("/api/agent/avatar-image")
        .then(setOwn, () => undefined),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function save(kind: "upload" | "design", work: () => Promise<unknown>, done: string) {
    setBusy(kind);
    setError("");
    try {
      await work();
      await load();
      onCharacter("custom");
      notify(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }
  async function upload() {
    setError("");
    try {
      const data = await pickImage();
      if (data)
        await save(
          "upload",
          () => mutate("/avatar-image", { data }),
          "Your picture is your agent's avatar now.",
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const options: { id: Character; label: string }[] = [
    ...(own?.image ? [{ id: "custom" as const, label: "Your own" }] : []),
    ...CHARACTERS,
  ];
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
        {options.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="radio"
            accessibilityLabel={item.label}
            accessibilityState={{ checked: character === item.id }}
            onPress={() => onCharacter(item.id)}
            style={{
              alignItems: "center",
              gap: 4,
              padding: 6,
              borderRadius: 18,
              borderWidth: 2,
              borderColor: character === item.id ? colors.blueDark : "transparent",
            }}
          >
            <Mascot
              size={56}
              variant={color}
              character={item.id}
              image={own?.image}
              animated={character === item.id}
            />
            <Text style={s.small}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={[s.row, { gap: 12, justifyContent: "center" }]}>
        {(Object.keys(AVATAR_COLORS) as AvatarColor[]).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="radio"
            accessibilityLabel={`${item} background`}
            accessibilityState={{ checked: color === item }}
            onPress={() => onColor(item)}
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              backgroundColor: AVATAR_COLORS[item],
              borderWidth: 2,
              borderColor: color === item ? colors.blueDark : colors.subtle,
            }}
          />
        ))}
      </View>
      {Platform.OS === "web" && (
        <Button busy={busy === "upload"} disabled={!!busy} onPress={() => void upload()}>
          Use your own picture
        </Button>
      )}
      {own?.designAvailable && (
        <>
          <Field
            label="Or describe a character to have it drawn"
            value={description}
            onChangeText={setDescription}
            placeholder="A cheerful golden retriever wearing glasses"
            maxLength={300}
          />
          <Button
            busy={busy === "design"}
            disabled={!!busy || description.trim().length < 3}
            onPress={() =>
              void save(
                "design",
                () => mutate("/avatar-design", { description: description.trim() }),
                "Your new avatar is ready.",
              )
            }
          >
            Draw it
          </Button>
          {busy === "design" && (
            <Text style={s.small}>Drawing your character. This can take up to a minute.</Text>
          )}
        </>
      )}
      <ErrorNotice error={error} />
    </View>
  );
}
