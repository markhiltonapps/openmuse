import type { LucideIcon } from "lucide-react-native";
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  CalendarClock,
  Check,
  FileText,
  Lock,
  Megaphone,
  MessageCircle,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { ActionProposal } from "../../../packages/domain/src/index";
import {
  type PlaybookPatch,
  type ScheduledPost,
  SOCIAL_APPS,
  type SocialPlaybook,
  type Space,
} from "../../../packages/domain/src/spaces";
import { useAgentWorkspace } from "./agent-workspace";
import { clockTime } from "./meal-checkins-ui";
import { parseDollars, parseTime } from "./space-input";
import { useMuseThread } from "./threads";
import {
  Button,
  Card,
  colors,
  dateLabel,
  Empty,
  ErrorNotice,
  Field,
  LinkRow,
  resultSummary,
  s,
} from "./ui";
import { useWorkspace } from "./workspace";

const SETUP_MESSAGE = "Let's set up my social media space.";

// One list of spaces for the whole app: the Spaces screen keeps it fresh, and the chat reads it
// to show which space a chat belongs to.
let cache: Space[] | undefined;
/** Posts in the app's own scheduler, for every space. */
let queue: ScheduledPost[] = [];
/** Why the list couldn't load, while there's nothing to show yet. */
let failure = "";
/** Saves on their way: a refresh meanwhile would show the old values for a moment. */
let inflight = 0;
const listeners = new Set<() => void>();
function publish(next: Space[]) {
  cache = next;
  failure = "";
  for (const listener of listeners) listener();
}
function fail(error: unknown) {
  failure = error instanceof Error ? error.message : String(error);
  for (const listener of listeners) listener();
}
function replace(space: Space) {
  publish((cache ?? []).map((item) => (item.id === space.id ? space : item)));
}
type Tab = "overview" | "playbook";
/** The space shown when Spaces opens, and its tab; kept across visits. */
let shown: string | undefined;
let lastTab: Tab = "overview";

export function useSpaces(poll = false) {
  const { api } = useWorkspace();
  const [, rerender] = useState(0);
  const load = useCallback(
    () =>
      Promise.all([
        api.request<Space[]>("/api/spaces"),
        api.request<ScheduledPost[]>("/api/spaces/posts").catch(() => queue),
      ]).then(([list, posts]) => {
        queue = posts;
        if (!inflight) publish(list);
      }),
    [api],
  );
  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    // Always fresh on arrival: the chat may have just filled in the playbook.
    void load().catch(cache ? () => undefined : fail);
    const timer = poll
      ? setInterval(() => {
          if (typeof document === "undefined" || document.visibilityState === "visible")
            void load().catch(cache ? () => undefined : fail);
        }, 4000)
      : undefined;
    return () => {
      listeners.delete(listener);
      if (timer) clearInterval(timer);
    };
  }, [load, poll]);
  return { spaces: cache, posts: queue, load, failure };
}

/** Opens a space's own chat, asking `text` there when given; a new space starts with setup. */
function useOpenChat() {
  const { select } = useMuseThread();
  const { ask } = useWorkspace();
  return useCallback(
    (space: Space, text?: string) => {
      select({ id: space.threadId, existing: space.threadStarted });
      const first = !space.threadStarted && !space.setupDone ? SETUP_MESSAGE : undefined;
      const message = text ?? first;
      if (message) ask(message);
    },
    [select, ask],
  );
}

/** Applies a playbook change the way the server does: null clears a value. */
function patched(playbook: SocialPlaybook, patch: PlaybookPatch): SocialPlaybook {
  const next: Record<string, unknown> = { ...playbook };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return next as unknown as SocialPlaybook;
}

