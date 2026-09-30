import type { LucideIcon } from "lucide-react-native";
import { ArrowLeft, ArrowUpRight, MessageCircle, Plus, UsersRound } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Space, SpaceKind } from "../../../packages/domain/src/spaces";
import { useAgentWorkspace } from "./agent-workspace";
import { FamilyOverview, FamilyPlaybook } from "./family-space";
import { OurWeeks } from "./family-week-ui";
import { HealthFoodLog, HealthFoodPlan, HealthOverview, HealthPlaybook } from "./health-space-ui";
import { SocialResults } from "./social-dashboard-ui";
import {
  fail,
  heading,
  KINDS,
  Overview,
  Playbook,
  type SpaceTab,
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

type Tab = SpaceTab;

export function SpacesScreen() {
  const { spaces, load, failure } = useSpaces(true);
  const { api } = useWorkspace();
  const { data } = useAgentWorkspace();
  const agentName = data?.identity.name || "Neddy";
  const [, rerender] = useState(0);
  const [busy, setBusy] = useState<SpaceKind | "">("");
  // A space a chat button couldn't start says why here, once.
  const [error, setError] = useState(() => {
    const failed = spacesView.error ?? "";
    spacesView.error = undefined;
    return failed;
  });
  async function start(kind: SpaceKind) {
    setBusy(kind);
    setError("");
    try {
      const space = await api.request<Space>("/api/spaces", { kind });
      spacesView.shown = space.id;
      spacesView.kind = undefined;
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
    spacesView.kind = undefined;
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
  // A space asked for opens; otherwise the only space opens by itself, until "All spaces" is
  // asked for. While Health (which everyone has) is the only one, the list shows instead, so the
  // other kinds can be found; and a kind asked for that's gone (a removed Health) shows the list,
  // where it can be started again.
  const only = spaces.length === 1 && spaces[0]?.kind !== "health" ? spaces[0] : undefined;
  const space = spacesView.list
    ? undefined
    : (spaces.find((item) => item.id === spacesView.shown) ??
      (spacesView.kind ? spaces.find((item) => item.kind === spacesView.kind) : undefined) ??
      (spacesView.kind ? undefined : only));
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
  // Everyone has one health space; it can be started again only after it's been removed.
  const kinds = (Object.keys(KINDS) as SpaceKind[]).filter(
    (kind) => kind !== "health" || !spaces.some((item) => item.kind === "health"),
  );
  const starters = kinds.map((kind) => (
    <Button
      key={kind}
      icon={spaces.length ? Plus : KINDS[kind].icon}
      busy={busy === kind}
      disabled={!!busy && busy !== kind}
      onPress={() => void start(kind)}
    >
      {KINDS[kind].start}
    </Button>
  ));
  return (
    <View style={{ gap: 16 }}>
      <ErrorNotice error={error} />
      {spaces.length ? (
        <Card style={{ gap: 4 }}>
          {[...spaces]
            .sort((a, b) => Number(b.kind === "health") - Number(a.kind === "health"))
            .map((item) => (
              <LinkRow
                key={item.id}
                icon={KINDS[item.kind].icon}
                tint={KINDS[item.kind].tint}
                title={item.name}
                detail={
                  item.kind === "health"
                    ? "Your food log and workouts"
                    : item.setupDone
                      ? `Run by ${agentName}`
                      : "Not set up yet"
                }
                onPress={() => show(item.id)}
              />
            ))}
        </Card>
      ) : (
        <Empty
          icon={UsersRound}
          title={`Hand an area of your life to ${agentName}`}
          detail={`Your social media, the family week or your health. ${agentName} runs it from a playbook you can see and change, and nothing goes out or gets booked without your OK.`}
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
  focusRef,
  suffix,
}: {
  /**
   * Words that always show after the label, which alone may be cut short with "…" when there's
   * no room: "Bakery socials… chat". The pill's gap separates them.
   */
  suffix?: string;
  /** Set to focus this pill later (a tab chosen from inside the page). */
  focusRef?: (node: { focus?: () => void } | null) => void;
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
      ref={
        focusRef ? (node) => focusRef(node as unknown as { focus?: () => void } | null) : undefined
      }
      role={role}
      aria-selected={role === "tab" ? selected : undefined}
      accessibilityLabel={label ?? children}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 16,
        height: 44,
        borderRadius: 22,
        backgroundColor: selected ? colors.inverse : colors.subtle,
        opacity: pressed ? 0.8 : 1,
        ...(suffix ? { flexShrink: 1, maxWidth: "100%" as const } : {}),
      })}
    >
      {Icon && (
        <View style={{ flexShrink: 0 }}>
          <Icon size={15} color={color} />
        </View>
      )}
      <Text
        numberOfLines={1}
        style={{ fontSize: 14, fontWeight: "600", color, flexShrink: suffix ? 1 : 0 }}
      >
        {children}
      </Text>
      {suffix && (
        <Text style={{ fontSize: 14, fontWeight: "600", color, flexShrink: 0, marginLeft: -2 }}>
          {suffix}
        </Text>
      )}
      {Trailing && (
        <View style={{ flexShrink: 0 }}>
          <Trailing size={14} color={colors.muted} />
        </View>
      )}
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
  const pills = useRef<Partial<Record<Tab, { focus?: () => void } | null>>>({});
  const setTab = (next: Tab) => {
    spacesView.tab = next;
    setTabState(next);
  };
  /** A tab chosen from inside the page ("View food log"): focus follows to the tab. */
  const goTo = (next: Tab) => {
    setTab(next);
    setTimeout(() => pills.current[next]?.focus?.(), 0);
  };
  const tabPill = (id: Tab, name: string) => (
    <Pill
      role="tab"
      selected={tab === id}
      onPress={() => setTab(id)}
      focusRef={(node) => {
        pills.current[id] = node;
      }}
    >
      {name}
    </Pill>
  );
  const openChat = useOpenChat();
  const promise =
    space.kind === "family"
      ? "Nothing goes on the calendar without your OK."
      : space.kind === "health"
        ? `Only you and ${agentName} see it.`
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
      {/* The name, with the space's chat beside it (it opens on its own screen), or under it when
          both don't fit on one line; what the space is runs the full width below. */}
      <View style={{ gap: 4 }}>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            columnGap: 12,
            rowGap: 8,
          }}
        >
          <Text
            {...heading(2)}
            style={[s.title, { flexGrow: 1, flexShrink: 1, flexBasis: "auto" }]}
          >
            {space.name}
          </Text>
          {/* Named for its space, so it isn't mistaken for "Back to chat". */}
          <Pill
            role="link"
            icon={MessageCircle}
            trailing={ArrowUpRight}
            label={`Open the ${space.name} chat`}
            onPress={() => openChat(space)}
            suffix="chat"
          >
            {space.name}
          </Pill>
        </View>
        <Text style={s.muted}>
          {space.kind === "health"
            ? `${agentName} keeps your meals and exercise here, day by day and week by week. ${promise}`
            : space.setupDone
              ? `Run by ${agentName}. ${promise}`
              : `${agentName} sets this up with you in a few minutes.`}
        </Text>
      </View>
      {/* The tabs, which wrap onto a second line when they don't fit, so every one shows. */}
      <View role="tablist" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {tabPill("overview", "Overview")}
        {space.kind === "family" ? (
          tabPill("weeks", "Our weeks")
        ) : space.kind === "health" ? (
          <>
            {tabPill("food", "Food log")}
            {tabPill("plan", "Food plan")}
          </>
        ) : (
          tabPill("results", "Results")
        )}
        {tabPill("playbook", "Playbook")}
      </View>
      <View role="tabpanel">
        {space.kind === "health" ? (
          tab === "food" ? (
            <HealthFoodLog agentName={agentName} />
          ) : tab === "plan" ? (
            <HealthFoodPlan space={space} agentName={agentName} />
          ) : tab === "playbook" ? (
            <HealthPlaybook space={space} agentName={agentName} onRemoved={onRemoved} />
          ) : (
            <HealthOverview space={space} agentName={agentName} onTab={goTo} />
          )
        ) : space.kind === "family" ? (
          tab === "overview" ? (
            <FamilyOverview
              space={space}
              agentName={agentName}
              onPlaybook={() => setTab("playbook")}
            />
          ) : tab === "weeks" || tab === "results" ? (
            <OurWeeks space={space} agentName={agentName} />
          ) : (
            <FamilyPlaybook space={space} agentName={agentName} onRemoved={onRemoved} />
          )
        ) : tab === "results" ? (
          <SocialResults space={space} agentName={agentName} />
        ) : tab === "overview" || tab === "weeks" ? (
          <Overview space={space} agentName={agentName} onPlaybook={() => setTab("playbook")} />
        ) : (
          <Playbook space={space} agentName={agentName} onRemoved={onRemoved} />
        )}
      </View>
    </View>
  );
}
