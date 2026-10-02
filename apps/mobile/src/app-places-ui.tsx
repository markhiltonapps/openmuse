import {
  AlarmClock,
  ArrowLeft,
  AudioLines,
  Bell,
  BellRing,
  BookOpen,
  Bot,
  Brain,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  ChevronRight,
  ClipboardList,
  FileText,
  FolderOpen,
  HeartPulse,
  House,
  LifeBuoy,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  Mail,
  Megaphone,
  Mic,
  Monitor,
  Newspaper,
  PanelsTopLeft,
  Radar,
  Send,
  Shapes,
  ShieldCheck,
  SquareCheck,
  UserRound,
  UsersRound,
  UtensilsCrossed,
  Wallet,
} from "lucide-react-native";
import { type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import type { Section } from "../../../packages/domain/src";
import {
  APP_PLACES,
  type AppPlaceId,
  type PlaceRequest,
  placeWhere,
  showInAppSchema,
} from "../../../packages/domain/src/app-places";
import type { SpaceKind } from "../../../packages/domain/src/spaces";
import { useAgentWorkspace } from "./agent-workspace";
import { type AppsTab, showAppsTab } from "./apps-tabs";
import { BrowserRunContext } from "./browser-tool-card";
import { type SpaceTab, showSpace, spacesView } from "./space-view";
import { KINDS, useSpaces } from "./spaces";
import { colors, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * Take-me-there buttons: when the agent names a place in the app (show_in_app), a button under its
 * reply goes there. A place is a screen, a panel over the page, an Apps tab or a space's tab; see
 * packages/domain/src/app-places.ts for the list.
 */

const ICONS: Record<AppPlaceId, LucideIcon> = {
  feed: Newspaper,
  plans: ClipboardList,
  reminders: AlarmClock,
  calendar: CalendarDays,
  mail: Mail,
  updates: Bell,
  spaces: UsersRound,
  health: HeartPulse,
  "health-food-log": UtensilsCrossed,
  "health-food-plan": CalendarRange,
  "health-playbook": BookOpen,
  "log-meal": Mic,
  family: House,
  "family-weeks": CalendarCheck,
  "family-playbook": BookOpen,
  social: Megaphone,
  "social-results": ChartColumn,
  "social-playbook": BookOpen,
  activity: PanelsTopLeft,
  task: ListChecks,
  reviews: ShieldCheck,
  ideas: Lightbulb,
  goals: SquareCheck,
  tracking: Radar,
  files: FolderOpen,
  saved: FileText,
  "agent-computer": Monitor,
  delegate: Send,
  apps: Shapes,
  "agent-settings": Bot,
  memory: Brain,
  alerts: BellRing,
  money: Wallet,
  account: UserRound,
  help: LifeBuoy,
};

/** Places that are a space's tab. */
const SPACE_TABS: Partial<Record<AppPlaceId, { kind: SpaceKind; tab: SpaceTab }>> = {
  health: { kind: "health", tab: "overview" },
  "health-food-log": { kind: "health", tab: "food" },
  "health-food-plan": { kind: "health", tab: "plan" },
  "health-playbook": { kind: "health", tab: "playbook" },
  family: { kind: "family", tab: "overview" },
  "family-weeks": { kind: "family", tab: "weeks" },
  "family-playbook": { kind: "family", tab: "playbook" },
  social: { kind: "social", tab: "overview" },
  "social-results": { kind: "social", tab: "results" },
  "social-playbook": { kind: "social", tab: "playbook" },
};
/** Places that are a tab on the Apps screen. */
const APPS_TABS: Partial<Record<AppPlaceId, AppsTab>> = {
  apps: "apps",
  "agent-settings": "agent",
  memory: "about",
  alerts: "alerts",
  money: "money",
  account: "account",
  help: "help",
};
/** Places that are a screen, or a part of one the page scrolls to. */
const SCREENS: Partial<Record<AppPlaceId, { section: Section; anchor?: string }>> = {
  feed: { section: "feed" },
  calendar: { section: "calendar" },
  mail: { section: "mail" },
  spaces: { section: "spaces" },
  activity: { section: "activity" },
  reviews: { section: "activity", anchor: "reviews" },
  ideas: { section: "ideas" },
  goals: { section: "goals" },
  tracking: { section: "goals", anchor: "tracking" },
  files: { section: "files" },
  saved: { section: "files", anchor: "saved" },
};

// "Back to chat": the screen a button took the person to from the chat, while they're still on it.
let returnTo: Section | undefined;
const returnListeners = new Set<(section: Section | undefined) => void>();
function setReturnTo(section: Section | undefined) {
  returnTo = section;
  for (const listener of returnListeners) listener(section);
}
function useReturnTo() {
  const [section, setSection] = useState(returnTo);
  useEffect(() => {
    returnListeners.add(setSection);
    return () => {
      returnListeners.delete(setSection);
    };
  }, []);
  return section;
}

// The part of a screen to scroll to once it's drawn: "saved", "tracking", "reviews" or "memory".
let anchor: { id: string; at: number } | undefined;

/**
 * Moves keyboard (and screen reader) focus to what `find` returns once it's on screen, trying for
 * a couple of seconds while the screen draws. The web only; a phone app keeps its own focus.
 */
function focusWhenReady(find: () => HTMLElement | null | undefined) {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  let tries = 12;
  const attempt = () => {
    const node = find();
    if (node) {
      if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
      node.focus({ preventScroll: true });
    } else if (tries-- > 0) setTimeout(attempt, 150);
  };
  setTimeout(attempt, 200);
}
const shownNode = (selector: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(selector)).find((node) => node.offsetParent);
/** On arrival: the chosen tab of a space or of Apps, else the screen's title. */
const focusTab = () =>
  focusWhenReady(() =>
    shownNode('[role=tablist]:not([aria-label="Sections"]) [role=tab][aria-selected=true]'),
  );
const focusTitle = () => focusWhenReady(() => shownNode("#page-title"));
/** The button pressed in the chat, so "Back to chat" can put focus back on it. */
let pressedButton: HTMLElement | undefined;

/** Marks a part of a screen a button can take the person to; the page scrolls to it on arrival. */
export function PlaceAnchor({
  id,
  label,
  radius = 0,
  children,
}: {
  id: string;
  /** Its name for screen readers when focus arrives: "Saved by Neddy". */
  label: string;
  /** The corners of what it wraps, so the keyboard's focus ring follows them. */
  radius?: number;
  children: ReactNode;
}) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (anchor?.id !== id || Date.now() - anchor.at > 5000) return;
    anchor = undefined;
    if (Platform.OS !== "web") return;
    // After the page has laid out; below the header that floats over the page's top.
    const timer = setTimeout(() => {
      const node = ref.current as unknown as HTMLElement | null;
      let page = node?.parentElement;
      while (page && !/(auto|scroll)/.test(getComputedStyle(page).overflowY))
        page = page.parentElement;
      if (!node || !page) return;
      const top =
        node.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop;
      page.scrollTo({ top: Math.max(top - 164, 0), behavior: "smooth" });
      // And focus it, so the keyboard and screen readers arrive there too.
      node.setAttribute("tabindex", "-1");
      node.focus({ preventScroll: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [id]);
  return (
    <View ref={ref} role="region" aria-label={label} style={{ borderRadius: radius }}>
      {children}
    </View>
  );
}

/** What a place's button says, where it is, and how to get there. */
export function usePlace(request: PlaceRequest) {
  const { api, navigate, open, section } = useWorkspace();
  const { data } = useAgentWorkspace();
  const { spaces, load } = useSpaces();
  const [starting, setStarting] = useState(false);
  const agentName = data?.identity.name || "your agent";
  const info = APP_PLACES[request.place];
  const spaceTab = SPACE_TABS[request.place];
  const space = spaceTab && spaces?.find((item) => item.kind === spaceTab.kind);
  const artifact =
    request.place === "saved" && request.id
      ? data?.artifacts.find((item) => item.id === request.id)
      : undefined;
  const task =
    request.place === "task" && request.id
      ? data?.tasks.find((item) => item.id === request.id)
      : undefined;
  // A space they haven't started (or removed): the button starts it, then opens the place.
  const missing = !!spaceTab && !!spaces && !space;
  // A space goes by its own name, in case they renamed it ("Bakery socials").
  const name =
    request.place === "saved"
      ? (artifact?.title ?? `Saved by ${agentName}`)
      : request.place === "task"
        ? (task?.title ?? "Activity")
        : request.place === "agent-settings"
          ? `${agentName}’s settings`
          : request.place === "agent-computer"
            ? `${agentName}’s browser`
            : space && spaceTab?.tab === "overview"
              ? space.name
              : space && spaceTab?.tab === "playbook"
                ? `${space.name} playbook`
                : info.name;
  const label = missing
    ? KINDS[(spaceTab as { kind: SpaceKind }).kind].start
    : request.place === "log-meal" || request.place === "delegate"
      ? info.name
      : `Open ${name}`;
  const where = missing
    ? "Spaces"
    : request.place === "saved" && artifact
      ? `Saved by ${agentName}`
      : request.place === "task" && !task
        ? APP_PLACES.activity.where
        : space && info.where.startsWith("Spaces › ")
          ? placeWhere(request).replace(info.where, `Spaces › ${space.name}`)
          : placeWhere(request);
  // From the chat to another screen: "Back to chat" shows there until they move on.
  const toScreen = (next: Section) => {
    setReturnTo(section === "chat" ? next : undefined);
    navigate(next);
  };
  const go = (from?: unknown) => {
    // On the web the pressed control is its DOM node; "Back to chat" returns focus there.
    pressedButton =
      from && typeof (from as HTMLElement).focus === "function" ? (from as HTMLElement) : undefined;
    if (missing && spaceTab) {
      // Starts the space as the list's own Start button does, then opens the place asked for;
      // if that fails, the list shows, where Start is (with what went wrong).
      if (starting) return;
      setStarting(true);
      void api
        .request<{ id: string }>("/api/spaces", { kind: spaceTab.kind })
        .then(async (created) => {
          showSpace(spaceTab.kind, spaceTab.tab);
          spacesView.shown = created.id;
          await load().catch(() => undefined);
          toScreen("spaces");
          focusTab();
        })
        .catch((error: unknown) => {
          // The list shows what went wrong, next to its own Start button.
          spacesView.list = true;
          spacesView.shown = undefined;
          spacesView.error = error instanceof Error ? error.message : String(error);
          toScreen("spaces");
          focusTitle();
        })
        .finally(() => setStarting(false));
      return;
    }
    if (spaceTab) {
      showSpace(spaceTab.kind, spaceTab.tab);
      if (request.range) spacesView.range = request.range;
      toScreen("spaces");
      return focusTab();
    }
    const appsTab = APPS_TABS[request.place];
    if (appsTab) {
      showAppsTab(appsTab);
      focusTab();
      return toScreen("apps");
    }
    // Panels open over whatever is on screen; closing one comes back to the chat.
    if (artifact) return open({ type: "saved", artifact });
    if (task) return open({ type: "task", taskId: task.id });
    if (request.place === "plans") return open({ type: "commitments", tab: request.tab });
    if (request.place === "reminders") return open({ type: "reminders" });
    if (request.place === "updates") return open({ type: "notifications" });
    if (request.place === "log-meal") return open({ type: "food", log: true });
    if (request.place === "agent-computer") return open({ type: "computer" });
    if (request.place === "delegate") return open({ type: "delegate" });
    const screen = SCREENS[request.place] ?? { section: "activity" as const };
    if (request.place === "spaces") {
      spacesView.list = true;
      spacesView.shown = undefined;
    }
    anchor = screen.anchor ? { id: screen.anchor, at: Date.now() } : undefined;
    toScreen(screen.section);
    if (!screen.anchor) focusTitle();
  };
  return { label, where, icon: ICONS[request.place], go, missing, starting };
}

function PlaceButton({ request }: { request: PlaceRequest }) {
  const { label, where, icon: Icon, go, starting } = usePlace(request);
  return (
    <Pressable
      role="button"
      aria-busy={starting}
      // Read with words, not the symbols: "Open Food log. Spaces, Health, This week".
      aria-label={`${label}. ${where.replace(/ [›·] /g, ", ")}`}
      onPress={(event) => go(event.currentTarget)}
      style={(state) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 60,
        paddingVertical: 10,
        paddingLeft: 12,
        paddingRight: 14,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: (state as { hovered?: boolean }).hovered ? colors.subtle : colors.card,
        opacity: state.pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.blue,
        }}
      >
        <Icon size={18} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={[s.text, { fontSize: 15, fontWeight: "600" }]}>
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={[s.small, { fontSize: 12, lineHeight: 17, color: colors.mutedStrong }]}
        >
          {where}
        </Text>
      </View>
      {starting ? (
        <ActivityIndicator size="small" color={colors.mutedStrong} />
      ) : (
        <ChevronRight size={18} color={colors.mutedStrong} />
      )}
    </Pressable>
  );
}

/** Tool calls whose place already opened by itself, so a chat drawn again doesn't reopen it. */
const opened = new Set<string>();
/**
 * Opens a place once, as the reply asking for it comes in: only while its chat is on screen with
 * no panel over it, and never by starting a space (that stays a button to press). Otherwise the
 * button waits in the chat; coming back to the chat later doesn't open it.
 */
function OpenNow({
  request,
  toolCallId,
  canOpen,
}: {
  request: PlaceRequest;
  toolCallId: string;
  canOpen: boolean;
}) {
  const { go, missing } = usePlace(request);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || opened.has(toolCallId)) return;
    done.current = true;
    opened.add(toolCallId);
    if (canOpen && !missing) go();
  });
  return null;
}

