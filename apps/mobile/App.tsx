import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import { StatusBar } from "expo-status-bar";
import {
  Bell,
  Check,
  FolderOpen,
  Lightbulb,
  type LucideIcon,
  Menu,
  MessageCircle,
  Newspaper,
  PanelsTopLeft,
  Plus,
  Shapes,
  SquareCheck,
  UsersRound,
  X,
} from "lucide-react-native";
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Section, Workspace } from "../../packages/domain/src";
import { taskActivity } from "./src/activity";
import {
  AgentActivityScreen,
  AgentStatus,
  AppsScreen,
  GoalsScreen,
  IdeasScreen,
} from "./src/agent-ui";
import { AgentWorkspaceProvider, useAgentWorkspace } from "./src/agent-workspace";
import {
  API_URL,
  checkSession,
  createSession,
  MuseApi,
  onSignedOut,
  redeemSignInCode,
  redeemSignInLink,
  serverInfo,
} from "./src/api";
import { BackToChat, usePillsRoom } from "./src/app-places-ui";
import { AgentAvatar, Mascot, type Mood, useChatActivity } from "./src/avatar";
import { ChatScreen, WorkspaceTools } from "./src/chat";
import { ComputerEntry } from "./src/computer";
import { ComputerDraftProvider } from "./src/computer-drafts";
import { Details } from "./src/details";
import { FeedScreen } from "./src/feed";
import { CallBar, CallNews, LiveCallProvider, useCallControls, useCallNews } from "./src/live-call";
import { LiveTalkSheet } from "./src/live-talk-ui";
import { BrowserScreen, CalendarScreen, FilesScreen, MailScreen } from "./src/screens";
import {
  clearSession,
  linkAccessKey,
  linkLoginToken,
  loadSession,
  saveSession,
} from "./src/session-store";
import { SignInCard } from "./src/sign-in";
import { SpaceChip } from "./src/spaces";
import { SpacesScreen } from "./src/spaces-screen";
import TipLayer from "./src/TipLayer";
import { dark } from "./src/theme";
import { ThreadsProvider, ThreadsSheet, useMuseThread } from "./src/threads";
import { tipProps } from "./src/tips";
import { Button, colors, ErrorNotice, IconButton, SheetStatus, SheetTop, s } from "./src/ui";
import { UpdateToasts } from "./src/update-toasts";
import {
  listenForCheckIns,
  listenForReviewLinks,
  listenForTaskLinks,
  registerServiceWorker,
  takeDelegateDraft,
  typing,
  watchForUpdates,
} from "./src/web-app";
import { type Detail, useWorkspace, WorkspaceContext } from "./src/workspace";

