import { Check, KeyRound, LogIn, Plug } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import { useAgentWorkspace } from "./agent-workspace";
import { Shell } from "./approval-card";
import { blankTab, openPage } from "./own-apps";
import { Button, colors, ErrorNotice, Field, s } from "./ui";
import { useWorkspace } from "./workspace";

interface AppInfo {
  app: string;
  name: string;
  connected: boolean;
  needsReconnect?: boolean;
  logo?: string;
}
interface OwnApp {
  id: string;
  name: string;
  host: string;
  status: "connected" | "needs_sign_in" | "needs_key" | "needs_confirm" | "error";
  error?: string;
  hasKey: boolean;
}
type Phase = "idle" | "opening" | "away" | "checking" | "notYet";
const slugOf = (app: string) => app.trim().toLowerCase().replace(/\s+/g, "");
const named = (slug: string) =>
  slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const meta = [s.small, { fontSize: 13, color: colors.mutedStrong }];

function parsed(result: unknown): Record<string, unknown> {
  let value = result;
  if (typeof value === "string")
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
/** The app a connect_app result asks the person to connect, or nothing if it's connected. */
export function connectRequest(result: unknown): { app: string; own: boolean } | undefined {
  const r = parsed(result);
  return r.connected === false && typeof r.app === "string" && r.app
    ? { app: r.app, own: r.own === true }
    : undefined;
}
/** The person's own app add_own_app saved, waiting for them to connect it. */
export function ownAppRequest(result: unknown): { id: string; name: string } | undefined {
  const saved = parsed(result).saved as { id?: unknown; name?: unknown } | undefined;
  return typeof saved?.id === "string"
    ? { id: saved.id, name: typeof saved.name === "string" ? saved.name : "" }
    : undefined;
}

/** Once connected: on a call they say so (only if they just connected it here), in the chat it's sent. */
const connectedLine = (agent: string, onCall: boolean, tapped: boolean, over: boolean) =>
  onCall && tapped && over
    ? `Choose “Talk again” and say you’ve connected it.`
    : onCall && tapped
      ? `Say “done” and ${agent} will carry on.`
      : !onCall && tapped
        ? `${agent} is carrying on.`
        : `${agent} can use it now.`;

/** Back on this page after the sign-in tab (or window): check whether it's connected now. */
function useBack(watching: boolean, back: () => void) {
  useEffect(() => {
    if (!watching || Platform.OS !== "web" || typeof document === "undefined") return;
    const visible = () => {
      if (document.visibilityState === "visible") back();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [watching, back]);
}

/**
 * What both Connect cards share: once connected, the agent carries on. In the chat it's told so
 * (only when they connected it from this card just now); on a call they say it themselves.
 */
function useFlow(name: string, onCall: boolean, isConnected: () => Promise<boolean>) {
  const { ask } = useWorkspace();
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  /** A sign-in page the browser wouldn't open by itself: a button opens it with the tap. */
  const [blocked, setBlocked] = useState("");
  const tapped = useRef(false);
  const told = useRef(false);
  const finished = useCallback(() => {
    setConnected(true);
    setPhase("idle");
    setBlocked("");
    if (!onCall && tapped.current && !told.current) {
      told.current = true;
      ask(`I’ve connected ${name}. Carry on.`);
    }
  }, [ask, name, onCall]);
  // The app can take a moment to say it's connected, so it's checked a few times.
  const check = useCallback(async () => {
    setPhase("checking");
    for (const delay of [0, 1500, 3000, 6000]) {
      await wait(delay);
      if (await isConnected().catch(() => false)) return finished();
    }
    setPhase("notYet");
  }, [finished, isConnected]);
  const back = useCallback(() => void check(), [check]);
  useBack(phase === "away" || phase === "notYet", back);
  /** Opens the sign-in page in the tab opened during the tap, or offers a button if blocked. */
  const signIn = (url: string, tab: Window | null) => {
    tapped.current = true;
    if (openPage(url, tab)) setPhase("away");
    else {
      setBlocked(url);
      setPhase("idle");
    }
  };
  return {
    connected,
    setConnected,
    phase,
    setPhase,
    blocked,
    setBlocked,
    tapped,
    finished,
    check,
    signIn,
  };
}

function Frame({
  name,
  logo,
  connected,
  wide,
  line,
  warn = false,
  children,
}: {
  name: string;
  logo?: string;
  connected: boolean;
  wide: boolean;
  line: string;
  /** The line is a problem (an expired sign-in). */
  warn?: boolean;
  children?: ReactNode;
}) {
  return (
    <Shell
      done={connected}
      wide={wide}
      label={connected ? `${name}, connected` : `Connect ${name}`}
    >
      <View style={[s.row, { gap: 5 }]}>
        {connected && (
          <View aria-hidden>
            <Check size={12} color={colors.greenText} />
          </View>
        )}
        <Text style={[s.label, { color: connected ? colors.greenText : colors.mutedStrong }]}>
          {connected ? "Connected" : "Connect an app"}
        </Text>
      </View>
      <View style={[s.row, { gap: 12 }]}>
        {/* The name says which app; the logo is decoration. */}
        <View aria-hidden>
          {logo ? (
            <Image
              source={{ uri: logo }}
              style={{ width: 36, height: 36, borderRadius: 8 }}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                backgroundColor: colors.lavender,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Plug size={18} color={colors.text} />
            </View>
          )}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text role="heading" aria-level={3} style={[s.heading, { fontSize: 17, lineHeight: 23 }]}>
            {name}
          </Text>
          {/* Mounted all the time, so what happened after the sign-in page is read out. */}
          <Text role="status" style={[meta, warn ? { color: colors.danger } : null]}>
            {line}
          </Text>
        </View>
      </View>
      {children}
    </Shell>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return (
    <View style={[s.row, { columnGap: 16, rowGap: 6, flexWrap: "wrap", alignItems: "center" }]}>
      {children}
    </View>
  );
}
/** "I’ve signed in": while it's checking (the status line says so) it waits, muted, in place. */
function SignedIn({ checking, onPress }: { checking: boolean; onPress: () => void }) {
  return (
    <Pressable
      role="button"
      aria-disabled={checking}
      onPress={() => !checking && onPress()}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: "center",
        opacity: pressed && !checking ? 0.6 : 1,
      })}
    >
      <Text
        style={[
          s.text,
          { color: checking ? colors.mutedStrong : colors.blueText, fontWeight: "600" },
        ]}
      >
        I’ve signed in
      </Text>
    </Pressable>
  );
}

/**
 * Connect an app where the person is (the chat, a call, a saved call): one tap opens the app's own
 * sign-in page in a new tab, with a link fetched fresh (they expire). When they come back it checks
 * and says Connected.
 */
export function ConnectCard({
  app,
  onCall = false,
  over = false,
  wide = false,
}: {
  app: string;
  onCall?: boolean;
  /** The call it's on has ended. */
  over?: boolean;
  wide?: boolean;
}) {
  const { api } = useWorkspace();
  const { data } = useAgentWorkspace();
  const agent = data?.identity.name || "Neddy";
  const slug = slugOf(app);
  const [info, setInfo] = useState<AppInfo>();
  const [error, setError] = useState("");
  const name = info?.name || named(slug);
  const isConnected = useCallback(async () => {
    const list = await api.request<{ apps?: { app: string; connected: boolean }[] }>("/api/apps");
    return !!list.apps?.some((item) => item.app === slug && item.connected);
  }, [api, slug]);
  const flow = useFlow(name, onCall, isConnected);
  const { setConnected } = flow;

  useEffect(() => {
    let live = true;
    void api
      .request<{ apps?: AppInfo[] }>(`/api/apps/directory?q=${encodeURIComponent(slug)}`)
      .then((found) => {
        const match = found.apps?.find((item) => item.app === slug);
        if (!live || !match) return;
        setInfo(match);
        if (match.connected) setConnected(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, slug, setConnected]);

  const connect = async () => {
    const tab = blankTab();
    flow.setPhase("opening");
    flow.setBlocked("");
    setError("");
    try {
      const result = await api.request<{ connected: boolean; url?: string }>("/api/apps/connect", {
        app: slug,
      });
      if (result.connected) {
        tab?.close();
        flow.tapped.current = true;
        return flow.finished();
      }
      if (!result.url) {
        tab?.close();
        flow.setPhase("idle");
        return setError(`Couldn’t get the sign-in page for ${name}. Try again.`);
      }
      flow.signIn(result.url, tab);
    } catch (e) {
      tab?.close();
      flow.setPhase("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const { phase } = flow;
  // Back from signing in (waiting, checking or not yet), the card keeps one shape.
  const again = phase === "away" || phase === "notYet" || phase === "checking";
  const line = flow.connected
    ? connectedLine(agent, onCall, flow.tapped.current, over)
    : flow.blocked
      ? "Your browser didn’t open the sign-in page."
      : phase === "checking"
        ? "Checking…"
        : phase === "notYet"
          ? `Not connected yet. Finish signing in to ${name}, or open the sign-in page again if it closed.`
          : phase === "away"
            ? `Finish signing in to ${name} in the new tab, then come back here.`
            : info?.needsReconnect
              ? `Its sign-in has expired. Connect it again so ${agent} can use it.`
              : `Opens the sign-in page for ${name} in a new tab.`;

  return (
    <Frame
      name={name}
      logo={info?.logo}
      connected={flow.connected}
      wide={wide}
      line={line}
      warn={!flow.connected && phase === "idle" && !flow.blocked && !!info?.needsReconnect}
    >
      <ErrorNotice error={error} />
      {!flow.connected && (
        <Actions>
          {flow.blocked ? (
            <Button
              primary
              icon={LogIn}
              onPress={() => flow.signIn(flow.blocked, null)}
              accessibilityLabel={`Open the sign-in page for ${name}`}
            >
              Open the sign-in page
            </Button>
          ) : (
            <Button
              // While they sign in elsewhere, it steps back (it only opens the page again).
              primary={!again || phase === "notYet"}
              icon={Plug}
              busy={phase === "opening"}
              accessibilityLabel={
                again
                  ? `Open the sign-in page again for ${name} (new tab)`
                  : `Connect ${name} (new tab)`
              }
              onPress={() => void connect()}
            >
              {again ? "Open the sign-in page again" : `Connect ${name}`}
            </Button>
          )}
          {again && <SignedIn checking={phase === "checking"} onPress={() => void flow.check()} />}
        </Actions>
      )}
    </Frame>
  );
}

/**
 * The person's own app (an MCP server) that the agent saved switched off: they check its address
 * here and connect it, signing in on the app's own page or adding the access key it gave them.
 */
export function OwnAppCard({
  id,
  name: given = "",
  onCall = false,
  over = false,
  wide = false,
}: {
  id: string;
  name?: string;
  onCall?: boolean;
  /** The call it's on has ended. */
  over?: boolean;
  wide?: boolean;
}) {
  const { api } = useWorkspace();
  const { data } = useAgentWorkspace();
  const agent = data?.identity.name || "Neddy";
  const [app, setApp] = useState<OwnApp | null>();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const name = app?.name || given || "Your app";
  const load = useCallback(async () => {
    const list = await api.request<{ apps: OwnApp[] }>("/api/mcp");
    const found = list.apps.find((item) => item.id === id) ?? null;
    setApp(found);
    return found;
  }, [api, id]);
  const isConnected = useCallback(async () => (await load())?.status === "connected", [load]);
  const flow = useFlow(name, onCall, isConnected);
  const { setConnected } = flow;
  useEffect(() => {
    void load()
      .then((found) => found?.status === "connected" && setConnected(true))
      .catch(() => setApp(null));
  }, [load, setConnected]);

  const run = async (request: () => Promise<{ connected: boolean; url?: string; app: OwnApp }>) => {
    // A sign-in page may come back: its tab opens now, during the tap.
    const tab = app?.hasKey || key ? null : blankTab();
    flow.setPhase("opening");
    flow.setBlocked("");
    setError("");
    try {
      const result = await request();
      setApp(result.app);
      flow.tapped.current = true;
      if (result.connected) {
        tab?.close();
        return flow.finished();
      }
      if (result.url) return flow.signIn(result.url, tab);
      tab?.close();
      flow.setPhase("idle");
    } catch (e) {
      tab?.close();
      flow.setPhase("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const connect = () =>
    void run(() => api.request(`/api/mcp/${encodeURIComponent(id)}/connect`, {}));
  const saveKey = () =>
    void run(() => api.request(`/api/mcp/${encodeURIComponent(id)}/key`, { key: key.trim() })).then(
      () => setKey(""),
    );

  if (app === null)
    return <Frame name={name} connected={false} wide={wide} line="This app was removed." />;
  const { phase } = flow;
  // Back from signing in (waiting, checking or not yet), the card keeps one shape.
  const again = phase === "away" || phase === "notYet" || phase === "checking";
  const status = app?.status;
  const line = flow.connected
    ? connectedLine(agent, onCall, flow.tapped.current, over)
    : flow.blocked
      ? "Your browser didn’t open the sign-in page."
      : phase === "checking"
        ? "Checking…"
        : phase === "notYet"
          ? `Not connected yet. Finish signing in to ${name}, or open the sign-in page again if it closed.`
          : phase === "away"
            ? `Finish signing in to ${name} in the new tab, then come back here.`
            : status === "needs_key"
              ? (app?.error ?? "Add the access key your app gave you.")
              : status === "error"
                ? (app?.error ?? "Couldn’t connect.")
                : status === "needs_sign_in"
                  ? `Sign in to ${name} on its own page.`
                  : "Connect it only if this is your app’s address.";

  return (
    <Frame name={name} connected={flow.connected} wide={wide} line={line}>
      {!flow.connected && app?.host ? (
        <View style={{ gap: 2 }}>
          <Text style={meta}>Web address</Text>
          <Text selectable style={[s.text, { fontWeight: "600" }]}>
            {app.host}
          </Text>
        </View>
      ) : null}
      {!flow.connected && status === "needs_key" && (
        // Labelled like "Web address" above it; the field's own bottom margin is taken back.
        <View style={{ gap: 4, marginBottom: -16 }}>
          <Text style={meta}>Access key</Text>
          <Field
            label="Access key"
            hideLabel
            accessibilityLabel={`Access key for ${name}`}
            value={key}
            onChangeText={setKey}
            placeholder="Paste the key your app gave you"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </View>
      )}
      <ErrorNotice error={error} />
      {!flow.connected && app && (
        <Actions>
          {flow.blocked ? (
            <Button
              primary
              icon={LogIn}
              onPress={() => flow.signIn(flow.blocked, null)}
              accessibilityLabel={`Open the sign-in page for ${name}`}
            >
              Open the sign-in page
            </Button>
          ) : status === "needs_key" ? (
            <Button
              primary
              icon={KeyRound}
              busy={phase === "opening"}
              disabled={!key.trim()}
              accessibilityLabel={`Save key for ${name}`}
              onPress={saveKey}
            >
              Save key
            </Button>
          ) : (
            <Button
              primary={!again || phase === "notYet"}
              icon={status === "needs_sign_in" ? LogIn : Plug}
              busy={phase === "opening"}
              accessibilityLabel={
                again
                  ? `Open the sign-in page again for ${name} (new tab)`
                  : status === "needs_sign_in"
                    ? `Sign in to ${name}`
                    : status === "error"
                      ? `Try again to connect ${name}`
                      : `Connect ${name}`
              }
              onPress={connect}
            >
              {again
                ? "Open the sign-in page again"
                : status === "needs_sign_in"
                  ? "Sign in"
                  : status === "error"
                    ? "Try again"
                    : `Connect ${name}`}
            </Button>
          )}
          {again && <SignedIn checking={phase === "checking"} onPress={() => void flow.check()} />}
        </Actions>
      )}
    </Frame>
  );
}

/** In the chat: a Connect card for the app connect_app asked the person to connect. */
export function ToolConnect({ result, loading }: { result: unknown; loading: boolean }) {
  const request = loading ? undefined : connectRequest(result);
  if (!request) return null;
  // Their own app (an MCP server): its own card, to check the address and sign in or add a key.
  return request.own ? <OwnAppCard id={request.app} /> : <ConnectCard app={request.app} />;
}
/** In the chat: a Connect card for the person's own app that add_own_app saved. */
export function ToolOwnApp({ result, loading }: { result: unknown; loading: boolean }) {
  const own = loading ? undefined : ownAppRequest(result);
  return own ? <OwnAppCard id={own.id} name={own.name} /> : null;
}
