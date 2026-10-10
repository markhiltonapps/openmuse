import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  type LucideIcon,
  MessageCircle,
  Mic,
  Pencil,
  SquarePen,
  Trash2,
} from "lucide-react-native";
import { type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { Space as AnySpace } from "../../../packages/domain/src/spaces";
import { useAgentWorkspace } from "./agent-workspace";
import { BrowserRunContext } from "./browser-tool-card";
import { threadTitle, whenLabel } from "./chat-names";
import { KINDS, useOpenChat, useSpaces } from "./spaces";
import { type Selection, useMuseThread } from "./threads";
import { Button, colors, dateLabel, ErrorNotice, Field, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * Chats live with the conversation: the chat button under the agent's name says which chat you're
 * in and opens the Chats list (Main chat, the spaces' chats, other chats, archived ones). Each chat's
 * Rename, Archive and Delete wait behind its own ⋯.
 */

// Untitled chats already sent to be named this session.
const askedToName = new Set<string>();

// Small buttons here keep a thumb-sized target.
const TALL = { minHeight: 44 };
// A status line that's read out but not seen, and lets taps through to what's under it.
const HIDDEN = {
  position: "absolute",
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  opacity: 0,
  overflow: "hidden",
  pointerEvents: "none",
} as const;

/** The chat on screen, by name. */
export function useCurrentChat() {
  const { enabled, selection, mainId, list, saved } = useMuseThread();
  const { spaces } = useSpaces();
  if (!enabled) return "Chat";
  if (selection.id === mainId || selection.id === "local") return "Main chat";
  const space = spaces?.find((item) => item.threadId === selection.id);
  if (space) return space.name;
  const thread = list.threads.find((item) => item.id === selection.id);
  if (thread) return threadTitle(thread);
  return saved.find((item) => item.threadId === selection.id)?.name ?? "Empty chat";
}

/** Under the agent's name on the chat screen: which chat this is, and the way to the others. */
export function ChatButton({ onPress }: { onPress: () => void }) {
  const { enabled, selection } = useMuseThread();
  const name = useCurrentChat();
  // After a switch (not a rename), said for screen readers; the button itself shows the new name.
  const [said, setSaid] = useState("");
  const last = useRef(selection.id);
  useEffect(() => {
    if (last.current !== selection.id) setSaid(`You’re in ${name}`);
    last.current = selection.id;
  }, [selection.id]);
  return (
    <>
      <Pressable
        role="button"
        nativeID="chat-button"
        aria-label={enabled ? `${name}. Switch chats` : `${name}. Options`}
        onPress={onPress}
        style={{ alignSelf: "center", maxWidth: "100%", minHeight: 44, justifyContent: "center" }}
      >
        {({ pressed }) => (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              // Taller with bigger text.
              minHeight: 36,
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: pressed ? colors.subtle : colors.canvas,
            }}
          >
            <Text
              numberOfLines={1}
              style={{ flexShrink: 1, fontSize: 14, fontWeight: "500", color: colors.text }}
            >
              {name}
            </Text>
            {enabled ? <ChevronDown size={16} color={colors.mutedStrong} /> : null}
          </View>
        )}
      </Pressable>
      {/* Invisible, and never in the way of a tap (in a centred header it sits mid-button). */}
      <Text role="status" style={HIDDEN}>
        {said}
      </Text>
    </>
  );
}

/** A chat in the list: tap to open it; its ⋯ opens what can be done to it, right under it. */
function ChatRow({
  title,
  detail,
  here = false,
  icon: Icon = MessageCircle,
  tint,
  onOpen,
  more,
  open = false,
  onMore,
  children,
}: {
  title: string;
  detail?: string;
  here?: boolean;
  icon?: LucideIcon;
  tint?: string;
  onOpen: () => void;
  /** Has a ⋯ (spaces don't). */
  more?: boolean;
  open?: boolean;
  onMore?: () => void;
  children?: ReactNode;
}) {
  const box = useRef<View>(null);
  // An open ⋯ low in the list is scrolled into view, and again as it grows (rename, delete).
  const reveal = () =>
    setTimeout(() => {
      const node = box.current as unknown as {
        scrollIntoView?: (options: object) => void;
      } | null;
      node?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }, 0);
  return (
    <View
      ref={box}
      style={{
        // An open ⋯ draws its chat as a card, with the buttons inside, so they read as its own.
        marginHorizontal: -10,
        paddingHorizontal: 10,
        borderRadius: 18,
        backgroundColor: open ? colors.card : "transparent",
        borderWidth: 1,
        borderColor: open ? colors.line : "transparent",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Pressable
          role="button"
          aria-label={`${title}${here ? ". You’re here" : ""}${detail ? `. ${detail}` : ""}`}
          onPress={onOpen}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 56,
            paddingVertical: 8,
            marginLeft: -10,
            paddingLeft: 10,
            borderRadius: 14,
            backgroundColor: pressed ? colors.subtle : "transparent",
          })}
        >
          {tint ? (
            <View
              style={[
                s.iconBox,
                { width: 36, height: 36, borderRadius: 11, backgroundColor: tint },
              ]}
            >
              <Icon size={18} color={colors.text} />
            </View>
          ) : (
            <View style={{ width: 36, alignItems: "center" }}>
              <Icon size={18} color={colors.mutedStrong} />
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={1} style={[s.text, { fontWeight: here ? "600" : "500" }]}>
              {title}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              {here ? (
                <>
                  <Check size={13} color={colors.blueText} />
                  <Text
                    style={{
                      fontSize: 13,
                      lineHeight: 18,
                      fontWeight: "700",
                      color: colors.blueText,
                    }}
                  >
                    You’re here
                  </Text>
                </>
              ) : null}
              {detail ? (
                <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
                  {here ? `· ${detail}` : detail}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>
        {more ? (
          <Pressable
            role="button"
            aria-label={`Options for ${title}`}
            aria-expanded={open}
            onPress={onMore}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed || open ? colors.subtle : "transparent",
            })}
          >
            <Ellipsis size={20} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
      {open && children ? (
        <View style={{ gap: 10, paddingBottom: 12 }} onLayout={reveal}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

function SectionTitle({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={[s.between, { marginTop: 10, minHeight: 44 }]}>
      <Text role="heading" aria-level={3} style={s.heading}>
        {children}
      </Text>
      {right}
    </View>
  );
}

/** "Say “…”": the same thing, by voice. */
function SayLine({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
      <Mic size={14} color={colors.blueDark} />
      <Text
        style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}
      >{`Say “${text}”`}</Text>
    </View>
  );
}

export function ChatsSheet({ onClose }: { onClose: () => void }) {
  const {
    enabled,
    loading,
    error: mainError,
    retry,
    selection,
    visited,
    mainId,
    isMain,
    list,
    saved,
    select,
    start,
    remove,
    resetMain,
    othersHidden,
    setOthersHidden,
  } = useMuseThread();
  const { spaces } = useSpaces();
  const openSpace = useOpenChat();
  const { api } = useWorkspace();
  const { data } = useAgentWorkspace();
  const agent = data?.identity.name || "your agent";
  const [view, setView] = useState<"chats" | "archived">("chats");
  // The one chat whose ⋯ is open, and what's happening in it.
  const [menu, setMenu] = useState<string>();
  const [step, setStep] = useState<"actions" | "rename" | "delete">("actions");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  // Fresh names and new chats each time the list opens.
  useEffect(() => {
    if (enabled) void list.refetchThreads();
  }, []);
  // Chats that never got a name are named from their first message, once.
  useEffect(() => {
    const untitled = list.threads
      .filter((thread) => !thread.name?.trim() && !askedToName.has(thread.id))
      .map((thread) => thread.id)
      .slice(0, 20);
    if (!enabled || !untitled.length) return;
    for (const id of untitled) askedToName.add(id);
    void api
      .request<{ named: Record<string, string> }>("/api/chats/name", { threadIds: untitled })
      .then(({ named }) => (Object.keys(named).length ? list.refetchThreads() : undefined))
      .catch(() => undefined);
  }, [enabled, list.threads]);

  const toggle = (id: string) => {
    setStep("actions");
    setError("");
    setMenu((open) => (open === id ? undefined : id));
  };
  const openChat = (next: Selection) => {
    onClose();
    if (next.id !== selection.id) select(next);
  };
  async function act(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await work();
      setMenu(undefined);
      setStep("actions");
      setStatus(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const spaceIds = new Set((spaces ?? []).map((space) => space.threadId));
  const ours = list.threads.filter((thread) => !isMain(thread.id) && !spaceIds.has(thread.id));
  const archived = ours.filter((thread) => thread.archived);
  // A new chat with nothing in it yet is listed only while you're in it.
  const fresh = visited.find(
    (item) =>
      item.id === selection.id &&
      !isMain(item.id) &&
      !spaceIds.has(item.id) &&
      !list.threads.some((thread) => thread.id === item.id) &&
      !saved.some((chat) => chat.threadId === item.id),
  );
  const others = [
    ...ours
      .filter((thread) => !thread.archived)
      .map((thread) => ({
        id: thread.id,
        title: threadTitle(thread),
        at: thread.lastRunAt ?? thread.updatedAt,
        older: false,
      })),
    // The app's own copies of older chats, once CopilotKit's list is all in.
    ...(list.hasMoreThreads
      ? []
      : saved
          .filter(
            (chat) =>
              !isMain(chat.threadId) &&
              !spaceIds.has(chat.threadId) &&
              !list.threads.some((thread) => thread.id === chat.threadId),
          )
          .map((chat) => ({
            id: chat.threadId,
            title: chat.name,
            at: chat.updatedAt,
            older: true,
          }))),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const othersCount = others.length + (fresh ? 1 : 0);

  const confirmDelete = (id: string, title: string, verb = "Delete") => (
    <View style={{ gap: 8 }}>
      <Text style={[s.text, { fontWeight: "600" }]}>
        {verb === "Clear"
          ? `Clear everything in ${enabled ? "your main chat" : "this chat"} and start it fresh?`
          : `Delete the chat “${title}”?`}
      </Text>
      <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
        This can’t be undone.
      </Text>
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button small style={TALL} onPress={() => setStep("actions")}>
          Keep it
        </Button>
        <Button
          small
          style={TALL}
          danger
          icon={Trash2}
          busy={busy}
          onPress={() =>
            void act(
              () => (id === "main" ? resetMain() : remove(id)),
              id === "main" ? "Main chat cleared." : "Chat deleted.",
            )
          }
        >
          {verb}
        </Button>
      </View>
    </View>
  );
  const chatActions = (id: string, title: string, restore = false) =>
    step === "rename" ? (
      <View style={{ gap: 8 }}>
        <Field
          label="Chat name"
          value={name}
          onChangeText={setName}
          autoFocus
          onSubmitEditing={() =>
            name.trim() && void act(() => list.renameThread(id, name.trim()), "Chat renamed.")
          }
        />
        <View style={[s.row, { gap: 8, marginTop: -8 }]}>
          <Button small style={TALL} onPress={() => setStep("actions")}>
            Cancel
          </Button>
          <Button
            small
            style={TALL}
            primary
            busy={busy}
            disabled={!name.trim()}
            onPress={() => void act(() => list.renameThread(id, name.trim()), "Chat renamed.")}
          >
            Save name
          </Button>
        </View>
      </View>
    ) : step === "delete" ? (
      confirmDelete(id, title)
    ) : (
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        {restore ? (
          <Button
            small
            style={TALL}
            icon={ArchiveRestore}
            busy={busy}
            onPress={() => void act(() => list.unarchiveThread(id), "Chat restored.")}
          >
            Restore
          </Button>
        ) : (
          <>
            <Button
              small
              style={TALL}
              icon={Pencil}
              onPress={() => {
                setName(title.startsWith("Chat from ") ? "" : title);
                setStep("rename");
              }}
            >
              Rename
            </Button>
            <Button
              small
              style={TALL}
              icon={Archive}
              busy={busy}
              onPress={() =>
                void act(
                  async () => {
                    await list.archiveThread(id);
                    if (selection.id === id) select({ id: mainId, existing: true });
                  },
                  selection.id === id
                    ? "Chat archived. It’s in Archived chats, and you’re back in Main chat."
                    : "Chat archived. It’s in Archived chats.",
                )
              }
            >
              Archive
            </Button>
          </>
        )}
        <Button small style={TALL} danger icon={Trash2} onPress={() => setStep("delete")}>
          Delete
        </Button>
      </View>
    );

  const statusLine = (
    // Mounted all the time, so each change is read out; sheets hide the app's own pop-ups.
    <Text
      role="status"
      style={
        status ? { fontSize: 13, lineHeight: 18, fontWeight: "600", color: colors.text } : HIDDEN
      }
    >
      {status}
    </Text>
  );

  let body: ReactNode;
  if (!enabled) {
    body = (
      <ChatRow
        title="Chat"
        detail={`Your chat with ${agent}`}
        here
        onOpen={onClose}
        more
        open={menu === "main"}
        onMore={() => toggle("main")}
      >
        {step === "delete" ? (
          confirmDelete("main", "Chat", "Clear")
        ) : (
          <Button
            small
            icon={Trash2}
            style={{ minHeight: 44, alignSelf: "flex-start" }}
            onPress={() => setStep("delete")}
          >
            Clear chat
          </Button>
        )}
      </ChatRow>
    );
  } else if (loading) {
    body = mainError ? (
      <View style={{ gap: 10 }}>
        <ErrorNotice error="Couldn’t load your chats." />
        <Button onPress={retry}>Try again</Button>
      </View>
    ) : (
      <ActivityIndicator color={colors.blueDark} />
    );
  } else if (view === "archived") {
    body = (
      <View style={{ gap: 4 }}>
        <Button
          small
          icon={ArrowLeft}
          style={{ minHeight: 44, alignSelf: "flex-start", marginBottom: 8 }}
          onPress={() => {
            setMenu(undefined);
            setView("chats");
          }}
        >
          Back to chats
        </Button>
        {archived.map((thread) => (
          <ChatRow
            key={thread.id}
            title={threadTitle(thread)}
            detail={`Archived ${dateLabel(thread.updatedAt)}`}
            onOpen={() => openChat({ id: thread.id, existing: true })}
            more
            open={menu === thread.id}
            onMore={() => toggle(thread.id)}
          >
            {chatActions(thread.id, threadTitle(thread), true)}
          </ChatRow>
        ))}
        {!archived.length ? (
          <Text style={[s.muted, { marginTop: 8 }]}>Nothing archived.</Text>
        ) : null}
        {archived[0] ? <SayLine text={`bring back ${threadTitle(archived[0])}`} /> : null}
      </View>
    );
  } else {
    body = (
      <View style={{ gap: 4 }}>
        <Button
          icon={SquarePen}
          onPress={() => {
            // An empty chat you're already in is the new chat.
            if (fresh) return onClose();
            onClose();
            start();
          }}
        >
          New chat
        </Button>
        <View style={{ height: 6 }} />
        <ChatRow
          title="Main chat"
          detail="Your everyday chat"
          tint={colors.sky}
          here={selection.id === mainId}
          onOpen={() => openChat({ id: mainId, existing: true })}
          more
          open={menu === "main"}
          onMore={() => toggle("main")}
        >
          {step === "delete" ? (
            confirmDelete("main", "Main chat", "Clear")
          ) : (
            <Button
              small
              icon={Trash2}
              style={{ minHeight: 44, alignSelf: "flex-start" }}
              onPress={() => setStep("delete")}
            >
              Clear main chat
            </Button>
          )}
        </ChatRow>
        {spaces?.length ? (
          <>
            <SectionTitle>Spaces</SectionTitle>
            {[...spaces]
              .sort((a, b) => Number(b.kind === "health") - Number(a.kind === "health"))
              .map((space: AnySpace) => (
                <ChatRow
                  key={space.id}
                  title={space.name}
                  icon={KINDS[space.kind].icon}
                  tint={KINDS[space.kind].tint}
                  here={selection.id === space.threadId}
                  detail={
                    space.kind !== "health" && !space.setupDone
                      ? "Not set up yet · Tap to start"
                      : whenLabel(space.updatedAt)
                  }
                  onOpen={() => {
                    onClose();
                    if (space.threadId !== selection.id) openSpace(space);
                  }}
                />
              ))}
          </>
        ) : null}
        <SectionTitle
          right={
            othersCount ? (
              <Button
                small
                style={TALL}
                accessibilityLabel={
                  othersHidden ? `Show other chats, ${othersCount}` : "Hide other chats"
                }
                onPress={() => {
                  setMenu(undefined);
                  setOthersHidden(!othersHidden);
                }}
              >
                {othersHidden ? `Show (${othersCount})` : "Hide"}
              </Button>
            ) : undefined
          }
        >
          Other chats
        </SectionTitle>
        {othersHidden ? (
          <>
            {fresh ? (
              <ChatRow title="Empty chat" detail="Nothing said yet" here onOpen={onClose} />
            ) : null}
            {others
              .filter((chat) => chat.id === selection.id)
              .map((chat) => (
                <ChatRow
                  key={chat.id}
                  title={chat.title}
                  detail={whenLabel(chat.at)}
                  here
                  onOpen={onClose}
                />
              ))}
          </>
        ) : (
          <>
            {fresh ? (
              <ChatRow title="Empty chat" detail="Nothing said yet" here onOpen={onClose} />
            ) : null}
            {others.map((chat) => (
              <ChatRow
                key={chat.id}
                title={chat.title}
                detail={whenLabel(chat.at)}
                here={selection.id === chat.id}
                onOpen={() => openChat({ id: chat.id, existing: true })}
                more
                open={menu === chat.id}
                onMore={() => toggle(chat.id)}
              >
                {chat.older ? (
                  step === "delete" ? (
                    confirmDelete(chat.id, chat.title)
                  ) : (
                    <>
                      <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
                        This older chat can only be deleted.
                      </Text>
                      <Button
                        small
                        danger
                        icon={Trash2}
                        style={{ minHeight: 44, alignSelf: "flex-start" }}
                        onPress={() => setStep("delete")}
                      >
                        Delete
                      </Button>
                    </>
                  )
                ) : (
                  chatActions(chat.id, chat.title)
                )}
              </ChatRow>
            ))}
            {list.isLoading ? <ActivityIndicator color={colors.blueDark} /> : null}
            {list.error ? (
              <View style={{ gap: 8 }}>
                <ErrorNotice error="Couldn’t load your chats." />
                <Button
                  small
                  style={{ minHeight: 44, alignSelf: "flex-start" }}
                  onPress={() => void list.refetchThreads()}
                >
                  Try again
                </Button>
              </View>
            ) : null}
            {!list.isLoading && !list.error && !othersCount ? (
              <Text style={[s.muted, { marginVertical: 6 }]}>
                Nothing here yet. Tap New chat to talk about something on its own.
              </Text>
            ) : null}
            {list.hasMoreThreads ? (
              <Button
                small
                busy={list.isFetchingMoreThreads}
                style={{ minHeight: 44, alignSelf: "flex-start" }}
                onPress={list.fetchMoreThreads}
              >
                Show more chats
              </Button>
            ) : null}
          </>
        )}
        {archived.length ? (
          <Pressable
            role="button"
            aria-label={`Archived chats, ${archived.length}`}
            onPress={() => {
              setMenu(undefined);
              setView("archived");
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              minHeight: 52,
              marginTop: 8,
              borderTopWidth: 1,
              borderTopColor: colors.line,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Archive size={18} color={colors.text} />
            <Text style={[s.text, { flex: 1, fontWeight: "600" }]}>Archived chats</Text>
            <Text style={{ fontSize: 13, color: colors.mutedStrong }}>{archived.length}</Text>
            <ChevronRight size={18} color={colors.mutedStrong} />
          </Pressable>
        ) : null}
        <SayLine text="start a new chat about the kitchen" />
      </View>
    );
  }

  return (
    <Sheet
      title={view === "archived" ? "Archived chats" : enabled ? "Chats" : "Chat"}
      subtitle={
        view === "archived"
          ? "Restore one to put it back in your chats."
          : `Each chat is separate, but ${agent} knows you in all of them.`
      }
      onClose={onClose}
      onBack={() => {
        if (menu) setMenu(undefined);
        else if (view === "archived") setView("chats");
        else onClose();
      }}
      fill
      narrow
    >
      <View style={{ gap: 8 }}>
        {statusLine}
        <ErrorNotice error={error} />
        {body}
      </View>
    </Sheet>
  );
}

/**
 * Keeps the server told which chats there are (names, kinds, which is open, whether other chats
 * are hidden), so the agent can open or tidy them by name, on a call too (manage_chats).
 */
export function ChatReporter() {
  const { enabled, selection, mainId, isMain, list, saved, othersHidden } = useMuseThread();
  const { spaces } = useSpaces();
  const { api } = useWorkspace();
  const sent = useRef("");
  useEffect(() => {
    if (!enabled || mainId === "local") return;
    const spaceIds = new Set((spaces ?? []).map((space) => space.threadId));
    const chats = [
      { id: mainId, name: "Main chat", kind: "main" as const },
      ...(spaces ?? []).map((space) => ({
        id: space.threadId,
        name: space.name,
        kind: "space" as const,
        lastUsed: space.updatedAt,
      })),
      ...list.threads
        .filter((thread) => !isMain(thread.id) && !spaceIds.has(thread.id))
        .map((thread) => ({
          id: thread.id,
          name: threadTitle(thread),
          kind: "other" as const,
          archived: thread.archived,
          lastUsed: thread.lastRunAt ?? thread.updatedAt,
        })),
      ...saved
        .filter(
          (chat) =>
            !isMain(chat.threadId) &&
            !spaceIds.has(chat.threadId) &&
            !list.threads.some((thread) => thread.id === chat.threadId),
        )
        .map((chat) => ({
          id: chat.threadId,
          name: chat.name,
          kind: "older" as const,
          lastUsed: chat.updatedAt,
        })),
    ].slice(0, 300);
    const body = { chats, current: selection.id, othersHidden };
    const text = JSON.stringify(body);
    if (text === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = text;
      void api.request("/api/chats/known", body).catch(() => {
        sent.current = "";
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [api, enabled, mainId, isMain, selection.id, spaces, list.threads, saved, othersHidden]);
  return null;
}

const chatsOpeners = new Set<() => void>();
/** The app opens its Chats sheet when a card asks (the list card's "See all"). */
export function onOpenChats(open: () => void) {
  chatsOpeners.add(open);
  return () => {
    chatsOpeners.delete(open);
  };
}
function openChats() {
  for (const open of chatsOpeners) open();
}

// The chat actions already done, so a card seen again later (the chat reloaded) doesn't redo them.
const DONE_KEY = "neato.chatActionsDone";
const doneHere = new Set<string>();
function doneBefore(key: string) {
  if (doneHere.has(key)) return true;
  try {
    return (JSON.parse(globalThis.localStorage?.getItem(DONE_KEY) ?? "[]") as string[]).includes(
      key,
    );
  } catch {
    return false;
  }
}
function markDone(key: string) {
  doneHere.add(key);
  try {
    const done = JSON.parse(globalThis.localStorage?.getItem(DONE_KEY) ?? "[]") as string[];
    globalThis.localStorage?.setItem(DONE_KEY, JSON.stringify([key, ...done].slice(0, 60)));
  } catch {
    // Without storage, an old card may show again; it only acts within minutes of being asked.
  }
}

type ChatRef = { id: string; name: string; kind?: string; lastUsed?: string };
type ChatAction = {
  action: string;
  for?: string;
  chat?: ChatRef;
  matches?: ChatRef[];
  chats?: ChatRef[];
  archived?: boolean;
  name?: string;
  firstMessage?: string;
  at?: string;
  shown?: boolean;
};

function parseAction(result: unknown): ChatAction | undefined {
  let value = result;
  if (typeof value === "string")
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  const action = value as ChatAction | null;
  return action && typeof action.action === "string" && action.shown !== false ? action : undefined;
}

/**
 * What manage_chats did, in the chat and on a call's screen. Opening, starting, renaming,
 * archiving, restoring and folding happen as the card appears (in the chat, a switch waits for
 * the reply); deleting and clearing wait for a tap here. Each happens once, while it's fresh, and
 * only for a card that appeared while the tool ran or on a live call: one drawn again from a
 * chat's history (after a reload, or on another device) just says what happened.
 */
export function ChatActionCard({
  result,
  loading = false,
  onCall = false,
  saved = false,
}: {
  result: unknown;
  loading?: boolean;
  onCall?: boolean;
  /** In a saved call: it says what happened and never does it again. */
  saved?: boolean;
}) {
  const {
    selection,
    mainId,
    list,
    select,
    queued,
    queue,
    remove,
    resetMain,
    setOthersHidden,
    forget,
  } = useMuseThread();
  const value = loading ? undefined : parseAction(result);
  const key = value ? `${value.action}:${value.at ?? ""}:${value.chat?.id ?? ""}` : "";
  const fresh = !!value?.at && Date.now() - Date.parse(value.at) < 10 * 60_000;
  const [state, setState] = useState<"waiting" | "done" | "kept" | "failed" | "stale">(
    key && doneBefore(key) ? "done" : "waiting",
  );
  // What else happened (archiving the chat you're in takes you back to Main chat).
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Part of the reply coming in now (seen unfinished, or a reply to a message sent from this
  // screen), or on the call: not one drawn again from a chat's history.
  const { active, fresh: replyHere } = useContext(BrowserRunContext);
  const live = useRef(false);
  if (!saved && (onCall || loading || active || replyHere)) live.current = true;
  const goTo = (chat: ChatRef, first?: string) => {
    const next = { id: chat.id, existing: chat.kind !== "new", label: chat.name, first };
    if (onCall) {
      // On a call the chat underneath changes now, and the call carries on.
      select(next);
      if (first) setTimeout(() => queue({ ...next, first }), 0);
    } else queue(next);
  };
  // Once per action, when its card appears (key changes only with the action).
  useEffect(() => {
    if (!value || !live.current || !fresh || doneBefore(key)) return;
    const { action, chat } = value;
    const finish = (work: Promise<unknown> | undefined) => {
      markDone(key);
      if (!work) return setState("done");
      void work.then(
        () => setState("done"),
        () => setState("failed"),
      );
    };
    if (action === "open" && chat) finish(void goTo(chat));
    else if (action === "start") {
      const id = newChatId();
      finish(void goTo({ id, name: value.name || "Empty chat", kind: "new" }, value.firstMessage));
    } else if (action === "rename" && chat && value.name)
      finish(list.renameThread(chat.id, value.name));
    else if (action === "archive" && chat) {
      // Out of the chat being archived: on a call now, in the chat once the reply is in.
      if (selection.id === chat.id) {
        const main = { id: mainId, existing: true, label: "Main chat" };
        if (onCall) select(main);
        else queue(main);
        setNote(
          onCall ? "You’re back in Main chat." : "You’ll be back in Main chat after this reply.",
        );
      }
      finish(list.archiveThread(chat.id));
    } else if (action === "restore" && chat) finish(list.unarchiveThread(chat.id));
    else if (action === "hide_other_chats") finish(void setOthersHidden(true));
    else if (action === "show_other_chats") finish(void setOthersHidden(false));
  }, [key]);
  if (!value) return null;
  const { action, chat } = value;
  const confirm = action === "delete" || action === "clear_main";
  const chats = action === "choose" ? value.matches : action === "list" ? value.chats : undefined;
  const heading =
    action === "open" && chat
      ? queued?.id === chat.id
        ? `Opening “${chat.name}” after this reply`
        : `Switched to “${chat.name}”`
      : action === "start"
        ? `A new chat${value.name ? `: “${value.name}”` : ""}`
        : action === "rename" && chat
          ? `Renamed to “${value.name}”`
          : action === "archive" && chat
            ? `Archived “${chat.name}”`
            : action === "restore" && chat
              ? `“${chat.name}” is back in your chats`
              : action === "hide_other_chats"
                ? "Other chats are hidden"
                : action === "show_other_chats"
                  ? "Other chats are showing again"
                  : action === "delete" && chat
                    ? `Delete the chat “${chat.name}”?`
                    : action === "clear_main"
                      ? "Clear everything in your main chat?"
                      : action === "choose"
                        ? "Which chat?"
                        : value.archived
                          ? "Your archived chats"
                          : "Your chats";
  return (
    <View
      role="group"
      aria-label={action === "list" ? heading : `Chats: ${heading}`}
      style={{
        width: "100%",
        maxWidth: 520,
        gap: 10,
        padding: 16,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <MessageCircle size={16} color={colors.mutedStrong} />
        <Text
          style={{ fontSize: 13, lineHeight: 18, fontWeight: "700", color: colors.mutedStrong }}
        >
          Chats
        </Text>
      </View>
      <Text role="heading" aria-level={4} style={[s.heading, { fontSize: 17 }]}>
        {state === "kept"
          ? "Kept as it is"
          : confirm && state === "done"
            ? action === "clear_main"
              ? "Main chat cleared"
              : `Deleted “${chat?.name ?? "the chat"}”`
            : state === "failed"
              ? "That didn’t work. Try it from Chats."
              : state === "stale"
                ? "This was asked a while ago"
                : heading}
      </Text>
      {state === "stale" ? (
        <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
          {action === "clear_main"
            ? "Ask again, or clear it from Chats."
            : "Ask again, or delete it from Chats."}
        </Text>
      ) : note ? (
        <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>{note}</Text>
      ) : null}
      {action === "choose" ? (
        <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
          {`${value.matches?.length ?? 0} chats match. Say which, or open one.`}
        </Text>
      ) : null}
      {confirm && state === "waiting" ? (
        <>
          <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
            {action === "clear_main"
              ? "It starts fresh, and this can’t be undone."
              : "This can’t be undone."}
          </Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button onPress={() => setState("kept")}>Keep it</Button>
            <Button
              danger
              icon={Trash2}
              busy={busy}
              onPress={() => {
                // One asked for while this screen was open stays good; an old one is asked again.
                if (!fresh && !live.current) return setState("stale");
                setBusy(true);
                const work = action === "clear_main" ? resetMain() : remove(chat?.id ?? "");
                void work
                  .then(() => {
                    markDone(key);
                    if (chat && action === "delete") forget(chat.id);
                    setState("done");
                  })
                  .catch(() => setState("failed"))
                  .finally(() => setBusy(false));
              }}
            >
              {action === "clear_main" ? "Clear" : "Delete"}
            </Button>
          </View>
        </>
      ) : null}
      {chats?.length ? (
        <View>
          {chats.slice(0, 8).map((item) => (
            <View
              key={item.id}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52 }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={[s.text, { fontWeight: selection.id === item.id ? "600" : "500" }]}
                >
                  {item.name}
                </Text>
                {selection.id === item.id ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Check size={13} color={colors.blueText} />
                    <Text
                      style={{
                        fontSize: 13,
                        lineHeight: 18,
                        fontWeight: "700",
                        color: colors.blueText,
                      }}
                    >
                      You’re here
                    </Text>
                  </View>
                ) : item.kind === "space" || item.lastUsed ? (
                  <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
                    {item.kind === "space" ? "A space’s chat" : whenLabel(item.lastUsed ?? "")}
                  </Text>
                ) : null}
              </View>
              {selection.id === item.id ? null : (
                <Button
                  small
                  style={TALL}
                  accessibilityLabel={`Open ${item.name}`}
                  onPress={() => select({ id: item.id, existing: true })}
                >
                  Open
                </Button>
              )}
            </View>
          ))}
          {chats.length > 8 ? (
            onCall ? (
              <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
                {`And ${chats.length - 8} more. Say a name to open one.`}
              </Text>
            ) : (
              <Button
                small
                style={{ minHeight: 44, alignSelf: "flex-start", marginTop: 4 }}
                onPress={openChats}
              >
                {`See all ${chats.length} chats`}
              </Button>
            )
          ) : null}
        </View>
      ) : action === "list" ? (
        <Text style={s.muted}>
          {value.archived ? "Nothing archived." : "Just your main chat and your spaces."}
        </Text>
      ) : null}
    </View>
  );
}

function newChatId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
