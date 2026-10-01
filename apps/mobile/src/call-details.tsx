import { ChevronRight, ExternalLink, FileText } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import type { Artifact } from "../../../packages/domain/src";
import type { CallDetail } from "../../../packages/domain/src/voice";
import { ApprovalCard } from "./approval-card";
import { AssistantResponse } from "./assistant-response";
import { PlacesCard, ProductsCard, SearchPicturesCard } from "./rich-cards";
import { colors, s } from "./ui";
import { useWorkspace } from "./workspace";

const FILE_KINDS: Record<string, string> = {
  create_document: "Document",
  create_spreadsheet: "Spreadsheet",
  create_presentation: "Slides",
};
const meta = { fontSize: 12, lineHeight: 17, color: colors.mutedStrong };

/**
 * What a live call put on screen instead of reading it out: long answers, products, places,
 * pictures and files, each shown as the chat shows it. During the call the newest is on top; in
 * the chat they read in order, like the conversation.
 */
export function CallDetails({
  details,
  onCall = false,
  lineColor = colors.line,
}: {
  details: CallDetail[];
  /**
   * On the call screen: newest first, and nothing opens another sheet (it would end the call), so
   * files open in a new tab and an approval's details open in place.
   */
  onCall?: boolean;
  /** The line between answers: inside a chat bubble it needs to be darker than usual. */
  lineColor?: string;
}) {
  return (
    <View style={{ gap: 22 }}>
      {(onCall ? [...details].reverse() : details).map((detail, index) => (
        <View key={`${detail.id}-${detail.at}`} style={{ gap: 10 }}>
          {/* Just an Approve card: it has its own title, so no heading above it. */}
          {!detail.items.every((item) => item.tool === "approval") && (
            <View style={{ gap: 2 }}>
              <Text
                role="heading"
                aria-level={3}
                style={[s.heading, { fontSize: 19, lineHeight: 25, fontWeight: "700" }]}
              >
                {detail.title}
              </Text>
              {detail.question && detail.question !== detail.title ? (
                <Text numberOfLines={2} style={[s.small, meta]}>
                  {`You asked: “${detail.question}”`}
                </Text>
              ) : null}
            </View>
          )}
          {detail.items.map((item, at) => {
            // The heading already says it; a card's own title would repeat it.
            const result = untitled(item.result, detail.title);
            const key = `${item.tool}-${at}`;
            switch (item.tool) {
              case "show_on_screen": {
                const { title, text } = result as { title?: unknown; text?: unknown };
                const titled = typeof title === "string" && title;
                // Text lines stay readable on a computer (cards can use the whole width).
                return (
                  <View key={key} style={{ gap: 4, maxWidth: 640, marginTop: titled ? 6 : 0 }}>
                    {titled ? (
                      <Text role="heading" aria-level={4} style={s.heading}>
                        {title}
                      </Text>
                    ) : null}
                    <AssistantResponse content={String(text ?? "")} />
                  </View>
                );
              }
              case "show_products":
                return <ProductsCard key={key} result={result} loading={false} />;
              case "show_places":
                return <PlacesCard key={key} result={result} loading={false} />;
              case "search_web":
                return <SearchPicturesCard key={key} result={result} loading={false} />;
              case "approval": {
                const { actionId } = result as { actionId?: unknown };
                return typeof actionId === "string" ? (
                  <ApprovalCard key={key} actionId={actionId} onCall={onCall} wide />
                ) : null;
              }
              default:
                return (
                  <FileRow key={key} kind={FILE_KINDS[item.tool]} result={result} inApp={!onCall} />
                );
            }
          })}
          {index < details.length - 1 && (
            <View style={{ height: 1, backgroundColor: lineColor, marginTop: 8 }} />
          )}
        </View>
      ))}
    </View>
  );
}

function untitled(result: unknown, heading: string) {
  if (!result || typeof result !== "object") return result;
  const { title, ...rest } = result as { title?: unknown };
  return title === heading ? rest : result;
}

/**
 * A file made during the call. Its link is fetched fresh when it's opened (signed links expire):
 * in the app from the chat, in a new tab from the call screen.
 */
function FileRow({
  kind = "File",
  result,
  inApp,
}: {
  kind?: string;
  result: unknown;
  inApp: boolean;
}) {
  const { api, open } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const file = result as { id?: unknown; name?: unknown; pages?: unknown };
  if (typeof file.id !== "string" || typeof file.name !== "string") return null;
  const { id, name } = file;
  const pages = typeof file.pages === "number" ? file.pages : undefined;
  const show = async () => {
    setBusy(true);
    setProblem("");
    try {
      const fresh = await api.request<Artifact>(`/api/files/${encodeURIComponent(id)}`);
      if (inApp) open({ type: "file", file: fresh });
      else if (fresh.url) await Linking.openURL(fresh.url);
    } catch (error) {
      setProblem(
        /not found/i.test(error instanceof Error ? error.message : "")
          ? "This file was deleted."
          : "Couldn’t open it. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Pressable
      role="link"
      // The label is what's read out, so a problem goes in it too.
      aria-label={
        problem ? `${name}. ${problem}` : inApp ? `Open ${name}` : `Open ${name} in a new tab`
      }
      aria-disabled={busy}
      onPress={() => !busy && void show()}
      style={({ pressed }) => [
        s.row,
        {
          gap: 12,
          minHeight: 56,
          padding: 12,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.card,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={{ backgroundColor: "#FC2359", padding: 8, borderRadius: 9 }}>
        <FileText size={20} color="#FFF" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={[s.text, { fontWeight: "600" }]}>
          {name}
        </Text>
        <Text style={[s.small, meta, problem ? { color: colors.danger } : null]}>
          {problem ||
            [kind, pages ? `${pages} ${pages === 1 ? "page" : "pages"}` : "", "saved in Files"]
              .filter(Boolean)
              .join(" · ")}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator color={colors.mutedStrong} />
      ) : inApp ? (
        <ChevronRight size={18} color={colors.muted} />
      ) : (
        <ExternalLink size={16} color={colors.blueDark} />
      )}
    </Pressable>
  );
}
