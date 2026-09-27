import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Animated, Easing, Image, Platform, Text, View } from "react-native";
import type { AgentIdentity, AvatarImage } from "../../../packages/domain/src/agent";
import AvatarVideo from "./AvatarVideo";
import type { Activity, ActivityKind } from "./activity";
import { ActivityProp } from "./activity-props";
import { useAgentWorkspace } from "./agent-workspace";
import { API_URL, type MuseApi } from "./api";
import { ART, type CharacterId, PICTURE_CHARACTERS, VIDEO_CHARACTERS } from "./avatar-art";
import SvgArt from "./SvgArt";
import { colors } from "./ui";
import { useSpeaking } from "./voice";
import { useWorkspace } from "./workspace";

export type Mood = "idle" | "working" | "attention" | "celebrate";
export type AvatarColor = NonNullable<AgentIdentity["avatar"]>;
export const AVATAR_COLORS: Record<AvatarColor, string> = {
  sky: "#ECF5FA",
  sand: "#FAF0DF",
  lilac: "#F1ECF9",
  mint: "#E4F5EC",
  peach: "#FDE9E2",
};

/** What the open chat's reply is doing right now, so the header avatar can act it out. */
let chatNow: Activity | undefined;
const activityListeners = new Set<() => void>();
export function setChatActivity(value: Activity | undefined) {
  if (chatNow?.kind === value?.kind && chatNow?.label === value?.label) return;
  chatNow = value;
  for (const listener of activityListeners) listener();
}
export function useChatActivity() {
  return useSyncExternalStore(
    (listener) => {
      activityListeners.add(listener);
      return () => {
        activityListeners.delete(listener);
      };
    },
    () => chatNow,
    () => chatNow,
  );
}

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduce)
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => subscription?.remove();
  }, []);
  return reduce;
}
/** Closes the eyes for a moment every few seconds. */
function useBlink(enabled: boolean) {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          setClosed(true);
          timer = setTimeout(() => {
            setClosed(false);
            schedule();
          }, 150);
        },
        2600 + Math.random() * 3400,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [enabled]);
  return closed;
}

/** The capybara photo-style art, with eyelids drawn over its eyes to blink. */
function Capybara({ size, blink }: { size: number; blink: boolean }) {
  const closed = useBlink(blink);
  const lid = (cx: number, cy: number, w: number, h: number) => (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: size * (cx - w / 2),
        top: size * (cy - h / 2),
        width: size * w,
        height: size * h,
        borderRadius: size,
        backgroundColor: "#D39B6E",
        opacity: closed ? 1 : 0,
        justifyContent: "center",
      }}
    >
      <View
        style={{
          height: Math.max(1, size * 0.006),
          marginHorizontal: size * w * 0.12,
          marginTop: size * h * 0.25,
          borderRadius: 2,
          backgroundColor: "#5E4030",
        }}
      />
    </View>
  );
  return (
    <View style={{ width: size, height: size }}>
      <Image
        source={require("../assets/capybara.png")}
        resizeMode="contain"
        style={{ width: size, height: size }}
        accessible={false}
      />
      {lid(0.5227, 0.2006, 0.066, 0.042)}
      {lid(0.3074, 0.1595, 0.016, 0.02)}
    </View>
  );
}

function ThinkingDots({ size }: { size: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 3,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const dot = size * 0.07;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: -size * 0.02,
        right: -size * 0.16,
        flexDirection: "row",
        gap: dot * 0.6,
        paddingHorizontal: dot * 1.2,
        paddingVertical: dot * 0.9,
        borderRadius: size,
        backgroundColor: colors.surface,
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
      }}
    >
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={{
            width: dot,
            height: dot,
            borderRadius: dot,
            backgroundColor: colors.muted,
            opacity: pulse.interpolate({
              inputRange: [0, 1, 2, 3],
              outputRange:
                i === 0 ? [1, 0.3, 0.3, 1] : i === 1 ? [0.3, 1, 0.3, 0.3] : [0.3, 0.3, 1, 0.3],
            }),
          }}
        />
      ))}
    </View>
  );
}

function Sparkles({ size }: { size: number }) {
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const out = Animated.timing(fade, {
      toValue: 0,
      duration: 1800,
      easing: Easing.in(Easing.quad),
      useNativeDriver: Platform.OS !== "web",
    });
    out.start();
    return () => out.stop();
  }, [fade]);
  const style = { position: "absolute" as const, fontSize: size * 0.24 };
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", inset: 0, opacity: fade }}>
      <Text style={[style, { top: -size * 0.08, left: -size * 0.1 }]}>✨</Text>
      <Text style={[style, { top: size * 0.1, right: -size * 0.14 }]}>✨</Text>
    </Animated.View>
  );
}

/**
 * The agent's avatar: a built-in character or the person's own picture, gently breathing and
 * blinking, bobbing while it works, hopping when it needs you, and celebrating finished work.
 */
