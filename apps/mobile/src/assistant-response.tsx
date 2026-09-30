import { useCallback, useMemo, useState } from "react";
import { Linking, Text, type TextStyle, View } from "react-native";
import Markdown, {
  renderRules as defaultRules,
  type MarkdownStyles,
  type RenderFunction,
  type RenderRules,
} from "react-native-markdown-renderer";
import { assistantMarkdown, isSafeAssistantUrl } from "./assistant-markdown";
import { colors, ErrorNotice } from "./ui";

const textStyle = { color: colors.text, fontSize: 16, lineHeight: 24 };
const style: Partial<MarkdownStyles> = {
  text: textStyle,
  paragraph: { marginTop: 0, marginBottom: 6 },
  list: { marginBottom: 6 },
  headingContainer: { marginTop: 8, marginBottom: 4 },
  // The rule under big headings and the list markers follow the theme (they were fixed colors).
  heading1Container: { borderBottomColor: colors.line },
  heading2Container: { borderBottomColor: colors.line },
  listUnorderedItemIcon: { color: colors.mutedStrong, fontWeight: "700" },
  listOrderedItemIcon: { color: colors.mutedStrong },
  heading1: { fontSize: 21, lineHeight: 27 },
  heading2: { fontSize: 19, lineHeight: 25 },
  heading3: { fontSize: 17, lineHeight: 23 },
  link: { color: colors.blueDark, textDecorationLine: "underline" },
  codeInline: { backgroundColor: colors.subtle, color: colors.text },
  codeBlock: { backgroundColor: colors.subtle, color: colors.text },
};
const renderCodeBlock: RenderRules["fence"] = (node, _children, _parent, styles) => (
  <Text key={node.key} selectable style={styles.codeBlock as TextStyle}>
    {node.content.replace(/\n$/, "")}
  </Text>
);
/**
 * A heading the screen reader can jump to, below the sheet or screen's own title (level 2): the
 * result's biggest headings are level 3, whether it writes them with "#" or "##".
 */
const headingRule =
  (level: number, top: number): RenderFunction =>
  (node, children, parent, styles) => (
    <View key={node.key} role="heading" aria-level={Math.min(level - top + 3, 6)}>
      {defaultRules[`heading${level}`]?.(node, children, parent, styles)}
    </View>
  );
const headingRules = (top: number) =>
  Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((level) => [`heading${level}`, headingRule(level, top)]),
  ) as RenderRules;
const rules: RenderRules = {
  textgroup: (node, children) => (
    <Text key={node.key} selectable style={textStyle}>
      {children}
    </Text>
  ),
  image: (node) => (
    <Text key={node.key} selectable style={{ color: colors.muted }}>
      {node.attributes.alt ? `[Image: ${node.attributes.alt}]` : "[Image]"}
    </Text>
  ),
  code_block: renderCodeBlock,
  fence: renderCodeBlock,
};

export function AssistantResponse({ content }: { content: string }) {
  const [linkError, setLinkError] = useState("");
  // The level of the biggest heading in this result ("# comments" in code don't count).
  const top = Math.min(
    ...[...content.replace(/^```[\s\S]*?^```/gm, "").matchAll(/^(#{1,6})\s/gm)].map(
      (match) => match[1]?.length ?? 6,
    ),
    6,
  );
  const withHeadings = useMemo(() => ({ ...rules, ...headingRules(top) }), [top]);
  const onLinkPress = useCallback((url: string) => {
    if (!isSafeAssistantUrl(url)) return false;
    setLinkError("");
    void Linking.openURL(url).catch((error) =>
      setLinkError(error instanceof Error ? error.message : String(error)),
    );
    return false;
  }, []);
  return (
    <>
      <Markdown
        markdownit={assistantMarkdown}
        style={style}
        rules={withHeadings}
        onLinkPress={onLinkPress}
      >
        {content}
      </Markdown>
      <ErrorNotice error={linkError} />
    </>
  );
}
