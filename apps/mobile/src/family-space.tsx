import { CalendarClock, Check, MessageCircle, ShoppingCart, Sun } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  FAMILY_APPS,
  FAMILY_TONES,
  type FamilyMember,
  type FamilyPlaybookPatch,
  type FamilySpace,
} from "../../../packages/domain/src/spaces";
import { useAgentWorkspace } from "./agent-workspace";
import { monthDay, TodayTimeline, useWeekBoard, WeekBoard } from "./family-week-ui";
import { clockTime } from "./meal-checkins-ui";
import { parseTime } from "./space-input";
import {
  AddLine,
  appOf,
  DAY_NAMES,
  heading,
  QueueRow,
  Removable,
  RemoveSpace,
  replace,
  SavedQuestions,
  Section,
  type SectionState,
  Stepper,
  TightField,
  useOpenChat,
  usePlaybookSave,
} from "./spaces";
import { Button, Card, colors, dateLabel, ErrorNotice, InfoTip, plainPreview, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * The family planner: a space for a busy household. Its Overview shows today's rundown, the
 * week's plan and anything waiting for an OK; its Playbook is what the agent knows about the
 * family and follows every week.
 */

const WEEK_REQUEST = "Please plan our week ahead.";
const GROCERY_REQUEST = "Make the grocery list for this week’s meals.";
const TODAY_REQUEST = "What’s on today?";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const MORNINGS = [
  { label: "6:30 AM", time: "06:30" },
  { label: "7:00 AM", time: "07:00" },
  { label: "7:30 AM", time: "07:30" },
  { label: "8:00 AM", time: "08:00" },
];
const COOKING_TIMES = ["20 minutes", "30 minutes", "45 minutes", "No limit"];

type Save = (section: string, patch: FamilyPlaybookPatch, removed?: string) => Promise<boolean>;
const label = [s.small, { fontWeight: "600" as const, color: colors.text }];

/** "Every day", "Weekdays", or the days listed. */
function daysLabel(days: number[]) {
  const set = [...days].sort().join(",");
  if (set === EVERY_DAY.join(",")) return "Every day";
  if (set === WEEKDAYS.join(",")) return "Weekdays";
  return days.map((day) => DAY_NAMES[day]?.slice(0, 3)).join(", ");
}

export function FamilyOverview({
  space,
  agentName,
  onPlaybook,
}: {
  space: FamilySpace;
  agentName: string;
  /** Opens the Playbook tab, where the rundown's days and time are changed. */
  onPlaybook?: () => void;
}) {
  const { workspace, open, api } = useWorkspace();
  const { data, mutate } = useAgentWorkspace();
  const openChat = useOpenChat();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [all, setAll] = useState(false);
  const { board, error: boardError, change, load: reloadBoard } = useWeekBoard(space);
  const week = board?.week;
  // Each request names its week: "Plan next week" leaves this week's board as it is, and with
  // this week's board empty, "Plan this week" fills it.
  const nextWeekRequest = board
    ? `Please plan next week, the week of ${monthDay(board.nextWeek)}.`
    : "Please plan next week.";
  const thisWeekRequest = board
    ? `Please plan this week, the week of ${monthDay(board.thisWeek)}.`
    : WEEK_REQUEST;
  const waiting = workspace.actions.filter(
    (action) =>
      action.status === "awaiting_review" &&
      action.kind === "app.action" &&
      FAMILY_APPS.test(appOf(action)),
  );
  const routine = data?.routines.find((item) => item.id === space.digestRoutineId);
  const latest = data?.tasks.find((task) => task.id === routine?.lastTaskId);
  const plan = space.playbook.weekPlan;
  const long = (plan?.split("\n").length ?? 0) > 10 || (plan?.length ?? 0) > 500;
  const planningDay = DAY_NAMES[space.playbook.planningDay ?? 0];
  async function run(name: string, work: () => Promise<unknown>) {
    setBusy(name);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  const rundownOn = () =>
    run("rundown", async () =>
      replace(
        await api.request<FamilySpace>(`/api/spaces/${space.id}/digest`, {
          on: true,
          days: EVERY_DAY,
          time: "06:45",
        }),
      ),
    );
  const done = () =>
    run("done", async () =>
      replace(
        await api.request<FamilySpace>(`/api/spaces/${space.id}/playbook`, { setupDone: true }),
      ),
    );
  return (
    <View style={{ gap: 26 }}>
      <ErrorNotice error={error || boardError} />
      {!space.setupDone && (
        <Card style={{ gap: 12, backgroundColor: colors.sky, borderColor: colors.sky }}>
          <Text {...heading(3)} style={s.heading}>
            {space.threadStarted ? "Finish setting up" : `Set up with ${agentName}`}
          </Text>
          <Text style={[s.text, { color: colors.mutedStrong }]}>
            {agentName} asks a few quick questions: who’s in the house, what you eat, how your week
            runs and who does what. Then it plans your week and keeps it on track.
          </Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button primary icon={MessageCircle} onPress={() => openChat(space)}>
              {space.threadStarted ? "Continue in chat" : "Start setup"}
            </Button>
            {space.threadStarted && (
              <Button icon={Check} busy={busy === "done"} onPress={() => void done()}>
                I’m done setting up
              </Button>
            )}
          </View>
        </Card>
      )}

      <View style={{ gap: 10 }}>
        <Text {...heading(3)} style={s.heading}>
          Today
        </Text>
        {board?.current && <TodayTimeline space={space} week={board.current} today={board.today} />}
        {routine ? (
          <Card style={{ gap: 10 }}>
            <View style={[s.row, { gap: 10 }]}>
              <Sun size={18} color={colors.blueDark} />
              <Text style={[s.text, { flex: 1 }]}>
                {daysLabel(routine.days)} at {clockTime(routine.time)}
                {routine.nextRunAt ? ` · next ${dateLabel(routine.nextRunAt)}` : ""}
              </Text>
            </View>
            {latest ? (
              <>
                <Text numberOfLines={8} style={[s.text, { color: colors.mutedStrong }]}>
                  {latest.result
                    ? plainPreview(latest.result)
                    : latest.status === "running" || latest.status === "queued"
                      ? "Working on today’s rundown…"
                      : (latest.question ?? "Today’s rundown needs you.")}
                </Text>
                <Button
                  small
                  style={{ alignSelf: "flex-start" }}
                  onPress={() => open({ type: "task", taskId: latest.id })}
                >
                  Open the rundown
                </Button>
              </>
            ) : (
              <Text style={s.muted}>Your first rundown comes tomorrow morning.</Text>
            )}
            <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
              <Button
                small
                busy={busy === "now"}
                onPress={() => void run("now", () => mutate(`/routines/${routine.id}/run`, {}))}
              >
                Make one now
              </Button>
              {onPlaybook && (
                <Button small onPress={onPlaybook}>
                  Change days or time
                </Button>
              )}
            </View>
          </Card>
        ) : (
          <Card style={{ gap: 10 }}>
            <Text style={[s.text, { color: colors.mutedStrong }]}>
              A short note each morning: today’s schedule, dinner tonight and any prep, chores due,
              and one thing to get ready for tomorrow. It starts every day at 6:45 AM; change that
              in the Playbook.
            </Text>
            <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
              <Button
                primary={space.setupDone}
                small
                icon={Sun}
                busy={busy === "rundown"}
                onPress={() => void rundownOn()}
              >
                Turn on the morning rundown
              </Button>
              <Button small onPress={() => openChat(space, TODAY_REQUEST)}>
                What’s on today?
              </Button>
            </View>
          </Card>
        )}
      </View>

      {week ? (
        <View style={{ gap: 14 }}>
          <WeekBoard
            space={space}
            agentName={agentName}
            board={{ ...board, week }}
            change={change}
            reload={reloadBoard}
          />
          <Button
            icon={CalendarClock}
            style={{ alignSelf: "flex-start" }}
            onPress={() => openChat(space, nextWeekRequest)}
          >
            Plan next week
          </Button>
          {board.nextPlanned && week.weekStart === board.thisWeek && (
            <Text style={s.muted}>Next week is planned. It shows here on Saturday.</Text>
          )}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Text {...heading(3)} style={s.heading}>
            This week
          </Text>
          <Card style={{ gap: 10 }}>
            {plan ? (
              <Text numberOfLines={all ? undefined : 10} style={s.text}>
                {plan}
              </Text>
            ) : (
              <Text style={[s.text, { color: colors.mutedStrong }]}>
                No plan yet. {agentName} writes one whenever you ask, and every {planningDay} once
                the morning rundown is on: dinners, the grocery list, the schedule, chores and a
                couple of ideas for free time.
              </Text>
            )}
            {!!plan && long && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setAll(!all)}
                style={{ alignSelf: "flex-end", minHeight: 32, justifyContent: "center" }}
              >
                <Text style={[s.muted, { color: colors.blueDark, fontWeight: "600" }]}>
                  {all ? "Show less" : "Show the whole plan"}
                </Text>
              </Pressable>
            )}
            <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
              {/* This week's board is empty here, so the button fills it, even under an older plan. */}
              <Button
                small
                primary={space.setupDone}
                icon={CalendarClock}
                onPress={() => openChat(space, thisWeekRequest)}
              >
                {space.setupDone ? "Plan this week" : "Set up the basics and plan the week"}
              </Button>
              <Button small icon={ShoppingCart} onPress={() => openChat(space, GROCERY_REQUEST)}>
                Grocery list
              </Button>
            </View>
          </Card>
        </View>
      )}

      <View style={{ gap: 10 }}>
        <View style={[s.row, { gap: 8 }]}>
          <Text {...heading(3)} style={s.heading}>
            Needs you
          </Text>
          <InfoTip
            term="Needs you"
            text={`Changes ${agentName} wants to make to your calendar or lists. Nothing is added until you OK it.`}
          />
          {waiting.length > 0 && (
            <View
              style={{
                paddingHorizontal: 9,
                paddingVertical: 2,
                borderRadius: 10,
                backgroundColor: colors.lavender,
              }}
            >
              <Text style={[s.small, { color: colors.text, fontWeight: "600" }]}>
                {waiting.length}
              </Text>
            </View>
          )}
        </View>
        {waiting.length ? (
          <Card style={{ gap: 2, paddingVertical: 6 }}>
            {waiting.map((action, index) => (
              <QueueRow
                key={action.id}
                first={index === 0}
                app={appOf(action)}
                title={action.title}
              >
                <Button
                  small
                  primary
                  accessibilityLabel={`Review: ${action.title}`}
                  onPress={() => open({ type: "review", action })}
                >
                  Review
                </Button>
              </QueueRow>
            ))}
          </Card>
        ) : (
          <Text style={s.muted}>
            Nothing waiting. When {agentName} wants to change the calendar, it asks here first.
          </Text>
        )}
      </View>

      <SavedQuestions space={space} onAsk={(text) => openChat(space, text)} />
    </View>
  );
}

