import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, colors, ErrorNotice, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

interface AppAlert {
  id: string;
  app: string;
  name: string;
  instruction?: string;
}

/** Alerts from connected apps other than email, set up by asking the agent in chat. */
export function AppAlertsCard() {
  const { api, notify, ask } = useWorkspace();
  const [state, setState] = useState<{ available: boolean; alerts: AppAlert[] }>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api
        .request<{ available: boolean; alerts: AppAlert[] }>("/api/app-alerts")
        .then(setState, () => undefined),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!state?.available) return null;
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="App alerts" />
      <Text style={s.muted}>
        Hear about things in your other apps as they happen, like a new Calendly booking or a Slack
        message, and have your agent act on them.
      </Text>
      {state.alerts.map((alert) => (
        <View
          key={alert.id}
          style={[
            s.row,
            { gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[s.text, { fontWeight: "600" }]}>{alert.name}</Text>
            <Text style={s.small}>
              {alert.app}
              {alert.instruction ? ` · then: ${alert.instruction}` : " · notification only"}
            </Text>
          </View>
          <Button
            small
            busy={busy === alert.id}
            disabled={!!busy}
            onPress={() => {
              setBusy(alert.id);
              setError("");
              void api
                .request(`/api/app-alerts/${alert.id}/stop`, {})
                .then(
                  () => {
                    notify(`Stopped: ${alert.name}.`);
                    return load();
                  },
                  (e) => setError(e instanceof Error ? e.message : String(e)),
                )
                .finally(() => setBusy(""));
            }}
          >
            Stop
          </Button>
        </View>
      ))}
      <Button
        small
        onPress={() =>
          ask(
            "Tell me when something happens in one of my connected apps. Which alerts can I set up?",
          )
        }
      >
        Set up an app alert
      </Button>
      <ErrorNotice error={error} />
    </Card>
  );
}
