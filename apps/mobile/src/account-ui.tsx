import { useCallback, useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { Button, Card, ErrorNotice, Field, SectionHeading, s } from "./ui";
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
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Who is signed in on this device, their agent's address, and signing out. */
export function AccountCard() {
  const { api } = useWorkspace();
  const [me, setMe] = useState<Person>();
  const [busy, setBusy] = useState(false);
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
  const [emailSignIn, setEmailSignIn] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api.request<{ emailSignIn: boolean; accounts: Person[] }>("/api/accounts").then((value) => {
        setPeople(value.accounts);
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
      {members.map((person) => (
        <View key={person.id} style={{ gap: 6 }}>
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
