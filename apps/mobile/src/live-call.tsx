import { LayoutList, Link2, Mic, MicOff, PhoneOff, ShieldCheck, X } from "lucide-react-native";
import {
  createContext,
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { CallDetail } from "../../../packages/domain/src/voice";
import { useAgentWorkspace } from "./agent-workspace";
import { AgentAvatar } from "./avatar";
import { HIDDEN } from "./job-working-ui";
import { type LiveCall, type LiveState, startLive } from "./live-voice";
import { tipProps } from "./tips";
import { colors } from "./ui";
import { useWorkspace } from "./workspace";

export interface Line {
  role: "user" | "assistant";
  text: string;
}

const savedListeners = new Set<() => void>();
/** Hears when a call has been saved, so the chat can add it. */
export function onCallSaved(listener: () => void) {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}
/**
 * After a call: the server saves it within a moment of the end; anything asked at the very end
 * follows within two minutes, so it's checked again a few times.
 */
function callSaved(first = 0) {
  for (const after of [first, 15_000, 45_000, 125_000])
    setTimeout(() => {
      for (const listener of savedListeners) listener();
    }, after);
}

/** Why a conversation ended on its own, in plain words. */
export const ENDED = (name: string): Record<string, string> => ({
  remote_hangup: "The call ended.",
  close_requested: "The call ended. Talk again to carry on.",
  connection_lost: "The connection dropped. Talk again when you’re ready.",
  expired: "That’s as long as one call can last. Talk again to carry on.",
  time_limit: "Calls stop after an hour. Talk again to carry on.",
  content: "A safety check stopped the call. Talk again to start a new one.",
  idle: `It went quiet, so ${name} hung up. Talk again when you’re ready.`,
  replaced: `You started talking with ${name} somewhere else, so this call ended.`,
  server_restart: `${name} had to restart, so the call ended. Talk again to carry on.`,
});
/** A browser's reason a call couldn't start, as what to do about it. */
export function startFailure(error: unknown, name: string) {
  const kind = error instanceof Error ? error.name : "";
  if (kind === "NotAllowedError" || kind === "SecurityError")
    return `${name} can’t hear you. Select the icon beside the web address, allow the microphone, then choose “Talk again”.`;
  if (kind === "NotFoundError")
    return "No microphone was found. Plug one in, then choose “Talk again”.";
  if (kind === "OverconstrainedError")
    return "The microphone chosen in Apps › Agent › Voice isn’t connected. Plug it in or choose another there, then choose “Talk again”.";
  if (kind === "NotReadableError")
    return "Another app is using the microphone. Close it, then choose “Talk again”.";
  // No answer, or a page that isn't ours (a proxy's error page during an update).
  if (kind === "TypeError" || kind === "SyntaxError")
    return `Couldn’t reach ${name}. Check your internet connection, then choose “Talk again”.`;
  const message = error instanceof Error ? error.message.trim() : "";
  return message || "Something went wrong. Choose “Talk again” to try once more.";
}

/** No call; one going on; or one that's over and still showing what happened. */
export type CallPhase = "idle" | "on" | "over";
/** What most of the app needs: whether there's a call, and what can be done with it. */
export interface CallControls {
  phase: CallPhase;
  /** The call screen is open; otherwise a call shows as a bar at the top. */
  shown: boolean;
  /** Starts a call (ending one that's on). */
  start: () => void;
  /** Ends the call the person is on; nothing of it stays on screen. */
  end: () => void;
  toggleMute: () => void;
  /** Lets go of a call that's over (its bar goes). */
  dismiss: () => void;
  /**
   * Opens the call screen, over whatever is open (it starts a call when there's none). From the
   * bar, it goes straight to what See it names.
   */
  expand: (toNews?: boolean) => void;
  /** Shrinks the call screen to the bar; a call that's over goes. */
  shrink: () => void;
}
export interface LiveCallValue extends CallControls {
  /** The answer See it named, for the call screen to go straight to (then cleared). */
  target?: string;
  clearTarget: () => void;
  state: LiveState;
  muted: boolean;
  /** The last few things said, newest last. */
  lines: Line[];
  /** What the agent put on screen instead of reading it out. */
  details: CallDetail[];
  /** How many of those arrived while the call screen was shrunk. */
  unseen: number;
  /** What the bar's See it button names, if anything. */
  row?: NewsRow;
  view: "talk" | "details";
  setView: (view: "talk" | "details") => void;
  /** The agent is looking something up ("hold on, let me check"). */
  lookingUp: boolean;
  /** Why it couldn't start, or why it ended on its own, in plain words. */
  error: string;
  ended: string;
  /** When the agent first answered (for the call's time). */
  startedAt?: number;
}
// Split so words arriving many times a second redraw only the bar and the call screen, not every
// screen that just needs to know whether there's a call.
const ControlsContext = createContext<CallControls | null>(null);
const CallContext = createContext<LiveCallValue | null>(null);
const NewsContext = createContext("");
/** Whether there's a call and what can be done with it (cheap: changes only when that does). */
export function useCallControls() {
  const value = useContext(ControlsContext);
  if (!value) throw new Error("Live call is unavailable");
  return value;
}
/** Everything about the call, words included: for the bar and the call screen. */
export function useLiveCall() {
  const value = useContext(CallContext);
  if (!value) throw new Error("Live call is unavailable");
  return value;
}
/** What just happened to the call while it was shrunk, for a screen reader. */
export function useCallNews() {
  return useContext(NewsContext);
}
/**
 * Says what happened to a shrunk call (muted, ended, something new on screen). Mounted all the
 * time, so its changes are read out; quiet while a sheet says it instead.
 */
export function CallNews({ quiet }: { quiet: boolean }) {
  const news = useCallNews();
  return (
    <Text role="status" style={HIDDEN}>
      {quiet ? "" : news}
    </Text>
  );
}

/**
 * The live call, for the whole app: it carries on while the person moves between screens and
 * opens other things, shown full size on the call screen (a layer over everything) or as a bar.
 */
export function LiveCallProvider({ children }: { children: ReactNode }) {
  const { api, workspace } = useWorkspace();
  // Things from a call still waiting for their OK: their See it stays until approved or declined.
  // Waiting means not decided and not past its time: the server only marks an approval expired
  // when someone acts on it, so the time is checked here (as its Approve card does).
  const [clock, setClock] = useState(0);
  const waiting = useMemo(() => {
    const byId = new Map(workspace.actions.map((action) => [action.id, action]));
    /** Unknown ones are new (the app hasn't heard of them yet), unless `known` is asked for. */
    return (id: string, known = false) => {
      const action = byId.get(id);
      if (!action) return !known;
      return action.status === "awaiting_review" && Date.parse(action.expiresAt) > Date.now();
    };
  }, [workspace.actions, clock]);
  const waitingNow = useRef(waiting);
  waitingNow.current = waiting;
  // The reminder goes when the soonest waiting approval runs out.
  useEffect(() => {
    const soonest = Math.min(
      ...workspace.actions
        .filter((action) => action.status === "awaiting_review")
        .map((action) => Date.parse(action.expiresAt))
        .filter((at) => at > Date.now()),
    );
    if (!Number.isFinite(soonest)) return;
    const timer = setTimeout(
      () => setClock((n) => n + 1),
      Math.min(soonest - Date.now() + 500, 2 ** 31 - 1),
    );
    return () => clearTimeout(timer);
  }, [workspace.actions, clock]);
  const { data } = useAgentWorkspace();
  const name = data?.identity.name || "Neddy";
  // The name can change mid-call (settings loading): that mustn't restart it.
  const nameNow = useRef(name);
  nameNow.current = name;
  const [phase, setPhase] = useState<CallPhase>("idle");
  const phaseNow = useRef(phase);
  phaseNow.current = phase;
  const [shown, setShown] = useState(false);
  const shownNow = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LiveState>("connecting");
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [details, setDetails] = useState<CallDetail[]>([]);
  // How many details the person has had the call screen open for.
  const [seen, setSeen] = useState(0);
  const seenNow = useRef(0);
  seenNow.current = seen;
  const detailsNow = useRef<CallDetail[]>([]);
  detailsNow.current = details;
  const [target, setTarget] = useState<string>();
  const [view, setView] = useState<"talk" | "details">("talk");
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState("");
  const [startedAt, setStartedAt] = useState<number>();
  const [news, setNews] = useState("");
  const newsTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Read out by a screen reader, while the call screen (with its own status line) isn't open. */
  const say = useCallback((words: string) => {
    if (shownNow.current) return;
    // Cleared first, so the same words are read out again.
    setNews("");
    clearTimeout(newsTimer.current);
    newsTimer.current = setTimeout(() => {
      setNews(words);
      // Said once: it mustn't be read out again by a sheet that opens later.
      newsTimer.current = setTimeout(() => setNews(""), 5000);
    }, 50);
  }, []);
  const call = useRef<LiveCall | undefined>(undefined);
  const mutedNow = useRef(false);
  // Each call's handlers check they're still the current call's (an ended one can't speak up).
  const current = useRef(0);
  useEffect(() => {
    if (!attempt) return;
    const me = ++current.current;
    const live = () => current.current === me;
    // An Approve card from the last call that's still waiting comes along, behind See it.
    const carried = detailsNow.current.filter((detail) =>
      approvalIds(detail).some((id) => waitingNow.current(id, true)),
    );
    setPhase("on");
    setState("connecting");
    setError("");
    setEnded("");
    setLines([]);
    setMuted(false);
    mutedNow.current = false;
    setLookingUp(false);
    setDetails(carried);
    setSeen(carried.length);
    setView("talk");
    setStartedAt(undefined);
    let detailCount = 0;
    // Words arrive a few at a time, many times a second: they're gathered and shown about five
    // times a second, so the screen isn't redrawn for each one (slow phones stutter).
    let pending: Line[] = [];
    let flush: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      flush = undefined;
      const arrived = pending;
      pending = [];
      if (!live() || !arrived.length) return;
      setLines((lines) => {
        const next = [...lines];
        for (const line of arrived) {
          const last = next.at(-1);
          if (last?.role === line.role)
            next[next.length - 1] = { role: line.role, text: last.text + line.text };
          else next.push(line);
        }
        return next.slice(-8);
      });
    };
    startLive(api, {
      onState: (next) => {
        if (!live()) return;
        setState(next);
        if (next === "listening" || next === "speaking") setStartedAt((at) => at ?? Date.now());
        if (next === "ended") setPhase("over");
      },
      onChecking: (on) => live() && setLookingUp(on),
      onDetails: (next) => {
        // A late reply to an earlier look can't take anything away.
        if (!live() || next.length < detailCount) return;
        // Something new: the voice is saying it's on the screen, so that's what shows.
        if (next.length > detailCount) {
          setView("details");
          // What just arrived, as the bar's See it button names it.
          const row = newsRow(next.slice(detailCount), nameNow.current, waitingNow.current);
          if (row) say(`${rowWords(row)}. Choose “See it” in the bar at the top.`);
        }
        detailCount = next.length;
        setDetails([...carried, ...next]);
      },
      onWords: (role, words) => {
        if (!live()) return;
        const last = pending.at(-1);
        if (last?.role === role) last.text += words;
        else pending.push({ role, text: words });
        flush ??= setTimeout(show, 200);
      },
      onEnded: (reason) => {
        // OpenAI ended it; the server saves the call as soon as it hears.
        callSaved(2500);
        if (!live()) return;
        const endings = ENDED(nameNow.current);
        setEnded(endings[reason ?? ""] ?? "The call ended.");
        // When the server ended it (quiet, the hour, another call), ask it why once it has
        // saved this call.
        if (reason === "close_requested")
          setTimeout(() => {
            void api
              .request<{ sessions: { reason?: string; endedAt: string }[] }>(
                "/api/voice/live/recent",
              )
              .then(({ sessions }) => {
                const last = sessions[0];
                const fresh = last && Date.now() - Date.parse(last.endedAt) < 10_000;
                if (live() && fresh && last.reason && endings[last.reason])
                  setEnded(endings[last.reason] as string);
              })
              .catch(() => undefined);
          }, 1500);
      },
    })
      .then((started) => {
        if (!live()) return void started.end();
        call.current = started;
        // Shrunk while it was connecting: the server starts out thinking the screen is open.
        if (!shownNow.current) started.setShrunk(true);
      })
      .catch((e: unknown) => {
        if (!live()) return;
        setState("ended");
        setPhase("over");
        setError(startFailure(e, nameNow.current));
      });
    return () => {
      if (current.current === me) current.current++;
      clearTimeout(flush);
      void call.current?.end().then(() => callSaved());
      call.current = undefined;
    };
  }, [api, attempt, say]);
  // With the call screen open, everything on it has been seen.
  useEffect(() => {
    if (shown) setSeen(details.length);
  }, [shown, details.length]);
  // The voice says where things it shows appear: on the call screen, or under See it on the bar.
  useEffect(() => {
    if (phase === "on") call.current?.setShrunk(!shown);
  }, [phase, shown]);
  // A call that ends on its own while shrunk says so (and why).
  useEffect(() => {
    if (phase !== "over") return;
    // Something still waiting for their OK stays behind See it on the ended bar: say so.
    const row = rowNow.current;
    const stillWaiting =
      row?.kind === "ok"
        ? ` ${row.title} still needs your OK. Choose “See it” in the bar at the top.`
        : "";
    say(
      `${error ? `The call couldn’t start. ${error}` : ended || "The call ended."}${stillWaiting}`,
    );
  }, [phase, ended, error, say]);
  // During a call, leaving the page (a refresh, pull to refresh, closing the tab) asks first.
  useEffect(() => {
    if (phase !== "on" || Platform.OS !== "web" || typeof window === "undefined") return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    const roots = [document.documentElement, document.body];
    const before = roots.map((root) => root.style.overscrollBehaviorY);
    for (const root of roots) root.style.overscrollBehaviorY = "none";
    return () => {
      window.removeEventListener("beforeunload", ask);
      roots.forEach((root, at) => {
        root.style.overscrollBehaviorY = before[at] ?? "";
      });
    };
  }, [phase]);
  useEffect(() => () => clearTimeout(newsTimer.current), []);
  const start = useCallback(() => setAttempt((n) => n + 1), []);
  const end = useCallback(() => {
    const wasOn = phaseNow.current === "on";
    current.current++;
    // The server has saved the call once it answers.
    void call.current?.end().then(() => callSaved());
    call.current = undefined;
    setState("ended");
    setPhase("idle");
    shownNow.current = false;
    setShown(false);
    if (wasOn) say("The call ended.");
  }, [say]);
  const toggleMute = useCallback(() => {
    const next = !mutedNow.current;
    mutedNow.current = next;
    call.current?.setMuted(next);
    setMuted(next);
    say(
      next
        ? `Muted. ${nameNow.current} can’t hear you.`
        : `Unmuted. ${nameNow.current} can hear you.`,
    );
  }, [say]);
  const dismiss = useCallback(() => {
    setPhase((now) => (now === "over" ? "idle" : now));
    clearTimeout(newsTimer.current);
    setNews("");
  }, []);
  const expand = useCallback((toNews = false) => {
    // From the bar: straight to what its See it named (a waiting Approve card first).
    const row = toNews ? rowNow.current : undefined;
    setTarget(row?.id);
    if (row) setView("details");
    shownNow.current = true;
    setShown(true);
    setNews("");
  }, []);
  const clearTarget = useCallback(() => setTarget(undefined), []);
  const shrink = useCallback(() => {
    shownNow.current = false;
    setShown(false);
    if (phaseNow.current === "on") say("The call keeps going in the bar at the top.");
    else setPhase((now) => (now === "over" ? "idle" : now));
    // Opened from a button that's gone (Talk again): focus goes to the bar rather than nowhere.
    if (Platform.OS === "web")
      setTimeout(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        // The topmost bar (a sheet's comes after the page's), and its main button, not End.
        const bars = document.querySelectorAll<HTMLElement>(
          '[role="region"][aria-label^="Call with"]',
        );
        bars[bars.length - 1]?.querySelector<HTMLElement>('[role="button"]')?.focus();
      }, 80);
  }, [say]);
  // What the bar's See it button shows: what's new on screen since they last looked, and anything
  // from the call still waiting for their OK.
  const row = useMemo(() => {
    const fresh = details.slice(seen);
    const stillWaiting = details
      .slice(0, seen)
      .filter((detail) => approvalIds(detail).some((id) => waiting(id)));
    // What just arrived comes first, so the bar names what the voice just pointed to; an
    // approval already seen and still waiting is a reminder only when there's nothing new.
    const found = newsRow(fresh.length ? fresh : stillWaiting, name, waiting);
    if (!found) return undefined;
    return fresh.length
      ? { ...found, fresh: true, more: found.more + stillWaiting.length }
      : { ...found, fresh: false, label: "Still needs your OK" };
  }, [details, seen, waiting, name]);
  const rowNow = useRef(row);
  rowNow.current = row;
  const controls = useMemo<CallControls>(
    () => ({ phase, shown, start, end, toggleMute, dismiss, expand, shrink }),
    [phase, shown, start, end, toggleMute, dismiss, expand, shrink],
  );
  const value = useMemo<LiveCallValue>(
    () => ({
      ...controls,
      state,
      muted,
      lines,
      details,
      unseen: Math.max(0, details.length - seen),
      row,
      view,
      setView,
      lookingUp,
      error,
      ended,
      startedAt,
      target,
      clearTarget,
    }),
    [
      controls,
      state,
      muted,
      lines,
      details,
      seen,
      view,
      lookingUp,
      error,
      ended,
      startedAt,
      target,
      clearTarget,
      row,
    ],
  );
  return (
    <ControlsContext.Provider value={controls}>
      <CallContext.Provider value={value}>
        <NewsContext.Provider value={news}>{children}</NewsContext.Provider>
      </CallContext.Provider>
    </ControlsContext.Provider>
  );
}

