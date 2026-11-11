import {
  ArrowLeft,
  Bell,
  Camera,
  ChevronRight,
  Ellipsis,
  Mic,
  Search,
  WifiOff,
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
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  AutoFileNote,
  AutoFileOffer,
  CheckIt,
  DuplicateView,
  type Edge,
  EdgeView,
  FiledView,
  notificationsOff,
  ReadingView,
  RemindersNote,
  useNotificationsState,
} from "./receipt-box-check";
import {
  boxApi,
  countWaiting,
  dismissNotes,
  drainWaiting,
  loadBox,
  useAction,
  useBox,
} from "./receipt-box-data";
import { ReceiptDetail } from "./receipt-box-detail";
import {
  type BoxSummary,
  daysBetween,
  filterChips,
  filterReceipts,
  groupReceipts,
  localToday,
  moneyText,
  moneyWhole,
  needsWords,
  type Receipt,
  returnByText,
  type SnapAnswer,
} from "./receipt-box-logic";
import {
  amberFill,
  amberFillInk,
  amberInk,
  CategoryDot,
  OutlineButton,
  Pill,
  ReceiptTile,
  TealButton,
} from "./receipt-box-parts";
import {
  cameraIsBlocked,
  isOffline,
  pickAndSendNative,
  pickReceiptPhoto,
  refreshCamera,
  sendReceiptPhoto,
  shrinkReceiptPhoto,
} from "./receipt-box-photo";
import { queuePhoto } from "./receipt-box-queue";
import { colors, Sheet, SheetStatus, s } from "./ui";
import { voiceSettings } from "./voice";
import { dictate, dictationAvailable } from "./web-app";
import type { Detail } from "./workspace";
import { useWorkspace } from "./workspace";

/**
 * The Receipt box (docs/RECEIPT-BOX-PLAN.md): a sheet with the list of receipts (To check first,
 * then what is filed, newest first), the snap flow (Reading, then Check it, Filed or a card for what
 * went wrong), and one receipt's detail. On a wide window the list and a receipt sit side by side.
 */

export type ReceiptBoxStart = Extract<Detail, { type: "receipt-box" }>;

type Item =
  | { key: string; kind: "reading"; file?: File; preview?: string; tries: number }
  | { key: string; kind: "check"; receipt: Receipt; note?: string }
  | { key: string; kind: "filed"; receipt: Receipt }
  | { key: string; kind: "duplicate"; receipt: Receipt; error: string; busy: boolean }
  | { key: string; kind: "edge"; edge: Edge; file?: File; tries: number };

/** What an edge card is called, for the live region. */
const EDGE_TITLE: Record<Edge["kind"], string> = {
  unreadable: "I couldn’t read that one.",
  "not-a-receipt": "That doesn’t look like a receipt.",
  several: "There’s more than one receipt in that photo.",
  error: "I couldn’t read that one.",
  offline: "No connection right now.",
  camera: "I can’t use your camera.",
};

let counter = 0;
const newKey = () => `snap-${Date.now()}-${counter++}`;

/** From Home's card: the camera (or chooser) opens during the tap, then the box opens with the photo. */
export function snapFromHome(open: (detail: Detail) => void) {
  if (Platform.OS !== "web") return open({ type: "receipt-box", native: true });
  if (cameraIsBlocked()) return open({ type: "receipt-box", camera: "blocked" });
  void pickReceiptPhoto(true).then((photo) => photo && open({ type: "receipt-box", photo }));
}
export { refreshCamera };

