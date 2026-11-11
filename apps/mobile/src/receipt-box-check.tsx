import {
  Bell,
  BellOff,
  Camera,
  CameraOff,
  Check,
  ChevronRight,
  Copy,
  FileQuestion,
  Pencil,
  Search,
  Undo2,
  WifiOff,
} from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Image, Linking, Platform, Pressable, Text, View } from "react-native";
import type { MuseApi } from "./api";
import { Mascot, useReducedMotion } from "./avatar";
import { useLiveCallOn } from "./live-voice";
import { boxApi, useAction } from "./receipt-box-data";
import { EditForm } from "./receipt-box-edit";
import {
  CATEGORIES,
  doubts,
  fileBlock,
  isNotInBox,
  KEEP_FOR,
  keepForChange,
  localToday,
  longDate,
  maskedTotal,
  moneyText,
  type Receipt,
  reminderOn,
  returnByText,
  shortDate,
  unsureFields,
} from "./receipt-box-logic";
import {
  amberInk,
  Callout,
  CategoryDot,
  ChoiceChip,
  FileFooter,
  InfoCard,
  OutlineButton,
  Pill,
  ReceiptTile,
  TealButton,
  TextAction,
} from "./receipt-box-parts";
import { colors, ErrorNotice, s } from "./ui";
import { enablePush, type PushState, pushState } from "./web-app";

/** A receipt and a fresh link to its photo (links expire after 15 minutes, so one is fetched each time). */
export function useReceiptPhoto(api: MuseApi, receipt: Receipt) {
  const [photoUrl, setPhotoUrl] = useState<string | null>();
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let live = true;
    setPhotoUrl(undefined);
    boxApi.one(api, receipt.id).then(
      (answer) => live && setPhotoUrl(answer.photoUrl),
      (error: unknown) => {
        if (live && isNotInBox(error)) setGone(true);
        if (live) setPhotoUrl(null);
      },
    );
    return () => {
      live = false;
    };
  }, [api, receipt.id]);
  return { photoUrl, gone };
}

export const openPhoto = (url: string) => void Linking.openURL(url);

// ------------------------------------------------------------------ small shared cards