/**
 * The buttons under a reply (show_in_app). With `go`, the first place opens by itself, but only
 * as the reply comes in: an old chat never moves the person.
 */
export function PlaceButtons({
  toolCallId,
  result,
  status,
}: {
  toolCallId: string;
  result: unknown;
  status: string;
}) {
  let value = result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = undefined;
    }
  }
  const parsed = showInAppSchema.safeParse(value);
  const shown = parsed.success ? parsed.data : undefined;
  // Part of the reply coming in now (seen unfinished, or during the run), not an old chat's.
  const { active, fresh, shown: onScreen } = useContext(BrowserRunContext);
  const { panelOpen } = useWorkspace();
  const live = useRef(false);
  if (status !== "complete" || active || fresh) live.current = true;
  const first = shown?.places[0];
  if (!shown) return null;
  return (
    // 12px below the reply's Listen and Copy, so a near miss on those doesn't land here.
    <View style={{ gap: 8, alignSelf: "stretch", maxWidth: 440, marginTop: 4 }}>
      {shown.go && first && live.current && status === "complete" && !opened.has(toolCallId) && (
        <OpenNow request={first} toolCallId={toolCallId} canOpen={onScreen && !panelOpen} />
      )}
      {shown.places.map((request) => (
        <PlaceButton
          key={`${request.place}-${request.id ?? ""}-${request.range ?? ""}-${request.tab ?? ""}`}
          request={request}
        />
      ))}
    </View>
  );
}

