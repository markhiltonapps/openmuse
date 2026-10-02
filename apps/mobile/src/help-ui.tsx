import { ArrowLeft, ChevronRight, MessageCircle, PenLine, Search, X } from "lucide-react-native";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, Text, type TextInput, View } from "react-native";
import type { PlaceRequest } from "../../../packages/domain/src/app-places";
import {
  HELP_GROUPS,
  HELP_TOPICS,
  type HelpGroupId,
  type HelpSay,
  type HelpTopic,
  helpText,
  helpTopic,
  searchHelp,
} from "../../../packages/domain/src/help";
import { useAgentWorkspace } from "./agent-workspace";
import { usePlace } from "./app-places-ui";
import { Emoji } from "./emoji";
import { HELP_SHOTS } from "./help-shots";
import { useCallControls } from "./live-call";
import { dark } from "./theme";
import { Button, Card, colors, Field, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * The help guide (packages/domain/src/help.ts): search, groups and topics with screenshots,
 * numbered steps, what to say instead, and a button to the place it's about. On the Help sheet
 * (menu, Help links, ?help=), on Apps › Help, and on the sign-in screen (without the parts that
 * need signing in).
 */

type From = { kind: "home" } | { kind: "group"; id: HelpGroupId } | { kind: "search" };
type View_ =
  | { kind: "home" }
  | { kind: "group"; id: HelpGroupId }
  | { kind: "topic"; id: string; from: From };

/** The first topics to show: what people look for most. */
const POPULAR = ["live-call", "connect-apps", "new-job", "approvals", "find-your-way"];

/** The step numbers' blue, the same as the numbered marks on the pictures (scripts/help-shots.mjs). */
const STEP_BLUE = "#1473C8";

/** "?help=fix" or "?help=connect-apps": a group or a topic. */
export function helpStart(id?: string): View_ {
  if (!id) return { kind: "home" };
  if (HELP_GROUPS.some((group) => group.id === id)) return { kind: "group", id: id as HelpGroupId };
  return helpTopic(id) ? { kind: "topic", id, from: { kind: "home" } } : { kind: "home" };
}

// Whether this person runs the app, asked once (only the admin sees the admin topics).
let adminKnown: boolean | undefined;
function useAdmin(enabled: boolean) {
  const { api } = useWorkspace();
  const [admin, setAdmin] = useState(adminKnown ?? false);
  useEffect(() => {
    if (!enabled || adminKnown !== undefined) return;
    void api
      .request<{ role?: string }>("/api/me")
      .then((me) => {
        adminKnown = me.role === "admin";
        setAdmin(adminKnown);
      })
      .catch(() => undefined);
  }, [api, enabled]);
  return admin;
}

/** Moves focus here once it's on screen (web), after RN-web's sheet focus trap has run. */
function useFocusOnMount(ref: RefObject<unknown>, when: boolean) {
  useEffect(() => {
    if (!when || Platform.OS !== "web") return;
    const timer = setTimeout(
      () => (ref.current as HTMLElement | null)?.focus?.({ preventScroll: false }),
      0,
    );
    return () => clearTimeout(timer);
  }, [ref, when]);
}

/** Text with **bold** words (the names on buttons) and the agent's name. */
function Rich({ text, agent, style }: { text: string; agent: string; style?: object }) {
  const parts = helpText(text, agent).split("**");
  return (
    <Text style={[s.text, style]}>
      {parts.map((part, index) =>
        index % 2 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed sentence
          <Text key={index} style={{ fontWeight: "700" }}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

/** A section's name over its rows. */
function SectionHeading({ children }: { children: string }) {
  return (
    <Text role="heading" aria-level={3} style={[s.heading, { marginBottom: 4 }]}>
      {children}
    </Text>
  );
}

/** A row that opens a topic or a group. */
function Row({
  title,
  detail,
  emoji,
  onPress,
  focusNow = false,
}: {
  title: string;
  detail?: string;
  emoji?: string;
  onPress: () => void;
  /** Focus lands here on the way back, on the row that was opened. */
  focusNow?: boolean;
}) {
  const ref = useRef<View>(null);
  useFocusOnMount(ref, focusNow);
  return (
    <Pressable
      ref={ref}
      role="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 56,
        paddingVertical: 10,
        paddingHorizontal: 12,
        // The words line up with the headings; the pressed shade runs into the margin.
        marginHorizontal: -12,
        borderRadius: 16,
        backgroundColor: pressed ? colors.subtle : "transparent",
      })}
    >
      {emoji ? <Emoji char={emoji} size={32} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.text, { fontWeight: "600" }]}>{title}</Text>
        {detail ? (
          <Text
            style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}
            numberOfLines={2}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      <ChevronRight size={18} color={colors.mutedStrong} />
    </Pressable>
  );
}

/** "Take me there": the place a topic is about. Closes the Help sheet first. */
function PlaceLink({ place, before }: { place: PlaceRequest; before?: () => void }) {
  const { label, where, go } = usePlace(place);
  return (
    <Pressable
      role="button"
      aria-label={`${label}. ${where.replace(/ [›·] /g, ", ")}`}
      onPress={() => {
        before?.();
        // After the sheet has gone, so a screen opens under nothing and a panel replaces it.
        setTimeout(() => go(), 0);
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 56,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: pressed ? colors.subtle : colors.card,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.text, { fontWeight: "600" }]}>{label}</Text>
        <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>{where}</Text>
      </View>
      <ChevronRight size={18} color={colors.mutedStrong} />
    </Pressable>
  );
}

/**
 * A screenshot of the screen a topic is about, with numbers matching its steps. It sits on a mat,
 * so its buttons don't look like ones you can tap.
 */
function Shot({ id, title }: { id: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const size = HELP_SHOTS[id];
  if (!size || failed || Platform.OS !== "web") return null;
  return (
    <View
      style={{
        alignSelf: "center",
        width: "100%",
        maxWidth: 420,
        padding: 8,
        borderRadius: 24,
        backgroundColor: colors.subtle,
      }}
    >
      <View
        style={{
          borderRadius: 16,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Image
          source={{ uri: `/help/shots/${id}-${dark ? "dark" : "light"}.webp` }}
          accessibilityLabel={`Picture: ${title}, with numbers matching the steps`}
          onError={() => setFailed(true)}
          style={{ width: "100%", aspectRatio: size.width / size.height }}
          resizeMode="contain"
        />
      </View>
    </View>
  );
}

/** A step's number, in the same blue circle as the marks on the picture. */
function StepNumber({ n, size = 28 }: { n: number; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: STEP_BLUE,
        marginTop: size > 24 ? -1 : 1,
      }}
    >
      <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: size > 24 ? 14 : 12 }}>
        {n}
      </Text>
    </View>
  );
}

/**
 * "Or just say it": examples of saying it instead of tapping. A question that changes nothing goes
 * in one tap; an example goes in the message box to change before sending; a line that only works
 * somewhere else (on a call, after adding a photo) is just shown. On a call, all of it is said.
 */
function SayBox({
  say,
  agent,
  onAsk,
  onDraft,
  onCall,
}: {
  say: HelpSay[];
  agent: string;
  onAsk?: (prompt: string) => void;
  onDraft?: (prompt: string) => void;
  onCall: boolean;
}) {
  const tappable = !!onAsk && !!onDraft && !onCall;
  const label = onCall
    ? `On the call, just say it to ${agent}`
    : onAsk
      ? `Or just say it to ${agent}`
      : `Once you’re signed in, just say it to ${agent}`;
  return (
    <View
      style={{ gap: 8, padding: 14, borderRadius: 18, backgroundColor: colors.sky }}
      role="group"
      aria-label={label}
    >
      <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: "700", color: colors.text }}>
        {label}
      </Text>
      {tappable ? (
        <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
          Tap one to start it in the chat.
        </Text>
      ) : null}
      {say.map((line) => {
        const text = helpText(typeof line === "string" ? line : line.text, agent);
        const where = typeof line === "object" && "where" in line ? line.where : undefined;
        const send = typeof line === "object" && "send" in line;
        if (!tappable || where)
          return (
            <Text key={text} style={s.text}>
              {`“${text}”`}
              {where ? <Text style={{ color: colors.mutedStrong }}>{` (${where})`}</Text> : null}
            </Text>
          );
        const Icon = send ? MessageCircle : PenLine;
        return (
          <Pressable
            key={text}
            role="button"
            aria-label={send ? `Ask ${agent}: ${text}` : `Start a message: ${text}`}
            onPress={() => (send ? onAsk?.(text) : onDraft?.(text))}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              minHeight: 44,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 14,
              backgroundColor: pressed ? colors.blue : dark ? colors.subtle : colors.card,
            })}
          >
            <Icon size={16} color={colors.blueDark} />
            <Text style={[s.text, { flex: 1 }]}>{`“${text}”`}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TopicPage({
  topic,
  agent,
  back,
  onTopic,
  signedIn,
  onAsk,
  onDraft,
  onCall,
  beforePlace,
  admin,
}: {
  topic: HelpTopic;
  agent: string;
  back: { label: string; name: string; onPress: () => void };
  onTopic: (id: string) => void;
  signedIn: boolean;
  onAsk?: (prompt: string) => void;
  onDraft?: (prompt: string) => void;
  onCall: boolean;
  beforePlace?: () => void;
  admin: boolean;
}) {
  const group = HELP_GROUPS.find((item) => item.id === topic.group);
  const title = helpText(topic.title, agent);
  const related = (topic.related ?? [])
    .map(helpTopic)
    .filter((item): item is HelpTopic => !!item && (admin || !item.admin));
  return (
    <View style={{ gap: 16 }}>
      <BackButton {...back} />
      <View style={{ gap: 6 }}>
        {group ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Emoji char={group.emoji} size={20} />
            <Text
              style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong, fontWeight: "600" }}
            >
              {helpText(group.title, agent)}
            </Text>
          </View>
        ) : null}
        <Heading text={title} />
        <Text style={[s.text, { color: colors.mutedStrong }]}>
          {helpText(topic.summary, agent)}
        </Text>
      </View>
      {signedIn && topic.place ? (
        <View style={{ gap: 8 }}>
          {[topic.place, ...(topic.more ?? [])].map((place) => (
            <PlaceLink key={place} place={{ place }} before={beforePlace} />
          ))}
        </View>
      ) : null}
      {topic.shot ? <Shot id={topic.shot} title={title} /> : null}
      {topic.steps?.length ? (
        <View role="list" style={{ gap: 12 }}>
          {topic.steps.map((step, index) => (
            <View
              key={step}
              role="listitem"
              style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}
            >
              <StepNumber n={index + 1} />
              <Rich text={step} agent={agent} style={{ flex: 1 }} />
            </View>
          ))}
        </View>
      ) : null}
      {topic.body?.map((paragraph) => (
        <Rich key={paragraph} text={paragraph} agent={agent} />
      ))}
      {topic.say?.length ? (
        <SayBox say={topic.say} agent={agent} onAsk={onAsk} onDraft={onDraft} onCall={onCall} />
      ) : null}
      {related.length ? (
        <View>
          <SectionHeading>Related</SectionHeading>
          {related.map((item) => (
            <Row
              key={item.id}
              title={helpText(item.title, agent)}
              onPress={() => onTopic(item.id)}
            />
          ))}
        </View>
      ) : null}
      {onAsk ? (
        <Pressable
          role="button"
          onPress={() => onAsk(`I need help with “${title}”.`)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            minHeight: 48,
            borderRadius: 24,
            backgroundColor: pressed ? colors.subtle : colors.surface,
            borderWidth: 1,
            borderColor: colors.line,
          })}
        >
          <MessageCircle size={18} color={colors.text} />
          <Text style={[s.text, { fontWeight: "600" }]}>{`Still stuck? Ask ${agent}`}</Text>
        </Pressable>
      ) : (
        <Text style={[s.text, { color: colors.mutedStrong }]}>
          Still stuck? Ask the person who runs Neato_Muse.
        </Text>
      )}
    </View>
  );
}

