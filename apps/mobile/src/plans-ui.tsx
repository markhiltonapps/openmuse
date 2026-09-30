import { Check, type LucideIcon, Plus, X } from "lucide-react-native";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, type LayoutChangeEvent, Pressable, Text, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { type Column, DataTable, Segmented } from "./charts";
import { Emoji } from "./emoji";
import {
  COMMITMENT_EMOJI,
  type Commitment,
  commitmentStatus,
  localWhen,
  plansChanged,
  type Reminder,
  splitCommitments,
  whenLine,
} from "./plans";
import { hideTip, tipProps } from "./tips";
import { Button, colors, ErrorNotice, InfoTip, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * The full lists behind the Feed's day card: every plan and booking being kept track of (coming up
 * and finished), and every reminder (coming up and sent this week).
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const numbers = { fontVariant: ["tabular-nums" as const] };
const cellText = [s.text, { fontSize: 14, lineHeight: 20 }];
/** The muted line under a cell, as DataTable draws a folded column. */
const underText = [s.small, numbers, { fontSize: 12, lineHeight: 17, color: colors.mutedStrong }];
/** Below this table width, When (and Where) join What in a line under the title, as DataTable folds. */
const NARROW = 360;
/** From this width, Where has a column of its own. */
const WIDE = 560;
/**
 * Moves keyboard and screen reader focus to a control, when it's on the screen. The row button that
 * had focus is gone without a blur, so its tip is put away first.
 */
const focusOn = (node: unknown) => {
  hideTip();
  (node as { focus?: () => void } | null)?.focus?.();
};

const KIND_NAME: Record<Commitment["kind"], string> = {
  reservation: "Reservation",
  delivery: "Delivery",
  trip: "Trip",
  appointment: "Appointment",
  bill: "Bill",
  event: "Event",
  other: "Plan",
};

/** A 44px icon button in a table row, with a smaller circle drawn inside; its tip says what it does. */
function RowAction({
  icon: Icon,
  label,
  tip,
  busy,
  onPress,
}: {
  icon: LucideIcon;
  /** For a screen reader, with what it acts on: "Mark done: Dinner at Nobu". */
  label: string;
  /** Short, on hover or press and hold: "Mark done". */
  tip: string;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...tipProps(tip)}
      aria-disabled={busy}
      disabled={busy}
      onPress={onPress}
      style={{
        width: 44,
        height: 44,
        marginVertical: -8,
        alignItems: "center",
        justifyContent: "center",
        opacity: busy ? 0.5 : 1,
      }}
    >
      {({ pressed }) => (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? colors.line : colors.subtle,
          }}
        >
          <Icon size={16} strokeWidth={2} color={colors.text} />
        </View>
      )}
    </Pressable>
  );
}

/** The day on one line and the time under it, in the person's time zone. */
function WhenCell({ at, timeZone }: { at?: string; timeZone?: string }) {
  const when = localWhen(at, timeZone);
  if (!when) return <Text style={[cellText, { color: colors.mutedStrong }]}>No date yet</Text>;
  return (
    <View>
      <Text style={[cellText, numbers]}>{when.day}</Text>
      <Text style={[s.small, numbers, { color: colors.mutedStrong, fontSize: 12 }]}>
        {when.time}
      </Text>
    </View>
  );
}

/**
 * A line that says what just happened, since a toast can't be seen over a sheet. It stays mounted
 * so a screen reader hears each change; while empty it takes back the gap above it.
 */
function StatusLine({
  text,
  textRef,
  children,
}: {
  text: string;
  /** So focus can land here when the row that had it is gone. */
  textRef?: RefObject<Text | null>;
  children?: ReactNode;
}) {
  return (
    <View style={[s.row, { gap: 12, flexWrap: "wrap" }, !text && { marginTop: -16 }]}>
      <Text
        ref={textRef}
        role="status"
        aria-live="polite"
        // Focusable from code only, not a Tab stop.
        {...({ tabIndex: -1 } as object)}
        style={[s.text, { flexShrink: 1, fontSize: 14, lineHeight: 20 }]}
      >
        {text}
      </Text>
      {children}
    </View>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <Text role="heading" aria-level={3} style={s.heading}>
      {children}
    </Text>
  );
}

