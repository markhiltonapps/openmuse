import { type UseThreadsResult, useThreads } from "@copilotkit/react-native/headless";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { forgetChatCopies } from "./chat-rows";
import { useWorkspace } from "./workspace";

function newThreadId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export type Selection = { id: string; existing: boolean };
/** The app's own copy of an older chat, which outlives CopilotKit's retention period. */
export type SavedChat = { threadId: string; name: string; updatedAt: string };
/** One of the main chat's earlier pages (the server starts a new one once a page is big). */
export type MainPage = { threadId: string; endedAt: string; count: number };

// Whether "Other chats" is folded away in the Chats list, remembered on this device.
const OTHERS_KEY = "neato.otherChatsHidden";
function readOthersHidden() {
  try {
    return globalThis.localStorage?.getItem(OTHERS_KEY) === "1";
  } catch {
    return false;
  }
}

const ThreadContext = createContext<{
  enabled: boolean;
  selection: Selection;
  visited: Selection[];
  mainId: string;
  /** The main chat's earlier pages, oldest first. */
  pages: MainPage[];
  /** Whether a chat is the main chat or one of its earlier pages (never listed as its own). */
  isMain: (id: string) => boolean;
  loading: boolean;
  error: string;
  retry: () => void;
  select: (selection: Selection) => void;
  start: () => void;
  /** Drops a deleted side chat, returning to the main chat if it was open. */
  forget: (id: string) => void;
  /** Deletes the main chat's history and starts it fresh. */
  resetMain: () => Promise<void>;
  /** Changes when the main chat is cleared, so an open chat reloads. */
  resets: number;
  claimPrompt: (id: number) => boolean;
  /** The chats CopilotKit keeps (side chats and the spaces' chats), archived ones included. */
  list: UseThreadsResult;
  /** The app's own copies of older chats. */
  saved: SavedChat[];
  /** Deletes a chat: CopilotKit's copy and the app's. */
  remove: (id: string) => Promise<void>;
  /** "Other chats" folded away in the Chats list. */
  othersHidden: boolean;
  setOthersHidden: (hidden: boolean) => void;
  /**
   * A switch asked for in the chat (manage_chats): it happens once the reply is in, so the answer
   * isn't cut off. `first` is sent in the new chat once it's open.
   */
  queued?: Queued;
  queue: (next: Queued) => void;
  /** Makes the queued switch, if any; the open chat calls it once it's done replying. */
  flush: () => void;
} | null>(null);
export type Queued = Selection & { label: string; first?: string };
export function ThreadsProvider({ children }: { children: ReactNode }) {
  const { workspace, navigate, api, ask } = useWorkspace();
  const handledPrompt = useRef(0);
  const enabled = workspace.runtime.richThreads === true;
  const [selection, setSelection] = useState<Selection>({ id: "local", existing: false });
  const [visited, setVisited] = useState<Selection[]>([]);
  const [mainId, setMainId] = useState("local");
  const [pages, setPages] = useState<MainPage[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [resets, setResets] = useState(0);
  const list = useThreads({ agentId: "default", enabled, includeArchived: true, limit: 20 });
  const [saved, setSaved] = useState<SavedChat[]>([]);
  const [othersHidden, setHidden] = useState(readOthersHidden);
  const [queued, setQueued] = useState<Queued>();
  const setOthersHidden = useCallback((hidden: boolean) => {
    setHidden(hidden);
    try {
      if (hidden) globalThis.localStorage?.setItem(OTHERS_KEY, "1");
      else globalThis.localStorage?.removeItem(OTHERS_KEY);
    } catch {
      // Private windows: it's still folded for now.
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void api.request<SavedChat[]>("/api/threads/archive").then(setSaved, () => undefined);
  }, [api, enabled]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true);
    setError("");
    void api
      .request<{ threadId: string; existing: boolean; pages?: MainPage[] }>("/api/main-thread")
      .then((main) => {
        if (!active) return;
        const next = { id: main.threadId, existing: main.existing };
        setMainId(next.id);
        setPages(main.pages ?? []);
        // An earlier part never opens on its own, so this device's copy of it can go.
        forgetChatCopies((main.pages ?? []).map((page) => page.threadId));
        setSelection(next);
        setVisited([next]);
        setLoading(false);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [api, enabled, attempt]);
  const isMain = useCallback(
    (id: string) => id === mainId || pages.some((page) => page.threadId === id),
    [mainId, pages],
  );
  function forget(id: string) {
    setVisited((items) => items.filter((item) => item.id !== id));
    if (selection.id === id) setSelection({ id: mainId, existing: true });
  }
  function select(next: Selection) {
    setSelection(next);
    setVisited((items) => (items.some((item) => item.id === next.id) ? items : [...items, next]));
    navigate("chat");
  }
  return (
    <ThreadContext.Provider
      value={{
        claimPrompt: (id) => {
          if (handledPrompt.current === id) return false;
          handledPrompt.current = id;
          return true;
        },
        enabled,
        mainId,
        pages,
        isMain,
        visited,
        loading,
        error,
        retry: () => setAttempt((n) => n + 1),
        selection,
        select,
        start: () => select({ id: newThreadId(), existing: false }),
        forget,
        resetMain: async () => {
          await api.request("/api/main-thread/reset", {});
          setAttempt((n) => n + 1);
          setResets((n) => n + 1);
        },
        resets,
        list,
        saved,
        remove: async (id) => {
          if (list.threads.some((thread) => thread.id === id)) await list.deleteThread(id);
          await api
            .request(`/api/threads/${encodeURIComponent(id)}/archive/delete`, {})
            .catch(() => undefined);
          setSaved((items) => items.filter((item) => item.threadId !== id));
          forget(id);
        },
        othersHidden,
        setOthersHidden,
        queued,
        queue: setQueued,
        flush: () => {
          if (!queued) return;
          setQueued(undefined);
          // The chat button shows (and says) the chat you're in now.
          if (queued.id !== selection.id) select(queued);
          const first = queued.first;
          // Asked once the new chat is the one on screen.
          if (first) setTimeout(() => ask(first), 0);
        },
      }}
    >
      {children}
    </ThreadContext.Provider>
  );
}
export function useMuseThread() {
  const context = useContext(ThreadContext);
  if (!context) throw new Error("Threads provider is unavailable");
  return context;
}
