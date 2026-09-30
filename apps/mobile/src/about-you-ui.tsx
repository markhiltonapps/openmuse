import { ChevronDown, MessageCircleQuestion, Pencil, Plus } from "lucide-react-native";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import {
  PERSONA_FACTS,
  PERSONA_GROUPS,
  type PersonaFact,
  type PersonaGroup,
  type PersonaKey,
  personaKeys,
  personaSourceLabel,
} from "../../../packages/domain/src/persona";
import { useAgentWorkspace } from "./agent-workspace";
import { AreaEditor, homeCountry } from "./area-ui";
import { AgentAvatar } from "./avatar";
import { Emoji } from "./emoji";
import { SayOrType } from "./meal-checkins-ui";
import { Button, Card, Chip, colors, ErrorNotice, Field, s } from "./ui";
import { DictateButton } from "./voice-ui";
import { useWorkspace } from "./workspace";

interface Area {
  label: string;
  country?: string;
  setAt: string;
}
/** A row: a fact, or where they live. */
type Open = PersonaKey | "area";

const GROUP_EMOJI: Record<PersonaGroup, string> = {
  You: "👋",
  Work: "💼",
  "Home and family": "🏡",
  "Email and apps": "📬",
  "How I help": "⭐",
};
const AREA_LABEL = "Where you live";
/** The first things to add on an empty page, in the order the agent asks about them. */
const STARTERS: PersonaKey[] = [
  "you.name",
  "you.focus",
  "prefs.offPlate",
  "comms.email",
  "household.people",
];
/** How long "Undo" stays after something is forgotten, counted while it isn't in use. */
const UNDO_MS = 6000;
/** How long a row that just changed stays green. */
const FLASH_MS = 2000;

const labelOf = (key: Open) => (key === "area" ? AREA_LABEL : PERSONA_FACTS[key].label);
const groupOf = (key: Open): PersonaGroup =>
  key === "area" ? "Home and family" : PERSONA_FACTS[key].group;
const byOrder = (a: PersonaFact, b: PersonaFact) =>
  personaKeys.indexOf(a.key) - personaKeys.indexOf(b.key);
const day = (at: string, month: "short" | "long" = "short") =>
  new Date(at).toLocaleDateString(undefined, { month, day: "numeric" });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const undoId = (key: Open) => `undo-${key.replace(".", "-")}`;

/**
 * On the web, where keyboard and screen-reader focus live: focus it, or the first element in it
 * that matches `inside` (a button, a text box).
 */
function focusSoon(ref: RefObject<View | Text | null>, inside?: string) {
  if (Platform.OS !== "web") return;
  setTimeout(() => {
    const node = ref.current as unknown as HTMLElement | null;
    const target = inside ? node?.querySelector<HTMLElement>(inside) : node;
    target?.focus?.();
  }, 60);
}
/** Escape anywhere inside an open editor closes it, on the web. */
function useEscape(ref: RefObject<View | null>, onEscape: () => void) {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const listener = (event: KeyboardEvent) => {
      const node = ref.current as unknown as HTMLElement | null;
      if (event.key === "Escape" && node?.contains(document.activeElement)) latest.current();
    };
    // Capture: react-native-web's TextInput stops keydown from bubbling up.
    document.addEventListener("keydown", listener, true);
    return () => document.removeEventListener("keydown", listener, true);
  }, [ref]);
}
const BUTTON = "[role=button], button";
const TEXT_BOX = "input, textarea";

/** Everything a row needs from the page. */
interface Page {
  facts: PersonaFact[];
  /** Null when it isn't set. */
  area: Area | null;
  open?: Open;
  forgotten: Partial<Record<Open, PersonaFact | Area>>;
  /** Where focus goes next: a row ("you.name"), its add button ("add:you.name"), Undo, a group. */
  focus?: string;
  /** Just saved, confirmed or put back: shown green for a moment. */
  flash?: Open;
  /** An Undo that didn't go through; its row says so and keeps the button. */
  undoFailed?: Open;
  wide: boolean;
  openRow: (key: Open) => void;
  close: (key: Open, adding: boolean) => void;
  saved: (fact: PersonaFact, confirmed?: boolean) => void;
  forgot: (fact: PersonaFact) => void;
  areaSaved: () => void;
  areaForgot: (was: Area) => void;
  undo: (key: Open) => void;
  /** After a wrong guess: write the right one. */
  fix: (key: PersonaKey) => void;
  /** Undo is in use (focused or under the pointer), so it doesn't go away yet. */
  hold: (key: Open, holding: boolean) => void;
  /** A fact was forgotten somewhere else (in the chat, say): say so and load the page again. */
  gone: (key: PersonaKey) => void;
}

