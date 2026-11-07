import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, CheckRow, colors, ErrorNotice, Field, SectionHeading, s } from "./ui";
import { useWorkspace } from "./workspace";

/**
 * The admin's switch for pictures (owner, 2026-11-07) and the two OpenRouter image models: the
 * Draft everyone gets by default and the Good one for "make it better". Under You › Money, by the
 * AI models card; only the admin sees it.
 */
interface PictureSettings {
  enabled: boolean;
  draft: string;
  good: string;
  /** OPENROUTER_API_KEY is set on the server (pictures need it). */
  keySet: boolean;
}

export function PicturesAdminCard() {
  const { api } = useWorkspace();
  const [view, setView] = useState<PictureSettings>();
  const [draft, setDraft] = useState("");
  const [good, setGood] = useState("");
  const [busy, setBusy] = useState(false);
  const [news, setNews] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void api.request<{ role?: string }>("/api/me").then(
      (me) => {
        if (me.role !== "admin") return;
        void api.request<PictureSettings>("/api/pictures/settings").then(
          (next) => {
            setView(next);
            setDraft(next.draft);
            setGood(next.good);
          },
          () => undefined,
        );
      },
      () => undefined,
    );
  }, [api]);
  if (!view) return null;
  const save = async (patch: Partial<PictureSettings>, said: string) => {
    setBusy(true);
    setError("");
    setNews("");
    try {
      const next = await api.request<PictureSettings>("/api/pictures/settings", patch);
      setView(next);
      setDraft(next.draft);
      setGood(next.good);
      setNews(said);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const changed = draft.trim() !== view.draft || good.trim() !== view.good;
  return (
    <Card style={{ gap: 12 }}>
      <SectionHeading title="Pictures" />
      <Text style={s.muted}>
        “Make me a picture of…” makes one through OpenRouter and saves it to the person’s Files. A
        draft costs under a cent, a good one about two. Each plan has a monthly number; up to a
        fifth of them can be the good kind.
      </Text>
      {!view.keySet && (
        <View style={{ padding: 12, borderRadius: 14, backgroundColor: colors.sky }}>
          <Text style={[s.text, { fontWeight: "600" }]}>
            OpenRouter isn’t set up, so nobody can make pictures yet.
          </Text>
          <Text style={[s.muted, { color: colors.mutedStrong }]}>
            Add OPENROUTER_API_KEY under the api service’s Variables on Railway and choose Deploy on
            the banner it shows.
          </Text>
        </View>
      )}
      <CheckRow
        label="Pictures on"
        detail={
          view.enabled
            ? "Everyone on this app can ask for pictures."
            : "Nobody can make pictures until this is on."
        }
        checked={view.enabled}
        onPress={() =>
          !busy &&
          void save(
            { enabled: !view.enabled },
            view.enabled ? "Pictures are off." : "Pictures are on.",
          )
        }
      />
      <Field
        label="Draft model (OpenRouter image model)"
        value={draft}
        onChangeText={setDraft}
        placeholder="black-forest-labs/flux-3-image-klein"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label="Good model"
        value={good}
        onChangeText={setGood}
        placeholder="bytedance-seed/seedream-5-0-flash"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={s.small}>
        Model ids are on openrouter.ai/models under Images, priced per picture. Leave one empty to
        go back to the usual one.
      </Text>
      <View style={[s.row, { gap: 8 }]}>
        <Button
          small
          primary
          busy={busy}
          disabled={!changed}
          onPress={() =>
            void save({ draft: draft.trim(), good: good.trim() }, "Saved the picture models.")
          }
        >
          Save models
        </Button>
      </View>
      {!!news && <Text style={s.small}>{news}</Text>}
      <ErrorNotice error={error} />
    </Card>
  );
}