export function ReceiptBoxSheet({ start }: { start?: ReceiptBoxStart }) {
  const { api, close, open, ask, draft } = useWorkspace();
  const { summary, failed, waiting, notes, refresh } = useBox(api);
  const notifications = useNotificationsState();
  const [view, setView] = useState<"list" | "flow" | "detail">(
    start?.photo || start?.native || start?.camera ? "flow" : start?.id ? "detail" : "list",
  );
  const [queue, setQueue] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string | undefined>(start?.id);
  const [search, setSearch] = useState("");
  const [chip, setChip] = useState<string>();
  const [width, setWidth] = useState(0);
  const [offerNote, setOfferNote] = useState("");
  const [listNote, setListNote] = useState("");
  const [menu, setMenu] = useState(false);
  const [cameraNo, setCameraNo] = useState(cameraIsBlocked());
  // File it / Snap the next one, pinned under the scrolling card so they're always in view.
  const [footer, setFooter] = useState<ReactNode | null>(null);
  // The one live region of the sheet: what just happened, read out (and what the call said).
  const inherited = useContext(SheetStatus);
  const [spoken, setSpoken] = useState("");
  const flip = useRef(false);
  const say = useCallback((text: string) => {
    flip.current = !flip.current;
    // A repeat of the same words is still a change, so it is read out again.
    setSpoken(text ? `${text}${flip.current ? "" : "\u200b"}` : "");
  }, []);
  const alive = useRef(true);
  const { height: windowHeight } = useWindowDimensions();
  const today = localToday();
  const wide = width >= 800;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    void refreshCamera().then(() => alive.current && setCameraNo(cameraIsBlocked()));
  }, []);
  // Photos that waited for a connection are read when the box is open and online.
  useEffect(() => {
    if (typeof navigator === "undefined" || navigator.onLine !== false) void drainWaiting(api);
    if (Platform.OS !== "web") return;
    const back = () => void drainWaiting(api);
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [api]);
  // Still offline, or the server was restarting: try the waiting photos again while the box is open.
  useEffect(() => {
    if (waiting <= 0) return;
    const timer = setInterval(() => void drainWaiting(api), 30_000);
    return () => clearInterval(timer);
  }, [api, waiting]);

  // ---- the queue (what the flow shows, in order)
  const put = useCallback((key: string, next: Item) => {
    setQueue((now) =>
      now.some((item) => item.key === key)
        ? now.map((item) => (item.key === key ? next : item))
        : [...now, next],
    );
  }, []);
  const drop = useCallback((key: string) => {
    setQueue((now) => {
      const item = now.find((entry) => entry.key === key);
      if (item?.kind === "reading" && item.preview && Platform.OS === "web")
        URL.revokeObjectURL(item.preview);
      return now.filter((entry) => entry.key !== key);
    });
  }, []);

  const apply = useCallback(
    (key: string, answer: SnapAnswer, file: File | undefined, tries: number) => {
      void loadBox(api);
      if ((answer.outcome === "to-check" || answer.outcome === "filed") && answer.receipt)
        return put(key, {
          key,
          kind: answer.outcome === "filed" ? "filed" : "check",
          receipt: answer.receipt,
        });
      if (answer.outcome === "duplicate" && answer.receipt)
        return put(key, {
          key,
          kind: "duplicate",
          receipt: answer.receipt,
          error: "",
          busy: false,
        });
      if (answer.outcome === "not-a-receipt")
        return put(key, { key, kind: "edge", edge: { kind: "not-a-receipt" }, tries });
      if (answer.outcome === "several")
        return put(key, { key, kind: "edge", edge: { kind: "several" }, tries });
      if (answer.outcome === "unreadable")
        return put(key, {
          key,
          kind: "edge",
          edge: { kind: "unreadable", fileKept: !!answer.fileId, again: tries > 0 },
          file,
          tries,
        });
      put(key, {
        key,
        kind: "edge",
        edge: {
          kind: "error",
          message: "I couldn’t read that one right now. Try again in a moment.",
        },
        file,
        tries,
      });
    },
    [api, put],
  );

  /** Shrinks the photo, sends it, and puts what came back in its place in the queue. */
  const read = useCallback(
    async (key: string, original: File, tries: number) => {
      let photo: File;
      try {
        photo = await shrinkReceiptPhoto(original);
      } catch (problem) {
        if (alive.current)
          put(key, {
            key,
            kind: "edge",
            edge: {
              kind: "error",
              message: problem instanceof Error ? problem.message : "I couldn’t use that photo.",
            },
            tries,
          });
        return;
      }
      try {
        const answer = await sendReceiptPhoto(api, photo, photo.name);
        if (alive.current) apply(key, answer, photo, tries);
        else void loadBox(api);
      } catch (problem) {
        if (isOffline(problem)) {
          // "Saved on this device" is said only when the device really kept it.
          const kept = await queuePhoto(photo);
          const count = await countWaiting(api);
          if (alive.current)
            put(key, { key, kind: "edge", edge: { kind: "offline", kept, waiting: count }, tries });
          return;
        }
        if (alive.current)
          put(key, {
            key,
            kind: "edge",
            edge: {
              kind: "error",
              message:
                problem instanceof Error && problem.message
                  ? problem.message
                  : "I couldn’t read that one. Try again.",
            },
            file: photo,
            tries,
          });
      }
    },
    [api, apply, put],
  );

  const begin = useCallback(
    (file: File) => {
      const key = newKey();
      const preview = Platform.OS === "web" ? URL.createObjectURL(file) : undefined;
      setQueue((now) => [...now, { key, kind: "reading", file, preview, tries: 0 }]);
      setView("flow");
      void read(key, file, 0);
    },
    [read],
  );
  const beginNative = useCallback(() => {
    const key = newKey();
    setQueue((now) => [...now, { key, kind: "reading", tries: 0 }]);
    setView("flow");
    pickAndSendNative(api).then(
      (answer) => {
        if (!alive.current) return;
        if (!answer) return drop(key);
        apply(key, answer, undefined, 0);
      },
      (problem: unknown) =>
        alive.current &&
        put(key, {
          key,
          kind: "edge",
          edge: {
            kind: "error",
            message: problem instanceof Error ? problem.message : "I couldn’t read that photo.",
          },
          tries: 0,
        }),
    );
  }, [api, apply, drop, put]);

  /** Snap: straight from a tap (the camera or chooser must open before anything is awaited). */
  const snap = useCallback(() => {
    if (Platform.OS !== "web") return beginNative();
    if (cameraIsBlocked()) {
      const key = newKey();
      setQueue((now) => [...now, { key, kind: "edge", edge: { kind: "camera" }, tries: 0 }]);
      return setView("flow");
    }
    void pickReceiptPhoto(true).then((file) => file && alive.current && begin(file));
  }, [begin, beginNative]);
  /** Choose a photo already taken, without the camera. */
  const choose = useCallback(
    (key: string) => {
      void pickReceiptPhoto(false).then((file) => {
        if (!file || !alive.current) return;
        drop(key);
        begin(file);
      });
    },
    [begin, drop],
  );

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (start?.photo) begin(start.photo);
    else if (start?.native) beginNative();
    else if (start?.camera)
      setQueue([{ key: newKey(), kind: "edge", edge: { kind: "camera" }, tries: 0 }]);
  }, [start, begin, beginNative]);

  /** Everything waiting to check, in the flow (those already in it aren't added twice). */
  const checkAll = useCallback(
    (from?: BoxSummary) => {
      const list = (from ?? summary)?.receipts.filter((r) => r.status === "to-check") ?? [];
      if (!list.length) return;
      setQueue((now) => {
        const have = new Set(now.flatMap((item) => ("receipt" in item ? [item.receipt.id] : [])));
        const fresh: Item[] = list
          .filter((r) => !have.has(r.id))
          .map((receipt) => ({ key: `check-${receipt.id}`, kind: "check" as const, receipt }));
        return [...now, ...fresh];
      });
      setView("flow");
    },
    [summary],
  );
  const checkOne = useCallback((receipt: Receipt) => {
    setQueue((now) =>
      now.some((item) => "receipt" in item && item.receipt.id === receipt.id)
        ? now
        : [...now, { key: `check-${receipt.id}`, kind: "check", receipt }],
    );
    setView("flow");
  }, []);
  const wantsCheck = useRef(start?.view === "check");
  useEffect(() => {
    if (wantsCheck.current && summary) {
      wantsCheck.current = false;
      checkAll(summary);
    }
  }, [summary, checkAll]);

  // On a wide window a receipt is always showing beside the list: the newest filed one to begin with.
  const picked = useRef(false);
  useEffect(() => {
    if (!wide || picked.current || selected || !summary) return;
    const first = summary.receipts.find((r) => r.status === "filed");
    if (first) {
      picked.current = true;
      setSelected(first.id);
    }
  }, [wide, selected, summary]);

  // A new page starts at its top, not where the last one was scrolled to (the sheet has one scroll),
  // is announced, and takes keyboard and screen-reader focus on its heading.
  const top = useRef<View>(null);
  const first = useRef(true);
  const flowHead = queue.find((item) => item.kind !== "reading") ?? queue[0];
  const page = `${view}:${flowHead?.key ?? ""}:${flowHead?.kind ?? ""}:${wide ? "" : (selected ?? "")}`;
  const announcement =
    view !== "flow" || !flowHead
      ? ""
      : flowHead.kind === "reading"
        ? "Reading your receipt."
        : flowHead.kind === "check"
          ? `Read. Check it. ${flowHead.receipt.merchant ?? "A receipt"}.`
          : flowHead.kind === "filed"
            ? "Filed."
            : flowHead.kind === "duplicate"
              ? "This looks like one you already have."
              : EDGE_TITLE[flowHead.edge.kind];
  const announceNow = useRef(announcement);
  announceNow.current = announcement;
  useEffect(() => {
    void page;
    if (Platform.OS !== "web") return;
    const node0 = top.current as unknown as HTMLElement | null;
    let node = node0?.parentElement;
    while (
      node &&
      !(
        /(auto|scroll)/.test(getComputedStyle(node).overflowY) &&
        node.scrollHeight > node.clientHeight
      )
    )
      node = node.parentElement;
    if (node) node.scrollTop = 0;
    const opening = first.current;
    first.current = false;
    if (announceNow.current) say(announceNow.current);
    // The sheet's own focus trap runs first: move after it (CLAUDE.md), and not on the list when
    // it first opens (the sheet's close button is where focus starts).
    if (opening && view === "list") return;
    const timer = setTimeout(() => {
      const heading = node0?.querySelector<HTMLElement>('[role="heading"]');
      if (!heading) return;
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [page, say, view]);

  // The flow has nothing left: back to the list.
  useEffect(() => {
    if (view === "flow" && queue.length === 0) setView("list");
  }, [view, queue.length]);

  const head = queue.find((item) => item.kind !== "reading") ?? queue[0];
  const reading = queue.filter((item) => item.kind === "reading").length;
  const checks = queue.filter((item) => item.kind === "check");

  const goBack = () => {
    if (menu) return setMenu(false);
    if (view === "list") return close();
    setView("list");
    setSelected(wide ? selected : undefined);
    void refresh();
  };

  const openReceipt = (receipt: Receipt) => {
    if (receipt.status === "to-check") return checkOne(receipt);
    setSelected(receipt.id);
    if (!wide) setView("detail");
  };
  const sayInChat = (text: string, send = false) => {
    close();
    if (send) ask(text);
    else draft(text);
  };

  // ---- what goes in the sheet
  const filed = summary?.receipts.filter((r) => r.status === "filed") ?? [];
  const toCheck = summary?.receipts.filter((r) => r.status === "to-check") ?? [];
  const title =
    view === "flow" && head?.kind === "check"
      ? "Check it"
      : view === "flow" && head?.kind === "filed"
        ? "Filed"
        : "Receipt box";

  // "Next": the card on view goes to the back of the line.
  const rotate = () =>
    setQueue((now) => {
      const item = now.find((entry) => entry.key === head?.key);
      return item && now.length > 1 ? [...now.filter((entry) => entry !== item), item] : now;
    });

  const flow = () => {
    if (!head) return null;
    switch (head.kind) {
      case "reading":
        return <ReadingView preview={head.preview} others={reading - 1} onAnother={snap} />;
      case "check":
        return (
          <CheckIt
            key={head.key}
            api={api}
            receipt={head.receipt}
            onFooter={setFooter}
            header={
              checks.length > 1 || head.note ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={[s.muted, { flex: 1 }]}>{head.note ?? ""}</Text>
                  {checks.length > 1 && (
                    <Pressable
                      role="button"
                      aria-label={`Next receipt. This is 1 of ${checks.length}`}
                      onPress={rotate}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        minHeight: 44,
                        paddingHorizontal: 14,
                        borderRadius: 22,
                        backgroundColor: colors.sky,
                      }}
                    >
                      <Text style={{ color: colors.blueText, fontSize: 16, fontWeight: "800" }}>
                        1 of {checks.length}
                      </Text>
                      <ChevronRight size={16} color={colors.blueText} />
                    </Pressable>
                  )}
                </View>
              ) : undefined
            }
            onFiled={(receipt) => put(head.key, { key: head.key, kind: "filed", receipt })}
            onLater={() => {
              // Said where they land next (the list, or the next receipt to check).
              setListNote("Left in To check.");
              say("Left in To check.");
              drop(head.key);
            }}
            onDeleted={() => {
              setListNote("Deleted. It’s gone from your Receipt box.");
              drop(head.key);
            }}
            onChanged={() => void refresh()}
          />
        );
      case "filed":
        return (
          <FiledView
            key={head.key}
            api={api}
            receipt={head.receipt}
            onFooter={setFooter}
            monthLine={
              summary && summary.filedThisMonth > 0
                ? `${summary.filedThisMonth} ${summary.filedThisMonth === 1 ? "receipt" : "receipts"} · ${moneyWhole(summary.monthTotal)}`
                : undefined
            }
            more={toCheck.filter((r) => r.id !== head.receipt.id).length}
            onUndo={(back) => put(head.key, { key: head.key, kind: "check", receipt: back })}
            onCheckMore={() => {
              drop(head.key);
              checkAll();
            }}
            onSnap={() => {
              drop(head.key);
              snap();
            }}
            onBox={() => {
              drop(head.key);
              setView("list");
            }}
            onChangeReturn={() => {
              setSelected(head.receipt.id);
              drop(head.key);
              setView("detail");
            }}
            extra={
              summary?.autoFile.offer && !offerNote ? (
                <View style={{ alignSelf: "stretch" }}>
                  <AutoFileOffer api={api} onAnswered={(on) => setOfferNote(on ? "on" : "off")} />
                </View>
              ) : offerNote ? (
                <View style={{ alignSelf: "stretch" }}>
                  <AutoFileNote on={offerNote === "on"} />
                </View>
              ) : undefined
            }
          />
        );
      case "duplicate": {
        const other = summary?.receipts.find((r) => r.id === head.receipt.duplicateOf);
        return (
          <DuplicateView
            other={other}
            busy={head.busy}
            error={head.error}
            onKeep={() => {
              say("Kept both. Check this one like any other.");
              put(head.key, {
                key: head.key,
                kind: "check",
                receipt: head.receipt,
                note: "Kept both. Check this one like any other.",
              });
            }}
            onSkip={() => {
              put(head.key, { ...head, busy: true, error: "" });
              boxApi.remove(api, head.receipt.id).then(
                () => {
                  if (!alive.current) return;
                  setListNote("Skipped. I didn’t keep that photo.");
                  say("Skipped. I didn’t keep that photo.");
                  drop(head.key);
                },
                (problem: unknown) =>
                  alive.current &&
                  put(head.key, {
                    ...head,
                    busy: false,
                    error:
                      problem instanceof Error ? problem.message : "Couldn’t skip it. Try again.",
                  }),
              );
            }}
          />
        );
      }
      case "edge":
        return (
          <EdgeView
            edge={head.edge}
            onDone={() => drop(head.key)}
            onNewPhoto={() => {
              drop(head.key);
              snap();
            }}
            onChoose={() => choose(head.key)}
            onHow={() => open({ type: "help", topic: "receipts" })}
            onTryAgain={() => {
              if (!head.file) {
                drop(head.key);
                return snap();
              }
              const file = head.file;
              put(head.key, { key: head.key, kind: "reading", file, tries: head.tries + 1 });
              void read(head.key, file, head.tries + 1);
            }}
          />
        );
    }
  };

  const narrowFlow = { width: "100%" as const, maxWidth: 560, alignSelf: "center" as const };

  const list = (
    <BoxList
      summary={summary}
      failed={failed}
      waiting={waiting}
      notes={notes}
      listNote={listNote}
      today={today}
      search={search}
      setSearch={setSearch}
      chip={chip}
      setChip={setChip}
      selected={wide ? selected : undefined}
      onOpen={openReceipt}
      onCheckAll={() => checkAll()}
      onSnap={snap}
      menu={menu}
      setMenu={setMenu}
      offerNote={offerNote}
      onOffer={(on) => setOfferNote(on ? "on" : "off")}
      notifications={notifications}
      reading={reading}
      onReadingOpen={() => setView("flow")}
      onSay={sayInChat}
      onSaid={say}
      stacked={!wide}
      cameraNo={cameraNo}
    />
  );

  // The sheet's height on a wide window (see Sheet's `fill`) less its header and padding.
  const paneHeight = Math.max(320, Math.min(windowHeight * 0.9, 860) - 150);

  return (
    <SheetStatus.Provider value={spoken || inherited}>
      <Sheet
        title={title}
        onClose={view === "list" ? close : goBack}
        closeIcon={view === "list" ? undefined : ArrowLeft}
        closeLabel={view === "list" ? "Close" : "Back to the Receipt box"}
        onBack={goBack}
        wide
        fill={wide}
        footer={
          view === "flow" && footer ? (
            // As wide as the card above it, not the whole modal.
            <View style={{ width: "100%", maxWidth: 560, alignSelf: "center" }}>{footer}</View>
          ) : undefined
        }
      >
        <View ref={top} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {view === "flow" ? (
            <View style={narrowFlow}>{flow()}</View>
          ) : view === "detail" && selected && !wide ? (
            <View style={narrowFlow}>
              <DetailPane
                id={selected}
                onNeedsCheck={checkOne}
                onUnfiled={(receipt) => {
                  setSelected(undefined);
                  checkOne(receipt);
                }}
                onDeleted={(name) => {
                  setListNote(`Deleted the ${name} receipt. It’s gone from your Receipt box.`);
                  setSelected(undefined);
                  setView("list");
                }}
                onGone={() => {
                  setSelected(undefined);
                  setView("list");
                }}
                onSay={sayInChat}
              />
            </View>
          ) : wide ? (
            // Side by side, each with its own scroll: choosing a row low in the list doesn't move the
            // receipt beside it, and nothing is cut off at the sheet's edge.
            <View style={{ flexDirection: "row", gap: 28, height: paneHeight }}>
              <ScrollView
                style={{ width: 400, flexGrow: 0, flexShrink: 0 }}
                contentContainerStyle={{ paddingBottom: 8 }}
                showsVerticalScrollIndicator
              >
                {list}
              </ScrollView>
              <ScrollView
                style={{ flex: 1, minWidth: 0 }}
                contentContainerStyle={{ paddingBottom: 8 }}
              >
                {selected ? (
                  <DetailPane
                    id={selected}
                    onNeedsCheck={checkOne}
                    onUnfiled={(receipt) => {
                      setSelected(undefined);
                      checkOne(receipt);
                    }}
                    onDeleted={(name) => {
                      setListNote(`Deleted the ${name} receipt. It’s gone from your Receipt box.`);
                      setSelected(undefined);
                    }}
                    onGone={() => setSelected(undefined)}
                    onSay={sayInChat}
                  />
                ) : (
                  <View
                    style={{
                      padding: 28,
                      borderRadius: 22,
                      backgroundColor: colors.subtle,
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <ReceiptTile size={56} />
                    <Text style={[s.muted, { textAlign: "center" }]}>
                      {filed.length
                        ? "Pick a receipt to see it here."
                        : "Receipts you file show up here."}
                    </Text>
                  </View>
                )}
              </ScrollView>
            </View>
          ) : (
            list
          )}
        </View>
      </Sheet>
    </SheetStatus.Provider>
  );
}

function DetailPane({
  id,
  onNeedsCheck,
  onUnfiled,
  onDeleted,
  onGone,
  onSay,
}: {
  id: string;
  onNeedsCheck: (receipt: Receipt) => void;
  onUnfiled: (receipt: Receipt) => void;
  onDeleted: (name: string) => void;
  onGone: () => void;
  onSay: (text: string, send?: boolean) => void;
}) {
  const { api } = useWorkspace();
  return (
    <ReceiptDetail
      api={api}
      id={id}
      onNeedsCheck={onNeedsCheck}
      onUnfiled={onUnfiled}
      onDeleted={onDeleted}
      onGone={onGone}
      onChanged={() => void loadBox(api)}
      hint={(receipt) => onSay(`Where’s my ${receipt.merchant ?? "latest"} receipt?`, true)}
    />
  );
}

// ------------------------------------------------------------------------------ the list

function BoxList({
  summary,
  failed,
  waiting,
  notes,
  listNote,
  today,
  search,
  setSearch,
  chip,
  setChip,
  selected,
  onOpen,
  onCheckAll,
  onSnap,
  menu,
  setMenu,
  offerNote,
  onOffer,
  notifications,
  reading,
  onReadingOpen,
  onSay,
  onSaid,
  stacked,
  cameraNo,
}: {
  summary?: BoxSummary;
  failed: boolean;
  waiting: number;
  notes: string[];
  listNote: string;
  today: string;
  search: string;
  setSearch: (text: string) => void;
  chip?: string;
  setChip: (key?: string) => void;
  selected?: string;
  onOpen: (receipt: Receipt) => void;
  onCheckAll: () => void;
  onSnap: () => void;
  menu: boolean;
  setMenu: (open: boolean) => void;
  offerNote: string;
  onOffer: (on: boolean) => void;
  notifications?: ReturnType<typeof useNotificationsState>;
  reading: number;
  onReadingOpen: () => void;
  onSay: (text: string, send?: boolean) => void;
  /** Tells the sheet's live region what just happened. */
  onSaid: (text: string) => void;
  stacked: boolean;
  cameraNo: boolean;
}) {
  const { api } = useWorkspace();
  const everything = summary?.receipts ?? [];
  const shown = useMemo(
    () => filterReceipts(everything, { chip, text: search }),
    [everything, chip, search],
  );
  const waitingChecks = shown.filter((r) => r.status === "to-check");
  const groups = useMemo(
    () =>
      groupReceipts(
        shown.filter((r) => r.status === "filed"),
        today,
      ),
    [shown, today],
  );
  const chips = useMemo(() => filterChips(everything), [everything]);
  const hasReturns = everything.some(
    (r) => r.status === "filed" && r.returnBy && r.returnState === "open",
  );
  const filtering = !!chip || !!search.trim();
  const sample = everything.find((r) => r.status === "filed" && r.merchant)?.merchant ?? "Best Buy";
  void cameraNo;

  return (
    <View style={{ gap: 14 }}>
      {/* What changed on its own: a failed read, photos read after a connection came back. */}
      {notes.length > 0 && (
        <View
          style={{
            gap: 8,
            padding: 14,
            borderRadius: 18,
            backgroundColor: colors.sky,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          {notes.map((note) => (
            <Text key={note} style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>
              {note}
            </Text>
          ))}
          <View style={{ alignSelf: "flex-start" }}>
            <OutlineButton onPress={dismissNotes}>Okay</OutlineButton>
          </View>
        </View>
      )}
      {waiting > 0 && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 14,
            borderRadius: 18,
            backgroundColor: colors.subtle,
          }}
        >
          <WifiOff size={20} color={colors.mutedStrong} />
          <Text style={{ flex: 1, color: colors.text, fontSize: 15, lineHeight: 21 }}>
            {waiting === 1
              ? "1 photo is waiting to be read."
              : `${waiting} photos are waiting to be read.`}{" "}
            I’ll read {waiting === 1 ? "it" : "them"} once you’re back online and the app is open.
          </Text>
        </View>
      )}
      {reading > 0 && (
        <Pressable
          role="button"
          aria-label={`Reading ${reading} receipt${reading === 1 ? "" : "s"}. Show`}
          onPress={onReadingOpen}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            minHeight: 52,
            paddingHorizontal: 16,
            borderRadius: 18,
            backgroundColor: colors.sky,
          }}
        >
          <Text style={{ flex: 1, color: colors.text, fontSize: 16, fontWeight: "600" }}>
            Reading {reading === 1 ? "a receipt" : `${reading} receipts`}…
          </Text>
          <ChevronRight size={18} color={colors.muted} />
        </Pressable>
      )}
      {!!listNote && <Text style={[s.muted, { color: colors.text }]}>{listNote}</Text>}

      {summary?.autoFile.offer && !offerNote && <AutoFileOffer api={api} onAnswered={onOffer} />}
      {!!offerNote && <AutoFileNote on={offerNote === "on"} />}

      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <SearchBox value={search} onChange={setSearch} />
        <MoreButton open={menu} onPress={() => setMenu(!menu)} />
      </View>
      {menu && <AutoFileSwitch api={api} on={summary?.autoFile.on ?? false} onSaid={onSaid} />}

      {summary && !summary.available && everything.length === 0 && (
        <Text style={s.muted}>
          Reading receipts isn’t set up on this server yet, so there’s nothing to snap.
        </Text>
      )}
      {failed && !summary && (
        <Text style={s.muted}>Couldn’t load your receipts. Close the box and open it again.</Text>
      )}
      {!summary && !failed && <Text style={s.muted}>Opening your receipts…</Text>}

      {summary && summary.toCheck > 0 && (
        <Pressable
          role="button"
          aria-label={`${summary.toCheck} receipt${summary.toCheck === 1 ? "" : "s"} to check. Check it`}
          onPress={onCheckAll}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 56,
            paddingHorizontal: 16,
            borderRadius: 18,
            backgroundColor: colors.orange,
          }}
        >
          <Text
            aria-hidden
            style={{
              color: amberInk,
              fontSize: 20,
              fontWeight: "800",
              width: 22,
              textAlign: "center",
            }}
          >
            !
          </Text>
          <Text style={{ flex: 1, color: colors.text, fontSize: 17, fontWeight: "600" }}>
            {summary.toCheck} {summary.toCheck === 1 ? "receipt" : "receipts"} to check
          </Text>
          <Text style={{ color: amberInk, fontSize: 17, fontWeight: "800" }}>Check it</Text>
          <ChevronRight size={18} color={amberInk} />
        </Pressable>
      )}

      {summary?.available !== false && (
        <TealButton
          id="snap-list"
          label="Snap a receipt"
          icon={Camera}
          onPress={onSnap}
          accessibilityLabel="Snap a receipt"
        />
      )}

      {summary && everything.length > 0 && chips.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: 24 }}
        >
          <FilterChip label="All" selected={!chip} onPress={() => setChip(undefined)} />
          {chips.map((item) => (
            <FilterChip
              key={item.key}
              label={item.label}
              count={item.count}
              dot={item.kind === "cat" ? item.label : undefined}
              bell={item.label === "Return window"}
              selected={chip === item.key}
              onPress={() => setChip(chip === item.key ? undefined : item.key)}
            />
          ))}
        </ScrollView>
      )}

      {waitingChecks.length > 0 && (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 32 }}>
            <Text role="heading" aria-level={3} style={heading}>
              To check
            </Text>
            <Pill tone="amber">{waitingChecks.length}</Pill>
          </View>
          <RowCard>
            {waitingChecks.map((r, at) => (
              <ReceiptRow
                key={r.id}
                receipt={r}
                today={today}
                first={at === 0}
                selected={false}
                onPress={() => onOpen(r)}
              />
            ))}
          </RowCard>
        </View>
      )}

      {groups.map((group) => (
        <View key={group.key} style={{ gap: 6 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <Text role="heading" aria-level={3} style={[heading, { fontSize: 24 }]}>
              {group.label}
            </Text>
            <Text style={s.muted}>
              {moneyWhole(group.total)} · {group.count} {group.count === 1 ? "receipt" : "receipts"}
            </Text>
          </View>
          {group.days.map((day) => (
            <View key={day.key} style={{ gap: 6 }}>
              <Text style={dayHeading}>{day.label}</Text>
              <RowCard>
                {day.items.map((r, at) => (
                  <ReceiptRow
                    key={r.id}
                    receipt={r}
                    today={today}
                    first={at === 0}
                    selected={selected === r.id}
                    onPress={() => onOpen(r)}
                  />
                ))}
              </RowCard>
            </View>
          ))}
        </View>
      ))}

      {summary && filtering && shown.length === 0 && (
        <View style={{ gap: 8, alignItems: "flex-start" }}>
          <Text style={s.muted}>
            {search.trim()
              ? `Nothing matches “${search.trim()}”.`
              : "Nothing is filed under that yet."}
          </Text>
          <OutlineButton
            onPress={() => {
              setSearch("");
              setChip(undefined);
            }}
          >
            Show everything
          </OutlineButton>
        </View>
      )}

      {summary && everything.length === 0 && summary.available && (
        <View style={{ alignItems: "center", gap: 10, paddingVertical: 20 }}>
          <ReceiptTile size={64} />
          <Text
            role="heading"
            aria-level={3}
            style={[heading, { fontSize: 22, textAlign: "center" }]}
          >
            Snap your first receipt
          </Text>
          <Text style={[s.muted, { textAlign: "center", maxWidth: 380 }]}>
            Take a photo and I’ll read the store, the date and the total. You check it, then it’s
            filed. If the receipt has a return window, I keep the date.
          </Text>
        </View>
      )}

      {(hasReturns || (summary?.closingSoon.length ?? 0) > 0) &&
        notificationsOff(notifications) && <RemindersNote api={api} state={notifications} />}

      <View style={{ gap: 6 }}>
        <Text style={[s.small, { fontSize: 14, fontWeight: "700" }]}>You can also say</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Phrase text="File this receipt" onPress={() => onSay("File this receipt")} />
          <Phrase
            text="What’s waiting to check?"
            onPress={() => onSay("What’s waiting to check?", true)}
          />
          <Phrase
            text={`Where’s my ${sample} receipt?`}
            onPress={() => onSay(`Where’s my ${sample} receipt?`, true)}
          />
        </View>
        {stacked ? null : null}
      </View>
    </View>
  );
}

