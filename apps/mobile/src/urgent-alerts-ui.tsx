import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { HIDDEN } from "./job-working-ui";
import { Button, Card, CheckRow, colors, ErrorNotice, Field, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

type Kind = "timeToLeave" | "security" | "money" | "people";
interface Settings {
  timeToLeave: boolean;
  security: boolean;
  money: boolean;
  people: boolean;
  peopleList: string[];
}
const ADD_FIELD = "urgent-add-person";
/** On the web, move focus to an element once it's drawn. */
function focusSoon(id: string) {
  if (Platform.OS === "web") setTimeout(() => document.getElementById(id)?.focus(), 0);
}
const KINDS: { kind: Kind; label: string; detail: string }[] = [
  {
    kind: "timeToLeave",
    label: "Time to leave",
    detail:
      "Something on your calendar starts in about 15 minutes (it doesn’t know about traffic).",
  },
  {
    kind: "security",
    label: "Security alerts",
    detail:
      "New sign-ins, password changes, anything you didn’t ask for. Codes are never read out.",
  },
  {
    kind: "money",
    label: "Money problems",
    detail: "Failed payments, declined cards, fraud warnings, bills due today.",
  },
  {
    kind: "people",
    label: "People you choose",
    detail: "Email from the people listed below.",
  },
];

/**
 * What Neddy speaks up about during a live call, without being asked. Each kind has its own
 * switch; they can also be changed by saying so ("stop telling me about money alerts").
 */
export function UrgentAlertsCard() {
  const { api } = useWorkspace();
  const [settings, setSettings] = useState<Settings>();
  const [person, setPerson] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [news, setNews] = useState("");
  useEffect(() => {
    void api.request<Settings>("/api/urgent-alerts").then(setSettings, () => undefined);
  }, [api]);
  if (!settings) return null;
  const add = () => {
    const who = person.trim();
    if (busy || who.length < 3) return;
    void change("add", { addPeople: [who] }, `Added ${who}.`).then((ok) => ok && setPerson(""));
  };
  async function change(id: string, body: object, said: string) {
    setBusy(id);
    setError("");
    try {
      setSettings(await api.request<Settings>("/api/urgent-alerts", body));
      setNews(said);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy("");
    }
  }
  return (
    <Card style={{ gap: 10 }}>
      <SectionHeading title="Urgent alerts on calls" />
      <Text style={s.muted}>
        During a live call, your agent speaks up about these straight away, without being asked.
        Everything else waits as a normal notification.
      </Text>
      <View role="group" aria-label="Speak up about">
        {KINDS.map(({ kind, label, detail }) => (
          <CheckRow
            key={kind}
            label={label}
            detail={detail}
            checked={settings[kind]}
            onPress={() =>
              !busy &&
              void change(
                kind,
                { [kind]: !settings[kind] },
                `${label} ${settings[kind] ? "off" : "on"}.`,
              )
            }
          />
        ))}
      </View>
      {settings.people && (
        <View style={{ gap: 8, marginLeft: 29 }}>
          {settings.peopleList.length ? (
            settings.peopleList.map((name) => (
              <View key={name} style={[s.row, { gap: 10 }]}>
                <Text style={[s.text, { flex: 1 }]}>{name}</Text>
                <Button
                  small
                  danger
                  style={{ minHeight: 44, backgroundColor: "transparent" }}
                  accessibilityLabel={`Remove ${name}`}
                  busy={busy === `remove:${name}`}
                  disabled={!!busy}
                  onPress={() =>
                    void change(
                      `remove:${name}`,
                      { removePeople: [name] },
                      `Removed ${name}.`,
                    ).then(
                      // The button that had focus is gone: focus goes to the Add field.
                      () => focusSoon(ADD_FIELD),
                    )
                  }
                >
                  Remove
                </Button>
              </View>
            ))
          ) : (
            <Text style={s.muted}>No one yet. Add someone below to start.</Text>
          )}
          <View style={[s.row, { gap: 8, alignItems: "flex-end" }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Field
                nativeID={ADD_FIELD}
                label="Add someone (a name or email address)"
                value={person}
                onChangeText={setPerson}
                placeholder="dana@acme.com"
                autoCapitalize="none"
                onSubmitEditing={add}
              />
            </View>
            <Button
              small
              busy={busy === "add"}
              disabled={!!busy || person.trim().length < 3}
              style={{ minHeight: 44 }}
              onPress={add}
            >
              Add
            </Button>
          </View>
          <Text style={s.small}>
            Use the name exactly as it shows on their emails, or their email address.
          </Text>
        </View>
      )}
      <Text style={s.small}>
        You can also say it: “Stop telling me about money alerts on calls.”
      </Text>
      <ErrorNotice error={error} />
      {/* Always mounted, so a screen reader hears each change. */}
      <Text role="status" style={news ? [s.muted, { color: colors.greenText }] : HIDDEN}>
        {news}
      </Text>
    </Card>
  );
}
