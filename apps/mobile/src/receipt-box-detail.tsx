import {
  Bell,
  Download,
  Ellipsis,
  Pencil,
  Search,
  Share2,
  ShieldCheck,
  StickyNote,
  Trash2,
  Undo2,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import type { MuseApi } from "./api";
import { DeleteConfirm, openPhoto } from "./receipt-box-check";
import { boxApi, useAction } from "./receipt-box-data";
import { EditForm } from "./receipt-box-edit";
import {
  daysBetween,
  daysLeft,
  isNotInBox,
  localToday,
  longDate,
  moneyText,
  type Receipt,
  reminderOn,
  returnByText,
  shortDate,
} from "./receipt-box-logic";
import { CategoryDot, OutlineButton, ReceiptTile } from "./receipt-box-parts";
import { colors, ErrorNotice, s } from "./ui";
import { isInstalled, isIos } from "./web-app";

/**
 * One filed receipt: its photo, the facts, the return date with what to do about it, a warranty
 * note, Edit, and a ⋯ menu to move it back to To check or delete it. A fresh link to the photo is
 * asked for each time it opens (links expire).
 */
export function ReceiptDetail({
  api,
  id,
  onNeedsCheck,
  onUnfiled,
  onDeleted,
  onChanged,
  onGone,
  hint,
}: {
  api: MuseApi;
  id: string;
  /** The receipt turned out to be waiting for a check (not filed): the box opens it there instead. */
  onNeedsCheck: (receipt: Receipt) => void;
  onUnfiled: (receipt: Receipt) => void;
  onDeleted: (name: string) => void;
  onChanged?: () => void;
  onGone: () => void;
  /** What to say to ask for it again ("Where's my Best Buy receipt?"). */
  hint?: (receipt: Receipt) => void;
}) {
  const [loaded, setLoaded] = useState<{ receipt: Receipt; photoUrl: string | null }>();
  const [failed, setFailed] = useState("");
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const { busy, error, run, clear } = useAction();

  const load = useCallback(async () => {
    try {
      const answer = await boxApi.one(api, id);
      setLoaded(answer);
      setFailed("");
      if (answer.receipt.status === "to-check") onNeedsCheck(answer.receipt);
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : "";
      setFailed(isNotInBox(problem) ? "gone" : message || "Couldn’t open this receipt.");
    }
  }, [api, id, onNeedsCheck]);
  useEffect(() => {
    setLoaded(undefined);
    setEditing(false);
    setMenu(false);
    setConfirming(false);
    setNote("");
    void load();
  }, [load]);

  if (failed)
    return (
      <View style={{ gap: 12 }}>
        <Text style={s.muted}>
          {failed === "gone" ? "That receipt isn’t in your Receipt box any more." : failed}
        </Text>
        <OutlineButton onPress={failed === "gone" ? onGone : () => void load()}>
          {failed === "gone" ? "Back to the Receipt box" : "Try again"}
        </OutlineButton>
      </View>
    );
  if (!loaded) return <Text style={s.muted}>Opening the receipt…</Text>;
  const { receipt, photoUrl } = loaded;
  const today = localToday();
  const apply = (next: Receipt) => {
    setLoaded({ receipt: next, photoUrl });
    onChanged?.();
  };
  const name = receipt.merchant ?? "Receipt";

  const returnCard = () => {
    if (!receipt.returnBy) return null;
    const days = daysBetween(today, receipt.returnBy);
    if (receipt.returnState === "returned" || receipt.returnState === "keeping")
      return (
        <View style={card}>
          <Tile icon={Bell} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={bold}>
              {receipt.returnState === "returned" ? "You returned it." : "You’re keeping it."}
            </Text>
            <Text style={s.muted}>
              {returnByText(receipt.returnBy, today)}. No reminder is set.
            </Text>
            <View style={{ alignSelf: "flex-start" }}>
              <OutlineButton
                busy={busy === "reopen"}
                accessibilityLabel={
                  receipt.returnState === "returned"
                    ? "Undo: I returned it"
                    : "Remind me again before the return window closes"
                }
                onPress={() =>
                  void run("reopen", () =>
                    boxApi.update(api, receipt.id, { returnBy: receipt.returnBy }),
                  ).then((next) => next && apply(next))
                }
              >
                {receipt.returnState === "returned" ? "Undo" : "Remind me again"}
              </OutlineButton>
            </View>
          </View>
        </View>
      );
    // The day the reminder really goes off (the server's own), never a computed one.
    const day = reminderOn(receipt);
    return (
      <View style={[card, { flexDirection: "column", alignItems: "stretch", gap: 12 }]}>
        <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
          <Tile icon={Bell} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={bold}>{returnByText(receipt.returnBy, today)}</Text>
            <Text style={s.muted}>
              {daysLeft(receipt.returnBy, today)}
              {day
                ? ` · reminder ${shortDate(day, today)}`
                : receipt.reminderAt
                  ? " · reminder day has passed"
                  : " · no reminder set"}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <OutlineButton
            primary
            busy={busy === "returned"}
            onPress={() =>
              void run("returned", () => boxApi.setReturn(api, receipt.id, "returned")).then(
                (next) => next && apply(next),
              )
            }
          >
            I returned it
          </OutlineButton>
          <OutlineButton
            busy={busy === "keeping"}
            onPress={() =>
              void run("keeping", () => boxApi.setReturn(api, receipt.id, "keeping")).then(
                (next) => next && apply(next),
              )
            }
          >
            I’m keeping it
          </OutlineButton>
          {days >= 1 && (
            <OutlineButton
              busy={busy === "snooze"}
              onPress={() =>
                void run("snooze", () => boxApi.setReturn(api, receipt.id, "snooze")).then(
                  (next) => {
                    if (!next) return;
                    apply(next);
                    const when = reminderOn(next);
                    setNote(
                      when
                        ? `Okay. I’ll remind you on ${shortDate(when, localToday())}.`
                        : "I couldn’t set that reminder. Home will still show the date when it’s close.",
                    );
                  },
                )
              }
            >
              Remind me tomorrow
            </OutlineButton>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text
          role="heading"
          aria-level={3}
          numberOfLines={2}
          style={{
            flex: 1,
            color: colors.text,
            fontSize: 28,
            fontWeight: "800",
            letterSpacing: -0.7,
          }}
        >
          {name}
        </Text>
        <Pressable
          role="button"
          aria-label="More: move back to To check, or delete"
          aria-expanded={menu}
          onPress={() => {
            setMenu(!menu);
            setConfirming(false);
            clear();
          }}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed || menu ? colors.subtle : colors.surface,
            borderWidth: 1,
            borderColor: colors.line,
          })}
        >
          <Ellipsis size={20} color={colors.text} />
        </Pressable>
      </View>

      {menu && !confirming && (
        <View
          style={[
            s.card,
            { gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 20, padding: 14 },
          ]}
        >
          <OutlineButton
            icon={Undo2}
            busy={busy === "unfile"}
            onPress={() =>
              void run("unfile", () => boxApi.unfile(api, receipt.id)).then(
                (back) => back && onUnfiled(back),
              )
            }
          >
            Move back to To check
          </OutlineButton>
          <OutlineButton danger icon={Trash2} onPress={() => setConfirming(true)}>
            Delete this receipt
          </OutlineButton>
          <ErrorNotice error={error} />
        </View>
      )}
      {confirming && (
        <DeleteConfirm
          busy={busy === "delete"}
          error={error}
          onKeep={() => {
            setConfirming(false);
            setMenu(false);
          }}
          onDelete={() =>
            void run("delete", () => boxApi.remove(api, receipt.id)).then(
              (done) => done && onDeleted(name),
            )
          }
        />
      )}

      {editing ? (
        <EditForm
          api={api}
          receipt={receipt}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            apply(next);
            setEditing(false);
          }}
        />
      ) : (
        <>
          <PhotoBox url={photoUrl} />
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <View style={{ gap: 2, flexShrink: 1 }}>
              <Text
                style={{ color: colors.text, fontSize: 38, fontWeight: "800", letterSpacing: -1.2 }}
              >
                {moneyText(receipt.total, receipt.currency)}
              </Text>
              <Text style={[s.muted, { fontSize: 16 }]}>{longDate(receipt.date)}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 7,
                  backgroundColor: colors.blue,
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: 18,
                }}
              >
                <CategoryDot category={receipt.category} size={11} />
                <Text style={{ color: colors.blueText, fontSize: 16, fontWeight: "700" }}>
                  {receipt.category}
                </Text>
              </View>
              {!!receipt.paidLast4 && <Text style={s.muted}>Card ending {receipt.paidLast4}</Text>}
            </View>
          </View>
          {(receipt.autoFiled || receipt.keepFor.length > 0) && (
            <Text style={[s.muted, { fontSize: 15 }]}>
              {receipt.keepFor.length > 0 ? `Kept for: ${receipt.keepFor.join(", ")}` : ""}
              {receipt.autoFiled ? `${receipt.keepFor.length ? " · " : ""}Filed by Neddy` : ""}
            </Text>
          )}
          {returnCard()}
          {!!note && <Text style={[s.muted, { color: colors.text }]}>{note}</Text>}
          <Text
            role="status"
            aria-live="polite"
            pointerEvents="none"
            style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
          >
            {note}
          </Text>
          {(receipt.warranty || receipt.keepFor.includes("Warranty")) && (
            <View style={card}>
              <Tile icon={ShieldCheck} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={bold}>Warranty mentioned</Text>
                <Text style={s.muted}>
                  The receipt mentions a warranty. Check your paper for how long it lasts.
                </Text>
              </View>
            </View>
          )}
          <Pressable
            role="button"
            aria-label="Edit amount, date, category or tags"
            onPress={() => setEditing(true)}
            style={({ pressed }) => [row, pressed && { backgroundColor: colors.subtle }]}
          >
            <Pencil size={18} color={colors.text} />
            <Text style={{ flex: 1, color: colors.text, fontSize: 17, fontWeight: "600" }}>
              Edit amount, date, category or tags
            </Text>
          </Pressable>
          <Pressable
            role="button"
            aria-label={receipt.note ? `Note: ${receipt.note}. Edit` : "Add a note"}
            onPress={() => setEditing(true)}
            style={({ pressed }) => [row, pressed && { backgroundColor: colors.subtle }]}
          >
            <StickyNote size={18} color={colors.mutedStrong} />
            <Text
              style={{
                flex: 1,
                color: receipt.note ? colors.text : colors.mutedStrong,
                fontSize: 17,
              }}
            >
              {receipt.note || "Add a note"}
            </Text>
          </Pressable>
          <PhotoActions url={photoUrl} name={name} />
          {hint && (
            <Pressable
              role="button"
              aria-label={`Ask: Where’s my ${name} receipt?`}
              onPress={() => hint(receipt)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={[s.muted, { textAlign: "center" }]}>
                You can also ask: “Where’s my {name} receipt?”
              </Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

const card = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 14,
  padding: 16,
  borderRadius: 22,
  backgroundColor: colors.sky,
  borderWidth: 1,
  borderColor: colors.line,
};
const row = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 12,
  minHeight: 56,
  paddingHorizontal: 16,
  borderRadius: 18,
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.line,
};
const bold = { color: colors.text, fontSize: 18, fontWeight: "800" as const };

function Tile({ icon: Icon }: { icon: typeof Bell }) {
  return (
    <View
      aria-hidden
      style={{
        width: 48,
        height: 48,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.blueDark,
      }}
    >
      <Icon size={24} color="#FFFFFF" />
    </View>
  );
}

function PhotoBox({ url }: { url: string | null }) {
  return (
    <View
      style={{
        height: 280,
        borderRadius: 22,
        overflow: "hidden",
        backgroundColor: colors.lavender,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {url ? (
        <>
          <Image
            source={{ uri: url }}
            resizeMode="contain"
            accessibilityLabel="Photo of the receipt"
            style={{ width: "100%", height: "100%" }}
          />
          <Pressable
            role="button"
            aria-label="Open the photo, bigger"
            onPress={() => openPhoto(url)}
            style={{
              position: "absolute",
              right: 12,
              bottom: 12,
              width: 48,
              height: 48,
              borderRadius: 24,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.inverse,
            }}
          >
            <Search size={22} color={colors.onInverse} />
          </Pressable>
        </>
      ) : (
        <View style={{ alignItems: "center", gap: 8 }}>
          <ReceiptTile size={56} />
          <Text style={s.muted}>
            {url === null ? "The photo isn’t available." : "Loading the photo…"}
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * Share and Save a copy. The photo is fetched as soon as the receipt opens, so Share can call
 * `navigator.share` straight from the tap (Safari refuses it after an await); without a file
 * ready, or a browser that can't share files, Share copies a link instead.
 */
function PhotoActions({ url, name }: { url: string | null; name: string }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File>();
  useEffect(() => {
    setFile(undefined);
    if (!url || Platform.OS !== "web") return;
    let live = true;
    fetch(url)
      .then((response) => response.blob())
      .then((blob) => {
        if (live)
          setFile(new File([blob], `${name}-receipt.jpg`, { type: blob.type || "image/jpeg" }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [url, name]);
  if (!url) return null;
  const share = () => {
    setText("");
    if (Platform.OS !== "web" || typeof navigator === "undefined") return openPhoto(url);
    if (file && navigator.canShare?.({ files: [file] })) {
      // Called synchronously inside the tap.
      navigator.share({ files: [file], title: `${name} receipt` }).catch((error: unknown) => {
        if (!/abort/i.test(error instanceof Error ? error.name : ""))
          setText("Couldn’t share it. Try Save a copy.");
      });
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(
        () => setText("Copied a link to the photo. It works for 15 minutes."),
        () => setText("Couldn’t share it. Try Save a copy."),
      );
      return;
    }
    openPhoto(url);
  };
  const save = () => {
    setText("");
    if (Platform.OS !== "web") return openPhoto(url);
    if (!file) return setText("Still getting the photo ready. Try again in a moment.");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // A download can't be confirmed from the page: say it started, not that it's saved.
    setText("Started downloading the photo.");
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <OutlineButton icon={Share2} onPress={share}>
            Share
          </OutlineButton>
        </View>
        {!(isInstalled() && isIos()) && (
          <View style={{ flex: 1 }}>
            <OutlineButton icon={Download} onPress={save}>
              Save a copy
            </OutlineButton>
          </View>
        )}
      </View>
      <Text
        role="status"
        aria-live="polite"
        style={[
          s.muted,
          { textAlign: "center" },
          !text && { position: "absolute", width: 1, height: 1, opacity: 0 },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}
