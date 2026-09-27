import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, CheckRow, ErrorNotice, Field, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

type Notify = "all" | "important" | "rules";
interface MailRule {
  id: string;
  from: string;
  subjectContains?: string;
  instruction: string;
  app: "gmail" | "outlook" | "any";
}
interface MailAlerts {
  available: boolean;
  notify: Notify;
  apps: { app: "gmail" | "outlook"; name: string; connected: boolean; watching: boolean }[];
  rules: MailRule[];
}
const NOTIFY: { value: Notify; label: string }[] = [
  { value: "important", label: "Important email" },
  { value: "all", label: "Every new email" },
  { value: "rules", label: "Only email that matches a rule" },
];
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Instant alerts for new Gmail and Outlook email, and "when X emails me, do Y" rules. */
export function MailAlertsCard() {
  const { api, notify } = useWorkspace();
  const [state, setState] = useState<MailAlerts>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [instruction, setInstruction] = useState("");
  const load = useCallback(
    () => api.request<MailAlerts>("/api/mail-alerts").then(setState, () => undefined),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!state) return null;
  const connected = state.apps.filter((a) => a.connected);
  async function run(id: string, work: () => Promise<unknown>, done?: string) {
    setBusy(id);
    setError("");
    try {
      const result = await work();
      if (result && typeof result === "object" && "apps" in result) setState(result as MailAlerts);
      else await load();
      if (done) notify(done);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy("");
    }
  }
  return (
    <Card style={{ gap: 10 }}>
      <SectionHeading title="Email alerts" />
      <Text style={s.muted}>
        Hear about new email the moment it arrives, and have your agent act on email from people you
        choose: "when Dana emails me, summarize it and draft a reply".
      </Text>
      {!state.available ? (
        <Text style={s.muted}>
          Needs the Composio webhook set up on the server (COMPOSIO_WEBHOOK_SECRET).
        </Text>
      ) : !connected.length ? (
        <Text style={s.muted}>Connect Gmail or Outlook under More apps to turn this on.</Text>
      ) : (
        <>
          {connected.map((app) => (
            <CheckRow
              key={app.app}
              label={`Watch ${app.name}`}
              checked={app.watching}
              onPress={() =>
                void run(
                  app.app,
                  () =>
                    api.request("/api/mail-alerts/watch", {
                      app: app.app,
                      enabled: !app.watching,
                    }),
                  app.watching ? `Stopped watching ${app.name}.` : `Watching ${app.name}.`,
                )
              }
            />
          ))}
          <Text style={[s.small, { marginTop: 4 }]}>Notify me about</Text>
          {NOTIFY.map((option) => (
            <CheckRow
              key={option.value}
              label={option.label}
              checked={state.notify === option.value}
              onPress={() =>
                void run("notify", () =>
                  api.request("/api/mail-alerts/notify", { notify: option.value }),
                )
              }
            />
          ))}
        </>
      )}
      {state.rules.map((rule) => (
        <View key={rule.id} style={[s.row, { gap: 10 }]}>
          <Text style={[s.text, { flex: 1 }]}>
            When <Text style={{ fontWeight: "600" }}>{rule.from}</Text> emails
            {rule.subjectContains ? ` about "${rule.subjectContains}"` : ""}: {rule.instruction}
          </Text>
          <Button
            small
            busy={busy === rule.id}
            disabled={!!busy}
            onPress={() =>
              void run(
                rule.id,
                () => api.request(`/api/mail-alerts/rules/${rule.id}/delete`, {}),
                "Email rule removed.",
              )
            }
          >
            Remove
          </Button>
        </View>
      ))}
      {state.available && connected.length > 0 && (
        <View style={{ gap: 8 }}>
          <Field
            label="When an email comes from"
            value={from}
            onChangeText={setFrom}
            placeholder="dana@acme.com or Acme"
            autoCapitalize="none"
          />
          <Field
            label="Do this"
            value={instruction}
            onChangeText={setInstruction}
            placeholder="Summarize it and draft a reply for me to approve"
          />
          <Button
            small
            primary
            busy={busy === "rule"}
            disabled={!!busy || from.trim().length < 2 || instruction.trim().length < 3}
            onPress={() =>
              void run(
                "rule",
                () =>
                  api.request("/api/mail-alerts/rules", {
                    from: from.trim(),
                    instruction: instruction.trim(),
                  }),
                "Email rule added.",
              ).then((ok) => {
                if (ok) {
                  setFrom("");
                  setInstruction("");
                }
              })
            }
          >
            Add rule
          </Button>
        </View>
      )}
      <ErrorNotice error={error} />
    </Card>
  );
}
