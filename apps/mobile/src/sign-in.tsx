import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";
import { API_URL, requestSignInLink } from "./api";
import { hasHelp, openHelp } from "./help-ui";
import { pastedLoginToken } from "./session-store";
import { Button, Card, ErrorNotice, Field, s } from "./ui";

/** Email sign-in links when the server can send them; the access key otherwise, or on request. */
export function SignInCard({
  emailSignIn,
  error,
  onKey,
  onLogin,
  onCode,
}: {
  emailSignIn: boolean;
  error: string;
  onKey: (key: string) => void;
  onLogin: (token: string) => void;
  onCode: (email: string, code: string) => void;
}) {
  const [method, setMethod] = useState<"email" | "key">(emailSignIn ? "email" : "key");
  const [email, setEmail] = useState("");
  const [key, setKey] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => setMethod(emailSignIn ? "email" : "key"), [emailSignIn]);
  const address = email.trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
  // A pasted sign-in link still works in the code box, for anyone used to that.
  const pastedToken = pastedLoginToken(code);
  const digits = code.replace(/\D/g, "");
  const ready = !!pastedToken || digits.length === 6;
  function submit(value = code) {
    const token = pastedLoginToken(value);
    if (token) return onLogin(token);
    const typed = value.replace(/\D/g, "");
    if (typed.length === 6) onCode(sentTo, typed);
  }
  async function send() {
    if (!validEmail) return;
    setBusy(true);
    setProblem("");
    try {
      await requestSignInLink(address);
      setResent(!!sentTo);
      setSentTo(address);
      setCode("");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ width: "100%", gap: 12 }}>
      <ErrorNotice error={problem || error} />
      {method === "key" ? (
        <>
          <Field
            label="Workspace access key"
            value={key}
            onChangeText={setKey}
            secureTextEntry
            placeholder="Required for a live workspace"
            onSubmitEditing={() => onKey(key)}
          />
          <Button primary onPress={() => onKey(key)}>
            Open workspace
          </Button>
        </>
      ) : sentTo ? (
        <>
          <Text style={s.heading}>Check your email</Text>
          <Text style={s.muted}>
            If {sentTo} has a Neato_Muse account, a 6-digit sign-in code is on its way. It works
            once and expires in 15 minutes.
          </Text>
          <Field
            label="Sign-in code"
            value={code}
            onChangeText={(value) => {
              setCode(value);
              // Signs in as soon as the sixth digit is in, or a whole link is pasted.
              if (
                pastedLoginToken(value) ||
                (value.replace(/\D/g, "").length === 6 && !/[^\d\s-]/.test(value))
              )
                submit(value);
            }}
            onSubmitEditing={() => submit()}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            inputMode="numeric"
            returnKeyType="go"
            placeholder="123 456"
            style={{ maxWidth: 240, fontSize: 22, letterSpacing: 4, fontVariant: ["tabular-nums"] }}
          />
          <Button primary disabled={!ready} onPress={() => submit()}>
            Sign in
          </Button>
          <Text style={s.small}>
            {resent
              ? "A new code is on its way. Use the newest one."
              : "You can also tap the link in the email on this device."}
          </Text>
          <Button
            busy={busy}
            onPress={() => {
              void send();
            }}
          >
            Send a new code
          </Button>
          <Button
            onPress={() => {
              setSentTo("");
              setCode("");
              setResent(false);
            }}
          >
            Use a different email
          </Button>
        </>
      ) : (
        <>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.com"
            onSubmitEditing={() => void send()}
          />
          <Button primary busy={busy} disabled={!validEmail} onPress={() => void send()}>
            Email me a sign-in code
          </Button>
        </>
      )}
      {emailSignIn ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setMethod(method === "email" ? "key" : "email")}
        >
          <Text style={[s.small, { textAlign: "center", textDecorationLine: "underline" }]}>
            {method === "email" ? "Use the access key instead" : "Sign in with email instead"}
          </Text>
        </Pressable>
      ) : (
        <Text style={s.small}>
          Local workspaces open without a key. Make sure your Neato_Muse server is running at{" "}
          {API_URL}.
        </Text>
      )}
      {hasHelp && (
        <Pressable accessibilityRole="link" onPress={() => openHelp("start")}>
          <Text style={[s.small, { textAlign: "center", textDecorationLine: "underline" }]}>
            New here? See how Neato_Muse works
          </Text>
        </Pressable>
      )}
    </Card>
  );
}
