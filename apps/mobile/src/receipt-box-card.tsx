import { Check, FileQuestion, Receipt as ReceiptIcon, Undo2 } from "lucide-react-native";
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { BrowserRunContext } from "./browser-tool-card";
import { CheckIt } from "./receipt-box-check";
import { boxApi } from "./receipt-box-data";
import {
  isNotInBox,
  localToday,
  moneyText,
  moneyWhole,
  parseToolResult,
  type Receipt,
  shortDate,
  type ToolBrief,
  type ToolResult,
} from "./receipt-box-logic";
import { CategoryDot, InfoCard, OutlineButton, Pill, ReceiptTile } from "./receipt-box-parts";
import { Card, colors, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * What the agent's receipt_box tool shows in the chat (apps/server/src/receipt-tools.ts): the same
 * Check it card as the box for a receipt just read or changed, a Filed line with Undo for one just
 * filed, and a short list for "what's waiting" and "where's my Best Buy receipt". Every result the
 * tool marks `shown` draws something here (the agent says "on your screen" only then). A card drawn
 * again from a chat's history only says what happened and opens the box: it never files anything.
 */
export function ReceiptToolCard({
  result,
  loading = false,
}: {
  result: unknown;
  loading?: boolean;
}) {
  // Part of the reply coming in now, or a reply to a message sent from this screen: live.
  const { active, fresh } = useContext(BrowserRunContext);
  const live = useRef(false);
  if (loading || active || fresh) live.current = true;
  if (loading) return null;
  const value = parseToolResult(result);
  if (!value) return null;
  if (value.receipt) return <ResultCard value={value} brief={value.receipt} live={live.current} />;
  if (value.receipts?.length) return <ListCard value={value} />;
  // Read, but nothing was filed: say why, as the box does.
  if (value.outcome === "not a receipt")
    return <Note title="That doesn’t look like a receipt." text="I haven’t filed it." />;
  if (value.outcome === "several receipts")
    return (
      <Note
        title="There’s more than one receipt in that photo."
        text="I can’t file them together, so I haven’t filed any. Send them one at a time."
      />
    );
  if (value.outcome === "couldn't read it")
    return (
      <Note
        title="I couldn’t read that one."
        text="Try again with the receipt flat and the light on it."
      />
    );
  return null;
}

function Note({ title, text }: { title: string; text: string }) {
  return (
    <InfoCard icon={FileQuestion} title={title} style={{ maxWidth: 520 }}>
      <Text style={s.muted}>{text}</Text>
    </InfoCard>
  );
}

type Phase = "check" | "filed" | "later" | "deleted";

// Live cards for the same receipt, newest last: when a later result (a voice fix, "file it") shows
// the same receipt, the older live card stops acting on what it knew and turns into a history line.
let sequence = 0;
const newest = new Map<string, number>();
const watchers = new Set<() => void>();
const watch = (listener: () => void) => {
  watchers.add(listener);
  return () => {
    watchers.delete(listener);
  };
};
function registerLive(id: string) {
  sequence += 1;
  newest.set(id, sequence);
  // Told after this render, never during it.
  queueMicrotask(() => {
    for (const listener of watchers) listener();
  });
  return sequence;
}

function ResultCard({
  value,
  brief,
  live,
}: {
  value: ToolResult;
  brief: ToolBrief;
  live: boolean;
}) {
  const { api, open } = useWorkspace();
  const [phase, setPhase] = useState<Phase>(brief.status === "filed" ? "filed" : "check");
  const [full, setFull] = useState<Receipt>();
  const [missing, setMissing] = useState(false);
  const [filed, setFiled] = useState<Receipt>();
  const [undone, setUndone] = useState(false);
  const [left, setLeft] = useState(60);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const today = localToday();
  const [mine] = useState(() => (live ? registerLive(brief.id) : 0));
  const latest = useSyncExternalStore(
    watch,
    () => newest.get(brief.id) ?? 0,
    () => 0,
  );
  // A newer live card for this receipt is below: this one only says what it was.
  const stale = live && latest > mine;
  const acting = live && !stale;
  // The live card works on the receipt as it is now (the tool's short form leaves some fields out).
  useEffect(() => {
    if (!acting) return;
    let alive = true;
    boxApi.one(api, brief.id).then(
      (answer) => alive && setFull(answer.receipt),
      (error: unknown) => {
        if (alive && isNotInBox(error)) setMissing(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [api, brief.id, acting]);
  // Undo lasts a minute after it was filed.
  useEffect(() => {
    if (phase !== "filed") return;
    const timer = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // What it says is what it is now: filed in this card, the tool's short form until then.
  const now = filed ?? brief;
  const toCheck = undone || (!filed && phase !== "filed" && brief.status === "to-check");
  const name = now.merchant ?? "Receipt";
  const openBox = () => open({ type: "receipt-box", id: brief.id });
  const summaryLine = `${name} · ${moneyText(now.total, now.currency)}`;

  if (missing)
    return (
      <Card style={{ maxWidth: 520 }}>
        <Text style={s.muted}>That receipt isn’t in your Receipt box any more.</Text>
      </Card>
    );

  // A live receipt waiting to be checked: the real card, so File it is one tap right here.
  if (acting && brief.status === "to-check" && phase === "check") {
    if (!full)
      return (
        <Card style={{ maxWidth: 560 }}>
          <Text style={s.muted}>Opening the receipt…</Text>
        </Card>
      );
    return (
      <Card style={{ maxWidth: 560 }}>
        <CheckIt
          api={api}
          receipt={full}
          canSay
          onFiled={(done) => {
            setFiled(done);
            setPhase("filed");
          }}
          onLater={() => setPhase("later")}
          onDeleted={() => setPhase("deleted")}
        />
      </Card>
    );
  }

  const shown = filed ?? full;
  const isFiled = phase === "filed";
  const title =
    phase === "deleted"
      ? "Deleted."
      : phase === "later"
        ? "Left in To check."
        : undone
          ? "Moved back to To check."
          : isFiled
            ? acting
              ? "Filed"
              : "Was filed"
            : acting
              ? "To check"
              : "Was waiting to check";
  const detail =
    phase === "deleted"
      ? "It’s gone from your Receipt box."
      : phase === "later"
        ? "Say “file it” when you’re ready, or open the Receipt box."
        : `${summaryLine}${now.category ? ` · ${now.category}` : ""}${now.date ? ` · ${shortDate(now.date, today)}` : ""}`;

  return (
    <Card style={{ gap: 10, maxWidth: 520 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        {isFiled && !undone ? (
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.greenDark,
            }}
          >
            <Check size={22} color="#FFFFFF" strokeWidth={3} />
          </View>
        ) : (
          <ReceiptTile size={40} tint={toCheck} />
        )}
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text style={[s.text, { fontWeight: "800" }]}>{title}</Text>
          <Text style={s.muted}>{detail}</Text>
        </View>
      </View>
      {isFiled && !undone && (brief.filedByNeddy || shown?.autoFiled) && (
        <Pill tone="teal">Filed by Neddy</Pill>
      )}
      {isFiled && !undone && (value.reminder || now.returnBy) && (
        <Text style={s.muted}>
          {value.reminder ?? `Return by ${shortDate(now.returnBy, today)}.`}
        </Text>
      )}
      {!!problem && <Text style={[s.muted, { color: colors.danger }]}>{problem}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {acting && isFiled && !undone && left > 0 && (
          <OutlineButton
            icon={Undo2}
            busy={busy}
            accessibilityLabel="Undo: move it back to To check"
            onPress={() => {
              setBusy(true);
              setProblem("");
              boxApi.unfile(api, brief.id).then(
                () => {
                  setUndone(true);
                  setBusy(false);
                },
                (error: unknown) => {
                  setProblem(error instanceof Error ? error.message : "Couldn’t move it back.");
                  setBusy(false);
                },
              );
            }}
          >
            Undo
          </OutlineButton>
        )}
        {phase !== "deleted" && (
          <OutlineButton icon={ReceiptIcon} primary={!isFiled} onPress={openBox}>
            {toCheck ? "Open to check" : "Open"}
          </OutlineButton>
        )}
      </View>
    </Card>
  );
}

/** "What's waiting" and search results: a short list, each row opens the receipt. */
function ListCard({ value }: { value: ToolResult }) {
  const { open } = useWorkspace();
  const today = localToday();
  const rows = value.receipts ?? [];
  const searched = typeof value.total === "number";
  const count = value.count ?? rows.length;
  const waiting = !searched;
  const title = waiting
    ? `${count} ${count === 1 ? "receipt" : "receipts"} to check`
    : `${count} ${count === 1 ? "receipt" : "receipts"} · ${moneyWhole(value.total ?? 0)}`;
  return (
    <Card style={{ gap: 6, maxWidth: 520 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text role="heading" aria-level={3} style={[s.heading, { flex: 1 }]}>
          {title}
        </Text>
        {waiting && <Pill tone="amber">To check</Pill>}
      </View>
      {rows.slice(0, 10).map((r) => (
        <Pressable
          key={r.id}
          role="button"
          aria-label={`${r.merchant ?? "Receipt"}, ${moneyText(r.total, r.currency)}, ${r.category}${r.date ? `, ${shortDate(r.date, today)}` : ""}. Open`}
          onPress={() => open({ type: "receipt-box", id: r.id })}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            minHeight: 52,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text numberOfLines={1} style={[s.text, { fontWeight: "700" }]}>
              {r.merchant ?? "Receipt"}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <CategoryDot category={r.category} size={8} />
              <Text style={s.small}>
                {r.category}
                {r.date ? ` · ${shortDate(r.date, today)}` : ""}
                {r.status === "to-check" && !waiting ? " · to check" : ""}
              </Text>
            </View>
          </View>
          <Text style={[s.text, { fontWeight: "800" }]}>{moneyText(r.total, r.currency)}</Text>
        </Pressable>
      ))}
      {rows.length > 10 && (
        <Text style={s.small}>And {rows.length - 10} more in the Receipt box.</Text>
      )}
      <View style={{ alignSelf: "flex-start", marginTop: 4 }}>
        <OutlineButton
          icon={ReceiptIcon}
          onPress={() => open({ type: "receipt-box", view: waiting ? "check" : "list" })}
        >
          {waiting ? "Check them" : "Open Receipt box"}
        </OutlineButton>
      </View>
    </Card>
  );
}