/** Above a space's chat: which space this is, and the way back to it. Other chats show `children`. */
export function SpaceChip({ threadId, children }: { threadId: string; children?: ReactNode }) {
  const { spaces } = useSpaces();
  const { navigate } = useWorkspace();
  const space = spaces?.find((item) => item.threadId === threadId);
  if (!space) return <>{children}</>;
  return (
    <Pressable
      role="link"
      accessibilityLabel={`${space.name} space. Open its overview`}
      onPress={() => {
        shown = space.id;
        navigate("spaces");
      }}
      style={({ pressed }) => [
        s.row,
        {
          gap: 6,
          alignSelf: "center",
          marginBottom: 8,
          paddingHorizontal: 12,
          minHeight: 32,
          borderRadius: 16,
          backgroundColor: colors.lavender,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Megaphone size={14} color={colors.blueDark} />
      <Text style={[s.small, { color: colors.text, fontWeight: "600" }]}>{space.name} space</Text>
    </Pressable>
  );
}

const heading = (level: 2 | 3) => ({ role: "heading" as const, "aria-level": level });

export function SpacesScreen() {
  const { spaces, load, failure } = useSpaces(true);
  const { api } = useWorkspace();
  const { data } = useAgentWorkspace();
  const agentName = data?.identity.name || "Neddy";
  const [, rerender] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setBusy(true);
    setError("");
    try {
      const space = await api.request<Space>("/api/spaces", {});
      shown = space.id;
      lastTab = "overview";
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const show = (id?: string) => {
    shown = id;
    lastTab = "overview";
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
  const space =
    spaces.find((item) => item.id === shown) ?? (spaces.length === 1 ? spaces[0] : undefined);
  if (space)
    return (
      <SpaceView
        key={space.id}
        space={space}
        agentName={agentName}
        onBack={spaces.length > 1 ? () => show(undefined) : undefined}
        onRemoved={() => show(undefined)}
      />
    );
  return (
    <View style={{ gap: 16 }}>
      <ErrorNotice error={error} />
      {spaces.length ? (
        <Card style={{ gap: 4 }}>
          {spaces.map((item) => (
            <LinkRow
              key={item.id}
              icon={Megaphone}
              tint={colors.lavender}
              title={item.name}
              detail={item.setupDone ? `Run by ${agentName}` : "Not set up yet"}
              onPress={() => show(item.id)}
            />
          ))}
        </Card>
      ) : (
        <Empty
          icon={Megaphone}
          title={`Hand an area of your life to ${agentName}`}
          detail={`Start with social media. ${agentName} learns your brand, keeps an eye on competitors and drafts your posts, and nothing goes out without your OK.`}
        >
          <Button primary icon={Plus} busy={busy} onPress={() => void start()}>
            Start a social media space
          </Button>
        </Empty>
      )}
      {!!spaces.length && (
        <Button
          icon={Plus}
          busy={busy}
          style={{ alignSelf: "flex-start" }}
          onPress={() => void start()}
        >
          New social media space
        </Button>
      )}
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
  const [tab, setTabState] = useState<Tab>(lastTab);
  const setTab = (next: Tab) => {
    lastTab = next;
    setTabState(next);
  };
  const openChat = useOpenChat();
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
            ? `Run by ${agentName}. Nothing posts or costs you money without your OK.`
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
        {tab === "overview" ? (
          <Overview space={space} agentName={agentName} />
        ) : (
          <Playbook space={space} agentName={agentName} onRemoved={onRemoved} />
        )}
      </View>
    </View>
  );
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const appOf = (action: ActionProposal) =>
  typeof action.data.app === "string" ? action.data.app : "";
/** "IG", "in", "FB"… for an app badge. */
function appBadge(app: string) {
  const known: Record<string, string> = {
    instagram: "IG",
    facebook: "FB",
    linkedin: "in",
    youtube: "YT",
    tiktok: "TT",
    twitter: "X",
    postiz: "Po",
    higgsfield: "Hf",
  };
  const key = Object.keys(known).find((name) => app.toLowerCase().includes(name));
  return key ? (known[key] ?? "") : /meta/i.test(app) ? "Ads" : app.slice(0, 2);
}

function Overview({ space, agentName }: { space: Space; agentName: string }) {
  const { workspace, open, navigate, api } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const openChat = useOpenChat();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const waiting = workspace.actions.filter(
    (action) =>
      action.status === "awaiting_review" &&
      action.kind === "app.action" &&
      SOCIAL_APPS.test(appOf(action)),
  );
  const { posts, load } = useSpaces();
  const mine = posts.filter((post) => post.spaceId === space.id);
  const toApprove = mine.filter((post) => post.status === "awaiting_review");
  const needs = toApprove.length + waiting.length;
  const routine = data?.routines.find((item) => item.id === space.digestRoutineId);
  const digest = data?.tasks.find((task) => task.id === routine?.lastTaskId);
  const decide = (post: ScheduledPost, choice: "approve" | "cancel") =>
    run(`${choice}:${post.id}`, async () => {
      await api.request(`/api/spaces/posts/${post.id}/${choice}`, { hash: post.hash });
      await load();
    });
  async function run(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  const digestOn = () =>
    run("digest", async () =>
      replace(await api.request<Space>(`/api/spaces/${space.id}/digest`, { on: true })),
    );
  const done = () =>
    run("done", async () =>
      replace(await api.request<Space>(`/api/spaces/${space.id}/playbook`, { setupDone: true })),
    );
  return (
    <View style={{ gap: 26 }}>
      <ErrorNotice error={error} />
      {!space.setupDone && (
        <Card style={{ gap: 12, backgroundColor: colors.sky, borderColor: colors.sky }}>
          <Text {...heading(3)} style={s.heading}>
            {space.threadStarted ? "Finish setting up" : `Set up with ${agentName}`}
          </Text>
          <Text style={[s.text, { color: colors.mutedStrong }]}>
            {agentName} asks a few quick questions, reads your brand guide or website, finds
            competitors for each product and suggests how often to post. You don’t need to know
            anything about social media.
          </Text>
          <Text style={[s.muted, { color: colors.mutedStrong }]}>
            Have a brand guide? Add it to Files & media first and {agentName} will read it.
          </Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button primary icon={MessageCircle} onPress={() => openChat(space)}>
              {space.threadStarted ? "Continue in chat" : "Start setup"}
            </Button>
            <Button icon={FileText} onPress={() => navigate("files")}>
              Add a brand guide
            </Button>
            {space.threadStarted && (
              <Button icon={Check} busy={busy === "done"} onPress={() => void done()}>
                I’m done setting up
              </Button>
            )}
          </View>
        </Card>
      )}

      <View style={{ gap: 10 }}>
        <View style={[s.row, { gap: 8 }]}>
          <Text {...heading(3)} style={s.heading}>
            Needs you
          </Text>
          {needs > 0 && (
            <View
              style={{
                paddingHorizontal: 9,
                paddingVertical: 2,
                borderRadius: 10,
                backgroundColor: colors.lavender,
              }}
            >
              <Text style={[s.small, { color: colors.text, fontWeight: "600" }]}>{needs}</Text>
            </View>
          )}
        </View>
        {needs ? (
          <Card style={{ gap: 2, paddingVertical: 6 }}>
            {toApprove.map((post, index) => {
              const due = Date.parse(post.postAt) <= Date.now();
              return (
                <QueueRow
                  key={post.id}
                  first={index === 0}
                  app={post.app}
                  title={post.summary}
                  detail={
                    due
                      ? "Its time has passed: it goes out once you approve"
                      : `Goes out ${when(post.postAt)}`
                  }
                >
                  <Button
                    small
                    primary
                    busy={busy === `approve:${post.id}`}
                    accessibilityLabel={`Approve: ${post.summary}`}
                    onPress={() => void decide(post, "approve")}
                  >
                    {due ? "Approve and post" : "Approve"}
                  </Button>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove: ${post.summary}`}
                    onPress={() => void decide(post, "cancel")}
                    style={{
                      width: 44,
                      height: 44,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <X size={16} color={colors.muted} />
                  </Pressable>
                </QueueRow>
              );
            })}
            {waiting.map((action, index) => (
              <QueueRow
                key={action.id}
                first={!toApprove.length && index === 0}
                app={appOf(action)}
                title={action.title}
                detail={
                  typeof action.data.amountUsd === "number"
                    ? `Spends up to $${action.data.amountUsd}`
                    : undefined
                }
              >
                <Button
                  small
                  primary
                  accessibilityLabel={`Review: ${action.title}`}
                  onPress={() => open({ type: "review", action })}
                >
                  Review
                </Button>
              </QueueRow>
            ))}
          </Card>
        ) : (
          <Text style={s.muted}>
            Nothing waiting. Posts and ads {agentName} drafts wait here for your OK.
          </Text>
        )}
      </View>

      <ComingUp posts={mine} busy={busy} onCancel={(post) => void decide(post, "cancel")} />

      <View style={{ gap: 10 }}>
        <Text {...heading(3)} style={s.heading}>
          Weekly digest
        </Text>
        {routine ? (
          <Card style={{ gap: 10 }}>
            <View style={[s.row, { gap: 10 }]}>
              <CalendarClock size={18} color={colors.blueDark} />
              <Text style={[s.text, { flex: 1 }]}>
                {DAY_NAMES[routine.days[0] ?? 1]}s at {clockTime(routine.time)}
                {routine.nextRunAt ? ` · next ${dateLabel(routine.nextRunAt)}` : ""}
              </Text>
            </View>
            {digest ? (
              <>
                <Text numberOfLines={6} style={[s.text, { color: colors.mutedStrong }]}>
                  {digest.result
                    ? resultSummary(digest.result)
                    : digest.status === "running" || digest.status === "queued"
                      ? "Working on this week’s digest…"
                      : (digest.question ?? "This week’s digest needs you.")}
                </Text>
                <Button
                  small
                  style={{ alignSelf: "flex-start" }}
                  onPress={() => open({ type: "task", taskId: digest.id })}
                >
                  Open the digest
                </Button>
              </>
            ) : (
              <Text style={s.muted}>
                Your first one comes {DAY_NAMES[routine.days[0] ?? 1]}: what competitors posted, how
                you did and next week’s drafts.
              </Text>
            )}
            <Button
              small
              busy={busy === "now"}
              style={{ alignSelf: "flex-start" }}
              onPress={() => void run("now", () => mutate(`/routines/${routine.id}/run`, {}))}
            >
              Make one now
            </Button>
          </Card>
        ) : (
          <Card style={{ gap: 10 }}>
            <Text style={[s.text, { color: colors.mutedStrong }]}>
              Once a week: what competitors posted, how you did and next week’s drafts waiting for
              your OK.
            </Text>
            <Button
              primary={space.setupDone}
              small
              busy={busy === "digest"}
              style={{ alignSelf: "flex-start" }}
              onPress={() => void digestOn()}
            >
              Turn on for Mondays at 8:45 AM
            </Button>
          </Card>
        )}
      </View>

      <SavedQuestions space={space} onAsk={(text) => openChat(space, text)} />
    </View>
  );
}

/** "Tue, Oct 7, 10:00 AM" */
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** A post or action in a list: app badge, what it is, a detail line, and its buttons. */
function QueueRow({
  first,
  app,
  title,
  detail,
  children,
}: {
  first: boolean;
  app: string;
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <View
      style={[
        s.row,
        {
          gap: 12,
          minHeight: 60,
          flexWrap: "wrap",
          borderTopWidth: first ? 0 : 1,
          borderColor: colors.line,
        },
      ]}
    >
      <View
        aria-hidden
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.sky,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>{appBadge(app)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 170, gap: 2, paddingVertical: 8 }}>
        <Text numberOfLines={3} style={[s.text, { fontWeight: "500" }]}>
          {title}
        </Text>
        {!!detail && <Text style={[s.small, { color: colors.mutedStrong }]}>{detail}</Text>}
      </View>
      {/* On a narrow screen the buttons go under the text instead of squeezing it. */}
      {children && (
        <View style={[s.row, { gap: 4, marginLeft: "auto", paddingBottom: 4 }]}>{children}</View>
      )}
    </View>
  );
}

/** Approved posts waiting for their day, and what went out (or didn't) this past week. */
function ComingUp({
  posts,
  busy,
  onCancel,
}: {
  posts: ScheduledPost[];
  busy: string;
  onCancel: (post: ScheduledPost) => void;
}) {
  const week = Date.now() - 7 * 86_400_000;
  const upcoming = posts.filter((post) => post.status === "scheduled" || post.status === "posting");
  const recent = posts
    .filter(
      (post) =>
        (post.status === "posted" || post.status === "failed") &&
        Date.parse(post.postedAt ?? post.postAt) >= week,
    )
    .reverse();
  if (!upcoming.length && !recent.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <Text {...heading(3)} style={s.heading}>
        Coming up
      </Text>
      <Card style={{ gap: 2, paddingVertical: 6 }}>
        {upcoming.map((post, index) => (
          <QueueRow
            key={post.id}
            first={index === 0}
            app={post.app}
            title={post.summary}
            detail={post.status === "posting" ? "Posting now…" : when(post.postAt)}
          >
            {post.status === "scheduled" && (
              <Button
                small
                busy={busy === `cancel:${post.id}`}
                accessibilityLabel={`Cancel: ${post.summary}`}
                onPress={() => onCancel(post)}
              >
                Cancel
              </Button>
            )}
          </QueueRow>
        ))}
        {recent.map((post, index) => (
          <QueueRow
            key={post.id}
            first={!upcoming.length && index === 0}
            app={post.app}
            title={post.summary}
            detail={
              post.status === "posted"
                ? `Posted ${when(post.postedAt ?? post.postAt)}`
                : `Didn’t go out: ${post.error ?? "unknown problem"}`
            }
          />
        ))}
      </Card>
    </View>
  );
}

const BLANK = /\[([^\]]*)\]/g;
const hasBlanks = (text: string) => /\[[^\]]*\]/.test(text);
const unique = (items: string[]) => [...new Set(items)];

/** Fills in a saved question's [blanks], one labelled box each, with the playbook's names to tap. */
function FillIn({
  text,
  space,
  onAsk,
  onCancel,
}: {
  text: string;
  space: Space;
  onAsk: (text: string) => void;
  onCancel: () => void;
}) {
  // Each blank is known by where it sits in the question.
  const blanks = [...text.matchAll(BLANK)].map((match) => ({
    label: match[1]?.trim() || "word",
    at: match.index,
  }));
  const [values, setValues] = useState(blanks.map(() => ""));
  const clean = (value: string) => value.replace(/[[\]]/g, "").trim();
  const ready = values.every((value) => clean(value));
  const suggestions = (label: string) =>
    /competitor/i.test(label)
      ? unique(space.playbook.products.flatMap((product) => product.competitors))
      : /product/i.test(label)
        ? space.playbook.products.map((product) => product.name)
        : [];
  const set = (index: number, value: string) =>
    setValues((current) => current.map((item, i) => (i === index ? value : item)));
  const ask = () => {
    let index = 0;
    onAsk(text.replace(BLANK, () => clean(values[index++] ?? "")));
  };
  return (
    <Card style={{ gap: 12 }}>
      <Text style={s.text}>{text}</Text>
      {blanks.map(({ label, at }, index) => (
        <View key={at} style={{ gap: 8 }}>
          <TightField
            label={label.charAt(0).toUpperCase() + label.slice(1)}
            value={values[index]}
            onChangeText={(value) => set(index, value)}
            autoFocus={index === 0}
          />
          {suggestions(label).length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {suggestions(label)
                .slice(0, 8)
                .map((name) => (
                  <Button
                    key={name}
                    small
                    selected={clean(values[index] ?? "") === name}
                    onPress={() => set(index, name)}
                  >
                    {name}
                  </Button>
                ))}
            </View>
          )}
        </View>
      ))}
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button small primary icon={Send} disabled={!ready} onPress={ask}>
          Ask
        </Button>
        <Button small onPress={onCancel}>
          Cancel
        </Button>
        {!ready && <Text style={s.small}>Fill in each box to ask.</Text>}
      </View>
    </Card>
  );
}

function SavedQuestions({ space, onAsk }: { space: Space; onAsk: (text: string) => void }) {
  const { api } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [filling, setFilling] = useState<string>();
  const [adding, setAdding] = useState("");
  const [removed, setRemoved] = useState<string>();
  const [error, setError] = useState("");
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  async function change(work: () => Promise<Space>) {
    setError("");
    try {
      replace(await work());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const remove = (id: string, text: string) =>
    change(async () => {
      const saved = await api.request<Space>(`/api/spaces/${space.id}/prompts/${id}/delete`, {});
      setRemoved(text);
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setRemoved(undefined), 6000);
      return saved;
    });
  const add = (text: string) =>
    change(() => api.request<Space>(`/api/spaces/${space.id}/prompts`, { text }));
  const question = space.prompts.find((prompt) => prompt.id === filling);
  return (
    <View style={{ gap: 10 }}>
      <View style={s.between}>
        <Text {...heading(3)} style={s.heading}>
          Saved questions
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit saved questions"
          aria-pressed={editing}
          onPress={() => setEditing(!editing)}
          style={{
            minHeight: 44,
            marginVertical: -12,
            justifyContent: "center",
            paddingHorizontal: 4,
          }}
        >
          <Text style={[s.text, { color: colors.blueDark, fontWeight: "500" }]}>
            {editing ? "Done" : "Edit"}
          </Text>
        </Pressable>
      </View>
      <Text style={s.muted}>Tap one to ask it in this space’s chat.</Text>
      <ErrorNotice error={error} />
      {!!removed && (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Text style={[s.muted, { flexShrink: 1 }]}>Removed “{removed}”.</Text>
          <Button
            small
            onPress={() => {
              const text = removed;
              setRemoved(undefined);
              void add(text);
            }}
          >
            Undo
          </Button>
        </View>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {space.prompts.map((prompt) =>
          editing ? (
            <View
              key={prompt.id}
              style={[
                s.row,
                {
                  paddingLeft: 14,
                  minHeight: 44,
                  maxWidth: "100%",
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: colors.card,
                },
              ]}
            >
              <Text style={[s.text, { fontSize: 14, flexShrink: 1, paddingVertical: 8 }]}>
                {prompt.text}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove “${prompt.text}”`}
                onPress={() => void remove(prompt.id, prompt.text)}
                style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
              >
                <X size={14} color={colors.muted} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              key={prompt.id}
              accessibilityRole="button"
              accessibilityLabel={prompt.text}
              onPress={() => (hasBlanks(prompt.text) ? setFilling(prompt.id) : onAsk(prompt.text))}
              style={({ pressed }) => [
                s.row,
                {
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  minHeight: 44,
                  maxWidth: "100%",
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: filling === prompt.id ? colors.blueDark : colors.line,
                  backgroundColor: colors.card,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={[s.text, { fontSize: 14, flexShrink: 1 }]}>{prompt.text}</Text>
            </Pressable>
          ),
        )}
      </View>
      {question && !editing && (
        <FillIn
          key={question.id}
          text={question.text}
          space={space}
          onCancel={() => setFilling(undefined)}
          onAsk={(text) => {
            setFilling(undefined);
            onAsk(text);
          }}
        />
      )}
      {editing && (
        <View style={[s.row, { gap: 8, alignItems: "flex-end" }]}>
          <View style={{ flex: 1 }}>
            <TightField
              label="Save a new question"
              placeholder="e.g. What did [competitor] post this week?"
              value={adding}
              onChangeText={setAdding}
            />
          </View>
          <Button
            icon={Plus}
            disabled={!adding.trim()}
            onPress={() => {
              const text = adding;
              setAdding("");
              void add(text);
            }}
          >
            Save
          </Button>
        </View>
      )}
    </View>
  );
}

const PLATFORMS = [
  "Instagram",
  "Facebook",
  "LinkedIn",
  "TikTok",
  "YouTube",
  "X",
  "Threads",
  "Pinterest",
];
/** "X" alone is ambiguous next to remove buttons. */
const platformName = (name: string) => (name === "X" ? "X (Twitter)" : name);
const pad = (n: number) => String(n).padStart(2, "0");
/** Today plus `days`, as YYYY-MM-DD in the person's own time zone. */
function localDay(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
/** A real calendar day after today. */
function futureDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    value.trim() > localDay(0)
  );
}
const dayInWords = (value: string) => {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};
const dollars = (amount: number) =>
  amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount % 1 ? 2 : 0,
  });

type Save = (section: string, patch: PlaybookPatch, removed?: string) => Promise<boolean>;

function Playbook({
  space,
  agentName,
  onRemoved,
}: {
  space: Space;
  agentName: string;
  onRemoved: () => void;
}) {
  const { api, notify } = useWorkspace();
  const openChat = useOpenChat();
  const book = space.playbook;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState("");
  const [undo, setUndo] = useState<{ section: string; label: string; patch: PlaybookPatch }>();
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  /** Saves at once on screen, then on the server; a removal can be undone for a few seconds. */
  const save: Save = async (section, patch, removed) => {
    const before = cache?.find((item) => item.id === space.id) ?? space;
    const restore = Object.fromEntries(
      Object.keys(patch).map((key) => [key, before.playbook[key as keyof SocialPlaybook] ?? null]),
    ) as PlaybookPatch;
    setSaving(section);
    setErrors((current) => ({ ...current, [section]: "" }));
    inflight++;
    replace({ ...before, playbook: patched(before.playbook, patch) });
    try {
      replace(await api.request<Space>(`/api/spaces/${space.id}/playbook`, patch));
      if (removed) {
        setUndo({ section, label: removed, patch: restore });
        clearTimeout(undoTimer.current);
        undoTimer.current = setTimeout(() => setUndo(undefined), 6000);
      }
      return true;
    } catch (e) {
      replace(before);
      setErrors((current) => ({
        ...current,
        [section]: e instanceof Error ? e.message : String(e),
      }));
      return false;
    } finally {
      inflight--;
      setSaving("");
    }
  };
  const section = (id: string) => ({
    error: errors[id],
    undo:
      undo?.section === id
        ? {
            label: undo.label,
            onUndo: () => {
              setUndo(undefined);
              void save(id, undo.patch);
            },
          }
        : undefined,
  });
  const empty = !book.products.length && !book.platforms.length && !book.voice;
  return (
    <View style={{ gap: 16 }}>
      <Text style={s.muted}>
        What {agentName} follows every time. It fills in during setup, and you can change anything
        here.
      </Text>
      {empty && (
        <Card style={{ gap: 10, backgroundColor: colors.sky, borderColor: colors.sky }}>
          <Text style={s.text}>Nothing here yet. It fills in as you set the space up.</Text>
          <Button
            small
            primary
            icon={MessageCircle}
            style={{ alignSelf: "flex-start" }}
            onPress={() => openChat(space)}
          >
            {space.threadStarted ? "Continue in chat" : `Set up with ${agentName}`}
          </Button>
        </Card>
      )}
      <Plan space={space} agentName={agentName} />
      <Products space={space} save={save} {...section("products")} />
      <Audience space={space} save={save} {...section("audience")} />
      <Platforms space={space} save={save} {...section("platforms")} />
      <Themes space={space} save={save} {...section("themes")} />
      <Voice
        space={space}
        save={async (id, patch, removed) => {
          const ok = await save(id, patch, removed);
          if (ok && !removed && "voice" in patch) notify("Saved");
          return ok;
        }}
        {...section("voice")}
      />
      <Rhythm space={space} save={save} saving={saving === "rhythm"} {...section("rhythm")} />
      <Money
        space={space}
        save={async (id, patch) => {
          const ok = await save(id, patch);
          if (ok) notify("Saved");
          return ok;
        }}
        {...section("money")}
      />
      <Digest space={space} />
      <RemoveSpace space={space} onRemoved={onRemoved} />
    </View>
  );
}

interface SectionState {
  error?: string;
  undo?: { label: string; onUndo: () => void };
}

function Section({
  title,
  error,
  undo,
  children,
}: SectionState & { title: string; children: ReactNode }) {
  return (
    <Card style={{ gap: 12 }}>
      <Text {...heading(3)} style={s.heading}>
        {title}
      </Text>
      <ErrorNotice error={error} />
      {undo && (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Text style={[s.muted, { flexShrink: 1 }]}>Removed “{undo.label}”.</Text>
          <Button small onPress={undo.onUndo}>
            Undo
          </Button>
        </View>
      )}
      {children}
    </Card>
  );
}

/** A Field without its own bottom margin, so the gap of the group around it is the only space. */
function TightField(props: Parameters<typeof Field>[0]) {
  return (
    <View style={{ marginBottom: -16 }}>
      <Field {...props} />
    </View>
  );
}

/** A chip with a remove button, for competitors and never-do rules. */
function Removable({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View
      style={[
        s.row,
        {
          gap: 2,
          paddingLeft: 12,
          borderRadius: 20,
          backgroundColor: colors.subtle,
          minHeight: 40,
          maxWidth: "100%",
        },
      ]}
    >
      <Text style={[s.text, { fontSize: 14, flexShrink: 1, paddingVertical: 8 }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${label}`}
        onPress={onRemove}
        style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
      >
        <X size={14} color={colors.muted} />
      </Pressable>
    </View>
  );
}

/** A one-line box with an Add button; `taken` names can't be added twice. */
function AddLine({
  label,
  placeholder,
  taken,
  onAdd,
}: {
  label: string;
  placeholder: string;
  taken: string[];
  onAdd: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const duplicate = taken.some((name) => name.toLowerCase() === text.trim().toLowerCase());
  const add = () => {
    if (!text.trim() || duplicate) return;
    onAdd(text.trim());
    setText("");
  };
  return (
    <View style={{ gap: 4 }}>
      <View style={[s.row, { gap: 8 }]}>
        <TextInput
          accessibilityLabel={label}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          style={[s.input, { flex: 1, minWidth: 0, minHeight: 44 }]}
        />
        <Button small icon={Plus} disabled={!text.trim() || duplicate} onPress={add}>
          Add
        </Button>
      </View>
      {duplicate && <Text style={s.small}>Already on the list.</Text>}
    </View>
  );
}

function Products({ space, save, ...state }: SectionState & { space: Space; save: Save }) {
  const products = space.playbook.products;
  const [confirming, setConfirming] = useState<string>();
  const set = (next: typeof products, removed?: string) =>
    void save("products", { products: next }, removed);
  return (
    <Section title="Products and competitors" {...state}>
      {!products.length && <Text style={s.muted}>No products yet.</Text>}
      {products.map((product, index) => (
        <View
          key={product.name}
          style={{
            gap: 8,
            paddingTop: index ? 12 : 0,
            borderTopWidth: index ? 1 : 0,
            borderColor: colors.line,
          }}
        >
          <View style={[s.row, { gap: 8 }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.text, { fontWeight: "600" }]}>{product.name}</Text>
              {!!product.about && <Text style={s.muted}>{product.about}</Text>}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${product.name}`}
              onPress={() => setConfirming(product.name)}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <X size={16} color={colors.muted} />
            </Pressable>
          </View>
          {confirming === product.name && (
            <View
              style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.errorBg }}
            >
              <Text style={s.text}>
                Remove {product.name}
                {product.competitors.length
                  ? ` and its ${product.competitors.length} competitor${product.competitors.length === 1 ? "" : "s"}`
                  : ""}
                ?
              </Text>
              <View style={[s.row, { gap: 8 }]}>
                <Button small onPress={() => setConfirming(undefined)}>
                  Cancel
                </Button>
                <Button
                  small
                  danger
                  icon={Trash2}
                  onPress={() => {
                    setConfirming(undefined);
                    set(
                      products.filter((_, i) => i !== index),
                      product.name,
                    );
                  }}
                >
                  Remove
                </Button>
              </View>
            </View>
          )}
          {product.competitors.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {product.competitors.map((name) => (
                <Removable
                  key={name}
                  label={name}
                  onRemove={() =>
                    set(
                      products.map((p, i) =>
                        i === index
                          ? { ...p, competitors: p.competitors.filter((c) => c !== name) }
                          : p,
                      ),
                      name,
                    )
                  }
                />
              ))}
            </View>
          )}
          {product.competitors.length < 8 && (
            <AddLine
              label={`Add a competitor for ${product.name}`}
              placeholder="Add a competitor"
              taken={product.competitors}
              onAdd={(name) =>
                set(
                  products.map((p, i) =>
                    i === index ? { ...p, competitors: [...p.competitors, name] } : p,
                  ),
                )
              }
            />
          )}
        </View>
      ))}
      <View
        style={
          products.length
            ? { paddingTop: 12, borderTopWidth: 1, borderColor: colors.line }
            : undefined
        }
      >
        <AddLine
          label="Add a product"
          placeholder="Add a product"
          taken={products.map((p) => p.name)}
          onAdd={(name) => set([...products, { name, about: "", competitors: [] }])}
        />
      </View>
    </Section>
  );
}

function Platforms({ space, save, ...state }: SectionState & { space: Space; save: Save }) {
  const platforms = space.playbook.platforms;
  const set = (next: string[], removed?: string) =>
    void save("platforms", { platforms: next }, removed);
  const more = PLATFORMS.filter((name) => !platforms.includes(name));
  return (
    <Section title="Where to post, most important first" {...state}>
      {!platforms.length && <Text style={s.muted}>None chosen yet.</Text>}
      {platforms.map((name, index) => (
        <View key={name} style={[s.row, { gap: 10, minHeight: 44 }]}>
          <Text style={[s.muted, { width: 20 }]}>{index + 1}</Text>
          <Text style={[s.text, { flex: 1 }]}>{platformName(name)}</Text>
          {index > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Move ${platformName(name)} up`}
              onPress={() => {
                const next = [...platforms];
                next.splice(index - 1, 2, name, platforms[index - 1] as string);
                set(next);
              }}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <ArrowUp size={16} color={colors.text} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${platformName(name)}`}
            onPress={() =>
              set(
                platforms.filter((p) => p !== name),
                platformName(name),
              )
            }
            style={{
              width: 44,
              height: 44,
              marginLeft: 8,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={16} color={colors.muted} />
          </Pressable>
        </View>
      ))}
      {more.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {more.map((name) => (
            <Button key={name} small icon={Plus} onPress={() => set([...platforms, name])}>
              {platformName(name)}
            </Button>
          ))}
        </View>
      )}
      <Scheduling space={space} save={save} />
    </Section>
  );
}

const SCHEDULERS = ["Postiz", "Buffer", "Hootsuite"];

/** Which app queues approved posts for their day: this app's own scheduler, or one they use. */
function Scheduling({ space, save }: { space: Space; save: Save }) {
  const { navigate } = useWorkspace();
  const scheduler = space.playbook.scheduler;
  return (
    <View
      style={{ gap: 8, marginTop: 4, paddingTop: 12, borderTopWidth: 1, borderColor: colors.line }}
    >
      <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>Scheduling</Text>
      <Text style={s.muted}>
        {scheduler
          ? `Approved posts wait in ${scheduler} and go out on their day.`
          : "Built in: approved posts go out from here on their day, even when you’re not chatting. Nothing else to set up."}
      </Text>
      <View
        role="group"
        aria-label="Scheduler app"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
      >
        <Button
          small
          selected={!scheduler}
          primary={!scheduler}
          onPress={() => void save("platforms", { scheduler: null })}
        >
          Built in
        </Button>
        {SCHEDULERS.map((name) => (
          <Button
            key={name}
            small
            selected={scheduler === name}
            primary={scheduler === name}
            onPress={() => void save("platforms", { scheduler: name })}
          >
            {name}
          </Button>
        ))}
      </View>
      <Pressable
        role="link"
        onPress={() => navigate("apps")}
        style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}
      >
        <Text style={[s.text, { fontSize: 14, color: colors.blueDark }]}>
          Already use one of these? Connect it in Apps
        </Text>
      </Pressable>
    </View>
  );
}

const PLAN_REQUEST = "Please write a fresh plan for my social media.";

/** The agent's plan, where things stood at the start, and a way to ask for a fresh one. */
function Plan({ space, agentName }: { space: Space; agentName: string }) {
  const openChat = useOpenChat();
  const [all, setAll] = useState(false);
  const { plan, baseline } = space.playbook;
  // Lines wrap on a phone, so a plan over a few hundred characters gets the whole-plan button.
  const long = (plan?.split("\n").length ?? 0) > 8 || (plan?.length ?? 0) > 400;
  return (
    <Section title="The plan">
      {plan ? (
        <Text numberOfLines={all ? undefined : 12} style={s.text}>
          {plan}
        </Text>
      ) : (
        <Text style={s.muted}>
          No plan yet. {agentName} writes one right after setup: what to aim for in the next 90
          days, what to post about, and where.
        </Text>
      )}
      {!!plan && long && (
        <Button small style={{ alignSelf: "flex-start" }} onPress={() => setAll(!all)}>
          {all ? "Show less" : "Show the whole plan"}
        </Button>
      )}
      {!!baseline && (
        <Text style={[s.muted, { color: colors.mutedStrong }]}>Where you started: {baseline}</Text>
      )}
      {(space.setupDone || !!plan) && (
        <Button
          small
          icon={MessageCircle}
          style={{ alignSelf: "flex-start" }}
          onPress={() => openChat(space, PLAN_REQUEST)}
        >
          {plan ? "Ask for a fresh plan" : "Ask for a plan"}
        </Button>
      )}
    </Section>
  );
}

const GOALS = [
  "More customers or sales",
  "Getting known",
  "Being seen as the expert",
  "Keeping customers happy",
  "More sign-ups",
];

/** Who the posts are for, and what social media should do for the business. */
function Audience({ space, save, ...state }: SectionState & { space: Space; save: Save }) {
  const book = space.playbook;
  const goals = book.goals ?? [];
  const [audience, setAudience] = useState(book.audience ?? "");
  useEffect(() => setAudience(book.audience ?? ""), [book.audience]);
  const changed = audience.trim() !== (book.audience ?? "");
  const toggle = (goal: string) =>
    void save("audience", {
      goals: goals.includes(goal) ? goals.filter((g) => g !== goal) : [...goals, goal],
    });
  return (
    <Section title="Who it’s for, and what it’s for" {...state}>
      <TightField
        label="Who buys from you: their job or situation, their problems, where they are online"
        multiline
        value={audience}
        onChangeText={setAudience}
        onBlur={() => {
          if (changed) void save("audience", { audience: audience.trim() || null });
        }}
      />
      {changed && (
        <Button
          small
          primary
          style={{ alignSelf: "flex-start" }}
          onPress={() => void save("audience", { audience: audience.trim() || null })}
        >
          Save
        </Button>
      )}
      <View style={{ gap: 8, marginTop: 4 }}>
        <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>
          What social media should do for you
        </Text>
        <View
          role="group"
          aria-label="Goals"
          style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
        >
          {[...GOALS, ...goals.filter((goal) => !GOALS.includes(goal))].map((goal) => (
            <Button
              key={goal}
              small
              selected={goals.includes(goal)}
              primary={goals.includes(goal)}
              icon={goals.includes(goal) ? Check : undefined}
              onPress={() => toggle(goal)}
            >
              {goal}
            </Button>
          ))}
        </View>
      </View>
    </Section>
  );
}

/** The themes posts are built on. */
function Themes({ space, save, ...state }: SectionState & { space: Space; save: Save }) {
  const pillars = space.playbook.pillars ?? [];
  return (
    <Section title="What to post about" {...state}>
      <Text style={s.muted}>
        A few themes every post fits into, built on your buyers’ problems and what competitors miss.
      </Text>
      {pillars.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {pillars.map((pillar) => (
            <Removable
              key={pillar}
              label={pillar}
              onRemove={() =>
                void save("themes", { pillars: pillars.filter((p) => p !== pillar) }, pillar)
              }
            />
          ))}
        </View>
      )}
      {pillars.length < 8 && (
        <AddLine
          label="Add a theme"
          placeholder="e.g. Behind the scenes"
          taken={pillars}
          onAdd={(pillar) => void save("themes", { pillars: [...pillars, pillar] })}
        />
      )}
    </Section>
  );
}

function Voice({ space, save, ...state }: SectionState & { space: Space; save: Save }) {
  const book = space.playbook;
  const [voice, setVoice] = useState(book.voice);
  useEffect(() => setVoice(book.voice), [book.voice]);
  const changed = voice.trim() !== book.voice;
  return (
    <Section title="Voice and rules" {...state}>
      {book.brandFileName ? (
        <View style={[s.row, { gap: 8 }]}>
          <FileText size={16} color={colors.muted} />
          <Text style={[s.muted, { flex: 1 }]}>From your brand guide: {book.brandFileName}</Text>
        </View>
      ) : null}
      <TightField
        label="How you sound"
        multiline
        value={voice}
        onChangeText={setVoice}
        onBlur={() => {
          if (changed) void save("voice", { voice: voice.trim() });
        }}
      />
      {changed && (
        <Button
          small
          primary
          style={{ alignSelf: "flex-start" }}
          onPress={() => void save("voice", { voice: voice.trim() })}
        >
          Save
        </Button>
      )}
      <View style={{ gap: 8, marginTop: 4 }}>
        <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>Never say or do</Text>
        {book.avoid.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {book.avoid.map((rule) => (
              <Removable
                key={rule}
                label={rule}
                onRemove={() =>
                  void save("voice", { avoid: book.avoid.filter((r) => r !== rule) }, rule)
                }
              />
            ))}
          </View>
        )}
        <AddLine
          label="Add something never to say or do"
          placeholder="e.g. No health claims"
          taken={book.avoid}
          onAdd={(rule) => void save("voice", { avoid: [...book.avoid, rule] })}
        />
      </View>
    </Section>
  );
}

/** A number with − and + buttons; quick taps add up and save once they stop. */
function Stepper({
  label,
  value,
  max,
  busy,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  busy: boolean;
  onChange: (value: number) => void;
}) {
  const [shown, setShown] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!timer.current) setShown(value);
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const step = (by: number) => {
    const next = Math.min(max, Math.max(0, shown + by));
    setShown(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      onChange(next);
    }, 500);
  };
  const button = (text: string, by: number, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${by < 0 ? "Fewer" : "More"} ${label.toLowerCase()}`}
      disabled={disabled}
      onPress={() => step(by)}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.subtle,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={[s.text, { fontWeight: "600" }]}>{text}</Text>
    </Pressable>
  );
  return (
    <View role="group" aria-label={label} style={[s.row, { gap: 12, minHeight: 48 }]}>
      <Text style={[s.text, { flex: 1 }]}>{label}</Text>
      {button("−", -1, shown <= 0)}
      <Text
        aria-live="polite"
        style={[
          s.text,
          { width: 28, textAlign: "center", fontWeight: "600", opacity: busy ? 0.5 : 1 },
        ]}
      >
        {shown}
      </Text>
      {button("+", 1, shown >= max)}
    </View>
  );
}

function Rhythm({
  space,
  save,
  saving,
  ...state
}: SectionState & { space: Space; save: Save; saving: boolean }) {
  const book = space.playbook;
  return (
    <Section title="How often to post" {...state}>
      <Stepper
        label="Posts a week"
        value={book.postsPerWeek ?? 0}
        max={21}
        busy={saving}
        onChange={(postsPerWeek) => void save("rhythm", { postsPerWeek })}
      />
      <Stepper
        label="Ad ideas a week"
        value={book.adIdeasPerWeek ?? 0}
        max={14}
        busy={saving}
        onChange={(adIdeasPerWeek) => void save("rhythm", { adIdeasPerWeek })}
      />
      {!!book.rhythmNote && (
        <Text style={[s.muted, { color: colors.mutedStrong }]}>{book.rhythmNote}</Text>
      )}
    </Section>
  );
}

/** Above this a day, the limit needs a second tap. */
const HIGH_DAILY = 100;

function Money({ space, save, ...state }: SectionState & { space: Space; save: Save }) {
  const book = space.playbook;
  const [picking, setPicking] = useState(false);
  const [until, setUntil] = useState("");
  const [ceiling, setCeiling] = useState(book.dailyAdCeilingUsd?.toString() ?? "");
  const [confirmHigh, setConfirmHigh] = useState(false);
  useEffect(() => setCeiling(book.dailyAdCeilingUsd?.toString() ?? ""), [book.dailyAdCeilingUsd]);
  const amount = parseDollars(ceiling);
  const badAmount = amount !== null && Number.isNaN(amount);
  const changed = !badAmount && amount !== (book.dailyAdCeilingUsd ?? null);
  const setUntilDay = (day: string | null) => {
    setPicking(false);
    void save("money", { organicUntil: day });
  };
  const choices: { label: string; day: string | null }[] = [
    { label: "In 1 week", day: localDay(7) },
    { label: "In 2 weeks", day: localDay(14) },
    { label: "Ads are OK now", day: null },
  ];
  return (
    <Section title="Money" {...state}>
      <View style={{ gap: 8 }}>
        <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>
          Free posts only, no ads, until
        </Text>
        <Text style={s.text}>
          {book.organicUntil
            ? dayInWords(book.organicUntil)
            : book.dailyAdCeilingUsd
              ? "Ads are OK now"
              : "Not decided"}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {choices.map((choice) => (
            <Button
              key={choice.label}
              small
              selected={(book.organicUntil ?? null) === choice.day && !picking}
              onPress={() => setUntilDay(choice.day)}
            >
              {choice.label}
            </Button>
          ))}
          <Button small selected={picking} onPress={() => setPicking(!picking)}>
            Pick a date
          </Button>
        </View>
        {picking && (
          <View style={{ gap: 8 }}>
            <TightField
              label="Date (year-month-day)"
              placeholder={`e.g. ${localDay(10)}`}
              value={until}
              onChangeText={setUntil}
            />
            {!!until.trim() && !futureDay(until) && (
              <Text style={s.small}>Use a date after today, like {localDay(10)}.</Text>
            )}
            <Button
              small
              primary
              disabled={!futureDay(until)}
              style={{ alignSelf: "flex-start" }}
              onPress={() => setUntilDay(until.trim())}
            >
              Save date
            </Button>
          </View>
        )}
      </View>
      <View style={{ gap: 8, marginTop: 4 }}>
        <TightField
          label="Most to spend on ads each day, all ads together (US dollars)"
          placeholder="e.g. 10"
          keyboardType="decimal-pad"
          value={ceiling}
          onChangeText={(text) => {
            setCeiling(text);
            setConfirmHigh(false);
          }}
        />
        {badAmount ? (
          <Text style={s.small}>Use a number, like 10 or 12.50.</Text>
        ) : amount !== null ? (
          <Text style={s.small}>
            Up to {dollars(amount)} a day (about {dollars(Math.round(amount * 30))} a month).
          </Text>
        ) : null}
        {confirmHigh && amount !== null && (
          <Text style={[s.small, { color: colors.danger }]}>
            That’s more than most people start with. Tap Save again to use {dollars(amount)} a day.
          </Text>
        )}
        {changed && (
          <Button
            small
            primary
            style={{ alignSelf: "flex-start" }}
            onPress={() => {
              if (amount !== null && amount > HIGH_DAILY && !confirmHigh)
                return setConfirmHigh(true);
              setConfirmHigh(false);
              void save("money", { dailyAdCeilingUsd: amount });
            }}
          >
            Save
          </Button>
        )}
      </View>
      {!!book.budgetNote && (
        <Text style={[s.muted, { color: colors.mutedStrong }]}>{book.budgetNote}</Text>
      )}
      <View
        style={[
          s.row,
          {
            gap: 10,
            padding: 12,
            borderRadius: 12,
            backgroundColor: colors.lavender,
            alignItems: "flex-start",
          },
        ]}
      >
        <View style={{ marginTop: 2 }}>
          <Lock size={16} color={colors.blueDark} />
        </View>
        <Text style={[s.text, { flex: 1, fontSize: 14 }]}>
          Nothing gets posted or costs you money until you say OK. This can’t be turned off.
        </Text>
      </View>
    </Section>
  );
}

const TIMES = [
  { label: "Morning, 8:45 AM", time: "08:45" },
  { label: "Noon", time: "12:00" },
  { label: "Evening, 6 PM", time: "18:00" },
];

function Digest({ space }: { space: Space }) {
  const { api, notify } = useWorkspace();
  const { data } = useAgentWorkspace();
  const routine = data?.routines.find((item) => item.id === space.digestRoutineId);
  const [day, setDay] = useState(routine?.days[0] ?? 1);
  const [time, setTime] = useState(routine?.time ?? "08:45");
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (routine) {
      setDay(routine.days[0] ?? 1);
      setTime(routine.time);
    }
  }, [routine?.days[0], routine?.time]);
  const typed = other.trim() ? parseTime(other) : undefined;
  const chosen = typed ?? time;
  async function set(on: boolean) {
    setBusy(true);
    setError("");
    try {
      replace(
        await api.request<Space>(`/api/spaces/${space.id}/digest`, { on, day, time: chosen }),
      );
      notify(
        on ? `Weekly digest: ${DAY_NAMES[day]}s at ${clockTime(chosen)}` : "Weekly digest off",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Weekly digest">
      <Text style={s.muted}>
        What competitors posted, how you did and next week’s drafts, once a week in your time zone.
      </Text>
      <View
        role="group"
        aria-label="Day"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
      >
        {DAY_NAMES.map((name, index) => (
          <Button
            key={name}
            small
            selected={day === index}
            primary={day === index}
            accessibilityLabel={name}
            onPress={() => setDay(index)}
          >
            {name.slice(0, 3)}
          </Button>
        ))}
      </View>
      <View
        role="group"
        aria-label="Time"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
      >
        {TIMES.map((item) => (
          <Button
            key={item.time}
            small
            selected={!other.trim() && time === item.time}
            primary={!other.trim() && time === item.time}
            onPress={() => {
              setOther("");
              setTime(item.time);
            }}
          >
            {item.label}
          </Button>
        ))}
      </View>
      <TightField
        label="Or another time"
        placeholder="e.g. 7:30 am"
        value={other}
        onChangeText={setOther}
      />
      {typed === null && <Text style={s.small}>Try a time like 7:30 am or 19:30.</Text>}
      {typed && <Text style={s.small}>{clockTime(typed)}</Text>}
      <ErrorNotice error={error} />
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button small primary busy={busy} disabled={typed === null} onPress={() => void set(true)}>
          {routine ? "Save" : "Turn on"}
        </Button>
        {routine && (
          <Button small disabled={busy} onPress={() => void set(false)}>
            Turn off
          </Button>
        )}
      </View>
    </Section>
  );
}

function RemoveSpace({ space, onRemoved }: { space: Space; onRemoved: () => void }) {
  const { api, notify } = useWorkspace();
  const { load } = useSpaces();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api.request(`/api/spaces/${space.id}/delete`, {});
      await load();
      notify(`Removed the ${space.name} space`);
      onRemoved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <ErrorNotice error={error} />
      {confirming ? (
        <View style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.errorBg }}>
          <Text style={s.text}>
            Remove the {space.name} space? Its playbook, saved questions and weekly digest go too.
            Its chat stays in your side chats.
          </Text>
          <View style={[s.row, { gap: 8 }]}>
            <Button small onPress={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button small danger icon={Trash2} busy={busy} onPress={() => void remove()}>
              Remove
            </Button>
          </View>
        </View>
      ) : (
        <Button
          small
          icon={Trash2}
          style={{ alignSelf: "flex-start" }}
          onPress={() => setConfirming(true)}
        >
          Remove this space
        </Button>
      )}
    </View>
  );
}
