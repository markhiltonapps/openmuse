import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
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
  Users,
  X,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Artifact, BrowserSession } from "../../../packages/domain/src";
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
import { AccountCard, PeopleCard } from "./account-ui";
import { useAgentWorkspace } from "./agent-workspace";
import { AppearanceCard } from "./appearance-ui";
import { AlwaysAllowedCard } from "./approvals-ui";
import { AppsTabs, useAppsTab } from "./apps-tabs";
import { AvatarPicker } from "./avatar-settings";
import { ChatgptImport, YourDataCard } from "./data-ui";
import { Emoji, topicEmoji } from "./emoji";
import { HealthSection } from "./health-ui";
import { HelpCard } from "./help-ui";
import { MailAlertsCard } from "./mail-alerts-ui";
import { ActivityScreen, ConnectionsScreen } from "./screens";
import { SubscriptionsCard } from "./subscriptions-ui";
import { dark } from "./theme";
import {
  Button,
  Card,
  CheckRow,
  Chip,
  colors,
  Empty,
  ErrorNotice,
  Field,
  LinkRow,
  resultSummary,
  SectionHeading,
  Sheet,
  s,
} from "./ui";
import { UsageCard } from "./usage-ui";
import { VoiceCard } from "./voice-ui";
import { disablePush, enablePush, isInstalled, isIos, type PushState, pushState } from "./web-app";
import { useWorkspace } from "./workspace";

