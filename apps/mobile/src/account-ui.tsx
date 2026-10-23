import { Check, ChevronDown, ChevronUp } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { type Counted, PLAN_ORDER, PLANS, type PlanId } from "../../../packages/domain/src/plans";
import { Button, Card, Chip, colors, ErrorNotice, Field, SectionHeading, s } from "./ui";
import { disablePush, pushState } from "./web-app";
import { useWorkspace } from "./workspace";

interface Person {
  id: string;
  email?: string;
  name: string;
  role: "admin" | "member";
  handle?: string;
  status?: "active" | "disabled";
  lastSignInAt?: string;
  createdAt?: string;
  agentEmail?: string;
  /** Their live-talk voice: "openai", "pipecat" (our own), or "default". */
  voice?: string;
  /** Minutes on the new voice this month (people using it). */
  voiceMinutes?: number;
  /** Their plan, this month's limits and what they've used (admin's list only). */
  plan?: {
    plan: PlanId;
    name: string;
    limit: Record<Counted, number | null>;
    messages: number;
    jobs: number;
  };
}
type VoiceChoice = "openai" | "pipecat";
interface VoiceSettings {
  default: VoiceChoice;
  mine: string;
  /** Each person's monthly minutes on the new voice (0: no limit). */
  limitMinutes: number;
  idleSeconds: number;
}
/** One voice's side of the comparison (GET /api/voice/compare). */
interface VoiceSide {
  calls: number;
  minutes: number;
  latencyMs: { median?: number; p90?: number };
  costPerMinute: { total?: number };
}
/** Someone who tapped "Request access" on the sign-in screen. */
interface AccessRequest {
  id: string;
  email: string;
  name: string;
  note?: string;
  createdAt: string;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** What each extra adds, for the buttons and the toast ("Add 50 messages"). */
const EXTRA_SHORT: Record<Counted, string> = {
  callMinutes: "30 minutes of calls",
  messages: "50 messages",
  meetingHours: "1 meeting hour",
  jobs: "1 job",
};
const EXTRA_BUTTON: Record<Counted, string> = {
  callMinutes: `Add ${EXTRA_SHORT.callMinutes}`,
  messages: `Add ${EXTRA_SHORT.messages}`,
  meetingHours: `Add ${EXTRA_SHORT.meetingHours}`,
  jobs: `Add ${EXTRA_SHORT.jobs}`,
};
/** People and requests shown at first, and added by "Show more". */
const PAGE = 8;
const REQUESTS_FIRST = 3;
/** A heading inside a card, one step below the card's own. */
const subheading = [s.small, { fontWeight: "600" as const, color: colors.text, marginTop: 6 }];

/** Who is signed in on this device, their agent's address, and signing out. */
export function AccountCard() {
  const { api, refresh, notify } = useWorkspace();
  const [me, setMe] = useState<Person>();
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    void api.request<Person>("/api/me").then(setMe, () => undefined);
  }, [api]);
  if (!me) return null;
  async function signOut() {
    setBusy(true);
    // Notifications on this device belong to the person signing out.
    if (Platform.OS === "web" && (await pushState().catch(() => undefined)) === "on")
      await disablePush(api).catch(() => undefined);
    await api.signOut();
  }
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="Your account" />
      <Text style={s.text}>
        {me.name}
        {me.email ? ` · ${me.email}` : ""}
      </Text>
      {me.agentEmail && (
        <Text style={s.muted}>
          Your agent’s email address is <Text selectable>{me.agentEmail}</Text>.
        </Text>
      )}
      {/* The app reloads by itself when you come back to it; this is for the rare stuck moment. */}
      <Button
        busy={reloading}
        onPress={() => {
          setReloading(true);
          void refresh()
            .then(() => notify("Your data is up to date."))
            .catch(() => notify("Couldn’t reload. Check your connection and try again."))
            .finally(() => setReloading(false));
        }}
      >
        Reload my data
      </Button>
      <Button busy={busy} onPress={() => void signOut()}>
        Sign out of this device
      </Button>
    </Card>
  );
}

