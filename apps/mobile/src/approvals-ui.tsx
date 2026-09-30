import { ShieldCheck, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { tipProps } from "./tips";
import { Card, CheckRow, colors, ErrorNotice, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

interface ApprovalRule {
  id: string;
  app: string;
  tool?: string;
  expiresAt?: string;
}
const untilLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const appLabel = (app: string) =>
  app.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
/** OUTLOOK_SEND_EMAIL in Outlook → "Send email". */
const actionLabel = (rule: ApprovalRule) => {
  const prefix = `${rule.app.toUpperCase()}_`;
  const action = rule.tool?.startsWith(prefix) ? rule.tool.slice(prefix.length) : rule.tool;
  const words = (action ?? "").toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Connected-app actions that run without asking, and a way to take that back. */
export function AlwaysAllowedCard() {
  const { api } = useWorkspace();
  const [rules, setRules] = useState<ApprovalRule[]>();
  const [error, setError] = useState("");
  const load = useCallback(
    () => api.request<ApprovalRule[]>("/api/approval-rules").then(setRules, () => undefined),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!rules) return null;
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="Always allowed" />
      <Text style={s.muted}>
        {rules.length
          ? "These run without asking you first. Everything else from your connected apps waits for your approval, and purchases always ask."
          : "Your agent asks before anything from your connected apps sends, creates or changes something. When you approve one, you can choose to always allow it."}
      </Text>
      {rules.map((rule) => (
        <View key={rule.id} style={[s.row, { gap: 10 }]}>
          <ShieldCheck size={16} color={colors.blueDark} />
          <View style={{ flex: 1 }}>
            <Text style={s.text}>
              {rule.tool ? actionLabel(rule) : `Everything in ${appLabel(rule.app)}`}
            </Text>
            <Text style={s.small}>
              {[
                rule.tool ? appLabel(rule.app) : "Except deleting or cancelling things",
                rule.expiresAt ? `until ${untilLabel(rule.expiresAt)}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ask again before ${rule.tool ? actionLabel(rule) : appLabel(rule.app)}`}
            {...tipProps("Ask again before doing this")}
            hitSlop={8}
            onPress={() =>
              void api
                .request(`/api/approval-rules/${encodeURIComponent(rule.id)}/delete`, {})
                .then(load, (e) => setError(e instanceof Error ? e.message : String(e)))
            }
          >
            <X size={16} color={colors.muted} />
          </Pressable>
        </View>
      ))}
      <ErrorNotice error={error} />
    </Card>
  );
}

/** Per connected app: can the agent change things there, or only look? */
export function AppPermissionsCard() {
  const { api, notify } = useWorkspace();
  const [apps, setApps] = useState<{ app: string; name: string }[]>();
  const [readOnly, setReadOnly] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void api
      .request<{ apps?: { app: string; name: string; connected: boolean }[] }>("/api/apps")
      .then(
        (value) => setApps((value.apps ?? []).filter((a) => a.connected)),
        () => setApps([]),
      );
    void api.request<{ readOnly: string[] }>("/api/app-permissions").then(
      (value) => setReadOnly(value.readOnly),
      () => undefined,
    );
  }, [api]);
  if (!apps?.length) return null;
  return (
    <Card style={{ gap: 10 }}>
      <SectionHeading title="App permissions" />
      <Text style={s.muted}>
        Read only means your agent can look things up in that app but never send, create or change
        anything there, even with your approval.
      </Text>
      {apps.map((app) => {
        const on = readOnly.includes(app.app.toLowerCase());
        return (
          <CheckRow
            key={app.app}
            label={`${app.name}: read only`}
            checked={on}
            onPress={() => {
              if (busy) return;
              setBusy(app.app);
              setError("");
              void api
                .request<{ readOnly: string[] }>("/api/app-permissions", {
                  app: app.app.toLowerCase(),
                  readOnly: !on,
                })
                .then(
                  (value) => {
                    setReadOnly(value.readOnly);
                    notify(
                      on
                        ? `${app.name} can make changes again, with your approval.`
                        : `${app.name} is read only.`,
                    );
                  },
                  (e) => setError(e instanceof Error ? e.message : String(e)),
                )
                .finally(() => setBusy(""));
            }}
          />
        );
      })}
      <ErrorNotice error={error} />
    </Card>
  );
}