export function statusLabel(value: string) {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
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
  const done = task.plan.filter((step) => step.status === "succeeded").length;
  const next = task.plan.find((step) => ["running", "waiting"].includes(step.status));
  const waiting = ["waiting_input", "waiting_approval"].includes(task.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open task: ${task.title}`}
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
              {statusLabel(task.status)}
              {task.plan.length ? ` · ${done}/${task.plan.length} steps` : ""}
            </Text>
          </View>
          <ChevronRight size={17} color={colors.muted} />
        </View>
        {!!task.plan.length && (
          <View style={{ height: 4, backgroundColor: colors.line, borderRadius: 4 }}>
            <View
              style={{
                height: 4,
                width: `${Math.round((done / task.plan.length) * 100)}%`,
                backgroundColor: "#6AAEE0",
                borderRadius: 4,
              }}
            />
          </View>
        )}
        {(task.question || task.result || task.error || next?.title) && (
          <Text numberOfLines={compact ? 2 : 4} style={s.muted}>
            {task.question || task.error || resultSummary(task.result || next?.title || "")}
          </Text>
        )}
        {waiting && (
          <Text style={[s.small, { color: colors.blueDark, fontWeight: "600" }]}>
            {task.status === "waiting_approval" ? "Review requested" : "Your input is needed"}
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
  const [filter, setFilter] = useState("All");
  const tasks = [...(data?.tasks || [])]
    .filter(
      (task) =>
        filter === "All" || (filter === "In progress" ? activeTask(task) : !activeTask(task)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <View style={{ gap: 20 }}>
      <AgentStatus />
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
          detail="Delegate a task in Chat. Its plan, progress and results stay here."
        />
      )}
      <SectionHeading title="Reviews & receipts" />
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
export function TaskDetail({ taskId }: { taskId: string }) {
  const { api, workspace, close, open, refresh: refreshWorkspace } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const [detail, setDetail] = useState<{
    task: AgentTask;
    events: RunEvent[];
    artifacts: AgentArtifact[];
    files: Artifact[];
    browsers: BrowserSession[];
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [fieldJson, setFieldJson] = useState("");
  const [showFieldJson, setShowFieldJson] = useState(false);
  const [fields, setFields] = useState<Record<string, string | boolean>>({});
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
  async function act(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(`/tasks/${taskId}/${path}`, body);
      if (path === "input") {
        setAnswer("");
        setFields({});
      }
    } catch (e) {
      setError(errorText(e));
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
  return (
    <Sheet
      title={task?.title || "Task"}
      subtitle={
        task ? `${statusLabel(task.status)} · ${stamp(task.updatedAt)}` : "Loading saved progress…"
      }
      onClose={close}
    >
      <ErrorNotice error={error} />
      {!task ? (
        <ActivityIndicator color={colors.blueDark} />
      ) : (
        <View style={{ gap: 20 }}>
          <Text selectable style={s.text}>
            {task.prompt}
          </Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {["queued", "running", "scheduled", "waiting_input", "waiting_approval"].includes(
              task.status,
            ) && (
              <Button
                small
                icon={Pause}
                busy={busy}
                onPress={() => void act("control", { action: "pause" })}
              >
                Pause
              </Button>
            )}
            {task.status === "paused" && (
              <Button
                small
                icon={Play}
                busy={busy}
                onPress={() => void act("control", { action: "resume" })}
              >
                Resume
              </Button>
            )}
            {task.status === "failed" && (
              <Button
                small
                icon={RefreshCw}
                busy={busy}
                onPress={() => void act("control", { action: "retry" })}
              >
                Retry task
              </Button>
            )}
            {activeTask(task) && (
              <Button
                small
                danger
                icon={X}
                busy={busy}
                onPress={() => void act("control", { action: "cancel" })}
              >
                Cancel task
              </Button>
            )}
          </View>
          {task.status === "waiting_approval" && (
            <Card style={{ backgroundColor: colors.lavender, gap: 12 }}>
              <Text style={s.heading}>Ready for your review</Text>
              <Text style={s.muted}>Review the exact action and account before it proceeds.</Text>
              <Button primary busy={busy} onPress={() => void review()}>
                Review action
              </Button>
            </Card>
          )}
          {task.status === "waiting_input" && (
            <Card style={{ backgroundColor: colors.sky, gap: 10 }}>
              <Text style={s.heading}>{task.question || "A detail from you will help"}</Text>
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
                <Field
                  label="Your answer"
                  value={answer}
                  onChangeText={setAnswer}
                  multiline
                  placeholder="Add the missing details…"
                />
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
                primary
                busy={busy}
                disabled={!answer.trim() && !Object.keys(fields).length && !fieldJson.trim()}
                onPress={() => void submitInput()}
              >
                Continue task
              </Button>
            </Card>
          )}
          {!!task.plan.length && (
            <Card style={{ gap: 15 }}>
              <Text style={s.heading}>Plan</Text>
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
                      {statusLabel(step.status)}
                      {step.detail ? ` · ${step.detail}` : ""}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          )}
          {!!task.result && (
            <Card style={{ backgroundColor: colors.green }}>
              <Text selectable style={s.text}>
                {resultSummary(task.result)}
              </Text>
            </Card>
          )}
          <ErrorNotice error={task.error ?? undefined} />
          {detail?.browsers?.map((browser) => (
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
          ))}
          {detail?.files?.map((file) => (
            <LinkRow
              key={file.id}
              title={file.name}
              detail={`${file.pageCount} pages · PDF`}
              icon={FileText}
              onPress={() => open({ type: "file", file })}
            />
          ))}
          {(
            data?.artifacts.filter((artifact) => artifact.taskId === taskId) ||
            detail?.artifacts ||
            []
          ).map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} />
          ))}
          {!!task.evidence.length && (
            <View style={{ gap: 14 }}>
              <Text style={s.heading}>Sources</Text>
              <EvidenceList items={task.evidence} />
            </View>
          )}
          <Text style={s.heading}>Timeline</Text>
          {detail?.events.map((event) => (
            <View
              key={event.id}
              style={{ gap: 4, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: colors.line }}
            >
              <Text style={s.small}>
                {stamp(event.date)} · {statusLabel(event.kind)}
              </Text>
              <Text style={s.text}>{event.title}</Text>
              <Text selectable style={s.muted}>
                {event.detail}
              </Text>
            </View>
          ))}
          {!detail?.events.length && (
            <Text style={s.muted}>The worker will record each step here.</Text>
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
export function ArtifactCard({ artifact }: { artifact: AgentArtifact }) {
  const [expanded, setExpanded] = useState(false);
  if (artifact.kind === "finance") return <FinanceArtifact artifact={artifact} />;
  const rows = Object.entries(artifact.data);
  return (
    <Card style={{ gap: 13, backgroundColor: colors.card }}>
      <View style={s.between}>
        <Text style={s.heading}>{artifact.title}</Text>
        <Chip>{statusLabel(artifact.kind)}</Chip>
      </View>
      <Text selectable style={s.muted}>
        {artifact.summary}
      </Text>
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
      <Button small onPress={() => setExpanded(!expanded)}>
        {expanded ? "Show summary" : "Explore full result"}
      </Button>
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
export function DelegateSheet() {
  const { workspace, close, open } = useWorkspace();
  const { delegate } = useAgentWorkspace();
  const [kind, setKind] = useState<AgentTask["kind"]>("plan");
  const [prompt, setPrompt] = useState("");
  const [messageId, setMessageId] = useState("");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const task = await delegate({
        prompt: prompt.trim(),
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
      title="Hand over an outcome"
      subtitle="Your agent saves a plan and keeps working on the server."
      onClose={close}
    >
      <View style={[s.row, { flexWrap: "wrap", gap: 8, marginBottom: 20 }]}>
        {(["plan", "document", "finance", "agent"] as const).map((item) => (
          <Button small primary={kind === item} key={item} onPress={() => setKind(item)}>
            {item === "agent" ? "General task" : statusLabel(item)}
          </Button>
        ))}
      </View>
      <Field
        label="What would you like done?"
        value={prompt}
        onChangeText={setPrompt}
        multiline
        placeholder={
          kind === "document"
            ? "Fill the attached form and prepare a reply for my review"
            : kind === "finance"
              ? "Summarize my spending and suggest a savings plan"
              : "Make a practical plan for my week"
        }
      />
      {kind === "document" && (
        <View style={{ gap: 8, marginBottom: 18 }}>
          <Text style={s.heading}>Choose the email with the PDF</Text>
          {workspace.mail
            .filter((mail) => mail.attachments.length)
            .map((mail) => (
              <CheckRow
                key={mail.id}
                checked={mail.id === messageId}
                label={`${mail.subject} · ${mail.sender}`}
                onPress={() => setMessageId(mail.id)}
              />
            ))}
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
          General tasks and plans require a configured model. Document jobs, page watches and
          spending summaries have guided workflows.
        </Text>
      )}
      <ErrorNotice error={error} />
      <Button
        primary
        busy={busy}
        disabled={
          !prompt.trim() ||
          (kind === "document" && !messageId) ||
          (kind === "finance" && !csv.trim())
        }
        onPress={() => void submit()}
      >
        Delegate task
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
        <Text style={[s.small, { flex: 1 }]}>From your goals, tasks, apps and interests</Text>
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
      View task
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
  const text = (task?.result || task?.question || "").replace(/[#*_`>]/g, "").replace(/\s+/g, " ");
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
      <SectionHead
        title="Tracking"
        tint={colors.greenDark}
        ring={dark ? "#0E3620" : "#DDF3E6"}
        onAdd={() => setAdding("Tracking")}
        addLabel="Track something new"
      />
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
          : "Your agent checks this public page on the server and saves meaningful changes in Notifications."}
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
      <TaskLink taskId={monitor.taskId} onOpen={onOpenTask} />
    </Card>
  );
}
export function NotificationsSheet() {
  const { data, mutate } = useAgentWorkspace();
  const { close, open } = useWorkspace();
  const [error, setError] = useState("");
  async function read(id: string, taskId?: string) {
    try {
      await mutate(`/notifications/${id}/read`, {});
      if (taskId) open({ type: "task", taskId });
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Sheet
      title="Notifications"
      subtitle="Results and decisions that need your attention."
      onClose={close}
    >
      <View style={{ gap: 14 }}>
        <ErrorNotice error={error} />
        {data?.notifications.map((item) => (
          <Card
            key={item.id}
            style={{ gap: 8, backgroundColor: item.read ? colors.card : colors.sky }}
          >
            <View style={s.between}>
              <Text style={s.heading}>{item.title}</Text>
              {!item.read && <Chip>New</Chip>}
            </View>
            <Text style={s.muted}>{item.body}</Text>
            <Text style={s.small}>{stamp(item.createdAt)}</Text>
            <Button small onPress={() => void read(item.id, item.taskId)}>
              {item.taskId ? "View task" : item.read ? "Read" : "Mark read"}
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
  const { navigate, open } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useAppsTab();
  const [name, setName] = useState(data?.identity.name || "Neddy");
  const [tone, setTone] = useState(data?.identity.tone || "warm");
  const [avatar, setAvatar] = useState(data?.identity.avatar || "sky");
  const [character, setCharacter] = useState(data?.identity.character || "neddy");
  const [showChatUpdates, setShowChatUpdates] = useState(data?.identity.showChatUpdates !== false);
  const [memory, setMemory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data?.identity) {
      setName(data.identity.name);
      setTone(data.identity.tone);
      setAvatar(data.identity.avatar || "sky");
      setCharacter(data.identity.character || "neddy");
      setShowChatUpdates(data.identity.showChatUpdates !== false);
    }
  }, [
    data?.identity.name,
    data?.identity.tone,
    data?.identity.avatar,
    data?.identity.character,
    data?.identity.avatarImageVersion,
    data?.identity.showChatUpdates,
  ]);
  async function save(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(path, body);
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
      title: "Agent computer",
      detail: "Persistent browser sessions",
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
      <AppsTabs tab={tab} onTab={setTab} badges={{ agent: data?.memorySuggestions.length }} />
      {tab === "apps" && (
        <>
          <Field
            label="Search apps"
            value={query}
            onChangeText={setQuery}
            placeholder="Search connectors"
          />
          <ConnectionsScreen query={query} />
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
        </>
      )}
      {tab === "alerts" && (
        <>
          <MailAlertsCard />
          <PhoneAppCard />
        </>
      )}
      {tab === "money" && (
        <>
          <SpendingCard />
          <UsageCard />
        </>
      )}
      {tab === "account" && (
        <>
          <AppearanceCard />
          <AccountCard />
          <YourDataCard />
          <PeopleCard />
        </>
      )}
      {tab === "help" && <HelpCard />}
      {tab === "agent" && (
        <>
          <Card style={{ gap: 10 }}>
            <SectionHeading title="Your agent" />
            <AvatarPicker
              character={character}
              color={avatar}
              onCharacter={setCharacter}
              onColor={setAvatar}
            />
            <Field label="Name" value={name} onChangeText={setName} />
            <View style={[s.row, { gap: 8 }]}>
              {(["warm", "concise", "thoughtful"] as const).map((item) => (
                <Button key={item} small primary={tone === item} onPress={() => setTone(item)}>
                  {statusLabel(item)}
                </Button>
              ))}
            </View>
            <CheckRow
              label="Show background updates in chat"
              checked={showChatUpdates}
              onPress={() => setShowChatUpdates(!showChatUpdates)}
            />
            <Text style={s.small}>
              Activity and notifications always keep the full record, including requests for
              approval.
            </Text>
            <Button
              busy={busy}
              disabled={!name.trim()}
              onPress={() =>
                void save("/identity", {
                  name: name.trim(),
                  tone,
                  avatar,
                  character,
                  showChatUpdates,
                })
              }
            >
              Save preferences
            </Button>
          </Card>
          <Card style={{ gap: 12 }}>
            <SectionHeading title="Memory" />
            <Text style={s.muted}>Context you can inspect, correct or forget.</Text>
            {!!data?.memorySuggestions.length && (
              <>
                <Text style={s.label}>Suggested from your conversations</Text>
                {data.memorySuggestions.map((item) => (
                  <SuggestionRow key={item.id} suggestion={item} />
                ))}
                <View style={s.divider} />
              </>
            )}
            {data?.memories.map((item) => (
              <MemoryRow key={item.id} memory={item} />
            ))}
            <Field
              label="Remember something about me"
              value={memory}
              onChangeText={setMemory}
              placeholder="I prefer morning meetings"
            />
            <Button
              busy={busy}
              disabled={!memory.trim()}
              onPress={() =>
                void save("/memories", { text: memory.trim(), source: "User added in Apps" })
              }
            >
              Remember
            </Button>
            <View style={s.divider} />
            <ChatgptImport />
          </Card>
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
/** Purchase guardrails: off by default, capped per purchase and per month. */
function SpendingCard() {
  const { api, notify } = useWorkspace();
  const [settings, setSettings] = useState<SpendingSettings>();
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
  }, [api]);
  if (!settings) return null;
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
          ? `Purchases through connected apps are on. Each one waits for your approval. $${settings.spentThisMonth.toFixed(2)} of $${settings.monthlyLimit.toFixed(2)} used this month.`
          : "Purchases are off. Turn them on to let your agent prepare orders and payments in connected apps, each waiting for your approval."}
      </Text>
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
          ? "This device gets a notification when a routine finishes, a task needs your details, or something is ready for review."
          : state === "install-first"
            ? "Notifications work once Neato_Muse is on your Home Screen."
            : state === "blocked"
              ? "Notifications are blocked for this site. Allow them in your browser settings, then come back."
              : state === "unsupported"
                ? "This browser can't show notifications from Neato_Muse."
                : "Get a notification when a routine finishes or something needs your review."}
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
function SuggestionRow({ suggestion }: { suggestion: MemorySuggestion }) {
  const { mutate } = useAgentWorkspace();
  const [text, setText] = useState(suggestion.text);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function decide(action: "keep" | "dismiss") {
    setBusy(true);
    setError("");
    try {
      await mutate(`/memory-suggestions/${suggestion.id}`, {
        action,
        ...(action === "keep" ? { text: text.trim() } : {}),
      });
    } catch (e) {
      setError(errorText(e));
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
        <Field label="Memory" value={text} onChangeText={setText} />
      ) : (
        <Text style={s.text}>{suggestion.text}</Text>
      )}
      {!!suggestion.reason && <Text style={s.small}>{suggestion.reason}</Text>}
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          primary
          busy={busy}
          disabled={!text.trim()}
          onPress={() => void decide("keep")}
        >
          Keep
        </Button>
        {!editing && (
          <Button small disabled={busy} onPress={() => setEditing(true)}>
            Edit
          </Button>
        )}
        <Button small disabled={busy} onPress={() => void decide("dismiss")}>
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
        {memory.source} · {stamp(memory.createdAt)}
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