export function FamilyPlaybook({
  space,
  agentName,
  onRemoved,
}: {
  space: FamilySpace;
  agentName: string;
  onRemoved: () => void;
}) {
  const { notify } = useWorkspace();
  const openChat = useOpenChat();
  const book = space.playbook;
  const { save, section, saving } = usePlaybookSave<FamilyPlaybookPatch>(space);
  const saved: Save = async (id, patch, removed) => {
    const ok = await save(id, patch, removed);
    if (ok && !removed) notify("Saved");
    return ok;
  };
  const empty = !book.family.length && !book.foodRules.length && !book.weekShape;
  return (
    <View style={{ gap: 16 }}>
      <Text style={s.muted}>
        What {agentName} knows about your family and follows every week. It fills in during setup,
        and you can change anything here.
      </Text>
      {empty && (
        <Card style={{ gap: 10, backgroundColor: colors.sky, borderColor: colors.sky }}>
          <Text style={s.text}>Nothing here yet.</Text>
          <Button
            small
            primary
            icon={MessageCircle}
            style={{ alignSelf: "flex-start" }}
            onPress={() => openChat(space)}
          >
            {space.threadStarted ? "Continue in chat" : `Set up with ${agentName}`}
          </Button>
        </Card>
      )}
      <Family space={space} save={save} {...section("family")} />
      <Food space={space} save={save} saving={saving === "food"} {...section("food")} />
      <LongText
        title="The week"
        field="weekShape"
        hint="School and work hours, activities, pickups: who’s where when."
        value={book.weekShape ?? ""}
        save={saved}
        {...section("weekShape")}
      />
      <Chips
        title="Chores"
        field="chores"
        hint="Who does what, one job at a time."
        add="Add a chore"
        placeholder="e.g. Maya: set the table"
        items={book.chores}
        save={save}
        {...section("chores")}
      />
      <LongText
        title="Mornings and evenings"
        field="routines"
        hint="How they should go, and where they tend to fall apart."
        value={book.routines ?? ""}
        save={saved}
        {...section("routines")}
      />
      <Chips
        title="What everyone enjoys"
        field="interests"
        hint="For activity ideas that fit."
        add="Add an interest"
        placeholder="e.g. Maya: dinosaurs, drawing"
        items={book.interests}
        save={save}
        {...section("interests")}
      />
      <Tone space={space} agentName={agentName} save={saved} {...section("tone")} />
      <PlanningDay space={space} agentName={agentName} save={saved} {...section("planningDay")} />
      <Rundown space={space} />
      <RemoveSpace space={space} onRemoved={onRemoved} />
    </View>
  );
}

