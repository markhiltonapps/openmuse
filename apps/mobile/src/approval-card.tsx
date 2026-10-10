import { Check, ShieldCheck } from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { ActionProposal } from "../../../packages/domain/src";
import { useAgentWorkspace } from "./agent-workspace";
import { appLabel, approveLabel, REST_OF_JOB_DETAIL, ReviewBody, restOfJobLabel } from "./details";
import { codeReady } from "./sign-in-ui";
import { Button, CheckRow, colors, ErrorNotice, resultSummary, s } from "./ui";
import { useWorkspace } from "./workspace";

/** One workspace reload shared by every card looking for an action it doesn't have yet. */
let lookingUp: Promise<unknown> | undefined;
const list = (value: unknown) => (Array.isArray(value) ? value.map(String).join(", ") : "");
const appName = (app: unknown) => (app ? appLabel(String(app)) : "");
const short = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
};
function when(start: unknown, end: unknown, allDay: unknown, timeZone: unknown) {
  const zone = typeof timeZone === "string" && timeZone ? timeZone : undefined;
  const day = (iso: string) =>
    new Date(allDay ? `${iso.slice(0, 10)}T12:00:00Z` : iso).toLocaleDateString("en-US", {
      timeZone: allDay ? "UTC" : zone,
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
    });
  if (typeof start !== "string" || !start) return "";
  if (allDay) return `All day ${day(start)}`;
  return `${day(start)}, ${time(start)}${typeof end === "string" && end ? `–${time(end)}` : ""}`;
}

/**
 * One line of facts about what approving does, from the action the server stored (never the
 * agent's own description, which is often its title): who it goes to, what runs with what, which
 * page, when.
 */
