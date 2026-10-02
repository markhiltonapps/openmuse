import {
  CalendarDays,
  ChevronRight,
  ClipboardPlus,
  FolderOpen,
  Globe2,
  LifeBuoy,
  type LucideIcon,
  MessageCircle,
  Mic,
  Settings2,
  UsersRound,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { useMuseThread } from "./threads";
import { colors, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * The ☰ Menu: one short list of places, each saying what it's for and what to say instead. It
 * fits a phone without scrolling: the "Say …" lines drop when the whole menu wouldn't fit.
 */

/** The agent's browser: ready, busy on a website, or offline. */
export function useBrowserState() {
  const { workspace } = useWorkspace();
  const available = workspace.connections.some(
    (item) => item.id === "browser" && item.status === "connected",
  );
  if (!available) return "Offline" as const;
  return workspace.browsers.some((browser) => browser.status === "active")
    ? ("In use" as const)
    : ("Ready" as const);
}

function Badge({ state }: { state: ReturnType<typeof useBrowserState> }) {
  const tone =
    state === "Ready"
      ? { background: colors.green, dot: colors.greenDark }
      : state === "In use"
        ? { background: colors.sky, dot: colors.blueDark }
        : { background: colors.subtle, dot: colors.mutedStrong };
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
        backgroundColor: tone.background,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone.dot }} />
      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.text }}>{state}</Text>
    </View>
  );
}

function MenuRow({
  icon: Icon,
  title,
  detail,
  say,
  badge,
  onPress,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  say?: string;
  badge?: ReturnType<typeof useBrowserState>;
  onPress: () => void;
}) {
  return (
    <Pressable
      role="button"
      aria-label={`${title}${badge ? `, ${badge}` : ""}. ${detail}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        minHeight: 56,
        paddingVertical: 10,
        paddingHorizontal: 10,
        marginHorizontal: -10,
        borderRadius: 16,
        backgroundColor: pressed ? colors.subtle : "transparent",
      })}
    >
      <View style={[s.iconBox, { width: 40, height: 40, borderRadius: 12 }]}>
        <Icon size={19} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text style={[s.text, { fontWeight: "600" }]}>{title}</Text>
          {badge ? <Badge state={badge} /> : null}
        </View>
        <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>{detail}</Text>
        {say ? (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 2 }}>
            <View style={{ marginTop: 2 }}>
              <Mic size={13} color={colors.blueDark} />
            </View>
            <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
              {`Say “${say}”`}
            </Text>
          </View>
        ) : null}
      </View>
      <ChevronRight size={18} color={colors.mutedStrong} />
    </Pressable>
  );
}

export function MenuSheet({ onClose, onChats }: { onClose: () => void; onChats: () => void }) {
  const { open, navigate } = useWorkspace();
  const { data } = useAgentWorkspace();
  const agent = data?.identity.name || "your agent";
  const browser = useBrowserState();
  const { enabled } = useMuseThread();
  const { width, height } = useWindowDimensions();
  // The room a sheet has for its list: its tallest, less its title and padding.
  const room = (width < 600 ? height * 0.94 : Math.min(height * 0.9, 860)) - 140;
  const [fits, setFits] = useState<boolean>();
  const say = fits !== false;
  const go = (section: "calendar" | "spaces" | "files" | "apps") => {
    onClose();
    navigate(section);
  };
  const show = (detail: Parameters<typeof open>[0]) => {
    onClose();
    open(detail);
  };
  return (
    <Sheet title="Menu" subtitle={`Tap a place, or just ask ${agent}.`} onClose={onClose} narrow>
      <View
        // With its "Say …" lines it must fit without scrolling; if not, they go.
        onLayout={(event) => {
          if (fits === undefined) setFits(event.nativeEvent.layout.height <= room);
        }}
        // Unseen until measured, so the lines never show and then jump away.
        style={{ gap: 2, opacity: fits === undefined ? 0 : 1 }}
      >
        <MenuRow
          icon={MessageCircle}
          title="Chats"
          detail={
            enabled ? "Switch chats, or start a new one." : "Your chat, and a way to clear it."
          }
          say={say ? "open my main chat" : undefined}
          onPress={onChats}
        />
        <MenuRow
          icon={ClipboardPlus}
          title="New job"
          detail={`${agent.charAt(0).toUpperCase()}${agent.slice(1)} works on it in the background and tells you when it’s done.`}
          say={say ? "look into flights to Denver while I’m out" : undefined}
          onPress={() => show({ type: "delegate" })}
        />
        <MenuRow
          icon={CalendarDays}
          title="Calendar"
          detail="Your events and invitations."
          say={say ? "what’s on this week?" : undefined}
          onPress={() => go("calendar")}
        />
        <MenuRow
          icon={UsersRound}
          title="Spaces"
          detail="Your health, the family week and social media."
          say={say ? "open my health space" : undefined}
          onPress={() => go("spaces")}
        />
        <MenuRow
          icon={FolderOpen}
          title="Files"
          detail={`Your documents and photos, and what ${agent} saved for you.`}
          say={say ? "show my files" : undefined}
          onPress={() => go("files")}
        />
        <MenuRow
          icon={Globe2}
          title={`${agent.charAt(0).toUpperCase()}${agent.slice(1)}’s browser`}
          badge={browser}
          detail={`See the websites ${agent} is using, or take control.`}
          say={say ? "show me your browser" : undefined}
          onPress={() => show({ type: "computer" })}
        />
        <View style={[s.divider, { marginVertical: 8 }]} />
        <MenuRow
          icon={Settings2}
          title="Apps & settings"
          detail={`Your apps, ${agent}’s name and voice, alerts, money and your account.`}
          say={say ? "connect my Gmail" : undefined}
          onPress={() => go("apps")}
        />
        <MenuRow
          icon={LifeBuoy}
          title="Help & how-to"
          detail="Pictures and simple steps."
          say={say ? "how do approvals work?" : undefined}
          onPress={() => show({ type: "help" })}
        />
      </View>
    </Sheet>
  );
}
