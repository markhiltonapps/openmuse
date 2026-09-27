import { useState } from "react";
import { Image, Text } from "react-native";
import { API_URL } from "./api";

/** "📰" → "1f4f0": code points without the FE0F variation selector. */
export function emojiCode(emoji: string) {
  return [...emoji]
    .map((character) => character.codePointAt(0)?.toString(16) ?? "")
    .filter((code) => code && code !== "fe0f")
    .join("-");
}

/** An emoji drawn in 3D (Microsoft's Fluent emoji, served by the app), or as text without one. */
export function Emoji({ char, size = 32 }: { char: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed || !char)
    return (
      <Text
        accessible={false}
        style={{ fontSize: size * 0.82, lineHeight: size * 1.1, width: size, textAlign: "center" }}
      >
        {char}
      </Text>
    );
  return (
    <Image
      source={{ uri: `${API_URL}/api/emoji/${emojiCode(char)}` }}
      onError={() => setFailed(true)}
      accessible={false}
      style={{ width: size, height: size }}
    />
  );
}

const TOPICS: [RegExp, string][] = [
  [/competitor|ad library|\bads?\b|campaign|marketing/i, "📣"],
  [/video|visual|render|design|brochure/i, "🎬"],
  [/report|analy[sz]|chart|metric|dashboard/i, "📊"],
  [/background job|checklist|track|status/i, "📋"],
  [/document|permission|\bforms?\b|\bsign(ed|ing)?\b|contract/i, "📝"],
  [/money|spend|saving|budget|invoice|bill|subscription/i, "💸"],
  [/flight|travel|trip|hotel/i, "✈️"],
  [/dinner|lunch|table|restaurant|meal|recipe/i, "🍽️"],
  [/coffee|catch-up|catch up/i, "☕"],
  [/email|inbox|reply|follow-up|follow up/i, "✉️"],
  [/meeting|calendar|schedule/i, "📅"],
  [/workout|\brun(ning)?\b|training|health|sleep|\bwalk/i, "🏃"],
  [/birthday|gift|anniversary/i, "🎁"],
  [/shop|buy|order|price/i, "🛍️"],
  [/remind/i, "⏰"],
  [/goal|plan/i, "🎯"],
];
/** An emoji that fits a suggestion's words. */
export function topicEmoji(text: string) {
  return TOPICS.find(([pattern]) => pattern.test(text))?.[1] ?? "💡";
}