/**
 * About you: what the agent knows about the person, grouped, with where each fact came from.
 * Every fact can be changed (typed or said), confirmed when it's a guess, or forgotten.
 * `top` goes straight under the hero: memories waiting for review.
 */
export function AboutYou({ top }: { top?: ReactNode }) {
  const { api, ask, notify } = useWorkspace();
  const { data } = useAgentWorkspace();
  const agentName = data?.identity.name || "Neddy";
  const [facts, setFacts] = useState<PersonaFact[]>();
  const [area, setArea] = useState<Area | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState<Open>();
  const [forgotten, setForgotten] = useState<Partial<Record<Open, PersonaFact | Area>>>({});
  const [focus, setFocus] = useState<string>();
  const [flash, setFlash] = useState<Open>();
  const [status, setStatus] = useState("");
  const [undoFailed, setUndoFailed] = useState<Open>();
  const [showAll, setShowAll] = useState(false);
  const [wide, setWide] = useState(false);
  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const [persona, home] = await Promise.all([
        api.request<{ facts: PersonaFact[] }>("/api/persona"),
        api.request<{ area: Area | null }>("/api/area").catch(() => ({ area: null })),
      ]);
      setFacts(persona.facts);
      setArea(home.area);
      return true;
    } catch {
      setLoadError(true);
      return false;
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  const timers = useRef<Partial<Record<Open | "flash" | "status", ReturnType<typeof setTimeout>>>>(
    {},
  );
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  const name = facts?.find((fact) => fact.key === "you.name")?.value;
  const known = (facts?.length ?? 0) + (area ? 1 : 0);
  // Once anything is known, the full list stays, so forgetting the last fact keeps its Undo.
  useEffect(() => {
    if (known) setShowAll(true);
  }, [known]);

  /** Read out by screen readers, even when it's the same words as last time. */
  function say(text: string) {
    setStatus("");
    clearTimeout(timers.current.status);
    timers.current.status = setTimeout(() => setStatus(text), 100);
  }
  function lightUp(key: Open) {
    setFlash(key);
    clearTimeout(timers.current.flash);
    timers.current.flash = setTimeout(() => setFlash(undefined), FLASH_MS);
  }
  function saved(fact: PersonaFact, confirmed = false) {
    setFacts((current) =>
      [...(current ?? []).filter((item) => item.key !== fact.key), fact].sort(byOrder),
    );
    setOpen(undefined);
    say(`${confirmed ? "Confirmed" : "Saved"}: ${labelOf(fact.key)}.`);
    setFocus(fact.key);
    lightUp(fact.key);
  }
  /** Undo goes away after a while, unless it's in use; focus only moves if it was on Undo. */
  function startUndo(key: Open) {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      if (Platform.OS === "web") {
        // Only when focus is on this row, so a tap elsewhere doesn't scroll the page back.
        const active = document.activeElement as HTMLElement | null;
        if (active?.closest(`#${undoId(key)}`)) setFocus(`group:${groupOf(key)}`);
      }
      setForgotten(({ [key]: _gone, ...rest }) => rest);
    }, UNDO_MS);
  }
  function remember(key: Open, was: PersonaFact | Area) {
    setOpen(undefined);
    setUndoFailed(undefined);
    setForgotten((current) => ({ ...current, [key]: was }));
    say(`Forgotten: ${labelOf(key)}.`);
    setFocus(`undo:${key}`);
    startUndo(key);
  }
  function forgot(fact: PersonaFact) {
    setFacts((current) => current?.filter((item) => item.key !== fact.key));
    remember(fact.key, fact);
  }
  async function undo(key: Open) {
    const was = forgotten[key];
    if (!was) return;
    clearTimeout(timers.current[key]);
    setUndoFailed(undefined);
    try {
      if (key === "area") {
        const back = was as Area;
        const result = await api.request<{ area: Area }>("/api/area", {
          place: back.label,
          country: back.country,
        });
        setArea(result.area);
      } else {
        const fact = await api.request<PersonaFact>(
          `/api/persona/${encodeURIComponent(key)}/restore`,
          was,
        );
        setFacts((current) => [...(current ?? []), fact].sort(byOrder));
      }
      setForgotten(({ [key]: _back, ...rest }) => rest);
      say(`Put back: ${labelOf(key)}.`);
      setFocus(key);
      lightUp(key);
    } catch {
      // Stays, with Undo, until they try again.
      setUndoFailed(key);
      setFocus(`undo:${key}`);
    }
  }
  const page: Page | undefined = facts && {
    facts,
    area,
    open,
    forgotten,
    focus,
    flash,
    undoFailed,
    wide,
    openRow: (key) => {
      setOpen(key);
      setFocus(undefined);
    },
    close: (key, adding) => {
      setOpen(undefined);
      setFocus(adding ? `add:${key}` : key);
    },
    saved,
    forgot,
    areaSaved: () => {
      setOpen(undefined);
      say(`Saved: ${AREA_LABEL}.`);
      setFocus("area");
      lightUp("area");
      void api.request<{ area: Area | null }>("/api/area").then(
        (home) => setArea(home.area),
        () => undefined,
      );
    },
    areaForgot: (was) => {
      setArea(null);
      remember("area", was);
    },
    undo: (key) => void undo(key),
    fix: (key) => {
      clearTimeout(timers.current[key]);
      setForgotten(({ [key]: _fixed, ...rest }) => rest);
      setOpen(key);
      setFocus(undefined);
    },
    hold: (key, holding) => {
      if (holding) clearTimeout(timers.current[key]);
      else if (undoFailed !== key) startUndo(key);
    },
    gone: (key) => {
      // On screen too, so the row that vanishes isn't a mystery (this tab isn't a sheet).
      notify("That was already forgotten, maybe in the chat.");
      void load().then((loaded) => loaded && setFocus(`add:${key}`));
    },
  };

  const empty = !!facts && !known;
  const hero = (
    <View
      style={{
        gap: 14,
        padding: 18,
        borderRadius: 23,
        backgroundColor: colors.sky,
        borderWidth: 1,
        borderColor: colors.blue,
      }}
    >
      <View style={[s.row, { gap: 14, alignItems: "flex-start" }]}>
        <AgentAvatar size={56} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text role="heading" aria-level={2} style={[s.heading, { fontSize: 17, lineHeight: 23 }]}>
            {!facts
              ? "About you"
              : empty
                ? "I don’t know the basics about you yet."
                : `Here’s what I know about you${name ? `, ${name}` : ""}.`}
          </Text>
          {!!facts && (
            <Text style={[s.muted, { color: colors.mutedStrong }]}>
              {empty
                ? "The quickest way to fill this in is a few questions in the chat. Or tell me one thing below."
                : "Each one says where I got it. Tap one to change it or forget it."}
            </Text>
          )}
        </View>
      </View>
      <Button
        primary
        icon={MessageCircleQuestion}
        style={{ alignSelf: "flex-start" }}
        onPress={() => ask("Ask me a few questions for my About you page.")}
      >
        Answer a few questions
      </Button>
      <View style={{ gap: 6 }}>
        <SayOrType
          inline
          placeholder="Tell me more, or fix something"
          prompt="Tell me more"
          micLabel={`Say it to ${agentName}`}
          action={`Tell ${agentName}`}
          onSubmit={(text) => ask(`For my About you page: ${text}`)}
        />
        <Text style={[s.small, { color: colors.mutedStrong }]}>
          Like “My son is Leo, not Leon.” It goes to the chat, and I’ll update this page.
        </Text>
      </View>
    </View>
  );

  return (
    <View style={{ gap: 22 }} onLayout={(event) => setWide(event.nativeEvent.layout.width >= 600)}>
      {hero}
      {/* Always here, so each change is read out; the row itself shows it on screen. */}
      <Text
        role="status"
        aria-live="polite"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0.01 }}
      >
        {status}
      </Text>
      {top}
      {loadError ? (
        <Card style={{ gap: 10 }}>
          <ErrorNotice error="Couldn’t load what I know about you." />
          <Button
            small
            style={{ alignSelf: "flex-start" }}
            onPress={() =>
              void load().then((loaded) => loaded && setFocus(`group:${PERSONA_GROUPS[0]}`))
            }
          >
            Try again
          </Button>
        </Card>
      ) : !page ? (
        <View style={[s.row, { gap: 10, justifyContent: "center", paddingVertical: 12 }]}>
          <ActivityIndicator color={colors.muted} />
          <Text style={s.muted}>Loading what I know about you…</Text>
        </View>
      ) : empty && !showAll ? (
        <StartCard
          page={page}
          onShowAll={() => {
            setShowAll(true);
            setFocus(`group:${PERSONA_GROUPS[0]}`);
          }}
        />
      ) : (
        PERSONA_GROUPS.map((group) => <FactGroup key={group} group={group} page={page} />)
      )}
    </View>
  );
}