export function Mascot({
  size = 42,
  variant = "sky",
  character = "neddy",
  image,
  mood = "idle",
  activity,
  animated = true,
  speaking = false,
}: {
  size?: number;
  variant?: AvatarColor;
  character?: CharacterId | "custom";
  image?: AvatarImage | null;
  mood?: Mood;
  /** Shown with a small prop while working: a laptop, magnifying glass, page and so on. */
  activity?: ActivityKind;
  animated?: boolean;
  /** The agent is reading a reply aloud: characters made of clips switch to talking. */
  speaking?: boolean;
}) {
  const video = character !== "custom" && VIDEO_CHARACTERS[character] === true;
  const picture = character !== "custom" && PICTURE_CHARACTERS[character] === true;
  const reduce = useReducedMotion();
  const motion = animated && !reduce;
  const breathe = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    breathe.setValue(0);
    lift.setValue(0);
    if (!motion) return;
    const move = (
      value: Animated.Value,
      toValue: number,
      duration: number,
      easing = Easing.inOut(Easing.sin),
    ) =>
      Animated.timing(value, {
        toValue,
        duration,
        easing,
        useNativeDriver: Platform.OS !== "web",
      });
    const hop = (height: number) =>
      Animated.sequence([
        move(lift, height, 170, Easing.out(Easing.quad)),
        move(lift, 0, 480, Easing.bounce),
      ]);
    const animation =
      mood === "working"
        ? activity === "apps" || activity === "computer" || activity === "writing"
          ? // Quick, small bounces, like typing.
            Animated.loop(Animated.sequence([move(lift, 0.3, 150), move(lift, 0, 150)]))
          : Animated.loop(Animated.sequence([move(lift, 0.6, 340), move(lift, 0, 340)]))
        : mood === "attention"
          ? Animated.loop(Animated.sequence([Animated.delay(1700), hop(1.4)]))
          : mood === "celebrate"
            ? Animated.sequence([hop(2), hop(1.3)])
            : // Clips breathe on their own.
              video
              ? undefined
              : Animated.loop(Animated.sequence([move(breathe, 1, 1700), move(breathe, 0, 1700)]));
    animation?.start();
    return () => animation?.stop();
  }, [mood, activity, motion, breathe, lift, video]);
  const custom = character === "custom";
  const art = video ? (
    <AvatarVideo id={character} size={size} speaking={speaking} still={!motion} />
  ) : picture ? (
    <Image
      source={{ uri: `${API_URL}/api/avatar-media/${character}/poster` }}
      resizeMode="cover"
      accessible={false}
      style={{ width: size, height: size, borderRadius: size, backgroundColor: "#F6F5EE" }}
    />
  ) : custom ? (
    image?.kind === "photo" ? (
      <Image
        source={{ uri: image.data }}
        accessible={false}
        style={{
          width: size * 0.9,
          height: size * 0.9,
          margin: size * 0.05,
          borderRadius: size,
        }}
      />
    ) : image?.kind === "svg" ? (
      <SvgArt svg={image.data} size={size} />
    ) : null
  ) : character === "capybara" ? (
    <Capybara size={size} blink={motion} />
  ) : character === "todd" || character === "neddy" ? null : (
    <SvgArt svg={ART[character]} size={size} />
  );
  const inset =
    character === "capybara"
      ? { top: 0.15, left: 0.12, size: 0.76 }
      : video || picture
        ? { top: 0, left: 0, size: 1 }
        : { top: 0.04, left: 0.04, size: 0.92 };
  return (
    <View
      accessibilityLabel={
        mood === "working"
          ? "Your agent is working"
          : mood === "attention"
            ? "Your agent needs you"
            : "Your agent"
      }
      style={{ width: size, height: size }}
    >
      <View
        style={{
          position: "absolute",
          top: size * inset.top,
          left: size * inset.left,
          width: size * inset.size,
          height: size * inset.size,
          borderRadius: size,
          backgroundColor: AVATAR_COLORS[variant] ?? AVATAR_COLORS.sky,
        }}
      />
      <Animated.View
        style={{
          width: size,
          height: size,
          transformOrigin: "50% 100%",
          transform: [
            {
              translateY: lift.interpolate({ inputRange: [0, 2], outputRange: [0, -size * 0.14] }),
            },
            { scaleY: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] }) },
            { scaleX: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 0.99] }) },
          ],
        }}
      >
        {art}
      </Animated.View>
      {motion &&
        mood === "working" &&
        size >= 36 &&
        (activity && activity !== "thinking" ? (
          <ActivityProp kind={activity} size={size} />
        ) : (
          <ThinkingDots size={size} />
        ))}
      {motion && mood === "celebrate" && <Sparkles size={size} />}
    </View>
  );
}

let cached: { version: string; image: AvatarImage | null } | undefined;
/** The person's own avatar picture, fetched once per saved version. */
export function useAvatarImage(api: MuseApi, version?: string) {
  const [image, setImage] = useState(cached?.version === version ? cached?.image : undefined);
  useEffect(() => {
    if (!version) return setImage(undefined);
    if (cached?.version === version) return setImage(cached.image);
    let active = true;
    void api
      .request<{ image: AvatarImage | null }>("/api/agent/avatar-image")
      .then(({ image: value }) => {
        cached = { version, image: value };
        if (active) setImage(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, version]);
  return image;
}

/** The signed-in person's agent avatar, as chosen in Apps → Personality. */
export function AgentAvatar({
  size,
  mood,
  activity,
}: {
  size: number;
  mood?: Mood;
  activity?: ActivityKind;
}) {
  const { data } = useAgentWorkspace();
  const { api } = useWorkspace();
  const identity = data?.identity;
  const custom = identity?.character === "custom";
  const image = useAvatarImage(api, custom ? identity?.avatarImageVersion : undefined);
  const speaking = useSpeaking();
  return (
    <Mascot
      size={size}
      variant={identity?.avatar}
      character={identity?.character ?? "neddy"}
      image={image}
      mood={mood}
      activity={activity}
      speaking={speaking}
    />
  );
}