/** The actions an answer's Approve cards are for. */
const approvalIds = (detail: CallDetail) =>
  detail.items.flatMap((item) => {
    const id = (item.result as { actionId?: unknown } | undefined)?.actionId;
    return item.tool === "approval" && typeof id === "string" ? [id] : [];
  });
/** Something put on screen that waits for their OK (an Approve card). */
const needsOk = (detail: CallDetail, waiting: (id: string) => boolean) =>
  approvalIds(detail).some(waiting);
/** A Connect button for an app (connect_app's link, or their own app to check and connect). */
const connectOf = (detail: CallDetail) => detail.items.find((item) => item.tool === "connect");
/** What a detail is, in a few words: an Approve card's own title, else the answer's heading. */
function detailTitle(detail: CallDetail) {
  for (const item of detail.items) {
    const title = (item.result as { title?: unknown } | undefined)?.title;
    if (item.tool === "approval" && typeof title === "string" && title.trim()) return title.trim();
  }
  const app = (connectOf(detail)?.result as { app?: unknown } | undefined)?.app;
  if (typeof app === "string" && app.trim())
    return `Connect ${app.trim().charAt(0).toUpperCase()}${app.trim().slice(1)}`;
  return detail.title?.trim() || "Something new";
}
/**
 * What the bar's See it button says about what's new on screen: something waiting for their OK
 * first, then a Connect button, else the newest; and how many more there are.
 */
