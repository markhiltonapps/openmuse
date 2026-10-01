import { ChevronDown, ChevronRight, ChevronUp, ExternalLink, Reply } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { approvalIds, Shell, ToolApprovals } from "./approval-card";
import { Button, colors, ErrorNotice, Sheet, s, timeLabel } from "./ui";
import { useWorkspace } from "./workspace";

/** What a card shows for an email Neddy read (the full email stays on the server for a week). */
export interface EmailItem {
  id: string;
  app: "gmail" | "outlook";
  from: string;
  subject: string;
  date?: string;
  preview: string;
  /** Back to the email in Gmail or Outlook; kept with the card after the email itself goes. */
  link?: string;
}
interface FullEmail extends EmailItem {
  to?: string;
  body: string;
}
const APP_NAMES = { gmail: "Gmail", outlook: "Outlook" } as const;
const SHOWN = 3;

/** The emails in a tool's result (use_app on Gmail or Outlook), if any. */
export function emailItems(result: unknown): EmailItem[] {
  let value = result;
  if (typeof value === "string")
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  const emails = (value as { emails?: unknown } | null)?.emails;
  return Array.isArray(emails)
    ? emails.filter(
        (email): email is EmailItem =>
          !!email && typeof email.id === "string" && typeof email.subject === "string",
      )
    : [];
}

/** "2:14 PM" today, "Sep 30" before that. */
function when(date?: string) {
  if (!date) return "";
  const at = new Date(date);
  if (Number.isNaN(at.getTime())) return "";
  return at.toDateString() === new Date().toDateString()
    ? timeLabel(date)
    : at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
/** "Dan Smith <dan@example.com>" reads as "Dan Smith". */
const sender = (from: string) => from.replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "") || from;

function useEmail(id: string, wanted: boolean) {
  const { api } = useWorkspace();
  const [email, setEmail] = useState<FullEmail>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!wanted || email) return;
    let live = true;
    setError("");
    api.request<FullEmail>(`/api/email-views/${encodeURIComponent(id)}`).then(
      (found) => live && setEmail(found),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [api, id, wanted, email]);
  return { email, error };
}

/**
 * Emails Neddy read, right in the conversation: tap one to read it in full over the chat. On a call
 * it opens in place, since another sheet would end the call.
 */