/** The bottom bar. `short` is the word under the icon when the full name is too long for it. */
const nav: { id: Section; label: string; short?: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "feed", label: "Feed", icon: Newspaper },
  { id: "spaces", label: "Spaces", icon: UsersRound },
  { id: "activity", label: "Activity", icon: PanelsTopLeft },
  { id: "ideas", label: "Ideas", icon: Lightbulb },
  { id: "goals", label: "Goals", icon: SquareCheck },
  { id: "files", label: "Files & media", short: "Files", icon: FolderOpen },
  { id: "apps", label: "Apps", icon: Shapes },
];
const titles: Partial<Record<Section, { title: string; subtitle: string }>> = {
  activity: { title: "Activity", subtitle: "Plans, progress, decisions and results." },
  feed: { title: "Feed", subtitle: "Your day, and what's new on the topics you follow." },
  ideas: { title: "Ideas", subtitle: "Useful next steps, grounded in your world." },
  goals: {
    title: "Goals",
    subtitle: "Longer-term goals and things to keep an eye on.",
  },
  apps: {
    title: "Apps",
    subtitle: "Connections, capabilities and what your agent remembers.",
  },
  connections: { title: "Apps", subtitle: "Connections and capabilities." },
  mail: { title: "Mail", subtitle: "The conversations behind your work." },
  calendar: { title: "Calendar", subtitle: "Time for what matters." },
  browser: { title: "Browser", subtitle: "Your connected browsing sessions." },
  files: { title: "Files & media", subtitle: "Photos, documents, forms and filled copies." },
  spaces: { title: "Spaces", subtitle: "Areas of your life your agent runs for you." },
};
export default function App() {
  const [token, setToken] = useState("");
  const [emailSignIn, setEmailSignIn] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const signIn = useCallback(async (start: () => Promise<{ token: string }>) => {
    setBusy(true);
    setError("");
    try {
      const session = await start();
      await saveSession(session.token);
      setToken(session.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => registerServiceWorker(), []);
  useEffect(() => {
    void (async () => {
      const info = serverInfo().then((value) => {
        setEmailSignIn(value.emailSignIn);
        return value;
      });
      const login = linkLoginToken();
      if (login) return signIn(() => redeemSignInLink(login));
      const linked = linkAccessKey();
      if (linked) return signIn(() => createSession(linked));
      const saved = await loadSession();
      if (saved && (await checkSession(saved))) {
        setToken(saved);
        setBusy(false);
        return;
      }
      if (saved) await clearSession();
      // A local workspace opens without signing in; a live one shows the sign-in screen.
      if ((await info).mode === "sample") return signIn(() => createSession());
      setBusy(false);
    })();
  }, [signIn]);
  useEffect(
    () =>
      onSignedOut((byChoice) => {
        void clearSession();
        setToken("");
        setError(byChoice ? "" : "Your sign-in ended. Sign in again.");
      }),
    [],
  );
  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? "light" : "dark"} />
      {token ? (
        <CopilotKitProvider
          runtimeUrl={`${API_URL}/api/copilotkit`}
          headers={{ Authorization: `Bearer ${token}` }}
        >
          <WorkspaceApp token={token} />
        </CopilotKitProvider>
      ) : (
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: colors.canvas,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View style={{ width: "100%", maxWidth: 420, gap: 22, alignItems: "center" }}>
            <Mascot size={72} />
            <Text
              style={{ fontSize: 32, color: colors.text, letterSpacing: -1, fontWeight: "500" }}
            >
              Welcome to Neato_Muse.
            </Text>
            <Text style={[s.muted, { textAlign: "center" }]}>A little room for your day.</Text>
            {busy ? (
              <ActivityIndicator color={colors.blueDark} />
            ) : (
              <SignInCard
                emailSignIn={emailSignIn}
                error={error}
                onKey={(key) => void signIn(() => createSession(key || undefined))}
                onLogin={(login) => void signIn(() => redeemSignInLink(login))}
                onCode={(email, code) => void signIn(() => redeemSignInCode(email, code))}
              />
            )}
          </View>
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}
function WorkspaceApp({ token }: { token: string }) {
  const api = useMemo(() => new MuseApi(token), [token]);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [section, setSection] = useState<Section>("chat");
  const [detail, setDetail] = useState<Detail>();
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<{ id: number; text: string }>();
  const refresh = useCallback(async () => {
    const snapshot = await api.request<Workspace>("/api/workspace");
    setWorkspace(snapshot);
    setError("");
  }, [api]);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [refresh]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch((e) => setError(String(e)));
    });
    return () => listener.remove();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    if (Platform.OS !== "web") AccessibilityInfo.announceForAccessibility(toast);
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = useCallback(
    (next: Section) =>
      setSection(next === "today" ? "chat" : next === "connections" ? "apps" : next),
    [],
  );
  const open = useCallback((next: Detail) => setDetail(next), []);
  const close = useCallback(() => setDetail(undefined), []);
  const ask = useCallback((text: string) => {
    setPrompt({ id: Date.now(), text });
    setSection("chat");
  }, []);
  // A tapped meal check-in opens chat, where its card is waiting.
  useEffect(
    () =>
      listenForCheckIns(() => {
        setDetail(undefined);
        setSection("chat");
      }),
    [],
  );
  // A job email's link or a tapped notification opens that job.
  useEffect(() => listenForTaskLinks((taskId) => setDetail({ type: "task", taskId })), []);
  // A tapped "Ready for your review" notification opens that review once the workspace is in;
  // if it's already been decided or has expired, Activity shows where things stand.
  const [reviewLink, setReviewLink] = useState("");
  useEffect(() => listenForReviewLinks(setReviewLink), []);
  useEffect(() => {
    if (!reviewLink || !workspace) return;
    const id = reviewLink;
    setReviewLink("");
    const waiting = (list: Workspace["actions"]) =>
      list.find((item) => item.id === id && item.status === "awaiting_review");
    const action = waiting(workspace.actions);
    if (action) return setDetail({ type: "review", action });
    // Saved during a call while the app was open: it may not be in what's loaded yet.
    void api
      .request<Workspace>("/api/workspace")
      .then((fresh) => {
        setWorkspace(fresh);
        const found = waiting(fresh.actions);
        if (found) setDetail({ type: "review", action: found });
        else setSection("activity");
      })
      .catch(() => setSection("activity"));
  }, [reviewLink, workspace, api]);
  // A ?delegate= link opens Delegate task with the job filled in, ready to check and send.
  useEffect(() => {
    const prompt = takeDelegateDraft();
    if (prompt) setDetail({ type: "delegate", prompt });
  }, []);
  if (!workspace)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 18,
        }}
      >
        <Mascot size={56} />
        {error ? (
          <>
            <ErrorNotice error={error} />
            <Button onPress={() => void refresh().catch((e) => setError(String(e)))}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.blueDark} />
            <Text style={s.muted}>Opening your workspace…</Text>
          </>
        )}
      </SafeAreaView>
    );
  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        api,
        section,
        navigate,
        refresh,
        open,
        close,
        notify: setToast,
        ask,
        panelOpen: !!detail,
      }}
    >
      <AgentWorkspaceProvider>
        <ComputerDraftProvider key={token}>
          <ThreadsProvider>
            {/* The live call carries on across screens and sheets, its bar on top of them. */}
            <LiveCallProvider>
              <CallBarSlot>
                <WorkspaceShell
                  detail={detail}
                  toast={toast}
                  clearToast={() => setToast("")}
                  error={error}
                  prompt={prompt}
                />
              </CallBarSlot>
            </LiveCallProvider>
          </ThreadsProvider>
        </ComputerDraftProvider>
      </AgentWorkspaceProvider>
    </WorkspaceContext.Provider>
  );
}
/**
 * The call's bar, for the page and for every sheet, while there's a call; and what just happened to
 * it, read out from inside a sheet.
 */