/** An empty page: a few things to add first, instead of every group at once. */
function StartCard({ page, onShowAll }: { page: Page; onShowAll: () => void }) {
  const rows = STARTERS.filter((key) => page.open === key || page.forgotten[key]);
  const missing = STARTERS.filter((key) => !rows.includes(key));
  return (
    <Card style={{ gap: 12 }}>
      <View style={[s.row, { gap: 10 }]}>
        <Emoji char="✏️" size={28} />
        <Text role="heading" aria-level={3} style={s.heading}>
          Or add things yourself
        </Text>
      </View>
      {rows.map((key, index) => (
        <Row key={key} rowKey={key} last={index === rows.length - 1} page={page} />
      ))}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {missing.map((key) => (
          <AddButton
            key={key}
            label={labelOf(key)}
            focus={page.focus === `add:${key}`}
            onPress={() => page.openRow(key)}
          />
        ))}
      </View>
      <Button
        small
        icon={ChevronDown}
        style={{ alignSelf: "flex-start", marginTop: 4 }}
        onPress={onShowAll}
      >
        {`Show all ${personaKeys.length + 1}`}
      </Button>
    </Card>
  );
}

function FactGroup({ group, page }: { group: PersonaGroup; page: Page }) {
  const heading = useRef<Text>(null);
  useEffect(() => {
    if (page.focus === `group:${group}`) focusSoon(heading);
  }, [page.focus, group]);
  const keys = personaKeys.filter((key) => PERSONA_FACTS[key].group === group);
  const known = new Set<Open>(page.facts.map((fact) => fact.key));
  if (page.area) known.add("area");
  // Where they live sits after who's at home.
  const rows: Open[] =
    group === "Home and family" ? [...keys.slice(0, 1), "area", ...keys.slice(1)] : keys;
  const missing = rows.filter(
    (key) => page.open !== key && !page.forgotten[key] && !known.has(key),
  );
  const shown = rows.filter((key) => !missing.includes(key));
  return (
    <Card style={{ gap: 2 }}>
      <View style={[s.row, { gap: 10, marginBottom: 8 }]}>
        <Emoji char={GROUP_EMOJI[group]} size={28} />
        <Text
          ref={heading}
          role="heading"
          aria-level={3}
          {...({ tabIndex: -1 } as object)}
          style={s.heading}
        >
          {group}
        </Text>
      </View>
      {shown.map((key, index) => (
        <Row key={key} rowKey={key} last={index === shown.length - 1} page={page} />
      ))}
      {missing.length > 0 && (
        <View style={{ gap: 8, marginTop: shown.length ? 12 : 0 }}>
          <Text style={[s.small, { color: colors.mutedStrong }]}>
            {shown.length ? "Add if you like" : "Nothing here yet"}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {missing.map((key) => (
              <AddButton
                key={key}
                quiet
                label={labelOf(key)}
                focus={page.focus === `add:${key}`}
                onPress={() => page.openRow(key)}
              />
            ))}
          </View>
        </View>
      )}
    </Card>
  );
}