function BackButton({
  label,
  name,
  onPress,
}: {
  label: string;
  name: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      role="button"
      aria-label={name}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        alignSelf: "flex-start",
        minHeight: 44,
        paddingHorizontal: 12,
        marginLeft: -12,
        borderRadius: 22,
        backgroundColor: pressed ? colors.subtle : "transparent",
      })}
    >
      <ArrowLeft size={18} color={colors.text} />
      <Text style={[s.text, { fontWeight: "600" }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A page's heading, which focus moves to when the page opens (web), so it's read first. It isn't
 * a Tab stop, so it draws no focus ring.
 */
function Heading({ text, focus = true }: { text: string; focus?: boolean }) {
  const ref = useRef<Text>(null);
  useFocusOnMount(ref, focus);
  return (
    <Text
      ref={ref}
      role="heading"
      aria-level={2}
      {...({ tabIndex: -1 } as object)}
      style={[
        s.heading,
        { fontSize: 20, lineHeight: 26, fontWeight: "700" },
        Platform.OS === "web" && ({ outlineStyle: "none" } as object),
      ]}
    >
      {text}
    </Text>
  );
}

const count = (n: number) => `${n} ${n === 1 ? "topic" : "topics"}`;

/**
 * The guide itself. `signedIn` adds the buttons that need the app (take me there, ask the agent);
 * on the sign-in screen it's just the guide.
 */
export function HelpGuide({
  start,
  agent,
  admin,
  signedIn,
  onAsk,
  onDraft,
  onCall = false,
  beforePlace,
}: {
  start?: string;
  agent: string;
  admin: boolean;
  signedIn: boolean;
  onAsk?: (prompt: string) => void;
  onDraft?: (prompt: string) => void;
  onCall?: boolean;
  beforePlace?: () => void;
}) {
  const [view, setView] = useState<View_>(() => helpStart(start));
  const [query, setQuery] = useState("");
  // On the way back, focus goes to the row that was opened (its key) on each page, not the top of
  // the page: Help's first page and a group each remember theirs.
  const [opened, setOpened] = useState<{ home?: string; group?: string }>({});
  const [returning, setReturning] = useState(false);
  const field = useRef<TextInput>(null);
  const groups = HELP_GROUPS.filter((group) => admin || !("admin" in group && group.admin));
  const searching = !!query.trim();
  const results = searching ? searchHelp(helpText(query, agent), { admin, limit: 12 }) : [];
  const openTopic = (id: string, key?: string) => {
    if (key)
      setOpened((now) =>
        key.startsWith("topic:") ? { ...now, group: key } : { ...now, home: key },
      );
    setReturning(false);
    setView((now) => ({
      kind: "topic",
      id,
      from:
        now.kind === "group"
          ? now
          : now.kind === "topic"
            ? now.from
            : searching
              ? { kind: "search" }
              : { kind: "home" },
    }));
  };
  const goBack = (to: View_) => {
    setReturning(true);
    setView(to);
  };
  const focusRow = (key: string) => returning && (opened.home === key || opened.group === key);
  if (view.kind === "topic") {
    const topic = helpTopic(view.id);
    if (topic && (admin || !topic.admin)) {
      const from = view.from;
      const group = from.kind === "group" && groups.find((item) => item.id === from.id);
      const back = group
        ? { label: helpText(group.title, agent), name: `Back to ${helpText(group.title, agent)}` }
        : from.kind === "search"
          ? { label: "Search results", name: "Back to search results" }
          : { label: "All help", name: "Back to all help" };
      return (
        <TopicPage
          // A related topic opens as a fresh page, read from its heading.
          key={topic.id}
          topic={topic}
          agent={agent}
          admin={admin}
          back={{ ...back, onPress: () => goBack(from.kind === "group" ? from : { kind: "home" }) }}
          onTopic={(id) => openTopic(id)}
          signedIn={signedIn}
          onAsk={onAsk}
          onDraft={onDraft}
          onCall={onCall}
          beforePlace={beforePlace}
        />
      );
    }
  }
  if (view.kind === "group") {
    const group = groups.find((item) => item.id === view.id);
    const topics = HELP_TOPICS.filter((topic) => topic.group === view.id);
    if (group)
      return (
        <View style={{ gap: 12 }} key={group.id}>
          <BackButton
            label="All help"
            name="Back to all help"
            onPress={() => goBack({ kind: "home" })}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Emoji char={group.emoji} size={36} />
            <View style={{ flex: 1 }}>
              <Heading
                text={helpText(group.title, agent)}
                focus={!topics.some((topic) => focusRow(`topic:${topic.id}`))}
              />
            </View>
          </View>
          <View>
            {topics.map((topic) => (
              <Row
                key={topic.id}
                title={helpText(topic.title, agent)}
                detail={helpText(topic.summary, agent)}
                focusNow={focusRow(`topic:${topic.id}`)}
                onPress={() => openTopic(topic.id, `topic:${topic.id}`)}
              />
            ))}
          </View>
        </View>
      );
  }
  const popular = POPULAR.map(helpTopic).filter((topic): topic is HelpTopic => !!topic);
  const shown = searching
    ? results.map((topic) => `result:${topic.id}`)
    : [
        ...popular.map((topic) => `popular:${topic.id}`),
        ...groups.map((group) => `group:${group.id}`),
      ];
  return (
    <HomePage
      field={field}
      focusField={returning && !shown.includes(opened.home ?? "")}
      query={query}
      setQuery={setQuery}
      found={results.length}
      agent={agent}
      onAsk={onAsk}
    >
      {searching ? (
        <View>
          {results.map((topic) => (
            <Row
              key={topic.id}
              title={helpText(topic.title, agent)}
              detail={helpText(topic.summary, agent)}
              focusNow={focusRow(`result:${topic.id}`)}
              onPress={() => openTopic(topic.id, `result:${topic.id}`)}
            />
          ))}
          {!results.length && onAsk ? (
            <Row
              title={`Ask ${agent}: “${query.trim()}”`}
              emoji="💬"
              onPress={() =>
                onAsk(`I searched Help for “${query.trim()}” and found nothing. Can you help?`)
              }
            />
          ) : null}
        </View>
      ) : (
        <>
          <View>
            <SectionHeading>Most asked</SectionHeading>
            {popular.map((topic) => (
              <Row
                key={topic.id}
                title={helpText(topic.title, agent)}
                focusNow={focusRow(`popular:${topic.id}`)}
                onPress={() => openTopic(topic.id, `popular:${topic.id}`)}
              />
            ))}
          </View>
          <View>
            <SectionHeading>All topics</SectionHeading>
            {groups.map((group) => (
              <Row
                key={group.id}
                title={helpText(group.title, agent)}
                detail={count(HELP_TOPICS.filter((topic) => topic.group === group.id).length)}
                emoji={group.emoji}
                focusNow={focusRow(`group:${group.id}`)}
                onPress={() => {
                  setOpened({ home: `group:${group.id}` });
                  setReturning(false);
                  setView({ kind: "group", id: group.id });
                }}
              />
            ))}
          </View>
        </>
      )}
    </HomePage>
  );
}

/** Help's first page: the search box, what it found, and the rest. */
function HomePage({
  field,
  focusField,
  query,
  setQuery,
  found,
  agent,
  onAsk,
  children,
}: {
  field: RefObject<TextInput | null>;
  focusField: boolean;
  query: string;
  setQuery: (query: string) => void;
  /** How many topics the search found. */
  found: number;
  agent: string;
  onAsk?: (prompt: string) => void;
  children: ReactNode;
}) {
  useFocusOnMount(field, focusField);
  const searching = !!query.trim();
  return (
    <View style={{ gap: 16 }}>
      {/* The field's own space below it is taken back, so the gap is the same as elsewhere. */}
      <View style={{ marginBottom: -16 }}>
        <Field
          {...({ ref: field } as object)}
          label="Search help"
          hideLabel
          value={query}
          onChangeText={setQuery}
          placeholder="Search help, like “connect Gmail”"
          returnKeyType="search"
          autoCorrect={false}
          style={{ paddingRight: 48 }}
        />
        {searching ? (
          <Pressable
            role="button"
            aria-label="Clear search"
            onPress={() => {
              setQuery("");
              (field.current as unknown as HTMLElement | null)?.focus?.();
            }}
            style={({ pressed }) => ({
              position: "absolute",
              right: 2,
              top: 1,
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? colors.subtle : "transparent",
            })}
          >
            <X size={18} color={colors.mutedStrong} />
          </Pressable>
        ) : (
          <View pointerEvents="none" style={{ position: "absolute", right: 14, top: 14 }}>
            <Search size={18} color={colors.mutedStrong} />
          </View>
        )}
      </View>
      {/* Mounted all the time, so the count is read out as they type. */}
      <Text
        role="status"
        style={
          searching
            ? { fontSize: 13, lineHeight: 18, color: colors.mutedStrong }
            : { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }
        }
      >
        {searching
          ? found
            ? count(found)
            : `Nothing matches “${query.trim()}”. Try other words${onAsk ? `, or ask ${agent}` : ""}.`
          : ""}
      </Text>
      {!searching && onAsk ? (
        <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
          {`Or just ask ${agent}, like “How do I connect Gmail?”`}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/** The guide signed in: the agent's name, the admin's topics, and asking the agent from it. */
function SignedInGuide({ start, onClose }: { start?: string; onClose?: () => void }) {
  const { ask, draft, navigate } = useWorkspace();
  const { data } = useAgentWorkspace();
  const call = useCallControls();
  const admin = useAdmin(true);
  return (
    <HelpGuide
      // The admin's topics arrive a moment later; start again with them.
      key={admin ? "admin" : "everyone"}
      start={start}
      agent={data?.identity.name || "Neddy"}
      admin={admin}
      signedIn
      onCall={call.phase === "on"}
      beforePlace={onClose}
      onAsk={(prompt) => {
        onClose?.();
        navigate("chat");
        ask(prompt);
      }}
      onDraft={(prompt) => {
        onClose?.();
        draft(prompt);
      }}
    />
  );
}

/** Help over the page: from the menu, a Help link, or ?help=. */
export function HelpSheet({ topic }: { topic?: string }) {
  const { close } = useWorkspace();
  return (
    <Sheet title="Help & how-to" subtitle="Pictures and simple steps" onClose={close} fill>
      <SignedInGuide start={topic} onClose={close} />
    </Sheet>
  );
}

/** Apps › Help: the guide right in the tab. */
export function HelpCard() {
  return (
    <Card style={{ gap: 14 }}>
      <SignedInGuide />
    </Card>
  );
}

/**
 * What get_help found, in the chat and on a call's screen: the topic's steps right there, and a
 * button that opens it in Help (on a call, the call shrinks to its bar first and keeps going).
 */
export function HelpAnswerCard({
  result,
  loading = false,
  onCall = false,
}: {
  result: unknown;
  loading?: boolean;
  onCall?: boolean;
}) {
  const { open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const call = useCallControls();
  if (loading) return null;
  let value = result;
  if (typeof value === "string")
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  const ids = ((value as { topics?: { id?: unknown }[] } | null)?.topics ?? [])
    .map((topic) => (typeof topic.id === "string" ? helpTopic(topic.id) : undefined))
    .filter((topic): topic is HelpTopic => !!topic);
  const [first, ...more] = ids;
  if (!first) return null;
  const agent = data?.identity.name || "Neddy";
  const title = helpText(first.title, agent);
  const show = (id: string) => {
    if (onCall) call.shrink();
    open({ type: "help", topic: id });
  };
  return (
    <View
      role="group"
      aria-label={`Help: ${title}`}
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
        <Emoji char="🛟" size={22} />
        <Text
          style={{ fontSize: 13, lineHeight: 18, fontWeight: "700", color: colors.mutedStrong }}
        >
          Help
        </Text>
      </View>
      <Text role="heading" aria-level={4} style={[s.heading, { fontSize: 17 }]}>
        {title}
      </Text>
      {first.steps?.length ? (
        <View role="list" style={{ gap: 8 }}>
          {first.steps.map((step, index) => (
            <View
              key={step}
              role="listitem"
              style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}
            >
              <StepNumber n={index + 1} size={22} />
              <Rich text={step} agent={agent} style={{ flex: 1 }} />
            </View>
          ))}
        </View>
      ) : (
        <Text style={[s.text, { color: colors.mutedStrong }]}>
          {helpText(first.summary, agent)}
        </Text>
      )}
      <Button primary accessibilityLabel={`Open “${title}” in Help`} onPress={() => show(first.id)}>
        Open in Help
      </Button>
      {more.map((topic) => (
        <Row
          key={topic.id}
          title={`Also: ${helpText(topic.title, agent)}`}
          onPress={() => show(topic.id)}
        />
      ))}
    </View>
  );
}

/** On the sign-in screen: the guide, before anyone has signed in (the agent has no name yet). */
export function SignedOutHelp({ start, onClose }: { start?: string; onClose: () => void }) {
  return (
    <Sheet title="Help & how-to" subtitle="Pictures and simple steps" onClose={onClose} fill>
      <HelpGuide start={start ?? "sign-in"} agent="your agent" admin={false} signedIn={false} />
    </Sheet>
  );
}