interface NewsRow {
  /** The answer it names. */
  id: string;
  /** Not looked at yet (otherwise it's a quieter reminder of something still waiting). */
  fresh?: boolean;
  kind: "ok" | "connect" | "new";
  label: string;
  title: string;
  more: number;
}
function newsRow(
  unseen: CallDetail[],
  name: string,
  isWaiting: (id: string) => boolean,
): NewsRow | undefined {
  const newest = [...unseen].reverse();
  // An Approve card that's been decided or has run out is just an answer now.
  const waiting = newest.find((detail) => needsOk(detail, isWaiting));
  const connect = waiting ? undefined : newest.find((detail) => !!connectOf(detail));
  const pick = waiting ?? connect ?? newest[0];
  if (!pick) return undefined;
  const kind = waiting ? "ok" : connect ? "connect" : "new";
  return {
    id: pick.id,
    kind,
    label:
      kind === "ok"
        ? "Needs your OK"
        : kind === "connect"
          ? "Ready to connect"
          : `New from ${name}`,
    title: detailTitle(pick),
    more: unseen.length - 1,
  };
}
/** "Needs your OK: Move 9 emails to the trash, and 1 more": the row's words, in its order. */
const rowWords = (row: NewsRow) =>
  `${row.label}: ${row.title}${row.more ? `, and ${row.more} more` : ""}`;

