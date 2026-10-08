import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  FileText,
  Globe2,
  GraduationCap,
  Heart,
  Lightbulb,
  ListChecks,
  Mail,
  MoreVertical,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Target,
  UserRound,
  Users,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { ActionProposal, Artifact, BrowserSession } from "../../../packages/domain/src";
import type {
  AgentArtifact,
  AgentMemory,
  AgentTask,
  Evidence,
  Goal,
  Idea,
  MemorySuggestion,
  Monitor,
  Routine,
  RunEvent,
} from "../../../packages/domain/src/agent";
import {
  appLabel,
  appToConnect,
  asksToConnect,
  connectLink,
} from "../../../packages/domain/src/app-names";
import { AboutYou } from "./about-you-ui";
import { AccountCard, PeopleCard } from "./account-ui";
import { taskActivity } from "./activity";
import { useAgentWorkspace } from "./agent-workspace";
import { AppAlertsCard } from "./app-alerts-ui";
import { PlaceAnchor } from "./app-places-ui";
import { AppearanceCard } from "./appearance-ui";
import { ApprovalCard } from "./approval-card";
import { AlwaysAllowedCard, AppPermissionsCard } from "./approvals-ui";
import { AppsTabs, useAppsTab } from "./apps-tabs";
import { AssistantResponse } from "./assistant-response";
import { AvatarPicker } from "./avatar-settings";
import { BarChart, DataTable, Meter } from "./charts";
import { LineChart } from "./charts-extra";
import { ChatgptImport, YourDataCard } from "./data-ui";
import { REST_OF_JOB_DETAIL } from "./details";
import { Emoji, topicEmoji } from "./emoji";
import { HealthSection } from "./health-ui";
import { HelpCard } from "./help-ui";
import {
  ConfirmStop,
  HIDDEN,
  JOB_HEADING,
  jobHeading,
  realPlan,
  STATUS_NEWS,
  WorkingCard,
} from "./job-working-ui";
import { LocationCard } from "./location-ui";
import { MailAlertsCard } from "./mail-alerts-ui";
import { ModelsCard } from "./models-ui";
import { blankTab, OwnAppsCard, openPage } from "./own-apps";
import { PeopleNotesCard } from "./people-ui";
import { ActivityScreen, ConnectionsScreen } from "./screens";
import { PasswordsCard } from "./sign-in-ui";
import { SubscriptionsCard } from "./subscriptions-ui";
import { dark } from "./theme";
import { tipProps } from "./tips";
import {
  Button,
  Card,
  CheckRow,
  Chip,
  colors,
  Empty,
  ErrorNotice,
  Field,
  InfoTip,
  LinkRow,
  plainPreview,
  resultSummary,
  SectionHeading,
  Sheet,
  s,
} from "./ui";
import { lateNote, type UpdatesDisplay, updateKind, updatesDisplay } from "./update-toasts";
import { UrgentAlertsCard } from "./urgent-alerts-ui";
import { UsageCard } from "./usage-ui";
import { DictateButton, VoiceCard } from "./voice-ui";
import { disablePush, enablePush, isInstalled, isIos, type PushState, pushState } from "./web-app";
import { useWorkspace } from "./workspace";

export function statusLabel(value: string) {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
/** A task's status in everyday words. */
const TASK_STATUS: Record<string, string> = {
  queued: "Getting started",
  scheduled: "Scheduled",
  running: "Working on it",
  waiting_input: "Needs your answer",
  waiting_approval: "Waiting for your OK",
  paused: "Paused",
  succeeded: "Done",
  failed: "Couldn’t finish",
  cancelled: "Stopped",
};
const taskStatus = (value: string) => TASK_STATUS[value] ?? statusLabel(value);
/** A plan step's status in everyday words. */
const STEP_STATUS: Record<string, string> = {
  pending: "To do",
  running: "In progress",
  waiting: "Waiting for you",
  succeeded: "Done",
  failed: "Couldn’t finish",
};
/** The step it's on reads "Waiting for you" while the task waits for the person. */
const stepStatus = (value: string, task?: string) =>
  value === "running" && (task === "waiting_approval" || task === "waiting_input")
    ? STEP_STATUS.waiting
    : (STEP_STATUS[value] ?? statusLabel(value));
/**
 * What a task was asked, without the note every scheduled routine carries, or a space's id and
 * the steps its routine gives the agent.
 */
const askedFor = (prompt: string) =>
  (prompt.split(/\n\nThis is the scheduled routine /)[0] ?? prompt)
    .replace(/\s*\(space id [^)]+\)/g, "")
    .replace(/(\.)\s+First call get_space_playbook[\s\S]*$/, "$1")
    .replace(/"([^"]*)"/g, "“$1”")
    .trim();