/** "Maya, 8" or "Maya (8)" gives a name and an age; "Dad" is just a name. */
export function parseMember(text: string): FamilyMember {
  const match = /^(.+?)[\s,(]+(\d{1,3})\)?\s*$/.exec(text.trim());
  if (match?.[1]) return { name: match[1].replace(/[\s,(]+$/, ""), age: Number(match[2]) };
  return { name: text.trim() };
}

function Family({ space, save, ...state }: SectionState & { space: FamilySpace; save: Save }) {
  const { family } = space.playbook;
  const shown = (member: FamilyMember) =>
    `${member.name}${member.age !== undefined ? `, ${member.age}` : ""}${member.notes ? ` · ${member.notes}` : ""}`;
  return (
    <Section title="Who’s in the house" {...state}>
      <Text style={s.muted}>
        First names are enough. Ages help with chores and activity ideas; grown-ups don’t need one.
      </Text>
      {family.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {family.map((member) => (
            <Removable
              key={member.name}
              label={shown(member)}
              onRemove={() =>
                void save("family", { family: family.filter((m) => m !== member) }, member.name)
              }
            />
          ))}
        </View>
      )}
      <AddLine
        label="Add someone"
        placeholder="e.g. Maya, 8"
        taken={family.map((member) => member.name)}
        onAdd={(text) => {
          const member = parseMember(text);
          if (family.some((m) => m.name.toLowerCase() === member.name.toLowerCase())) return;
          void save("family", { family: [...family, member] });
        }}
      />
    </Section>
  );
}

