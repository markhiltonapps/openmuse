import { Link2, Link2Off } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Platform, Share, Text, View } from "react-native";
import { Button, Card, colors, ErrorNotice, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

interface ShareLink {
  url: string;
  expiresAt: string;
}
const DURATIONS = [
  { days: 1, label: "1 day" },
  { days: 7, label: "1 week" },
  { days: 30, label: "30 days" },
] as const;
const until = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** Copies a link on the web, or opens the share sheet on a phone. */
async function handOver(url: string, name: string) {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(url);
    return "Link copied.";
  }
  await Share.share({ message: url, title: name });
  return "";
}

/** A link anyone can open until it expires, and a way to turn it off. */
export function ShareLinkCard({
  fileId,
  name,
  base = `/api/files/${fileId}`,
  what = "file",
  note,
}: {
  fileId: string;
  name: string;
  /** Where its links are made: a file's, or a mini app's. */
  base?: string;
  what?: string;
  /** What else someone with the link gets, said before and after sharing. */
  note?: string;
}) {
  const { api, notify } = useWorkspace();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api.request<{ links: ShareLink[] }>(`${base}/share`).then(
        (value) => setLinks(value.links),
        () => undefined,
      ),
    [api, base],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function run(id: string, work: () => Promise<void>) {
    setBusy(id);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  const current = links[0];
  return (
    <Card style={{ gap: 12, marginBottom: 18 }}>
      <SectionHeading title="Share link" />
      {current ? (
        <>
          <Text style={s.text}>
            Anyone with the link can open this {what}.{note ? ` ${note}` : ""}
          </Text>
          <Text selectable style={[s.small, { color: colors.text }]} numberOfLines={1}>
            {current.url}
          </Text>
          <Text style={s.muted}>Works until {until(current.expiresAt)}.</Text>
          <View style={[s.row, { gap: 10, flexWrap: "wrap" }]}>
            <Button
              primary
              icon={Link2}
              onPress={() =>
                void run("copy", async () => {
                  const done = await handOver(current.url, name);
                  if (done) notify(done);
                })
              }
            >
              {Platform.OS === "web" ? "Copy link" : "Share link"}
            </Button>
            <Button
              icon={Link2Off}
              busy={busy === "stop"}
              onPress={() =>
                void run("stop", async () => {
                  await api.request(`${base}/unshare`, {});
                  await load();
                  notify("Sharing stopped. The link no longer works.");
                })
              }
            >
              Stop sharing
            </Button>
          </View>
        </>
      ) : (
        <>
          <Text style={s.muted}>
            Make a link to send this {what} to anyone.{note ? ` ${note}` : ""} It stops working
            after the time you choose, and you can turn it off sooner.
          </Text>
          <Text style={s.small}>Link works for</Text>
          <View style={[s.row, { gap: 8 }]}>
            {DURATIONS.map((d) => (
              <Button key={d.days} small primary={days === d.days} onPress={() => setDays(d.days)}>
                {d.label}
              </Button>
            ))}
          </View>
          <Button
            icon={Link2}
            busy={busy === "make"}
            onPress={() =>
              void run("make", async () => {
                const link = await api.request<ShareLink>(`${base}/share`, { days });
                await load();
                const done = await handOver(link.url, name);
                notify(done || "Share link ready.");
              })
            }
          >
            Make a share link
          </Button>
        </>
      )}
      <ErrorNotice error={error} />
    </Card>
  );
}
