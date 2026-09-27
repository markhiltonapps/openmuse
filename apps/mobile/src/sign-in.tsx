import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";
import { API_URL, requestSignInLink } from "./api";
import { pastedLoginToken } from "./session-store";
import { Button, Card, ErrorNotice, Field, s } from "./ui";

/** Email sign-in links when the server can send them; the access key otherwise, or on request. */
export function SignInCard({
  emailSignIn,
  error,
  onKey,
  onLogin,
}: {
  emailSignIn: boolean;
  error: string;
  onKey: (key: string) => void;
  onLogin: (token: string) => void;
}) {
  const [method, setMethod] = useState<"email" | "key">(emailSignIn ? "email" : "key");
  const [email, setEmail] = useState("");
  const [key, setKey] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => setMethod(emailSignIn ? "email" : "key"), [emailSignIn]);
  const address = email.trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
  const pastedToken = pastedLoginToken(pasted);
  async function send() {
    if (!validEmail) return;
    setBusy(true);
    setProblem("");
    try {
      await requestSignInLink(address);
      setSentTo(address);
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
            If {sentTo} has a Neato_Meca account, a sign-in link is on its way. Open it on this
            device. It works once and expires in 15 minutes.
          </Text>
          <Field
            label="Or paste the link here"
            value={pasted}
            onChangeText={setPasted}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://…#login=…"
          />
          <Text style={s.small}>
            Using Neato_Meca from your iPhone Home Screen? Links open in Safari, so press and hold
            the link in the email, tap Copy, and paste it here.
          </Text>
          <Button
            primary
            disabled={!pastedToken}
            onPress={() => pastedToken && onLogin(pastedToken)}
          >
            Sign in
          </Button>
          <Button
            onPress={() => {
              setSentTo("");
              setPasted("");
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
            Email me a sign-in link
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
          Local workspaces open without a key. Make sure your Neato_Meca server is running at{" "}
          {API_URL}.
        </Text>
      )}
    </Card>
  );
}