function stamp(value?: string) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not checked yet";
}
function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
function activeTask(task: AgentTask) {
  return !["succeeded", "failed", "cancelled"].includes(task.status);
}
export function AgentStatus() {
  const { data, error, refresh } = useAgentWorkspace();
  if (data?.worker.running && !error) return null;
  return (
    <View style={{ gap: 8 }}>
      <ErrorNotice error={error ? `Agent updates unavailable. ${error}` : ""} />
      {!!error && (
        <Button small onPress={() => void refresh().catch(() => {})}>
          Reconnect agent
        </Button>
      )}
      {!data && !error && <ActivityIndicator color={colors.blueDark} />}
      {data && !data.worker.running && (
        <Text style={s.small}>Worker is offline. Saved work will continue when it reconnects.</Text>
      )}
    </View>
  );
}
export function TaskCard({
  task,
  compact = false,
  onOpen,
}: {
  task: AgentTask;
  compact?: boolean;
  onOpen?: () => void;
}) {
  const { open } = useWorkspace();
  // Steps only when the agent made a real plan; the default four never move until the end.
  const steps = realPlan(task) ? task.plan : [];
  const done = steps.filter((step) => step.status === "succeeded").length;
  const next = steps.find((step) => ["running", "waiting"].includes(step.status));
  const waiting = ["waiting_input", "waiting_approval"].includes(task.status);
  // A running job says what it's doing now ("Looking at amazon.com…").
  const doing =
    task.status === "running" && typeof task.state.now === "string" && task.state.now
      ? taskActivity(task).label
      : "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open job: ${task.title}`}
      onPress={() => {
        onOpen?.();
        open({ type: "task", taskId: task.id });
      }}
    >
      <Card
        style={{
          padding: compact ? 15 : 20,
          gap: 11,
          borderRadius: 22,
          backgroundColor: colors.subtle,
        }}
      >
        <View style={[s.row, { gap: 10 }]}>
          <View
            style={[
              s.iconBox,
              { width: 34, height: 34, backgroundColor: waiting ? colors.orange : colors.sky },
            ]}
          >
            <ListChecks size={18} color={colors.blueDark} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.heading}>{task.title}</Text>
            <Text style={s.small}>
              {taskStatus(task.status)}
              {steps.length ? ` · ${done}/${steps.length} steps` : ""}
            </Text>
          </View>
          <ChevronRight size={17} color={colors.muted} />
        </View>
        {!!steps.length && (
          <View style={{ height: 4, backgroundColor: colors.line, borderRadius: 4 }}>
            <View
              style={{
                height: 4,
                width: `${Math.round((done / steps.length) * 100)}%`,
                backgroundColor: "#6AAEE0",
                borderRadius: 4,
              }}
            />
          </View>
        )}
        {(doing || task.question || task.result || task.error || next?.title) && (
          <Text numberOfLines={compact ? 2 : 4} style={s.muted}>
            {doing || plainPreview(task.question || task.error || task.result || next?.title || "")}
          </Text>
        )}
        {waiting && (
          <Text style={[s.small, { color: colors.blueDark, fontWeight: "600" }]}>
            {task.status === "waiting_approval" ? "Tap to review" : "Tap to answer"}
          </Text>
        )}
      </Card>
    </Pressable>
  );
}
export function ChatWork() {
  const { data } = useAgentWorkspace();
  const tasks = [...(data?.tasks || [])]
    .filter(activeTask)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 2);
  if (!tasks.length) return null;
  return (
    <View style={{ gap: 10 }}>
      {tasks.map((task) => (
        <TaskCard task={task} key={task.id} compact />
      ))}
    </View>
  );
}
export function AgentActivityScreen() {
  const { data } = useAgentWorkspace();
  const { workspace } = useWorkspace();
  const [filter, setFilter] = useState("All");
  // What's waiting for their OK comes first, with its Approve button, above all the jobs. A card
  // stays (showing what happened) for the rest of this visit after it's decided.
  const waiting = workspace.actions
    .filter((action) => action.status === "awaiting_review")
    .filter((action) => Date.parse(action.expiresAt) > Date.now());
  const seen = useRef(new Set<string>());
  for (const action of waiting) seen.current.add(action.id);
  const cards = workspace.actions
    .filter((action) => seen.current.has(action.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const tasks = [...(data?.tasks || [])]
    .filter(
      (task) =>
        filter === "All" || (filter === "In progress" ? activeTask(task) : !activeTask(task)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <View style={{ gap: 20 }}>
      <AgentStatus />
      {cards.length > 0 && (
        <View>
          <PlaceAnchor id="reviews" label="Needs your OK">
            <SectionHeading
              title={waiting.length ? `Needs your OK · ${waiting.length}` : "Just decided"}
            />
          </PlaceAnchor>
          <View style={{ gap: 10 }}>
            {cards.map((action) => (
              <ApprovalCard key={action.id} actionId={action.id} wide eyebrow={false} />
            ))}
          </View>
        </View>
      )}
      <View style={[s.row, { gap: 8 }]}>
        {["All", "In progress", "Finished"].map((item) => (
          <Button key={item} small primary={filter === item} onPress={() => setFilter(item)}>
            {item}
          </Button>
        ))}
      </View>
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
      {!tasks.length && (
        <Empty
          icon={ListChecks}
          title="A place for the work"
          detail="Tap New job, or ask in Chat. Each job and its result stays here."
        />
      )}
      <PlaceAnchor id={cards.length ? "receipts" : "reviews"} label="Reviews & receipts">
        <SectionHeading title="Reviews & receipts" />
      </PlaceAnchor>
      <ActivityScreen />
    </View>
  );
}
export function EvidenceList({ items }: { items: Evidence[] }) {
  const { workspace, open } = useWorkspace();
  const [error, setError] = useState("");
  return (
    <View style={{ gap: 10 }}>
      {items.map((item) => (
        <View
          key={item.id}
          style={{ borderLeftWidth: 2, borderLeftColor: colors.blue, paddingLeft: 12, gap: 4 }}
        >
          <Text style={[s.small, { color: colors.text, fontWeight: "600" }]}>{item.title}</Text>
          <Text selectable style={s.small}>
            {item.excerpt}
          </Text>
          {item.url && /^https?:\/\//i.test(item.url) && (
            <Button
              small
              onPress={() =>
                void Linking.openURL(item.url || "").catch((e) => setError(errorText(e)))
              }
            >
              Open source
            </Button>
          )}
          {item.kind === "mail" && workspace.mail.some((mail) => mail.id === item.id) && (
            <Button
              small
              onPress={() => {
                const mail = workspace.mail.find((m) => m.id === item.id);
                if (mail) open({ type: "mail", mail });
              }}
            >
              View email
            </Button>
          )}
          {item.kind === "file" && workspace.files.some((file) => file.id === item.id) && (
            <Button
              small
              onPress={() => {
                const file = workspace.files.find((f) => f.id === item.id);
                if (file) open({ type: "file", file });
              }}
            >
              View file
            </Button>
          )}
        </View>
      ))}
      <ErrorNotice error={error} />
    </View>
  );
}
const ALERTS_DECLINED = "openmuse.job-alerts-declined";
/**
 * While a job someone handed off is running: an offer to get a notification on this device when
 * it's done, shown until they turn notifications on or say not now.
 */
function DoneAlertsOffer() {
  const { api } = useWorkspace();
  const { data } = useAgentWorkspace();
  const [state, setState] = useState<PushState>();
  const [declined, setDeclined] = useState(() => {
    try {
      return globalThis.localStorage?.getItem(ALERTS_DECLINED) === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** What happened, in the line that stays when the card goes; focus moves there too. */
  const [note, setNote] = useState("");
  const noteRef = useRef<Text>(null);
  useEffect(() => {
    void pushState().then(setState, () => setState("unsupported"));
  }, []);
  useEffect(() => {
    if (note && Platform.OS === "web")
      setTimeout(() => (noteRef.current as unknown as HTMLElement | null)?.focus(), 60);
  }, [note]);
  const email = data?.identity.emailJobUpdates !== false;
  const decline = () => {
    try {
      globalThis.localStorage?.setItem(ALERTS_DECLINED, "1");
    } catch {
      // Private browsing: it asks again next time.
    }
    setDeclined(true);
    setNote(
      state === "off"
        ? "OK. You can turn notifications on later in Apps › Alerts."
        : "OK. Once Neato_Muse is on your Home Screen, turn notifications on in Apps › Alerts.",
    );
  };
  const offer = !note && !declined && !!state && ["off", "install-first"].includes(state);
  return (
    <View style={{ gap: 8 }}>
      {offer && (
        <Card style={{ gap: 10, backgroundColor: colors.sky }}>
          <Text role="heading" aria-level={3} style={s.heading}>
            Want a notification when it’s done?
          </Text>
          <Text style={[s.muted, { color: colors.mutedStrong }]}>
            {state === "install-first"
              ? "On iPhone, notifications need Neato_Muse on your Home Screen: tap Share, then “Add to Home Screen”, and open it from there."
              : "I’ll send one to this device, so you can close the app."}
            {email ? " I’ll email you either way." : ""}
          </Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {state === "off" && (
              <Button
                primary
                icon={Bell}
                busy={busy}
                onPress={() => {
                  setBusy(true);
                  setError("");
                  void enablePush(api)
                    .then(() => setNote("Notifications are on. I’ll send one when it’s done."))
                    .catch((e) => setError(errorText(e)))
                    .finally(() => setBusy(false));
                }}
              >
                Turn on notifications
              </Button>
            )}
            <Button disabled={busy} onPress={decline}>
              {state === "off" ? "No thanks" : "Got it"}
            </Button>
          </View>
          <ErrorNotice error={error} />
        </Card>
      )}
      {/* Always here, so the change is read out when the card goes. */}
      <Text
        ref={noteRef}
        role="status"
        aria-live="polite"
        {...({ tabIndex: -1 } as object)}
        style={[s.small, { color: colors.mutedStrong }]}
      >
        {note}
      </Text>
    </View>
  );
}
/** A page that showed an error or a block instead of what was asked for. */
const FAILED_PAGE =
  /something went wrong|access denied|page not found|\b404\b|robot check|are you a (human|robot)|captcha|unusual traffic|temporarily unavailable/i;
/** What a file a job made is, for its button: "the report" (when one was asked for), "the spreadsheet". */
function fileKind(file: Artifact, prompt: string) {
  const name = file.name.toLowerCase();
  if (/\.(xlsx?|csv)$/.test(name) || file.mimeType.includes("sheet")) return "the spreadsheet";
  if (/\.pptx?$/.test(name) || file.mimeType.includes("presentation")) return "the slides";
  if (/\.(pdf|docx?)$/.test(name) || /pdf|word/.test(file.mimeType))
    return /\breport\b/i.test(prompt) ? "the report" : "the document";
  return "the file";
}
/** "You asked" only adds something when the request says more than the job's title. */
function saysMore(prompt: string, title: string) {
  const plain = (text: string) =>
    text
      .toLowerCase()
      .replace(/…$/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const asked = plain(prompt);
  const named = plain(title);
  return !asked.startsWith(named) || asked.length - named.length > 40;
}
/** A finished job: that it's done, what was asked, and the file it made, one tap away. */
function DoneCard({
  task,
  file,
  onOpenFile,
}: {
  task: AgentTask;
  file?: Artifact;
  onOpenFile: (file: Artifact) => void;
}) {
  const kind = file && fileKind(file, task.prompt);
  return (
    <Card style={{ gap: 12, backgroundColor: colors.green }}>
      <View style={[s.row, { gap: 10 }]}>
        <CircleCheck size={22} color={colors.greenText} />
        <Text {...jobHeading} style={[s.heading, { fontSize: 17 }]}>
          Done
        </Text>
      </View>
      {task.input.handedOff === true && saysMore(askedFor(task.prompt), task.title) && (
        <Text numberOfLines={2} style={[s.muted, { color: colors.mutedStrong }]}>
          You asked: {askedFor(task.prompt)}
        </Text>
      )}
      {file && (
        <View style={{ gap: 6 }}>
          <Button
            strong
            icon={FileText}
            style={{ alignSelf: "stretch", maxWidth: 360, minHeight: 52 }}
            accessibilityLabel={`Open ${kind}: ${file.name}`}
            onPress={() => onOpenFile(file)}
          >
            {`Open ${kind}`}
          </Button>
          <Text style={[s.small, { fontSize: 13, lineHeight: 19, color: colors.mutedStrong }]}>
            {`${file.name} · ${fileLine(file)}`}
          </Text>
        </View>
      )}
    </Card>
  );
}
/** "1 page · saved in Files", with spaces that keep each phrase whole. */
function fileLine(file: Artifact) {
  const pages = file.pageCount
    ? `${file.pageCount}\u00a0${file.pageCount === 1 ? "page" : "pages"} · `
    : "";
  return `${pages}saved\u00a0in\u00a0Files`;
}
/** A job that couldn't be finished: what happened, in plain words, and one way on. */
function StoppedCard({
  task,
  busy,
  onRetry,
}: {
  task: AgentTask;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <Card style={{ gap: 12, backgroundColor: colors.errorBg }}>
      <View style={[s.row, { gap: 10 }]}>
        <CircleAlert size={22} color={colors.danger} />
        <Text {...jobHeading} style={[s.heading, { fontSize: 17 }]}>
          Couldn’t finish
        </Text>
      </View>
      {task.input.handedOff === true && saysMore(askedFor(task.prompt), task.title) && (
        <Text numberOfLines={2} style={[s.muted, { color: colors.mutedStrong }]}>
          You asked: {askedFor(task.prompt)}
        </Text>
      )}
      <Text style={s.text}>Something went wrong and I had to stop.</Text>
      {!!task.error && (
        <Text
          numberOfLines={3}
          selectable
          style={[s.small, { fontSize: 13, lineHeight: 19, color: colors.mutedStrong }]}
        >
          Error message: {task.error}
        </Text>
      )}
      <Button
        strong
        icon={RefreshCw}
        busy={busy}
        style={{ alignSelf: "stretch", maxWidth: 360, minHeight: 52 }}
        onPress={onRetry}
      >
        Try again
      </Button>
    </Card>
  );
}
/** Where a job looked, as plain links; a page that showed an error says so. */
function SourceLinks({ items }: { items: Evidence[] }) {
  const { workspace, open } = useWorkspace();
  const [error, setError] = useState("");
  return (
    <View>
      {items.map((item, index) => {
        const url = item.url && /^https?:\/\//i.test(item.url) ? item.url : undefined;
        let host = "";
        try {
          host = url ? new URL(url).hostname.replace(/^www\./, "") : "";
        } catch {
          host = "";
        }
        const failed = FAILED_PAGE.test(item.title);
        const mail =
          item.kind === "mail" ? workspace.mail.find((m) => m.id === item.id) : undefined;
        const file =
          item.kind === "file" ? workspace.files.find((f) => f.id === item.id) : undefined;
        const onPress = url
          ? () => void Linking.openURL(url).catch((e) => setError(errorText(e)))
          : mail
            ? () => open({ type: "mail", mail })
            : file
              ? () => open({ type: "file", file })
              : undefined;
        const title = failed ? "A page that showed an error" : item.title;
        const where =
          host || (mail ? "Email" : file ? "Files" : item.kind === "user" ? "From you" : "");
        return (
          // The divider sits outside the rounded press highlight, so it stays a straight line.
          <View
            key={item.id}
            style={{ borderTopWidth: index ? 1 : 0, borderTopColor: colors.line }}
          >
            <Pressable
              accessibilityRole={onPress ? "link" : undefined}
              accessibilityLabel={`${title}${where ? `, ${where}` : ""}`}
              disabled={!onPress}
              onPress={onPress}
              style={({ pressed }) => [
                {
                  gap: 2,
                  paddingVertical: 10,
                  paddingHorizontal: 10,
                  marginHorizontal: -10,
                  borderRadius: 12,
                },
                pressed && { backgroundColor: colors.subtle },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  s.text,
                  { fontSize: 14, color: onPress && !failed ? colors.blueText : colors.text },
                ]}
              >
                {title}
              </Text>
              {!!where && <Text style={[s.small, { color: colors.mutedStrong }]}>{where}</Text>}
            </Pressable>
          </View>
        );
      })}
      <ErrorNotice error={error} />
    </View>
  );
}
/**
 * What a task's AI has cost so far, from the server's estimate: " · AI cost about $0.08". Its
 * spaces don't break, so a wrapped subtitle keeps the phrase whole.
 */
/** "about $0.10" or "under 1¢": what the AI cost for this job so far. */
function taskCost(task: AgentTask) {
  const cost = task.state.cost as { dollars?: number } | undefined;
  if (!cost?.dollars) return "";
  return cost.dollars < 0.01 ? "under\u00a01¢" : `about\u00a0$${cost.dollars.toFixed(2)}`;
}
export function TaskDetail({ taskId }: { taskId: string }) {
  const { api, workspace, close, open, refresh: refreshWorkspace } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const [detail, setDetail] = useState<{
    task: AgentTask;
    events: RunEvent[];
    artifacts: AgentArtifact[];
    files: Artifact[];
    browsers: BrowserSession[];
    allowedApps?: string[];
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [fieldJson, setFieldJson] = useState("");
  const [showFieldJson, setShowFieldJson] = useState(false);
  const [fields, setFields] = useState<Record<string, string | boolean>>({});
  const [showDetails, setShowDetails] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [askingAgain, setAskingAgain] = useState(false);
  const task = data?.tasks.find((item) => item.id === taskId) || detail?.task;
  useEffect(() => {
    let active = true;
    void api
      .request<{
        task: AgentTask;
        events: RunEvent[];
        artifacts: AgentArtifact[];
        files: Artifact[];
        browsers: BrowserSession[];
        allowedApps?: string[];
      }>(`/api/agent/tasks/${taskId}`)
      .then((result) => {
        if (active) {
          setDetail(result);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [api, taskId, task?.updatedAt]);
  /** Whether it went through; a failure shows as an error here. */
  async function act(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/tasks/${taskId}/${path}`, body);
      if (path === "input") {
        setAnswer("");
        setFields({});
      }
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submitInput() {
    try {
      let parsed: Record<string, string | boolean> = fields;
      if (fieldJson.trim()) {
        const raw: unknown = JSON.parse(fieldJson);
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          Object.values(raw).some(
            (value) => typeof value !== "string" && typeof value !== "boolean",
          )
        )
          throw new Error("Form fields must be a JSON object with text or true/false values.");
        parsed = raw as Record<string, string | boolean>;
      }
      await act("input", {
        answer: answer.trim() || "Provided the requested fields.",
        fields: parsed,
      });
    } catch (e) {
      setError(errorText(e));
    }
  }
  /**
   * Connect the app the job asked for. A job can wait for days and its link may have expired, so
   * a tab opened during the tap goes to a fresh sign-in page (the job's link if that fails). If the
   * app is connected already, the job just carries on.
   */
  async function connectNow() {
    const tab = blankTab();
    setError("");
    const slug = connectApp?.toLowerCase().replace(/[^a-z0-9]/g, "");
    try {
      if (slug) {
        const result = await api.request<{ connected: boolean; url?: string }>(
          "/api/apps/connect",
          { app: slug },
        );
        if (result.connected) {
          tab?.close();
          await act("input", { answer: `${connectApp} is connected now. Carry on.`, fields: {} });
          return;
        }
        if (result.url && openPage(result.url, tab)) return;
      }
    } catch {
      // The job's own link below.
    }
    if (connectUrl && openPage(connectUrl, tab)) return;
    tab?.close();
    setError("Your browser blocked the sign-in page. Tap Connect again.");
  }
  /** Undo "the rest of this job" from an approval: it asks before each step again. */
  async function askEachTime() {
    if (!(await act("ask-each-time", {}))) return;
    setDetail((current) => (current ? { ...current, allowedApps: [] } : current));
    setAskingAgain(true);
    setNews("It will ask you before each step again.");
  }
  async function review() {
    setBusy(true);
    setError("");
    try {
      await refreshWorkspace();
      const snapshot = await api.request<typeof workspace>("/api/workspace");
      const action = snapshot.actions.find((item) => item.id === task?.actionId);
      if (!action) throw new Error("This review is not available yet. Refresh and try again.");
      open({ type: "review", action });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const missing = Array.isArray(task?.state.missingFields) ? task.state.missingFields : [];
  const fieldNames = missing
    .map((field) =>
      typeof field === "string"
        ? field
        : typeof field === "object" && field && "name" in field
          ? String(field.name)
          : "",
    )
    .filter(Boolean);
  // A job that needs an app connected first: its sign-in link, and one tap to carry on after.
  const asksConnect = asksToConnect(task?.question ?? "");
  const connectUrl = connectLink(task?.question ?? "");
  const connectApp = appToConnect(task?.question ?? "");
  const canPause =
    !!task &&
    ["queued", "running", "scheduled", "waiting_input", "waiting_approval"].includes(task.status);
  const canCancel = !!task && activeTask(task);
  const allowedApps = detail?.allowedApps ?? [];
  const files = detail?.files ?? [];
  const handedOff = task?.input.handedOff === true;
  // When the job moves on (done, stopped, back to work), say so, and if the button that was
  // pressed has gone, move focus to the new card's heading.
  const [news, setNews] = useState("");
  const lastStatus = useRef<string>(undefined);
  useEffect(() => {
    const status = task?.status;
    if (!status) return;
    const before = lastStatus.current;
    lastStatus.current = status;
    if (!before || before === status) return;
    setNews(STATUS_NEWS[status] ?? "");
    if (Platform.OS !== "web") return;
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      document.getElementById(JOB_HEADING)?.focus();
    }, 60);
  }, [task?.status]);
  const underWay = !!task && (task.status === "queued" || task.status === "running");
  // The agent's browser shows on the page only when the person may need to step in.
  const needsPerson =
    !!task && ["waiting_input", "waiting_approval", "paused"].includes(task.status);
  const browserCards = task
    ? detail?.browsers?.map((browser) => (
        <Card key={browser.id} style={{ gap: 10 }}>
          <Text style={s.heading}>{browser.title || "Agent browser"}</Text>
          <Text style={s.small}>{browser.url}</Text>
          {browser.status === "active" && browser.previewUrl && (
            <Image
              accessibilityLabel="Agent browser preview"
              source={{ uri: api.url(browser.previewUrl) }}
              style={{ width: "100%", aspectRatio: 1.6, borderRadius: 12 }}
            />
          )}
          <Button
            small
            busy={busy}
            onPress={() => {
              setBusy(true);
              void (async () => {
                try {
                  if (["running", "scheduled", "queued"].includes(task.status))
                    await mutate(`/tasks/${taskId}/control`, { action: "pause" });
                  open({ type: "browser", browser });
                } catch (error) {
                  setError(errorText(error));
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {["running", "scheduled", "queued"].includes(task.status)
              ? "Pause and open browser"
              : "Open browser"}
          </Button>
        </Card>
      ))
    : null;
  // Opening a job answers its updates, so its pop-up and the bell don't ask about it again.
  const unread = !!data?.notifications.some((n) => n.taskId === taskId && !n.read);
  useEffect(() => {
    if (unread) void mutate("/notifications/read", { taskId }).catch(() => undefined);
  }, [unread, taskId, mutate]);
  return (
    <Sheet
      title={task?.title || "Job"}
      // A long request is clipped here; Details has it in full.
      titleLines={3}
      // One height while the job moves on (cards come and go), so nothing drops under a thumb.
      fill
      subtitle={
        // While it's under way the card says it all.
        !task
          ? "Loading saved progress…"
          : underWay
            ? undefined
            : `${taskStatus(task.status)} · ${stamp(task.updatedAt).replace(/ ([AP]M)$/i, "\u00a0$1")}`
      }
      onClose={close}
    >
      <ErrorNotice error={error} />
      {/* Always mounted, so a screen reader hears when the job moves on. */}
      <Text role="status" style={HIDDEN}>
        {news}
      </Text>
      {!task ? (
        <ActivityIndicator color={colors.blueDark} />
      ) : (
        <View style={{ gap: 20 }}>
          {/* What it will do, with Approve right here: one tap from the pop-up's Open. */}
          {task.status === "waiting_approval" && task.actionId ? (
            <ApprovalCard actionId={task.actionId} wide />
          ) : null}
          {task.status === "waiting_approval" && !task.actionId && (
            <Card style={{ backgroundColor: colors.lavender, gap: 12 }}>
              <Text {...jobHeading} style={s.heading}>
                Ready for your review
              </Text>
              <Text style={[s.muted, { color: colors.mutedStrong }]}>
                Check exactly what it will do, and from which account, before it goes ahead.
              </Text>
              <Button primary busy={busy} onPress={() => void review()}>
                Review action
              </Button>
            </Card>
          )}
          {task.status === "waiting_input" && (
            <Card style={{ backgroundColor: colors.sky, gap: 10 }}>
              {connectUrl ? (
                // The Connect button below does what the agent's link says; don't show both.
                <Text {...jobHeading} style={s.heading}>
                  {`${data?.identity.name || "Your agent"} needs ${connectApp || "an app"} connected to carry on`}
                </Text>
              ) : task.question && (task.question.length > 120 || task.question.includes("\n")) ? (
                <>
                  {/* A longer message is the agent's own words, shown as it wrote them. */}
                  <Text {...jobHeading} style={s.heading}>
                    {`${data?.identity.name || "Your agent"} needs your answer`}
                  </Text>
                  <AssistantResponse content={task.question} />
                </>
              ) : (
                <Text {...jobHeading} style={s.heading}>
                  {task.question || "A detail from you will help"}
                </Text>
              )}
              {asksConnect ? (
                <>
                  <Text style={[s.muted, { color: colors.mutedStrong }]}>
                    {connectUrl
                      ? "Sign in on the page that opens, then come back here."
                      : "Connect it under Apps, then come back here."}
                  </Text>
                  {connectUrl && (
                    <Button primary onPress={() => void connectNow()}>
                      {`Connect ${connectApp || "the app"}`}
                    </Button>
                  )}
                  <Button
                    primary={!connectUrl}
                    busy={busy}
                    onPress={() =>
                      void act("input", { answer: "I’ve connected it. Carry on.", fields: {} })
                    }
                  >
                    I’ve connected it, carry on
                  </Button>
                  <Text style={[s.muted, { color: colors.mutedStrong }]}>
                    Or tell it something else:
                  </Text>
                </>
              ) : (
                <Text style={[s.muted, { color: colors.mutedStrong }]}>
                  I’ll carry on once you answer.
                </Text>
              )}
              {fieldNames.map((name) =>
                missing.some(
                  (f) => typeof f === "object" && f && f.name === name && f.type === "checkbox",
                ) ? (
                  <CheckRow
                    key={name}
                    label={name.replace(/_/g, " ")}
                    checked={Boolean(fields[name])}
                    onPress={() => setFields((current) => ({ ...current, [name]: !current[name] }))}
                  />
                ) : (
                  <Field
                    key={name}
                    label={name.replace(/_/g, " ")}
                    value={String(fields[name] ?? "")}
                    onChangeText={(value) =>
                      setFields((current) => ({ ...current, [name]: value }))
                    }
                  />
                ),
              )}
              {!fieldNames.length && (
                <>
                  <Field
                    label="Your answer"
                    value={answer}
                    onChangeText={setAnswer}
                    multiline
                    placeholder="Type your answer…"
                  />
                  <DictateButton
                    label="Say your answer"
                    onText={(text) =>
                      setAnswer((current) =>
                        current.trim() ? `${current.trimEnd()} ${text}` : text,
                      )
                    }
                  />
                </>
              )}
              {task.kind === "document" && !fieldNames.length && (
                <>
                  <Button small onPress={() => setShowFieldJson(!showFieldJson)}>
                    Form field values
                  </Button>
                  {showFieldJson && (
                    <Field
                      label="Fields (JSON: field name to value)"
                      value={fieldJson}
                      onChangeText={setFieldJson}
                      multiline
                      autoCapitalize="none"
                      placeholder={'{"full_name":"Your name","consent":true}'}
                    />
                  )}
                </>
              )}
              <Button
                primary={!asksConnect}
                busy={busy}
                disabled={!answer.trim() && !Object.keys(fields).length && !fieldJson.trim()}
                onPress={() => void submitInput()}
              >
                Send answer
              </Button>
            </Card>
          )}
          {/* Jobs the person handed off (or that made a file); routines just show their result. */}
          {task.status === "succeeded" && (handedOff || files.length > 0) && (
            <DoneCard
              task={task}
              file={files[0]}
              onOpenFile={(file) => open({ type: "file", file })}
            />
          )}
          {task.status === "failed" && (
            <StoppedCard
              task={task}
              busy={busy}
              onRetry={() => void act("control", { action: "retry" })}
            />
          )}
          {task.status === "cancelled" && (
            <Card style={{ gap: 8 }}>
              <Text {...jobHeading} style={[s.heading, { fontSize: 17 }]}>
                Stopped
              </Text>
              <Text style={s.muted}>I stopped this job before it was done.</Text>
            </Card>
          )}
          {/* The answer, once, formatted the way the agent wrote it. */}
          {!!task.result && task.status !== "paused" && task.status !== "cancelled" && (
            <AssistantResponse content={resultSummary(task.result)} />
          )}
          {/* Under way: the agent at work and one line of what it's doing; nothing else yet. */}
          {!task.result && (task.status === "queued" || task.status === "running") && (
            <WorkingCard
              task={task}
              handedOff={handedOff}
              busy={busy}
              onStop={() => void act("control", { action: "cancel" })}
            />
          )}
          {!task.result && task.status === "scheduled" && (
            <Text style={[s.text, { color: colors.mutedStrong }]}>
              {task.nextRunAt ? `Scheduled for ${stamp(task.nextRunAt)}.` : "Waiting to start."} The
              result will show here when it’s done.
            </Text>
          )}
          {task.status === "paused" && (
            <Card style={{ gap: 12 }}>
              <Text {...jobHeading} style={[s.heading, { fontSize: 17 }]}>
                Paused
              </Text>
              <Text style={s.muted}>I’ll pick up where I left off when you resume.</Text>
              <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                <Button
                  strong
                  icon={Play}
                  busy={busy}
                  onPress={() => void act("control", { action: "resume" })}
                >
                  Resume
                </Button>
                <ConfirmStop
                  label="Stop job"
                  busy={busy}
                  onConfirm={() => void act("control", { action: "cancel" })}
                />
              </View>
            </Card>
          )}
          {/* "The rest of this job" from an approval, below its status, while it can still matter,
              with its undo (and, once undone, a line that says so). */}
          {canCancel && (allowedApps.length > 0 || askingAgain) && (
            <Card style={{ gap: 10 }}>
              <Text style={s.text}>
                {allowedApps.length
                  ? `${allowedApps.map(appLabel).join(" and ")} steps in this job go ahead without asking. ${REST_OF_JOB_DETAIL}`
                  : "It will ask you before each step again."}
              </Text>
              {allowedApps.length > 0 && (
                <Button
                  small
                  busy={busy}
                  style={{ minHeight: 44, alignSelf: "flex-start" }}
                  onPress={() => void askEachTime()}
                >
                  Ask me each time
                </Button>
              )}
            </Card>
          )}
          {handedOff && ["queued", "running", "scheduled"].includes(task.status) && (
            <DoneAlertsOffer />
          )}
          {task.status !== "failed" && <ErrorNotice error={task.error ?? undefined} />}
          {needsPerson && browserCards}
          {/* What it made and where it looked, once it's no longer under way. */}
          {!underWay &&
            (task.status === "succeeded" && (handedOff || files.length > 0)
              ? files.slice(1)
              : files
            ).map((file) => (
              <LinkRow
                key={file.id}
                title={file.name}
                detail={fileLine(file)}
                icon={FileText}
                onPress={() => open({ type: "file", file })}
              />
            ))}
          {!underWay &&
            (
              data?.artifacts.filter((artifact) => artifact.taskId === taskId) ||
              detail?.artifacts ||
              []
            )
              // The finished job's summary is saved as a report too; it's already shown above.
              .filter(
                (artifact) =>
                  !artifact.final &&
                  !(artifact.kind === "report" && artifact.summary === task.result),
              )
              .map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} />)}
          {!underWay && !!task.evidence.length && (
            <View style={{ gap: 10 }}>
              <Pressable
                role="button"
                aria-expanded={showSources}
                accessibilityLabel={`Where I looked, ${task.evidence.length} ${
                  task.evidence.length === 1 ? "place" : "places"
                }`}
                onPress={() => setShowSources((open) => !open)}
                style={[s.row, { gap: 6, minHeight: 44, alignSelf: "flex-start" }]}
              >
                <Text style={[s.text, { fontWeight: "600" }]}>
                  {`Where I looked (${task.evidence.length})`}
                </Text>
                {showSources ? (
                  <ChevronUp size={17} color={colors.text} />
                ) : (
                  <ChevronDown size={17} color={colors.text} />
                )}
              </Pressable>
              {showSources && <SourceLinks items={task.evidence} />}
            </View>
          )}
          {/* What the agent was asked and each step it took, for anyone who wants to look. */}
          <Pressable
            role="button"
            aria-expanded={showDetails}
            onPress={() => setShowDetails((open) => !open)}
            style={[s.row, { gap: 6, minHeight: 44, alignSelf: "flex-start" }]}
          >
            <Text style={[s.text, { fontWeight: "600" }]}>Details</Text>
            {showDetails ? (
              <ChevronUp size={17} color={colors.text} />
            ) : (
              <ChevronDown size={17} color={colors.text} />
            )}
          </Pressable>
          {showDetails && (
            <View style={{ gap: 16 }}>
              <View style={{ gap: 6 }}>
                <Text style={s.label}>What you asked</Text>
                <Text selectable style={s.muted}>
                  {askedFor(task.prompt)}
                </Text>
              </View>
              {!!taskCost(task) && (
                <View style={{ gap: 6 }}>
                  <Text style={s.label}>AI cost</Text>
                  <Text style={s.muted}>
                    {activeTask(task) ? `${taskCost(task)} so far` : taskCost(task)}
                  </Text>
                </View>
              )}
              {/* Pause, or cancel a job that's waiting on you (Stop is on the working card). */}
              {((canPause && task.status !== "queued") || (canCancel && !underWay)) &&
                task.status !== "paused" && (
                  <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                    {canPause && (
                      <Button
                        small
                        icon={Pause}
                        busy={busy}
                        onPress={() => void act("control", { action: "pause" })}
                      >
                        Pause
                      </Button>
                    )}
                    {canCancel && !underWay && (
                      <ConfirmStop
                        label="Stop job"
                        busy={busy}
                        onConfirm={() => void act("control", { action: "cancel" })}
                      />
                    )}
                  </View>
                )}
              {!needsPerson && browserCards}
              {realPlan(task) && (
                <View style={{ gap: 10 }}>
                  <Text style={s.label}>Plan</Text>
                  {task.plan.map((step, index) => (
                    <View key={step.id} style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
                      <Text
                        style={[
                          s.text,
                          { color: step.status === "succeeded" ? colors.blueDark : colors.muted },
                        ]}
                      >
                        {step.status === "succeeded" ? "✓" : `${index + 1}.`}
                      </Text>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={s.text}>{step.title}</Text>
                        <Text style={s.small}>
                          {stepStatus(step.status, task.status)}
                          {step.detail ? ` · ${step.detail}` : ""}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
              <Text style={s.label}>What I did</Text>
              {detail?.events.map((event) => (
                <View
                  key={event.id}
                  style={{
                    gap: 4,
                    paddingLeft: 14,
                    borderLeftWidth: 2,
                    borderLeftColor: colors.line,
                  }}
                >
                  <Text style={s.small}>{stamp(event.date)}</Text>
                  <Text style={s.text}>{event.title}</Text>
                  <Text selectable style={s.muted}>
                    {event.detail}
                  </Text>
                </View>
              ))}
              {!detail?.events.length && (
                <Text style={s.muted}>Each step will show here as it happens.</Text>
              )}
            </View>
          )}
        </View>
      )}
    </Sheet>
  );
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function display(value: unknown): string {
  return typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : value === null
        ? "—"
        : JSON.stringify(value, null, 2) || "";
}
export function ArtifactCard({
  artifact,
  titled = true,
}: {
  artifact: AgentArtifact;
  /** Off inside its own sheet, whose title already names it. */
  titled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (artifact.kind === "finance") return <FinanceArtifact artifact={artifact} />;
  // Where the agent looked is shown as links on the job, not as raw page text here.
  const rows = Object.entries(artifact.data).filter(([key]) => key !== "evidence");
  return (
    <Card style={{ gap: 13, backgroundColor: colors.card }}>
      {titled ? (
        <View style={s.between}>
          <Text style={s.heading}>{artifact.title}</Text>
          <Chip>{statusLabel(artifact.kind)}</Chip>
        </View>
      ) : null}
      {/* Saved before jobs knew that asking to connect an app is a question, not the result. */}
      {asksToConnect(artifact.summary) ? (
        <View style={{ backgroundColor: colors.orange, borderRadius: 12, padding: 12, gap: 4 }}>
          <Text style={[s.text, { fontWeight: "700" }]}>This job didn’t finish</Text>
          <Text style={[s.text, { color: colors.mutedStrong }]}>
            {`It stopped to ask you to connect ${appToConnect(artifact.summary) || "an app"}. Connect it under Apps, then ask for this again.`}
          </Text>
        </View>
      ) : null}
      <AssistantResponse content={artifact.summary} />
      {(expanded ? rows : rows.slice(0, 4)).map(([key, value]) => (
        <View key={key} style={{ gap: 6 }}>
          <Text style={s.label}>{key.replace(/_/g, " ")}</Text>
          {Array.isArray(value) ? (
            value.slice(0, expanded ? 100 : 5).map((item) => {
              const row = record(item);
              return (
                <View
                  key={`${key}-${display(row?.id ?? item)}`}
                  style={{
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.line,
                  }}
                >
                  <Text selectable style={s.text}>
                    {row
                      ? Object.entries(row)
                          .map(([name, val]) => `${name}: ${display(val)}`)
                          .join(" · ")
                      : display(item)}
                  </Text>
                </View>
              );
            })
          ) : record(value) ? (
            Object.entries(record(value) || {}).map(([name, val]) => (
              <View key={name} style={s.between}>
                <Text style={s.muted}>{name}</Text>
                <Text selectable style={s.text}>
                  {display(val)}
                </Text>
              </View>
            ))
          ) : (
            <Text selectable style={[s.text, { fontSize: typeof value === "number" ? 24 : 14 }]}>
              {display(value)}
            </Text>
          )}
        </View>
      ))}
      {/* Only when there's more than the summary shows. */}
      {rows.length > 4 || rows.some(([, value]) => Array.isArray(value) && value.length > 5) ? (
        <Button small style={{ minHeight: 44 }} onPress={() => setExpanded(!expanded)}>
          {expanded ? "Show summary" : "Explore full result"}
        </Button>
      ) : null}
    </Card>
  );
}
function FinanceArtifact({ artifact }: { artifact: AgentArtifact }) {
  const [details, setDetails] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { mutate } = useAgentWorkspace();
  const [goalTitle, setGoalTitle] = useState("");
  const [goalSaved, setGoalSaved] = useState(false);
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalError, setGoalError] = useState("");
  const saveGoal = async () => {
    setGoalBusy(true);
    setGoalError("");
    try {
      await mutate("/goals", {
        title: goalTitle.trim(),
        category: "Finances",
        description: `Inspired by ${artifact.title}: ${artifact.summary}`,
        milestones: ["Choose a savings target", "Review spending each week"],
      });
      setGoalSaved(true);
    } catch (error) {
      setGoalError(errorText(error));
    } finally {
      setGoalBusy(false);
    }
  };
  const amount = (value: unknown) =>
    Number(value ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const categories = Array.isArray(artifact.data.categories) ? artifact.data.categories : [];
  const transactions = Array.isArray(artifact.data.transactions) ? artifact.data.transactions : [];
  const spending = Number(artifact.data.spending) || 1;
  const period = record(artifact.data.period);
  return (
    <Card
      style={{ gap: 12, padding: 10, backgroundColor: colors.bubble, maxWidth: 440, width: "100%" }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open finance tracker: ${artifact.title}`}
        accessibilityState={{ expanded: details }}
        onPress={() => setDetails(!details)}
      >
        <View
          style={{
            minHeight: 200,
            borderRadius: 16,
            overflow: "hidden",
            backgroundColor: "#080B10",
            padding: 20,
          }}
        >
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 142 }}>
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="finance" x1="0" y1="0" x2="0.5" y2="1">
                  <Stop offset="0" stopColor="#281066" />
                  <Stop offset="0.5" stopColor="#163BBF" />
                  <Stop offset="1" stopColor="#148CE8" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#finance)" />
            </Svg>
          </View>
          <Text style={{ color: "#D4DCFC", fontSize: 11, lineHeight: 18, marginBottom: 20 }}>
            Read from your imported transactions.{"\n"}
            {String(period?.from ?? "")} — {String(period?.to ?? "")}
            {"\n"}
            {transactions.length} transactions, categorized and summarized.
          </Text>
          <View style={[s.row, { gap: 7 }]}>
            {(
              [
                ["Income", "income"],
                ["Spending", "spending"],
                ["Remaining", "saved"],
              ] as const
            ).map(([label, key]) => (
              <View
                key={key}
                style={{ flex: 1, padding: 11, borderRadius: 12, backgroundColor: "#1D2025" }}
              >
                <Text style={{ color: "#A4A7AD", fontSize: 9 }}>{label}</Text>
                <Text
                  selectable
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                  style={{
                    fontSize: 17,
                    fontWeight: "600",
                    color: key === "saved" ? "#58D3AE" : "#FFF",
                    marginTop: 5,
                  }}
                >
                  {amount(artifact.data[key])}
                </Text>
                <Text style={{ color: "#7E8289", fontSize: 8, marginTop: 4 }}>source currency</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={[s.row, { gap: 11, paddingHorizontal: 8, paddingTop: 13, paddingBottom: 4 }]}>
          <Text style={{ fontSize: 25 }}>💸</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.text, { fontWeight: "600" }]}>Finance tracker</Text>
            <Text style={s.small}>Spending, savings, and a plan for what’s next.</Text>
          </View>
          <ChevronRight size={17} color={colors.muted} />
        </View>
      </Pressable>
      {details && (
        <View style={{ gap: 16, padding: 10 }}>
          <Text style={s.label}>Where your money went</Text>
          {categories.map((category) => {
            const row = record(category);
            if (!row) return null;
            return (
              <View key={String(row.name)} style={{ gap: 8 }}>
                <View style={s.between}>
                  <Text style={s.text}>{String(row.name)}</Text>
                  <Text style={s.text}>{amount(row.amount)}</Text>
                </View>
                <View style={{ height: 7, backgroundColor: "#DFE8EB", borderRadius: 8 }}>
                  <View
                    style={{
                      width: `${Math.min(100, (Number(row.amount) / spending) * 100)}%`,
                      height: 7,
                      backgroundColor: colors.blueDark,
                      borderRadius: 8,
                    }}
                  />
                </View>
              </View>
            );
          })}
          <Text style={s.small}>
            Amounts use your source currency. This summary covers the imported dates.
          </Text>
          {goalSaved ? (
            <Text style={s.text}>Your savings goal is saved in Goals.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              <Field
                label="Turn this into a savings goal"
                value={goalTitle}
                onChangeText={setGoalTitle}
                placeholder="What would you like to save for?"
              />
              <ErrorNotice error={goalError} />
              <Button
                small
                busy={goalBusy}
                disabled={!goalTitle.trim()}
                onPress={() => void saveGoal()}
              >
                Create savings goal
              </Button>
            </View>
          )}
          <Button small onPress={() => setExpanded(!expanded)}>
            {expanded ? "Hide transactions" : "View transactions"}
          </Button>
          {expanded &&
            transactions.slice(0, 100).map((transaction) => {
              const row = record(transaction);
              return row ? (
                <View key={String(row.id ?? display(row))} style={s.between}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.text}>{String(row.description)}</Text>
                    <Text style={s.small}>
                      {String(row.date)} · {String(row.category)}
                    </Text>
                  </View>
                  <Text style={s.text}>{amount(row.amount)}</Text>
                </View>
              ) : null;
            })}
          {expanded && transactions.length > 100 && (
            <Text style={s.small}>
              Showing the first 100 transactions. The totals include every row.
            </Text>
          )}
        </View>
      )}
    </Card>
  );
}
/** One choice of several: a round button and its words, a 44px row. */
function RadioRow({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      role="radio"
      aria-checked={checked}
      onPress={onPress}
      style={[s.row, { gap: 10, minHeight: 44 }]}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: checked ? 6 : 1.5,
          borderColor: checked ? colors.text : colors.mutedStrong,
          backgroundColor: colors.surface,
        }}
      />
      <Text style={[s.text, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}
/** What the guided jobs do when nothing is written; shown greyed out in the box. */
const GUIDED_PROMPTS: Partial<Record<AgentTask["kind"], string>> = {
  document: "Fill in the form and write a reply for me to check",
  finance: "Sum up my spending and suggest ways to save",
};
/** The other kinds of job, behind More options; most jobs are just written in the box. */
const OTHER_JOBS = [
  { kind: "agent", label: "Anything" },
  { kind: "document", label: "Fill in a PDF from an email" },
  { kind: "finance", label: "Sum up spending from a bank file (CSV)" },
] as const;
export function DelegateSheet({ prompt: filled }: { prompt?: string } = {}) {
  const { workspace, close, open } = useWorkspace();
  const { data, delegate } = useAgentWorkspace();
  const name = data?.identity.name || "Neddy";
  const [kind, setKind] = useState<AgentTask["kind"]>("agent");
  const [more, setMore] = useState(false);
  const [prompt, setPrompt] = useState(filled ?? "");
  const [messageId, setMessageId] = useState("");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      // The guided jobs say what they're for when nothing is written.
      const written = prompt.trim() || GUIDED_PROMPTS[kind] || "";
      const task = await delegate({
        prompt: written,
        kind,
        input: kind === "finance" ? { csv } : kind === "document" ? { messageId } : {},
      });
      open({ type: "task", taskId: task.id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title="New job"
      subtitle={`${name} works on it in the background and tells you when it’s done.`}
      onClose={close}
    >
      {filled && (
        <Text style={[s.muted, { marginBottom: 12 }]}>
          This job is filled in from your link. Check it, then tap Start job.
        </Text>
      )}
      <Field
        label="What would you like done?"
        value={prompt}
        onChangeText={setPrompt}
        autoFocus={Platform.OS === "web" && !filled}
        multiline
        placeholder={
          GUIDED_PROMPTS[kind] ?? "Compare the three best-reviewed robot vacuums on Amazon"
        }
      />
      <View style={{ marginTop: -6, marginBottom: 14 }}>
        <DictateButton
          label="Say it instead"
          onText={(text) =>
            setPrompt((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text))
          }
        />
      </View>
      {/* Two guided jobs for special cases; everything else is just written in the box. */}
      <Pressable
        role="button"
        aria-expanded={more}
        onPress={() => setMore((value) => !value)}
        style={[s.row, { gap: 6, minHeight: 44, alignSelf: "flex-start", marginBottom: 6 }]}
      >
        <Text style={[s.muted, { fontWeight: "600", color: colors.mutedStrong }]}>
          More options
        </Text>
        {more ? (
          <ChevronUp size={15} color={colors.mutedStrong} />
        ) : (
          <ChevronDown size={15} color={colors.mutedStrong} />
        )}
      </Pressable>
      {more && (
        <View role="radiogroup" aria-label="Kind of job" style={{ gap: 2, marginBottom: 14 }}>
          {OTHER_JOBS.map((job) => (
            <RadioRow
              key={job.kind}
              label={job.label}
              checked={kind === job.kind}
              onPress={() => setKind(job.kind)}
            />
          ))}
        </View>
      )}
      {kind === "document" && (
        <View style={{ gap: 8, marginBottom: 18 }}>
          <Text style={s.heading}>Choose the email with the PDF</Text>
          <View role="radiogroup" aria-label="Email with the PDF">
            {workspace.mail
              .filter((mail) => mail.attachments.length)
              .map((mail) => (
                <RadioRow
                  key={mail.id}
                  checked={mail.id === messageId}
                  label={`${mail.subject} · ${mail.sender}`}
                  onPress={() => setMessageId(mail.id)}
                />
              ))}
          </View>
          {!workspace.mail.some((mail) => mail.attachments.length) && (
            <Text style={s.muted}>
              Connect mail in Apps and select a message with a PDF attachment.
            </Text>
          )}
        </View>
      )}
      {kind === "finance" && (
        <>
          <Field
            label="Transaction CSV"
            value={csv}
            onChangeText={setCsv}
            multiline
            autoCapitalize="none"
            placeholder={"date,description,amount,category\n2026-09-01,Groceries,54.20,Food"}
          />
          {workspace.mode === "sample" && (
            <Button
              onPress={() =>
                setCsv(
                  "date,description,amount,category\n2026-09-01,Salary,-4200,Income\n2026-09-02,Groceries,84.50,Food\n2026-09-03,Subscription,19.99,Subscriptions\n2026-09-04,Coffee,6.50,Food",
                )
              }
            >
              Try example transactions
            </Button>
          )}
          <Text style={[s.small, { marginVertical: 12 }]}>
            Positive amounts are expenses; negative amounts are income. Imported data only. No bank
            connection is implied.
          </Text>
        </>
      )}
      {kind === "agent" && !workspace.runtime.configured && (
        <Text style={[s.muted, { marginBottom: 16 }]}>
          Jobs need an AI model set up on the server. You can still fill in a PDF or sum up spending
          without one.
        </Text>
      )}
      <ErrorNotice error={error} />
      <Button
        primary
        busy={busy}
        disabled={
          (kind === "agent" && !prompt.trim()) ||
          (kind === "document" && !messageId) ||
          (kind === "finance" && !csv.trim())
        }
        onPress={() => void submit()}
      >
        Start job
      </Button>
    </Sheet>
  );
}
export function IdeasScreen() {
  const { data, mutate } = useAgentWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refreshIdeas() {
    setBusy(true);
    setError("");
    try {
      await mutate("/ideas/refresh", {});
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const ideas = data?.ideas.filter((idea) => idea.status === "new") || [];
  return (
    <View style={{ gap: 20 }}>
      <AgentStatus />
      <View style={s.between}>
        <Text style={[s.small, { flex: 1 }]}>From your goals, jobs, apps and interests</Text>
        <Button small icon={RefreshCw} busy={busy} onPress={() => void refreshIdeas()}>
          Find ideas
        </Button>
      </View>
      <ErrorNotice error={error} />
      {ideas.map((idea) => (
        <IdeaCard key={idea.id} idea={idea} />
      ))}
      {!ideas.length && (
        <Empty
          icon={Lightbulb}
          title="Room for a good idea"
          detail="Find ideas from the sources you have granted access to. Each suggestion includes its evidence."
        />
      )}
      {(data?.ideas || [])
        .filter((idea) => idea.status === "accepted")
        .map((idea) => (
          <Card key={idea.id} style={{ gap: 7 }}>
            <Text style={s.heading}>{idea.title}</Text>
            <Chip tint={colors.green}>Started</Chip>
            {!!idea.taskId && <TaskLink taskId={idea.taskId} />}
          </Card>
        ))}
    </View>
  );
}
function TaskLink({ taskId, onOpen }: { taskId: string; onOpen?: () => void }) {
  const { open } = useWorkspace();
  return (
    <Button
      small
      icon={ArrowRight}
      onPress={() => {
        onOpen?.();
        open({ type: "task", taskId });
      }}
    >
      Open job
    </Button>
  );
}
function IdeaCard({ idea }: { idea: Idea }) {
  const { mutate } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(idea.prompt);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: "accept" | "dismiss") {
    setBusy(true);
    setError("");
    try {
      const result = await mutate<Idea>(`/ideas/${idea.id}`, { action, prompt });
      if (result.taskId && action === "accept") open({ type: "task", taskId: result.taskId });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View idea: ${idea.title}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{ flexDirection: "row", gap: 14 }}
      >
        <View style={{ width: 48, paddingTop: 2 }}>
          <Emoji char={idea.emoji ?? topicEmoji(`${idea.title} ${idea.reason}`)} size={48} />
        </View>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={[s.heading, { fontSize: 18, lineHeight: 25 }]}>{idea.title}</Text>
          <Text style={s.muted}>{idea.reason}</Text>
        </View>
      </Pressable>
      {expanded && (
        <View style={{ gap: 15, marginTop: 18, paddingLeft: 62 }}>
          <EvidenceList items={idea.evidence} />
          {editing && (
            <Field
              label="What should your agent do?"
              value={prompt}
              onChangeText={setPrompt}
              multiline
            />
          )}
          <ErrorNotice error={error} />
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button
              primary
              busy={busy}
              disabled={!prompt.trim()}
              onPress={() => void act("accept")}
            >
              Start this
            </Button>
            <Button disabled={busy} onPress={() => setEditing(!editing)}>
              {editing ? "Keep edits" : "Edit"}
            </Button>
            <Button disabled={busy} onPress={() => void act("dismiss")}>
              Dismiss
            </Button>
          </View>
        </View>
      )}
    </View>
  );
}
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function scheduleLabel(r: Pick<Routine, "time" | "days">) {
  const days = [...r.days].sort().join(",");
  const when =
    days === "0,1,2,3,4,5,6"
      ? "Every day"
      : days === "1,2,3,4,5"
        ? "Weekdays"
        : days === "0,6"
          ? "Weekends"
          : r.days.map((d) => DAY_NAMES[d]).join(", ");
  return `${when} at ${r.time}`;
}
const MORNING_BRIEF = {
  title: "Morning brief",
  prompt:
    "Give me a brief for today: my calendar, important unread email, anything waiting on me, and progress on my goals.",
  time: "07:30",
  days: [1, 2, 3, 4, 5],
};
const ROUTINE_TEMPLATES = [
  MORNING_BRIEF,
  {
    title: "Inbox check",
    prompt:
      "Check my inbox for anything urgent or needing a reply today. List each with the sender, why it matters and a suggested next step.",
    time: "16:30",
    days: [1, 2, 3, 4, 5],
  },
  {
    title: "Follow-ups",
    prompt:
      "Find emails I sent in the last week that have not received a reply and suggest short follow-ups for the important ones.",
    time: "15:00",
    days: [5],
  },
  {
    title: "Weekly goal check-in",
    prompt:
      "Review my goals and milestones. Summarize progress this week and suggest the three most useful next steps.",
    time: "18:00",
    days: [0],
  },
];
/** Recurring jobs; each run is a normal task in Activity with a notification when done. */
/** A section title like Meta Muse's: a colored dot in a soft ring, and a plus to add. */
function SectionHead({
  title,
  tint,
  ring,
  onAdd,
  addLabel,
}: {
  title: string;
  tint: string;
  ring: string;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <View style={[s.between, { paddingVertical: 8 }]}>
      <View style={[s.row, { gap: 14 }]}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: ring,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: tint }} />
        </View>
        <Text style={{ color: tint, fontSize: 24, fontWeight: "600", letterSpacing: -0.5 }}>
          {title}
        </Text>
      </View>
      {onAdd && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          {...tipProps(addLabel ?? "Add")}
          hitSlop={10}
          onPress={onAdd}
        >
          <Plus size={28} strokeWidth={1.6} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}
/** A goal or something tracked: a check box, a bold title, where it stands, and more. */
function ListRow({
  title,
  subtitle,
  done,
  label,
  onPress,
}: {
  title: string;
  subtitle?: string;
  done?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 16,
        paddingVertical: 14,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 26,
          height: 26,
          marginTop: 3,
          borderRadius: 7,
          borderWidth: 2,
          borderColor: done ? colors.greenDark : colors.muted,
          backgroundColor: done ? colors.greenDark : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {done && <Check size={16} strokeWidth={3} color={colors.canvas} />}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 20,
            lineHeight: 26,
            fontWeight: "600",
            letterSpacing: -0.3,
          }}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 16, lineHeight: 23 }}>
            {subtitle}
          </Text>
        )}
      </View>
      <View style={{ paddingTop: 4 }}>
        <MoreVertical size={22} color={colors.muted} />
      </View>
    </Pressable>
  );
}
/** "every 15 minutes", "every hour", "every 6 hours", "daily". */
function every(minutes: number) {
  if (minutes % 1440 === 0) return minutes === 1440 ? "daily" : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "every hour" : `every ${minutes / 60} hours`;
  return `every ${minutes} minutes`;
}
/** The first line of what a task found, for a row's subtitle. */
function taskLine(task?: AgentTask) {
  const text = plainPreview(task?.result || task?.question || "").replace(/\s+/g, " ");
  return text.trim().slice(0, 160) || undefined;
}
/** A new routine: a template to start from, what to do, when and on which days. */
function RoutineForm({ onDone }: { onDone: () => void }) {
  const { mutate } = useAgentWorkspace();
  const [draft, setDraft] = useState<(typeof ROUTINE_TEMPLATES)[number]>({ ...MORNING_BRIEF });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timeValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await mutate("/routines", {
        ...draft,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        {ROUTINE_TEMPLATES.map((t) => (
          <Button
            key={t.title}
            small
            primary={draft.title === t.title}
            onPress={() => setDraft({ ...t })}
          >
            {t.title}
          </Button>
        ))}
      </View>
      <Field
        label="Name"
        value={draft.title}
        onChangeText={(title) => setDraft({ ...draft, title })}
      />
      <Field
        label="What should it do?"
        value={draft.prompt}
        onChangeText={(prompt) => setDraft({ ...draft, prompt })}
        multiline
      />
      <Field
        label="Time (24-hour, your time zone)"
        value={draft.time}
        onChangeText={(time) => setDraft({ ...draft, time })}
        placeholder="07:30"
      />
      <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
        {DAY_NAMES.map((name, day) => (
          <Button
            key={name}
            small
            primary={draft.days.includes(day)}
            onPress={() =>
              setDraft({
                ...draft,
                days: draft.days.includes(day)
                  ? draft.days.filter((d) => d !== day)
                  : [...draft.days, day],
              })
            }
          >
            {name}
          </Button>
        ))}
      </View>
      <ErrorNotice error={error} />
      <Button
        primary
        busy={busy}
        disabled={!timeValid || !draft.days.length || !draft.title.trim() || !draft.prompt.trim()}
        onPress={() => void save()}
      >
        Save routine
      </Button>
    </View>
  );
}
/** A routine's details: what it does, its last result, and run, pause or remove. */
function RoutineDetail({ routine, onDone }: { routine: Routine; onDone: () => void }) {
  const { data, mutate } = useAgentWorkspace();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const last = data?.tasks.find((t) => t.id === routine.lastTaskId);
  async function run(key: string, path: string, body: unknown = {}, close = false) {
    setBusy(key);
    setError("");
    try {
      await mutate(path, body);
      if (close) onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <View style={{ gap: 14 }}>
      <Text style={s.muted}>
        {routine.enabled ? scheduleLabel(routine) : "Paused"}
        {routine.lastRunAt ? ` · last ran ${stamp(routine.lastRunAt)}` : ""}
      </Text>
      <Text style={s.text}>{routine.prompt}</Text>
      {last && <TaskCard task={last} compact onOpen={onDone} />}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          primary
          busy={busy === "run"}
          disabled={!!busy}
          onPress={() => void run("run", `/routines/${routine.id}/run`)}
        >
          Run now
        </Button>
        <Button
          busy={busy === "toggle"}
          disabled={!!busy}
          onPress={() =>
            void run("toggle", `/routines/${routine.id}`, { enabled: !routine.enabled })
          }
        >
          {routine.enabled ? "Pause" : "Resume"}
        </Button>
        <Button
          busy={busy === "delete"}
          disabled={!!busy}
          onPress={() => void run("delete", `/routines/${routine.id}/delete`, {}, true)}
        >
          Remove
        </Button>
      </View>
    </View>
  );
}
const GOAL_KINDS = [
  { name: "Health", icon: Heart },
  { name: "Relationships", icon: Users },
  { name: "Finances", icon: CircleDollarSign },
  { name: "Learning", icon: GraduationCap },
  { name: "Something else", icon: Target },
];
/**
 * Goals like Meta Muse's: what the agent keeps track of (routines and watched pages), your
 * goals with where each stands, and ways to start a new one.
 */
export function GoalsScreen() {
  const { data } = useAgentWorkspace();
  const [adding, setAdding] = useState<string>();
  const [tracking, setTracking] = useState<"schedule" | "page">("schedule");
  const [selectedGoal, setSelectedGoal] = useState<string>();
  const [selectedMonitor, setSelectedMonitor] = useState<string>();
  const [selectedRoutine, setSelectedRoutine] = useState<string>();
  const goal = data?.goals.find((item) => item.id === selectedGoal);
  const monitor = data?.monitors.find((item) => item.id === selectedMonitor);
  const routine = data?.routines.find((item) => item.id === selectedRoutine);
  const tasks = data?.tasks ?? [];
  const routines = data?.routines ?? [];
  const monitors = data?.monitors ?? [];
  const goals = data?.goals ?? [];
  const divider = <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 14 }} />;
  const goalLine = (item: Goal) => {
    const latest = tasks
      .filter((t) => t.goalId === item.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const steps = item.milestones.length
      ? `${item.milestones.filter((m) => m.done).length} of ${item.milestones.length} steps done`
      : "";
    return taskLine(latest) || item.description || steps || statusLabel(item.status);
  };
  return (
    <View>
      <AgentStatus />
      <PlaceAnchor id="tracking" label="Tracking">
        <SectionHead
          title="Tracking"
          tint={colors.greenDark}
          ring={dark ? "#0E3620" : "#DDF3E6"}
          onAdd={() => setAdding("Tracking")}
          addLabel="Track something new"
        />
      </PlaceAnchor>
      {routines.map((r) => (
        <ListRow
          key={r.id}
          title={r.title}
          label={`Open routine: ${r.title}`}
          subtitle={
            taskLine(tasks.find((t) => t.id === r.lastTaskId)) ??
            (r.enabled ? `${scheduleLabel(r)} · next ${stamp(r.nextRunAt)}` : "Paused")
          }
          onPress={() => setSelectedRoutine(r.id)}
        />
      ))}
      {monitors.map((item) => (
        <ListRow
          key={item.id}
          title={item.title}
          label={`Open tracking: ${item.title}`}
          subtitle={
            item.error ??
            (item.status === "active"
              ? `Checking ${every(item.intervalMinutes)}${item.lastCheckedAt ? ` · last checked ${stamp(item.lastCheckedAt)}` : ""}`
              : statusLabel(item.status))
          }
          onPress={() => setSelectedMonitor(item.id)}
        />
      ))}
      {!routines.length && !monitors.length && (
        <Text style={[s.muted, { fontSize: 16, paddingVertical: 10 }]}>
          A morning briefing, an inbox check, ticket prices or a page you're watching.
        </Text>
      )}
      {divider}
      <SectionHead
        title="Goals"
        tint={colors.blueDark}
        ring={dark ? "#0E2A47" : "#DCEEFF"}
        onAdd={() => setAdding("Something else")}
        addLabel="Create a goal"
      />
      {goals.map((item) => (
        <ListRow
          key={item.id}
          title={item.title}
          label={`Open goal: ${item.title}`}
          done={item.status === "completed"}
          subtitle={goalLine(item)}
          onPress={() => setSelectedGoal(item.id)}
        />
      ))}
      {!goals.length && (
        <Text style={[s.muted, { fontSize: 16, paddingVertical: 10 }]}>
          Big plans start with one small step.
        </Text>
      )}
      {divider}
      <Text
        style={{
          color: colors.text,
          fontSize: 24,
          fontWeight: "600",
          letterSpacing: -0.5,
          marginBottom: 6,
        }}
      >
        Create a goal
      </Text>
      {GOAL_KINDS.map((item) => (
        <Pressable
          key={item.name}
          accessibilityRole="button"
          accessibilityLabel={`Create ${item.name.toLowerCase()} goal`}
          onPress={() => setAdding(item.name)}
          style={({ pressed }) => [s.row, { gap: 16, minHeight: 58, opacity: pressed ? 0.7 : 1 }]}
        >
          <item.icon size={28} strokeWidth={1.6} color={colors.text} />
          <Text style={{ flex: 1, color: colors.text, fontSize: 20 }}>{item.name}</Text>
          <Plus size={26} strokeWidth={1.6} color={colors.muted} />
        </Pressable>
      ))}
      {divider}
      <View style={{ gap: 22 }}>
        <HealthSection />
        <SubscriptionsCard />
      </View>
      {adding && (
        <Sheet
          title={adding === "Tracking" ? "Track something" : "Create a goal"}
          onClose={() => setAdding(undefined)}
        >
          {adding === "Tracking" ? (
            <View style={{ gap: 14 }}>
              <View style={[s.row, { gap: 8 }]}>
                <Button
                  small
                  primary={tracking === "schedule"}
                  onPress={() => setTracking("schedule")}
                >
                  On a schedule
                </Button>
                <Button small primary={tracking === "page"} onPress={() => setTracking("page")}>
                  A web page
                </Button>
              </View>
              {tracking === "schedule" ? (
                <RoutineForm onDone={() => setAdding(undefined)} />
              ) : (
                <MonitorForm onDone={() => setAdding(undefined)} />
              )}
            </View>
          ) : (
            <GoalForm category={adding} onDone={() => setAdding(undefined)} />
          )}
        </Sheet>
      )}
      {goal && (
        <Sheet title={goal.title} onClose={() => setSelectedGoal(undefined)}>
          <GoalCard goal={goal} onOpenTask={() => setSelectedGoal(undefined)} />
        </Sheet>
      )}
      {monitor && (
        <Sheet title={monitor.title} onClose={() => setSelectedMonitor(undefined)}>
          <MonitorCard monitor={monitor} onOpenTask={() => setSelectedMonitor(undefined)} />
        </Sheet>
      )}
      {routine && (
        <Sheet title={routine.title} onClose={() => setSelectedRoutine(undefined)}>
          <RoutineDetail routine={routine} onDone={() => setSelectedRoutine(undefined)} />
        </Sheet>
      )}
    </View>
  );
}
function GoalForm({ onDone, category }: { onDone: () => void; category?: string }) {
  const { mutate } = useAgentWorkspace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [milestones, setMilestones] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await mutate("/goals", {
        title: title.trim(),
        category,
        description,
        milestones: milestones
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Field
        label="Your goal"
        value={title}
        onChangeText={setTitle}
        placeholder="Build a three-month emergency fund"
      />
      <Field
        label="What does success look like?"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <Field
        label="Milestones (one per line)"
        value={milestones}
        onChangeText={setMilestones}
        multiline
      />
      <ErrorNotice error={error} />
      <Button primary disabled={!title.trim()} busy={busy} onPress={() => void save()}>
        Create goal
      </Button>
    </Card>
  );
}
function GoalCard({ goal, onOpenTask }: { goal: Goal; onOpenTask?: () => void }) {
  const { data, mutate, delegate } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const done = goal.milestones.filter((item) => item.done).length;
  async function update(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/goals/${goal.id}`, body);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function plan() {
    setBusy(true);
    setError("");
    try {
      const task = await delegate({
        title: `Plan: ${goal.title}`,
        prompt: `Create a practical plan for this goal: ${goal.title}. ${goal.description}`,
        kind: "plan",
        goalId: goal.id,
        input: {},
      });
      onOpenTask?.();
      open({ type: "task", taskId: task.id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 12 }}>
      <View style={s.between}>
        <Text style={[s.heading, { flex: 1 }]}>{goal.title}</Text>
        <Chip tint={goal.status === "completed" ? colors.green : colors.sky}>
          {statusLabel(goal.status)}
        </Chip>
      </View>
      <Text style={s.muted}>{goal.description}</Text>
      <Text style={s.small}>
        {done} of {goal.milestones.length} milestones
      </Text>
      {goal.milestones.map((milestone) => (
        <CheckRow
          key={milestone.id}
          checked={milestone.done}
          label={milestone.title}
          onPress={() => {
            if (!busy)
              void update({
                milestones: goal.milestones.map((item) =>
                  item.id === milestone.id ? { ...item, done: !item.done } : item,
                ),
              });
          }}
        />
      ))}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          busy={busy}
          onPress={() => void update({ status: goal.status === "active" ? "paused" : "active" })}
        >
          {goal.status === "active" ? "Pause" : "Resume"}
        </Button>
        {goal.status !== "completed" && (
          <Button small busy={busy} onPress={() => void update({ status: "completed" })}>
            Complete goal
          </Button>
        )}
        <Button small primary busy={busy} onPress={() => void plan()}>
          Plan next steps
        </Button>
      </View>
      {data?.tasks
        .filter((task) => task.goalId === goal.id)
        .map((task) => (
          <TaskCard key={task.id} task={task} compact onOpen={onOpenTask} />
        ))}
    </Card>
  );
}
function MonitorForm({ onDone }: { onDone: () => void }) {
  const { workspace } = useWorkspace();
  const { mutate } = useAgentWorkspace();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [condition, setCondition] = useState<Monitor["condition"]>("change");
  const [value, setValue] = useState("");
  const [interval, setInterval] = useState("15");
  const [sample, setSample] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const minutes = Number(interval);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)
        throw new Error("Use a check interval from 1 to 10080 minutes.");
      if (!sample && !/^https?:\/\//i.test(url.trim()))
        throw new Error("Enter an http or https address for a public page.");
      await mutate("/monitors", {
        title: title.trim(),
        url: sample ? "sample://availability" : url.trim(),
        condition,
        value,
        intervalMinutes: minutes,
      });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Field
        label="What are you watching?"
        value={title}
        onChangeText={setTitle}
        placeholder="A table at my favorite restaurant"
      />
      {workspace.mode === "sample" && (
        <CheckRow
          checked={sample}
          label="Try the built-in availability page"
          onPress={() => setSample(!sample)}
        />
      )}
      {!sample && (
        <Field
          label="Public page URL"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          placeholder="https://example.com/product"
        />
      )}
      <Text style={[s.small, { marginBottom: 10 }]}>Notify me when</Text>
      <View style={[s.row, { gap: 7, flexWrap: "wrap", marginBottom: 16 }]}>
        {(["change", "contains", "price_below"] as const).map((item) => (
          <Button small primary={condition === item} key={item} onPress={() => setCondition(item)}>
            {item === "change"
              ? "Page changes"
              : item === "contains"
                ? "Text appears"
                : "Price drops below"}
          </Button>
        ))}
      </View>
      {condition !== "change" && (
        <Field
          label={condition === "contains" ? "Text to look for" : "Target price"}
          value={value}
          onChangeText={setValue}
        />
      )}
      <Field
        label="Check every (minutes)"
        value={interval}
        onChangeText={setInterval}
        keyboardType="number-pad"
      />
      <Text style={[s.small, { marginBottom: 14 }]}>
        {sample
          ? "Changes to this built-in page stay in your workspace."
          : "Your agent checks this public page on the server and saves meaningful changes in Updates."}
      </Text>
      <ErrorNotice error={error} />
      <Button
        primary
        busy={busy}
        disabled={
          !title.trim() || (!sample && !url.trim()) || (condition !== "change" && !value.trim())
        }
        onPress={() => void save()}
      >
        Start tracking
      </Button>
    </Card>
  );
}
/** Dollars with cents, as money shows everywhere in the app: "$1,049.99". */
const money = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A compact amount for tight spots, such as a chart's scale: "$171", "$2.5", "$0.60". */
const shortMoney = (value: number) =>
  value >= 10 || Number.isInteger(value)
    ? `$${Math.round(value).toLocaleString("en-US")}`
    : `$${value.toFixed(value < 1 ? 2 : 1)}`;
/** A day in the person's own calendar: "Sep 29". */
const shortDay = (value: string | number) =>
  new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
/** The day on one line and the time under it, in the person's own calendar. */
function WhenCell({ at }: { at: string }) {
  return (
    <View>
      <Text style={[s.text, { fontSize: 14, lineHeight: 20, fontVariant: ["tabular-nums"] }]}>
        {shortDay(at)}
      </Text>
      <Text
        style={[
          s.small,
          { fontSize: 12, color: colors.mutedStrong, fontVariant: ["tabular-nums"] },
        ]}
      >
        {new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
      </Text>
    </View>
  );
}
/** One check of a watched page, as the server keeps it. */
interface MonitorCheck {
  at: string;
  value: string;
  price?: number;
  changed?: boolean;
  found?: boolean;
}
/** What a check saw, in a few words. */
function checkSaw(monitor: Monitor, check: MonitorCheck) {
  if (monitor.condition === "price_below") {
    if (check.price === undefined) return "No price on the page";
    const target = Number(monitor.value);
    return Number.isFinite(target) && check.price < target
      ? `${money(check.price)}, below your price`
      : money(check.price);
  }
  if (monitor.condition === "contains")
    return check.found ? `Found “${monitor.value.trim()}”` : "Not on the page";
  return check.changed === undefined ? "First look" : check.changed ? "Changed" : "No change";
}
const CHECKS_SHOWN = 8;
/** The watch's last checks: a price watch's prices as a line, and a table of what each saw. */
function MonitorChecks({ monitor }: { monitor: Monitor }) {
  const { api } = useWorkspace();
  const { data } = useAgentWorkspace();
  const agentName = data?.identity.name || "your agent";
  const [checks, setChecks] = useState<MonitorCheck[]>();
  const [all, setAll] = useState(false);
  useEffect(() => {
    void api.request<{ checks: MonitorCheck[] }>(`/api/monitors/${monitor.id}/checks`).then(
      (value) => setChecks(value.checks),
      () => undefined,
    );
  }, [api, monitor.id, monitor.checks, monitor.lastCheckedAt]);
  if (!checks) return null;
  const priced = checks.filter((check) => check.price !== undefined);
  const target = Number(monitor.value);
  // All on one day: the times say more than the date.
  const oneDay = new Set(priced.map((check) => shortDay(check.at))).size <= 1;
  const newest = [...checks].reverse();
  const rows = all ? newest : newest.slice(0, CHECKS_SHOWN);
  return (
    <>
      {monitor.condition === "price_below" && priced.length > 0 && (
        <View style={{ gap: 8 }}>
          <View style={[s.between, { gap: 8, flexWrap: "wrap" }]}>
            <Text style={[s.label, { color: colors.mutedStrong }]}>Price at each check</Text>
            <Text style={[s.small, { fontSize: 13, color: colors.mutedStrong }]}>
              Latest{" "}
              <Text style={{ color: colors.text, fontWeight: "700" }}>
                {money(priced.at(-1)?.price ?? 0)}
              </Text>
            </Text>
          </View>
          <LineChart
            label="Price at each check"
            points={priced.map((check) => ({
              key: check.at,
              at: Date.parse(check.at),
              value: check.price as number,
              tip: `${stamp(check.at)}: ${money(check.price as number)}`,
            }))}
            format={money}
            when={(at) =>
              oneDay
                ? new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
                : shortDay(at)
            }
            target={Number.isFinite(target) && target > 0 ? target : undefined}
            targetLabel={
              Number.isFinite(target) && target > 0 ? `Your price ${money(target)}` : undefined
            }
          />
        </View>
      )}
      <View style={{ gap: 8 }}>
        <View style={[s.row, { gap: 6 }]}>
          <Text style={[s.label, { color: colors.mutedStrong }]}>Recent checks</Text>
          <InfoTip
            term="Recent checks"
            text={`Each time ${agentName} looked at the page, newest first, up to the last 60.`}
          />
        </View>
        <DataTable
          label="Recent checks"
          columns={[
            {
              title: "When",
              flex: 1,
              minWidth: 64,
              render: (check) => <WhenCell at={check.at} />,
            },
            {
              title: "What it saw",
              flex: 2,
              render: (check) => (
                <View style={{ gap: 2 }}>
                  <Text style={[s.text, { fontSize: 14, lineHeight: 20 }]}>
                    {checkSaw(monitor, check)}
                  </Text>
                  {monitor.condition === "change" && check.changed !== false && !!check.value && (
                    <Text
                      numberOfLines={2}
                      style={[s.small, { fontSize: 12, color: colors.mutedStrong }]}
                    >
                      {check.value}
                    </Text>
                  )}
                </View>
              ),
            },
          ]}
          rows={rows}
          rowKey={(check) => check.at}
          empty={
            monitor.status === "stopped"
              ? "This watch stopped before it looked at the page."
              : "Each check shows up here. Tap Check now to look right away."
          }
        />
        {checks.length > CHECKS_SHOWN && (
          <Button small style={{ alignSelf: "flex-start" }} onPress={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${checks.length}`}
          </Button>
        )}
      </View>
    </>
  );
}
function MonitorCard({ monitor, onOpenTask }: { monitor: Monitor; onOpenTask?: () => void }) {
  const { mutate } = useAgentWorkspace();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/monitors/${monitor.id}/control`, { action });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeSample() {
    setBusy(true);
    setError("");
    try {
      await mutate("/sample-page", {
        text: `Availability: a table is available. Updated ${new Date().toISOString()}`,
      });
      await mutate(`/monitors/${monitor.id}/control`, { action: "check" });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 13 }}>
      <View style={s.between}>
        <Text style={[s.heading, { flex: 1 }]}>{monitor.title}</Text>
        <Chip tint={colors.sky}>{statusLabel(monitor.status)}</Chip>
      </View>
      <Text selectable style={s.small}>
        {monitor.url.startsWith("sample:") ? "Built-in availability page" : monitor.url}
      </Text>
      <Text style={s.text}>
        {monitor.condition === "change"
          ? "Watch for a page change"
          : monitor.condition === "contains"
            ? `Watch for “${monitor.value}”`
            : `Price below ${monitor.value}`}
      </Text>
      <Text style={s.small}>
        Every {monitor.intervalMinutes} min · {monitor.checks} checks
      </Text>
      <Text style={s.small}>
        Last check: {stamp(monitor.lastCheckedAt)}
        {monitor.status === "active" ? `\nNext check: ${stamp(monitor.nextCheckAt)}` : ""}
      </Text>
      {!!monitor.lastValue && (
        <Text selectable numberOfLines={5} style={s.muted}>
          {monitor.lastValue}
        </Text>
      )}
      <ErrorNotice error={error || monitor.error} />
      {monitor.status !== "stopped" && (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button
            small
            busy={busy}
            onPress={() => void act(monitor.status === "active" ? "pause" : "resume")}
          >
            {monitor.status === "active" ? "Pause" : "Resume"}
          </Button>
          <Button small busy={busy} onPress={() => void act("check")}>
            Check now
          </Button>
          <Button small danger busy={busy} onPress={() => void act("stop")}>
            Stop tracking
          </Button>
        </View>
      )}
      {monitor.url.startsWith("sample:") && monitor.status !== "stopped" && (
        <Button small busy={busy} onPress={() => void changeSample()}>
          Change availability
        </Button>
      )}
      <MonitorChecks monitor={monitor} />
      <TaskLink taskId={monitor.taskId} onOpen={onOpenTask} />
    </Card>
  );
}
const UPDATE_PLACES: { id: UpdatesDisplay; label: string; detail: string }[] = [
  {
    id: "popup",
    label: "Pop-up by the bell",
    detail:
      "A small card pops up under the bell. Reminders and anything that needs you stay until you act; the rest slide away.",
  },
  { id: "bell", label: "Only the bell", detail: "Updates wait quietly in the bell." },
  { id: "chat", label: "In the chat", detail: "Updates appear as a card at the end of the chat." },
];
export function NotificationsSheet() {
  const { data, mutate } = useAgentWorkspace();
  const { close, open, navigate, workspace, api, refresh } = useWorkspace();
  const [error, setError] = useState("");
  async function read(id: string, taskId?: string, checkInId?: string, actionId?: string) {
    try {
      await mutate(`/notifications/${id}/read`, {});
      if (taskId) open({ type: "task", taskId });
      else if (checkInId) {
        close();
        navigate("chat");
      } else if (actionId) {
        // Its review, or Activity when it's already been decided or has expired. Something saved
        // during a call while the app was open may not be in what's loaded yet: look again.
        const waiting = (list: ActionProposal[]) =>
          list.find((item) => item.id === actionId && item.status === "awaiting_review");
        let action = waiting(workspace.actions);
        if (!action) {
          action = waiting(
            (await api.request<{ actions: ActionProposal[] }>("/api/workspace")).actions,
          );
          void refresh().catch(() => undefined);
        }
        if (action) open({ type: "review", action });
        else {
          close();
          navigate("activity");
        }
      }
    } catch (e) {
      setError(errorText(e));
    }
  }
  // Unread reminders and decisions come first; the rest stays newest first.
  const items = (data?.notifications ?? [])
    .map((item) => ({
      item,
      needsYou: !item.read && updateKind(item, data?.tasks) !== "update",
      // A reminder's title is only "Reminder": what it's about leads.
      reminder: !!item.reminderId && !item.taskId,
    }))
    .sort((a, b) => Number(b.needsYou) - Number(a.needsYou));
  return (
    <Sheet
      title="Updates"
      subtitle="Results and decisions that need your attention."
      onClose={close}
    >
      <View style={{ gap: 14 }}>
        <ErrorNotice error={error} />
        {items.map(({ item, needsYou, reminder }) => (
          <Card
            key={item.id}
            style={{ gap: 8, backgroundColor: item.read ? colors.card : colors.sky }}
          >
            <View style={s.between}>
              <Text style={[s.heading, { flexShrink: 1 }]}>
                {reminder ? item.body : item.title}
              </Text>
              {!item.read && (
                <Chip tint={needsYou ? colors.lavender : undefined}>
                  {needsYou ? "Needs you" : "New"}
                </Chip>
              )}
            </View>
            <Text style={s.muted} numberOfLines={3}>
              {reminder ? lateNote(item.title) || "Reminder" : plainPreview(item.body)}
            </Text>
            <Text style={s.small}>{stamp(item.createdAt)}</Text>
            <Button
              small
              onPress={() => void read(item.id, item.taskId, item.checkInId, item.actionId)}
            >
              {item.taskId
                ? "Open job"
                : item.checkInId
                  ? "Answer in chat"
                  : item.actionId
                    ? "Review"
                    : item.read
                      ? "Read"
                      : item.reminderId
                        ? "Done"
                        : "Mark read"}
            </Button>
          </Card>
        ))}
        {!data?.notifications.length && (
          <Empty
            icon={Bell}
            title="You're all caught up"
            detail="Results, meaningful changes and requests for your input will appear here."
          />
        )}
      </View>
    </Sheet>
  );
}
export function AppsScreen() {
  const { navigate, open, notify } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const suggestions = useRef<View>(null);
  const remembered = useRef<Text>(null);
  /** A suggestion was kept or dismissed: focus goes to the next one, or to where kept ones go. */
  function suggestionDone() {
    if (Platform.OS !== "web") return;
    setTimeout(() => {
      const card = suggestions.current as unknown as HTMLElement | null;
      const next = card?.querySelector<HTMLElement>('[aria-label^="Keep: "]');
      const heading = remembered.current as unknown as HTMLElement | null;
      (next ?? heading)?.focus();
    }, 150);
  }
  const [query, setQuery] = useState("");
  const [tab, setTab] = useAppsTab();
  const [name, setName] = useState(data?.identity.name || "Neddy");
  const [tone, setTone] = useState(data?.identity.tone || "warm");
  const [avatar, setAvatar] = useState(data?.identity.avatar || "sky");
  const [character, setCharacter] = useState(data?.identity.character || "neddy");
  const [display, setDisplay] = useState<UpdatesDisplay>(updatesDisplay(data?.identity));
  const [memory, setMemory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const settingsChanged =
    !!data?.identity &&
    (name.trim() !== data.identity.name ||
      tone !== data.identity.tone ||
      display !== updatesDisplay(data.identity));
  // The avatar saves as soon as it's picked, so it follows the saved identity on its own; that
  // way picking one doesn't undo a name or tone that's being edited.
  useEffect(() => {
    if (data?.identity) {
      setName(data.identity.name);
      setTone(data.identity.tone);
      setDisplay(updatesDisplay(data.identity));
    }
  }, [
    data?.identity.name,
    data?.identity.tone,
    data?.identity.showChatUpdates,
    data?.identity.updatesDisplay,
  ]);
  useEffect(() => {
    if (data?.identity) {
      setAvatar(data.identity.avatar || "sky");
      setCharacter(data.identity.character || "neddy");
    }
  }, [data?.identity.avatar, data?.identity.character, data?.identity.avatarImageVersion]);
  async function save(path: string, body: unknown, done?: string) {
    setBusy(true);
    setError("");
    try {
      await mutate(path, body);
      if (done) notify(done);
      if (path === "/memories") setMemory("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const shortcuts = [
    {
      section: "mail" as const,
      title: "Mail",
      detail: "Read messages and prepare replies",
      icon: Mail,
    },
    {
      section: "calendar" as const,
      title: "Calendar",
      detail: "Events and reviewed invitations",
      icon: CalendarDays,
    },
    {
      section: "browser" as const,
      title: `${(data?.identity.name || "Your agent").replace(/^./, (c) => c.toUpperCase())}’s browser`,
      detail: "The websites it opened, to watch or take control",
      icon: Globe2,
    },
    {
      section: "files" as const,
      title: "Files",
      detail: "PDFs, forms and filled copies",
      icon: FileText,
    },
  ];
  return (
    <View style={{ gap: 22 }}>
      <AgentStatus />
      <AppsTabs tab={tab} onTab={setTab} badges={{ about: data?.memorySuggestions.length }} />
      {tab === "apps" && (
        <>
          <Field
            label="Search apps"
            value={query}
            onChangeText={setQuery}
            placeholder="Search connectors"
          />
          <ConnectionsScreen query={query} />
          {!query && <OwnAppsCard />}
          <Text style={s.heading}>On your computer</Text>
          <Card style={{ paddingVertical: 3, backgroundColor: colors.card }}>
            {shortcuts
              .filter((item) =>
                `${item.title} ${item.detail}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((item) => (
                <LinkRow
                  key={item.section}
                  icon={item.icon}
                  title={item.title}
                  detail={item.detail}
                  onPress={() =>
                    item.section === "browser" ? open({ type: "computer" }) : navigate(item.section)
                  }
                />
              ))}
          </Card>
          <AlwaysAllowedCard />
          <AppPermissionsCard />
        </>
      )}
      {tab === "alerts" && (
        <>
          <JobAlertsCard />
          <UrgentAlertsCard />
          <MailAlertsCard />
          <AppAlertsCard />
          <PhoneAppCard />
        </>
      )}
      {tab === "money" && (
        <>
          <SpendingCard />
          <UsageCard />
          <ModelsCard />
        </>
      )}
      {tab === "account" && (
        <>
          <AppearanceCard />
          <AccountCard />
          <PasswordsCard />
          <LocationCard />
          <YourDataCard />
          <PeopleCard />
        </>
      )}
      {tab === "help" && <HelpCard />}
      {tab === "about" && (
        <>
          <AboutYou
            top={
              !!data?.memorySuggestions.length && (
                <Card style={{ gap: 12 }}>
                  <View style={[s.row, { gap: 10 }]}>
                    <Emoji char="💡" size={28} />
                    <Text role="heading" aria-level={3} style={[s.heading, { flex: 1 }]}>
                      Suggested from your chats
                    </Text>
                  </View>
                  <Text style={s.muted}>
                    Keep the ones that are right. I won’t use them until you do.
                  </Text>
                  <View ref={suggestions} style={{ gap: 12 }}>
                    {data.memorySuggestions.map((item) => (
                      <SuggestionRow key={item.id} suggestion={item} onDone={suggestionDone} />
                    ))}
                  </View>
                </Card>
              )
            }
          />
          <Card style={{ gap: 12 }}>
            <View style={[s.row, { gap: 10 }]}>
              <Emoji char="🗂️" size={28} />
              <Text
                ref={remembered}
                role="heading"
                aria-level={3}
                {...({ tabIndex: -1 } as object)}
                style={s.heading}
              >
                Other things I remember
              </Text>
            </View>
            <Text style={s.muted}>
              Anything else you’ve told me. Check it, correct it or forget it.
            </Text>
            {data?.memories.map((item) => (
              <MemoryRow key={item.id} memory={item} />
            ))}
            <Field
              label="Something else I should remember"
              value={memory}
              onChangeText={setMemory}
              placeholder="I prefer morning meetings"
            />
            <Button
              busy={busy}
              disabled={!memory.trim()}
              style={{ alignSelf: "flex-start" }}
              onPress={() =>
                void save("/memories", { text: memory.trim(), source: "User added in Apps" })
              }
            >
              Remember
            </Button>
            <View style={s.divider} />
            <ChatgptImport />
          </Card>
        </>
      )}
      {tab === "agent" && (
        <>
          <Card style={{ gap: 10 }}>
            <SectionHeading title="Your agent" />
            <AvatarPicker
              character={character}
              color={avatar}
              agentName={data?.identity.name || "Your agent"}
              onCharacter={setCharacter}
              onColor={setAvatar}
            />
            {/* The avatar saves on its own; everything below waits for the button. */}
            <View style={s.divider} />
            <Field label="Name" value={name} onChangeText={setName} />
            <Text style={s.label}>Tone</Text>
            <View role="group" aria-label="Tone" style={[s.row, { gap: 8 }]}>
              {(["warm", "concise", "thoughtful"] as const).map((item) => (
                <Button
                  key={item}
                  small
                  primary={tone === item}
                  selected={tone === item}
                  onPress={() => setTone(item)}
                >
                  {statusLabel(item)}
                </Button>
              ))}
            </View>
            <Text style={s.label}>Where updates show</Text>
            <View
              role="group"
              accessibilityLabel="Where updates show"
              style={[s.row, { gap: 8, flexWrap: "wrap" }]}
            >
              {UPDATE_PLACES.map((place) => (
                <Button
                  key={place.id}
                  small
                  primary={display === place.id}
                  selected={display === place.id}
                  onPress={() => setDisplay(place.id)}
                >
                  {place.label}
                </Button>
              ))}
            </View>
            <Text style={s.small}>
              {UPDATE_PLACES.find((place) => place.id === display)?.detail} The bell always keeps
              every update, including anything that needs you.
            </Text>
            {/* Lit only when something here isn't saved yet, so an avatar tap never looks unsaved. */}
            <Button
              busy={busy}
              disabled={!name.trim() || !settingsChanged}
              onPress={() =>
                void save(
                  "/identity",
                  {
                    name: name.trim(),
                    tone,
                    updatesDisplay: display,
                    showChatUpdates: display === "chat",
                  },
                  `${name.trim()}’s settings are saved.`,
                )
              }
            >
              Save name and settings
            </Button>
          </Card>
          <Card style={{ paddingVertical: 3 }}>
            <LinkRow
              icon={UserRound}
              title="About you"
              detail={`What ${data?.identity.name || "your agent"} knows about you, to check, change or forget`}
              onPress={() => setTab("about")}
            />
          </Card>
          <PeopleNotesCard />
          <VoiceCard name={data?.identity.name || "Neddy"} />
          <AgentEmailCard />
        </>
      )}
      <ErrorNotice error={error} />
    </View>
  );
}
interface SpendingSettings {
  enabled: boolean;
  perPurchaseLimit: number;
  monthlyLimit: number;
  spentThisMonth: number;
}
interface Purchases {
  /** The month the monthly limit counts now: "2026-09". */
  month: string;
  /** This month's, newest first. */
  purchases: { id: string; amount: number; at: string; what: string; app?: string }[];
  /** Oldest first. */
  months: { month: string; total: number }[];
}
/** "2026-09" as "September 2026", or "Sep" when `short`. */
const monthName = (month: string, short = false) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString(
    undefined,
    short ? { month: "short" } : { month: "long", year: "numeric" },
  );
