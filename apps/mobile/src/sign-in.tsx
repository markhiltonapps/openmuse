import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";
import { API_URL, requestAccess, requestSignInLink } from "./api";
import { SignedOutHelp } from "./help-ui";
import { pastedLoginToken } from "./session-store";
import { Button, Card, ErrorNotice, Field, s } from "./ui";
import { helpLink } from "./web-app";

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
  const [method, setMethod] = useState<"email" | "key" | "request">(emailSignIn ? "email" : "key");
  const [email, setEmail] = useState("");
  // Request access: who's asking, why, and the address the request went in for.
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [requested, setRequested] = useState("");
  const [key, setKey] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // The help guide over the sign-in screen: from "New here?", or a ?help= link.
  const [help, setHelp] = useState<string | undefined>(() => helpLink());
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
  async function ask() {
    if (!validEmail || !name.trim()) return;
    setBusy(true);
    setProblem("");
    try {
      await requestAccess({
        name: name.trim(),
        email: address,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setRequested(address);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const link = [
    s.small,
    { textAlign: "center" as const, textDecorationLine: "underline" as const },
  ];
  return (
    <Card style={{ width: "100%", gap: 12 }}>
      <ErrorNotice error={problem || error} />
      {method === "request" ? (
        requested ? (
          <>
            <Text role="heading" aria-level={2} aria-live="polite" style={s.heading}>
              Request sent
            </Text>
            <Text style={s.muted}>
              The person who runs this Neato_Muse will see your request. If they approve, an invite
              arrives at {requested}. It works for 3 days.
            </Text>
            <Text style={s.small}>
              Already have an account? Your usual sign-in email is on its way instead.
            </Text>
            <Button
              onPress={() => {
                // The code from that email works here, without sending another.
                setSentTo(requested);
                setRequested("");
                setMethod("email");
              }}
            >
              Enter the code from that email
            </Button>
          </>
        ) : (
          <>
            <Text role="heading" aria-level={2} style={s.heading}>
              Request access
            </Text>
            <Text style={s.muted}>
              Neato_Muse is by invitation. Leave your name and email, and the person who runs it can
              invite you.
            </Text>
            <Field
              label="Your name"
              value={name}
              onChangeText={setName}
              autoFocus
              autoComplete="name"
              placeholder="Sarah Jones"
            />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
            />
            <Field
              label="What you'd use it for (optional)"
              value={note}
              onChangeText={setNote}
              maxLength={300}
              placeholder="A line is plenty"
              onSubmitEditing={() => void ask()}
            />
            <Button
              primary
              busy={busy}
              disabled={!validEmail || !name.trim()}
              onPress={() => void ask()}
            >
              Request access
            </Button>
          </>
        )
      ) : method === "key" ? (
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
      {emailSignIn && method === "email" && (
        <Button onPress={() => setMethod("request")}>No account yet? Request access</Button>
      )}
      {emailSignIn ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            // Back from a request lands on the email form, whatever was sent before.
            if (method === "request") {
              setRequested("");
              setSentTo("");
              setCode("");
            }
            setMethod(method === "email" ? "key" : "email");
          }}
        >
          <Text style={link}>
            {method === "email"
              ? "Use the access key instead"
              : method === "key"
                ? "Sign in with email instead"
                : "Back to sign in"}
          </Text>
        </Pressable>
      ) : (
        <Text style={s.small}>
          Local workspaces open without a key. Make sure your Neato_Muse server is running at{" "}
          {API_URL}.
        </Text>
      )}
      <Pressable
        role="button"
        onPress={() => setHelp("start")}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={[s.small, { textAlign: "center", textDecorationLine: "underline" }]}>
          New here? See how Neato_Muse works
        </Text>
      </Pressable>
      {help !== undefined && <SignedOutHelp start={help} onClose={() => setHelp(undefined)} />}
    </Card>
  );
}