/** Every plan and booking being kept track of: coming up, and done or cancelled this month. */
export function CommitmentsSheet({ tab: first = "upcoming" }: { tab?: "upcoming" | "past" }) {
  const { api, close, ask } = useWorkspace();
  const { data } = useAgentWorkspace();
  const agent = data?.identity.name || "your agent";
  const [tab, setTab] = useState(first);
  const [items, setItems] = useState<Commitment[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState("");
  const [undo, setUndo] = useState<Commitment>();
  const [width, setWidth] = useState(0);
  // The row that had focus goes away, so focus moves to Undo (or, after Undo, to what happened).
  const [focusTo, setFocusTo] = useState<"undo" | "status">();
  const undoRef = useRef<View>(null);
  const statusRef = useRef<Text>(null);
  useEffect(() => {
    if (!focusTo) return;
    focusOn(focusTo === "undo" ? undoRef.current : statusRef.current);
    setFocusTo(undefined);
  }, [focusTo]);
  const load = useCallback(
    () =>
      api.request<{ commitments: Commitment[] }>("/api/commitments?all=1").then(
        (list) => setItems(list.commitments),
        (e) => setError(message(e)),
      ),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function change(item: Commitment, status: Commitment["status"]) {
    setBusy(item.id);
    setError("");
    let next: "undo" | "status" | undefined;
    try {
      await api.request(`/api/commitments/${item.id}`, { status });
      setDone(
        status === "done"
          ? `Marked “${item.title}” done.`
          : status === "cancelled"
            ? `Marked “${item.title}” cancelled.`
            : `“${item.title}” is back in Upcoming.`,
      );
      setUndo(status === "upcoming" ? undefined : item);
      await load();
      plansChanged();
      next = status === "upcoming" ? "status" : "undo";
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
      // With busy cleared in the same render, so Undo can take focus.
      if (next) setFocusTo(next);
    }
  }
  const { upcoming, past } = splitCommitments(items ?? []);
  const showingUpcoming = tab === "upcoming";
  const rows = showingUpcoming ? upcoming : past;
  const narrow = width < NARROW;
  const wide = width >= WIDE;
  /** Under the title: where it is, and when too on a narrow screen. */
  const under = (item: Commitment) =>
    wide
      ? ""
      : [narrow ? whenLine(item.at, item.timeZone) : "", item.where].filter(Boolean).join(" · ");
  const status: Column<Commitment> = {
    title: "Status",
    flex: 0,
    minWidth: 92,
    render: (item) => {
      const word = commitmentStatus(item);
      return (
        <Text
          style={[
            cellText,
            word === "Cancelled" && { color: colors.mutedStrong },
            (word === "Today" || word === "Just passed") && { fontWeight: "600" },
          ]}
        >
          {word}
        </Text>
      );
    },
  };
  const actions: Column<Commitment> = {
    title: "",
    align: "right",
    flex: 0,
    minWidth: 96,
    render: (item) => (
      <View style={[s.row, { gap: 8 }]}>
        <RowAction
          icon={Check}
          label={`Mark done: ${item.title}`}
          tip="Mark done"
          busy={busy === item.id}
          onPress={() => void change(item, "done")}
        />
        <RowAction
          icon={X}
          label={`Mark cancelled: ${item.title}`}
          tip="Mark cancelled"
          busy={busy === item.id}
          onPress={() => void change(item, "cancelled")}
        />
      </View>
    ),
  };
  const columns: Column<Commitment>[] = [
    // On a narrow screen When is the line under the title instead (with the emoji beside both,
    // which a folded column's line can't be).
    ...(narrow
      ? []
      : [
          {
            title: "When",
            flex: 0,
            minWidth: wide ? 132 : 96,
            render: (item: Commitment) => <WhenCell at={item.at} timeZone={item.timeZone} />,
          },
        ]),
    {
      title: "What",
      flex: wide ? 3 : 1,
      render: (item) => (
        <View style={[s.row, { gap: 8, alignItems: "flex-start" }]}>
          <View role="img" aria-label={KIND_NAME[item.kind] ?? "Plan"}>
            <Emoji char={COMMITMENT_EMOJI[item.kind] ?? "📌"} size={20} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={cellText}>{item.title}</Text>
            {!!under(item) && <Text style={underText}>{under(item)}</Text>}
          </View>
        </View>
      ),
    },
    ...(wide ? [{ title: "Where", flex: 2, render: (item: Commitment) => item.where ?? "" }] : []),
    // Upcoming's status is plain from its date, except on a wide screen.
    ...(wide || !showingUpcoming ? [status] : []),
    ...(showingUpcoming ? [actions] : []),
  ];
  return (
    <Sheet
      title="Plans & bookings"
      subtitle={`Reservations, deliveries, trips, appointments, bills and events ${agent} is keeping track of for you.`}
      onClose={close}
    >
      <View style={{ gap: 16 }}>
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { id: "upcoming", label: items ? `Upcoming (${upcoming.length})` : "Upcoming" },
            { id: "past", label: items ? `Past (${past.length})` : "Past" },
          ]}
        />
        <StatusLine text={done} textRef={statusRef}>
          {!!undo && (
            <Pressable
              ref={undoRef}
              accessibilityRole="button"
              accessibilityLabel={`Undo: put “${undo.title}” back in Upcoming`}
              aria-disabled={busy === undo.id}
              disabled={busy === undo.id}
              onPress={() => void change(undo, "upcoming")}
              style={({ pressed }) => [
                s.button,
                s.secondary,
                (pressed || busy === undo.id) && { opacity: 0.6 },
              ]}
            >
              <Text style={[s.buttonText, { color: colors.text }]}>Undo</Text>
            </Pressable>
          )}
        </StatusLine>
        <ErrorNotice error={error} />
        <View onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
          {!items || !width ? (
            !error && <ActivityIndicator color={colors.blueDark} style={{ padding: 24 }} />
          ) : (
            <DataTable
              label={showingUpcoming ? "Upcoming plans" : "Past plans"}
              columns={columns}
              rows={rows}
              rowKey={(item) => item.id}
              empty={
                showingUpcoming
                  ? `Nothing coming up. Tell ${agent} about a reservation, delivery, trip, appointment or bill and it’ll show up here.`
                  : "Nothing finished yet. Plans you mark done or cancelled stay here for a month."
              }
            />
          )}
        </View>
        {showingUpcoming && items && (
          <Button
            icon={Plus}
            style={{ alignSelf: "flex-start" }}
            onPress={() => {
              close();
              ask("I’d like you to keep track of something I have coming up.");
            }}
          >
            Add a plan
          </Button>
        )}
        {!showingUpcoming && past.length > 0 && (
          <Text style={[s.small, { color: colors.mutedStrong, fontSize: 12 }]}>
            Plans you mark done or cancelled stay here for a month.
          </Text>
        )}
      </View>
    </Sheet>
  );
}

