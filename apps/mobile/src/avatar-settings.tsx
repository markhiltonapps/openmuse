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
/** A background's name in a sentence: "sky blue", "mint". */
const colourName = (color: AvatarColor) => (color === "sky" ? "sky blue" : color);

/**
 * Choose a character and background (saved as soon as it's tapped), upload a picture, or describe
 * one to be drawn.
 */
export function AvatarPicker({
  character,
  color,
  agentName,
  onCharacter,
  onColor,
}: {
  character: Character;
  color: AvatarColor;
  /** The agent's saved name, for the note after a save. */
  agentName: string;
  onCharacter: (value: Character) => void;
  onColor: (value: AvatarColor) => void;
}) {
  const { api, notify } = useWorkspace();
  const { mutate } = useAgentWorkspace();
  const [own, setOwn] = useState<{ image: AvatarImage | null; designAvailable: boolean }>();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<"upload" | "design" | "pick">();
  const [error, setError] = useState("");
  // A failed tap's reason shows right under the options it undid.
  const [pickError, setPickError] = useState("");
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
    setPickError("");
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
  /**
   * A tapped character or background is the avatar straight away; a failed save puts it back.
   * Only the avatar is sent, so a name being edited below isn't touched.
   */
  async function pick(next: { character?: Character; color?: AvatarColor }, label: string) {
    const before = { character, color };
    if (next.character) onCharacter(next.character);
    if (next.color) onColor(next.color);
    setBusy("pick");
    setPickError("");
    try {
      await mutate(
        "/identity",
        next.character ? { character: next.character } : { avatar: next.color },
      );
      // Naming the choice makes each save its own note, read out again by screen readers.
      notify(
        next.character
          ? label.toLowerCase() === agentName.toLowerCase()
            ? `${agentName}’s avatar is now the ${label} character.`
            : `${agentName}’s avatar is now ${label}.`
          : `${agentName}’s background is now ${label}.`,
      );
    } catch (e) {
      onCharacter(before.character);
      onColor(before.color);
      setPickError(e instanceof Error ? e.message : String(e));
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
          `${agentName}’s avatar is now your picture.`,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const custom = character === "custom";
  // A photo fills its circle, so a background can't show; a drawing's background is see-through.
  const photo = custom && own?.image?.kind === "photo";
  const options: { id: Character; label: string }[] = [
    // Kept even if the picture didn't load, so the saved choice always shows.
    ...(own?.image || custom ? [{ id: "custom" as const, label: "Your picture" }] : []),
    ...CHARACTERS,
  ];
  return (
    <View style={{ gap: 14 }}>
      <View
        role="radiogroup"
        aria-label="Character"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" }}
      >
        {options.map((item) => {
          const picked = character === item.id;
          return (
            <Pressable
              key={item.id}
              role="radio"
              aria-label={item.label}
              aria-checked={picked}
              disabled={!!busy}
              onPress={() =>
                !picked &&
                void pick(
                  { character: item.id },
                  item.id === "custom" ? "your picture" : item.label,
                )
              }
              style={{
                alignItems: "center",
                // Wide enough for a bold label, so the row doesn't shift when the pick changes.
                minWidth: 84,
                gap: 4,
                padding: 6,
                borderRadius: 18,
                borderWidth: 2,
                borderColor: picked ? colors.blueDark : "transparent",
                // Dimmed while a tap saves, so it's clear the others wait.
                opacity: busy && !picked ? 0.5 : 1,
              }}
            >
              <Mascot
                size={56}
                variant={color}
                character={item.id}
                image={own?.image}
                animated={picked}
              />
              <Text style={[s.small, picked && { color: colors.text, fontWeight: "600" }]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View
        role="radiogroup"
        aria-label="Background colour"
        aria-disabled={photo}
        aria-describedby={photo ? "avatar-photo-background" : undefined}
        style={[s.row, { gap: 12, justifyContent: "center", opacity: photo ? 0.4 : 1 }]}
      >
        {(Object.keys(AVATAR_COLORS) as AvatarColor[]).map((item) => {
          const picked = color === item;
          return (
            <Pressable
              key={item}
              role="radio"
              aria-label={`${colourName(item)} background`}
              aria-checked={picked}
              disabled={!!busy || photo}
              hitSlop={6}
              onPress={() => !picked && void pick({ color: item }, colourName(item))}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: AVATAR_COLORS[item],
                borderWidth: picked ? 2 : 1,
                borderColor: picked ? colors.blueDark : colors.edge,
                opacity: busy && !picked ? 0.5 : 1,
              }}
            />
          );
        })}
      </View>
      {photo && (
        <Text id="avatar-photo-background" style={[s.small, { textAlign: "center" }]}>
          {own?.designAvailable
            ? "Backgrounds don’t show behind a photo. They show behind characters and drawings."
            : "Backgrounds don’t show behind a photo. They show behind characters."}
        </Text>
      )}
      <ErrorNotice error={pickError} />
      {Platform.OS === "web" && (
        <Button busy={busy === "upload"} disabled={!!busy} onPress={() => void upload()}>
          {own?.image ? "Choose a new picture" : "Use your own picture"}
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
                `${agentName}’s new avatar is ready.`,
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
