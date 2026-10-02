import { useCallback, useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { Button, Card, colors, ErrorNotice, Field, SectionHeading, s } from "./ui";
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
  agentEmail?: string;
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
          Your agent's email address is <Text selectable>{me.agentEmail}</Text>.
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
  const load = useCallback(
    () =>
      api
        .request<{ emailSignIn: boolean; accounts: Person[]; requests?: AccessRequest[] }>(
          "/api/accounts",
        )
        .then((value) => {
          setPeople(value.accounts);
          setRequests(value.requests ?? []);
          setEmailSignIn(value.emailSignIn);
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
  async function run(id: string, work: () => Promise<unknown>, done: string) {
    setBusy(id);
    setError("");
    try {
      await work();
      await load();
      notify(done);
      return true;
    } catch (e) {
      setError(message(e));
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
    }
  }
  const members = people.filter((p) => p.role === "member");
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="People" />
      <Text style={s.muted}>
        Invite someone and they get their own private workspace: their own chats, apps, routines and
        memory{domain ? `, plus their own agent address @${domain}` : ""}. They sign in with a link
        sent to their email, no password or key.
      </Text>
      {requests.length > 0 && (
        <View style={{ gap: 16 }}>
          <View style={{ gap: 4 }}>
            <Text role="heading" aria-level={3} style={subheading}>
              Asked to join
            </Text>
            <Text style={s.small}>
              Approving sends the usual invite. Declining doesn't email them.
            </Text>
          </View>
          {requests.map((request) => (
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
                      small
                      danger
                      busy={busy === `${request.id}:decline`}
                      accessibilityLabel={`Yes, decline ${request.name}`}
                      onPress={() =>
                        void run(
                          `${request.id}:decline`,
                          () => api.request(`/api/accounts/requests/${request.id}/decline`, {}),
                          `Declined. ${request.name} wasn't emailed.`,
                        ).then(() => setDeclining(""))
                      }
                    >
                      Yes, decline
                    </Button>
                    <Button small onPress={() => setDeclining("")}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      small
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
                      small
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
        </View>
      )}
      {requests.length > 0 && members.length > 0 && (
        <Text role="heading" aria-level={3} style={subheading}>
          Invited
        </Text>
      )}
      {members.map((person) => (
        <View key={person.id} style={{ gap: 6, marginBottom: 4 }}>
          <Text style={s.text}>
            {person.name} · {person.email}
          </Text>
          <Text style={s.small}>
            {[
              person.agentEmail,
              person.status === "disabled"
                ? "Access removed"
                : person.lastSignInAt
                  ? `Last signed in ${new Date(person.lastSignInAt).toLocaleDateString()}`
                  : "Hasn't signed in yet",
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
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
                <Button
                  small
                  danger
                  busy={busy === person.id}
                  onPress={() =>
                    void run(
                      person.id,
                      () => api.request(`/api/accounts/${person.id}/disable`, {}),
                      `${person.name} is signed out and can't sign in. Their data is kept.`,
                    )
                  }
                >
                  Remove access
                </Button>
              </>
            )}
          </View>
        </View>
      ))}
      {emailSignIn ? (
        <>
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
        </>
      ) : (
        <Text style={s.small}>
          Inviting people needs email sign-in. Set ADMIN_EMAIL and RESEND_API_KEY on the server.
        </Text>
      )}
      <ErrorNotice error={error} />
    </Card>
  );
}
