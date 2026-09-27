import { AlarmClock, ArrowRight, Bell, Check, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { Button, Card, colors, ErrorNotice, resultSummary, s } from "./ui";
import { useWorkspace } from "./workspace";

export function BackgroundUpdates() {
  const { data, mutate, refresh } = useAgentWorkspace();
  const { open, api } = useWorkspace();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const updates =
    data?.notifications.filter((item) => !item.read && (item.taskId || item.reminderId)) || [];
  const update = updates[0];
  // One card per task or reminder: repeated updates about the same one are dismissed together.
  const subject = (item: { taskId?: string; reminderId?: string }) =>
    item.taskId ?? item.reminderId;
  const others = new Set(updates.map(subject).filter((id) => id !== (update && subject(update))))
    .size;
  if (!update || data?.identity.showChatUpdates === false) return null;
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const dismiss = () =>
    act(() =>
      update?.taskId
        ? mutate("/notifications/read", { taskId: update.taskId })
        : mutate(`/notifications/${update?.id}/read`, {}),
    );
  const snooze = () =>
    act(async () => {
      await api.request(`/api/reminders/${update?.reminderId}/snooze`, { minutes: 10 });
      await mutate(`/notifications/${update?.id}/read`, {});
      await refresh();
    });
  const reminder = !update.taskId && !!update.reminderId;
  return (
    <Card
      style={{ backgroundColor: reminder ? colors.lavender : colors.sky, padding: 16, gap: 10 }}
    >
      <View style={[s.between, { gap: 12 }]}>
        <View style={[s.row, { gap: 7 }]}>
          {reminder ? (
            <AlarmClock size={14} color={colors.blueDark} />
          ) : (
            <Bell size={14} color={colors.blueDark} />
          )}
          <Text style={s.small}>{reminder ? update.title : "An update for you"}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={reminder ? "Dismiss reminder" : "Dismiss background update"}
          disabled={busy}
          onPress={() => void dismiss()}
          hitSlop={10}
          style={{ padding: 6 }}
        >
          <X size={16} color={colors.muted} />
        </Pressable>
      </View>
      {reminder ? (
        <Text style={s.heading}>{update.body}</Text>
      ) : (
        <>
          <Text style={s.heading}>{update.title}</Text>
          <Text style={s.text}>{resultSummary(update.body)}</Text>
        </>
      )}
      <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
        {reminder ? (
          <>
            <Button small primary icon={Check} busy={busy} onPress={() => void dismiss()}>
              Done
            </Button>
            <Button small icon={AlarmClock} disabled={busy} onPress={() => void snooze()}>
              In 10 minutes
            </Button>
          </>
        ) : (
          <Button
            small
            icon={ArrowRight}
            onPress={() => update.taskId && open({ type: "task", taskId: update.taskId })}
          >
            View task
          </Button>
        )}
        {others > 0 && (
          <Button small onPress={() => open({ type: "notifications" })}>
            {others} more {others === 1 ? "update" : "updates"}
          </Button>
        )}
      </View>
      <ErrorNotice error={error} />
    </Card>
  );
}