const heading = {
  color: colors.text,
  fontSize: 18,
  fontWeight: "800" as const,
  letterSpacing: -0.3,
};
const dayHeading = {
  color: colors.mutedStrong,
  fontSize: 12,
  fontWeight: "700" as const,
  letterSpacing: 1,
  textTransform: "uppercase" as const,
  marginTop: 6,
};

function RowCard({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        borderRadius: 22,
        overflow: "hidden",
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      {children}
    </View>
  );
}

function ReceiptRow({
  receipt,
  today,
  first,
  selected,
  onPress,
}: {
  receipt: Receipt;
  today: string;
  first: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const check = receipt.status === "to-check";
  const returning =
    !check &&
    receipt.returnBy &&
    receipt.returnState === "open" &&
    daysBetween(today, receipt.returnBy) >= 0;
  const name = receipt.merchant ?? "Receipt";
  const label = [
    name,
    moneyText(receipt.total, receipt.currency),
    receipt.category,
    check ? needsWords(receipt) : returning ? returnByText(receipt.returnBy as string, today) : "",
    receipt.autoFiled ? "Filed by Neddy" : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable
      role="button"
      aria-label={`${label}. ${check ? "Check it" : "Open"}`}
      aria-current={selected ? "true" : undefined}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 68,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.line,
        borderLeftWidth: 4,
        borderLeftColor: selected ? colors.blueDark : "transparent",
        backgroundColor: check
          ? colors.orange
          : selected
            ? colors.blue
            : pressed
              ? colors.subtle
              : "transparent",
      })}
    >
      <ReceiptTile size={40} tint={check} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text
          numberOfLines={check ? 2 : 1}
          style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}
        >
          {name}
        </Text>
        {check ? (
          <Text numberOfLines={1} style={{ color: amberInk, fontSize: 15, fontWeight: "600" }}>
            {needsWords(receipt)}
          </Text>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <CategoryDot category={receipt.category} />
              <Text style={{ color: colors.mutedStrong, fontSize: 15 }}>{receipt.category}</Text>
            </View>
            {returning ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Bell size={13} color={colors.blueText} />
                <Text style={{ color: colors.blueText, fontSize: 15, fontWeight: "700" }}>
                  {returnByText(receipt.returnBy as string, today)}
                </Text>
              </View>
            ) : null}
            {receipt.autoFiled ? (
              <Text style={{ color: colors.blueText, fontSize: 13, fontWeight: "700" }}>
                Filed by Neddy
              </Text>
            ) : null}
          </View>
        )}
      </View>
      {check ? (
        <View
          aria-hidden
          style={{
            minHeight: 40,
            justifyContent: "center",
            paddingHorizontal: 12,
            borderRadius: 20,
            backgroundColor: amberFill,
          }}
        >
          <Text style={{ color: amberFillInk, fontSize: 15, fontWeight: "800" }}>Check it</Text>
        </View>
      ) : (
        <Text style={{ color: colors.text, fontSize: 19, fontWeight: "800" }}>
          {moneyText(receipt.total, receipt.currency)}
        </Text>
      )}
    </Pressable>
  );
}

