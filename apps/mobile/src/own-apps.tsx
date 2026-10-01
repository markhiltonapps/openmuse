import { KeyRound, LogIn, Plug, Plus, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Platform, Text, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { Button, Card, colors, ErrorNotice, Field, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

type Status = "connected" | "needs_sign_in" | "needs_key" | "needs_confirm" | "error";
interface OwnApp {
  id: string;
  name: string;
  host: string;
  status: Status;
  error?: string;
  addedBy: "person" | "agent";
  actions: number;
  hasKey: boolean;
}
interface Connected {
  connected: boolean;
  url?: string;
  app: OwnApp;
}

/**
 * Status in a few words. The icon's tile carries the state (green works, orange needs you, red
 * failed); the words stay readable grey, and red only when something went wrong.
 */
function statusLine(app: OwnApp, agent: string) {
  if (app.status === "connected")
    return {
      text: `Connected · ${app.actions} ${app.actions === 1 ? "action" : "actions"}`,
      tint: colors.mutedStrong,
      tile: colors.green,
    };
  if (app.status === "needs_sign_in")
    return { text: "Needs you to sign in", tint: colors.mutedStrong, tile: colors.orange };
  if (app.status === "needs_confirm")
    return {
      text: `${agent} added this. Check the address, then connect it.`,
      tint: colors.mutedStrong,
      tile: colors.orange,
    };
  if (app.status === "needs_key")
    return { text: app.error ?? "Needs its access key", tint: colors.danger, tile: colors.errorBg };
  if (app.status === "error")
    return { text: app.error ?? "Couldn't connect", tint: colors.danger, tile: colors.errorBg };
  return { text: "", tint: colors.mutedStrong, tile: colors.lavender };
}

/**
 * On the web, a tab opened during the tap itself, so the browser doesn't block the sign-in page
 * that arrives a moment later. It can't reach back into this page.
 */
export function blankTab() {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const tab = window.open("", "_blank");
  if (tab) {
    tab.opener = null;
    tab.document.title = "Opening sign-in…";
    tab.document.body.textContent = "Opening the sign-in page…";
  }
  return tab;
}
/** Opens the app's sign-in page; false when the browser blocked it. */
export function openPage(url: string, tab?: Window | null) {
  if (Platform.OS !== "web") {
    void Linking.openURL(url);
    return true;
  }
  // A tab the person already closed can't be used; open a new one or offer the button.
  if (tab && !tab.closed) {
    tab.location.href = url;
    return true;
  }
  const page = window.open(url, "_blank");
  if (page) page.opener = null;
  return page !== null;
}

/**
 * Apps → Apps: connect an app that offers an MCP server by its web address. Sign-in happens on
 * the app's own page; an access key, when the app gives one, is typed here and never in chat.
 */
export function OwnAppsCard() {
  const { api, notify } = useWorkspace();
  const { data } = useAgentWorkspace();
  const agent = data?.identity.name || "Your agent";
  const [apps, setApps] = useState<OwnApp[]>();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  /** A sign-in page the browser wouldn't open by itself. */
  const [blocked, setBlocked] = useState<{ name: string; url: string; again?: boolean }>();
  const load = useCallback(
    () =>
      api.request<{ apps: OwnApp[] }>("/api/mcp").then(
        (value) => setApps(value.apps),
        () => setApps([]),
      ),
    [api],
  );
  useEffect(() => {
    void load();
    // Back from signing in on the app's page: show it connected.
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => listener.remove();
  }, [load]);
  async function run(
    id: string,
    request: () => Promise<Connected | { ok: boolean }>,
    /** When a sign-in page may come back, open its tab now, during the tap. */
    signIn = false,
  ) {
    const tab = signIn ? blankTab() : null;
    setBusy(id);
    setError("");
    setBlocked(undefined);
    try {
      const result = await request();
      await load();
      if ("url" in result && result.url) {
        if (openPage(result.url, tab))
          notify(`Sign in to ${result.app.name} on the page that opened, then come back here.`);
        else setBlocked({ name: result.app.name, url: result.url });
      } else {
        tab?.close();
        if ("connected" in result && result.connected)
          notify(`${result.app.name} is connected. ${agent} can use it now.`);
      }
      return result;
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  async function add() {
    const result = await run(
      "new",
      () =>
        api.request<Connected>("/api/mcp", {
          name: name.trim(),
          url: url.trim(),
          ...(key.trim() ? { key: key.trim() } : {}),
        }),
      !key.trim(),
    );
    if (result) {
      setAdding(false);
      setName("");
      setUrl("");
      setKey("");
    }
  }
  return (
    <Card style={{ gap: 14 }}>
      <SectionHeading title="Your own apps" />
      <Text style={s.muted}>
        Connect an app that offers an MCP server, such as one you built. {agent} can then look
        things up in it, and asks you before changing anything there.
      </Text>
      {apps?.map((app) => (
        <OwnAppRow
          key={app.id}
          app={app}
          agent={agent}
          busy={busy === app.id}
          disabled={!!busy}
          onConnect={() =>
            void run(
              app.id,
              () => api.request<Connected>(`/api/mcp/${app.id}/connect`, {}),
              !app.hasKey && app.status !== "connected",
            )
          }
          onKey={(value) =>
            run(app.id, () =>
              api.request<Connected>(`/api/mcp/${app.id}/key`, value ? { key: value } : {}),
            )
          }
          onRemove={() =>
            void run(app.id, async () => {
              const done = await api.request<{ ok: boolean }>(`/api/mcp/${app.id}/delete`, {});
              notify(`${app.name} removed.`);
              return done;
            })
          }
        />
      ))}
      {adding ? (
        <View style={{ gap: 12 }}>
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Todd's CRM"
            maxLength={60}
          />
          <Field
            label="Web address"
            value={url}
            onChangeText={setUrl}
            placeholder="https://example.com/mcp"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Field
            label="Access key (optional)"
            value={key}
            onChangeText={setKey}
            placeholder="Only if the app gave you one"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Text style={s.muted}>Leave the key empty to sign in on the app's own page instead.</Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button
              primary
              icon={Plug}
              busy={busy === "new"}
              disabled={!name.trim() || !url.trim() || (!!busy && busy !== "new")}
              onPress={() => void add()}
            >
              Connect
            </Button>
            <Button
              disabled={busy === "new"}
              onPress={() => {
                setAdding(false);
                setError("");
              }}
            >
              Cancel
            </Button>
          </View>
        </View>
      ) : (
        <Button icon={Plus} disabled={!!busy} onPress={() => setAdding(true)}>
          Add an app
        </Button>
      )}
      {blocked && (
        <View accessibilityRole="alert" style={{ gap: 8 }}>
          <Text style={s.text}>
            {blocked.again
              ? "Your browser is still blocking the sign-in page. Allow pop-ups for this site, then tap “Open the sign-in page” again."
              : `Your browser didn't open the sign-in page for ${blocked.name}.`}
          </Text>
          <Button
            primary
            icon={LogIn}
            onPress={() => {
              if (openPage(blocked.url)) {
                setBlocked(undefined);
                notify(`Sign in to ${blocked.name} on the page that opened, then come back here.`);
              } else setBlocked({ ...blocked, again: true });
            }}
          >
            Open the sign-in page
          </Button>
        </View>
      )}
      <ErrorNotice error={error} />
    </Card>
  );
}

function OwnAppRow({
  app,
  agent,
  busy,
  disabled,
  onConnect,
  onKey,
  onRemove,
}: {
  app: OwnApp;
  agent: string;
  busy: boolean;
  disabled: boolean;
  onConnect: () => void;
  onKey: (key: string) => Promise<unknown>;
  onRemove: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const line = statusLine(app, agent);
  const askKey = editing || app.status === "needs_key";
  return (
    <View style={{ gap: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.line }}>
      <View style={[s.row, { gap: 12, alignItems: "flex-start" }]}>
        <View style={[s.iconBox, { backgroundColor: line.tile }]}>
          <Plug size={19} color={colors.text} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.text, { fontWeight: "600" }]}>{app.name}</Text>
          <Text style={s.muted} numberOfLines={1}>
            {app.host}
          </Text>
          <Text style={[s.muted, { color: line.tint }]}>{line.text}</Text>
        </View>
      </View>
      {askKey && (
        <View style={{ gap: 8 }}>
          <Field
            label="Access key"
            accessibilityLabel={`Access key for ${app.name}`}
            value={key}
            onChangeText={setKey}
            placeholder="Paste the key your app gave you"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </View>
      )}
      {confirm ? (
        <View style={{ gap: 8 }}>
          <Text style={s.text}>
            Remove {app.name}? {agent} will stop using it and forget anything you set to always
            allow.
          </Text>
          <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button
              danger
              busy={busy}
              accessibilityLabel={`Yes, remove ${app.name}`}
              onPress={onRemove}
            >
              Yes, remove
            </Button>
            <Button
              disabled={busy}
              accessibilityLabel={`Keep ${app.name}`}
              onPress={() => setConfirm(false)}
            >
              Keep
            </Button>
          </View>
        </View>
      ) : (
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          {askKey ? (
            <Button
              primary
              icon={KeyRound}
              busy={busy}
              disabled={disabled || !key.trim()}
              accessibilityLabel={`Save the access key for ${app.name}`}
              onPress={() =>
                void onKey(key.trim()).then(() => {
                  setKey("");
                  setEditing(false);
                })
              }
            >
              Save key
            </Button>
          ) : app.status === "needs_sign_in" ? (
            <Button
              primary
              icon={LogIn}
              busy={busy}
              disabled={disabled}
              accessibilityLabel={`Sign in to ${app.name}`}
              onPress={onConnect}
            >
              Sign in
            </Button>
          ) : app.status === "needs_confirm" ? (
            <Button
              primary
              icon={Plug}
              busy={busy}
              disabled={disabled}
              accessibilityLabel={`Connect ${app.name}`}
              onPress={onConnect}
            >
              Connect
            </Button>
          ) : (
            <Button
              icon={RefreshCw}
              busy={busy}
              disabled={disabled}
              accessibilityLabel={`${app.status === "connected" ? "Check again" : "Try again"}: ${app.name}`}
              onPress={onConnect}
            >
              {app.status === "connected" ? "Check again" : "Try again"}
            </Button>
          )}
          {app.hasKey && !editing && app.status !== "needs_key" && (
            <Button
              disabled={disabled}
              accessibilityLabel={`Change the access key for ${app.name}`}
              onPress={() => setEditing(true)}
            >
              Change key
            </Button>
          )}
          {editing && (
            <Button
              disabled={busy}
              accessibilityLabel={`Keep the current key for ${app.name}`}
              onPress={() => setEditing(false)}
            >
              Cancel
            </Button>
          )}
          <Button
            disabled={disabled}
            accessibilityLabel={`Remove ${app.name}`}
            onPress={() => setConfirm(true)}
          >
            Remove
          </Button>
        </View>
      )}
    </View>
  );
}