/** What the call is doing, in a few words. */
export function callStatus(call: LiveCallValue, name: string) {
  return call.phase === "over"
    ? call.ended || (call.error ? "The call couldn’t start." : "The call ended.")
    : call.state === "connecting"
      ? "Connecting…"
      : call.muted
        ? `Muted. ${name} can’t hear you.`
        : call.state === "speaking"
          ? `${name} is talking. Just speak to cut in.`
          : call.lookingUp
            ? `${name} is checking…`
            : "Listening…";
}
/** The call's own short status, for the bar ("Neddy · Listening"). */
function barStatus(call: LiveCallValue) {
  return call.state === "connecting"
    ? "Connecting"
    : call.muted
      ? "You’re muted"
      : call.state === "speaking"
        ? "Talking"
        : call.lookingUp
          ? "Checking"
          : "Listening";
}
/** "3:05" since the agent first answered, ticking once a second. */
function useCallTime(since?: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!since) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [since]);
  if (!since) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
/** The end of what was said: the newest words matter ("…on your screen"), not the first ones. */
function newest(text: string, most = 110) {
  if (text.length <= most) return text;
  const cut = text.slice(-most);
  const space = cut.indexOf(" ");
  return `…${space > 0 && space < 24 ? cut.slice(space + 1) : cut}`;
}
const asElement = (node: unknown) =>
  Platform.OS === "web" ? (node as HTMLElement | null | undefined) : undefined;