export function EmailCards({
  emails,
  onCall = false,
  wide = false,
}: {
  emails: EmailItem[];
  onCall?: boolean;
  wide?: boolean;
}) {
  const [all, setAll] = useState(false);
  if (!emails.length) return null;
  const apps = [...new Set(emails.map((email) => APP_NAMES[email.app] ?? "Email"))];
  const shown = all ? emails : emails.slice(0, SHOWN);
  const more = emails.length - shown.length;
  const count = `${emails.length} ${emails.length === 1 ? "email" : "emails"}`;
  return (
    <Shell wide={wide} label={`${count} from ${apps.join(" and ")}`}>
      <View style={{ gap: 2 }}>
        <Text style={[s.label, { color: colors.mutedStrong }]}>{apps.join(" · ")}</Text>
        <Text role="heading" aria-level={3} style={[s.heading, { fontSize: 17, lineHeight: 23 }]}>
          {count}
        </Text>
      </View>
      <View style={{ gap: 2, marginHorizontal: -8 }}>
        {shown.map((email) => (
          <EmailRow key={email.id} email={email} onCall={onCall} />
        ))}
      </View>
      {more > 0 || all ? (
        <Pressable
          role="button"
          aria-expanded={all}
          onPress={() => setAll((open) => !open)}
          style={({ pressed }) => [
            s.row,
            {
              gap: 4,
              alignSelf: "flex-start",
              minHeight: 44,
              marginVertical: -8,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <Text style={[s.text, { color: colors.blueText, fontWeight: "600" }]}>
            {all ? "Show fewer" : `Show ${more} more`}
          </Text>
          <View aria-hidden>
            {all ? (
              <ChevronUp size={16} color={colors.blueText} />
            ) : (
              <ChevronDown size={16} color={colors.blueText} />
            )}
          </View>
        </Pressable>
      ) : null}
    </Shell>
  );
}

function EmailRow({ email, onCall }: { email: EmailItem; onCall: boolean }) {
  const { open } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const { email: full, error } = useEmail(email.id, onCall && expanded);
  const date = when(email.date);
  return (
    <View>
      <Pressable
        role="button"
        aria-expanded={onCall ? expanded : undefined}
        aria-label={`${sender(email.from)}: ${email.subject || "(no subject)"}${date ? `, ${date}` : ""}`}
        onPress={() =>
          onCall ? setExpanded((value) => !value) : open({ type: "appEmail", email })
        }
        style={({ pressed }) => ({
          paddingHorizontal: 8,
          paddingVertical: 10,
          borderRadius: 12,
          backgroundColor: pressed ? colors.subtle : "transparent",
          gap: 2,
        })}
      >
        <View style={[s.row, { gap: 8 }]}>
          <Text numberOfLines={1} style={[s.text, { flex: 1, fontWeight: "700" }]}>
            {sender(email.from)}
          </Text>
          {date ? <Text style={[s.small, { fontSize: 12 }]}>{date}</Text> : null}
          {onCall ? (
            expanded ? (
              <ChevronUp size={16} color={colors.muted} />
            ) : (
              <ChevronDown size={16} color={colors.muted} />
            )
          ) : (
            <ChevronRight size={16} color={colors.muted} />
          )}
        </View>
        <Text numberOfLines={1} style={[s.text, { fontWeight: "500" }]}>
          {email.subject || "(no subject)"}
        </Text>
        {!expanded && email.preview ? (
          <Text numberOfLines={2} style={[s.small, { fontSize: 13, color: colors.mutedStrong }]}>
            {email.preview}
          </Text>
        ) : null}
      </Pressable>
      {expanded && (
        <View style={{ paddingHorizontal: 8, paddingBottom: 12, gap: 10 }}>
          {full ? (
            <>
              <Text selectable style={[s.text, { lineHeight: 23 }]}>
                {full.body}
              </Text>
              {full.link ? <OpenInApp email={full} /> : null}
            </>
          ) : error ? (
            <>
              <ErrorNotice error={error} />
              {email.link ? <OpenInApp email={email} /> : null}
            </>
          ) : (
            <ActivityIndicator color={colors.mutedStrong} style={{ alignSelf: "flex-start" }} />
          )}
        </View>
      )}
    </View>
  );
}

function OpenInApp({ email }: { email: Pick<EmailItem, "app" | "link"> }) {
  const name = APP_NAMES[email.app] ?? "your mail app";
  return (
    <Pressable
      role="link"
      aria-label={`Open in ${name} (new tab)`}
      onPress={() => email.link && void Linking.openURL(email.link)}
      style={({ pressed }) => [
        s.row,
        { gap: 6, alignSelf: "flex-start", minHeight: 44, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={[s.text, { color: colors.blueText, fontWeight: "600" }]}>
        {`Open in ${name}`}
      </Text>
      <View aria-hidden>
        <ExternalLink size={15} color={colors.blueText} />
      </View>
    </Pressable>
  );
}

const meta = [s.small, { fontSize: 13, lineHeight: 18, color: colors.mutedStrong }];
/** "dan@example.com" from "Dan Smith <dan@example.com>"; empty when there's only an address. */
const address = (from: string) => from.match(/<([^>]+)>\s*$/)?.[1] ?? "";

/** An email Neddy read, in full over the chat; "Draft a reply" hands it back to Neddy. */
export function AppEmailSheet({ email: item }: { email: EmailItem }) {
  const { close, ask } = useWorkspace();
  const { email, error } = useEmail(item.id, true);
  const shown = email ?? item;
  const date = shown.date ? new Date(shown.date) : undefined;
  const dated = date && !Number.isNaN(date.getTime()) ? date : undefined;
  const from = sender(shown.from);
  return (
    <Sheet
      title={shown.subject || "(no subject)"}
      titleLines={3}
      onClose={close}
      // Kept in view below a long email.
      footer={
        <View style={[s.row, { gap: 8, flexWrap: "wrap", alignItems: "center" }]}>
          <Button
            primary
            icon={Reply}
            onPress={() => {
              close();
              const on = dated
                ? ` from ${dated.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                : "";
              ask(
                `Help me reply to ${from}’s email${item.subject ? ` “${item.subject}”` : ""}${on}.`,
              );
            }}
          >
            Draft a reply
          </Button>
          {(email?.link ?? item.link) ? (
            <OpenInApp email={{ app: item.app, link: email?.link ?? item.link }} />
          ) : null}
        </View>
      }
    >
      <View style={{ gap: 14, paddingBottom: 20, maxWidth: 640 }}>
        <View style={{ gap: 2 }}>
          <Text style={[s.text, { fontWeight: "700" }]}>{from}</Text>
          {address(shown.from) ? <Text style={meta}>{address(shown.from)}</Text> : null}
          {email?.to ? <Text style={meta}>{`To ${email.to}`}</Text> : null}
          {dated ? (
            <Text style={meta}>
              {dated.toLocaleString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          ) : null}
        </View>
        <View style={[s.divider, { marginVertical: 0 }]} />
        {email ? (
          <Text selectable style={[s.text, { lineHeight: 25 }]}>
            {email.body}
          </Text>
        ) : error ? (
          <ErrorNotice error={error} />
        ) : (
          <ActivityIndicator color={colors.blueDark} style={{ alignSelf: "flex-start" }} />
        )}
      </View>
    </Sheet>
  );
}

/** In the chat: emails a connected-app look-up read, and anything it saved for approval. */
export function ToolAppResult({ result, loading }: { result: unknown; loading: boolean }) {
  const emails = loading ? [] : emailItems(result);
  if (!emails.length && (loading || !approvalIds(result).length)) return null;
  return (
    <View style={{ gap: 10, width: "100%" }}>
      {emails.length ? <EmailCards emails={emails} /> : null}
      <ToolApprovals result={result} loading={loading} />
    </View>
  );
}