/** The admin invites people; each gets a private workspace and their own agent address. */
export function PeopleCard() {
  const { api, notify } = useWorkspace();
  const [people, setPeople] = useState<Person[]>();
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  /** The request whose Decline was tapped once; a second tap declines. */
  const [declining, setDeclining] = useState("");
  const [emailSignIn, setEmailSignIn] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  /** Live-talk voices, once our own voice is set up: everyone's default, and the admin's own. */
  const [voice, setVoice] = useState<VoiceSettings>();
  /** The two voices side by side, over the last 7 or 30 days, once asked for. */
  const [compare, setCompare] = useState<{
    days: number;
    openai: VoiceSide;
    pipecat: VoiceSide;
  }>();
  const [comparing, setComparing] = useState(0);
  /** Who is shown: a search, how many rows, which row is open, and what is folded away. */
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState("");
  /** The person whose Remove access was tapped once; a second tap removes them. */
  const [removing, setRemoving] = useState("");
  const [allRequests, setAllRequests] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [compareError, setCompareError] = useState("");
  const load = useCallback(
    () =>
      api
        .request<{
          emailSignIn: boolean;
          accounts: Person[];
          requests?: AccessRequest[];
          voice?: VoiceSettings;
        }>("/api/accounts")
        .then((value) => {
          setPeople(value.accounts);
          setRequests(value.requests ?? []);
          setEmailSignIn(value.emailSignIn);
          setVoice(value.voice);
        }),
    [api],
  );
  useEffect(() => {
    void api
      .request<Person>("/api/me")
      .then((me) => (me.role === "admin" ? load() : undefined))
      .catch(() => undefined);
  }, [api, load]);
  if (!people) return null;
  const domain = people.find((p) => p.role === "admin")?.agentEmail?.split("@")[1];
  async function run(
    id: string,
    work: () => Promise<unknown>,
    done: string | ((result: unknown) => string),
  ) {
    setBusy(id);
    setError("");
    try {
      const result = await work();
      await load();
      notify(typeof done === "function" ? done(result) : done);
      return true;
    } catch (e) {
      // Shown where the person is looking as well as under the card, which may be far below.
      setError(message(e));
      notify(message(e));
      return false;
    } finally {
      setBusy("");
    }
  }
  async function invite() {
    const sent = await run(
      "invite",
      () =>
        api.request("/api/accounts", {
          name: name.trim(),
          email: email.trim(),
          ...(handle.trim() ? { handle: handle.trim().toLowerCase() } : {}),
        }),
      `Invite sent to ${email.trim()}.`,
    );
    if (sent) {
      setName("");
      setEmail("");
      setHandle("");
      setInviting(false);
    }
  }
  // Newest first, and people who haven't signed in yet before those who have: the ones to look at.
  const members = people
    .filter((p) => p.role === "member")
    .sort(
      (a, b) =>
        Number(!!a.lastSignInAt) - Number(!!b.lastSignInAt) ||
        (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
    );
  const needle = query.trim().toLowerCase();
  const found = needle
    ? members.filter((p) =>
        `${p.name} ${p.email ?? ""} ${p.handle ?? ""} ${p.plan?.name ?? ""}`
          .toLowerCase()
          .includes(needle),
      )
    : members;
  const visible = found.slice(0, shown);
  const shownRequests = allRequests ? requests : requests.slice(0, REQUESTS_FIRST);
  async function compareVoices(days: number) {
    setComparing(days);
    setCompareError("");
    try {
      const report = await api.request<{ openai: VoiceSide; pipecat: VoiceSide }>(
        `/api/voice/compare?days=${days}`,
      );
      setCompare({ days, ...report });
    } catch (e) {
      setCompareError(message(e));
    } finally {
      setComparing(0);
    }
  }
  /** The voice a setting means ("default" follows everyone's). */
  const effective = (setting?: string): VoiceChoice =>
    setting === "openai" || setting === "pipecat" ? setting : (voice?.default ?? "openai");
  const voiceName = (choice: VoiceChoice) =>
    choice === "pipecat" ? "the new voice" : "OpenAI’s voice";
  /** Moves one person (or "me") to the other voice; back to the default saves it as "default". */
  const voiceButton = (id: string, setting: string | undefined, who: string) => {
    const next: VoiceChoice = effective(setting) === "pipecat" ? "openai" : "pipecat";
    return (
      <Button
        small
        busy={busy === `${id}:voice`}
        accessibilityLabel={
          who === "you"
            ? next === "pipecat"
              ? "Try the new voice myself"
              : "Use OpenAI’s voice myself"
            : next === "pipecat"
              ? `Try the new voice for ${who}`
              : `Back to OpenAI’s voice for ${who}`
        }
        onPress={() =>
          void run(
            `${id}:voice`,
            () =>
              api.request(`/api/accounts/${id}/voice`, {
                provider: next === voice?.default ? "default" : next,
              }),
            `${who === "you" ? "You" : who} now ${who === "you" ? "talk" : "talks"} live with ${voiceName(next)}.`,
          )
        }
      >
        {who === "you"
          ? next === "pipecat"
            ? "Try the new voice myself"
            : "Use OpenAI’s voice myself"
          : next === "pipecat"
            ? "Try the new voice"
            : "Back to OpenAI’s voice"}
      </Button>
    );
  };
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="People" />
      <Text style={s.muted}>
        Invite someone and they get their own private workspace: their own chats, apps, routines and
        memory{domain ? `, plus their own agent address @${domain}` : ""}. They sign in with a link
        sent to their email, no password or key. New people start on the Free plan; change it by
        opening their row. Nothing is charged yet.
      </Text>
      <Text role="status" style={[s.text, { fontWeight: "600" }]}>
        {`${members.length} ${members.length === 1 ? "person" : "people"} invited`}
        {requests.length > 0
          ? ` · ${requests.length} waiting for your answer`
          : " · nobody is waiting for your answer"}
      </Text>
      {requests.length > 0 && (
        <View style={{ gap: 16 }}>
          <View style={{ gap: 4 }}>
            <Text role="heading" aria-level={3} style={subheading}>
              {`Asked to join (${requests.length})`}
            </Text>
            <Text style={s.small}>
              Approving sends the usual invite. Declining doesn’t email them.
            </Text>
          </View>
          {shownRequests.map((request) => (
            <View key={request.id} style={{ gap: 6 }}>
              <Text style={s.text}>
                {request.name} · {request.email}
              </Text>
              {!!request.note && (
                <Text style={[s.small, { fontStyle: "italic" }]}>“{request.note}”</Text>
              )}
              <Text style={s.small}>Asked {new Date(request.createdAt).toLocaleDateString()}</Text>
              <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                {declining === request.id ? (
                  <>
                    <Button
                      danger
                      busy={busy === `${request.id}:decline`}
                      accessibilityLabel={`Yes, decline ${request.name}`}
                      onPress={() =>
                        void run(
                          `${request.id}:decline`,
                          () => api.request(`/api/accounts/requests/${request.id}/decline`, {}),
                          `Declined. ${request.name} wasn’t emailed.`,
                        ).then(() => setDeclining(""))
                      }
                    >
                      Yes, decline
                    </Button>
                    <Button onPress={() => setDeclining("")}>Keep</Button>
                  </>
                ) : (
                  <>
                    <Button
                      primary
                      busy={busy === `${request.id}:approve`}
                      accessibilityLabel={`Approve and invite ${request.name}`}
                      onPress={() =>
                        void run(
                          `${request.id}:approve`,
                          () => api.request(`/api/accounts/requests/${request.id}/approve`, {}),
                          `Invite sent to ${request.email}.`,
                        )
                      }
                    >
                      Approve and invite
                    </Button>
                    <Button
                      accessibilityLabel={`Decline ${request.name}`}
                      onPress={() => setDeclining(request.id)}
                    >
                      Decline
                    </Button>
                  </>
                )}
              </View>
            </View>
          ))}
          {requests.length > REQUESTS_FIRST && (
            <Button onPress={() => setAllRequests(!allRequests)}>
              {allRequests ? "Show fewer requests" : `Show all ${requests.length} requests`}
            </Button>
          )}
        </View>
      )}
      {voice && (
        <Pressable
          role="button"
          aria-expanded={voiceOpen}
          onPress={() => setVoiceOpen(!voiceOpen)}
          style={({ pressed }) => [
            s.row,
            { minHeight: 44, justifyContent: "space-between", opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text role="heading" aria-level={3} style={subheading}>
            Live talk voice
          </Text>
          {voiceOpen ? (
            <ChevronUp size={20} color={colors.mutedStrong} />
          ) : (
            <ChevronDown size={20} color={colors.mutedStrong} />
          )}
        </Pressable>
      )}
      {voice && voiceOpen && (
        <View style={{ gap: 6 }}>
          <Text style={s.small}>
            {`${
              // Once everyone's on it, the line below says so.
              voice.default === "pipecat"
                ? ""
                : "Try the new, cheaper voice on yourself or a few people before switching everyone. "
            }Calls look the same with either. On the new voice ${
              voice.limitMinutes
                ? `people on early access get ${voice.limitMinutes} minutes a month, and everyone else their plan’s`
                : "there’s no monthly limit"
            }, and a quiet call hangs up after ${voice.idleSeconds} seconds.`}
          </Text>
          <Text style={s.text}>
            {effective(voice.mine) === voice.default
              ? `You and everyone else talk live with ${voiceName(voice.default)}, unless you change someone below.`
              : `You talk live with ${voiceName(effective(voice.mine))}. Everyone else uses ${voiceName(voice.default)} unless you change them below.`}
          </Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            {voiceButton("me", voice.mine, "you")}
            {!compare && (
              <Button small busy={comparing > 0} onPress={() => void compareVoices(30)}>
                Compare the voices
              </Button>
            )}
          </View>
          {compare && (
            <View style={{ gap: 8, marginTop: 6, maxWidth: 440 }}>
              <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                {[7, 30].map((days) => (
                  <Button
                    key={days}
                    small
                    primary={compare.days === days}
                    selected={compare.days === days}
                    busy={comparing === days}
                    accessibilityLabel={`Compare the voices over the last ${days} days`}
                    onPress={() => void compareVoices(days)}
                  >
                    {`Last ${days} days`}
                  </Button>
                ))}
              </View>
              <Text style={s.small}>{`Everyone’s calls, last ${compare.days} days`}</Text>
              <VoiceCompare openai={compare.openai} pipecat={compare.pipecat} />
            </View>
          )}
          <ErrorNotice error={compareError} />
        </View>
      )}
      {members.length > 0 && (
        <Text role="heading" aria-level={3} style={subheading}>
          {`Invited (${members.length})`}
        </Text>
      )}
      {members.length > 6 && (
        <Field
          label="Search people"
          hideLabel
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            setShown(PAGE);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Search by name, email or plan"
        />
      )}
      {needle && found.length === 0 && (
        <Text role="status" style={s.muted}>
          {`Nobody matches “${query.trim()}”. Clear the search to see everyone.`}
        </Text>
      )}
      {visible.map((person) => {
        const open = openId === person.id;
        const state =
          person.status === "disabled"
            ? "Can’t sign in"
            : person.lastSignInAt
              ? `Last signed in ${new Date(person.lastSignInAt).toLocaleDateString()}`
              : "Hasn’t signed in yet";
        return (
          <View key={person.id} style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
            <Pressable
              role="button"
              aria-expanded={open}
              aria-label={`${person.name}, ${person.plan && person.status !== "disabled" ? `${person.plan.name} plan, ` : ""}${state}. ${open ? "Hide" : "Show"} details`}
              onPress={() => setOpenId(open ? "" : person.id)}
              style={({ pressed }) => [
                s.row,
                { minHeight: 56, paddingVertical: 8, gap: 10, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.text} numberOfLines={1}>
                  {person.name}
                </Text>
                <Text style={s.small} numberOfLines={1}>
                  {person.email}
                </Text>
                <Text style={s.small} numberOfLines={1}>
                  {state}
                </Text>
              </View>
              {person.status === "disabled" ? (
                <View style={{ alignSelf: "center" }}>
                  <Chip tint={colors.errorBg}>Removed</Chip>
                </View>
              ) : (
                person.plan && (
                  <View style={{ alignSelf: "center" }}>
                    <Chip tint={colors.subtle}>{person.plan.name}</Chip>
                  </View>
                )
              )}
              {open ? (
                <ChevronUp size={20} color={colors.mutedStrong} />
              ) : (
                <ChevronDown size={20} color={colors.mutedStrong} />
              )}
            </Pressable>
            {open && (
              <View style={{ gap: 8, paddingBottom: 14 }}>
                <Text style={s.small}>
                  {[
                    person.agentEmail,
                    voice
                      ? effective(person.voice) === "pipecat"
                        ? `Live talk: new voice${person.voiceMinutes ? ` (${person.voiceMinutes} minutes this month)` : ""}`
                        : "Live talk: OpenAI"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {voice && person.status !== "disabled" && (
                  <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                    {voiceButton(person.id, person.voice, person.name)}
                  </View>
                )}
                {person.plan && person.status !== "disabled" && (
                  <View style={{ gap: 6, marginBottom: 10 }}>
                    <Text style={s.small}>
                      {[
                        `Plan: ${person.plan.name}`,
                        person.plan.limit.messages !== null
                          ? `${person.plan.messages.toLocaleString()} of ${person.plan.limit.messages.toLocaleString()} ${person.plan.limit.messages === 1 ? "message" : "messages"}`
                          : "",
                        person.plan.limit.jobs !== null
                          ? `${person.plan.jobs} of ${person.plan.limit.jobs} ${person.plan.limit.jobs === 1 ? "job" : "jobs"}`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    <View
                      role="group"
                      aria-label={`Plan for ${person.name}`}
                      style={[s.row, { gap: 8, flexWrap: "wrap" }]}
                    >
                      {[...PLAN_ORDER, "early" as const].map((id) => (
                        <Button
                          key={id}
                          small
                          primary={person.plan?.plan === id}
                          selected={person.plan?.plan === id}
                          icon={person.plan?.plan === id ? Check : undefined}
                          busy={busy === `${person.id}:plan:${id}`}
                          accessibilityLabel={`Put ${person.name} on ${PLANS[id].name}`}
                          onPress={() =>
                            void run(
                              `${person.id}:plan:${id}`,
                              () => api.request(`/api/accounts/${person.id}/plan`, { plan: id }),
                              `${person.name} is on ${PLANS[id].name}.`,
                            )
                          }
                        >
                          {PLANS[id].name}
                        </Button>
                      ))}
                    </View>
                    <Text style={[s.small, { marginTop: 4 }]}>Add for this month</Text>
                    <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                      {(["callMinutes", "messages", "meetingHours", "jobs"] as const).map(
                        (kind) => (
                          <Button
                            key={kind}
                            small
                            busy={busy === `${person.id}:extra:${kind}`}
                            accessibilityLabel={`${EXTRA_BUTTON[kind]} for ${person.name} this month`}
                            onPress={() =>
                              void run(
                                `${person.id}:extra:${kind}`,
                                () =>
                                  api.request(`/api/accounts/${person.id}/extras`, {
                                    kind,
                                    packs: 1,
                                  }),
                                (result) => {
                                  const total = (
                                    result as { limit?: Partial<Record<Counted, number | null>> }
                                  ).limit?.[kind];
                                  return `Added ${EXTRA_SHORT[kind]} for ${person.name} this month${typeof total === "number" ? `: ${person.name} now has ${total}` : ""}.`;
                                },
                              )
                            }
                          >
                            {EXTRA_BUTTON[kind]}
                          </Button>
                        ),
                      )}
                    </View>
                  </View>
                )}
                <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                  {person.status === "disabled" ? (
                    <Button
                      small
                      busy={busy === person.id}
                      onPress={() =>
                        void run(
                          person.id,
                          () => api.request(`/api/accounts/${person.id}/enable`, {}),
                          `${person.name} can sign in again.`,
                        )
                      }
                    >
                      Restore access
                    </Button>
                  ) : (
                    <>
                      {emailSignIn && (
                        <Button
                          small
                          busy={busy === `${person.id}:invite`}
                          onPress={() =>
                            void run(
                              `${person.id}:invite`,
                              () => api.request(`/api/accounts/${person.id}/invite`, {}),
                              `New sign-in link sent to ${person.email}.`,
                            )
                          }
                        >
                          Send new invite
                        </Button>
                      )}
                      {removing === person.id ? (
                        <>
                          <Button
                            small
                            danger
                            busy={busy === person.id}
                            accessibilityLabel={`Yes, remove ${person.name}’s access`}
                            onPress={() =>
                              void run(
                                person.id,
                                () => api.request(`/api/accounts/${person.id}/disable`, {}),
                                `${person.name} is signed out and can’t sign in. Their data is kept.`,
                              ).then(() => setRemoving(""))
                            }
                          >
                            Yes, remove access
                          </Button>
                          <Button small onPress={() => setRemoving("")}>
                            Keep
                          </Button>
                        </>
                      ) : (
                        <Button small danger onPress={() => setRemoving(person.id)}>
                          Remove access
                        </Button>
                      )}
                    </>
                  )}
                </View>
              </View>
            )}
          </View>
        );
      })}
      {found.length > visible.length && (
        <Button onPress={() => setShown(shown + PAGE)}>
          {found.length - visible.length > PAGE
            ? `Show ${PAGE} more (${found.length - visible.length} not shown)`
            : `Show ${found.length - visible.length} more`}
        </Button>
      )}
      {emailSignIn && !inviting && (
        <Button primary onPress={() => setInviting(true)}>
          Invite someone
        </Button>
      )}
      {emailSignIn && inviting ? (
        <>
          <Text role="heading" aria-level={3} style={subheading}>
            Invite someone
          </Text>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Sarah Jones" />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="sarah@example.com"
          />
          {domain && (
            <Field
              label={`Agent address (optional) · name@${domain}`}
              value={handle}
              onChangeText={setHandle}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Uses their first name when left blank"
            />
          )}
          <Button
            primary
            busy={busy === "invite"}
            disabled={!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
            onPress={() => void invite()}
          >
            Send invite
          </Button>
          <Button small onPress={() => setInviting(false)}>
            Cancel
          </Button>
        </>
      ) : (
        !emailSignIn && (
          <Text style={s.small}>
            Inviting people needs email sign-in. Set ADMIN_EMAIL and RESEND_API_KEY on the server.
          </Text>
        )
      )}
      <ErrorNotice error={error} />
    </Card>
  );
}

/** The two live-talk voices side by side: calls, minutes, how long a reply takes, cost. */
function VoiceCompare({ openai, pipecat }: { openai: VoiceSide; pipecat: VoiceSide }) {
  const seconds = (ms?: number) => (ms === undefined ? "–" : `${(ms / 1000).toFixed(1)} s`);
  const dollars = (value?: number) => (value === undefined ? "–" : `$${value.toFixed(3)}`);
  const rows: [string, (side: VoiceSide) => string][] = [
    ["Calls", (side) => String(side.calls)],
    ["Minutes", (side) => String(side.minutes)],
    ["Usual wait for a reply", (side) => seconds(side.latencyMs.median)],
    ["Slowest wait (1 in 10)", (side) => seconds(side.latencyMs.p90)],
    ["Cost per minute", (side) => dollars(side.costPerMinute.total)],
  ];
  const cell = { flex: 1, textAlign: "right" as const, fontVariant: ["tabular-nums" as const] };
  return (
    <View role="table" style={{ gap: 4, marginTop: 4 }}>
      <View role="row" style={[s.row, { gap: 8 }]}>
        <Text role="columnheader" style={[s.small, { flex: 2 }]} />
        <Text role="columnheader" style={[s.small, cell, { fontWeight: "600" }]}>
          OpenAI
        </Text>
        <Text role="columnheader" style={[s.small, cell, { fontWeight: "600" }]}>
          New voice
        </Text>
      </View>
      {rows.map(([label, value]) => (
        <View key={label} role="row" style={[s.row, { gap: 8, alignItems: "baseline" }]}>
          <Text role="rowheader" style={[s.muted, { flex: 2 }]}>
            {label}
          </Text>
          <Text role="cell" style={[s.text, cell]}>
            {value(openai)}
          </Text>
          <Text role="cell" style={[s.text, cell]}>
            {value(pipecat)}
          </Text>
        </View>
      ))}
      {openai.calls + pipecat.calls === 0 && (
        <Text style={s.small}>
          No calls in these days yet. Make a call on each voice, then check again.
        </Text>
      )}
    </View>
  );
}
