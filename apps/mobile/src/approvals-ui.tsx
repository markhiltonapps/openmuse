import { ShieldCheck, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Card, colors, ErrorNotice, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

interface ApprovalRule {
  id: string;
  app: string;
  tool?: string;
}
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
              {rule.tool ? appLabel(rule.app) : "Except deleting or cancelling things"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ask again before ${rule.tool ? actionLabel(rule) : appLabel(rule.app)}`}
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