function Food({
  space,
  save,
  saving,
  ...state
}: SectionState & { space: FamilySpace; save: Save; saving: boolean }) {
  const book = space.playbook;
  return (
    <Section title="Food" {...state}>
      <View style={{ gap: 8 }}>
        <Text style={label}>Off the menu: allergies, diets and firm dislikes</Text>
        {book.foodRules.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {book.foodRules.map((rule) => (
              <Removable
                key={rule}
                label={rule}
                onRemove={() =>
                  void save("food", { foodRules: book.foodRules.filter((r) => r !== rule) }, rule)
                }
              />
            ))}
          </View>
        )}
        <AddLine
          label="Add a food rule"
          placeholder="e.g. No peanuts"
          taken={book.foodRules}
          onAdd={(rule) => void save("food", { foodRules: [...book.foodRules, rule] })}
        />
      </View>
      <View style={{ gap: 8 }}>
        <Text style={label}>Meals everyone likes</Text>
        {book.favorites.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {book.favorites.map((meal) => (
              <Removable
                key={meal}
                label={meal}
                onRemove={() =>
                  void save("food", { favorites: book.favorites.filter((m) => m !== meal) }, meal)
                }
              />
            ))}
          </View>
        )}
        <AddLine
          label="Add a favorite"
          placeholder="e.g. Taco night"
          taken={book.favorites}
          onAdd={(meal) => void save("food", { favorites: [...book.favorites, meal] })}
        />
      </View>
      <Stepper
        label="Dinners to plan each week"
        value={book.dinnersPerWeek ?? 5}
        max={7}
        busy={saving}
        onChange={(value) => void save("food", { dinnersPerWeek: value })}
      />
      <View style={{ gap: 8 }}>
        <Text style={label}>Time to cook on a weeknight</Text>
        <View
          role="group"
          aria-label="Time to cook"
          style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
        >
          {COOKING_TIMES.map((time) => (
            <Button
              key={time}
              small
              selected={book.cookingTime === time}
              primary={book.cookingTime === time}
              onPress={() => void save("food", { cookingTime: time })}
            >
              {time}
            </Button>
          ))}
        </View>
      </View>
    </Section>
  );
}

