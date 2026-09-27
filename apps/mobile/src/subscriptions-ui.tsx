import { ArrowRight, Repeat } from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { Button, Card, colors, ErrorNotice, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

const TITLE = "Find my subscriptions";
export const SUBSCRIPTIONS_PROMPT = `Find my recurring subscriptions and memberships.

1. Search my email from the last 4 months for receipts, invoices, renewal notices, "your subscription", "membership", "auto-renew" and "trial ends" messages.
2. If a card or bank app is connected (for example Brex), look through its recent transactions for charges that repeat.
3. For each subscription, list: the service, the amount and how often it's charged, the last charge date, the next renewal if known, which card or account pays, and how to cancel it (the link or steps).
4. Point out free trials about to turn into paid plans, recent price increases, and anything that looks duplicated or unused.
5. Give the total per month and per year.

Save the list as a tracker, then finish with a short summary, most expensive first. Don't cancel anything. Offer to draft cancellation emails; any email waits for my approval before it's sent.`;

/** One tap to have the agent find recurring charges and how to cancel them. */
export function SubscriptionsCard() {
  const { data, delegate } = useAgentWorkspace();
  const { open } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const last = (data?.tasks ?? [])
    .filter((task) => task.title === TITLE)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  async function find() {
    setBusy(true);
    setError("");
    try {
      const task = await delegate({
        title: TITLE,
        prompt: SUBSCRIPTIONS_PROMPT,
        kind: "agent",
        input: {},
      });
      open({ type: "task", taskId: task.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="Subscriptions" />
      <View style={[s.row, { gap: 10, alignItems: "flex-start" }]}>
        <Repeat size={18} color={colors.blueDark} />
        <Text style={[s.muted, { flex: 1 }]}>
          Your agent looks through your email receipts, and Brex or any other card app you've
          connected, for charges that repeat. It totals them and tells you how to cancel each one.
          Nothing is cancelled without you.
        </Text>
      </View>
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button primary icon={Repeat} busy={busy} onPress={() => void find()}>
          {last ? "Check again" : TITLE}
        </Button>
        {last && (
          <Button icon={ArrowRight} onPress={() => open({ type: "task", taskId: last.id })}>
            {["succeeded", "failed", "cancelled"].includes(last.status)
              ? `Last results · ${new Date(last.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
              : "In progress"}
          </Button>
        )}
      </View>
      <ErrorNotice error={error} />
    </Card>
  );
}