/** "Delete this receipt?": what goes, and that it can't come back. */
export function DeleteConfirm({
  onDelete,
  onKeep,
  busy,
  error,
}: {
  onDelete: () => void;
  onKeep: () => void;
  busy?: boolean;
  error?: string;
}) {
  return (
    <View
      role="alertdialog"
      aria-label="Delete this receipt?"
      style={[s.card, { gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 24 }]}
    >
      <Text role="heading" aria-level={3} style={[s.heading, { fontSize: 18 }]}>
        Delete this receipt?
      </Text>
      <Text style={s.muted}>
        This removes the photo, the details and any return or warranty reminders from your Receipt
        box. It can’t be undone.
      </Text>
      <ErrorNotice error={error} />
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Pressable
          role="button"
          aria-label="Delete"
          disabled={busy}
          onPress={onDelete}
          style={({ pressed }) => ({
            flexGrow: 1,
            minHeight: 48,
            borderRadius: 24,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
            backgroundColor: colors.danger,
            opacity: busy ? 0.6 : pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>Delete</Text>
        </Pressable>
        <View style={{ flexGrow: 1 }}>
          <OutlineButton onPress={onKeep} disabled={busy}>
            Keep it
          </OutlineButton>
        </View>
      </View>
    </View>
  );
}

let remindersNotNow = false;
/** Whether notifications are really off on this device (undefined: not known, or a phone app). */
export function useNotificationsState(): PushState | undefined {
  const [state, setState] = useState<PushState>();
  useEffect(() => {
    if (Platform.OS !== "web") return;
    let live = true;
    void pushState().then(
      (found) => live && setState(found),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
/** The note shows only when reminders can't reach this device: off, blocked, or not installed yet (iPhone). */
export const notificationsOff = (state?: PushState) =>
  state === "off" || state === "blocked" || state === "install-first";

/** "Reminders need notifications": only when they are really off here. "Not now" holds for the session. */
export function RemindersNote({ api, state }: { api: MuseApi; state?: PushState }) {
  const [hidden, setHidden] = useState(remindersNotNow);
  const [now, setNow] = useState(state);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => setNow(state), [state]);
  if (hidden || !notificationsOff(now)) return note ? <Text style={s.muted}>{note}</Text> : null;
  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush(api);
      setNow("on");
      setNote("Notifications are on. I’ll remind you before a return window closes.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Couldn’t turn notifications on.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <InfoCard
      icon={BellOff}
      tint="neutral"
      title="Reminders need notifications."
      actions={
        <>
          {now === "off" && (
            <OutlineButton primary busy={busy} onPress={() => void turnOn()}>
              Turn on notifications
            </OutlineButton>
          )}
          <OutlineButton
            onPress={() => {
              remindersNotNow = true;
              setHidden(true);
            }}
          >
            Not now
          </OutlineButton>
        </>
      }
    >
      <Text style={s.muted}>
        {now === "blocked"
          ? "They’re blocked for this site in your browser’s settings. Home will show return dates that are close."
          : now === "install-first"
            ? "Add this app to your Home Screen to turn them on. Home will show return dates that are close."
            : "They’re off on this device. Home will show return dates that are close."}
      </Text>
      {!!note && <Text style={[s.muted, { color: colors.text }]}>{note}</Text>}
    </InfoCard>
  );
}

let offerNotNow = false;
/** "Want me to file new receipts myself?" after ten good checks in a row (the server decides when). */
export function AutoFileOffer({
  api,
  onAnswered,
}: {
  api: MuseApi;
  onAnswered: (on: boolean) => void;
}) {
  const [hidden, setHidden] = useState(offerNotNow);
  const { busy, error, run } = useAction();
  const reduce = useReducedMotion();
  if (hidden) return null;
  const answer = async (on: boolean) => {
    const ok = await run(on ? "on" : "off", () => boxApi.autoFile(api, on));
    // Only a saved answer counts: a failure leaves the offer here, with what went wrong.
    if (!ok) return;
    // "No thanks" is an answer too (the server is told, so it doesn't ask again).
    if (!on) {
      offerNotNow = true;
      setHidden(true);
    }
    onAnswered(on);
  };
  return (
    <View
      role="group"
      aria-label="Want me to file new receipts myself?"
      style={[s.card, { gap: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 24 }]}
    >
      <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
        <Mascot size={52} character="neddy" animated={!reduce} />
        <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
          <Text role="heading" aria-level={3} style={[s.heading, { fontSize: 18, lineHeight: 24 }]}>
            Want me to file new receipts myself?
          </Text>
          <Text style={s.muted}>
            You’ve checked 10 in a row without changing anything. I’ll file the ones I read clearly
            and leave the rest in To check. I can still get a total wrong, so you can look them over
            any time.
          </Text>
        </View>
      </View>
      <ErrorNotice error={error} />
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <TealButton
          id="auto-on"
          label="Turn on auto-filing"
          busy={busy === "on"}
          disabled={busy === "off"}
          height={48}
          onPress={() => void answer(true)}
          style={{ flexGrow: 1 }}
        />
        <View style={{ flexGrow: 1, minWidth: 120 }}>
          <OutlineButton
            busy={busy === "off"}
            disabled={busy === "on"}
            onPress={() => void answer(false)}
          >
            No thanks
          </OutlineButton>
        </View>
      </View>
      <Text style={s.small}>
        Say no thanks and I won’t ask again. You can turn it on any time in the ⋯ menu.
      </Text>
    </View>
  );
}

/** What was just decided about auto-filing, said where the offer was. */
export function AutoFileNote({ on }: { on: boolean }) {
  return (
    <View
      style={{
        padding: 14,
        borderRadius: 18,
        backgroundColor: colors.sky,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>
        {on
          ? "Auto-filing is on. I’ll file the ones I read clearly and leave the rest in To check. I can still get a total wrong. Turn it off any time in the ⋯ menu."
          : "Okay, I won’t ask again. You can turn auto-filing on any time in the ⋯ menu."}
      </Text>
    </View>
  );
}

// ------------------------------------------------------------------ Reading

/** The Reading state: the photo with a light passing over it, and what is really happening. */
export function ReadingView({
  preview,
  onAnother,
  others,
}: {
  preview?: string;
  onAnother: () => void;
  /** Other photos being read at the same time. */
  others: number;
}) {
  const reduce = useReducedMotion();
  const scan = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scan, { toValue: 1, duration: 1600, useNativeDriver: false }),
        Animated.timing(scan, { toValue: 0, duration: 0, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scan, reduce]);
  const top = scan.interpolate({ inputRange: [0, 1], outputRange: ["4%", "92%"] });
  return (
    <View style={{ alignItems: "center", gap: 14 }}>
      <Mascot size={72} character="neddy" animated={!reduce} mood="idle" />
      <Text role="heading" aria-level={2} style={[s.title, { fontSize: 30, textAlign: "center" }]}>
        Reading your receipt
      </Text>
      <Text style={[s.muted, { textAlign: "center", fontSize: 16 }]}>
        Usually a few seconds. No typing.
      </Text>
      <View
        aria-label="Your photo, being read"
        role="img"
        style={{
          width: 210,
          height: 260,
          borderRadius: 14,
          overflow: "hidden",
          backgroundColor: colors.subtle,
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        {preview ? (
          <Image
            source={{ uri: preview }}
            resizeMode="cover"
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ReceiptTile size={64} />
          </View>
        )}
        {!reduce && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top,
              height: 3,
              backgroundColor: colors.blueDark,
              opacity: 0.85,
            }}
          />
        )}
      </View>
      <View style={{ gap: 12, alignSelf: "center", paddingVertical: 4 }}>
        <Step done label="Photo ready" />
        <Step label="Reading the store, date and total" />
      </View>
      <View style={{ alignSelf: "stretch", gap: 8, marginTop: 6 }}>
        <OutlineButton icon={Camera} onPress={onAnother}>
          Snap another while I read
        </OutlineButton>
        <Text style={[s.small, { textAlign: "center", fontSize: 14 }]}>
          {others > 0
            ? `${others} more ${others === 1 ? "is" : "are"} being read. Each one waits for you in “To check”.`
            : "Each one waits for you in “To check”."}
        </Text>
      </View>
    </View>
  );
}

function Step({ done, label }: { done?: boolean; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View
        aria-hidden
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: done ? colors.greenDark : "transparent",
          borderWidth: done ? 0 : 3,
          borderColor: colors.blue,
          borderTopColor: colors.blueDark,
        }}
      >
        {done ? <Check size={16} color="#FFFFFF" strokeWidth={3} /> : null}
      </View>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: done ? "500" : "700" }}>
        {label}
      </Text>
    </View>
  );
}

// ------------------------------------------------------------------ Check it

function Photo({
  url,
  gone,
  onOpen,
}: {
  url: string | null | undefined;
  gone: boolean;
  onOpen: () => void;
}) {
  return (
    <View style={{ width: 112, height: 150 }}>
      <View
        style={{
          flex: 1,
          borderRadius: 12,
          overflow: "hidden",
          backgroundColor: colors.subtle,
          borderWidth: 1,
          borderColor: colors.line,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {url ? (
          <Image
            source={{ uri: url }}
            resizeMode="cover"
            accessibilityLabel="Photo of the receipt"
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <ReceiptTile size={48} />
        )}
      </View>
      {!!url && !gone && (
        <Pressable
          role="button"
          aria-label="Open the photo, bigger"
          onPress={onOpen}
          style={{
            position: "absolute",
            right: -8,
            bottom: -8,
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.blueDark,
          }}
        >
          <Search size={20} color="#FFFFFF" />
        </Pressable>
      )}
    </View>
  );
}

/**
 * The Check it card: what Neddy read, the doubts marked amber, the total to choose when it
 * couldn't tell, keep-for tags, and File it. It's used in the box, and in the chat for a live
 * result (`compact`). Nothing is filed until File it is tapped (or said).
 */
export function CheckIt({
  api,
  receipt,
  header,
  onFiled,
  onLater,
  onDeleted,
  onChanged,
  onFooter,
  canSay,
}: {
  api: MuseApi;
  receipt: Receipt;
  /** The title row of the card (the sheet draws its own). */
  header?: ReactNode;
  onFiled: (receipt: Receipt) => void;
  onLater: () => void;
  onDeleted: () => void;
  onChanged?: (receipt: Receipt) => void;
  /**
   * Where File it goes when the host pins it below the scrolling card (the sheet's footer). Without
   * it, File it sits at the end of the card (the chat).
   */
  onFooter?: (node: ReactNode | null) => void;
  /** A chat is open to say "file it" in (hints say so only then). */
  canSay?: boolean;
}) {
  const [r, setR] = useState(receipt);
  // A different receipt in the same place starts over.
  const seen = useRef(receipt.id);
  useEffect(() => {
    if (seen.current !== receipt.id) {
      seen.current = receipt.id;
      setR(receipt);
      setEditing(undefined);
      setPicking(false);
      setConfirming(false);
      setChose(false);
    }
  }, [receipt]);
  const { photoUrl, gone } = useReceiptPhoto(api, r);
  const { busy, error, run, clear } = useAction();
  const [editing, setEditing] = useState<"merchant" | "date" | "total" | "returnBy" | "all">();
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [chose, setChose] = useState(false);
  const [addReturn, setAddReturn] = useState(false);
  const today = localToday();
  const unsure = unsureFields(r);
  const lines = doubts(r);
  // "Say it" is true in a chat, or while a call is on; in the box alone there is only the tap.
  const onCall = useLiveCallOn();
  const sayable = !!canSay || onCall;
  const block = fileBlock(r, sayable);
  // Only choosing a total settles the readings (the server clears them); nothing else lifts it.
  const choosing = r.candidates.length > 1;
  const [picked, setPicked] = useState<number>();
  const fileNow = useRef<() => void>(() => undefined);
  fileNow.current = () => {
    clear();
    void run("file", () => boxApi.file(api, r.id)).then((filed) => filed && onFiled(filed));
  };
  const filing = busy === "file";
  // The host's pinned File it (and its reason, and a failure), kept in step with the card.
  useEffect(() => {
    if (!onFooter) return;
    onFooter(
      editing || confirming ? null : (
        <FileFooter
          disabled={!!block}
          busy={filing}
          error={error}
          hint={
            block ??
            (sayable
              ? "Say “file it” or tap. Nothing is filed until you do."
              : "Nothing is filed until you tap File it.")
          }
          onPress={() => fileNow.current()}
        />
      ),
    );
  }, [onFooter, block, filing, error, sayable, editing, confirming]);
  useEffect(() => () => onFooter?.(null), [onFooter]);
  const hasReturn = r.keepFor.includes("Return window");

  const save = async (change: Parameters<typeof boxApi.update>[2], name: string) => {
    const next = await run(name, () => boxApi.update(api, r.id, change));
    if (next) {
      setR(next);
      onChanged?.(next);
    }
    return next;
  };

  if (editing)
    return (
      <View style={{ gap: 14 }}>
        {header}
        <Text role="heading" aria-level={3} style={s.heading}>
          Change what I read
        </Text>
        <EditForm
          api={api}
          receipt={r}
          autoFocus={editing === "all" ? undefined : editing}
          addReturn={addReturn}
          onCancel={() => {
            setAddReturn(false);
            setEditing(undefined);
          }}
          onSaved={(next) => {
            setR(next);
            onChanged?.(next);
            setAddReturn(false);
            setEditing(undefined);
          }}
        />
      </View>
    );

  const total = choosing
    ? (maskedTotal(r.candidates, r.currency) ?? "Which total?")
    : moneyText(r.total, r.currency);
  return (
    <View style={{ gap: 14 }}>
      {/* The page's heading for screen readers (focus moves here when the card appears). */}
      <Text
        role="heading"
        aria-level={2}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
      >
        {`Check it: ${r.merchant ?? "a receipt"}`}
      </Text>
      {header}
      <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-start" }}>
        <Photo url={photoUrl} gone={gone} onOpen={() => photoUrl && openPhoto(photoUrl)} />
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <EditableLine
            label={r.merchant ? `Store: ${r.merchant}` : "Store: not read"}
            action="Change the store"
            onEdit={() => setEditing("merchant")}
            unsure={unsure.has("merchant")}
          >
            <Text
              numberOfLines={2}
              style={{
                color: r.merchant ? colors.text : amberInk,
                fontSize: 24,
                fontWeight: "800",
                letterSpacing: -0.5,
                flexShrink: 1,
              }}
            >
              {r.merchant ?? "Add the store"}
            </Text>
          </EditableLine>
          <EditableLine
            label={`Date: ${r.date ? longDate(r.date) : "not read"}`}
            action="Change the date"
            onEdit={() => setEditing("date")}
            unsure={unsure.has("date")}
          >
            <Text
              style={{
                color: r.date ? colors.mutedStrong : amberInk,
                fontSize: 16,
                flexShrink: 1,
              }}
            >
              {r.date ? longDate(r.date) : "Add the date"}
            </Text>
          </EditableLine>
          <Pressable
            role="button"
            aria-label={`Total: ${choosing ? "not sure yet" : moneyText(r.total, r.currency)}. Change the total`}
            onPress={() => setEditing("total")}
            style={{
              alignSelf: "flex-start",
              minHeight: 56,
              justifyContent: "center",
              paddingHorizontal: 14,
              borderRadius: 16,
              borderWidth: unsure.has("total") ? 2 : 0,
              borderColor: colors.amber,
              backgroundColor: unsure.has("total") ? colors.orange : "transparent",
              marginLeft: unsure.has("total") ? 0 : -14,
            }}
          >
            <Text
              style={{
                color: r.total === null && !choosing ? amberInk : colors.text,
                fontSize: 34,
                fontWeight: "800",
                letterSpacing: -1,
              }}
            >
              {r.total === null && !choosing ? "Add total" : total}
            </Text>
          </Pressable>
        </View>
      </View>

      {lines.length > 0 && (
        <Callout>
          {lines.map((line, at) => (
            <View key={line} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
              <Text
                aria-hidden
                style={{
                  color: amberInk,
                  fontSize: 16,
                  fontWeight: "800",
                  width: 18,
                  textAlign: "center",
                }}
              >
                {at === 0 ? "!" : "·"}
              </Text>
              <Text
                style={{
                  flex: 1,
                  color: colors.text,
                  fontSize: 16,
                  lineHeight: 23,
                  fontWeight: at === 0 ? "600" : "400",
                }}
              >
                {line}
              </Text>
            </View>
          ))}
          {choosing && (
            <View
              role="radiogroup"
              aria-label="Which total is right?"
              style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}
            >
              {r.candidates.map((value) => (
                <Pressable
                  key={value}
                  role="radio"
                  aria-checked={picked === value}
                  aria-label={`${moneyText(value, r.currency)} is the total`}
                  disabled={!!busy}
                  onPress={() => {
                    setPicked(value);
                    void save({ total: value }, `total-${value}`).then((next) => {
                      if (!next) setPicked(undefined);
                    });
                  }}
                  style={({ pressed }) => ({
                    flexGrow: 1,
                    flexBasis: 120,
                    minHeight: 56,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: picked === value ? colors.blue : colors.card,
                    borderWidth: 1.5,
                    borderColor: picked === value ? colors.blueDark : colors.edge,
                    opacity: busy && picked !== value ? 0.6 : pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800" }}>
                    {moneyText(value, r.currency)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {!choosing && (r.total === null || !r.merchant) && (
            <View style={{ alignSelf: "flex-start" }}>
              <OutlineButton onPress={() => setEditing("all")}>Add it</OutlineButton>
            </View>
          )}
        </Callout>
      )}

      <View
        style={[
          s.card,
          {
            padding: 0,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 22,
            overflow: "hidden",
          },
        ]}
      >
        <Pressable
          role="button"
          aria-expanded={picking}
          aria-label={`Category: ${r.category}. ${chose ? "You chose this." : "I picked this."} Tap to change`}
          onPress={() => setPicking(!picking)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            minHeight: 72,
            padding: 16,
          }}
        >
          <Text style={{ width: 86, color: colors.mutedStrong, fontSize: 16 }}>Category</Text>
          <View style={{ flex: 1, gap: 4 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 7,
                alignSelf: "flex-start",
                backgroundColor: colors.blue,
                paddingHorizontal: 12,
                paddingVertical: 5,
                borderRadius: 16,
              }}
            >
              <CategoryDot category={r.category} size={11} />
              <Text style={{ color: colors.blueText, fontSize: 16, fontWeight: "700" }}>
                {r.category}
              </Text>
            </View>
            <Text style={s.muted}>
              {chose ? "You chose this." : "I picked this. Tap to change."}
            </Text>
          </View>
          <ChevronRight
            size={18}
            color={colors.muted}
            style={{ transform: [{ rotate: picking ? "90deg" : "0deg" }] }}
          />
        </Pressable>
        {picking && (
          <View
            role="radiogroup"
            aria-label="Category"
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 16, paddingTop: 4 }}
          >
            {CATEGORIES.map((name) => (
              <ChoiceChip
                key={name}
                radio
                dot={name}
                label={name}
                selected={r.category === name}
                onPress={() => {
                  setPicking(false);
                  if (name !== r.category) {
                    setChose(true);
                    void save({ category: name }, "category");
                  }
                }}
              />
            ))}
          </View>
        )}
        {!!r.paidLast4 && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              minHeight: 72,
              padding: 16,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
          >
            <Text style={{ width: 86, color: colors.mutedStrong, fontSize: 16 }}>Paid with</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>
                Card ending {r.paidLast4}
              </Text>
              <Text style={s.muted}>
                I keep only the last 4 digits I read. The photo stays as you took it.
              </Text>
            </View>
          </View>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 16 }}>
          <Text style={{ fontWeight: "800" }}>Keep it for</Text> (optional)
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {KEEP_FOR.map((tag) => (
            <ChoiceChip
              key={tag}
              label={tag}
              selected={r.keepFor.includes(tag)}
              disabled={!!busy}
              onPress={() => {
                const on = !r.keepFor.includes(tag);
                // Turning Return window on needs a date: the editor opens with the usual 30 days ready.
                if (tag === "Return window" && on && !r.returnBy) {
                  setAddReturn(true);
                  return setEditing("returnBy");
                }
                void save(keepForChange(r, tag, on), `tag-${tag}`);
              }}
            />
          ))}
        </View>
      </View>

      {hasReturn && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 14,
            borderRadius: 18,
            backgroundColor: colors.sky,
            minHeight: 64,
          }}
        >
          <Bell size={22} color={colors.blueDark} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800" }}>
              {r.returnBy ? returnByText(r.returnBy, today) : "No return date yet"}
            </Text>
            <Text style={s.muted}>
              {r.returnBy
                ? r.returnDays
                  ? `The receipt mentions ${r.returnDays} days.`
                  : "You chose this date."
                : "I didn’t find a return policy. Add a date yourself?"}
            </Text>
          </View>
          <TextAction
            label={r.returnBy ? "Change" : "Add a date"}
            accessibilityLabel={r.returnBy ? "Change the return-by date" : "Add a return-by date"}
            onPress={() => setEditing("returnBy")}
          />
        </View>
      )}

      {!onFooter && (
        <FileFooter
          inline
          disabled={!!block}
          busy={filing}
          error={error}
          hint={
            block ??
            (sayable
              ? "Say “file it” or tap. Nothing is filed until you do."
              : "Nothing is filed until you tap File it.")
          }
          onPress={() => fileNow.current()}
        />
      )}
      {confirming ? (
        <DeleteConfirm
          busy={busy === "delete"}
          error={error}
          onKeep={() => setConfirming(false)}
          onDelete={() =>
            void run("delete", () => boxApi.remove(api, r.id)).then((done) => done && onDeleted())
          }
        />
      ) : (
        <View style={{ flexDirection: "row", justifyContent: "space-around", flexWrap: "wrap" }}>
          <TextAction label="Check later" onPress={onLater} />
          <TextAction
            label="Not a receipt"
            accessibilityLabel="That’s not a receipt"
            onPress={() => setConfirming(true)}
          />
        </View>
      )}
    </View>
  );
}

/** A line with a small pencil that opens the editor; unsure ones carry an amber mark. */
function EditableLine({
  children,
  label,
  action,
  onEdit,
  unsure,
}: {
  children: ReactNode;
  label: string;
  action: string;
  onEdit: () => void;
  unsure?: boolean;
}) {
  return (
    <Pressable
      role="button"
      aria-label={`${label}. ${action}`}
      onPress={onEdit}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 44,
        flexWrap: "wrap",
      }}
    >
      {children}
      {unsure ? <Pill tone="amber">Check</Pill> : null}
      <Pencil size={16} color={colors.mutedStrong} />
    </Pressable>
  );
}

// ------------------------------------------------------------------ Filed

/**
 * Filed (by a tap, or by Neddy when auto-filing is on): what was filed, Undo for a minute, the
 * reminder that was set, and what comes next.
 */
export function FiledView({
  api,
  receipt,
  monthLine,
  more,
  onUndo,
  onCheckMore,
  onSnap,
  onBox,
  onChangeReturn,
  extra,
  onFooter,
}: {
  api: MuseApi;
  receipt: Receipt;
  /** "32 receipts · $1,345" this month, when known. */
  monthLine?: string;
  /** How many more are waiting to check. */
  more: number;
  onUndo: (back: Receipt) => void;
  onCheckMore: () => void;
  onSnap: () => void;
  onBox: () => void;
  onChangeReturn: () => void;
  extra?: ReactNode;
  /** Where the next steps go when the host pins them under the scrolling card. */
  onFooter?: (node: ReactNode | null) => void;
}) {
  const [left, setLeft] = useState(60);
  const { busy, error, run } = useAction();
  const notifications = useNotificationsState();
  useEffect(() => {
    const timer = setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, []);
  const today = localToday();
  // The day the reminder really goes off, from the server; never a computed one.
  const when = reminderOn(receipt);
  const month = receipt.date ? longMonth(receipt.date) : "";
  const snapNext = useRef(onSnap);
  snapNext.current = onSnap;
  const showBox = useRef(onBox);
  showBox.current = onBox;
  const next = (
    <View style={{ alignSelf: "stretch", gap: 2 }}>
      <TealButton
        id="snap-next"
        label="Snap the next one"
        icon={Camera}
        onPress={() => snapNext.current()}
      />
      <View style={{ alignItems: "center" }}>
        <TextAction label="See the Receipt box" onPress={() => showBox.current()} />
      </View>
    </View>
  );
  useEffect(() => {
    onFooter?.(next);
    // `next` only holds buttons that call the latest handlers through refs.
  }, [onFooter]);
  useEffect(() => () => onFooter?.(null), [onFooter]);
  return (
    <View style={{ alignItems: "center", gap: 12 }}>
      <View
        aria-hidden
        style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.green,
        }}
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.greenDark,
          }}
        >
          <Check size={36} color="#FFFFFF" strokeWidth={3.2} />
        </View>
      </View>
      <Text role="heading" aria-level={2} style={[s.title, { fontSize: 32, letterSpacing: -1 }]}>
        Filed
      </Text>
      <View style={{ alignItems: "center", gap: 3 }}>
        <Text style={{ color: colors.text, fontSize: 21, fontWeight: "800", textAlign: "center" }}>
          {receipt.merchant ?? "Receipt"} · {moneyText(receipt.total, receipt.currency)}
        </Text>
        <Text style={[s.muted, { fontSize: 16 }]}>
          {receipt.category}
          {month ? ` · ${month}` : ""}
        </Text>
        {receipt.autoFiled && (
          <View style={{ alignItems: "center", marginTop: 4 }}>
            <Pill tone="teal">Filed by Neddy</Pill>
          </View>
        )}
      </View>
      <View style={{ alignItems: "center", gap: 6 }}>
        {left > 0 ? (
          <OutlineButton
            icon={Undo2}
            busy={busy === "undo"}
            accessibilityLabel="Undo: move it back to To check"
            onPress={() =>
              void run("undo", () => boxApi.unfile(api, receipt.id)).then(
                (back) => back && onUndo(back),
              )
            }
          >
            Undo
          </OutlineButton>
        ) : null}
        <Text style={[s.small, { fontSize: 14, textAlign: "center", maxWidth: 320 }]}>
          {left > 0
            ? "For the next minute. After that, use the receipt’s ⋯ menu."
            : "Use the receipt’s ⋯ menu to move it back to To check."}
        </Text>
        <ErrorNotice error={error} />
      </View>

      {receipt.returnBy && (
        <View
          style={{
            alignSelf: "stretch",
            flexDirection: "row",
            gap: 14,
            padding: 16,
            borderRadius: 22,
            backgroundColor: colors.sky,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.blueDark,
            }}
          >
            <Bell size={24} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>
              {when
                ? `Reminder on ${shortDate(when, today)}`
                : returnByText(receipt.returnBy, today)}
            </Text>
            <Text style={s.muted}>
              {when
                ? `The return window closes on ${shortDate(receipt.returnBy, today)}.`
                : "I couldn’t set a reminder for that date, but Home will show it when it’s close."}
            </Text>
            <View style={{ alignSelf: "flex-start", marginLeft: -10 }}>
              <TextAction
                label="Change"
                accessibilityLabel="Change the return-by date"
                onPress={onChangeReturn}
              />
            </View>
          </View>
        </View>
      )}
      {receipt.returnBy && notificationsOff(notifications) && (
        <View style={{ alignSelf: "stretch" }}>
          <RemindersNote api={api} state={notifications} />
        </View>
      )}
      {extra}
      {monthLine && (
        <Pressable
          role="button"
          aria-label={`This month: ${monthLine}. Open the Receipt box`}
          onPress={onBox}
          style={{
            alignSelf: "stretch",
            flexDirection: "row",
            alignItems: "center",
            minHeight: 64,
            paddingHorizontal: 18,
            borderRadius: 22,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.muted}>This month</Text>
            <Text style={{ color: colors.text, fontSize: 19, fontWeight: "800" }}>{monthLine}</Text>
          </View>
          <ChevronRight size={20} color={colors.muted} />
        </Pressable>
      )}
      {more > 0 && (
        <Pressable
          role="button"
          aria-label={`${more} more to check. Check it`}
          onPress={onCheckMore}
          style={{
            alignSelf: "stretch",
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 56,
            paddingHorizontal: 18,
            borderRadius: 18,
            backgroundColor: colors.orange,
          }}
        >
          <Text aria-hidden style={{ color: amberInk, fontSize: 18, fontWeight: "800" }}>
            !
          </Text>
          <Text style={{ flex: 1, color: colors.text, fontSize: 17, fontWeight: "600" }}>
            {more} more to check
          </Text>
          <Text style={{ color: amberInk, fontSize: 17, fontWeight: "800" }}>Check it</Text>
        </Pressable>
      )}
      {!onFooter && <View style={{ alignSelf: "stretch", marginTop: 6 }}>{next}</View>}
    </View>
  );
}

const longMonth = (day: string) => {
  const [y, m] = day.split("-");
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${names[Number(m) - 1] ?? ""}${y && Number(y) !== new Date().getFullYear() ? ` ${y}` : ""}`;
};

// ------------------------------------------------------------------ When it isn't simple

export type Edge =
  | { kind: "unreadable"; fileKept: boolean; again: boolean }
  | { kind: "not-a-receipt" }
  | { kind: "several" }
  | { kind: "error"; message: string }
  | { kind: "offline"; kept: boolean; waiting: number }
  | { kind: "camera" };

/** The cards for what can go wrong with a photo, each saying what happened and what is next. */
export function EdgeView({
  edge,
  onTryAgain,
  onNewPhoto,
  onDone,
  onChoose,
  onHow,
}: {
  edge: Edge;
  onTryAgain: () => void;
  /** Take or choose another photo. */
  onNewPhoto: () => void;
  onDone: () => void;
  onChoose: () => void;
  onHow: () => void;
}) {
  const [kept, setKept] = useState(false);
  switch (edge.kind) {
    case "unreadable":
      return kept ? (
        <InfoCard
          icon={Copy}
          tint="neutral"
          title="Kept."
          actions={<OutlineButton onPress={onDone}>Okay</OutlineButton>}
        >
          <Text style={s.muted}>The photo is in Files. I haven’t filed anything.</Text>
        </InfoCard>
      ) : (
        <InfoCard
          icon={Camera}
          title="I couldn’t read that one."
          actions={
            <>
              <TealButton
                id="again"
                label="Try again"
                height={48}
                onPress={onTryAgain}
                style={{ flexGrow: 1 }}
              />
              <View style={{ flexGrow: 1 }}>
                <OutlineButton onPress={() => setKept(true)}>Save the photo anyway</OutlineButton>
              </View>
              {edge.again ? <TextAction label="Take a new photo" onPress={onNewPhoto} /> : null}
            </>
          }
        >
          <Text style={s.muted}>
            {edge.again
              ? "It still wouldn’t read. Try again with the receipt flat and the light on it."
              : "Try again with the receipt flat and the light on it."}
          </Text>
        </InfoCard>
      );
    case "not-a-receipt":
      return (
        <InfoCard
          icon={FileQuestion}
          title="That doesn’t look like a receipt."
          actions={
            <>
              <TealButton
                id="another"
                label="Try another"
                height={48}
                onPress={onNewPhoto}
                style={{ flexGrow: 1 }}
              />
              <View style={{ flexGrow: 1 }}>
                <OutlineButton onPress={onDone}>Done</OutlineButton>
              </View>
            </>
          }
        >
          <Text style={s.muted}>I haven’t filed it. Want to try another?</Text>
        </InfoCard>
      );
    case "several":
      return (
        <InfoCard
          icon={Copy}
          title="There’s more than one receipt in that photo."
          actions={
            <>
              <TealButton
                id="another"
                label="Try another"
                height={48}
                onPress={onNewPhoto}
                style={{ flexGrow: 1 }}
              />
              <View style={{ flexGrow: 1 }}>
                <OutlineButton onPress={onDone}>Done</OutlineButton>
              </View>
            </>
          }
        >
          <Text style={s.muted}>
            I can’t file them together, so I haven’t filed any. Snap them one at a time.
          </Text>
        </InfoCard>
      );
    case "error":
      return (
        <InfoCard
          icon={Camera}
          title="I couldn’t read that one."
          actions={
            <>
              <TealButton
                id="again"
                label="Try again"
                height={48}
                onPress={onTryAgain}
                style={{ flexGrow: 1 }}
              />
              <View style={{ flexGrow: 1 }}>
                <OutlineButton onPress={onDone}>Done</OutlineButton>
              </View>
            </>
          }
        >
          <Text style={s.muted}>{edge.message}</Text>
        </InfoCard>
      );
    case "offline":
      return (
        <InfoCard
          icon={WifiOff}
          tint="neutral"
          title="No connection right now."
          actions={<OutlineButton onPress={onDone}>Okay</OutlineButton>}
        >
          <Text style={s.muted}>
            {edge.kept
              ? "Your photo is saved on this device. I’ll read it once you’re back online and the app is open."
              : "I couldn’t keep the photo on this device either, so take it again once you’re back online."}
          </Text>
          {edge.kept && edge.waiting > 0 ? (
            <View style={{ marginTop: 6 }}>
              <Pill>{edge.waiting} waiting to be read</Pill>
            </View>
          ) : null}
        </InfoCard>
      );
    case "camera":
      return (
        <InfoCard
          icon={CameraOff}
          title="I can’t use your camera."
          actions={
            <>
              <TealButton
                id="choose"
                label="Choose a photo"
                height={48}
                onPress={onChoose}
                style={{ flexGrow: 1 }}
              />
              <View style={{ flexGrow: 1 }}>
                <OutlineButton onPress={onHow}>Show me how</OutlineButton>
              </View>
            </>
          }
        >
          <Text style={s.muted}>
            Turn it on in your settings, or choose a photo you already took.
          </Text>
        </InfoCard>
      );
  }
}

/** The duplicate card: what it looks like, and the two ways out. */
export function DuplicateView({
  other,
  busy,
  error,
  onSkip,
  onKeep,
}: {
  other?: Receipt;
  busy: boolean;
  error: string;
  onSkip: () => void;
  onKeep: () => void;
}) {
  const today = localToday();
  const what = other
    ? `It matches the ${other.merchant ?? "same"} receipt from ${other.date === today ? "today" : shortDate(other.date, today)} (${moneyText(other.total, other.currency)}).`
    : "It has the same store, date and total as one already in your box.";
  return (
    <InfoCard
      icon={Copy}
      title="This looks like one you already have."
      actions={
        <>
          <TealButton
            id="keep-both"
            label="Keep both"
            height={48}
            disabled={busy}
            onPress={onKeep}
            style={{ flexGrow: 1 }}
          />
          <View style={{ flexGrow: 1 }}>
            <OutlineButton busy={busy} onPress={onSkip}>
              Skip this one
            </OutlineButton>
          </View>
        </>
      }
    >
      <Text style={s.muted}>{what} Keep both, or skip this one and discard its photo?</Text>
      <ErrorNotice error={error} />
    </InfoCard>
  );
}