/** A paragraph the person writes in their own words, saved when they leave the box. */
function LongText({
  title,
  field,
  hint,
  value,
  save,
  ...state
}: SectionState & {
  title: string;
  field: "weekShape" | "routines" | "notes";
  hint: string;
  value: string;
  save: Save;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const changed = text.trim() !== value;
  const commit = () => void save(field, { [field]: text.trim() || null });
  return (
    <Section title={title} {...state}>
      <Text style={s.muted}>{hint}</Text>
      <TightField
        label={title}
        hideLabel
        multiline
        value={text}
        onChangeText={setText}
        onBlur={() => {
          if (changed) commit();
        }}
      />
      {changed && (
        <Button small primary style={{ alignSelf: "flex-start" }} onPress={commit}>
          Save
        </Button>
      )}
    </Section>
  );
}

/** A list of short lines with an Add box, for chores and interests. */
function Chips({
  title,
  field,
  hint,
  add,
  placeholder,
  items,
  save,
  ...state
}: SectionState & {
  title: string;
  field: "chores" | "interests";
  hint: string;
  add: string;
  placeholder: string;
  items: string[];
  save: Save;
}) {
  return (
    <Section title={title} {...state}>
      <Text style={s.muted}>{hint}</Text>
      {items.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {items.map((item) => (
            <Removable
              key={item}
              label={item}
              onRemove={() => void save(field, { [field]: items.filter((i) => i !== item) }, item)}
            />
          ))}
        </View>
      )}
      <AddLine
        label={add}
        placeholder={placeholder}
        taken={items}
        onAdd={(item) => void save(field, { [field]: [...items, item] })}
      />
    </Section>
  );
}

function Tone({
  space,
  agentName,
  save,
  ...state
}: SectionState & { space: FamilySpace; agentName: string; save: Save }) {
  const tone = space.playbook.tone ?? "warm";
  const chosen = FAMILY_TONES.find((item) => item.id === tone);
  return (
    <Section title={`How ${agentName} talks to you`} {...state}>
      <View
        role="group"
        aria-label="Tone"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
      >
        {FAMILY_TONES.map((item) => (
          <Button
            key={item.id}
            small
            selected={tone === item.id}
            primary={tone === item.id}
            onPress={() => void save("tone", { tone: item.id })}
          >
            {item.label}
          </Button>
        ))}
      </View>
      <Text style={s.muted}>{chosen?.about}. Always with some understanding for a busy week.</Text>
    </Section>
  );
}

