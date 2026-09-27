import { AppWindow, ChevronRight, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from "react-native";
import { z } from "zod";
import MiniAppFrame from "./MiniAppFrame";
import { ShareLinkCard } from "./share-ui";
import { Button, Card, colors, ErrorNotice, SectionHeading, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

interface MiniApp {
  id: string;
  title: string;
  description?: string;
  version: number;
  updatedAt: string;
}
const appSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  version: z.number(),
  updatedAt: z.string(),
});
function parsed(result: unknown) {
  let value = result;
  if (typeof result === "string")
    try {
      value = JSON.parse(result);
    } catch {
      return undefined;
    }
  const checked = appSchema.safeParse(value);
  return checked.success ? checked.data : undefined;
}
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function AppIcon() {
  return (
    <View style={[s.iconBox, { backgroundColor: colors.sky }]}>
      <AppWindow size={22} color={colors.blueDark} />
    </View>
  );
}

/** The mini app Neddy just built, in the chat, ready to open. */
export function MiniAppToolCard({ result, loading }: { result: unknown; loading: boolean }) {
  const app = parsed(result);
  const [open, setOpen] = useState(false);
  if (loading)
    return <ActivityIndicator color={colors.blueDark} style={{ alignSelf: "flex-start" }} />;
  if (!app) return null;
  return (
    <Card style={{ gap: 14 }}>
      <View style={[s.row, { gap: 13 }]}>
        <AppIcon />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.heading}>{app.title}</Text>
          <Text style={s.small}>
            {app.version > 1 ? `Mini app · version ${app.version}` : "Mini app"}
          </Text>
        </View>
      </View>
      {!!app.description && <Text style={s.muted}>{app.description}</Text>}
      <Button
        primary
        icon={AppWindow}
        style={{ alignSelf: "flex-start" }}
        onPress={() => setOpen(true)}
      >
        Open {app.title}
      </Button>
      {open && <MiniAppSheet id={app.id} onClose={() => setOpen(false)} />}
    </Card>
  );
}

/** A mini app full size, with its share link below. */
export function MiniAppSheet({
  id,
  onClose,
  onDeleted,
}: {
  id: string;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { api, notify } = useWorkspace();
  const { height } = useWindowDimensions();
  const [app, setApp] = useState<MiniApp & { document: string }>();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!app) return;
    setBusy(true);
    setError("");
    try {
      await api.request(`/api/mini-apps/${app.id}/delete`, {});
      notify(`Deleted ${app.title}. Its share links stopped working.`);
      onDeleted?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    api
      .request<MiniApp & { document: string }>(`/api/mini-apps/${id}`)
      .then(setApp, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, id]);
  return (
    <Sheet
      title={app?.title ?? "Mini app"}
      subtitle={app?.description ?? "Built by your agent"}
      onClose={onClose}
      wide
    >
      {app ? (
        <View style={{ gap: 18 }}>
          {/* Framed, so the agent's page can't pass for the app's own cards and buttons. */}
          <View style={{ gap: 8 }}>
            <View
              style={{
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.line,
                overflow: "hidden",
              }}
            >
              <MiniAppFrame
                document={app.document}
                title={app.title}
                height={Math.max(360, Math.min(680, Math.round(height * 0.62)))}
              />
            </View>
            <Text style={s.small}>
              It runs on its own and can’t see your account or anything else in the app. It only has
              what your agent put in it. Updated {when(app.updatedAt)}.
            </Text>
          </View>
          <ShareLinkCard
            fileId={app.id}
            name={app.title}
            base={`/api/mini-apps/${app.id}`}
            what="mini app"
            note="They’ll see everything in it, including changes your agent makes later."
          />
          {confirming ? (
            <View style={{ gap: 10 }}>
              <Text role="alert" style={s.text}>
                Delete {app.title}? Its share links stop working. This can’t be undone.
              </Text>
              <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
                <Button small disabled={busy} onPress={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button small danger icon={Trash2} busy={busy} onPress={() => void remove()}>
                  Delete mini app
                </Button>
              </View>
            </View>
          ) : (
            <Button
              small
              danger
              icon={Trash2}
              style={{ alignSelf: "flex-start" }}
              onPress={() => setConfirming(true)}
            >
              Delete mini app
            </Button>
          )}
          <ErrorNotice error={error} />
        </View>
      ) : error ? (
        <ErrorNotice error={error} />
      ) : (
        <ActivityIndicator color={colors.blueDark} style={{ padding: 40 }} />
      )}
    </Sheet>
  );
}

/** Every mini app Neddy has built, in Files. Hidden until there's one. */
export function MiniAppsCard() {
  const { api } = useWorkspace();
  const [apps, setApps] = useState<MiniApp[]>([]);
  const [open, setOpen] = useState<string>();
  const load = useCallback(
    () =>
      api.request<{ apps: MiniApp[] }>("/api/mini-apps").then(
        (value) => setApps(value.apps),
        () => undefined,
      ),
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!apps.length) return null;
  return (
    <Card style={{ gap: 4 }}>
      <SectionHeading title="Mini apps" />
      <Text style={[s.muted, { marginBottom: 8 }]}>
        Small tools and dashboards your agent built for you. Ask in chat for a new one, or for
        changes to one of these.
      </Text>
      {apps.map((app) => (
        <Pressable
          key={app.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${app.title}`}
          onPress={() => setOpen(app.id)}
          style={({ pressed }) => [
            s.row,
            {
              gap: 12,
              paddingVertical: 12,
              borderTopWidth: 1,
              borderTopColor: colors.line,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <AppIcon />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.text, { fontWeight: "600" }]}>{app.title}</Text>
            <Text numberOfLines={2} style={s.small}>
              {app.description || `Updated ${when(app.updatedAt)}`}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.muted} />
        </Pressable>
      ))}
      {open && (
        <MiniAppSheet id={open} onClose={() => setOpen(undefined)} onDeleted={() => void load()} />
      )}
    </Card>
  );
}
