import { FileText, FolderOpen, Globe2, Plus, RefreshCw, Terminal } from "lucide-react-native";
import { useEffect, useState } from "react";
import { AppState, Image, Text, View } from "react-native";
import type { BrowserSession } from "../../../packages/domain/src";
import { useAgentWorkspace } from "./agent-workspace";
import { browserAddress } from "./browser-address";
import { useComputerDraft } from "./computer-drafts";
import { LinuxWorkspace } from "./computer-workspace";
import { Button, Card, colors, dateLabel, ErrorNotice, Field, LinkRow, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

export function BrowserThreadCard({ browser }: { browser: BrowserSession }) {
  const { open } = useWorkspace();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [browser.previewUrl, browser.updatedAt]);
  return (
    <Card
      style={{ padding: 13, backgroundColor: colors.bubble, gap: 12, maxWidth: 440, width: "100%" }}
    >
      <View style={[s.row, { gap: 10 }]}>
        <View style={[s.iconBox, { width: 36, height: 36, borderRadius: 9 }]}>
          <Globe2 size={21} color={colors.blueDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.text, { fontWeight: "600" }]}>Browser</Text>
          <Text numberOfLines={1} style={s.small}>
            {browser.status === "closed"
              ? "Session saved"
              : browser.status === "error"
                ? "Needs attention"
                : browser.title}
          </Text>
        </View>
      </View>
      {browser.previewUrl && browser.status === "active" && !failed ? (
        <Image
          accessibilityLabel={`Browser preview: ${browser.title}`}
          source={{ uri: browser.previewUrl }}
          style={{
            width: "100%",
            aspectRatio: 1.6,
            borderRadius: 11,
            backgroundColor: colors.surface,
          }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <View
          style={{
            padding: 24,
            borderRadius: 12,
            backgroundColor: colors.surface,
            alignItems: "center",
            gap: 10,
          }}
        >
          <Globe2 size={30} color={colors.muted} />
          <Text numberOfLines={2} style={[s.muted, { textAlign: "center" }]}>
            {failed ? "Preview unavailable. Open the browser to reconnect." : browser.url}
          </Text>
        </View>
      )}
      <Button onPress={() => open({ type: "browser", browser })}>
        {browser.status === "closed"
          ? "Reopen browser"
          : browser.status === "error"
            ? "Reconnect browser"
            : "Take control"}
      </Button>
    </Card>
  );
}
export function ComputerSheet() {
  const { workspace, api, refresh, close, open, navigate } = useWorkspace();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [chosen, setTab] = useComputerDraft("tab");
  const { data } = useAgentWorkspace();
  const agent = data?.identity.name || "your agent";
  const Agent = agent.charAt(0).toUpperCase() + agent.slice(1);
  const available = workspace.connections.some(
    (c) => c.id === "browser" && c.status === "connected",
  );
  // Terminal and Linux files only once the Linux computer is set up (it isn't on Railway); while
  // that's unknown, nothing shows, so no tabs appear and vanish.
  const [linux, setLinux] = useState(false);
  useEffect(() => {
    void api
      .request<{ enabled?: boolean }>("/api/computer")
      .then((snapshot) => setLinux(!!snapshot.enabled))
      .catch(() => undefined);
  }, [api]);
  const tab = linux ? chosen : "Browser";
  const [checking, setChecking] = useState(false);
  const checkAgain = () => {
    setChecking(true);
    void refresh()
      .then(() => setError(""))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setChecking(false));
  };
  useEffect(() => {
    let active = true;
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") return;
      void refresh().catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function create() {
    if (busy || !url.trim()) return;
    setBusy(true);
    setError("");
    try {
      const browser = await api.request<BrowserSession>("/api/browsers", {
        url: browserAddress(url),
      });
      await refresh();
      open({ type: "browser", browser });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={`${Agent}’s browser`}
      subtitle={`See the websites ${agent} is using, or take control.`}
      onClose={close}
    >
      <View style={{ gap: 20 }}>
        {tab === "Browser" && !available && (
          <View style={{ gap: 12, padding: 18, borderRadius: 20, backgroundColor: colors.subtle }}>
            <View style={[s.row, { gap: 12, alignItems: "flex-start" }]}>
              <View style={[s.iconBox, { width: 36, height: 36, borderRadius: 11 }]}>
                <Globe2 size={19} color={colors.blueDark} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.heading}>{`${Agent}’s browser is offline right now.`}</Text>
                <Text style={[s.text, { color: colors.mutedStrong }]}>
                  {`${Agent} can’t open or use websites until the browser is back.`}
                </Text>
              </View>
            </View>
            <Button
              primary
              icon={RefreshCw}
              busy={checking}
              style={{ alignSelf: "flex-start" }}
              onPress={checkAgain}
            >
              Check again
            </Button>
          </View>
        )}
        {linux && (
          <View style={[s.row, { gap: 8 }]}>
            {(["Browser", "Terminal", "Files"] as const).map((item) => (
              <Button
                key={item}
                primary={tab === item}
                icon={item === "Browser" ? Globe2 : item === "Terminal" ? Terminal : FolderOpen}
                onPress={() => setTab(item)}
              >
                {item}
              </Button>
            ))}
          </View>
        )}
        {linux && (
          <View style={{ display: tab === "Browser" ? "none" : "flex" }}>
            <LinuxWorkspace tab={tab === "Files" ? "Files" : "Terminal"} />
          </View>
        )}
        <ErrorNotice error={error} />
        {tab === "Browser" ? (
          <>
            {available && (
              <View>
                <Field
                  label="Website address"
                  value={url}
                  onChangeText={setUrl}
                  placeholder="https://example.com"
                  autoCapitalize="none"
                  keyboardType="url"
                  onSubmitEditing={() => void create()}
                />
                <Button
                  primary
                  icon={Plus}
                  busy={busy}
                  disabled={!available || !url.trim()}
                  onPress={() => void create()}
                >
                  Open a website
                </Button>
              </View>
            )}
            {workspace.browsers.length ? (
              <Text role="heading" aria-level={3} style={s.heading}>
                {`Websites ${agent} used`}
              </Text>
            ) : null}
            {[...workspace.browsers]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((browser) =>
                available ? (
                  <BrowserThreadCard key={browser.id} browser={browser} />
                ) : (
                  // Listed, but greyed out: nothing can open until the browser is back.
                  <View
                    key={browser.id}
                    aria-disabled
                    style={[s.row, { gap: 12, opacity: 0.6, minHeight: 52 }]}
                  >
                    <Globe2 size={18} color={colors.mutedStrong} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text numberOfLines={1} style={s.text}>
                        {browser.title || browser.url}
                      </Text>
                      <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
                        {`${dateLabel(browser.updatedAt)} · Can’t open until the browser is back`}
                      </Text>
                    </View>
                  </View>
                ),
              )}
            {!workspace.browsers.length && (
              <Text style={s.muted}>
                {available
                  ? `Open a website here, or ask ${agent} to look something up. The websites it uses show here.`
                  : `The websites ${agent} uses show here once the browser is back.`}
              </Text>
            )}
            {available ? (
              <Text style={{ fontSize: 13, lineHeight: 18, color: colors.mutedStrong }}>
                {`Each website ${agent} opens keeps its own sign-ins and downloads. Tap Take control on one to do a step yourself, then come back to your chat.`}
              </Text>
            ) : null}
          </>
        ) : tab === "Files" ? (
          <>
            <Text style={s.heading}>Documents</Text>
            <Text style={s.small}>PDFs saved from mail, browser downloads, and your uploads.</Text>
            {workspace.files.map((file) => (
              <LinkRow
                key={file.id}
                icon={FileText}
                title={file.name}
                detail={`${file.pageCount} pages · PDF`}
                onPress={() => open({ type: "file", file })}
              />
            ))}
            <Button
              icon={Plus}
              onPress={() => {
                close();
                navigate("files");
              }}
            >
              Import a document
            </Button>
          </>
        ) : null}
      </View>
    </Sheet>
  );
}