function PlanningDay({
  space,
  agentName,
  save,
  ...state
}: SectionState & { space: FamilySpace; agentName: string; save: Save }) {
  const day = space.playbook.planningDay ?? 0;
  return (
    <Section title="Planning day" {...state}>
      <Text style={s.muted}>
        The day {agentName} plans the week ahead: dinners, groceries, chores.
      </Text>
      <View
        role="group"
        aria-label="Planning day"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
      >
        {DAY_NAMES.map((name, index) => (
          <Button
            key={name}
            small
            selected={day === index}
            primary={day === index}
            accessibilityLabel={name}
            onPress={() => void save("planningDay", { planningDay: index })}
          >
            {name.slice(0, 3)}
          </Button>
        ))}
      </View>
    </Section>
  );
}

/** The morning rundown: which days and what time. */
function Rundown({ space }: { space: FamilySpace }) {
  const { api, notify } = useWorkspace();
  const { data } = useAgentWorkspace();
  const routine = data?.routines.find((item) => item.id === space.digestRoutineId);
  const [days, setDays] = useState<number[]>(routine?.days ?? EVERY_DAY);
  const [time, setTime] = useState(routine?.time ?? "06:45");
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (routine) {
      setDays(routine.days);
      setTime(routine.time);
    }
  }, [routine?.days, routine?.time, routine]);
  const typed = other.trim() ? parseTime(other) : undefined;
  const chosen = typed ?? time;
  const same = (a: number[], b: number[]) => [...a].sort().join() === [...b].sort().join();
  const changed = !routine || !same(days, routine.days) || chosen !== routine.time;
  const toggle = (day: number) =>
    setDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    );
  async function set(on: boolean) {
    setBusy(true);
    setError("");
    try {
      replace(
        await api.request<FamilySpace>(`/api/spaces/${space.id}/digest`, {
          on,
          days,
          time: chosen,
        }),
      );
      notify(
        on ? `Morning rundown: ${daysLabel(days)} at ${clockTime(chosen)}` : "Morning rundown off",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Morning rundown">
      <Text style={s.muted}>
        A short note before the day starts, in your time zone. On your planning day it brings the
        week’s plan too.
      </Text>
      <Text style={label}>Which mornings</Text>
      <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
        <Button
          small
          selected={same(days, EVERY_DAY)}
          primary={same(days, EVERY_DAY)}
          onPress={() => setDays(EVERY_DAY)}
        >
          Every day
        </Button>
        <Button
          small
          selected={same(days, WEEKDAYS)}
          primary={same(days, WEEKDAYS)}
          onPress={() => setDays(WEEKDAYS)}
        >
          Weekdays
        </Button>
      </View>
      <View
        role="group"
        aria-label="Which mornings"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
      >
        {DAY_NAMES.map((name, index) => (
          <Button
            key={name}
            small
            selected={days.includes(index)}
            primary={days.includes(index)}
            accessibilityLabel={name}
            onPress={() => toggle(index)}
          >
            {name.slice(0, 3)}
          </Button>
        ))}
      </View>
      <Text style={label}>What time</Text>
      <View
        role="group"
        aria-label="What time"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
      >
        {MORNINGS.map((item) => (
          <Button
            key={item.time}
            small
            selected={!other.trim() && time === item.time}
            primary={!other.trim() && time === item.time}
            onPress={() => {
              setOther("");
              setTime(item.time);
            }}
          >
            {item.label}
          </Button>
        ))}
      </View>
      <TightField
        label="Or another time"
        placeholder="e.g. 6:45 am"
        value={other}
        onChangeText={setOther}
      />
      {typed === null && <Text style={s.small}>Try a time like 6:45 am or 06:45.</Text>}
      {typed && <Text style={s.small}>{clockTime(typed)}</Text>}
      <ErrorNotice error={error} />
      {routine && changed && <Text style={s.small}>Not saved yet.</Text>}
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button
          small
          primary
          busy={busy}
          disabled={typed === null || !days.length || !changed}
          onPress={() => void set(true)}
        >
          {routine ? "Save" : "Turn on"}
        </Button>
        {routine && (
          <Button small disabled={busy} onPress={() => void set(false)}>
            Turn off
          </Button>
        )}
      </View>
    </Section>
  );
}