function FilterChip({
  label,
  count,
  dot,
  bell,
  selected,
  onPress,
}: {
  label: string;
  count?: number;
  dot?: string;
  bell?: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      role="button"
      aria-pressed={selected}
      aria-label={count ? `${label}, ${count}` : label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        minHeight: 44,
        paddingHorizontal: 16,
        borderRadius: 22,
        borderWidth: 1.5,
        borderColor: selected ? colors.blueDark : colors.line,
        backgroundColor: selected ? colors.blue : colors.card,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {bell ? <Bell size={15} color={colors.blueText} /> : null}
      {dot ? <CategoryDot category={dot} size={10} /> : null}
      <Text
        style={{ color: selected ? colors.blueText : colors.text, fontSize: 16, fontWeight: "700" }}
      >
        {label}
      </Text>
      {count ? (
        <Text style={{ color: colors.mutedStrong, fontSize: 15, fontWeight: "700" }}>{count}</Text>
      ) : null}
    </Pressable>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState("");
  // The focus ring is the pill's teal border, not the browser's black rectangle around the text.
  const [focused, setFocused] = useState(false);
  const stop = useRef<() => void>(undefined);
  const canListen = dictationAvailable();
  useEffect(() => () => stop.current?.(), []);
  const listen = () => {
    if (listening) return stop.current?.();
    setProblem("");
    setListening(true);
    stop.current = dictate(
      (heard) => onChange(heard.replace(/[.?!]+$/, "")),
      (error) => {
        setListening(false);
        stop.current = undefined;
        if (error) setProblem(error);
      },
      voiceSettings().microphone,
    );
  };
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 48,
          paddingLeft: 14,
          paddingRight: 4,
          borderRadius: 24,
          backgroundColor: colors.surface,
          borderWidth: focused || listening ? 2 : 1,
          borderColor: focused || listening ? colors.blueDark : colors.line,
        }}
      >
        <Search size={18} color={colors.muted} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={listening ? "Listening…" : "Search or say “Costco”"}
          placeholderTextColor={listening ? colors.blueDark : colors.muted}
          accessibilityLabel="Search receipts"
          returnKeyType="search"
          selectionColor={colors.blueDark}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, minHeight: 44 },
            // react-native-web: no outline of its own (the pill shows focus).
            Platform.OS === "web" ? ({ outlineStyle: "none", outlineWidth: 0 } as object) : null,
          ]}
        />
        {!!value && (
          <Pressable
            role="button"
            aria-label="Clear the search"
            onPress={() => onChange("")}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <X size={16} color={colors.mutedStrong} />
          </Pressable>
        )}
        {canListen && (
          <Pressable
            role="button"
            aria-label={listening ? "Stop listening" : "Search by voice"}
            onPress={listen}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Mic size={20} color={colors.blueDark} />
          </Pressable>
        )}
      </View>
      {!!problem && <Text style={s.small}>{problem}</Text>}
    </View>
  );
}