// Voice mode, while another screen shows: the chat publishes its state here, so "Back to chat"
// can say what it's doing and offer Interrupt and End (the chat's own bar is out of sight).
export interface VoiceAway {
  label: string;
  interrupt?: () => void;
  end: () => void;
}
let voiceAway: VoiceAway | undefined;
const voiceListeners = new Set<(voice: VoiceAway | undefined) => void>();
export function setVoiceAway(voice: VoiceAway | undefined) {
  voiceAway = voice;
  for (const listener of voiceListeners) listener(voice);
}
function useVoiceAway() {
  const [voice, setVoice] = useState(voiceAway);
  useEffect(() => {
    voiceListeners.add(setVoice);
    return () => {
      voiceListeners.delete(setVoice);
    };
  }, []);
  return voice;
}

/** What floats above the bottom bar on this screen: none, "Back to chat", or voice mode too. */
function usePills(section: Section) {
  const target = useReturnTo();
  const voice = useVoiceAway();
  const back = (!!target && section === target) || (!!voice && section !== "chat");
  return { target, voice: section !== "chat" ? voice : undefined, back };
}
/** Room to leave at the end of a page so the floating pills don't cover its last controls. */
export function usePillsRoom(section: Section) {
  const { voice, back } = usePills(section);
  return (back ? 64 : 0) + (voice ? 60 : 0);
}

