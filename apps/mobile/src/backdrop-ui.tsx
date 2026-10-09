import { Check, Mic, X } from "lucide-react-native";
import { useContext, useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import { backdropById, backdropGroups, NO_BACKDROP } from "../../../packages/domain/src/backdrops";
import {
  applyBackdrop,
  type BackdropView,
  backdropFile,
  markSaved,
  needsReopen,
  reopenApp,
  reopenIfNeeded,
  reopenLater,
  useBackdrop,
  useReopenPending,
  useReopenPill,
} from "./backdrop";
import { BrowserRunContext } from "./browser-tool-card";
import { useLiveCallOn } from "./live-voice";
import { savedBackdrop } from "./theme";
import { Button, CheckRow, colors, ErrorNotice, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/** One scene: its picture, its name, and a ring and tick when it's the one in use. */
function Tile({
  id,
  name,
  label,
  thumb,
  focus,
  chosen,
  onPress,
  width,
  note,
}: {
  id: string;
  name: string;
  /** What a screen reader hears: the name, its group and anything it does. */
  label: string;
  thumb?: string;
  focus?: string;
  chosen: boolean;
  onPress: () => void;
  width: number;
  /** A small second line, e.g. "Reopens the app". */
  note?: string;
}) {
  return (
    <Pressable
      nativeID={`backdrop-${id}`}
      role="radio"
      aria-checked={chosen}
      aria-label={label}
      onPress={onPress}
      // One Tab stop for the whole group (the chosen tile); arrows move between tiles.
      {...({ tabIndex: chosen ? 0 : -1 } as object)}
      {...({
        onKeyDown: (event: { key?: string; preventDefault?: () => void }) => {
          if (event.key === " ") {
            event.preventDefault?.();
            onPress();
            return;
          }
          const step =
            event.key === "ArrowRight" || event.key === "ArrowDown"
              ? 1
              : event.key === "ArrowLeft" || event.key === "ArrowUp"
                ? -1
                : 0;
          if (!step || Platform.OS !== "web") return;
          event.preventDefault?.();
          const ids = [...TILE_IDS, NO_BACKDROP];
          const next = ids[(ids.indexOf(id) + step + ids.length) % ids.length];
          document.getElementById(`backdrop-${next}`)?.focus();
        },
      } as object)}
      style={({ pressed }) => ({
        width,
        aspectRatio: 3 / 4,
        borderRadius: 16,
        overflow: "hidden",
        backgroundColor: "#16131e",
        borderWidth: chosen ? 3 : 1,
        borderColor: chosen ? "#ffffff" : "rgba(255,255,255,0.22)",
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {thumb ? (
        <Image
          source={{ uri: thumb }}
          accessible={false}
          resizeMode="cover"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            ...(focus && Platform.OS === "web" ? ({ objectPosition: focus } as object) : {}),
          }}
        />
      ) : (
        // The plain look: the app's own dark page.
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#000",
          }}
        />
      )}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 9,
          paddingTop: 22,
          paddingBottom: 8,
          ...(Platform.OS === "web"
            ? ({
                backgroundImage:
                  "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.88) 100%)",
              } as object)
            : { backgroundColor: "rgba(0,0,0,0.55)" }),
        }}
      >
        <Text style={TILE_TEXT}>{name}</Text>
        {note ? (
          <Text style={[TILE_TEXT, { fontSize: 11.5, fontWeight: "500" }]}>{note}</Text>
        ) : null}
      </View>
      {chosen && (
        <View
          style={{
            position: "absolute",
            top: 7,
            right: 7,
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: "#1a5fd0",
            borderWidth: 2,
            borderColor: "#fff",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Check size={14} strokeWidth={3} color="#fff" />
        </View>
      )}
    </Pressable>
  );
}
const TILE_TEXT = {
  color: "#fff",
  fontSize: 13,
  fontWeight: "700" as const,
  lineHeight: 16,
  textShadowColor: "rgba(0,0,0,0.8)",
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
};
const TILE_IDS = backdropGroups().flatMap(({ items }) => items.map((item) => item.id));
const sceneName = (scene: string) =>
  scene === NO_BACKDROP ? "No backdrop" : (backdropById(scene)?.name ?? scene);

/** "Reopen now", for a switch on or off that this tab hasn't shown yet; never during a call. */
function ReopenNow({ what }: { what: string }) {
  const call = useLiveCallOn();
  return (
    <View style={{ gap: 8 }}>
      <Text style={[s.muted, { color: colors.mutedStrong }]}>
        {call
          ? `${what} It changes when the app reopens, after your call.`
          : `${what} It changes when the app reopens.`}
      </Text>
      {!call && (
        <View style={{ alignSelf: "flex-start" }}>
          <Button primary onPress={reopenApp}>
            Reopen now
          </Button>
        </View>
      )}
    </View>
  );
}

/**
 * ☰ Menu › Backdrop (owner, 2026-10-09): the moving scene behind the app. Tapping one shows it
 * straight away, behind this frosted sheet; it's saved to the account, so every device follows.
 */
export function BackdropSheet() {
  const { api, close } = useWorkspace();
  const view = useBackdrop();
  const [error, setError] = useState("");
  const [news, setNews] = useState("");
  const [width, setWidth] = useState(0);
  // A switch on or off waiting for the app to reopen (made here during a call, or elsewhere).
  const pending = useReopenPending();
  // What the account says now (it may have changed by voice or on another device).
  useEffect(() => {
    void api.request<BackdropView>("/api/backdrop").then(
      (saved) => {
        if (needsReopen(saved.scene)) {
          markSaved(saved.scene);
        } else applyBackdrop(saved);
      },
      () => undefined,
    );
  }, [api]);
  const chosenScene = pending ? savedBackdrop() : view.scene;
  const save = async (next: BackdropView, said: string, stay = false) => {
    setError("");
    const before = view;
    // Hold still while a switch waits for the reopen: saved, and shown on this tab's scene.
    const reopen = !stay && needsReopen(next.scene);
    // A new scene shows at once; switching on or off reopens the app once it's saved.
    if (!reopen && !stay) applyBackdrop(next);
    try {
      const saved = await api.request<BackdropView>("/api/backdrop", next);
      if (!reopen) {
        applyBackdrop(stay ? { scene: view.scene, still: saved.still } : saved);
        markSaved(saved.scene);
        setNews(said);
        return;
      }
      markSaved(saved.scene);
      const outcome = reopenIfNeeded(saved.scene);
      setNews(
        outcome === "after-call" ? `${said} It changes after your call.` : `${said} Reopening…`,
      );
    } catch {
      if (!reopen) applyBackdrop(before);
      setError("Couldn’t change your backdrop. Check your connection and try again.");
    }
  };
  const pick = (scene: string) => {
    if (scene === chosenScene) return;
    void save({ ...view, scene }, `${sceneName(scene)}.`);
  };
  const columns = width >= 600 ? 5 : 3;
  const gap = 10;
  const tile = width ? Math.floor((width - gap * (columns - 1)) / columns) : 0;
  const off = chosenScene === NO_BACKDROP;
  // Picking a scene with the backdrop off (or No backdrop with it on) reopens the app.
  const reopens = (scene: string) => needsReopen(scene);
  return (
    <Sheet
      title="Backdrop"
      subtitle="The moving scene behind the app."
      onClose={close}
      fill
      narrow
      seeThrough
    >
      <View style={{ gap: 18 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {/* What's on now, and each change as it's made: always mounted, so it's read out. */}
        <Text role="status" style={[s.text, { fontWeight: "600" }]}>
          {news ||
            `Now: ${sceneName(chosenScene)}${off ? "" : view.still ? " · holds still" : " · moves"}`}
        </Text>
        {pending && <ReopenNow what={`Saved: ${sceneName(chosenScene)}.`} />}
        <View style={[s.row, { gap: 8, alignItems: "flex-start" }]}>
          <View style={{ marginTop: 2 }}>
            <Mic size={15} color={colors.blueDark} />
          </View>
          <Text style={[s.muted, { flex: 1, color: colors.mutedStrong }]}>
            Or just say, “Change my backdrop to the city,” or “Hold the backdrop still.”
          </Text>
        </View>
        {!off && (
          <CheckRow
            label="Hold still"
            detail="Shows the scene without moving, to save battery. It also pauses by itself during calls and when you haven’t touched the app for a while."
            checked={view.still}
            onPress={() =>
              void save(
                { ...view, scene: chosenScene, still: !view.still },
                view.still ? "Moving again." : "Holding still.",
                pending,
              )
            }
          />
        )}
        <View role="radiogroup" aria-label="Backdrop" style={{ gap: 18 }}>
          {tile > 0 &&
            backdropGroups().map(({ group, items }) => (
              <View key={group} style={{ gap: 8 }}>
                <Text role="heading" aria-level={3} style={s.heading}>
                  {group}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>
                  {items.map((item) => (
                    <Tile
                      key={item.id}
                      id={item.id}
                      name={item.name}
                      label={`${item.name}, ${group}${reopens(item.id) ? ". Reopens the app" : ""}`}
                      note={reopens(item.id) ? "Reopens the app" : undefined}
                      thumb={backdropFile(item.id, "thumb")}
                      focus={item.focus}
                      chosen={chosenScene === item.id}
                      onPress={() => pick(item.id)}
                      width={tile}
                    />
                  ))}
                </View>
              </View>
            ))}
          {tile > 0 && (
            <View style={{ gap: 8 }}>
              <Text role="heading" aria-level={3} style={s.heading}>
                Plain
              </Text>
              <View style={{ flexDirection: "row", gap }}>
                <Tile
                  id={NO_BACKDROP}
                  name="No backdrop"
                  label={`No backdrop, the plain look${reopens(NO_BACKDROP) ? ". Reopens the app" : ""}`}
                  note={reopens(NO_BACKDROP) ? "Reopens the app" : undefined}
                  chosen={off}
                  onPress={() => pick(NO_BACKDROP)}
                  width={tile}
                />
              </View>
            </View>
          )}
        </View>
        <ErrorNotice error={error} />
      </View>
    </Sheet>
  );
}

/**
 * The chat's card when the agent changes the backdrop: the scene's picture and name. A change
 * made in this reply (not one drawn again from an old chat) shows behind the app straight away.
 */
export function BackdropToolCard({ result, status }: { result: unknown; status: string }) {
  const { active, fresh } = useContext(BrowserRunContext);
  const live = useRef(false);
  const applied = useRef(false);
  if (status !== "complete" || active || fresh) live.current = true;
  let value = result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = undefined;
    }
  }
  const view = value as (BackdropView & { name?: string; error?: string }) | undefined;
  if (status !== "complete" || !view || view.error || typeof view.scene !== "string") return null;
  const reopen = needsReopen(view.scene);
  if (live.current && !applied.current) {
    applied.current = true;
    // Rendering can't change the store: do it right after. A switch on or off waits for the app
    // to reopen (the card offers it), like a change made on another device.
    setTimeout(() => {
      if (reopen) markSaved(view.scene);
      else applyBackdrop({ scene: view.scene, still: !!view.still });
    }, 0);
  }
  const backdrop = backdropById(view.scene);
  return (
    <View
      style={[
        s.row,
        {
          gap: 12,
          alignSelf: "stretch",
          maxWidth: 440,
          padding: 10,
          borderRadius: 18,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
        },
      ]}
    >
      {backdrop ? (
        <Image
          source={{ uri: backdropFile(backdrop.id, "thumb") }}
          accessible={false}
          style={{ width: 54, height: 72, borderRadius: 10 }}
        />
      ) : (
        <View
          style={{
            width: 54,
            height: 72,
            borderRadius: 10,
            backgroundColor: "#000",
            borderWidth: 1,
            borderColor: colors.line,
          }}
        />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.label}>Backdrop</Text>
        <Text style={[s.text, { fontWeight: "600" }]}>
          {backdrop ? backdrop.name : "No backdrop"}
          {backdrop && view.still ? ", holding still" : ""}
        </Text>
        {reopen && live.current && <ReopenNow what="Saved." />}
      </View>
    </View>
  );
}

/**
 * A switch on or off made by voice, on a call or on another device, waits for the app to reopen:
 * this pill offers it wherever the person is, once no call or sheet is in the way.
 */
export function BackdropReopenPill({
  canShow,
  desktop,
  chat,
}: {
  canShow: boolean;
  desktop: boolean;
  chat: boolean;
}) {
  const wanted = useReopenPill();
  const call = useLiveCallOn();
  const shown = wanted && canShow && !call;
  return (
    // Always there, so a screen reader hears it when it appears.
    <View
      role="status"
      pointerEvents="box-none"
      // The new-version pill's slot under the header, clear of every control (that one gives way).
      style={{
        position: "absolute",
        top: chat ? (desktop ? 58 : 50) : desktop ? 92 : 70,
        left: 0,
        right: 0,
        alignItems: "center",
        zIndex: 8,
      }}
    >
      {shown && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            maxWidth: "92%",
            paddingLeft: 18,
            paddingRight: 4,
            paddingVertical: 4,
            borderRadius: 28,
            backgroundColor: colors.inverse,
          }}
        >
          <Text style={{ flexShrink: 1, color: colors.onInverse, fontSize: 15, fontWeight: "600" }}>
            Backdrop saved
          </Text>
          <Pressable
            role="button"
            onPress={reopenApp}
            style={{
              minHeight: 44,
              paddingHorizontal: 16,
              borderRadius: 22,
              justifyContent: "center",
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>Reopen now</Text>
          </Pressable>
          <Pressable
            role="button"
            aria-label="Not now"
            onPress={reopenLater}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <X size={18} color={colors.onInverse} />
          </Pressable>
        </View>
      )}
    </View>
  );
}