/** Every reminder: the ones coming up, and the ones that went off in the last 7 days. */
export function RemindersSheet() {
  const { api, close, ask } = useWorkspace();
  const { data } = useAgentWorkspace();
  const agent = data?.identity.name || "your agent";
  const [lists, setLists] = useState<{ upcoming: Reminder[]; sent: Reminder[] }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState("");
  // The cancelled row had focus; it moves to what happened.
  const [focusStatus, setFocusStatus] = useState(false);
  const statusRef = useRef<Text>(null);
  useEffect(() => {
    if (!focusStatus) return;
    focusOn(statusRef.current);
    setFocusStatus(false);
  }, [focusStatus]);
  const load = useCallback(
    () =>
      api.request<{ upcoming: Reminder[]; sent: Reminder[] }>("/api/reminders").then(
        (value) => setLists(value),
        (e) => setError(message(e)),
      ),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function cancel(reminder: Reminder) {
    setBusy(reminder.id);
    setError("");
    try {
      await api.request(`/api/reminders/${reminder.id}/cancel`, {});
      setDone(`Cancelled the reminder “${reminder.text}”.`);
      await load();
      plansChanged();
      setFocusStatus(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  const when: Column<Reminder> = {
    title: "When",
    flex: 0,
    minWidth: 112,
    render: (reminder) => <WhenCell at={reminder.dueAt} timeZone={reminder.timeZone} />,
    // On a narrow screen, a line under the reminder instead.
    fold: (reminder) => whenLine(reminder.dueAt, reminder.timeZone),
  };
  const text: Column<Reminder> = {
    title: "Reminder",
    flex: 1,
    render: (reminder) => reminder.text,
  };
  const upcomingColumns: Column<Reminder>[] = [
    when,
    text,
    {
      title: "",
      align: "right",
      flex: 0,
      minWidth: 44,
      render: (reminder) => (
        <RowAction
          icon={X}
          label={`Cancel reminder: ${reminder.text}`}
          tip="Cancel reminder"
          busy={busy === reminder.id}
          onPress={() => void cancel(reminder)}
        />
      ),
    },
  ];
  return (
    <Sheet
      title="Reminders"
      subtitle="What you’ve asked to be reminded about, and the ones sent in the last 7 days."
      onClose={close}
    >
      <View style={{ gap: 16 }}>
        <StatusLine text={done} textRef={statusRef} />
        <ErrorNotice error={error} />
        {!lists ? (
          !error && <ActivityIndicator color={colors.blueDark} style={{ padding: 24 }} />
        ) : (
          <>
            <SubHeading>Upcoming ({lists.upcoming.length})</SubHeading>
            <DataTable
              label="Upcoming reminders"
              columns={upcomingColumns}
              rows={lists.upcoming}
              rowKey={(reminder) => reminder.id}
              empty={`No reminders coming up. Ask ${agent} to remind you, like “Remind me to call Mom on Sunday at 5.”`}
            />
            <Button
              icon={Plus}
              style={{ alignSelf: "flex-start" }}
              onPress={() => {
                close();
                ask("I’d like to set a reminder.");
              }}
            >
              Add a reminder
            </Button>
            <View style={[s.row, { gap: 6, marginTop: 8 }]}>
              <SubHeading>Sent in the last 7 days ({lists.sent.length})</SubHeading>
              <InfoTip
                term="Sent reminders"
                text="Sent reminders stay here for 7 days, then clear away."
              />
            </View>
            <DataTable
              label="Sent reminders"
              columns={[when, text]}
              rows={lists.sent}
              rowKey={(reminder) => reminder.id}
              empty="None in the last 7 days. Reminders show up here after they go off."
            />
          </>
        )}
      </View>
    </Sheet>
  );
}
