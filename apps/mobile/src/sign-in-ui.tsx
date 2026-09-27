import { KeyRound, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { Button, Card, CheckRow, colors, ErrorNotice, Field, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

interface SavedLogin {
  id: string;
  site: string;
  username: string;
  hasAuthenticator: boolean;
  askFirst: boolean;
  lastUsedAt?: string;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const AUTHENTICATOR_HELP =
  "Lets your agent enter the site’s sign-in codes too. On the website, turn on two-step sign-in with an authenticator app, and choose to enter a key instead of scanning. Paste that key here. Add it to your phone’s authenticator app as well, so you can finish setup and sign in yourself.";

/**
 * Website passwords the agent can sign in with. Typed here, never in chat; the agent sees only the
 * site and username, and the server types the password in only on that site.
 */
export function PasswordsCard() {
  const { api, notify } = useWorkspace();
  const [state, setState] = useState<{ available: boolean; logins: SavedLogin[] }>();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string>();
  const load = useCallback(
    () =>
      api
        .request<{ available: boolean; logins: SavedLogin[] }>("/api/logins")
        .then(setState, () => undefined),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!state?.available) return null;
  const done = (text?: string) => {
    setAdding(false);
    setOpen(undefined);
    if (text) notify(text);
    void load();
  };
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="Passwords" />
      <Text style={s.muted}>
        Save a website’s password so your agent can sign in for you. Your agent never sees it: it’s
        typed in only on that website. Never share a password in chat.
      </Text>
      {state.logins.map((login) =>
        open === login.id ? (
          <EditLogin key={login.id} login={login} onDone={done} />
        ) : (
          <View
            key={login.id}
            style={[
              s.row,
              { gap: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
            ]}
          >
            <KeyRound size={20} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={[s.text, { fontWeight: "600" }]}>{login.site}</Text>
              <Text numberOfLines={1} ellipsizeMode="middle" style={s.small}>
                {login.username}
              </Text>
              <Text style={s.small}>
                {login.askFirst ? "Asks you first" : "Signs in without asking"}
                {login.hasAuthenticator ? " · enters sign-in codes" : ""}
              </Text>
            </View>
            <Button
              small
              accessibilityLabel={`Edit ${login.site} password`}
              onPress={() => setOpen(login.id)}
            >
              Edit
            </Button>
          </View>
        ),
      )}
      {!state.logins.length && !adding && <Text style={s.small}>No passwords saved yet.</Text>}
      {adding ? (
        <AddLogin onDone={done} />
      ) : (
        <Button small onPress={() => setAdding(true)}>
          Add a password
        </Button>
      )}
    </Card>
  );
}

function AddLogin({ onDone }: { onDone: (message?: string) => void }) {
  const { api } = useWorkspace();
  const [site, setSite] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authenticator, setAuthenticator] = useState("");
  const [askFirst, setAskFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await api.request<SavedLogin & { replaced?: boolean }>("/api/logins", {
        site: site.trim(),
        username: username.trim(),
        password,
        askFirst,
        ...(authenticator.trim() ? { authenticator: authenticator.trim() } : {}),
      });
      setPassword("");
      setAuthenticator("");
      onDone(
        saved.replaced
          ? `Updated your ${saved.site} password.`
          : `Saved your ${saved.site} password.`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
      <Field
        label="Website"
        autoFocus
        value={site}
        onChangeText={setSite}
        placeholder="amazon.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Field
        label="Username or email"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="password"
      />
      <Field
        label="Authenticator key (optional)"
        value={authenticator}
        onChangeText={setAuthenticator}
        autoCapitalize="characters"
        autoCorrect={false}
        secureTextEntry
      />
      <Text style={[s.small, { marginTop: -8 }]}>{AUTHENTICATOR_HELP}</Text>
      <CheckRow
        label="Ask me before each sign-in"
        checked={askFirst}
        onPress={() => setAskFirst(!askFirst)}
      />
      <View style={[s.row, { gap: 8 }]}>
        <Button
          small
          primary
          busy={busy}
          disabled={!site.trim() || !username.trim() || !password}
          onPress={() => void save()}
        >
          Save password
        </Button>
        <Button small disabled={busy} onPress={() => onDone()}>
          Cancel
        </Button>
      </View>
      <ErrorNotice error={error} />
    </View>
  );
}

function EditLogin({ login, onDone }: { login: SavedLogin; onDone: (message?: string) => void }) {
  const { api } = useWorkspace();
  const [password, setPassword] = useState("");
  const [authenticator, setAuthenticator] = useState("");
  const [askFirst, setAskFirst] = useState(login.askFirst);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // Deleting a password or its authenticator key can't be undone, so each asks once more.
  const [confirming, setConfirming] = useState<"delete" | "codes">();
  async function run(id: string, work: () => Promise<string>) {
    setBusy(id);
    setError("");
    try {
      onDone(await work());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <View style={{ gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
      <Text style={[s.text, { fontWeight: "600" }]}>
        {login.site} · {login.username}
      </Text>
      <Field
        label="New password (leave empty to keep it)"
        autoFocus
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
      />
      <Field
        label={
          login.hasAuthenticator
            ? "New authenticator key (leave empty to keep it)"
            : "Authenticator key (optional)"
        }
        value={authenticator}
        onChangeText={setAuthenticator}
        autoCapitalize="characters"
        autoCorrect={false}
        secureTextEntry
      />
      {!login.hasAuthenticator && (
        <Text style={[s.small, { marginTop: -8 }]}>{AUTHENTICATOR_HELP}</Text>
      )}
      <CheckRow
        label="Ask me before each sign-in"
        checked={askFirst}
        onPress={() => setAskFirst(!askFirst)}
      />
      {confirming ? (
        <View style={{ gap: 10 }}>
          <Text role="alert" style={s.text}>
            {confirming === "delete"
              ? `Delete your ${login.site} password? This can’t be undone.`
              : `Remove the authenticator key for ${login.site}? You’ll type its codes yourself when asked. To add it back, you’ll need to set up two-step sign-in on the website again.`}
          </Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button small disabled={!!busy} onPress={() => setConfirming(undefined)}>
              Cancel
            </Button>
            <Button
              small
              danger
              icon={Trash2}
              busy={!!busy}
              onPress={() =>
                confirming === "delete"
                  ? void run("delete", async () => {
                      await api.request(`/api/logins/${login.id}/delete`, {});
                      return `Deleted your ${login.site} password.`;
                    })
                  : void run("codes", async () => {
                      await api.request(`/api/logins/${login.id}`, { authenticator: "" });
                      return `Removed the authenticator key for ${login.site}. You’ll type its codes in the app when asked.`;
                    })
              }
            >
              {confirming === "delete" ? "Delete password" : "Remove key"}
            </Button>
          </View>
        </View>
      ) : (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button
            small
            primary
            busy={busy === "save"}
            disabled={!!busy}
            onPress={() =>
              void run("save", async () => {
                await api.request(`/api/logins/${login.id}`, {
                  askFirst,
                  ...(password ? { password } : {}),
                  ...(authenticator.trim() ? { authenticator: authenticator.trim() } : {}),
                });
                return `Saved changes for ${login.site}.`;
              })
            }
          >
            Save
          </Button>
          {login.hasAuthenticator && (
            <Button
              small
              busy={busy === "codes"}
              disabled={!!busy}
              onPress={() => setConfirming("codes")}
            >
              Remove authenticator key
            </Button>
          )}
          <Button small disabled={!!busy} onPress={() => onDone()}>
            Close
          </Button>
          <Button
            small
            danger
            busy={busy === "delete"}
            disabled={!!busy}
            onPress={() => setConfirming("delete")}
          >
            Delete password
          </Button>
        </View>
      )}
      <ErrorNotice error={error} />
    </View>
  );
}

/** What a sign-in approval will do, and the box for a code the site sent. */
export function SignInReview({
  data,
  previewUrl,
  code,
  onCode,
  onSubmit,
}: {
  data: Record<string, unknown>;
  previewUrl?: string;
  code: string;
  /** Only while the approval is open: a finished one shows no code box. */
  onCode?: (code: string) => void;
  /** Enter in the code box approves, once the code looks right. */
  onSubmit?: () => void;
}) {
  const site = String(data.site || "the site");
  const typed = data.step === "code" && !data.savedCode && !!onCode;
  return (
    <View style={{ gap: 13 }}>
      <Line label="Website" value={site} />
      <Line label="Page" value={String(data.pageTitle || data.url || "")} />
      {data.step === "password" ? (
        <Line
          label="Your agent will"
          value={`Sign in as ${String(data.username || "you")} with your saved password`}
        />
      ) : (
        <Line
          label="Your agent will"
          value={
            data.savedCode
              ? "Enter a code from your saved authenticator key"
              : data.element
                ? `Enter the code you type below in the box labeled “${String(data.element)}”`
                : "Enter the code you type below on the page"
          }
        />
      )}
      {typed && (
        <Field
          label={`Code from ${site}`}
          autoFocus
          value={code}
          onChangeText={onCode}
          onSubmitEditing={() => codeReady(code) && onSubmit?.()}
          returnKeyType="done"
          placeholder="123456"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          inputMode={/digit|number|numeric/i.test(String(data.element ?? "")) ? "numeric" : "text"}
          maxLength={14}
          style={{ maxWidth: 240, fontSize: 20, letterSpacing: 2, fontVariant: ["tabular-nums"] }}
        />
      )}
      {typed && (/[^A-Za-z0-9\s-]/.test(code) || code.replace(/[\s-]/g, "").length > 10) && (
        <Text style={[s.small, { marginTop: -10 }]}>
          Codes are 4 to 10 letters or numbers. Type just the code.
        </Text>
      )}
      {!!previewUrl && (
        <Image
          source={{ uri: previewUrl }}
          resizeMode="contain"
          accessibilityLabel={`The page on ${site} right now`}
          style={{ width: "100%", height: 220, borderRadius: 10, backgroundColor: colors.subtle }}
        />
      )}
      <Text style={s.small}>
        {data.step === "password"
          ? `Your agent never sees your password. It’s typed in only if the page is still on ${site}.`
          : `The code is entered only if the page is still on ${site}. Your agent doesn’t see it, and it isn’t saved.`}
      </Text>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <Text selectable style={s.text}>
        {value}
      </Text>
    </View>
  );
}

/** Codes people type: 4 to 10 letters or digits once spaces and dashes are dropped. */
export const codeReady = (code: string) => /^[A-Za-z0-9]{4,10}$/.test(code.replace(/[\s-]/g, ""));