/** One row as it is right now: forgotten (with Undo), open for editing, or showing the fact. */
function Row({ rowKey: key, last, page }: { rowKey: Open; last: boolean; page: Page }) {
  const was = page.forgotten[key];
  if (was)
    return (
      <ForgottenRow
        rowKey={key}
        wasGuess={key !== "area" && (was as PersonaFact).confidence === "guessed"}
        focus={page.focus === `undo:${key}`}
        failed={page.undoFailed === key}
        last={last}
        page={page}
      />
    );
  if (key === "area") {
    if (page.open === "area")
      return (
        <AreaFactEditor
          area={page.area ?? undefined}
          onSaved={page.areaSaved}
          onCancel={() => page.close("area", !page.area)}
          onForgot={page.areaForgot}
        />
      );
    return page.area ? (
      <FactButton
        label={AREA_LABEL}
        value={page.area.label}
        source="You set this"
        at={page.area.setAt}
        wide={page.wide}
        last={last}
        focus={page.focus === "area"}
        flash={page.flash === "area"}
        onPress={() => page.openRow("area")}
      />
    ) : null;
  }
  const fact = page.facts.find((item) => item.key === key);
  if (page.open === key)
    return (
      <FactEditor
        factKey={key}
        fact={fact}
        onSaved={(saved) => page.saved(saved)}
        onCancel={() => page.close(key, !fact)}
        onForgot={page.forgot}
      />
    );
  return fact ? (
    <FactRow
      fact={fact}
      wide={page.wide}
      last={last}
      focus={page.focus === key}
      flash={page.flash === key}
      onOpen={() => page.openRow(key)}
      onConfirmed={(confirmed) => page.saved(confirmed, true)}
      onForgot={page.forgot}
      onGone={() => page.gone(key)}
    />
  ) : null;
}