/** What the agent spent: this month against the limit, six months of totals, and each purchase. */
function SpendingViews({ settings, spent }: { settings: SpendingSettings; spent?: Purchases }) {
  const limit = settings.monthlyLimit;
  // From the settings, so this month's line stays even when the purchases can't load.
  const used = settings.spentThisMonth;
  const total = spent?.purchases.reduce((sum, p) => sum + p.amount, 0) ?? 0;
  const label = [s.label, { color: colors.mutedStrong }];
  return (
    <View style={{ gap: 26, marginTop: 6 }}>
      <View style={{ gap: 8 }}>
        <View style={[s.between, { gap: 8, flexWrap: "wrap" }]}>
          <Text style={label}>This month</Text>
          <Text style={[s.text, { fontVariant: ["tabular-nums"] }]}>
            <Text style={{ fontWeight: "700" }}>{money(used)}</Text> of {money(limit)}
          </Text>
        </View>
        <Meter
          value={used}
          max={limit}
          label={`${money(used)} of your ${money(limit)} monthly limit used`}
        />
        <Text style={[s.small, { fontSize: 12, color: colors.mutedStrong }]}>
          {used >= limit
            ? "You’ve reached this month’s limit. Raise it below to allow more."
            : `${money(limit - used)} left this month`}
        </Text>
      </View>
      {!!spent?.months.some((m) => m.total > 0) && (
        <View style={{ gap: 10 }}>
          <Text style={label}>Last 6 months</Text>
          <BarChart
            label="Spending by month"
            bars={spent.months.map((m) => ({
              key: m.month,
              label: monthName(m.month, true),
              name: monthName(m.month),
              value: m.total,
              tip: `${monthName(m.month)}: ${money(m.total)}`,
              strong: m.month === spent.month,
            }))}
            target={limit}
            targetLabel={`Limit ${money(limit)}`}
            format={money}
            short={shortMoney}
          />
        </View>
      )}
      {spent && (
        <View style={{ gap: 8 }}>
          <Text style={label}>This month’s purchases</Text>
          <DataTable
            label="This month’s purchases"
            columns={[
              { title: "Date", flex: 0.8, minWidth: 52, render: (p) => shortDay(p.at) },
              {
                title: "What",
                flex: 2.2,
                render: (p) => (
                  <View style={{ gap: 1 }}>
                    <Text numberOfLines={2} style={[s.text, { fontSize: 14, lineHeight: 20 }]}>
                      {p.what}
                    </Text>
                    {!!p.app && (
                      <Text style={[s.small, { fontSize: 12, color: colors.mutedStrong }]}>
                        {p.app.charAt(0).toUpperCase() + p.app.slice(1)}
                      </Text>
                    )}
                  </View>
                ),
              },
              {
                title: "Amount",
                align: "right",
                flex: 1,
                minWidth: 72,
                render: (p) => money(p.amount),
              },
            ]}
            rows={spent.purchases}
            rowKey={(p) => p.id}
            empty="Nothing bought this month. Purchases you approve show up here."
            footer={["Total", "", money(total)]}
          />
        </View>
      )}
      <View style={[s.divider, { marginVertical: 0 }]} />
    </View>
  );
}
/** Purchase guardrails: off by default, capped per purchase and per month. */
function SpendingCard() {
  const { api, notify } = useWorkspace();
  const [settings, setSettings] = useState<SpendingSettings>();
  const [spent, setSpent] = useState<Purchases>();
  const [perPurchase, setPerPurchase] = useState("");
  const [monthly, setMonthly] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const apply = (value: SpendingSettings) => {
    setSettings(value);
    setPerPurchase(String(value.perPurchaseLimit));
    setMonthly(String(value.monthlyLimit));
  };
  useEffect(() => {
    void api.request<SpendingSettings>("/api/spending").then(apply, () => undefined);
    void api.request<Purchases>("/api/spending/purchases").then(setSpent, () => undefined);
  }, [api]);
  if (!settings) return null;
  // With purchases off and nothing spent lately, there's nothing to show yet. This month's line
  // comes from the settings, so it stays even if the purchases can't load.
  const views =
    settings.enabled || settings.spentThisMonth > 0 || !!spent?.months.some((m) => m.total > 0);
  async function save(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      apply(
        await api.request<SpendingSettings>("/api/spending", {
          enabled,
          perPurchaseLimit: Number(perPurchase),
          monthlyLimit: Number(monthly),
        }),
      );
      notify(enabled ? "Spending settings saved." : "Purchases are off.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const valid = Number(perPurchase) > 0 && Number(monthly) > 0;
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="Spending" />
      <Text style={s.muted}>
        {settings.enabled
          ? "Purchases through connected apps are on. Each one waits for your approval."
          : "Purchases are off. Turn them on to let your agent prepare orders and payments in connected apps, each waiting for your approval."}
      </Text>
      {views && <SpendingViews settings={settings} spent={spent} />}
      <Field
        label="Most for one purchase (USD)"
        value={perPurchase}
        onChangeText={setPerPurchase}
        keyboardType="decimal-pad"
      />
      <Field
        label="Most per month (USD)"
        value={monthly}
        onChangeText={setMonthly}
        keyboardType="decimal-pad"
      />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button primary busy={busy} disabled={!valid} onPress={() => void save(true)}>
          {settings.enabled ? "Save limits" : "Turn on purchases"}
        </Button>
        {settings.enabled && (
          <Button disabled={busy || !valid} onPress={() => void save(false)}>
            Turn off purchases
          </Button>
        )}
      </View>
      <ErrorNotice error={error} />
    </Card>
  );
}
interface AgentEmailSettings {
  configured: boolean;
  address?: string;
  allowedSenders: string[];
  recent: {
    id: string;
    from: string;
    subject: string;
    receivedAt: string;
    status: "task" | "held";
    reason?: string;
  }[];
}
/** The agent's own address: approved senders forward or send work to it. */
function AgentEmailCard() {
  const { api, notify } = useWorkspace();
  const [settings, setSettings] = useState<AgentEmailSettings>();
  const [senders, setSenders] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void api.request<AgentEmailSettings>("/api/agent-email").then(
      (value) => {
        setSettings(value);
        setSenders(value.allowedSenders.join(", "));
      },
      () => undefined,
    );
  }, [api]);
  if (!settings?.configured || !settings.address) return null;
  async function save() {
    setBusy(true);
    setError("");
    try {
      const value = await api.request<AgentEmailSettings>("/api/agent-email", {
        allowedSenders: senders
          .split(/[\s,;]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setSettings(value);
      setSenders(value.allowedSenders.join(", "));
      notify("Approved senders saved.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="Agent email" />
      <Text selectable style={s.heading}>
        {settings.address}
      </Text>
      <Text style={s.muted}>
        Send or forward email to this address to hand your agent work: a bill to pay, a trip
        confirmation to organize, a thread to follow up on. Only approved senders can give it work;
        anything else is held.
      </Text>
      <Field
        label="Approved senders"
        value={senders}
        onChangeText={setSenders}
        placeholder="you@example.com, partner@example.com"
        autoCapitalize="none"
      />
      <Button busy={busy} onPress={() => void save()}>
        Save approved senders
      </Button>
      {settings.recent.map((email) => (
        <View key={email.id} style={{ gap: 2 }}>
          <Text style={s.text} numberOfLines={1}>
            {email.subject}
          </Text>
          <Text style={s.small}>
            {email.from} · {stamp(email.receivedAt)} ·{" "}
            {email.status === "task" ? "Sent to Activity" : `Held: ${email.reason ?? ""}`}
          </Text>
        </View>
      ))}
      <ErrorNotice error={error} />
    </Card>
  );
}
/** How the agent tells the person that a job they handed off is done, needs them, or failed. */
function JobAlertsCard() {
  const { notify } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = data?.identity.name || "your agent";
  const on = data?.identity.emailJobUpdates !== false;
  const shows = updatesDisplay(data?.identity);
  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await mutate("/identity", { emailJobUpdates: !on });
      notify(on ? "Job emails are off." : "Job emails are on.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="Jobs you hand off" />
      <Text style={s.muted}>
        {`When ${name} finishes a job you handed off, needs your answer, or can’t finish, you’ll see ${
          shows === "popup"
            ? "a pop-up in the app"
            : shows === "chat"
              ? "it in the chat"
              : "it in the bell"
        }. Devices with notifications on get a notification too.`}
      </Text>
      <CheckRow label="Email me about jobs I hand off" checked={on} onPress={() => void toggle()} />
      <ErrorNotice error={error} />
    </Card>
  );
}
/** Home-screen install and push notifications for the web app. */
function PhoneAppCard() {
  const { api, notify } = useWorkspace();
  const [state, setState] = useState<PushState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (Platform.OS === "web") void pushState().then(setState, () => setState("unsupported"));
  }, []);
  if (Platform.OS !== "web" || !state) return null;
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      if (state === "on") await disablePush(api);
      else await enablePush(api);
      const next = await pushState();
      setState(next);
      notify(next === "on" ? "Notifications are on for this device." : "Notifications are off.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="Phone app & notifications" />
      {!isInstalled() && (
        <Text style={s.muted}>
          {isIos()
            ? "Add Neato_Muse to your Home Screen: tap the Share button, then “Add to Home Screen”. Open it from there to get notifications."
            : "Install Neato_Muse from your browser menu (“Install app” or “Add to Home screen”) to open it like an app."}
        </Text>
      )}
      <Text style={s.muted}>
        {state === "on"
          ? "This device gets a notification when a job or routine finishes, or something needs you."
          : state === "install-first"
            ? "Notifications work once Neato_Muse is on your Home Screen."
            : state === "blocked"
              ? "Notifications are blocked for this site. Allow them in your browser settings, then come back."
              : state === "unsupported"
                ? "This browser can't show notifications from Neato_Muse."
                : "Get a notification when a job or routine finishes, or something needs you."}
      </Text>
      {(state === "on" || state === "off") && (
        <Button primary={state === "off"} busy={busy} onPress={() => void toggle()}>
          {state === "on" ? "Turn off notifications" : "Turn on notifications"}
        </Button>
      )}
      <ErrorNotice error={error} />
    </Card>
  );
}
function SuggestionRow({
  suggestion,
  onDone,
}: {
  suggestion: MemorySuggestion;
  /** Kept or dismissed: the row goes, so focus moves on. */
  onDone: () => void;
}) {
  const { notify } = useWorkspace();
  const { mutate } = useAgentWorkspace();
  const [text, setText] = useState(suggestion.text);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const buttons = useRef<View>(null);
  async function decide(action: "keep" | "dismiss") {
    setBusy(true);
    setError("");
    try {
      await mutate(`/memory-suggestions/${suggestion.id}`, {
        action,
        ...(action === "keep" ? { text: text.trim() } : {}),
      });
      notify(action === "keep" ? "Kept. It’s under Other things I remember." : "Dismissed.");
      onDone();
    } catch (e) {
      setError(errorText(e));
      // The pressed button was disabled while busy; put focus back on it.
      if (Platform.OS === "web")
        setTimeout(() => {
          const row = buttons.current as unknown as HTMLElement | null;
          row
            ?.querySelector<HTMLElement>(
              `[aria-label^="${action === "keep" ? "Keep" : "Dismiss"}: "]`,
            )
            ?.focus();
        }, 60);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View
      style={{
        gap: 8,
        padding: 14,
        borderRadius: 16,
        backgroundColor: colors.lavender,
      }}
    >
      {editing ? (
        <Field label="Memory" value={text} onChangeText={setText} autoFocus />
      ) : (
        <Text style={s.text}>{suggestion.text}</Text>
      )}
      {!!suggestion.reason && (
        <Text style={[s.small, { color: colors.mutedStrong }]}>{suggestion.reason}</Text>
      )}
      <View ref={buttons} style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          primary
          busy={busy}
          disabled={!text.trim()}
          accessibilityLabel={`Keep: ${text.trim() || suggestion.text}`}
          onPress={() => void decide("keep")}
        >
          Keep
        </Button>
        {!editing && (
          <Button
            small
            disabled={busy}
            // A card-coloured pill, so it shows on the lavender row.
            style={{ backgroundColor: colors.card }}
            accessibilityLabel={`Edit: ${suggestion.text}`}
            onPress={() => setEditing(true)}
          >
            Edit
          </Button>
        )}
        <Button
          small
          disabled={busy}
          style={{ backgroundColor: colors.card }}
          accessibilityLabel={`Dismiss: ${suggestion.text}`}
          onPress={() => void decide("dismiss")}
        >
          Dismiss
        </Button>
      </View>
      <ErrorNotice error={error} />
    </View>
  );
}
function MemoryRow({ memory }: { memory: AgentMemory }) {
  const { mutate } = useAgentWorkspace();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.text);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(forget: boolean) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/memories/${memory.id}${forget ? "/forget" : ""}`, forget ? {} : { text });
      setEditing(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View
      style={{ gap: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.line }}
    >
      {editing ? (
        <Field label="Memory" value={text} onChangeText={setText} />
      ) : (
        <Text style={s.text}>{memory.text}</Text>
      )}
      <Text style={s.small}>
        {/* Stored as the agent reads it; shown the way the person would say it. */}
        {memory.source === "User added in Apps" || memory.source === "You"
          ? "You added this"
          : memory.source}{" "}
        · {stamp(memory.createdAt)}
      </Text>
      <View style={[s.row, { gap: 8 }]}>
        {editing ? (
          <Button small busy={busy} disabled={!text.trim()} onPress={() => void act(false)}>
            Save correction
          </Button>
        ) : (
          <Button small onPress={() => setEditing(true)}>
            Edit
          </Button>
        )}
        <Button small danger busy={busy} onPress={() => void act(true)}>
          Forget
        </Button>
      </View>
      <ErrorNotice error={error} />
    </View>
  );
}