function MoreButton({ open, onPress }: { open: boolean; onPress: () => void }) {
  return (
    <Pressable
      role="button"
      aria-label="More: auto-filing"
      aria-expanded={open}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed || open ? colors.subtle : colors.surface,
        borderWidth: 1,
        borderColor: colors.line,
      })}
    >
      <Ellipsis size={20} color={colors.text} />
    </Pressable>
  );
}

/** The ⋯ menu's one setting: whether Neddy files the receipts she reads clearly (a toggle, like every feature). */
function AutoFileSwitch({
  api,
  on,
  onSaid,
}: {
  api: ReturnType<typeof useWorkspace>["api"];
  on: boolean;
  onSaid: (text: string) => void;
}) {
  const { busy, run } = useAction();
  const [said, setSaid] = useState("");
  const toggle = async () => {
    const next = !on;
    const ok = await run("auto", () => boxApi.autoFile(api, next));
    // Said only when the save really went through.
    const text = ok
      ? next
        ? "Auto-filing is on. I’ll file the ones I read clearly and leave the rest in To check. I can still get a total wrong."
        : "Auto-filing is off. Every receipt waits for you to check it."
      : "Couldn’t change that. Try again.";
    setSaid(text);
    onSaid(text);
  };
  return (
    <View
      style={[
        s.card,
        { gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 20, padding: 14 },
      ]}
    >
      <Pressable
        role="switch"
        aria-checked={on}
        aria-label="File receipts I read clearly, myself"
        disabled={!!busy}
        onPress={() => void toggle()}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52 }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>
            File receipts I read clearly, myself
          </Text>
          <Text style={s.muted}>
            {on
              ? "On. Anything I’m unsure about still waits for you."
              : "Off. Every receipt waits for you to check it."}
          </Text>
        </View>
        <View
          style={{
            width: 52,
            height: 32,
            borderRadius: 16,
            padding: 3,
            justifyContent: "center",
            backgroundColor: on ? colors.blueDark : colors.edge,
            opacity: busy ? 0.6 : 1,
          }}
        >
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: "#FFFFFF",
              alignSelf: on ? "flex-end" : "flex-start",
            }}
          />
        </View>
      </Pressable>
      {!!said && <Text style={s.muted}>{said}</Text>}
    </View>
  );
}

function Phrase({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <Pressable
      role="button"
      aria-label={`Say it in the chat: ${text}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 44,
        paddingHorizontal: 14,
        borderRadius: 22,
        backgroundColor: pressed ? colors.subtle : colors.card,
        borderWidth: 1,
        borderColor: colors.line,
      })}
    >
      <Mic size={14} color={colors.blueDark} />
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>{`“${text}”`}</Text>
    </Pressable>
  );
}
