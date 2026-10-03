import { useCallback, useMemo, useState } from "react";
import { Linking, Platform, Text, type TextStyle, View, type ViewStyle } from "react-native";
import Markdown, {
  type ASTNode,
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
  // A long link (a sign-in address) wraps inside its card instead of running past it (web).
  link: {
    color: colors.blueText,
    textDecorationLine: "underline",
    ...(Platform.OS === "web" ? ({ wordBreak: "break-word" } as TextStyle) : null),
  },
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
/**
 * A paragraph that's only a **bold** line, like "**Needs action:**": the label of a group in a
 * list-style answer (engine/answer-layout.ts).
 */
const isGroupLine = (node: ASTNode) => {
  const inline =
    node.children.length === 1 && node.children[0]?.type === "textgroup"
      ? node.children[0].children
      : [];
  return (
    inline[0]?.type === "strong" &&
    inline.slice(1).every((child) => child.type === "text" && /^\s*:?\s*$/.test(child.content))
  );
};
/**
 * A group's label sits with its own list (more room above, little below) and is a heading a screen
 * reader can jump to, one level below the answer's own # headings if it has any.
 */
const groupLineRule =
  (top: number): RenderFunction =>
  (node, children, parent, styles) =>
    parent.length === 0 && isGroupLine(node) ? (
      <View
        key={node.key}
        role="heading"
        aria-level={top < 6 ? 4 : 3}
        style={[
          styles.paragraph as ViewStyle,
          { marginTop: node.index === 0 ? 0 : 12, marginBottom: 0 },
        ]}
      >
        {children}
      </View>
    ) : (
      defaultRules.paragraph?.(node, children, parent, styles)
    );
/** Bullets as a real dot (the library's "·" is a speck), at the same hanging indent. */
const listItemRule: RenderFunction = (node, children, parent, styles) =>
  parent.some((item) => item.type === "bullet_list") ? (
    <View key={node.key} style={styles.listUnorderedItem as ViewStyle}>
      <View style={{ width: 20, marginLeft: 4, paddingTop: 9 }}>
        <View
          style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.mutedStrong }}
        />
      </View>
      <View style={[styles.listItem as ViewStyle, { flex: 1 }]}>{children}</View>
    </View>
  ) : (
    defaultRules.list_item?.(node, children, parent, styles)
  );
const rules: RenderRules = {
  list_item: listItemRule,
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
  const withHeadings = useMemo(
    () => ({ ...rules, ...headingRules(top), paragraph: groupLineRule(top) }),
    [top],
  );
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
