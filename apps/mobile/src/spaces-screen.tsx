import type { LucideIcon } from "lucide-react-native";
import { ArrowLeft, ArrowUpRight, LayoutGrid, MessageCircle, Plus } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Space, SpaceKind } from "../../../packages/domain/src/spaces";
import { useAgentWorkspace } from "./agent-workspace";
import { FamilyOverview, FamilyPlaybook } from "./family-space";
import {
  fail,
  heading,
  KINDS,
  Overview,
  Playbook,
  spacesView,
  useOpenChat,
  useSpaces,
} from "./spaces";
import { Button, Card, colors, Empty, ErrorNotice, LinkRow, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * The Spaces screen: the list of a person's spaces (or the offer to start one), and a space's
 * Overview and Playbook tabs. Each kind of space brings its own two tabs.
 */

type Tab = "overview" | "playbook";

export function SpacesScreen() {
  const { spaces, load, failure } = useSpaces(true);
  const { api } = useWorkspace();
  const { data } = useAgentWorkspace();
  const agentName = data?.identity.name || "Neddy";
  const [, rerender] = useState(0);
  const [busy, setBusy] = useState<SpaceKind | "">("");
  const [error, setError] = useState("");
  async function start(kind: SpaceKind) {
    setBusy(kind);
    setError("");
    try {
      const space = await api.request<Space>("/api/spaces", { kind });
      spacesView.shown = space.id;
      spacesView.list = false;
      spacesView.tab = "overview";
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  /** Opens a space, or the list of them (where a second kind can be started). */
  const show = (id?: string) => {
    spacesView.shown = id;
    spacesView.list = !id;
    spacesView.tab = "overview";
    rerender((n) => n + 1);
  };
  if (!spaces)
    return failure ? (
      <View style={{ gap: 12 }}>
        <ErrorNotice error={failure} />
        <Button style={{ alignSelf: "flex-start" }} onPress={() => void load().catch(fail)}>
          Try again
        </Button>
      </View>
    ) : (
      <Text style={s.muted}>Loading your spaces…</Text>
    );
  // The only space opens by itself, until "All spaces" is asked for.
  const space = spacesView.list
    ? undefined
    : (spaces.find((item) => item.id === spacesView.shown) ??
      (spaces.length === 1 ? spaces[0] : undefined));
  if (space)
    return (
      <SpaceView
        key={space.id}
        space={space}
        agentName={agentName}
        onBack={() => show(undefined)}
        onRemoved={() => show(undefined)}
      />
    );
  const starters = (Object.keys(KINDS) as SpaceKind[]).map((kind) => (
    <Button
      key={kind}
      icon={spaces.length ? Plus : KINDS[kind].icon}
      busy={busy === kind}
      disabled={!!busy && busy !== kind}
      onPress={() => void start(kind)}
    >
      {spaces.length ? KINDS[kind].more : KINDS[kind].start}
    </Button>
  ));
  return (
    <View style={{ gap: 16 }}>
      <ErrorNotice error={error} />
      {spaces.length ? (
        <Card style={{ gap: 4 }}>
          {spaces.map((item) => (
            <LinkRow
              key={item.id}
              icon={KINDS[item.kind].icon}
              tint={KINDS[item.kind].tint}
              title={item.name}
              detail={item.setupDone ? `Run by ${agentName}` : "Not set up yet"}
              onPress={() => show(item.id)}
            />
          ))}
        </Card>
      ) : (
        <Empty
          icon={LayoutGrid}
          title={`Hand an area of your life to ${agentName}`}
          detail={`Your social media, or the family week. ${agentName} runs it from a playbook you can see and change, and nothing goes out or gets booked without your OK.`}
        >
          <View style={{ gap: 8, alignSelf: "stretch" }}>{starters}</View>
        </Empty>
      )}
      {!!spaces.length && <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>{starters}</View>}
    </View>
  );
}

/** A pill like the Apps screen's tabs: a tab, or a link to another screen. */
function Pill({
  role,
  selected = false,
  icon: Icon,
  trailing: Trailing,
  label,
  onPress,
  children,
}: {
  role: "tab" | "link";
  selected?: boolean;
  icon?: LucideIcon;
  trailing?: LucideIcon;
  label?: string;
  onPress: () => void;
  children: string;
}) {
  const color = selected ? colors.onInverse : colors.text;
  return (
    <Pressable
      role={role}
      aria-selected={role === "tab" ? selected : undefined}
      accessibilityLabel={label ?? children}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 16,
        height: 40,
        borderRadius: 20,
        backgroundColor: selected ? colors.inverse : colors.subtle,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {Icon && <Icon size={15} color={color} />}
      <Text style={{ fontSize: 14, fontWeight: "600", color }}>{children}</Text>
      {Trailing && <Trailing size={14} color={colors.muted} />}
    </Pressable>
  );
}

function SpaceView({
  space,
  agentName,
  onBack,
  onRemoved,
}: {
  space: Space;
  agentName: string;
  onBack?: () => void;
  onRemoved: () => void;
}) {
  const [tab, setTabState] = useState<Tab>(spacesView.tab);
  const setTab = (next: Tab) => {
    spacesView.tab = next;
    setTabState(next);
  };
  const openChat = useOpenChat();
  const promise =
    space.kind === "family"
      ? "Nothing goes on the calendar without your OK."
      : "Nothing posts or costs you money without your OK.";
  return (
    <View style={{ gap: 20 }}>
      {onBack && (
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={[s.row, { gap: 6, alignSelf: "flex-start", minHeight: 44 }]}
        >
          <ArrowLeft size={16} color={colors.text} />
          <Text style={[s.text, { fontWeight: "500" }]}>All spaces</Text>
        </Pressable>
      )}
      <View style={{ gap: 4 }}>
        <Text {...heading(2)} style={s.title}>
          {space.name}
        </Text>
        <Text style={s.muted}>
          {space.setupDone
            ? `Run by ${agentName}. ${promise}`
            : `${agentName} sets this up with you in a few minutes.`}
        </Text>
      </View>
      {/* The two tabs, then the chat, which opens on its own screen. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <View role="tablist" style={{ flexDirection: "row", gap: 8 }}>
          <Pill role="tab" selected={tab === "overview"} onPress={() => setTab("overview")}>
            Overview
          </Pill>
          <Pill role="tab" selected={tab === "playbook"} onPress={() => setTab("playbook")}>
            Playbook
          </Pill>
        </View>
        <Pill
          role="link"
          icon={MessageCircle}
          trailing={ArrowUpRight}
          label={`Open the ${space.name} chat`}
          onPress={() => openChat(space)}
        >
          Chat
        </Pill>
      </View>
      <View role="tabpanel">
        {space.kind === "family" ? (
          tab === "overview" ? (
            <FamilyOverview
              space={space}
              agentName={agentName}
              onPlaybook={() => setTab("playbook")}
            />
          ) : (
            <FamilyPlaybook space={space} agentName={agentName} onRemoved={onRemoved} />
          )
        ) : tab === "overview" ? (
          <Overview space={space} agentName={agentName} />
        ) : (
          <Playbook space={space} agentName={agentName} onRemoved={onRemoved} />
        )}
      </View>
    </View>
  );
}