/** A fact as one tappable row: label, value, and where it came from. */
function FactButton({
  label,
  value,
  source,
  at,
  guess,
  wide,
  last,
  focus,
  flash,
  onPress,
}: {
  label: string;
  value: string;
  source: string;
  at: string;
  guess?: boolean;
  wide: boolean;
  last?: boolean;
  focus?: boolean;
  flash?: boolean;
  onPress: () => void;
}) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (focus) focusSoon(ref);
  }, [focus]);
  const details = (
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={s.text}>{value}</Text>
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        {guess && <Chip tint={colors.lavender}>Guess</Chip>}
        <Text style={[s.small, { color: colors.mutedStrong }]}>
          {source} · {day(at)}
        </Text>
      </View>
    </View>
  );
  // The divider sits outside the rounded press highlight, so it stays a straight line.
  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line }}>
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}. ${
          guess ? "Guess, please confirm. " : ""
        }${source} on ${day(at, "long")}. Edit.`}
        onPress={onPress}
        style={({ pressed }) => [
          {
            flexDirection: wide ? "row" : "column",
            alignItems: wide ? "flex-start" : "stretch",
            gap: wide ? 16 : 3,
            paddingVertical: 12,
            paddingHorizontal: 10,
            marginHorizontal: -10,
            borderRadius: 12,
          },
          flash && { backgroundColor: colors.green },
          pressed && { backgroundColor: colors.subtle },
        ]}
      >
        <View style={[s.row, { gap: 8, width: wide ? 160 : undefined, paddingTop: wide ? 4 : 0 }]}>
          <Text style={[s.small, { flex: 1, fontWeight: "600", color: colors.mutedStrong }]}>
            {label}
          </Text>
          {!wide && <Pencil size={14} color={colors.muted} />}
        </View>
        {wide ? (
          <View style={[s.row, { flex: 1, gap: 12, alignItems: "flex-start" }]}>
            {details}
            <Pencil size={14} color={colors.muted} style={{ marginTop: 5 }} />
          </View>
        ) : (
          details
        )}
      </Pressable>
    </View>
  );
}

function FactRow({
  fact,
  wide,
  last,
  focus,
  flash,
  onOpen,
  onConfirmed,
  onForgot,
  onGone,
}: {
  fact: PersonaFact;
  wide: boolean;
  last: boolean;
  focus: boolean;
  flash: boolean;
  onOpen: () => void;
  onConfirmed: (fact: PersonaFact) => void;
  onForgot: (fact: PersonaFact) => void;
  /** The fact isn't on the server any more: load the page again. */
  onGone: () => void;
}) {
  const { api } = useWorkspace();
  const [busy, setBusy] = useState<"yes" | "no">();
  const [error, setError] = useState("");
  const buttons = useRef<View>(null);
  const guess = fact.confidence === "guessed";
  const label = PERSONA_FACTS[fact.key].label;
  async function decide(right: boolean) {
    setBusy(right ? "yes" : "no");
    setError("");
    try {
      const path = `/api/persona/${encodeURIComponent(fact.key)}/${right ? "confirm" : "forget"}`;
      const result = await api.request<PersonaFact>(path, {});
      if (right) onConfirmed(result);
      else onForgot(fact);
    } catch (e) {
      setBusy(undefined);
      // Changed somewhere else (in the chat, say) while this page was open.
      if (right && /isn't there/.test(message(e))) {
        onGone();
        return;
      }
      setError(right ? "Couldn’t confirm it. Try again." : "Didn’t forget it. Try again.");
      focusSoon(buttons, right ? '[aria-label^="That’s right"]' : '[aria-label^="No,"]');
    }
  }
  return (
    <View>
      <FactButton
        label={label}
        value={fact.value}
        source={personaSourceLabel(fact)}
        at={fact.updatedAt}
        guess={guess}
        wide={wide}
        last={last || guess}
        focus={focus}
        flash={flash}
        onPress={onOpen}
      />
      {guess && (
        <View
          style={{
            gap: 8,
            paddingBottom: 12,
            paddingLeft: wide ? 176 : 0,
            borderBottomWidth: last ? 0 : 1,
            borderBottomColor: colors.line,
          }}
        >
          <View
            ref={buttons}
            role="group"
            aria-label={`Is “${fact.value}” right?`}
            style={[s.row, { gap: 8 }]}
          >
            <Button
              small
              primary
              busy={busy === "yes"}
              disabled={!!busy}
              accessibilityLabel={`That’s right: ${label}, ${fact.value}`}
              onPress={() => void decide(true)}
            >
              That’s right
            </Button>
            <Button
              small
              busy={busy === "no"}
              disabled={!!busy}
              accessibilityLabel={`No, ${fact.value} is wrong. Forget it.`}
              onPress={() => void decide(false)}
            >
              No
            </Button>
          </View>
          <ErrorNotice error={error} />
        </View>
      )}
    </View>
  );
}

/** "Forget …? I won't use it again." with Forget and Keep; focus moves in and back out. */
function ForgetControl({
  question,
  busy,
  disabled,
  onForget,
  failed,
}: {
  question: string;
  busy: boolean;
  disabled: boolean;
  onForget: () => void;
  /** Set after a failed try, so focus comes back to Forget. */
  failed: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const confirm = useRef<View>(null);
  const start = useRef<View>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (confirming) focusSoon(confirm, BUTTON);
    else if (opened.current) focusSoon(start, BUTTON);
    opened.current = confirming;
  }, [confirming]);
  useEffect(() => {
    if (failed) focusSoon(confirm, BUTTON);
  }, [failed]);
  return confirming ? (
    <View ref={confirm} role="group" aria-label={question} style={{ gap: 8, marginTop: 4 }}>
      <Text style={s.text}>{question}</Text>
      <View style={[s.row, { gap: 8 }]}>
        <Button small danger busy={busy} onPress={onForget}>
          Forget
        </Button>
        <Button small disabled={busy} onPress={() => setConfirming(false)}>
          Keep it
        </Button>
      </View>
    </View>
  ) : (
    <View ref={start} style={{ alignSelf: "flex-start", marginTop: 4 }}>
      <Button small danger disabled={disabled} onPress={() => setConfirming(true)}>
        Forget this
      </Button>
    </View>
  );
}

/** An open row: change the fact by typing or saying it, or forget it. Also adds a new one. */
function FactEditor({
  factKey,
  fact,
  onSaved,
  onCancel,
  onForgot,
}: {
  factKey: PersonaKey;
  fact?: PersonaFact;
  onSaved: (fact: PersonaFact) => void;
  onCancel: () => void;
  onForgot: (fact: PersonaFact) => void;
}) {
  const { api } = useWorkspace();
  const info = PERSONA_FACTS[factKey];
  const [value, setValue] = useState(fact?.value ?? "");
  const [busy, setBusy] = useState<"save" | "forget">();
  const [error, setError] = useState("");
  const [forgetFailed, setForgetFailed] = useState(0);
  const field = useRef<View>(null);
  const clean = value.trim();
  async function save() {
    if (!clean || busy) return;
    if (clean === fact?.value && fact.confidence !== "guessed") return onCancel();
    setBusy("save");
    setError("");
    try {
      onSaved(
        await api.request<PersonaFact>(`/api/persona/${encodeURIComponent(factKey)}`, {
          value: clean,
        }),
      );
    } catch {
      setError("Didn’t save. Try again.");
      setBusy(undefined);
      focusSoon(field, TEXT_BOX);
    }
  }
  async function forget() {
    if (!fact) return;
    setBusy("forget");
    setError("");
    try {
      await api.request(`/api/persona/${encodeURIComponent(factKey)}/forget`, {});
      onForgot(fact);
    } catch {
      setError("Didn’t forget it. Try again.");
      setBusy(undefined);
      setForgetFailed((count) => count + 1);
    }
  }
  return (
    <EditorFrame onEscape={onCancel}>
      <View ref={field}>
        <Field
          label={info.label}
          value={value}
          onChangeText={setValue}
          placeholder={info.hint}
          autoFocus
          maxLength={300}
          returnKeyType="done"
          blurOnSubmit={false}
          onSubmitEditing={() => void save()}
        />
      </View>
      <View style={[s.row, { gap: 8, flexWrap: "wrap", alignItems: "flex-start", marginTop: -6 }]}>
        <Button
          small
          primary
          busy={busy === "save"}
          disabled={!clean || !!busy}
          onPress={() => void save()}
        >
          Save
        </Button>
        <DictateButton
          label="Say it instead"
          onText={(heard) => {
            setValue(heard);
            // So a screen reader reads what was heard.
            focusSoon(field, TEXT_BOX);
          }}
        />
        <Button small disabled={!!busy} onPress={onCancel}>
          Cancel
        </Button>
      </View>
      {fact && (
        <ForgetControl
          question={`Forget “${info.label}: ${fact.value}”? I won’t use it again.`}
          busy={busy === "forget"}
          disabled={!!busy}
          failed={forgetFailed}
          onForget={() => void forget()}
        />
      )}
      <ErrorNotice error={error} />
    </EditorFrame>
  );
}

/** Where they live: the home area that local news, weather and "near me" searches use. */
function AreaFactEditor({
  area,
  onSaved,
  onCancel,
  onForgot,
}: {
  area?: Area;
  onSaved: () => void;
  onCancel: () => void;
  onForgot: (was: Area) => void;
}) {
  const { api } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forgetFailed, setForgetFailed] = useState(0);
  const country = area?.country ?? homeCountry();
  async function forget() {
    if (!area) return;
    setBusy(true);
    setError("");
    try {
      await api.request("/api/area/clear", {});
      onForgot(area);
    } catch {
      setError("Didn’t forget it. Try again.");
      setBusy(false);
      setForgetFailed((count) => count + 1);
    }
  }
  return (
    <EditorFrame onEscape={onCancel}>
      <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>
        {area ? `${AREA_LABEL}: ${area.label}` : AREA_LABEL}
      </Text>
      <Text style={[s.small, { color: colors.mutedStrong, marginTop: -4 }]}>
        {!country || country === "US"
          ? "For your local news, weather and “near me” searches."
          : "For your local news and “near me” searches."}
      </Text>
      <AreaEditor autoFocus onSaved={onSaved} onCancel={onCancel} />
      {area && (
        <ForgetControl
          question={`Forget “${AREA_LABEL}: ${area.label}”? I won’t use it again.`}
          busy={busy}
          disabled={busy}
          failed={forgetFailed}
          onForget={() => void forget()}
        />
      )}
      <ErrorNotice error={error} />
    </EditorFrame>
  );
}

function EditorFrame({ children, onEscape }: { children: ReactNode; onEscape: () => void }) {
  const ref = useRef<View>(null);
  useEscape(ref, onEscape);
  return (
    <View
      ref={ref}
      style={{
        gap: 10,
        paddingVertical: 14,
        paddingHorizontal: 10,
        marginVertical: 6,
        // Lines up with the rows' press highlight, and the label with theirs.
        marginHorizontal: -10,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.canvas,
      }}
    >
      {children}
    </View>
  );
}

/** "Forgotten: Your team." with Undo for a few seconds, and after a wrong guess, a way to fix it. */
function ForgottenRow({
  rowKey: key,
  wasGuess,
  focus,
  failed,
  last,
  page,
}: {
  rowKey: Open;
  wasGuess: boolean;
  focus: boolean;
  failed: boolean;
  last: boolean;
  page: Page;
}) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (focus) focusSoon(ref, BUTTON);
  }, [focus]);
  const label = labelOf(key);
  // Undo stays while any of its buttons is focused or under the pointer.
  const holders = useRef(new Set<string>());
  const hold = (why: string, holding: boolean) => {
    if (holding) holders.current.add(why);
    else holders.current.delete(why);
    page.hold(key, holders.current.size > 0);
  };
  return (
    <View
      ref={ref}
      nativeID={undoId(key)}
      style={{
        gap: 8,
        paddingVertical: 10,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
      }}
    >
      <View style={[s.row, { gap: 12, flexWrap: "wrap" }]}>
        <Text style={[s.text, { flex: 1, minWidth: 140, color: colors.mutedStrong }]}>
          Forgotten: {label}.
        </Text>
        <View style={[s.row, { gap: 8 }]}>
          <SmallButton
            label="Undo"
            accessibilityLabel={`Undo: put back ${label}`}
            onPress={() => page.undo(key)}
            onHold={hold}
          />
          {wasGuess && key !== "area" && (
            <SmallButton
              label="Add the right one"
              accessibilityLabel={`Add the right one: ${label}`}
              onPress={() => page.fix(key)}
              onHold={hold}
            />
          )}
        </View>
      </View>
      {failed && <ErrorNotice error="Couldn’t put it back. Try again." />}
    </View>
  );
}

/** A small button that tells the row when it's in use, so Undo doesn't vanish under the pointer. */
function SmallButton({
  label,
  accessibilityLabel,
  onPress,
  onHold,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  /** Why it's held ("Undo focus", "Undo hover") and whether that still holds. */
  onHold: (why: string, holding: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onFocus={() => onHold(`${label} focus`, true)}
      onBlur={() => onHold(`${label} focus`, false)}
      onHoverIn={() => onHold(`${label} hover`, true)}
      onHoverOut={() => onHold(`${label} hover`, false)}
      style={({ pressed }) => [
        s.button,
        s.secondary,
        { minHeight: 38, paddingVertical: 7, paddingHorizontal: 13 },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <Text style={[s.buttonText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function AddButton({
  label,
  focus,
  quiet,
  onPress,
}: {
  label: string;
  focus: boolean;
  /** Outlined, not filled, so it sits behind the facts and decisions in a group. */
  quiet?: boolean;
  onPress: () => void;
}) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (focus) focusSoon(ref, BUTTON);
  }, [focus]);
  return (
    // Its own width limit, so a long label wraps inside the button, not past the card.
    <View ref={ref} style={{ maxWidth: "100%" }}>
      <Button
        small
        icon={Plus}
        style={
          quiet
            ? {
                backgroundColor: "transparent",
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: colors.edge,
                paddingHorizontal: 12,
              }
            : undefined
        }
        accessibilityLabel={`${label}: not set yet. Add it.`}
        onPress={onPress}
      >
        {label}
      </Button>
    </View>
  );
}