/**
 * The call, while the person is somewhere else in the app: who and how it's going, the last thing
 * the agent said, Mute and End. A tap goes back to the call screen. Over, it says why and offers
 * to talk again.
 */
export function CallBar() {
  const call = useLiveCall();
  const { data } = useAgentWorkspace();
  const name = data?.identity.name || "Neddy";
  const time = useCallTime(call.phase === "on" ? call.startedAt : undefined);
  const over = call.phase === "over";
  const bar = useRef<View>(null);
  const main = useRef<View>(null);
  // Where focus is as the buttons change (the call ends on its own): if it was on the bar, it goes
  // to the bar's main button rather than being lost (or landing on Talk again by surprise).
  const focusHere = useRef(false);
  const node = asElement(bar.current);
  focusHere.current = !!node?.contains(document.activeElement);
  // A tap meant for Mute, just as the call ends, mustn't start a new call.
  const overAt = useRef(0);
  const [quoteWidth, setQuoteWidth] = useState(0);
  useEffect(() => {
    if (!over) return;
    overAt.current = Date.now();
    if (!focusHere.current) return;
    const timer = setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      asElement(main.current)?.focus();
    }, 60);
    return () => clearTimeout(timer);
  }, [over]);
  if (call.phase === "idle") return null;
  const status = barStatus(call);
  const said = over
    ? ""
    : ([...call.lines]
        .reverse()
        .find((line) => line.role === "assistant")
        ?.text.trim() ?? "");
  // Why it ended, when there's more to say than "The call ended." (Talk again is right there).
  const why = over && !call.error && !call.ended.startsWith("The call ended.") ? call.ended : "";
  // What's new on screen and not seen yet, for its See it button (a waiting OK first): during the
  // call, and after it ends, so a waiting OK isn't lost because it went quiet before it was safe
  // to look.
  const row = call.row;
  const live = !over && !call.muted && call.state !== "connecting";
  // Two lines of 14px text hold about one character per 7.6px each: the newest words must fit.
  const room = quoteWidth ? Math.max(60, Math.floor(quoteWidth / 7.6) * 2 - 6) : 80;
  const soft = { color: colors.onInverse, opacity: 0.78 };
  const round = (fill: string) => ({
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: fill,
  });
  /** End from the bar: focus goes on to the sheet it's in, or the headset (or the menu). */
  const endCall = () => {
    const dialog = asElement(bar.current)?.closest<HTMLElement>('[role="dialog"]');
    call.end();
    if (Platform.OS !== "web") return;
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      // In a sheet: its title, not its Close (a second Enter there could lose what was typed).
      const title = dialog?.isConnected
        ? dialog.querySelector<HTMLElement>('[role="heading"]')
        : null;
      title?.setAttribute("tabindex", "-1");
      (
        title ??
        document.getElementById("call-headset") ??
        document.querySelector<HTMLElement>('#menu-button [role="button"]')
      )?.focus();
    }, 60);
  };
  return (
    <View
      ref={bar}
      role="region"
      aria-label={`Call with ${name}`}
      // Under the open call screen it keeps its place (focus comes back to it) but isn't seen twice.
      aria-hidden={call.shown || undefined}
      pointerEvents={call.shown ? "none" : "auto"}
      style={{
        opacity: call.shown ? 0 : 1,
        marginHorizontal: 12,
        marginTop: 8,
        marginBottom: 4,
        paddingVertical: 8,
        paddingLeft: 10,
        paddingRight: 8,
        gap: 4,
        borderRadius: 30,
        backgroundColor: colors.inverse,
        shadowColor: "#132631",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 14,
        elevation: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable
          ref={main}
          role="button"
          aria-label={
            over
              ? call.error
                ? "The call couldn’t start. See what to do"
                : "The call ended. See what was said"
              : `${name} · ${status}. Go back to the call`
          }
          onPress={() => call.expand(true)}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderRadius: 18,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          {/* A green ring while the agent can hear them. */}
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              borderWidth: 2,
              borderColor: live ? colors.liveOnInverse : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AgentAvatar size={32} onCall />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            {over ? (
              <Text
                numberOfLines={1}
                style={{ color: colors.onInverse, fontSize: 15, fontWeight: "700" }}
              >
                {call.error ? "The call couldn’t start" : "The call ended"}
              </Text>
            ) : (
              // The status never gives way to a long name.
              <View style={{ flexDirection: "row" }}>
                <Text
                  numberOfLines={1}
                  style={{
                    flexShrink: 1,
                    color: colors.onInverse,
                    fontSize: 15,
                    fontWeight: "700",
                  }}
                >
                  {name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    flexShrink: 0,
                    color: colors.onInverse,
                    fontSize: 15,
                    fontWeight: "700",
                  }}
                >
                  {/* A leading space is dropped at the start of a box on the web. */}
                  {`\u00a0· ${status}`}
                </Text>
              </View>
            )}
            <Text
              numberOfLines={over ? 2 : 1}
              style={[{ fontSize: 12, fontVariant: ["tabular-nums"] }, soft]}
            >
              {over
                ? call.error
                  ? "Tap to see what to do"
                  : "Tap to see what was said"
                : [time, "Tap to go back"].filter(Boolean).join(" · ")}
            </Text>
          </View>
        </Pressable>
        {/* Keyed apart, so a button that had focus isn't reused for a different one. */}
        {over ? (
          <Fragment key="over">
            <Pressable
              role="button"
              onPress={() => {
                if (Date.now() - overAt.current < 600) return;
                call.start();
                call.expand();
              }}
              style={({ pressed }) => ({
                minHeight: 44,
                paddingHorizontal: 14,
                borderRadius: 22,
                justifyContent: "center",
                // Quieter while something waits behind See it: that's the one thing to do.
                backgroundColor: row ? colors.onInverseSubtle : colors.surface,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text
                style={{
                  color: row ? colors.onInverse : colors.text,
                  fontSize: 15,
                  fontWeight: "700",
                }}
              >
                Talk again
              </Text>
            </Pressable>
            <Pressable
              role="button"
              aria-label="Close the call bar"
              {...tipProps("Close the call bar")}
              onPress={call.dismiss}
              style={({ pressed }) => [round("transparent"), { opacity: pressed ? 0.7 : 1 }]}
            >
              <X size={20} color={colors.onInverse} />
            </Pressable>
          </Fragment>
        ) : (
          <Fragment key="on">
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Pressable
                role="button"
                aria-label={call.muted ? "Unmute" : "Mute"}
                {...tipProps(call.muted ? "Unmute" : "Mute")}
                disabled={call.state === "connecting"}
                onPress={call.toggleMute}
                style={({ pressed }) => [
                  round(call.muted ? colors.surface : colors.onInverseSubtle),
                  { opacity: call.state === "connecting" ? 0.5 : pressed ? 0.8 : 1 },
                ]}
              >
                {call.muted ? (
                  <MicOff size={20} color={colors.text} />
                ) : (
                  <Mic size={20} color={colors.onInverse} />
                )}
              </Pressable>
              <Pressable
                role="button"
                aria-label="End the call"
                {...tipProps("End the call")}
                onPress={endCall}
                style={({ pressed }) => [round("#D93A40"), { opacity: pressed ? 0.85 : 1 }]}
              >
                <PhoneOff size={20} color="#FFFFFF" />
              </Pressable>
            </View>
          </Fragment>
        )}
      </View>
      {/* Two lines kept for the words all through the call, so the page below never jumps. */}
      {why ? (
        <Text
          numberOfLines={2}
          style={[{ fontSize: 14, lineHeight: 19, paddingHorizontal: 4 }, soft]}
        >
          {why}
        </Text>
      ) : null}
      {row || !over ? (
        // One height whether it holds the words or See it, so the page below never moves; 12px
        // clear of End above it, so a tap aimed here that lands high can't end the call.
        <View style={{ marginTop: 8, minHeight: 44, justifyContent: "center" }}>
          {row ? (
            // Something put on screen while the call is shrunk: a clear button to it, in place of the
            // words (the voice is saying it's here). An Approve card is behind it, never on the bar.
            <Pressable
              role="button"
              aria-label={`${rowWords(row)}. See it`}
              onPress={() => call.expand(true)}
              style={({ pressed }) => ({
                minHeight: 44,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingLeft: 12,
                paddingRight: 6,
                paddingVertical: 4,
                borderRadius: 18,
                backgroundColor: colors.onInverseSubtle,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              {row.kind === "ok" ? (
                <ShieldCheck size={20} color={colors.onInverse} />
              ) : row.kind === "connect" ? (
                <Link2 size={20} color={colors.onInverse} />
              ) : (
                <LayoutList size={20} color={colors.onInverse} />
              )}
              <View style={{ flex: 1, gap: 1 }}>
                <Text numberOfLines={1} style={[{ fontSize: 12 }, soft]}>
                  {[row.label, row.more ? `and ${row.more} more` : ""].filter(Boolean).join(" · ")}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: colors.onInverse, fontSize: 15, fontWeight: "700" }}
                >
                  {row.title}
                </Text>
              </View>
              {/* Already looked at and still waiting: a quieter reminder. */}
              <View
                style={{
                  minHeight: 36,
                  paddingHorizontal: 14,
                  borderRadius: 18,
                  justifyContent: "center",
                  backgroundColor: row.fresh ? colors.surface : "transparent",
                  borderWidth: row.fresh ? 0 : 1.5,
                  borderColor: colors.onInverse,
                }}
              >
                <Text
                  style={{
                    color: row.fresh ? colors.text : colors.onInverse,
                    fontSize: 15,
                    fontWeight: "700",
                  }}
                >
                  See it
                </Text>
              </View>
            </Pressable>
          ) : (
            <Text
              numberOfLines={2}
              onLayout={(event) => setQuoteWidth(Math.round(event.nativeEvent.layout.width))}
              style={{
                fontSize: 14,
                lineHeight: 19,
                paddingHorizontal: 4,
                color: colors.onInverse,
                opacity: 0.92,
              }}
            >
              {said ? `“${newest(said, room)}”` : ""}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}