function whatItDoes(action: ActionProposal) {
  const d = action.data;
  switch (action.kind) {
    case "email.send":
    case "agent_email.send": {
      const firstLine =
        String(d.body || "")
          .trim()
          .split(/\n/)[0] ?? "";
      return [
        list(d.to) && `To ${list(d.to)}`,
        list(d.cc) && `Cc ${list(d.cc)}`,
        firstLine && `“${short(firstLine)}”`,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "app.action": {
      // The details a person would recognise (a name as itself), not ids, links, file types or
      // long text such as a file's contents; See details has all of them.
      const args = Object.entries((d.arguments ?? {}) as Record<string, unknown>)
        .filter(
          ([key, value]) =>
            value !== undefined &&
            value !== null &&
            value !== "" &&
            !(typeof value === "string" && value.length > 80) &&
            !/(^|_)(mime_?type|id|ids|url|uri|type)$/i.test(key),
        )
        .slice(0, 3)
        .map(([key, value]) =>
          /(^|_)(name|title|subject)$/i.test(key) && typeof value === "string"
            ? `“${short(value)}”`
            : `${key.replace(/_/g, " ")} ${short(value)}`,
        );
      return [appName(d.app), actionName(d.app, d.tool), ...args].filter(Boolean).join(" · ");
    }
    case "browser.step":
      return [
        String(d.site || ""),
        String(d.pageTitle || ""),
        d.action === "press" ? "Press Enter" : `Click “${String(d.element || "")}”`,
      ]
        .filter(Boolean)
        .join(" · ");
    case "browser.signin":
      return [String(d.site || ""), d.username ? `as ${String(d.username)}` : ""]
        .filter(Boolean)
        .join(" · ");
    case "calendar.delete":
      return [when(d.start, d.end, d.allDay, d.timeZone), "Removes it from your calendar"]
        .filter(Boolean)
        .join(" · ");
    default:
      return [
        when(d.start, d.end, d.allDay, d.timeZone),
        list(d.attendees) && `With ${list(d.attendees)}`,
      ]
        .filter(Boolean)
        .join(" · ");
  }
}

/** The server's refusal in plain words, or nothing when the card already says what happened. */
function plain(message: string, name: string) {
  if (/expired/i.test(message)) return "";
  if (/changed/i.test(message) && /proposal/i.test(message))
    return "This changed since it was shown. Check it, then approve.";
  if (/Google is disconnected/i.test(message))
    return "Google is disconnected. Reconnect it in Apps, then approve.";
  if (/Google account or connection changed/i.test(message))
    return `This was set up for a different Google account. Ask ${name} to set it up again.`;
  if (/Resume the task/i.test(message))
    return "Its job isn’t running now, so this can’t go ahead. Open the job to see why.";
  if (/Failed to fetch|NetworkError|Network request failed|Load failed/i.test(message))
    return `Couldn’t reach ${name}. Check your connection, then try again.`;
  return message;
}
/** An app's action in words: "GMAIL_SEND_DRAFT" in Gmail is "Send draft". */
function actionName(app: unknown, tool: unknown) {
  const words = String(tool || "")
    .replace(new RegExp(`^${String(app || "").replace(/[^A-Za-z0-9]/g, "")}_`, "i"), "")
    .replace(/_/g, " ")
    .toLowerCase()
    .trim();
  return words ? words[0]?.toUpperCase() + words.slice(1) : "";
}

/**
 * Something saved for the person's OK, where they are (in the chat, on a call, in Activity):
 * what it does and an Approve button, one tap. The action and its hash come from the server's
 * stored copy, so Approve approves exactly what the server will run. "See details" opens the full
 * review over the chat; on a call it opens here instead, since another sheet would end the call.
 */
export function ApprovalCard({
  actionId,
  onCall = false,
  wide = false,
  eyebrow = true,
}: {
  actionId: string;
  onCall?: boolean;
  /** As wide as the cards around it (Activity, a call); in the chat it stays a readable width. */
  wide?: boolean;
  /** The "Needs your OK" label; off where a heading above already says so. */
  eyebrow?: boolean;
}) {
  const { workspace: w, api, refresh, open, ask } = useWorkspace();
  const { data, refresh: refreshJobs } = useAgentWorkspace();
  const name = data?.identity.name || "Neddy";
  const [local, setLocal] = useState<ActionProposal>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  const [code, setCode] = useState("");
  // One OK for a job: its later steps in this app go ahead without asking.
  const [restOfJob, setRestOfJob] = useState(false);
  const [, setTick] = useState(0);
  const looked = useRef(false);
  const heading = useRef<Text>(null);
  const [missing, setMissing] = useState(false);
  const stored = w.actions.find((action) => action.id === actionId);
  // The server's copy once it has moved on (another device, a job); this card's result until then.
  const action = stored && stored.status !== "awaiting_review" ? stored : (local ?? stored);
  // Just made: the app may not have it yet, so look once (one look shared by every card
  // missing its action, so an old chat's cards don't each reload the workspace).
  useEffect(() => {
    if (stored || looked.current) return;
    looked.current = true;
    lookingUp ??= refresh()
      .catch(() => undefined)
      .finally(() => {
        setTimeout(() => {
          lookingUp = undefined;
        }, 5000);
      });
    void lookingUp.finally(() => setMissing(true));
  }, [stored, refresh]);
  // When it expires, the button goes.
  const expiresAt = action ? Date.parse(action.expiresAt) : 0;
  useEffect(() => {
    const wait = expiresAt - Date.now();
    if (!(wait > 0) || wait > 2 ** 31 - 1) return;
    const timer = setTimeout(() => setTick((n) => n + 1), wait + 50);
    return () => clearTimeout(timer);
  }, [expiresAt]);
  if (!action)
    return (
      <Shell wide={wide}>
        {missing ? (
          <Text style={s.muted}>This approval isn’t available any more.</Text>
        ) : (
          <View style={[s.row, { gap: 10 }]}>
            <ActivityIndicator color={colors.mutedStrong} />
            <Text style={s.muted}>Getting it ready…</Text>
          </View>
        )}
      </Shell>
    );
  const waiting = action.status === "awaiting_review" && expiresAt > Date.now();
  const needsCode =
    action.kind === "browser.signin" && action.data.step === "code" && !action.data.savedCode;
  const decide = async (decision: "approve" | "deny") => {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<ActionProposal>(`/api/actions/${action.id}/decide`, {
        decision,
        hash: action.hash,
        ...(needsCode && decision === "approve" ? { code } : {}),
        ...(restOfJob && decision === "approve" ? { restOfJob: true } : {}),
      });
      setCode("");
      setLocal(result);
      void refresh().catch(() => undefined);
      // Its job's page says what it's doing now, not still "Waiting for your OK".
      if (action.taskId) void refreshJobs().catch(() => undefined);
    } catch (e) {
      // Shown as it is now (changed, expired, done elsewhere), so the next tap is on what's shown.
      setLocal(undefined);
      await refresh().catch(() => undefined);
      setError(plain(e instanceof Error ? e.message : String(e), name));
    } finally {
      setBusy(false);
      // The button is gone or the error is new: the title is where to carry on from.
      setTimeout(() => (heading.current as unknown as { focus?: () => void })?.focus?.(), 50);
    }
  };
  const seeDetails = () =>
    onCall ? setDetails((open) => !open) : open({ type: "review", action, restOfJob });
  const done = action.status === "succeeded";
  const outcome = done
    ? action.result
      ? resultSummary(action.result)
      : "Done."
    : action.status === "executing"
      ? "Working on it…"
      : action.status === "denied"
        ? "You chose not to go ahead."
        : action.status === "cancelled"
          ? "Cancelled."
          : action.status === "outcome_unknown"
            ? "Couldn’t confirm it went through. Check before you try again."
            : action.status === "failed"
              ? "It didn’t go through."
              : `This waited too long and expired.${onCall ? ` Ask ${name} to set it up again.` : ""}`;
  const expired = !waiting && (action.status === "expired" || action.status === "awaiting_review");
  const label = approveLabel(action, w.mode === "sample");
  return (
    <Shell done={done} wide={wide} label={action.title}>
      {(eyebrow || !waiting) && (
        <View style={[s.row, { gap: 5 }]}>
          {done && <Check size={12} color={colors.greenText} />}
          <Text style={[s.label, { color: done ? colors.greenText : colors.mutedStrong }]}>
            {waiting ? "Needs your OK" : done ? "Done" : expired ? "Expired" : "Approval"}
          </Text>
        </View>
      )}
      <View style={{ gap: 3 }}>
        <Text
          ref={heading}
          role="heading"
          aria-level={3}
          // react-native-web's tabIndex: focusable from code (after a tap), not a Tab stop.
          {...({ tabIndex: -1 } as object)}
          style={[s.heading, { fontSize: 17, lineHeight: 23 }]}
        >
          {action.title}
        </Text>
        {/* What it will do: until it's done (the outcome says what happened), and not twice. */}
        {waiting && !details && whatItDoes(action) ? (
          <Text numberOfLines={2} style={[s.small, { fontSize: 13, color: colors.mutedStrong }]}>
            {whatItDoes(action)}
          </Text>
        ) : null}
      </View>
      {details && (
        <ReviewBody
          action={action}
          code={code}
          onCode={waiting ? setCode : undefined}
          onSubmit={() => !busy && void decide("approve")}
          onCall={onCall}
          style={{
            padding: 0,
            paddingTop: 14,
            borderRadius: 0,
            backgroundColor: "transparent",
            borderTopWidth: 1,
            borderTopColor: colors.line,
          }}
        />
      )}
      {/* A server error only where it helps: not when it's expired, and not the jargon of a
          result that can't be confirmed. */}
      <ErrorNotice
        error={
          // A tap's error only while it can still be acted on; once decided, the outcome says it.
          waiting ? error : expired || action.status === "outcome_unknown" ? "" : action.error || ""
        }
      />
      {/* Mounted all the time, so what happened after a tap is read out. */}
      <Text
        role="status"
        // Out of the layout while waiting (an absolute child takes no gap), so the buttons sit close.
        style={
          waiting
            ? { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }
            : [s.text, { fontSize: 15 }]
        }
      >
        {waiting ? "" : outcome}
      </Text>
      {waiting &&
      action.kind === "app.action" &&
      action.taskId &&
      typeof action.data.amountUsd !== "number" ? (
        <CheckRow
          label={restOfJobLabel(String(action.data.app || ""))}
          detail={REST_OF_JOB_DETAIL}
          checked={restOfJob}
          onPress={() => setRestOfJob((on) => !on)}
        />
      ) : null}
      {waiting ? (
        <View style={[s.row, { gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4 }]}>
          {needsCode && !details ? (
            <Button
              primary
              icon={ShieldCheck}
              accessibilityLabel={`Review: ${action.title}`}
              onPress={seeDetails}
            >
              Review
            </Button>
          ) : (
            <Button
              primary
              icon={Check}
              busy={busy}
              disabled={needsCode && !codeReady(code)}
              accessibilityLabel={`${label}: ${action.title}`}
              onPress={() => void decide("approve")}
            >
              {label}
            </Button>
          )}
          <Pressable
            role="button"
            aria-label={`${onCall && details ? "Hide details" : "See details"}: ${action.title}`}
            aria-expanded={onCall ? details : undefined}
            onPress={seeDetails}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: 10,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[s.text, { color: colors.blueText, fontWeight: "600" }]}>
              {onCall && details ? "Hide details" : "See details"}
            </Text>
          </Pressable>
          {/* Saying no without opening the details, where a job waits on the answer. */}
          {wide && !onCall ? (
            <Pressable
              role="button"
              aria-label={`Don’t proceed: ${action.title}`}
              disabled={busy}
              onPress={() => void decide("deny")}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: 10,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={[s.text, { color: colors.mutedStrong, fontWeight: "600" }]}>
                Don’t proceed
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : expired && !onCall && Date.now() - expiresAt < 86_400_000 ? (
        <Button
          primary
          style={{ alignSelf: "flex-start" }}
          accessibilityLabel={`Set it up again: ${action.title}`}
          onPress={() => ask(`Set this up again so I can approve it: ${action.title}`)}
        >
          Set it up again
        </Button>
      ) : action.taskId && error && !onCall ? (
        <Button
          style={{ alignSelf: "flex-start" }}
          onPress={() => action.taskId && open({ type: "task", taskId: action.taskId })}
        >
          Open job
        </Button>
      ) : null}
    </Shell>
  );
}

export function Shell({
  children,
  done = false,
  wide = false,
  label,
}: {
  children: ReactNode;
  done?: boolean;
  wide?: boolean;
  /** Its name for a screen reader, among several cards. */
  label?: string;
}) {
  return (
    <View
      role="group"
      aria-label={label}
      style={{
        gap: 10,
        padding: 16,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: done ? colors.green : colors.line,
        backgroundColor: done ? colors.green : colors.card,
        width: "100%",
        ...(wide ? {} : { maxWidth: 520 }),
      }}
    >
      {children}
    </View>
  );
}

/** Every action a tool's result saved for approval (or brought back): its id(s). */
export function approvalIds(result: unknown): string[] {
  let value = result;
  if (typeof value === "string")
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  const r = (value ?? {}) as {
    status?: unknown;
    actionId?: unknown;
    needsApproval?: unknown;
    approvalId?: unknown;
    approvals?: unknown;
  };
  const ids: string[] = [];
  if (r.status === "awaiting_review" && typeof r.actionId === "string") ids.push(r.actionId);
  if (r.needsApproval === true && typeof r.approvalId === "string") ids.push(r.approvalId);
  if (Array.isArray(r.approvals))
    for (const approval of r.approvals as { actionId?: unknown }[])
      if (typeof approval?.actionId === "string") ids.push(approval.actionId);
  return [...new Set(ids)];
}

/** In the chat: the Approve card(s) for what a tool saved for approval or brought back. */
export function ToolApprovals({ result, loading }: { result: unknown; loading: boolean }) {
  const ids = loading ? [] : approvalIds(result);
  if (!ids.length) return null;
  return (
    <View style={{ gap: 10, width: "100%" }}>
      {ids.map((id) => (
        <ApprovalCard key={id} actionId={id} />
      ))}
    </View>
  );
}