/** A button on the voice pill: a 44px target around a visible 36px pill. */
function VoiceButton({
  onPress,
  label,
  children,
}: {
  onPress: () => void;
  label?: string;
  children: string;
}) {
  return (
    <Pressable
      role="button"
      aria-label={label ?? children}
      onPress={onPress}
      style={{ height: 44, justifyContent: "center" }}
    >
      {(state) => (
        <View
          style={{
            height: 36,
            paddingHorizontal: 14,
            borderRadius: 18,
            justifyContent: "center",
            backgroundColor: colors.card,
            opacity: state.pressed ? 0.8 : 1,
          }}
        >
          <Text style={[s.text, { fontSize: 14, fontWeight: "600" }]}>{children}</Text>
        </View>
      )}
    </Pressable>
  );
}

const pillStyle = (state: { pressed: boolean }, background: string) => ({
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 8,
  minHeight: 44,
  paddingHorizontal: 18,
  borderRadius: 22,
  backgroundColor: background,
  opacity: state.pressed ? 0.85 : (state as { hovered?: boolean }).hovered ? 0.92 : 1,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.18,
  shadowRadius: 14,
  elevation: 4,
});

/**
 * "Back to chat", on the screen a button took the person to from the chat. Tapping it goes back to
 * the conversation where they left it, with focus on the button they pressed; it goes away once
 * they move on to another screen. While voice mode is on, it shows too, with voice mode's state.
 */
