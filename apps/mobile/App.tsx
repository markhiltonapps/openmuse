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
  Shapes,
  SquareCheck,
  UsersRound,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Button, colors, ErrorNotice, IconButton, s } from "./src/ui";
import { UpdateToasts } from "./src/update-toasts";
import { listenForCheckIns, registerServiceWorker, takeDelegateDraft } from "./src/web-app";
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
            <WorkspaceShell
              detail={detail}
              toast={toast}
              clearToast={() => setToast("")}
              error={error}
              prompt={prompt}
            />
          </ThreadsProvider>
        </ComputerDraftProvider>
      </AgentWorkspaceProvider>
    </WorkspaceContext.Provider>
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
  const desktop = width >= 900;
  const pending =
    (data?.notifications.filter((n) => !n.read).length || 0) +
    workspace.actions.filter((a) => a.status === "awaiting_review").length;
  const activeTask =
    data?.tasks.find(
      (task) => task.status === "waiting_approval" || task.status === "waiting_input",
    ) || data?.tasks.find((task) => task.status === "running");
  const agentName = data?.identity.name || "Neddy";
  const chatNow = useChatActivity();
  const activity =
    chatNow ?? (activeTask?.status === "running" ? taskActivity(activeTask) : undefined);
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
    : activeTask && activeTask.status !== "running" && !chatNow
      ? "attention"
      : activity
        ? "working"
        : "idle";
  const status = chatNow
    ? chatNow.label
    : activeTask
      ? activeTask.status === "waiting_approval"
        ? `Ready to review · ${activeTask.title}`
        : activeTask.status === "waiting_input"
          ? `Needs your input · ${activeTask.title}`
          : (activity?.label ?? activeTask.title)
      : data?.tasks.some((task) => task.status === "queued")
        ? "Picking up your next task…"
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
                accessibilityLabel={`Open ${agentName} activity and approvals`}
                onPress={() => navigate("activity")}
                style={({ pressed }) => ({
                  alignItems: "center",
                  maxWidth: "70%",
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <AgentAvatar
                  size={chat ? (desktop ? 66 : 58) : desktop ? 88 : 76}
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
                  style={{ fontSize: 11, color: colors.muted, marginTop: 4, marginBottom: 6 }}
                >
                  {mood === "idle" ? " " : status}
                </Text>
              </Pressable>
              {section === "chat" && <ComputerEntry />}
            </View>
            <View style={{ position: "absolute", right: chat ? 0 : 20, top: 16, zIndex: 2 }}>
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
          <View style={{ flex: 1, minHeight: 0 }}>
            {section !== "chat" && (
              <ScrollView
                key={section}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: desktop ? 42 : 22,
                  paddingTop: headerHeight,
                  // Room for "Back to chat" (and voice mode) at the end, over the last controls.
                  paddingBottom: 28 + pillsRoom,
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
          <UpdateToasts hold={!!chatNow || !!detail || threadsOpen} />
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
      </SafeAreaView>
    </>
  );
}