function CallBarSlot({ children }: { children: ReactNode }) {
  const { phase } = useCallControls();
  const news = useCallNews();
  // The same element while the call goes on, so sheets aren't redrawn as words arrive. It stays
  // under the call screen too, so focus can go back to it when the call shrinks.
  const bar = useMemo(() => (phase !== "idle" ? <CallBar /> : null), [phase]);
  return (
    <SheetTop.Provider value={bar}>
      <SheetStatus.Provider value={news}>{children}</SheetStatus.Provider>
    </SheetTop.Provider>
  );
}
function WorkspaceShell({
  detail,
  toast,
  clearToast,
  error,
  prompt,
}: {
  detail?: Detail;
  toast: string;
  clearToast: () => void;
  error: string;
  prompt?: { id: number; text: string };
}) {
  const { workspace, section, navigate, open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const {
    selection,
    visited,
    mainId,
    loading: threadsLoading,
    error: threadsError,
    retry: retryThreads,
    enabled: richThreads,
  } = useMuseThread();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const { width } = useWindowDimensions();
  const callBar = useContext(SheetTop);
  const call = useCallControls();
  const desktop = width >= 900;
  const pending =
    (data?.notifications.filter((n) => !n.read).length || 0) +
    workspace.actions.filter((a) => a.status === "awaiting_review").length;
  const activeTask =
    data?.tasks.find(
      (task) => task.status === "waiting_approval" || task.status === "waiting_input",
    ) ||
    data?.tasks.find((task) => task.status === "running") ||
    data?.tasks.find((task) => task.status === "queued");
  const agentName = data?.identity.name || "Neddy";
  const chatNow = useChatActivity();
  const activity =
    chatNow ??
    (activeTask?.status === "running"
      ? taskActivity(activeTask)
      : activeTask?.status === "queued"
        ? ({ kind: "thinking", label: "Getting started…" } as const)
        : undefined);
  // A task that newly succeeds gets a short celebration.
  const [celebrating, setCelebrating] = useState(false);
  const succeeded = useRef<Set<string>>(undefined);
  const celebration = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!data) return;
    const done = new Set(data.tasks.filter((t) => t.status === "succeeded").map((t) => t.id));
    const fresh = succeeded.current && [...done].some((id) => !succeeded.current?.has(id));
    succeeded.current = done;
    if (!fresh) return;
    setCelebrating(true);
    clearTimeout(celebration.current);
    celebration.current = setTimeout(() => setCelebrating(false), 2400);
  }, [data]);
  useEffect(() => () => clearTimeout(celebration.current), []);
  const mood: Mood = celebrating
    ? "celebrate"
    : activeTask && !["running", "queued"].includes(activeTask.status) && !chatNow
      ? "attention"
      : activity
        ? "working"
        : "idle";
  const status = chatNow
    ? chatNow.label
    : activeTask
      ? activeTask.status === "waiting_approval"
        ? "Ready to review"
        : activeTask.status === "waiting_input"
          ? "Needs your answer"
          : (activity?.label ?? activeTask.title)
      : data?.tasks.some((task) => task.status === "queued")
        ? "Starting your next job…"
        : "Here when you need me";
  const title = titles[section] || titles.apps;
  const Screen =
    section === "mail"
      ? MailScreen
      : section === "calendar"
        ? CalendarScreen
        : section === "browser"
          ? BrowserScreen
          : section === "files"
            ? FilesScreen
            : section === "activity"
              ? AgentActivityScreen
              : section === "feed"
                ? FeedScreen
                : section === "ideas"
                  ? IdeasScreen
                  : section === "goals"
                    ? GoalsScreen
                    : section === "spaces"
                      ? SpacesScreen
                      : AppsScreen;
  const utility = ["mail", "calendar", "browser"].includes(section);
  const chat = section === "chat";
  const headerHeight = chat ? (desktop ? 150 : 128) : desktop ? 158 : 132;
  const pillsRoom = usePillsRoom(section);
  return (
    <>
      <WorkspaceTools />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={["top", "bottom"]}>
        {/* A sheet over the page shows the bar itself (the page's would be under its shade). */}
        {callBar && !detail && !threadsOpen && (
          <View style={{ width: "100%", maxWidth: 760, alignSelf: "center", zIndex: 9 }}>
            {callBar}
          </View>
        )}
        <View style={{ flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" }}>
          <View
            pointerEvents="box-none"
            style={
              chat
                ? { height: headerHeight, paddingTop: desktop ? 14 : 4, marginHorizontal: 20 }
                : {
                    // Floats over the page, which scrolls underneath, like Meta Muse.
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 5,
                    height: headerHeight,
                    paddingTop: desktop ? 14 : 4,
                    paddingHorizontal: 20,
                  }
            }
          >
            {!chat && (
              <View
                pointerEvents="none"
                style={{ position: "absolute", top: 0, left: 0, right: 0, height: headerHeight }}
              >
                <Svg width="100%" height="100%">
                  <Defs>
                    <LinearGradient id="header-fade" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor={colors.canvas} stopOpacity={0.96} />
                      <Stop offset="0.62" stopColor={colors.canvas} stopOpacity={0.8} />
                      <Stop offset="1" stopColor={colors.canvas} stopOpacity={0} />
                    </LinearGradient>
                  </Defs>
                  <Rect width="100%" height="100%" fill="url(#header-fade)" />
                </Svg>
              </View>
            )}
            {/* Above the centered title, which spans the full header width and would take the tap. */}
            <View style={{ position: "absolute", left: chat ? 0 : 20, top: 16, zIndex: 2 }}>
              <IconButton
                icon={Menu}
                label="Open conversations and menu"
                onPress={() => setThreadsOpen(true)}
              />
            </View>
            <View style={{ alignItems: "center", gap: 1 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  activeTask
                    ? `${agentName}: ${status.replace(/…$/, "")}. Open this job`
                    : `Open ${agentName} activity and approvals`
                }
                onPress={() =>
                  activeTask ? open({ type: "task", taskId: activeTask.id }) : navigate("activity")
                }
                style={({ pressed }) => ({
                  alignItems: "center",
                  // The status line sits below the buttons, so it can use the header's width;
                  // the buttons are above it and keep their taps.
                  maxWidth: Math.min(width, 760) - 40,
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <AgentAvatar
                  size={chat ? (desktop ? 66 : 58) : desktop ? 88 : width < 360 ? 64 : 76}
                  mood={mood}
                  activity={mood === "working" ? activity?.kind : undefined}
                />
                <View
                  style={{
                    marginTop: -10,
                    paddingHorizontal: 14,
                    paddingVertical: 5,
                    borderRadius: 18,
                    backgroundColor: colors.subtle,
                    borderWidth: 2,
                    borderColor: colors.canvas,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 15,
                      fontWeight: "600",
                      color: colors.text,
                      letterSpacing: -0.3,
                    }}
                  >
                    {agentName}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={{
                    // Busy or waiting on you, it says so clearly; idle, it's quiet.
                    fontSize: mood === "idle" ? 11 : 12,
                    fontWeight: mood === "idle" ? "400" : "600",
                    color:
                      mood === "working"
                        ? colors.blueText
                        : mood === "attention"
                          ? colors.text
                          : colors.muted,
                    marginTop: 4,
                    marginBottom: 6,
                  }}
                >
                  {mood === "idle" ? " " : status}
                </Text>
              </Pressable>
              {section === "chat" && <ComputerEntry />}
            </View>
            <View
              style={{
                position: "absolute",
                right: chat ? 0 : 20,
                top: 16,
                zIndex: 2,
                flexDirection: "row",
                gap: 4,
              }}
            >
              <IconButton
                icon={Plus}
                label={`New job for ${agentName}`}
                onPress={() => open({ type: "delegate" })}
              />
              <View>
                <IconButton
                  icon={Bell}
                  label={pending ? `Updates, ${pending} new` : "Updates"}
                  onPress={() => open({ type: "notifications" })}
                />
                {pending > 0 && (
                  <View
                    pointerEvents="none"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 4,
                      position: "absolute",
                      top: 7,
                      right: 9,
                      backgroundColor: colors.blueDark,
                    }}
                  />
                )}
              </View>
            </View>
          </View>
          <View style={{ flex: 1, minHeight: 0 }}>
            {section !== "chat" && (
              <ScrollView
                key={section}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: desktop ? 42 : 22,
                  paddingTop: headerHeight,
                  // Room for "Back to chat" (and voice mode) at the end, over the last controls.
                  paddingBottom: 28 + pillsRoom + (pillsRoom ? 0 : 64),
                }}
                keyboardShouldPersistTaps="handled"
              >
                {utility && (
                  <Button
                    small
                    style={{ alignSelf: "flex-start", marginBottom: 18 }}
                    onPress={() => navigate("apps")}
                  >
                    Back to Apps
                  </Button>
                )}
                <Text
                  // Where focus lands when a button in the chat opens this screen.
                  nativeID="page-title"
                  role="heading"
                  aria-level={1}
                  style={[
                    s.title,
                    { fontSize: 34, letterSpacing: -1, fontWeight: "600", marginBottom: 22 },
                  ]}
                >
                  {title?.title}
                </Text>
                <ErrorNotice error={error} />
                <Screen />
              </ScrollView>
            )}
            <View
              style={{
                display: section === "chat" ? "flex" : "none",
                flex: 1,
                paddingHorizontal: desktop ? 42 : 17,
              }}
            >
              <AgentStatus />
              {richThreads ? (
                <>
                  <ErrorNotice error={threadsError} />
                  {threadsError ? (
                    <Button onPress={retryThreads}>Retry main chat</Button>
                  ) : threadsLoading ? (
                    <ActivityIndicator color={colors.blueDark} />
                  ) : null}
                  {!threadsLoading && selection.id !== mainId && (
                    <SpaceChip threadId={selection.id}>
                      <Text style={[s.small, { textAlign: "center", marginBottom: 8 }]}>
                        Side chat
                      </Text>
                    </SpaceChip>
                  )}
                  {visited.map((thread) => (
                    <View
                      key={thread.id}
                      style={{ display: selection.id === thread.id ? "flex" : "none", flex: 1 }}
                    >
                      <ChatScreen
                        thread={thread}
                        active={section === "chat" && selection.id === thread.id}
                        prompt={selection.id === thread.id ? prompt : undefined}
                      />
                    </View>
                  ))}
                </>
              ) : (
                <ChatScreen prompt={prompt} active={section === "chat"} />
              )}
            </View>
            {/* After a button in the chat brought them here. */}
            <BackToChat section={section} onBack={() => navigate("chat")} />
            {/* A new job, from any screen but the chat (where you can just ask). */}
            {section !== "chat" && !pillsRoom && <NewJobButton round={width < 360} />}
          </View>
          <View
            style={{
              // Eight tabs: a narrow phone gives the bar nearly all its width, 44px a tab from 360px
              // wide.
              paddingHorizontal: width < 420 ? 3 : 22,
              paddingTop: 10,
              paddingBottom: desktop ? 22 : 7,
              alignItems: "center",
            }}
          >
            <View
              role="tablist"
              aria-label="Sections"
              style={{
                flexDirection: "row",
                width: "100%",
                maxWidth: 400,
                paddingVertical: 4,
                paddingHorizontal: width < 420 ? 0 : 4,
                backgroundColor: colors.surface,
                borderRadius: 40,
                shadowColor: "#132631",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.07,
                shadowRadius: 18,
                elevation: 3,
                borderWidth: 1,
                borderColor: colors.line,
              }}
            >
              {nav.map((item) => {
                const active = section === item.id || (item.id === "apps" && utility);
                const ink = active ? colors.text : colors.mutedStrong;
                return (
                  <Pressable
                    key={item.id}
                    // react-native-web reads role and aria-*, not accessibilityState.
                    role="tab"
                    aria-label={item.label}
                    aria-selected={active}
                    onPress={() => navigate(item.id)}
                    style={{
                      flex: 1,
                      height: 54,
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 2,
                      // Rounds the keyboard focus ring too.
                      borderRadius: 22,
                    }}
                  >
                    {/* The selected tab's icon sits on a blue pill, and its name is bold. */}
                    <View
                      style={{
                        width: width < 420 ? 36 : 48,
                        height: 28,
                        borderRadius: 14,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: active ? colors.blue : "transparent",
                      }}
                    >
                      <item.icon size={21} strokeWidth={active ? 2 : 1.8} color={ink} />
                    </View>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: ink,
                        fontSize: width < 360 ? 10 : 11,
                        lineHeight: 14,
                        fontWeight: active ? "700" : "500",
                      }}
                    >
                      {item.short ?? item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {/* Background updates pop up under the bell; they wait while a sheet covers the page. */}
          <UpdateToasts hold={!!chatNow || !!detail || threadsOpen || call.shown} />
          <NewVersion
            // Never in a call (a reload would hang it up), nor while its bar says how it ended.
            canReload={() => !detail && !threadsOpen && !chatNow && call.phase === "idle"}
            onCall={call.phase === "on"}
            desktop={desktop}
            chat={chat}
          />
          {/* The tip for the control under the mouse or finger. */}
          <TipLayer />
        </View>
        {/* Always there, so screen readers hear each confirmation as it appears. */}
        <View
          pointerEvents="box-none"
          role="status"
          aria-live="polite"
          style={{ position: "absolute", bottom: 94, left: 20, right: 20, alignItems: "center" }}
        >
          {!!toast && (
            <View
              style={[
                s.row,
                {
                  gap: 10,
                  padding: 14,
                  backgroundColor: colors.inverse,
                  borderRadius: 20,
                  maxWidth: 560,
                },
              ]}
            >
              <Check size={16} color={colors.blue} />
              <Text style={{ color: colors.onInverse, fontSize: 13, flexShrink: 1 }}>{toast}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss notification"
                {...tipProps("Dismiss")}
                onPress={clearToast}
              >
                <X size={16} color={colors.onInverse} />
              </Pressable>
            </View>
          )}
        </View>
        {/* What happened to a shrunk call; a sheet says it itself while one is open. */}
        <CallNews quiet={!!detail || threadsOpen || call.shown} />
        {threadsOpen && <ThreadsSheet onClose={() => setThreadsOpen(false)} />}
        {detail && (
          <Details
            key={
              detail.type === "task"
                ? detail.taskId
                : detail.type === "file"
                  ? detail.file.id
                  : detail.type === "browser"
                    ? detail.browser.id
                    : detail.type === "mail"
                      ? detail.mail.id
                      : detail.type === "review"
                        ? detail.action.id
                        : detail.type === "email"
                          ? JSON.stringify(detail.draft)
                          : detail.type === "event"
                            ? detail.event?.id || "event-new"
                            : detail.type
            }
            detail={detail}
          />
        )}
        {/* The call screen is its own layer, over whatever sheet is open, which stays as it was. */}
        {call.shown && <LiveTalkSheet />}
      </SafeAreaView>
    </>
  );
}

/** "New job", floating above the bottom bar: hands the agent a job from any screen. */
function NewJobButton({ round }: { round: boolean }) {
  const { open } = useWorkspace();
  return (
    <Pressable
      role="button"
      aria-label="New job"
      {...(round ? tipProps("New job") : {})}
      onPress={() => open({ type: "delegate" })}
      style={({ pressed }) => ({
        position: "absolute",
        right: 20,
        bottom: 16,
        zIndex: 4,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height: 52,
        // On a narrow phone, just the +.
        ...(round ? { width: 52 } : { paddingLeft: 18, paddingRight: 22 }),
        borderRadius: 26,
        backgroundColor: colors.inverse,
        shadowColor: "#132631",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 14,
        elevation: 5,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Plus size={20} strokeWidth={2.4} color={colors.onInverse} />
      {!round && (
        <Text style={{ color: colors.onInverse, fontSize: 16, fontWeight: "700" }}>New job</Text>
      )}
    </Pressable>
  );
}

/** A tab left open when a new version comes out offers to load it (web only). */
function NewVersion({
  canReload,
  onCall,
  desktop,
  chat,
}: {
  canReload: () => boolean;
  /** It waits until the call is over: Reload would hang it up. */
  onCall: boolean;
  desktop: boolean;
  chat: boolean;
}) {
  // Whether something was typed when it came out; a reload would lose it.
  const [ready, setReady] = useState<{ typed: boolean }>();
  const [later, setLater] = useState(false);
  // Reload asks once more when something has been typed since the pill appeared.
  const [warned, setWarned] = useState(false);
  const reload = () => {
    if (typing() && !ready?.typed && !warned) setWarned(true);
    else window.location.reload();
  };
  const latest = useRef(canReload);
  latest.current = canReload;
  useEffect(
    () =>
      watchForUpdates(
        (typed) => setReady({ typed }),
        () => latest.current(),
      ),
    [],
  );
  const shown = !!ready && !later && !onCall;
  return (
    // Always there, so a screen reader hears it when it appears.
    <View
      role="status"
      pointerEvents="box-none"
      // Below the menu, New job and the bell, over the agent's name.
      style={{
        position: "absolute",
        // Clear of the name under the agent's picture on Chat, where the header is shorter.
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
            shadowColor: "#132631",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.18,
            shadowRadius: 14,
          }}
        >
          <Text style={{ flexShrink: 1, color: colors.onInverse, fontSize: 15, fontWeight: "600" }}>
            {ready?.typed || warned
              ? "New version ready. Reloading clears what you typed."
              : "A new version is ready"}
          </Text>
          <Pressable
            role="button"
            onPress={reload}
            style={{
              minHeight: 44,
              paddingHorizontal: 16,
              borderRadius: 22,
              justifyContent: "center",
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}>
              {warned ? "Reload anyway" : "Reload"}
            </Text>
          </Pressable>
          <Pressable
            role="button"
            aria-label="Not now"
            onPress={() => {
              setLater(true);
              // The button that had focus has gone; the menu is the nearest place to go on from.
              setTimeout(
                () =>
                  document
                    .querySelector<HTMLElement>('[aria-label="Open conversations and menu"]')
                    ?.focus(),
                60,
              );
            }}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <X size={18} color={colors.onInverse} />
          </Pressable>
        </View>
      )}
    </View>
  );
}