export function BackToChat({ section, onBack }: { section: Section; onBack: () => void }) {
  const { target, voice, back } = usePills(section);
  const arrived = useRef(false);
  useEffect(() => {
    if (!target) {
      arrived.current = false;
      return;
    }
    if (section === target) arrived.current = true;
    else if (arrived.current) setReturnTo(undefined);
  }, [section, target]);
  if (!back) return null;
  const goBack = () => {
    setReturnTo(undefined);
    onBack();
    const button = pressedButton;
    pressedButton = undefined;
    // Focus goes back to the button pressed, or else to the message box.
    focusWhenReady(() =>
      button?.isConnected && button.offsetParent
        ? button
        : shownNode('textarea[aria-label^="Message"], input[aria-label^="Message"]'),
    );
  };
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 12,
        alignItems: "center",
        gap: 8,
      }}
    >
      {voice && (
        <View
          style={[
            pillStyle({ pressed: false }, colors.lavender),
            { paddingLeft: 16, paddingRight: 6, gap: 10, maxWidth: "100%" },
          ]}
        >
          <AudioLines size={18} color={colors.text} />
          {/* Only the state is announced as it changes, not the buttons beside it. */}
          <Text
            role="status"
            aria-live="polite"
            numberOfLines={1}
            style={[s.text, { flexShrink: 1, fontWeight: "500" }]}
          >
            {voice.label}
          </Text>
          {voice.interrupt && <VoiceButton onPress={voice.interrupt}>Interrupt</VoiceButton>}
          <VoiceButton onPress={voice.end} label="End voice conversation">
            End
          </VoiceButton>
        </View>
      )}
      <Pressable role="button" onPress={goBack} style={(state) => pillStyle(state, colors.inverse)}>
        <ArrowLeft size={16} color={colors.onInverse} />
        <Text style={{ color: colors.onInverse, fontSize: 14, fontWeight: "600" }}>
          Back to chat
        </Text>
      </Pressable>
    </View>
  );
}
