import { ExternalLink, RefreshCw, Share2, Sparkles } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Platform, Text, useWindowDimensions, View } from "react-native";
import type { Artifact } from "../../../packages/domain/src";
import { LivingPhoto } from "./living-photo";
import { Button, Card, colors, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * The card for a picture the agent made (owner, 2026-11-07): the picture itself, moving, with
 * what it was made from, "Made with AI", and what to do next. It's already in Files, so there's no
 * Save: Open shows it there, Share hands the picture to the share sheet (or copies a link), Try
 * another and Make it better put the ask in the message box, ready to send (a new picture
 * counts, so it's never sent by a tap alone).
 */
interface PictureResult {
  fileId: string;
  name: string;
  url?: string;
  prompt: string;
  quality: "draft" | "good";
  aspect?: "square" | "wide" | "tall";
  moving?: boolean;
}

const RATIO: Record<NonNullable<PictureResult["aspect"]>, number> = {
  square: 1,
  wide: 16 / 9,
  tall: 9 / 16,
};

export function PictureToolCard({
  result,
  loading = false,
  onCall = false,
}: {
  result: unknown;
  loading?: boolean;
  onCall?: boolean;
}) {
  if (loading) return null;
  let value = result;
  if (typeof value === "string")
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  const { picture, limit, goodOnly } = (value ?? {}) as {
    picture?: PictureResult;
    limit?: string;
    goodOnly?: boolean;
  };
  if (typeof limit === "string")
    return (
      <Card style={{ gap: 4, maxWidth: 520 }}>
        <Text style={[s.text, { fontWeight: "600" }]}>
          {goodOnly ? "No more good ones this month" : "No more pictures this month"}
        </Text>
        <Text style={s.muted}>{limit}</Text>
      </Card>
    );
  if (!picture || typeof picture.fileId !== "string" || typeof picture.prompt !== "string")
    return null;
  return <PictureCard picture={picture} onCall={onCall} />;
}

function PictureCard({ picture, onCall }: { picture: PictureResult; onCall: boolean }) {
  const { api, open, draft } = useWorkspace();
  const { width: window } = useWindowDimensions();
  // Links in a result expire after 15 minutes: a fresh one each time the card is drawn.
  const [file, setFile] = useState<Artifact>();
  const [depthUrl, setDepthUrl] = useState<string>();
  const [note, setNote] = useState("");
  const [gone, setGone] = useState(false);
  const made = useRef<string>(undefined);
  useEffect(() => {
    let live = true;
    void api
      .request<Artifact>(`/api/files/${encodeURIComponent(picture.fileId)}`)
      .then((fresh) => live && setFile(fresh))
      .catch((error: unknown) => {
        if (live && /not found/i.test(error instanceof Error ? error.message : "")) setGone(true);
      });
    if (picture.moving && Platform.OS === "web")
      void fetch(api.url(`/api/files/${encodeURIComponent(picture.fileId)}/depth`), {
        headers: { Authorization: `Bearer ${api.token}` },
      })
        .then((response) => (response.ok ? response.blob() : undefined))
        .then((blob) => {
          if (!live || !blob) return;
          made.current = URL.createObjectURL(blob);
          setDepthUrl(made.current);
        })
        .catch(() => undefined);
    return () => {
      live = false;
      if (made.current) URL.revokeObjectURL(made.current);
    };
  }, [api, picture.fileId, picture.moving]);
  const ratio = RATIO[picture.aspect ?? "square"];
  // The picture fills the card on a phone and sits at a sensible size on a computer.
  const width = Math.min(window - 64, picture.aspect === "wide" ? 520 : 360);
  const height = Math.round(width / ratio);
  const src = file?.url ?? picture.url;
  // The prompt is the text under it, so the image doesn't read it out twice.
  const label = "Picture, made with AI";
  const share = async () => {
    setNote("");
    try {
      const fresh = await api.request<Artifact>(`/api/files/${encodeURIComponent(picture.fileId)}`);
      if (Platform.OS === "web" && typeof navigator !== "undefined") {
        const response = await fetch(fresh.url);
        const blob = await response.blob();
        const shared = new File([blob], fresh.name, { type: blob.type || "image/png" });
        if (navigator.canShare?.({ files: [shared] })) {
          await navigator.share({ files: [shared], title: picture.prompt });
          return;
        }
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(fresh.url);
          setNote("Copied a link to the picture. It works for 15 minutes.");
          return;
        }
      }
      setNote("Tap Open, then save or share it from there.");
    } catch (error) {
      if (!/abort/i.test(error instanceof Error ? error.name : ""))
        setNote("Couldn’t share it. Try again.");
    }
  };
  const show = async () => {
    setNote("");
    try {
      const fresh = await api.request<Artifact>(`/api/files/${encodeURIComponent(picture.fileId)}`);
      open({ type: "file", file: fresh });
    } catch {
      setNote("Couldn’t open it. Try again in a moment.");
    }
  };
  return (
    <Card style={{ gap: 10, width: width + 32, alignSelf: "flex-start" }}>
      {gone ? (
        <Text style={s.muted}>This picture was deleted from Files.</Text>
      ) : src ? (
        <LivingPhoto src={src} depthSrc={depthUrl} width={width} height={height} label={label} />
      ) : (
        <View
          accessibilityRole="image"
          accessibilityLabel="Loading picture"
          style={{ width, height, borderRadius: 16, backgroundColor: colors.subtle }}
        />
      )}
      <View style={{ gap: 2 }}>
        <Text style={[s.text, { fontWeight: "600" }]} numberOfLines={3}>
          {picture.prompt}
        </Text>
        <Text style={s.muted}>
          Made with AI · {picture.quality === "good" ? "the good kind" : "a quick draft"} · saved in
          Files
        </Text>
      </View>
      {!gone && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(onCall
            ? [
                {
                  key: "share",
                  icon: Share2,
                  label: "Share",
                  primary: false,
                  onPress: () => void share(),
                },
              ]
            : [
                ...(picture.quality === "draft"
                  ? [
                      {
                        key: "better",
                        icon: Sparkles,
                        label: "Make it better",
                        primary: true,
                        onPress: () => draft(`Make it better: ${picture.prompt}`),
                      },
                    ]
                  : []),
                {
                  key: "another",
                  icon: RefreshCw,
                  label: "Try another",
                  primary: false,
                  onPress: () => draft(`Try another picture: ${picture.prompt}`),
                },
                {
                  key: "open",
                  icon: ExternalLink,
                  label: "Open",
                  primary: false,
                  onPress: () => void show(),
                },
                {
                  key: "share",
                  icon: Share2,
                  label: "Share",
                  primary: false,
                  onPress: () => void share(),
                },
              ]
          ).map((item) => (
            // Two to a row, so the main button is never alone under the others.
            <View key={item.key} style={{ flexBasis: "48%", flexGrow: 1 }}>
              <Button small icon={item.icon} primary={item.primary} onPress={item.onPress}>
                {item.label}
              </Button>
            </View>
          ))}
        </View>
      )}
      {/* Always mounted, so a change is read out; out of the flow while empty. */}
      <Text
        role="status"
        aria-live="polite"
        pointerEvents="none"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
      >
        {note}
      </Text>
      {!!note && <Text style={s.muted}>{note}</Text>}
    </Card>
  );
}
